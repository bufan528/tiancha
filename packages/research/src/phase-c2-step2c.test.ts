/**
 * Phase C2 · Step 2-C — the research plan (a READ-ONLY projection).
 *
 *   T-C2-26  the view is assembled from the existing derivations and recomputes nothing
 *   T-C2-27  every gap resolved ⇒ no open gaps, coverage active = 0, NO fallback to all positions
 *   T-C2-28  per-gap sections stay separate (no cross-gap bleed)
 *   T-C2-29  re-degradation restores the coverage; identities stay stable
 *   T-C2-30  a position with no confirmed target is a NORMAL state
 *   T-C2-31  a fallback target is flagged
 *   T-C2-32  a target without a preparation renders as such (no crash)
 *   T-C2-39  the three-state association is derived from the Requirement intersection only
 *   T-C2-41  ordering: priority desc → ref asc (tie-breakers)
 *   static   the plan path stays inside the read-only whitelist (I-C2-22 / I-C2-24 / I-C2-25)
 *   fingerprint  building the plan twice leaves all 24 tables identical (I-C2-17)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { ChainProjectionService } from "./application/chain-projection-service.js";
import { ResearchNeedService } from "./application/research-need-service.js";
import { QuestionTargetFitService } from "./application/question-target-fit-service.js";
import { TargetService } from "./application/target-service.js";
import { DiligencePreparationService } from "./application/diligence-preparation-service.js";
import { ResearchPlanService } from "./application/research-plan-service.js";
import { currentPreparationView } from "./domain/index.js";
import type { ResearchPlanView, ResearchTarget } from "./domain/index.js";

const INDUSTRY = "C2 Step2C 行业";

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

/** Row-level fingerprint of ALL 24 tables (proves the plan writes nothing). */
const dbFingerprint = (db: ResearchDb) =>
  JSON.stringify(TABLES.map((t) => [t, db.db.prepare(`SELECT * FROM ${t}`).all()]));

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  const chain = new ChainProjectionService(db.db);
  chain.project(sid);
  return { db, repo, discovery, chain, sid, plans: new ResearchPlanService(db.db) };
}

const addTarget = (db: ResearchDb, sid: string, positionRef: string, name: string, refs: string[]): ResearchTarget =>
  new TargetService(db.db).add({
    industryId: sid,
    subjectKey: name,
    targetKind: "头部客户",
    positionRef,
    researchPurpose: "验证需求真实性",
    selectionReason: "行业头部采购方",
    relatedRequirementRefs: refs,
  });

/** All targets in the view, wherever they appear. */
const allViewTargets = (view: ResearchPlanView) => [
  ...view.gaps.flatMap((g) => g.positions.flatMap((p) => p.targets)),
  ...view.industryTargets,
];

