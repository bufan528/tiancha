/**
 * S4: EvaluationService — four-face model acceptance.
 *
 *   T-A5 insufficient evidence => NO score (never a silent 0/low)
 *   T-A6 four faces present (coverage / sufficiency / criticalFlags / decision)
 *   T-A7 a critical dimension with insufficient evidence BLOCKS a "reserve"
 *   plus: conflicting => no score; 12→7 aggregation keeps exit_env null;
 *         `insufficient_evidence` maps to decision `pending`, never to a decision status.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { EvaluationService } from "./application/evaluation-service.js";
import { METHODOLOGY_V1 } from "./methodology/methodology-v1.js";
import { poolSlotKey } from "./domain/identity.js";
import type { InformationPoolSlot, MethodologyDimension } from "./domain/index.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const svc = new EvaluationService(db.db);
  return { db, repo, svc };
}

function dim(key: string): MethodologyDimension {
  return METHODOLOGY_V1.dimensions.find((d) => d.key === key)!;
}

function addSlot(repo: ResearchRepository, sid: string, dimension: string, status: InformationPoolSlot["status"]): void {
  repo.upsertPoolSlot({
    slotId: poolSlotKey(sid, dimension),
    subjectKind: "industry",
    subjectId: sid,
    dimension,
    status,
    coverageJudgement: "t",
    createdAt: "t0",
    updatedAt: "t0",
  });
}

function addItem(
  repo: ResearchRepository,
  sid: string,
  dimension: string,
  claimRef: string,
  relation: "consistent" | "contradicts" = "consistent",
  sourceRef?: string,
): void {
  const slotId = poolSlotKey(sid, dimension);
  repo.upsertPoolItem({
    itemId: `item-${slotId}-${claimRef}`,
    slotId,
    valueText: claimRef,
    claimRef,
    sourceRef,
    relation,
    createdAt: "t0",
  });
}

const SID = "ind-s4";

describe("S4 EvaluationService (four faces)", () => {
  test("insufficient evidence => status=insufficient_evidence and NO score (T-A5)", () => {
    const { svc } = setup();
    const ev = svc.evaluateDimension(SID, dim("market"));
    assert.equal(ev.status, "insufficient_evidence");
    assert.equal(ev.score, undefined, "no score when evidence is insufficient");
  });

  test("sufficient evidence => evaluated, and a score IS attached", () => {
    const { repo, svc } = setup();
    addSlot(repo, SID, "market", "partial");
    addItem(repo, SID, "market", "artifact:claim/c1");
    const ev = svc.evaluateDimension(SID, dim("market"));
    assert.equal(ev.status, "evaluated");
    assert.equal(typeof ev.score, "number");
    assert.equal(ev.scoreScale, "0-100");
  });

  test("conflicting => NO score, both sides listed (never a silent normal score)", () => {
    const { repo, svc } = setup();
    addSlot(repo, SID, "demand", "conflicting");
    addItem(repo, SID, "demand", "artifact:claim/a", "contradicts");
    addItem(repo, SID, "demand", "artifact:claim/b", "contradicts");
    const ev = svc.evaluateDimension(SID, dim("demand"));
    assert.equal(ev.status, "conflicting");
    assert.equal(ev.score, undefined);
    assert.equal(ev.conflictingClaimRefs?.length, 2);
  });

  test("T-A6 four faces present + T-A7 critical blocks reserve + exit_env stays null", () => {
    const { repo, svc } = setup();
    // everything except `risk` (critical) is well evidenced
    for (const d of METHODOLOGY_V1.dimensions) {
      if (d.key === "risk") continue;
      addSlot(repo, SID, d.key, "partial");
      addItem(repo, SID, d.key, `artifact:claim/${d.key}`);
    }

    const evaluation = svc.evaluate("industry", SID);

    // T-A6: four faces
    assert.equal(evaluation.coverage.total, 12);
    assert.equal(
      evaluation.coverage.evaluated +
        evaluation.coverage.insufficient +
        evaluation.coverage.conflicting +
        evaluation.coverage.notApplicable,
      12,
    );
    assert.ok(evaluation.sufficiencySummary);
    assert.equal(typeof evaluation.sufficiencySummary.minIndependentSources, "number");
    assert.ok(evaluation.decision.decisionReason.length > 0);

    // T-A7: the critical dimension is insufficient => decision MUST be pending, not reserve
    assert.equal(evaluation.criticalFlags["risk"], false, "risk critical flag = insufficient");
    assert.equal(evaluation.decision.decisionStatus, "pending");
    assert.match(evaluation.decision.decisionReason, /关键维度/);

    // aggregation keeps the unmapped 7-dim as null (never faked)
    assert.equal(evaluation.aggregation.sevenDimScores["exit_env"], null);

    // persisted
    const loaded = repo.getLatestEvaluation("industry", SID)!;
    assert.equal(loaded.evaluationId, evaluation.evaluationId);
    assert.deepEqual(loaded.decision, evaluation.decision);
  });

  test("all dimensions (incl. critical) sufficient => decision can be reserve", () => {
    const { repo, svc } = setup();
    const sid = "ind-s4-ok";
    for (const d of METHODOLOGY_V1.dimensions) {
      addSlot(repo, sid, d.key, "partial");
      // two independent sources => score 80 under the v1 rule
      addItem(repo, sid, d.key, `artifact:claim/${d.key}-1`, "consistent", "src-1");
      addItem(repo, sid, d.key, `artifact:claim/${d.key}-2`, "consistent", "src-2");
    }
    const evaluation = svc.evaluate("industry", sid);
    assert.equal(evaluation.criticalFlags["risk"], true);
    assert.equal(evaluation.criticalFlags["key_validation"], true);
    assert.equal(evaluation.decision.decisionStatus, "reserve");
    assert.equal(evaluation.coverage.evaluated, 12);
  });

  test("`insufficient_evidence` is an EVALUATION status; the decision for it is `pending`", () => {
    const { svc } = setup();
    const evaluation = svc.evaluate("industry", "ind-s4-empty");
    assert.equal(evaluation.coverage.insufficient, 12);
    assert.equal(evaluation.decision.decisionStatus, "pending");
    // the decision enum must never contain the evaluation status word
    assert.notEqual(evaluation.decision.decisionStatus as string, "insufficient_evidence");
    // no evaluated dimension => no aggregated score anywhere
    for (const v of Object.values(evaluation.aggregation.sevenDimScores)) assert.equal(v, null);
  });

  test("face ① is an independent method: assessEvidence judges but NEVER scores", () => {
    const { repo, svc } = setup();
    addSlot(repo, SID, "market", "partial");
    addItem(repo, SID, "market", "artifact:claim/c1");

    const assessment = svc.assessEvidence(SID, dim("market"));
    assert.equal(assessment.status, "evaluated");
    assert.equal((assessment as unknown as { score?: number }).score, undefined, "no score on face ①");
    assert.equal(assessment.evidenceRefs.length, 1);
    assert.equal(assessment.sufficiency.itemCount, 1);
  });
});
