/**
 * Phase B v1 · Step B1 — ChainTemplate / ResearchPosition / ResearchNeed derivation.
 *
 *   T-B1  a template (templateId, version) is immutable; a new version is allowed
 *   T-B2  projection produces positions with NO empty nodes (I-B1) and is idempotent
 *   T-B3  a template version change yields NEW refs and keeps the old rows (I-B7)
 *   T-B4  ResearchNeed is derived from read-only state (I-B6) and follows it
 *   T-B5  whyStudyNotJustFetch is drawn from the closed enum
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { ChainProjectionService } from "./application/chain-projection-service.js";
import { ResearchNeedService } from "./application/research-need-service.js";
import {
  CHAIN_TEMPLATE_GENERAL_V1,
  ChainTemplateRegistry,
  chainTemplates,
  type ChainTemplate,
} from "./domain/chain-template.js";
import { WHY_STUDY_REASONS, whyStudyNotJustFetch } from "./domain/research-need.js";
import type { GapType } from "./domain/index.js";

const INDUSTRY = "B1测试行业";

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  return { db, repo, artifacts, discovery, sid: res.industry.industryId };
}

/** Whole-state fingerprint of everything ResearchNeed must NOT touch (I-B6). */
function sotFingerprint(db: ResearchDb, repo: ResearchRepository, sid: string): string {
  const kr = new KnowledgeRepository(db.db);
  const k = kr.findKnowledgeBySubject("industry", sid);
  return JSON.stringify({
    requirements: repo.listRequirements(sid).map((r) => `${r.requirementId}:${r.importance}:${r.status}`).sort(),
    questions: repo.listQuestions(sid).map((q) => `${q.questionId}:${q.status}`).sort(),
    gaps: repo.listGaps(sid).map((g) => `${g.gapId}:${g.status}:${g.gapType}`).sort(),
    actions: repo.listNextActions(sid).map((a) => `${a.actionId}:${a.priority}`).sort(),
    slots: repo.listPoolSlots(sid).map((s) => `${s.dimension}:${s.status}`).sort(),
    beliefs: k ? kr.listBeliefs(k.knowledgeId).length : 0,
    stateVersion: repo.getStateBySubject("industry", sid)?.version ?? 0,
  });
}

