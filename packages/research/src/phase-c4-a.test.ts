/**
 * Phase C · Step C4-A — Cognition / Conflict / State consumption + R1 zero-write conformance.
 *
 * Contract: `docs/phaseC/c4-implementation-contract.md`（C4 Contract Final Gate PASS, rev2）
 *   §3.2 新增 section（含 rejected，同等合法性/同等可观察性）
 *   §4.1 belief 层 SoT 绑定 · §4.2 conflict 层只读入口 · §4.3 ResearchState 白名单 + 派生禁区
 *   §5  R1 = contract-conformance fix（**语义**：无 active methodology ⇒ METHODOLOGY_V1 fallback 且零写入）
 *   §7  红线（16/17/19 等）· §8 验证矩阵 · §10 T-C4-13 **Layer 3 硬门槛**
 *
 * 只读纪律：Report 只透传 `KnowledgeLine` 的既有 5 字段；不聚合、不派生、不推断。
 *
 *   T-C4-1  candidate 只在 pendingCandidates，永不进入 currentKnowledge / mainJudgments
 *   T-C4-2  revisedBeliefs 字段与 SoT 逐字一致（透传）
 *   T-C4-3  superseded / rejected / conflicting 各自只含对应 state
 *   T-C4-4  5 个非 current state 逐一断言：永不 current
 *   T-C4-5  新增 section 排序确定性（dimension asc → beliefId asc）
 *   T-C4-6  不得出现任何 cognition 派生计数
 *   T-C4-7  conflicts 只 open；conflictHistory 只 resolved/accepted
 *   T-C4-8  conflict 只读既有行（篡改 status ⇒ Report 跟随）
 *   T-C4-9  Report 不调用 resolveConflict（行 byte-identical）
 *   T-C4-10 state 逐字段与 getStateBySubject 一致（篡改法）
 *   T-C4-11 无 persisted state ⇒ state === null（不伪造）
 *   T-C4-12a 不存在 progress / quality / maturity / nextBest 字段
 *   T-C4-14 生成 Report 的上游零写入（除 report_snapshot）
 *   T-C4-15 Report 不调用 rank()（静态生产调用点审计）
 *   T-C4-18 Report 的"当前认知" == listCurrentBeliefs()
 *   T-C4-13 ★ Layer 3（真实 SQLite 文件 + methodology 0 行）：上游 SoT changes = 0 / report_snapshot changes = 1
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { MaterialIngestService } from "./application/material-ingest-service.js";
import { ReportService } from "./application/report-service.js";
import { METHODOLOGY_V1 } from "./methodology/methodology-v1.js";
import { beliefIdFor } from "./domain/index.js";
import type { KnowledgeBelief, KnowledgeBeliefState } from "./domain/index.js";

const INDUSTRY = "C4-A 验证行业";

const TABLES = [
  "industry",
  "company",
  "research_question",
  "information_requirement",
  "research_gap",
  "information_pool_entry",
  "information_pool_slot",
  "information_pool_item",
  "research_state",
  "research_source",
  "research_document",
  "next_action",
  "methodology",
  "methodology_candidate",
  "human_gate",
  "industry_knowledge",
  "knowledge_belief",
  "knowledge_conflict",
  "investment_evaluation",
  "report_snapshot",
  "material",
  "research_position",
  "research_target",
  "diligence_preparation",
] as const;

/** Full 24-table fingerprint (used to prove upstream zero-write). */
const dbFingerprint = (db: ResearchDb, except: readonly string[] = []) =>
  JSON.stringify(
    TABLES.filter((t) => !except.includes(t)).map((t) => [t, db.db.prepare(`SELECT * FROM ${t}`).all()]),
  );

