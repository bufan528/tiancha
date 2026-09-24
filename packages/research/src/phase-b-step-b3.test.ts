/**
 * Phase B v1 · Step B3 — QuestionTargetFit.
 *
 *   T-B13  the fit rule is deterministic and model-free (targetKind × dimension)
 *   T-B14  fitReason is required and rule-derived
 *   T-B15  weak/none on an IMPORTANT question ⇒ requiresFallback + reason (no silent downgrade)
 *   T-B16  Fit writes nothing (no SoT change, no table)
 *   T-B17  traceability: evidenceBasisRefs explain the judgement
 *   +      B3 never creates or selects a fallback target
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
import { TargetService } from "./application/target-service.js";
import { QuestionTargetFitService } from "./application/question-target-fit-service.js";
import {
  FIT_REASONS,
  IMPORTANT_QUESTION_MIN_IMPORTANCE,
  evaluateFit,
  type FitInput,
} from "./domain/question-target-fit.js";

const INDUSTRY = "B3测试行业";

async function setupWithTarget() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  const position = new ChainProjectionService(db.db).project(sid).positions.find((p) => p.kind === "customer")!;
  const target = new TargetService(db.db).add({
    industryId: sid,
    subjectKey: "XX客户",
    targetKind: position.suggestedTargetKinds[0]!,
    positionRef: position.positionRef,
    researchPurpose: "验证采购意愿",
    selectionReason: "行业头部采购方",
  });
  return { db, repo, sid, positionRef: position.positionRef, targetRef: target.targetRef };
}

function sotFingerprint(db: ResearchDb, repo: ResearchRepository, sid: string): string {
  const kr = new KnowledgeRepository(db.db);
  const k = kr.findKnowledgeBySubject("industry", sid);
  return JSON.stringify({
    requirements: repo.listRequirements(sid).map((r) => `${r.requirementId}:${r.importance}:${r.status}`).sort(),
    questions: repo.listQuestions(sid).map((q) => `${q.questionId}:${q.status}`).sort(),
    gaps: repo.listGaps(sid).map((g) => `${g.gapId}:${g.status}`).sort(),
    actions: repo.listNextActions(sid).map((a) => `${a.actionId}:${a.priority}`).sort(),
    beliefs: k ? kr.listBeliefs(k.knowledgeId).length : 0,
    stateVersion: repo.getStateBySubject("industry", sid)?.version ?? 0,
  });
}

// ---- domain rule (fully controllable inputs) --------------------------------

const POSITION = {
  positionRef: "pos-p",
  satisfiesRequirementRefs: ["ir-market"],
  suggestedTargetKinds: ["头部客户"],
  suitableEvidenceKinds: ["采购意愿"],
  limitations: [],
};
const q = (requirementId: string, dimension: string, importance = 3) => ({ requirementId, dimension, importance });
const t = (kind: string, isFallback = false) => ({
  targetRef: "tgt-x",
  targetKind: kind,
  isFallback,
  limitations: [],
});

describe("Phase B · Step B3 — the fit rule", () => {
  test("T-B13: deterministic and model-free", () => {
    const input: FitInput = { target: t("头部客户"), position: POSITION, question: q("ir-market", "market") };
    const first = evaluateFit(input);
    const second = evaluateFit(input);
    assert.deepEqual(second, first, "same input -> same judgement");

    const src = evaluateFit.toString();
    assert.ok(
      !/openai|anthropic|generateText|fetch\(|llm|model\(/i.test(src),
      "the rule contains no model/network call",
    );
  });

  test("T-B13b: answerability follows targetKind × served-question, downgrading on an explicit signal", () => {
    // kind matches AND the position serves this question
    assert.equal(
      evaluateFit({ target: t("头部客户"), position: POSITION, question: q("ir-market", "market") }).answerability,
      "strong",
    );
    // kind matches, but the position does not serve this question
    assert.equal(
      evaluateFit({ target: t("头部客户"), position: POSITION, question: q("ir-risk", "risk") }).answerability,
      "partial",
    );
    // the position serves the question, but the kind does not match
    assert.equal(
      evaluateFit({ target: t("其他类型"), position: POSITION, question: q("ir-market", "market") }).answerability,
      "partial",
    );
    // neither matches, but the position can still provide evidence
    assert.equal(
      evaluateFit({ target: t("其他类型"), position: POSITION, question: q("ir-risk", "risk") }).answerability,
      "weak",
    );
    // neither matches and the position provides nothing
    const noEvidence = { ...POSITION, suitableEvidenceKinds: [] };
    assert.equal(
      evaluateFit({ target: t("其他类型"), position: noEvidence, question: q("ir-risk", "risk") }).answerability,
      "none",
    );
    // a fallback SOURCE is deterministically one step lower
    assert.equal(
      evaluateFit({ target: t("头部客户", true), position: POSITION, question: q("ir-market", "market") }).answerability,
      "partial",
    );
  });

  test("T-B14: fitReason is required and rule-derived", () => {
    const evaluation = evaluateFit({ target: t("其他类型"), position: POSITION, question: q("ir-risk", "risk") });
    assert.ok(evaluation.fitReason.length > 0);
    assert.ok(
      FIT_REASONS.some((reason) => evaluation.fitReason.startsWith(reason)),
      `"${evaluation.fitReason}" must start from one of the closed rule phrases`,
    );

    const downgraded = evaluateFit({
      target: t("头部客户", true),
      position: POSITION,
      question: q("ir-market", "market"),
    });
    assert.ok(FIT_REASONS.some((reason) => downgraded.fitReason.startsWith(reason)));
    assert.match(downgraded.fitReason, /备选来源/, "a downgrade explains itself");
  });

  test("T-B15: weak/none on an IMPORTANT question requires a fallback — never a silent downgrade", () => {
    const weak = (importance: number) =>
      evaluateFit({ target: t("其他类型"), position: POSITION, question: q("ir-risk", "risk", importance) });

    const low = weak(IMPORTANT_QUESTION_MIN_IMPORTANCE - 1);
    assert.equal(low.answerability, "weak");
    assert.equal(low.requiresFallback, false, "a low-importance weak question needs no fallback");

    const high = weak(IMPORTANT_QUESTION_MIN_IMPORTANCE);
    assert.equal(high.requiresFallback, true);
    assert.ok(high.fallbackReason && high.fallbackReason.length > 0, "the need is explained");

    // a strong fit never asks for a fallback, however important the question
    const strong = evaluateFit({ target: t("头部客户"), position: POSITION, question: q("ir-market", "market", 5) });
    assert.equal(strong.requiresFallback, false);
  });
});

// ---- service over the real pipeline ----------------------------------------

describe("Phase B · Step B3 — over the real pipeline", () => {
  test("T-B17: every fit explains itself (traceability)", async () => {
    const { db, positionRef, targetRef } = await setupWithTarget();
    const fits = new QuestionTargetFitService(db.db).fitAll(targetRef);

    assert.equal(fits.length, 12, "one fit per question (requirement)");
    for (const fit of fits) {
      assert.match(fit.fitRef, /^fit-tgt-/);
      assert.ok(fit.fitReason.length > 0, "fitReason is always present");
      assert.ok(fit.evidenceBasisRefs.includes(`position:${positionRef}`), "cites the position");
      assert.ok(fit.evidenceBasisRefs.some((r) => r.startsWith("dimension:")), "cites the dimension");
      assert.ok(fit.evidenceBasisRefs.some((r) => r.startsWith("targetKind:")), "cites the target kind");
      assert.equal(fit.canAnswer, fit.answerability !== "none");
    }
    db.close();
  });

  test("T-B16: Fit writes nothing — no SoT change, no table", async () => {
    const { db, repo, sid, targetRef } = await setupWithTarget();
    const service = new QuestionTargetFitService(db.db);
    const before = sotFingerprint(db, repo, sid);

    service.fitAll(targetRef);
    service.fitAll(targetRef);
    service.fallbackRequirements(targetRef);

    assert.equal(sotFingerprint(db, repo, sid), before, "the explanation layer changes no state");
    const tables = (db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    assert.ok(!tables.some((t) => /fit/i.test(t)), "Fit has no table (it is derived)");
    db.close();
  });

  test("B3 red line: fitting never creates or selects a target", async () => {
    const { db, repo, sid, targetRef } = await setupWithTarget();
    const service = new QuestionTargetFitService(db.db);
    const before = repo.listTargets(sid).length;

    const needs = service.fallbackRequirements(targetRef);
    assert.ok(needs.every((f) => f.requiresFallback && f.fallbackReason !== null));
    assert.equal(repo.listTargets(sid).length, before, "no fallback target was created");

    // and the service can never write one
    assert.ok(!/upsertTarget|targetRefFor|TargetService/.test(QuestionTargetFitService.prototype.fitAll.toString()));
    assert.ok(!/upsertTarget|targetRefFor/.test(QuestionTargetFitService.prototype.fit.toString()));
    db.close();
  });

  test("a fallback target is uniformly downgraded and may raise a fallback need", async () => {
    const { db, repo, sid, positionRef } = await setupWithTarget();
    const repoService = new TargetService(db.db);
    const primary = repo.listTargets(sid)[0]!;
    const fallback = repoService.add({
      industryId: sid,
      subjectKey: "XX备选客户",
      targetKind: primary.targetKind,
      positionRef,
      researchPurpose: "p",
      selectionReason: "r",
      isFallback: true,
      fallbackForTargetRef: primary.targetRef,
      limitations: ["联系难度高"],
    });

    const fits = new QuestionTargetFitService(db.db);
    const primaryFits = new Map(fits.fitAll(primary.targetRef).map((f) => [f.questionRef, f]));
    for (const fit of fits.fitAll(fallback.targetRef)) {
      const primaryFit = primaryFits.get(fit.questionRef)!;
      assert.notEqual(fit.answerability, "strong", "a fallback is never a strong fit");
      assert.ok(
        ["partial", "weak", "none"].includes(fit.answerability),
        "a fallback is at least one step lower",
      );
      assert.ok(fit.limitations.includes("联系难度高"), "its own limitations travel with the fit");
      assert.match(fit.fitReason, /备选来源/);
      void primaryFit;
    }
    db.close();
  });
});