describe("Phase B · Step B1", () => {
  test("T-B1: a template version is immutable; a new version is allowed", () => {
    const registry = new ChainTemplateRegistry();
    const v1: ChainTemplate = { templateId: "t-x", version: "v1", positions: [] };
    registry.register(v1);
    registry.register({ templateId: "t-x", version: "v1", positions: [] }); // identical -> ok

    assert.throws(
      () =>
        registry.register({
          templateId: "t-x",
          version: "v1",
          positions: [
            {
              key: "k",
              kind: "expert",
              label: "专家",
              whyImportant: "why",
              dimensionKeys: ["risk"],
              suggestedTargetKinds: ["行业专家"],
              suitableEvidenceKinds: [],
              limitations: [],
            },
          ],
        }),
      /immutable/,
      "same (templateId,version) with different content must throw",
    );

    // a NEW version is allowed
    registry.register({ templateId: "t-x", version: "v2", positions: [] });
    assert.ok(registry.get("t-x", "v2"));
    assert.ok(registry.get("t-x", "v1"));

    // the built-in general template ships registered
    assert.ok(chainTemplates.get("chain-template-general", "v1"), "general v1 is registered");
  });

  test("T-B2: projection has no empty nodes (I-B1) and is idempotent", async () => {
    const { db, repo, sid } = await setup();
    const svc = new ChainProjectionService(db.db);

    const first = svc.project(sid);
    assert.equal(first.positions.length, CHAIN_TEMPLATE_GENERAL_V1.positions.length);
    assert.equal(first.skipped.length, 0, "the general template covers all 12 dimensions");

    for (const p of first.positions) {
      assert.ok(p.whyImportant.trim().length > 0, "I-B1: whyImportant");
      assert.ok(
        p.answersQuestionRefs.length > 0 && p.satisfiesRequirementRefs.length > 0,
        "I-B1: references at least one Question/Requirement",
      );
      assert.match(p.positionRef, new RegExp(`^pos-${sid}-chain-template-general-v1-`));
      assert.equal(p.chainTemplateId, "chain-template-general");
      assert.equal(p.chainVersion, "v1");
      assert.ok(p.suggestedTargetKinds.length > 0, "建议研究哪类对象 must exist (type level)");
      assert.ok(p.importance > 0 && p.importance <= 1, "importance is derived and clamped");
    }

    // every requirement is served by at least one position
    for (const r of repo.listRequirements(sid)) {
      assert.ok(
        first.positions.some((p) => p.satisfiesRequirementRefs.includes(r.requirementId)),
        `requirement ${r.dimension} must be served by some position`,
      );
    }

    // idempotent: same refs, no duplicates
    const second = svc.project(sid);
    assert.deepEqual(
      second.positions.map((p) => p.positionRef),
      first.positions.map((p) => p.positionRef),
    );
    assert.equal(repo.listPositions(sid).length, first.positions.length, "no duplicate rows");
    db.close();
  });

  test("T-B2b: a position serving no requirement is SKIPPED, never written (I-B1)", async () => {
    const { db, repo, sid } = await setup();
    const orphan: ChainTemplate = {
      templateId: "chain-template-orphan",
      version: "v1",
      positions: [
        {
          key: "no_such_dimension",
          kind: "expert",
          label: "空节点",
          whyImportant: "why",
          dimensionKeys: ["dimension_that_does_not_exist"],
          suggestedTargetKinds: ["x"],
          suitableEvidenceKinds: [],
          limitations: [],
        },
      ],
    };
    const result = new ChainProjectionService(db.db, orphan).project(sid);
    assert.equal(result.positions.length, 0, "nothing written");
    assert.equal(result.skipped.length, 1, "but it is REPORTED, not silently dropped");
    assert.match(result.skipped[0].reason, /I-B1/);
    db.close();
  });

  test("T-B3: a template version change yields NEW refs and keeps the old rows (I-B7)", async () => {
    const { db, repo, sid } = await setup();
    new ChainProjectionService(db.db).project(sid);
    const v1Refs = repo.listPositions(sid).map((p) => p.positionRef);
    assert.ok(v1Refs.length > 0);

    const v2: ChainTemplate = { ...CHAIN_TEMPLATE_GENERAL_V1, version: "v2" };
    new ChainProjectionService(db.db, v2).project(sid);

    const allRefs = repo.listPositions(sid).map((p) => p.positionRef);
    assert.equal(allRefs.length, v1Refs.length * 2, "v1 rows kept AND v2 rows added");
    assert.ok(allRefs.some((r) => r.includes("-v2-")), "v2 refs carry the version");
    assert.ok(
      v1Refs.every((r) => allRefs.includes(r)),
      "the historical v1 positions were not rewritten",
    );
    db.close();
  });

  test("T-B4: ResearchNeed is derived from read-only state (I-B6) and follows it", async () => {
    const { db, repo, discovery, sid } = await setup();
    new ChainProjectionService(db.db).project(sid);
    const svc = new ResearchNeedService(db.db);

    const before = sotFingerprint(db, repo, sid);
    const needs = svc.list(sid);

    assert.equal(needs.length, 12);
    for (const n of needs) {
      const req = repo.getRequirement(n.requirementId)!;
      assert.equal(n.dimension, req.dimension, "dimension comes from the requirement");
      assert.equal(n.question, req.description, "the question is the requirement's, not newly authored");
      assert.equal(n.needId, n.gapId);
      assert.ok(n.suggestedPositionRefs.length > 0, "every need points at >=1 position");
      assert.equal(typeof n.priorityScore, "number");
    }
    // ordered by S5 priority (read-only face)
    for (let i = 1; i < needs.length; i++) {
      assert.ok(needs[i - 1].priorityScore >= needs[i].priorityScore, "priority desc");
    }
    // I-B6: deriving changed NOTHING
    assert.equal(sotFingerprint(db, repo, sid), before, "ResearchNeed derivation must not write");

    // ...and it FOLLOWS the state: resolving a gap removes its need
    await discovery.ingestClaims({
      subjectKind: "industry",
      subjectId: sid,
      claims: [{ statement: "market ok", dimension: "market", sourceRef: "s1" }],
    });
    const after = svc.list(sid);
    assert.equal(after.length, 11, "the resolved gap's need disappeared");
    assert.equal(after.some((n) => n.dimension === "market"), false);
    db.close();
  });

  test("T-B5: whyStudyNotJustFetch is drawn from the closed enum", () => {
    const allowed = new Set<string>(WHY_STUDY_REASONS);
    const combos: Array<[GapType, boolean]> = [
      ["unknown", true],
      ["unknown", false],
      ["insufficient", true],
      ["insufficient", false],
      ["conflict", true],
      ["conflict", false],
    ];
    for (const [gapType, firstHand] of combos) {
      const reason = whyStudyNotJustFetch(gapType, firstHand);
      assert.ok(allowed.has(reason), `${gapType}/${firstHand} -> "${reason}" must be in the enum`);
    }
    // the mapping actually distinguishes the meaningful cases
    assert.notEqual(whyStudyNotJustFetch("conflict", true), whyStudyNotJustFetch("unknown", true));
    assert.notEqual(whyStudyNotJustFetch("unknown", true), whyStudyNotJustFetch("unknown", false));
    assert.notEqual(whyStudyNotJustFetch("insufficient", true), whyStudyNotJustFetch("insufficient", false));
  });
});