const tableCount = (db: ResearchDb, table: string) =>
  (db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/** A real-chain fixture: ingest an industry, then plant one belief per lifecycle state. */
async function seed() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const knowledge = new KnowledgeRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  // a REAL material so the Knowledge header + confirmed beliefs actually exist (C1 pipeline)
  const materials = new MaterialIngestService(repo, new EchoDataProvider(), artifacts);
  await materials.ingest({
    subjectKind: "industry",
    subjectId: sid,
    title: "c4a fixture",
    text: `[CLAIM]\ndimension: market\ncontent: 市场空间约 500 亿元\nconfidence: 0.8\nsource: 访谈 A\n[/CLAIM]\n`,
  });

  const k = knowledge.findKnowledgeBySubject("industry", sid)!;
  const now = new Date().toISOString();
  const plant = (state: KnowledgeBeliefState, dimension: string, suffix: string): KnowledgeBelief => {
    const claimRef = `artifact:claim/c4a-${state}-${suffix}`;
    const b: KnowledgeBelief = {
      beliefId: beliefIdFor(k.knowledgeId, claimRef),
      knowledgeId: k.knowledgeId,
      claimRef,
      sourceRef: `src-${state}`,
      dimension,
      confidence: 0.5,
      state,
      historicalRelations: [],
      createdAt: now,
      updatedAt: now,
    };
    knowledge.insertBelief(b);
    return b;
  };

  const planted = {
    candidate: plant("candidate", "market", "1"),
    revised: plant("revised", "demand", "1"),
    superseded: plant("superseded", "risk", "1"),
    rejected: plant("rejected", "policy", "1"),
    conflicting: plant("conflicting", "supply", "1"),
  };

  // One resolved + one accepted conflict over REAL claim refs (the open ones come from ingest).
  const knownClaimRefs = knowledge.listBeliefs(k.knowledgeId).map((b) => b.claimRef);
  const pair = (a: string, b: string, dim: string, id: string) => ({
    conflictId: id,
    claimARef: a,
    claimBRef: b,
    dimension: dim,
    status: "open" as const,
    createdAt: now,
  });
  knowledge.insertConflictIfAbsent(pair(knownClaimRefs[0]!, knownClaimRefs[1]!, "market", "kcf-c4a-resolved"));
  knowledge.insertConflictIfAbsent(pair(knownClaimRefs[0]!, knownClaimRefs[2]!, "market", "kcf-c4a-accepted"));
  knowledge.resolveConflict("kcf-c4a-resolved", "resolved", now);
  knowledge.resolveConflict("kcf-c4a-accepted", "accepted", now);

  return { db, repo, knowledge, sid, planted };
}

