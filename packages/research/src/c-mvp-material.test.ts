/**
 * Phase C-MVP — the material input pipe.
 *
 *   C2  rule-based parsing (no model)               — only `[CLAIM]` blocks become claims
 *   C3  claims go through the EXISTING ingestClaims — no duplicated write logic
 *   C4  before/after: unknown -> sufficient, gap open -> resolved, priority shrinks
 *   C5  idempotency: the same material twice adds nothing
 *   +   the material carries subject provenance from day one
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { MaterialIngestService } from "./application/material-ingest-service.js";
import { PriorityService } from "./application/priority-service.js";
import { parseClaims } from "./domain/material-parser.js";

const MATERIAL = `# 专家访谈纪要

以下是普通叙述，不会被当成事实。

[CLAIM]
dimension: market
content: 市场空间约 500 亿元，未来三年 CAGR 约 25%
confidence: 0.8
source: 专家访谈 A
[/CLAIM]

又一段叙述。

[CLAIM]
dimension: demand
content: 头部客户已进入小批量采购阶段
[/CLAIM]

[CLAIM]
content: 这个块缺少 dimension，应被报告而不是臆测
[/CLAIM]
`;

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: "C测试行业" });
  const sid = res.industry.industryId;
  const materials = new MaterialIngestService(repo, new EchoDataProvider(), artifacts);
  const priorities = new PriorityService(db.db);
  return { db, repo, artifacts, materials, priorities, sid };
}

const state = (repo: ResearchRepository, sid: string) => ({
  openGaps: repo.listGaps(sid).filter((g) => g.status === "open" || g.status === "mitigating").length,
  slot: (d: string) => repo.getPoolSlot(`slot-${sid}-${d}`)?.status,
});

describe("C-MVP material parsing (C2)", () => {
  test("only explicit [CLAIM] blocks become claims; malformed blocks are reported", () => {
    const { claims, errors } = parseClaims(MATERIAL);
    assert.equal(claims.length, 2, "two well-formed blocks");
    assert.equal(claims[0].dimension, "market");
    assert.match(claims[0].statement, /500 亿元/);
    assert.equal(claims[0].confidence, 0.8);
    assert.equal(claims[0].sourceRef, "专家访谈 A");
    assert.equal(claims[1].dimension, "demand");
    assert.equal(errors.length, 1, "the block without a dimension is reported");
    assert.match(errors[0], /missing "dimension"/);
  });

  test("prose without a [CLAIM] block produces no claim at all", () => {
    const { claims, errors } = parseClaims("这是一段普通材料，没有任何结论块。");
    assert.equal(claims.length, 0);
    assert.equal(errors.length, 0);
  });

  test("relation hints are parsed (REVISE / CONFLICT / SUPERSEDE)", () => {
    const text = `
[CLAIM]
dimension: market
content: x
relation: REVISE
[/CLAIM]
[CLAIM]
dimension: demand
content: y
relation: SUPERSEDE
[/CLAIM]
`;
    const { claims, errors } = parseClaims(text);
    assert.equal(claims[0].relationHint?.kind, "REVISE");
    // SUPERSEDE without a `supersedes` ref is reported and dropped, not guessed
    assert.equal(claims[1].relationHint, undefined);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /requires "supersedes"/);
  });
});

describe("C-MVP material ingestion (C1/C3/C4/C5)", () => {
  test("C3/C4: the material really drives the existing pipeline (before -> after)", async () => {
    const { db, repo, artifacts, materials, priorities, sid } = await setup();

    const before = state(repo, sid);
    assert.equal(before.slot("market"), "unknown");
    assert.equal(before.openGaps, 12);
    const prioritiesBefore = priorities.currentPriorities(sid).length;
    assert.equal(prioritiesBefore, 12);

    const result = await materials.ingest({
      subjectKind: "industry",
      subjectId: sid,
      title: "专家访谈纪要",
      text: MATERIAL,
    });
    // ★ C-MVP-R1 §29.4: the five-value outcome union replaced the boolean `created`.
    assert.equal(result.outcome, "created");
    assert.equal(result.material.ingestBlocks.length, 2, "two claims produced");
    const claimIds = result.outcome === "created" ? result.claimIds : [];
    assert.equal(claimIds.length, 2);

    // C4: the pool / gap / priority state actually moved
    const after = state(repo, sid);
    assert.equal(after.slot("market"), "sufficient", "market became sufficient");
    assert.equal(after.slot("demand"), "sufficient");
    assert.equal(after.openGaps, 10, "two gaps resolved");
    assert.equal(priorities.currentPriorities(sid).length, 10, "priority shrank with the gaps");

    // C3: the claims went through the REAL claim pipeline (they are real artifacts)
    for (const id of claimIds) {
      assert.ok(await artifacts.get(id), `claim artifact ${id} exists`);
    }
    // confidence / sourceRef from the material reached Knowledge
    const kr = new KnowledgeRepository(db.db);
    const k = kr.findKnowledgeBySubject("industry", sid)!;
    const market = kr.listBeliefs(k.knowledgeId).find((b) => b.dimension === "market")!;
    assert.equal(market.sourceRef, "专家访谈 A");
    db.close();
  });

  test("provenance: the material carries subject + fingerprint + its claim refs", async () => {
    const { db, repo, materials, sid } = await setup();
    const result = await materials.ingest({
      subjectKind: "industry",
      subjectId: sid,
      title: "专家访谈纪要",
      text: MATERIAL,
      filename: "expert.md",
      locator: "/tmp/expert.md",
    });
    const stored = repo.getMaterial(result.material.materialId)!;
    assert.equal(stored.subjectKind, "industry");
    assert.equal(stored.subjectId, sid, "subject provenance from day one");
    assert.equal(stored.contentHash.length, 64, "sha256 fingerprint");
    assert.equal(stored.claimRefs.length, 2, "material -> claims traceability");
    assert.equal(stored.rawText, MATERIAL, "raw text kept verbatim");
    assert.equal(stored.filename, "expert.md");
    // and it is listable BY SUBJECT (the thing the old Source table could not do)
    assert.equal(repo.listMaterials(sid).length, 1);
    db.close();
  });

  test("C5: the same material twice is ingested once (no duplicate claim/belief/item)", async () => {
    const { db, repo, materials, priorities, sid } = await setup();
    const kr = new KnowledgeRepository(db.db);
    const counts = () => {
      const k = kr.findKnowledgeBySubject("industry", sid);
      const slots = repo.listPoolSlots(sid);
      return {
        materials: repo.listMaterials(sid).length,
        beliefs: k ? kr.listBeliefs(k.knowledgeId).length : 0,
        items: slots.flatMap((s) => repo.listPoolItems(s.slotId)).length,
        gaps: repo.listGaps(sid).length,
        priorities: priorities.currentPriorities(sid).length,
      };
    };

    const first = await materials.ingest({ subjectKind: "industry", subjectId: sid, title: "m", text: MATERIAL });
    assert.equal(first.outcome, "created");
    const afterFirst = counts();

    const second = await materials.ingest({ subjectKind: "industry", subjectId: sid, title: "m", text: MATERIAL });
    // ★ C-MVP-R1 §29.3: only a COMPLETED row means "fully duplicated" — and it reports `duplicate`,
    // never a bare boolean (which could not distinguish a残骸 from a complete import).
    assert.equal(second.outcome, "duplicate", "identical content is a complete duplicate");
    assert.deepEqual(counts(), afterFirst, "nothing was duplicated");

    // a genuinely DIFFERENT material is still accepted
    const other = await materials.ingest({
      subjectKind: "industry",
      subjectId: sid,
      title: "m2",
      text: `[CLAIM]\ndimension: policy\ncontent: 新政策发布\n[/CLAIM]`,
    });
    assert.equal(other.outcome, "created");
    assert.equal(counts().materials, 2);
    db.close();
  });
});
