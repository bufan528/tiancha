/**
 * Phase C2 · Step 1 — DiligenceQuestion identity + lifecycle.
 *
 * Authorized scope (C2 Implementation Authorization, first stage): stable identity /
 * canonical ref / current-retired / revival / firstAskedAt / current-derived outputs.
 * Nothing else (no Knowledge write, no Experience, no Report, no Target write, no new table).
 *
 * A  first creation   → stable `questionRef` + `firstAskedAt`
 * B  retirement       → `questionRef` / `firstAskedAt` kept, state = retired, history kept
 * C  revival          → the SAME question returns to current (no new questionRef)
 * D  text change      → stable refs unchanged ⇒ `questionRef` unchanged
 * E  current-derived  → only `state === "current"` feeds current outputs/counts
 * F  collision guard  → same display text, different requirement ⇒ different questionRef
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
import { DiligencePreparationService } from "./application/diligence-preparation-service.js";
import { currentQuestions, retiredQuestions } from "./domain/index.js";
import type { DiligencePreparation, ResearchGap, ResearchTarget } from "./domain/index.js";

const INDUSTRY = "C2第一阶段行业";
const MISMATCHED_KIND = "不匹配的对象类型";

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const knowledge = new KnowledgeRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  const positions = new ChainProjectionService(db.db).project(sid).positions;
  const customer = positions.find((p) => p.kind === "customer")!;
  const targets = new TargetService(db.db);
  const diligence = new DiligencePreparationService(db.db);

  const requirementOf = (dimension: string) =>
    repo.listRequirements(sid).find((r) => r.dimension === dimension)!;
  /** Simulate an upstream Gap lifecycle change: C2 only CONSUMES Gap state (I-C2-2). */
  const convergeGapsOf = (requirementIds: string[]) => {
    for (const gap of repo.listGaps(sid)) {
      if (!gap.relatedRequirementIds.some((r) => requirementIds.includes(r))) continue;
      repo.upsertGap({ ...gap, status: "resolved" });
    }
  };
  const convergeEveryGap = () => {
    for (const gap of repo.listGaps(sid)) repo.upsertGap({ ...gap, status: "resolved" });
  };
  const addTarget = (subjectKey: string, targetKind?: string): ResearchTarget =>
    targets.add({
      industryId: sid,
      subjectKey,
      targetKind: targetKind ?? customer.suggestedTargetKinds[0]!,
      positionRef: customer.positionRef,
      researchPurpose: "验证采购意愿",
      selectionReason: "行业头部采购方",
    });

  return {
    db,
    repo,
    knowledge,
    sid,
    customer,
    targets,
    diligence,
    discovery,
    requirementOf,
    convergeGapsOf,
    convergeEveryGap,
    addTarget,
  };
}

/** Every question of one source that traces back to one of `requirementIds`. */
const questionsOf = (prep: DiligencePreparation, requirementIds: string[]) =>
  prep.questions.filter(
    (q) => q.source === "common" && requirementIds.includes(q.fromRequirementRef ?? ""),
  );

