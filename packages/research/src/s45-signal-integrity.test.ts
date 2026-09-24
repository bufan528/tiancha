/**
 * S4.5 — Research Signal Integrity acceptance.
 *
 * A. Gap / Pool signal recovery:
 *    A1 gap_type persisted (unknown / insufficient / conflict)
 *    A2 gaps are NOT constantly open (a sufficient slot closes its gap)
 *    A3 `sufficient` is genuinely reachable
 *    A4 open -> resolved
 *    A5 resolved -> RE-OPENED when the slot degrades again (same id, same discoveredAt)
 *    A6 `conflicting` recovers to a non-sticky status
 *    A7 gap identity stays `gap-<requirementId>`
 *    A8 reconcile is idempotent
 *
 * B. Minimum business reachability — EvaluationService is not an orphan:
 *    Material/Claim -> Knowledge/Pool -> Gap -> Evaluation (stops BEFORE Priority).
 *
 * C. Policy provenance — an evaluation records the EXACT immutable policy versions
 *    it was computed with, and policy versions cannot silently change meaning.
 *
 * Explicitly OUT of scope (S5): PriorityService / ResearchPriority / priorities.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { KnowledgeProjectionService } from "./application/knowledge-projection-service.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { EvaluationService } from "./application/evaluation-service.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import {
  AGGREGATION_POLICY_V1,
  EVALUATION_POLICY_V1,
  aggregationPolicies,
  evaluationPolicies,
} from "./domain/evaluation-policy.js";
import { SUFFICIENCY_POLICY_V1, sufficiencyPolicies, type SufficiencyPolicy } from "./domain/sufficiency.js";
import type { Claim, DimensionEvaluation, InformationPoolSlot, InformationRequirement } from "./domain/index.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const svc = new KnowledgeProjectionService(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  return { db, repo, svc, artifacts };
}

const NOW = "2026-01-01T00:00:00.000Z";

function mkSlot(subjectId: string, dimension: string, status: InformationPoolSlot["status"]): InformationPoolSlot {
  return {
    slotId: `slot-${subjectId}-${dimension}`,
    subjectKind: "industry",
    subjectId,
    dimension,
    status,
    coverageJudgement: "test",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkClaim(subjectId: string): Claim {
  return {
    claimId: randomUUID(),
    statement: "x",
    claimType: "descriptive",
    provenance: "analyst",
    conflictOfInterest: false,
    factIds: [],
    evidenceIds: [],
    subjectKind: "industry",
    subjectId,
    temporalRelation: "current",
    isRealExternalData: true,
  };
}

function mkReq(subjectId: string, dimension: string, importance = 3): InformationRequirement {
  return {
    requirementId: `ir-${subjectId}-${dimension}`,
    questionId: `q-${subjectId}-${dimension}`,
    subjectKind: "industry",
    subjectId,
    dimension,
    description: "needs " + dimension,
    importance,
    requiredEvidenceType: "text",
    sufficiencyPolicyRef: SUFFICIENCY_POLICY_V1.versionId,
    confirmedCondition: "c",
    uncertainCondition: "u",
    unknownCondition: "n",
    preferredPositionKinds: [],
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("S4.5-A: Gap lifecycle", () => {
  test("A1/A2/A4: open while un-met, resolved once sufficient, row kept", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    const req = mkReq(subj, "market");
    repo.upsertRequirement(req);
    repo.upsertPoolSlot(mkSlot(subj, "market", "unknown"));

    svc.refreshGaps(subj, "industry");
    let gap = repo.listGaps(subj)[0];
    assert.equal(gap.status, "open", "A2: not constantly resolved");
    assert.equal(gap.gapType, "unknown", "A1: gap_type persisted");

    // satisfy the slot -> gap closes but the ROW survives
    repo.upsertPoolSlot({ ...mkSlot(subj, "market", "sufficient") });
    svc.refreshGaps(subj, "industry");
    const after = repo.listGaps(subj);
    assert.equal(after.length, 1, "A4: row kept, not deleted");
    assert.equal(after[0].status, "resolved");
    assert.equal(repo.getRequirement(req.requirementId)!.status, "met");
  });

  test("A1: gap type distinguishes unknown / insufficient / conflict", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    for (const [dim, imp] of [
      ["market", 5],
      ["demand", 4],
      ["risk", 5],
    ] as const) {
      repo.upsertRequirement(mkReq(subj, dim, imp));
    }
    repo.upsertPoolSlot(mkSlot(subj, "market", "unknown"));
    repo.upsertPoolSlot(mkSlot(subj, "demand", "partial"));
    repo.upsertPoolSlot(mkSlot(subj, "risk", "conflicting"));

    svc.refreshGaps(subj, "industry");
    const byReq = new Map(repo.listGaps(subj).map((g) => [g.relatedRequirementIds[0], g]));
    assert.equal(byReq.get(`ir-${subj}-market`)!.gapType, "unknown");
    assert.equal(byReq.get(`ir-${subj}-demand`)!.gapType, "insufficient");
    assert.equal(byReq.get(`ir-${subj}-risk`)!.gapType, "conflict");
  });

  test("A5: a resolved gap RE-OPENS when its slot degrades, keeping id + discoveredAt", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertRequirement(mkReq(subj, "technology"));
    repo.upsertPoolSlot(mkSlot(subj, "technology", "unknown"));
    svc.refreshGaps(subj, "industry");
    const opened = repo.listGaps(subj)[0];

    repo.upsertPoolSlot({ ...mkSlot(subj, "technology", "sufficient") });
    svc.refreshGaps(subj, "industry");
    assert.equal(repo.listGaps(subj)[0].status, "resolved");

    // degrade again -> reopened as an open gap, SAME identity and first-seen time
    repo.upsertPoolSlot({ ...mkSlot(subj, "technology", "partial") });
    svc.refreshGaps(subj, "industry");
    const reopened = repo.listGaps(subj)[0];
    assert.equal(reopened.status, "open", "A5: reopened");
    assert.equal(reopened.gapType, "insufficient");
    assert.equal(reopened.gapId, opened.gapId, "A7: same gap identity");
    assert.equal(reopened.discoveredAt, opened.discoveredAt, "first-seen time preserved");
  });

  test("A6: `conflicting` recovers — never permanently sticky", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "supply", "conflicting"));
    svc.reconcilePool(subj, "industry");
    assert.equal(repo.getPoolSlot(`slot-${subj}-supply`)!.status, "unknown", "A6: fell back");
  });

  test("A8: repeated reconcile is idempotent (no new gaps/items, same status)", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertRequirement(mkReq(subj, "market"));
    repo.upsertPoolSlot(mkSlot(subj, "market", "unknown"));
    svc.refreshSubject(subj, "industry");
    const first = { gaps: repo.listGaps(subj), slots: repo.listPoolSlots(subj), items: repo.listPoolItems(`slot-${subj}-market`) };
    svc.refreshSubject(subj, "industry");
    svc.refreshSubject(subj, "industry");
    assert.equal(repo.listGaps(subj).length, first.gaps.length);
    assert.equal(repo.listPoolSlots(subj).length, first.slots.length);
    assert.deepEqual(
      repo.listPoolItems(`slot-${subj}-market`).map((i) => i.itemId),
      first.items.map((i) => i.itemId),
    );
    assert.equal(repo.listGaps(subj)[0].gapId, first.gaps[0].gapId, "A7: stable id");
  });
});

describe("S4.5-B: minimum business reachability (Evaluation is not an orphan)", () => {
  test("Material/Claim -> Knowledge/Pool -> Gap -> Evaluation runs end to end", async () => {
    const { db, repo, svc, artifacts } = setup();
    const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);

    // ingest builds the skeleton (Echo placeholder -> nothing enters Knowledge/Pool)
    const res = await discovery.ingestMaterial({ materialText: "x", industryName: "人形机器人" });
    const sid = res.industry.industryId;
    assert.equal(repo.listPoolSlots(sid).every((s) => s.status === "unknown"), true);
    assert.equal(repo.listGaps(sid).filter((g) => g.status === "open").length, 12);

    // real backfill on one dimension -> Knowledge -> Pool sufficient -> gap resolved
    await discovery.ingestClaims({
      subjectKind: "industry",
      subjectId: sid,
      claims: [{ statement: "market real", dimension: "market", confidence: 0.8, sourceRef: "src-real-1" }],
    });
    assert.equal(repo.getPoolSlot(`slot-${sid}-market`)!.status, "sufficient");
    const marketGap = repo.listGaps(sid).find((g) => g.gapId === `gap-ir-${sid}-market`)!;
    assert.equal(marketGap.status, "resolved");
    assert.equal(repo.listGaps(sid).filter((g) => g.status === "open").length, 11);

    // EvaluationService runs on the SAME real chain (not an isolated unit)
    const evaluation = new EvaluationService(db.db).evaluate("industry", sid);
    const market = evaluation.dimensionEvaluations.find((d) => d.dimension === "market")!;
    assert.equal(market.status, "evaluated");
    assert.equal(typeof market.score, "number");
    // the backfilled dimension is evidence-driven; untouched dims stay insufficient
    assert.equal(evaluation.coverage.evaluated, 1);
    assert.equal(evaluation.coverage.insufficient, 11);
    assert.equal(evaluation.decision.decisionStatus, "pending", "critical dims unmet -> pending");
    // persisted and readable back
    assert.equal(repo.getLatestEvaluation("industry", sid)!.evaluationId, evaluation.evaluationId);
  });
});

describe("S4.5-C: policy provenance", () => {
  test("an evaluation records the exact methodology + policy versions used", async () => {
    const { db, repo, artifacts } = setup();
    const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await discovery.ingestMaterial({ materialText: "x", industryName: "固态电池" });

    const evaluation = new EvaluationService(db.db).evaluate("industry", res.industry.industryId);
    assert.ok(evaluation.methodologyVersionId, "methodology version recorded");
    assert.equal(evaluation.evaluationPolicyVersionId, EVALUATION_POLICY_V1.versionId);
    assert.equal(evaluation.aggregationPolicyVersionId, AGGREGATION_POLICY_V1.versionId);
    // the recorded versions are resolvable to the exact rules (immutable registry)
    assert.equal(evaluationPolicies.get(evaluation.evaluationPolicyVersionId)!.scoreScale, "0-100");
    assert.equal(aggregationPolicies.get(evaluation.aggregationPolicyVersionId)!.rules.length, 7);
  });

  test("policy versions are immutable: same versionId + different content throws", () => {
    // re-registering identical content is a no-op (idempotent import)
    evaluationPolicies.register(EVALUATION_POLICY_V1);
    sufficiencyPolicies.register(SUFFICIENCY_POLICY_V1);

    // changing a rule under the SAME versionId must be refused
    assert.throws(
      () => evaluationPolicies.register({ ...EVALUATION_POLICY_V1, scoreScale: "0-10" }),
      /immutable/,
    );
    assert.throws(
      () => sufficiencyPolicies.register({ ...SUFFICIENCY_POLICY_V1, minIndependentSources: 3 }),
      /immutable/,
    );
    assert.throws(
      () => aggregationPolicies.register({ ...AGGREGATION_POLICY_V1, rules: [] }),
      /immutable/,
    );
  });

  test("AggregationRule.weight actually participates in the decision (was decorative)", () => {
    const evaluated: DimensionEvaluation[] = Array.from({ length: 12 }, (_, i) => ({
      dimension: `d${i}`,
      status: "evaluated",
      score: 100,
      rationale: "",
      evidenceRefs: [],
      sufficiency: { itemCount: 1, independentSources: 1, firstHand: false },
    }));
    const aggregation = { sevenDimScores: { a: 100, b: 0 } as Record<string, number | null> };

    // weight all on the 100-scoring dim -> high score -> reserve
    const weightedHigh = EVALUATION_POLICY_V1.decision({
      dimensionEvaluations: evaluated,
      aggregation,
      criticalFlags: {},
      sevenDimWeights: { a: 1, b: 0 },
    });
    assert.equal(weightedHigh.decisionStatus, "reserve", "weighted 100 should reserve");

    // weight all on the 0-scoring dim -> low score -> park (a plain average would say 50/watch)
    const weightedLow = EVALUATION_POLICY_V1.decision({
      dimensionEvaluations: evaluated,
      aggregation,
      criticalFlags: {},
      sevenDimWeights: { a: 0, b: 1 },
    });
    assert.equal(weightedLow.decisionStatus, "park", "weighted 0 should park");
  });
});

describe("S4.5-R1: the Pool's sufficiency policy is resolved FROM the Requirement", () => {
  const STRICT_V2: SufficiencyPolicy = {
    policyId: "sufficiency",
    versionId: "suf-v2-strict",
    minItems: 2,
    minIndependentSources: 1,
    requiresFirstHand: false,
  };

  test("conflict recovery: conflict clears while confirmed support remains -> re-judged by policy", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertRequirement(mkReq(subj, "demand"));
    repo.upsertPoolSlot(mkSlot(subj, "demand", "unknown"));

    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand", sourceRef: "src-a" });
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand", sourceRef: "src-b" });
    const k = svc.repository().findKnowledgeBySubject("industry", subj)!;
    assert.equal(k.beliefs.length, 2);

    // open a conflict over the two (already confirmed) beliefs
    const conflictId = "kcf-" + randomUUID();
    svc.repository().insertConflict({
      conflictId,
      claimARef: k.beliefs[0].claimRef,
      claimBRef: k.beliefs[1].claimRef,
      dimension: "demand",
      status: "open",
      createdAt: NOW,
    });

    svc.reconcilePool(subj, "industry");
    assert.equal(repo.getPoolSlot(`slot-${subj}-demand`)!.status, "conflicting");

    // the conflict goes away -> the slot must be RE-JUDGED by policy, not stay conflicting
    svc.repository().resolveConflict(conflictId, "resolved", NOW);
    svc.reconcilePool(subj, "industry");
    assert.equal(repo.getPoolSlot(`slot-${subj}-demand`)!.status, "sufficient");
  });

  test("the VERSION comes from the requirement: same facts, v1 -> sufficient, strict v2 -> partial", () => {
    sufficiencyPolicies.register(STRICT_V2);
    const { repo, svc } = setup();

    // one confirmed claim satisfies v1 (minItems 1) …
    const subjV1 = "ind-" + randomUUID();
    repo.upsertRequirement(mkReq(subjV1, "market")); // suf-v1
    repo.upsertPoolSlot(mkSlot(subjV1, "market", "unknown"));
    svc.projectFromClaim({ claim: mkClaim(subjV1), dimension: "market" });
    svc.reconcilePool(subjV1, "industry");
    assert.equal(repo.getPoolSlot(`slot-${subjV1}-market`)!.status, "sufficient");

    // … but NOT the stricter v2 the other requirement names
    const subjV2 = "ind-" + randomUUID();
    repo.upsertRequirement({ ...mkReq(subjV2, "market"), sufficiencyPolicyRef: STRICT_V2.versionId });
    repo.upsertPoolSlot(mkSlot(subjV2, "market", "unknown"));
    svc.projectFromClaim({ claim: mkClaim(subjV2), dimension: "market" });
    svc.reconcilePool(subjV2, "industry");
    assert.equal(repo.getPoolSlot(`slot-${subjV2}-market`)!.status, "partial");
  });

  test("an unknown policy version is an explicit error (no silent fallback)", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertRequirement({ ...mkReq(subj, "market"), sufficiencyPolicyRef: "suf-does-not-exist" });
    repo.upsertPoolSlot(mkSlot(subj, "market", "unknown"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    assert.throws(() => svc.reconcilePool(subj, "industry"), /unknown sufficiency policy version/);
  });

  test("a requirement with no ref is an explicit error (migration must pin it)", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertRequirement({ ...mkReq(subj, "market"), sufficiencyPolicyRef: undefined });
    repo.upsertPoolSlot(mkSlot(subj, "market", "unknown"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    assert.throws(() => svc.reconcilePool(subj, "industry"), /has no sufficiencyPolicyRef/);
  });
});