describe("Phase C2 · Step 2-C · Research plan (read-only projection)", () => {
  test("T-C2-26: assembled from the existing derivations — nothing is recomputed", async () => {
    const { db, repo, plans, sid, chain } = await setup();
    try {
      const needs = new ResearchNeedService(db.db).list(sid);
      const coverage = chain.positionCoverage(sid);
      const fits = new QuestionTargetFitService(db.db);
      const preparations = new DiligencePreparationService(db.db).list(sid);
      const actions = repo.listNextActions(sid);
      const state = repo.getStateBySubject("industry", sid);

      // a confirmed target so the target grid is non-trivial
      const firstNeed = needs[0]!;
      const firstPosition = firstNeed.suggestedPositionRefs[0]!;
      addTarget(db, sid, firstPosition, "对象甲", firstNeed.requirementRefs);

      const view = plans.build(sid);
      assert.equal(view.industryRef, sid, "the industry identity is carried through");
      assert.equal(view.gaps.length, needs.length, "one section per ACTIVE gap (from the need list)");

      for (const gap of view.gaps) {
        const need = needs.find((n) => n.gapId === gap.gapId)!;
        assert.ok(need, "the gap comes from the need list");
        // ① the gap's own attributes are passed through verbatim (never re-derived)
        assert.equal(gap.priorityScore, need.priorityScore);
        assert.equal(gap.priorityPolicyVersionId, need.priorityPolicyVersionId);
        assert.equal(gap.whyStudyNotJustFetch, need.whyStudyNotJustFetch);
        assert.equal(gap.gapType, need.gapType);
        assert.equal(gap.status, need.status);
        assert.deepEqual(gap.requirementRefs, need.requirementRefs);

        // ② positions come from `suggestedPositionRefs`, in order, with Step 2-A's coverage verbatim
        assert.deepEqual(
          gap.positions.map((p) => p.positionRef),
          need.suggestedPositionRefs,
          "Gap → Position is consumed, not recomputed",
        );
        for (const position of gap.positions) {
          const cov = coverage.find((c) => c.positionRef === position.positionRef)!;
          assert.deepEqual(position.allRequirementRefs, cov.allRequirementRefs);
          assert.deepEqual(position.activeRequirementRefs, cov.activeRequirementRefs);
          assert.ok(position.activeRequirementRefs.length <= position.allRequirementRefs.length);
          assert.ok(position.label.length > 0 && position.kind.length > 0, "the position is labelled");
        }
      }

      // ③ state is read as-is (`null` when absent — never a fabricated 0)
      if (state) {
        assert.equal(view.state!.version, state.version);
        assert.equal(view.state!.unknown, state.unknown.length);
        assert.equal(view.state!.keyQuestionCount, state.keyQuestionIds.length);
      } else {
        assert.equal(view.state, null);
      }

      // ④ next actions consume the persisted rows verbatim
      assert.equal(view.nextActions.length, actions.length);
      for (const action of view.nextActions) {
        const row = actions.find((a) => a.actionId === action.actionId)!;
        assert.equal(action.priority, row.priority);
        assert.equal(action.kind, row.kind);
        assert.equal(action.rationale, row.rationale);
      }

      // ⑤ the target grid consumes fit + preparation verbatim
      const grid = allViewTargets(view);
      assert.ok(grid.length > 0, "the confirmed target is visible");
      for (const target of grid) {
        assert.deepEqual(target.fit, fits.summarize(target.targetRef), "fit is the B3 aggregation");
        const preparation = preparations.find((p) => p.targetRef === target.targetRef);
        if (preparation) {
          assert.equal(target.preparation!.preparationRef, preparation.preparationRef);
          assert.equal(
            target.preparation!.currentQuestionCount,
            currentPreparationView(preparation).currentQuestionCount,
            "the current/history split comes from Phase 1 — never re-judged here",
          );
        } else {
          assert.equal(target.preparation, null);
        }
      }

      // ⑥ positions that have no target are shown with an empty target list (T-C2-30)
      const emptyPositions = view.gaps.flatMap((g) => g.positions).filter((p) => p.targets.length === 0);
      assert.ok(emptyPositions.length > 0, "unmanned positions exist in this fixture");
    } finally {
      db.close();
    }
  });

  test("T-C2-27: everything resolved ⇒ no open gaps, active = 0, and NO fallback to all positions", async () => {
    const { db, repo, plans, sid, chain } = await setup();
    try {
      const needs = new ResearchNeedService(db.db).list(sid);
      addTarget(db, sid, needs[0]!.suggestedPositionRefs[0]!, "对象乙", needs[0]!.requirementRefs);

      const before = plans.build(sid);
      assert.ok(before.gaps.length > 0);
      assert.ok(allViewTargets(before).length > 0);

      // converge EVERY gap (the upstream pipeline's outcome — the plan only consumes it)
      for (const gap of repo.listGaps(sid)) repo.upsertGap({ ...gap, status: "resolved" });

      const after = plans.build(sid);
      assert.deepEqual(after.gaps, [], "no active gap ⇒ the open-gap section is empty (no fallback)");
      assert.equal(after.state !== undefined, true, "the state section is still rendered");

      // the same predicate elsewhere agrees, and the capability numbers are untouched
      assert.equal(new ResearchNeedService(db.db).list(sid).length, 0);
      const coverageAfter = chain.positionCoverage(sid);
      assert.equal(coverageAfter.reduce((s, c) => s + c.activeRequirementRefs.length, 0), 0);
      assert.ok(coverageAfter.every((c) => c.allRequirementRefs.length > 0), "capability refs remain");

      // ★ the confirmed target is NOT hidden — it moves to the industry-level section
      assert.equal(allViewTargets(after).length, 1);
      assert.deepEqual(after.industryTargets.map((t) => t.subjectKey), ["对象乙"]);
      assert.equal(after.industryTargets[0]!.associationStatus, "non_currently_mapped");
    } finally {
      db.close();
    }
  });

  test("T-C2-28: per-gap sections are derived separately (no cross-gap bleed)", async () => {
    const { db, plans, sid } = await setup();
    try {
      const needs = new ResearchNeedService(db.db).list(sid);
      assert.ok(needs.length >= 2, "fixture: at least two active gaps");
      const [needA, needB] = [needs[0]!, needs[1]!];
      // disjoint requirement sets are the norm (each gap asks for its own requirement)
      const disjoint = needA.requirementRefs.every((r) => !needB.requirementRefs.includes(r));
      assert.ok(disjoint, "fixture: the two gaps ask for different requirements");

      addTarget(db, sid, needA.suggestedPositionRefs[0]!, "甲", needA.requirementRefs);
      addTarget(db, sid, needB.suggestedPositionRefs[0]!, "乙", needB.requirementRefs);

      const view = plans.build(sid);
      const gapA = view.gaps.find((g) => g.gapId === needA.gapId)!;
      const gapB = view.gaps.find((g) => g.gapId === needB.gapId)!;

      const namesIn = (gapRef: string) =>
        view.gaps
          .find((g) => g.gapId === gapRef)!
          .positions.flatMap((p) => p.targets.map((t) => t.subjectKey))
          .sort();
      assert.deepEqual(namesIn(needA.gapId), ["甲"], "only A's target appears under A");
      assert.deepEqual(namesIn(needB.gapId), ["乙"], "only B's target appears under B");
      assert.deepEqual(gapA.requirementRefs, needA.requirementRefs);
      assert.deepEqual(gapB.requirementRefs, needB.requirementRefs);
    } finally {
      db.close();
    }
  });

  test("T-C2-29: re-degradation restores the coverage; identities stay stable", async () => {
    const { db, repo, discovery, plans, sid } = await setup();
    try {
      const needs = new ResearchNeedService(db.db).list(sid);
      const need = needs[0]!;
      const requirementId = need.requirementId;
      addTarget(db, sid, need.suggestedPositionRefs[0]!, "对象丙", need.requirementRefs);

      const positionsBefore = repo
        .listPositions(sid)
        .map((p) => `${p.positionRef}|${p.satisfiesRequirementRefs.join(",")}`)
        .sort();
      const coverageBefore = plans.build(sid).gaps.find((g) => g.gapId === need.gapId)!.positions.map((p) => `${p.positionRef}|${p.activeRequirementRefs.join(",")}`).sort();

      // converge that gap (simulating the upstream pipeline's outcome — the plan only consumes it)
      const gapRow = repo.listGaps(sid).find((g) => g.gapId === need.gapId)!;
      repo.upsertGap({ ...gapRow, status: "resolved" });
      const converged = plans.build(sid);
      assert.ok(
        !converged.gaps.some((g) => g.gapId === need.gapId),
        "the converged gap left the open-gap section",
      );

      // re-open EVERYTHING (simulating upstream degradation) and re-render
      for (const gap of repo.listGaps(sid)) repo.upsertGap({ ...gap, status: "open" });
      const recovered = plans.build(sid);
      const recoveredCoverage = recovered.gaps
        .find((g) => g.gapId === need.gapId)!
        .positions.map((p) => `${p.positionRef}|${p.activeRequirementRefs.join(",")}`)
        .sort();
      assert.deepEqual(recoveredCoverage, coverageBefore, "the coverage picture is restored");
      assert.ok(requirementId.length > 0);

      // identities never move
      assert.deepEqual(
        repo
          .listPositions(sid)
          .map((p) => `${p.positionRef}|${p.satisfiesRequirementRefs.join(",")}`)
          .sort(),
        positionsBefore,
        "positionRef + capability refs are untouched",
      );
    } finally {
      db.close();
    }
  });

  test("T-C2-31 / T-C2-32: fallback targets are flagged; a missing preparation renders as null", async () => {
    const { db, repo, plans, sid } = await setup();
    const diligence = new DiligencePreparationService(db.db);
    try {
      const needs = new ResearchNeedService(db.db).list(sid);
      const need = needs[0]!;
      const positionRef = need.suggestedPositionRefs[0]!;
      const targets = new TargetService(db.db);
      const main = targets.add({
        industryId: sid,
        subjectKey: "主对象",
        targetKind: "头部客户",
        positionRef,
        researchPurpose: "p",
        selectionReason: "r",
        relatedRequirementRefs: need.requirementRefs,
      });
      targets.add({
        industryId: sid,
        subjectKey: "备选对象",
        targetKind: "头部客户",
        positionRef,
        researchPurpose: "p",
        selectionReason: "r",
        isFallback: true,
        fallbackForTargetRef: main.targetRef,
        limitations: ["仅作交叉验证"],
        relatedRequirementRefs: need.requirementRefs,
      });
      // give ONLY the main target a preparation
      diligence.prepare(main.targetRef);

      const view = plans.build(sid);
      const grid = allViewTargets(view);
      const fallback = grid.find((t) => t.subjectKey === "备选对象")!;
      const primary = grid.find((t) => t.subjectKey === "主对象")!;
      assert.equal(fallback.isFallback, true);
      assert.equal(fallback.fallbackForTargetRef, main.targetRef);
      assert.ok(primary.preparation, "the prepared target carries its preparation summary");
      assert.ok(primary.preparation!.currentQuestionCount > 0);
      assert.equal(fallback.preparation, null, "a target without preparation renders as null (T-C2-32)");
    } finally {
      db.close();
    }
  });

  test("T-C2-39: the tri-state association is derived from the Requirement intersection only", async () => {
    const { db, repo, plans, sid } = await setup();
    try {
      const needs = new ResearchNeedService(db.db).list(sid);
      assert.ok(needs.length >= 3, "fixture: at least three active gaps");
      const [needA, needB, needC] = [needs[0]!, needs[1]!, needs[2]!];
      const positionRef = needA.suggestedPositionRefs[0]!;

      // 甲 → A ; 乙 → B ; 丙 → A+B (multi-gap membership) ; 丁 → nothing ; 戊 → a CONVERGED gap's req
      addTarget(db, sid, positionRef, "甲", needA.requirementRefs);
      addTarget(db, sid, positionRef, "乙", needB.requirementRefs);
      addTarget(db, sid, positionRef, "丙", [...needA.requirementRefs, ...needB.requirementRefs]);
      addTarget(db, sid, positionRef, "丁", []);

      // converge C so its requirement is no longer active (everything else stays open)
      for (const gap of repo.listGaps(sid)) {
        if (gap.gapId === needC.gapId) repo.upsertGap({ ...gap, status: "resolved" });
      }
      addTarget(db, sid, positionRef, "戊", needC.requirementRefs);

      const view = plans.build(sid);
      const status = (name: string) => allViewTargets(view).find((t) => t.subjectKey === name)!.associationStatus;
      assert.equal(status("甲"), "mapped");
      assert.equal(status("乙"), "mapped");
      assert.equal(status("丙"), "mapped");
      assert.equal(status("丁"), "unlinked", "no refs ⇒ unlinked");
      assert.equal(status("戊"), "non_currently_mapped", "refs exist but no ACTIVE gap asks for them");

      // 丙 legitimately appears under BOTH gaps (no de-duplication to a single owner)
      const under = (gapId: string) =>
        view.gaps
          .find((g) => g.gapId === gapId)!
          .positions.flatMap((p) => p.targets.map((t) => t.subjectKey));
      assert.ok(under(needA.gapId).includes("丙"));
      assert.ok(under(needB.gapId).includes("丙"));

      // 丁 / 戊 are in the industry-level section and nowhere else
      assert.deepEqual(view.industryTargets.map((t) => t.subjectKey).sort(), ["丁", "戊"]);
      for (const gap of view.gaps) {
        for (const position of gap.positions) {
          assert.ok(!position.targets.some((t) => ["丁", "戊"].includes(t.subjectKey)));
        }
      }
    } finally {
      db.close();
    }
  });

  test("T-C2-41: every collection has a deterministic order (tie-breakers apply)", async () => {
    const { db, plans, sid, repo } = await setup();
    try {
      const view = plans.build(sid);
      // Property assertions (deliberately NOT a copy of the implementation's comparator):
      // the sequence must be non-increasing by priority, and ties must ascend lexicographically.
      assert.ok(view.gaps.length >= 2, "fixture: at least two gaps");
      let tieSeen = false;
      for (let i = 1; i < view.gaps.length; i++) {
        const prev = view.gaps[i - 1]!;
        const cur = view.gaps[i]!;
        assert.ok(prev.priorityScore >= cur.priorityScore, "gaps: priority non-increasing");
        if (prev.priorityScore === cur.priorityScore) {
          tieSeen = true;
          assert.ok(prev.gapId < cur.gapId, "gaps: equal priority ⇒ gapId ascending");
        }
      }
      assert.ok(tieSeen, "fixture: a real priority tie exists (the tie-breaker is exercised)");

      for (let i = 1; i < view.nextActions.length; i++) {
        const prev = view.nextActions[i - 1]!;
        const cur = view.nextActions[i]!;
        assert.ok(prev.priority >= cur.priority, "actions: priority non-increasing");
        if (prev.priority === cur.priority) {
          assert.ok(prev.actionId < cur.actionId, "actions: equal priority ⇒ actionId ascending");
        }
      }

      for (let i = 1; i < view.industryTargets.length; i++) {
        assert.ok(
          view.industryTargets[i - 1]!.targetRef < view.industryTargets[i]!.targetRef,
          "targets: targetRef ascending",
        );
      }

      const targetRefs = view.industryTargets.map((t) => t.targetRef);
      assert.deepEqual(targetRefs, [...targetRefs].sort(), "targets ⇒ targetRef asc");

      // rendering twice is byte-identical
      assert.deepEqual(plans.build(sid), view, "a second render produces the identical view");
      assert.ok(repo.listGaps(sid).length > 0);
    } finally {
      db.close();
    }
  });

  test("fingerprint: building the plan twice leaves all 24 tables identical (I-C2-17)", async () => {
    const { db, plans, sid } = await setup();
    try {
      const before = dbFingerprint(db);
      plans.build(sid);
      plans.build(sid);
      assert.equal(dbFingerprint(db), before, "the plan is a pure projection — zero writes");
    } finally {
      db.close();
    }
  });

  test("fingerprint (no methodology row): the plan reads and falls back — it never bootstraps", async () => {
    const { db, plans, sid } = await setup();
    try {
      // ★ Regression lock for the ONE hidden write path: with no active methodology row,
      //   `MethodologyService.getActive()` would bootstrap (upsert) the baseline. The plan must not.
      db.db.prepare("DELETE FROM methodology").run();
      const before = dbFingerprint(db);
      const view = plans.build(sid);
      assert.equal(dbFingerprint(db), before, "build() must not write — not even a baseline row");
      const methodologyCount = (db.db.prepare("SELECT COUNT(*) AS n FROM methodology").get() as { n: number }).n;
      assert.equal(methodologyCount, 0, "no methodology row was re-created");
      // dimension labels degrade to their keys: no crash, and nothing fabricated
      for (const gap of view.gaps) {
        assert.ok(gap.dimensionLabel.length > 0);
        assert.equal(gap.dimensionLabel, gap.dimension, "the label falls back to the key when absent");
      }
    } finally {
      db.close();
    }
  });

  test("static: the plan path stays inside the read-only whitelist (I-C2-22/24/25)", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const files = [
      "packages/research/src/application/research-plan-service.ts",
      "packages/research/src/domain/research-plan.ts",
      "src/cli/research-format.ts",
    ];
    const banned: Array<[string, RegExp]> = [
      ["refresh*", /\brefresh[A-Z]/],
      ["sync*", /\bsync[A-Z]/],
      ["reconcile*", /\breconcile[A-Z]/],
      ["upsert*", /\bupsert[A-Z]/],
      ["create*", /\bcreate[A-Z]/],
      ["append*", /\bappend[A-Z]/],
      ["resolve*", /\bresolve[A-Z]/],
      ["priority service", /\bPriorityService\b/],
      ["methodology bootstrap", /\bMethodologyService\b/],
      ["bootstrap call", /\bbootstrap\(/],
      ["raw listGaps", /\blistGaps\(/],
      ["raw listPositions", /\blistPositions\(/],
      ["raw listRequirements", /\blistRequirements\(/],
      ["pool slots", /\blistPoolSlots\(/],
      ["pool items", /\blistPoolItems\(/],
      ["knowledge repository", /\bKnowledgeRepository\b/],
      ["fallback scan", /fallbackRequirements\(/],
      ["model call", /\bopenai\b|\banthropic\b/],
      ["network", /\bfetch\(|https?:\/\//],
      ["legacy plans", /plans\.json|invest-extension/],
      ["legacy server", /\bstore\.ts\b|\bserver\.ts\b/],
    ];
    for (const rel of files) {
      const source = readFileSync(join(root, rel), "utf8");
      for (const [label, pattern] of banned) {
        assert.ok(!pattern.test(source), `${rel} must not contain ${label}`);
      }
    }
    // …and the ALLOWED read faces really are the ones the builder consumes
    const service = readFileSync(join(root, files[0]!), "utf8");
    for (const allowed of [
      "getStateBySubject",
      "listNextActions",
      "ResearchNeedService",
      "positionCoverage",
      "listProjectedPositions",
      "TargetService",
      "summarize",
      "DiligencePreparationService",
      "getActiveMethodology",
    ]) {
      assert.ok(service.includes(allowed), `the builder consumes ${allowed}`);
    }
    // the DTO must not grow an identity or a lifecycle
    const domain = readFileSync(join(root, files[1]!), "utf8");
    for (const forbidden of ["planId", "createdAt", "updatedAt", "versionId", "save(", "upsert("]) {
      assert.ok(
        !new RegExp(`^\\s*(readonly\\s+)?${forbidden.replace("(", "\\(")}`, "m").test(domain),
        `ResearchPlanView must not declare ${forbidden}`,
      );
    }
    assert.ok(relative(root, join(root, files[0]!)).length > 0);
  });
});