describe("Phase C2 · Step 1 · DiligenceQuestion identity + lifecycle", () => {
  test("A: the first preparation creates stable questionRef + firstAskedAt", async () => {
    const { db, repo, diligence, addTarget } = await setup();
    try {
      const target = addTarget("某头部客户A");
      const prep = diligence.prepare(target.targetRef);
      const current = currentQuestions(prep.questions);
      assert.ok(current.length > 0, "questions are produced");

      for (const q of current) {
        assert.equal(q.state, "current");
        assert.ok(q.firstAskedAt.length > 0, "firstAskedAt is stamped");
        assert.equal(q.retiredAt, undefined, "a fresh question was never retired");
        // ★ identity: dq-<preparationRef>-<source>-<canonicalRef>; canonicalRef = requirement ?? fit
        const canonical = q.fromRequirementRef ?? q.fromFitRef;
        assert.ok(canonical, "I-B5: every question traces back to a Requirement / Fit");
        assert.equal(q.questionRef, `dq-${prep.preparationRef}-${q.source}-${canonical}`);
      }
      // one row per (source, canonical ref) — the map-based assembly cannot duplicate
      assert.equal(new Set(prep.questions.map((q) => q.questionRef)).size, prep.questions.length);
      assert.equal(repo.getPreparation(prep.preparationRef)!.questions.length, prep.questions.length);
    } finally {
      db.close();
    }
  });

  test("B/C: convergence retires the question; reopening REVIVES the very same question", async () => {
    const { db, repo, diligence, discovery, sid, requirementOf, addTarget } = await setup();
    try {
      const target = addTarget("某头部客户B");
      const market = requirementOf("market");

      const first = diligence.prepare(target.targetRef);
      const question = questionsOf(first, [market.requirementId])[0]!;
      assert.ok(question, "the market requirement has a current common question");

      // ---- B) converge `market` through the EXISTING pipeline (claim → knowledge → pool → gap)
      await discovery.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market A", dimension: "market" }],
      });
      const afterConverge = diligence.prepare(target.targetRef);
      const retired = afterConverge.questions.find((q) => q.questionRef === question.questionRef)!;
      assert.equal(retired.state, "retired", "the question left the current projection");
      assert.equal(retired.questionRef, question.questionRef, "identity is stable");
      assert.equal(retired.firstAskedAt, question.firstAskedAt, "firstAskedAt never changes");
      assert.ok(retired.retiredAt, "retiredAt records when it left current");
      assert.ok(
        !currentQuestions(afterConverge.questions).some((q) => q.questionRef === question.questionRef),
        "a retired question is not part of the current projection",
      );
      assert.equal(  // ★ I-C2-6: history is kept, never deleted
        afterConverge.questions.filter((q) => q.questionRef === question.questionRef).length,
        1,
      );

      // ---- C) reopen the requirement (a CONFLICT re-opens this dimension's gap)
      await discovery.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market B", dimension: "market", relationHint: { kind: "CONFLICT" } }],
      });
      const afterReopen = diligence.prepare(target.targetRef);
      const revived = afterReopen.questions.find((q) => q.questionRef === question.questionRef)!;
      assert.equal(revived.state, "current", "the question is current again");
      assert.equal(revived.questionRef, question.questionRef, "revival reuses the SAME identity");
      assert.equal(revived.firstAskedAt, question.firstAskedAt, "firstAskedAt is preserved on revival");
      assert.equal(  // no duplicate row for the revived question
        afterReopen.questions.filter((q) => q.questionRef === question.questionRef).length,
        1,
      );
    } finally {
      db.close();
    }
  });

  test("D: changing the display text does NOT change questionRef", async () => {
    const { db, repo, diligence, requirementOf, addTarget } = await setup();
    try {
      const target = addTarget("某头部客户C");
      const requirement = requirementOf("demand");

      const first = diligence.prepare(target.targetRef);
      const before = currentQuestions(first.questions).find(
        (q) => q.fromRequirementRef === requirement.requirementId,
      )!;

      // the wording changes; the stable refs do not
      repo.upsertRequirement({
        ...requirement,
        description: "需求是否真实、可持续（本轮改写后的表述）",
      });

      const second = diligence.prepare(target.targetRef);
      const after = second.questions.find((q) => q.questionRef === before.questionRef)!;
      assert.ok(after, "the question is still identified by the same ref");
      assert.notEqual(after.text, before.text, "…while its display text really did change");
      assert.equal(after.firstAskedAt, before.firstAskedAt, "and its firstAskedAt is untouched");
    } finally {
      db.close();
    }
  });

  test("E/F: only `current` feeds current outputs; different refs never collide", async () => {
    const { db, repo, diligence, convergeGapsOf, addTarget } = await setup();
    try {
      const target = addTarget("某头部客户D");

      // first run: everything is current
      const firstRun = diligence.prepare(target.targetRef);
      const requirementsWithGaps = repo
        .listGaps(firstRun.industryRef)
        .filter((g) => g.relatedRequirementIds.length > 0);
      assert.ok(requirementsWithGaps.length >= 3, "the fixture has several gaps");

      const converged = requirementsWithGaps.slice(0, 2).flatMap((g) => g.relatedRequirementIds);
      const stillNeeded = requirementsWithGaps
        .slice(2)
        .flatMap((g) => g.relatedRequirementIds);

      convergeGapsOf(converged);
      const prep = diligence.prepare(target.targetRef);

      const convergedQuestions = questionsOf(prep, converged);
      const neededQuestions = questionsOf(prep, stillNeeded);
      assert.ok(convergedQuestions.length > 0);
      assert.ok(neededQuestions.length > 0);
      assert.ok(
        convergedQuestions.every((q) => q.state === "retired"),
        "a converged requirement's question is retired",
      );
      assert.ok(
        neededQuestions.every((q) => q.state === "current"),
        "a still-needed requirement's question stays current",
      );

      const current = currentQuestions(prep.questions);
      const retired = retiredQuestions(prep.questions);
      assert.equal(prep.questions.length, current.length + retired.length, "the row keeps current + retired");
      // ★ I-C2-12: `questions.length` is NOT the current count (history is included)
      assert.ok(prep.questions.length > current.length, "questions.length must never be the current count");
      assert.equal(
        current.some((q) => convergedQuestions.includes(q)),
        false,
        "no retired question leaks into the current projection",
      );

      // ---- F) two different requirements with the SAME display text must not collide
      const [a, b] = stillNeeded;
      assert.ok(a && b, "need two still-needed requirements");
      repo.upsertRequirement({ ...repo.getRequirement(a!)!, description: "完全相同的展示文本" });
      repo.upsertRequirement({ ...repo.getRequirement(b!)!, description: "完全相同的展示文本" });
      const collision = diligence.prepare(target.targetRef);
      const refs = questionsOf(collision, [a!, b!]).map((q) => q.questionRef);
      assert.equal(refs.length, 2, "one common question per requirement");
      assert.notEqual(refs[0], refs[1], "identity comes from the stable ref, not from the text");
    } finally {
      db.close();
    }
  });

  test("T-C2-3: a conflicted requirement stays current and is flagged for cross-validation", async () => {
    const { db, repo, knowledge, diligence, discovery, sid, addTarget } = await setup();
    try {
      // a target whose KIND does not match the position ⇒ weak fit ⇒ fit_derived caveat
      const target = addTarget("某不匹配对象", MISMATCHED_KIND);

      await discovery.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market A", dimension: "market" }],
      });
      await discovery.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market B", dimension: "market", relationHint: { kind: "CONFLICT" } }],
      });
      assert.equal(knowledge.listOpenConflicts().length, 1, "the conflict stays open (never auto-closed)");

      const prep = diligence.prepare(target.targetRef);
      const derived = currentQuestions(prep.questions).filter((q) => q.source === "fit_derived");
      assert.ok(derived.length > 0, "a low fit is stated as its own question");
      assert.ok(
        derived.some((q) => (q.caveat ?? "").includes("交叉验证") || (q.caveat ?? "").includes("参考")),
        "the caveat asks for cross-validation / treats it as reference only",
      );
      assert.ok(
        currentQuestions(prep.questions).some((q) => (q.fromRequirementRef ?? "").endsWith("-market")),
        "the conflicted requirement is STILL part of the current research plan",
      );
      assert.equal(knowledge.listOpenConflicts().length, 1, "the preparation did not touch the conflict");
    } finally {
      db.close();
    }
  });

  test("I-C2-2/9: only its own row is written; `--all` is explicit and never an implicit fallback", async () => {
    const { db, repo, diligence, convergeEveryGap, addTarget } = await setup();
    try {
      const target = addTarget("某头部客户E");
      const fingerprint = (industryId: string) =>
        JSON.stringify({
          gaps: repo.listGaps(industryId).map((g) => `${g.gapId}:${g.status}:${g.gapType}`).sort(),
          slots: repo.listPoolSlots(industryId).map((s) => `${s.dimension}:${s.status}`).sort(),
          requirements: repo.listRequirements(industryId).map((r) => `${r.requirementId}:${r.status}`).sort(),
        });

      const scoped = diligence.prepare(target.targetRef);
      const before = fingerprint(scoped.industryRef);
      const again = diligence.prepare(target.targetRef);
      assert.equal(fingerprint(again.industryRef), before, "preparing touches no Gap/Pool/Requirement row");
      assert.ok(currentQuestions(scoped.questions).length > 0, "the default scope is gap-driven and non-empty");

      // every gap converges ⇒ the DEFAULT scope is empty … and stays empty (no silent fallback)
      convergeEveryGap();
      const converged = diligence.prepare(target.targetRef);
      assert.equal(currentQuestions(converged.questions).length, 0, "an empty active set stays empty");
      assert.ok(retiredQuestions(converged.questions).length > 0, "…while the whole history is kept");

      // `{ all: true }` is the EXPLICIT audit mode
      const beforeAudit = fingerprint(scoped.industryRef);
      const audited = diligence.prepare(target.targetRef, { all: true });
      assert.ok(
        currentQuestions(audited.questions).length > 0,
        "the explicit audit mode fits the target against ALL requirements",
      );
      assert.ok(
        currentQuestions(audited.questions).length > currentQuestions(converged.questions).length,
        "…which is strictly more than the (now converged, empty) gap-driven default",
      );
      assert.equal(
        currentQuestions(audited.questions).length,
        currentQuestions(scoped.questions).length,
        "the audit mode covers EVERY requirement — the same set that was active before convergence",
      );
      assert.equal(fingerprint(scoped.industryRef), beforeAudit, "the audit mode writes only its own row");
    } finally {
      db.close();
    }
  });
});