describe("Phase C4-A · cognition / conflict / state consumption", () => {
  test("T-C4-1/3/4: non-current beliefs appear ONLY in their own section", async () => {
    const { db, knowledge, sid, planted } = await seed();
    try {
      const s = new ReportService(db.db).generateDossier(sid).sections;

      assert.deepEqual(
        s.pendingCandidates.map((b) => b.beliefId),
        [planted.candidate.beliefId],
        "T-C4-1: candidate is in pendingCandidates",
      );
      assert.deepEqual(s.revisedBeliefs.map((b) => b.beliefId), [planted.revised.beliefId]);
      assert.deepEqual(s.supersededBeliefs.map((b) => b.beliefId), [planted.superseded.beliefId]);
      assert.deepEqual(s.rejectedBeliefs.map((b) => b.beliefId), [planted.rejected.beliefId], "T-C4-3");
      assert.deepEqual(s.conflictingBeliefs.map((b) => b.beliefId), [planted.conflicting.beliefId]);

      // T-C4-4: NOT ONE of the 5 non-current states may leak into the current sections
      const currentIds = new Set([...s.currentKnowledge, ...s.mainJudgments].map((b) => b.beliefId));
      for (const b of Object.values(planted)) {
        assert.equal(currentIds.has(b.beliefId), false, `T-C4-4: ${b.state} must never be current`);
      }
      // …and the current sections really are the confirmed ones
      const confirmed = knowledge.listCurrentBeliefs(
        knowledge.findKnowledgeBySubject("industry", sid)!.knowledgeId,
      ).map((b) => b.beliefId);
      assert.deepEqual(
        [...currentIds].sort(),
        confirmed.sort(),
        "T-C4-18: current sections == listCurrentBeliefs()",
      );
    } finally {
      db.close();
    }
  });

  test("T-C4-2: a lifecycle section is a VERBATIM passthrough of KnowledgeLine's 5 fields", async () => {
    const { db, knowledge, sid, planted } = await seed();
    try {
      const s = new ReportService(db.db).generateDossier(sid).sections;
      const line = s.revisedBeliefs[0]!;
      const soa = knowledge.getBelief(planted.revised.beliefId)!;

      assert.deepEqual(
        Object.keys(line).sort(),
        ["beliefId", "claimRef", "dimension", "sourceRef", "state"],
        "T-C4-2: exactly KnowledgeLine's existing fields — no invented ones",
      );
      assert.equal(line.beliefId, soa.beliefId);
      assert.equal(line.dimension, soa.dimension);
      assert.equal(line.state, soa.state);
      assert.equal(line.claimRef, soa.claimRef);
      assert.equal(line.sourceRef, soa.sourceRef);
      // a state label is NOT a relation chain (`historicalRelations` is deliberately absent)
      assert.equal("historicalRelations" in line, false, "I-C4-15: no relation chain smuggled in");
      assert.equal("createdAt" in line, false, "no timestamp extension");
    } finally {
      db.close();
    }
  });

  test("T-C4-5/6: deterministic ordering, and NO derived cognition counts anywhere", async () => {
    const { db, sid } = await seed();
    try {
      const svc = new ReportService(db.db);
      const a = svc.generateDossier(sid).sections;
      const b = svc.generateDossier(sid).sections;

      for (const key of ["pendingCandidates", "revisedBeliefs", "supersededBeliefs", "rejectedBeliefs", "conflictingBeliefs"] as const) {
        const list = a[key];
        const sorted = [...list].sort((x, y) =>
          x.dimension < y.dimension ? -1 : x.dimension > y.dimension ? 1 : x.beliefId < y.beliefId ? -1 : 1,
        );
        assert.deepEqual(list.map((l) => l.beliefId), sorted.map((l) => l.beliefId), `T-C4-5: ${key} order`);
        assert.deepEqual(list, b[key], `T-C4-5: ${key} is stable across regenerations`);
      }

      // T-C4-6: no aggregation/derived fields on ANY section
      const keys = Object.keys(a);
      for (const k of keys) {
        assert.ok(!/(Count|count|Rate|rate|Percent|percent|Score|score)$/.test(k), `T-C4-6: derived field ${k}`);
      }
      assert.deepEqual(
        keys.sort(),
        [
          "conflictHistory",
          "conflictingBeliefs",
          "conflicts",
          "currentKnowledge",
          "evaluation",
          "gaps",
          "keyFacts",
          "mainJudgments",
          "nextActions",
          "pendingCandidates",
          "priority",
          "recentChanges",
          "recentEvidence",
          "rejectedBeliefs",
          "revisedBeliefs",
          "state",
          "supersededBeliefs",
        ].sort(),
        "T-C4-6: the section set is exactly the contract's set",
      );
    } finally {
      db.close();
    }
  });

  test("T-C4-7/8/9: conflicts stay open-only; conflictHistory reads the SAME rows read-only", async () => {
    const { db, knowledge, sid } = await seed();
    try {
      const sections = new ReportService(db.db).generateDossier(sid).sections;

      assert.deepEqual(
        sections.conflicts.filter((c) => c.status !== "open"),
        [],
        "T-C4-7: `conflicts` carries NO resolved/accepted row",
      );
      assert.deepEqual(
        sections.conflictHistory.map((c) => [c.conflictId, c.status]).sort(),
        [
          ["kcf-c4a-accepted", "accepted"],
          ["kcf-c4a-resolved", "resolved"],
        ],
        "T-C4-7: conflictHistory is exactly the non-open rows",
      );

      // T-C4-8: tamper a row ⇒ Report FOLLOWS the persisted value (read, not recomputed)
      knowledge.resolveConflict("kcf-c4a-accepted", "accepted", new Date().toISOString());
      const before = dbFingerprint(db, ["report_snapshot"]);
      const after = new ReportService(db.db).generateDossier(sid).sections;
      assert.deepEqual(
        after.conflictHistory.map((c) => [c.conflictId, c.status]).sort(),
        sections.conflictHistory.map((c) => [c.conflictId, c.status]).sort(),
        "T-C4-8: still the persisted rows",
      );
      // T-C4-9: generating a Report changed NO knowledge_conflict row
      assert.equal(dbFingerprint(db, ["report_snapshot"]), before, "T-C4-9: upstream untouched");
      assert.equal(
        sections.conflicts.length + sections.conflictHistory.length,
        tableCount(db, "knowledge_conflict"),
        "T-C4-9: knowledge_conflict was only READ (section totals == persisted row count)",
      );
    } finally {
      db.close();
    }
  });

  test("T-C4-10/11: state is a read-through (tamper-following), and absent state stays null", async () => {
    const { db, repo, sid } = await seed();
    try {
      const svc = new ReportService(db.db);
      const persisted = repo.getStateBySubject("industry", sid)!;
      assert.deepEqual(svc.generateDossier(sid).sections.state, persisted, "T-C4-10: verbatim state");

      // tamper the persisted row ⇒ the Report follows it exactly
      repo.upsertState({ ...persisted, version: 99 });
      const after = svc.generateDossier(sid).sections.state!;
      assert.equal(after.version, 99, "T-C4-10: shows the PERSISTED version");
      assert.deepEqual(after, repo.getStateBySubject("industry", sid));

      // T-C4-11: no persisted state ⇒ null (never a fabricated zero object)
      db.db.prepare("DELETE FROM research_state WHERE subject_id = ?").run(sid);
      const noState = svc.generateDossier(sid).sections.state;
      assert.equal(noState, null, "T-C4-11: absent state is null — not a fabricated 0-value record");
    } finally {
      db.close();
    }
  });

  test("T-C4-12a: no progress / quality / maturity / next-best field exists", async () => {
    const { db, sid } = await seed();
    try {
      const sections = new ReportService(db.db).generateDossier(sid).sections;
      const serialized = JSON.stringify(sections);
      for (const banned of [
        "progressPercent",
        "completionRate",
        "researchProgress",
        "stagePercent",
        "researchQuality",
        "researchMaturity",
        "qualityScore",
        "nextBestAction",
      ]) {
        assert.equal(serialized.includes(banned), false, `T-C4-12a: ${banned} must not exist`);
        assert.ok(!(banned in sections), `T-C4-12a: sections must not declare ${banned}`);
      }
      // state carries the FACT of a version, not a ratio
      const st = sections.state!;
      assert.equal(typeof st.version, "number");
      assert.deepEqual(Object.keys(st).sort(), [
        "confirmed",
        "conflicting",
        "createdAt",
        "keyQuestionIds",
        "known",
        "nextActionIds",
        "researchGapIds",
        "stateId",
        "subjectId",
        "subjectKind",
        "uncertain",
        "unknown",
        "updatedAt",
        "version",
      ]);
    } finally {
      db.close();
    }
  });

  test("T-C4-14: generating a Report writes ONLY report_snapshot (upstream fingerprint identical)", async () => {
    const { db, sid } = await seed();
    try {
      const before = dbFingerprint(db, ["report_snapshot"]);
      const beforeDossiers = tableCount(db, "report_snapshot");
      new ReportService(db.db).generateDossier(sid);
      assert.equal(dbFingerprint(db, ["report_snapshot"]), before, "T-C4-14: all 23 upstream tables identical");
      assert.equal(tableCount(db, "report_snapshot"), beforeDossiers + 1, "only our projection grew by 1");
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// T-C4-13 ★ Layer 3 — real SQLite FILE + `methodology` 0 rows
// ---------------------------------------------------------------------------

describe("Phase C4-A · R1 zero-write (Layer 3: real SQLite, no methodology row)", () => {
  test("T-C4-13: with methodology = 0 rows, Report build writes NOTHING upstream and +1 snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tiancha-c4a-"));
    const dbPath = join(dir, "layer3.sqlite");
    try {
      const db = new ResearchDb({ path: dbPath }); // ★ a real SQLite FILE (not :memory:)
      const repo = new ResearchRepository(db.db);
      const artifacts = new SqliteArtifactStore({ path: join(dir, "artifacts.sqlite") });
      const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
      const res = await discovery.ingestMaterial({ materialText: "x", industryName: "C4-A Layer3" });
      const sid = res.industry.industryId;

      // ★ the precondition that makes R1 reachable: NO active methodology row at all
      db.db.prepare("DELETE FROM methodology").run();
      assert.equal(tableCount(db, "methodology"), 0, "precondition: methodology is empty");

      const beforeUpstream = dbFingerprint(db, ["report_snapshot"]);
      const beforeSnapshots = tableCount(db, "report_snapshot");
      const changesBefore = (db.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

      const dossier = new ReportService(db.db).generateDossier(sid);

      // the legal fallback is the frozen baseline version id — value unchanged, nothing persisted
      assert.equal(
        dossier.methodologyVersionId,
        METHODOLOGY_V1.versionId,
        "R1: the legal fallback is the frozen baseline version id (value unchanged)",
      );
      assert.equal(tableCount(db, "methodology"), 0, "T-C4-13: still ZERO methodology rows");
      assert.equal(
        dbFingerprint(db, ["report_snapshot"]),
        beforeUpstream,
        "T-C4-13: upstream SoT fingerprint BEFORE == AFTER",
      );
      assert.equal(tableCount(db, "report_snapshot"), beforeSnapshots + 1, "T-C4-13: snapshot +1");
      const changesAfter = (db.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
      assert.equal(changesAfter - changesBefore, 1, "T-C4-13: exactly ONE row change in the whole DB");

      // and no stray side-car journal files were left behind
      const files = readdirSync(dir).filter((f) => f.endsWith("-wal") || f.endsWith("-shm"));
      assert.deepEqual(files, [], "no -wal / -shm left behind");
      db.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        // a leftover temp dir is harmless — never fail this test over cleanup
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T-C4-15 — static production call-point audit
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "vendor" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("Phase C4-A · static boundary audit", () => {
  test("T-C4-15: rank() still has exactly ONE production caller (Report uses the read face)", () => {
    const files = [...walk(join(ROOT, "packages/research/src")), ...walk(join(ROOT, "src"))];
    const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");
    const rankCallers = files.filter((f) => /\.rank\(/.test(readFileSync(f, "utf8"))).map(rel).sort();
    assert.deepEqual(
      rankCallers,
      ["packages/research/src/application/knowledge-projection-service.ts"],
      "rank() must still have exactly one production caller (the S5 write path)",
    );
    // …and ReportService really goes through the read-only face
    const report = readFileSync(join(ROOT, "packages/research/src/application/report-service.ts"), "utf8");
    assert.ok(report.includes("currentPriorities("), "Report reads priorities via the read face");
    assert.ok(!/\.rank\(/.test(report), "Report never calls rank()");
    // ★ R1: the bootstrap-y getActive() must be gone from the Report path
    assert.ok(
      !/new MethodologyService\(repo\)\.getActive\(\)/.test(report),
      "R1: the Report path no longer bootstraps methodology",
    );
    assert.ok(report.includes("getActiveMethodology()"), "R1: it reads the active row directly");
  });
});
