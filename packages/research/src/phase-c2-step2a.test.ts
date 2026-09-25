/**
 * Phase C2 · Step 2-A — Coverage Closure.
 *
 * Authorized scope: the ONE shared `ActiveRequirementResolver` feeding Need / Fit / coverage,
 * plus the READ-ONLY position coverage (capability vs current research state).
 * Step 2-B (`--for-gap`) and Step 2-C (the plan builder) are NOT part of this stage.
 *
 *   T-C2-26  normal: coverage is DERIVED (all ≡ capability, active = all ∩ active requirement);
 *            Need / Fit / coverage share ONE predicate; nothing is recomputed
 *   T-C2-27  zero-gap: every gap resolved ⇒ active coverage 0, and the scope NEVER falls back
 *   T-C2-29  re-degraded: the SAME gapId re-opens (a lifecycle event, not a status value),
 *            coverage recovers, and the Position BODY never converges
 *   static   textual audit: the KNOWN predicate forms (the `"mitigating"` literal and the
 *            explicit `status === "open" || …` form) appear only in the shared resolver, the
 *            `GapStatus` type and the frozen C1 / S5 / S6 / ingest exceptions C2 must not touch.
 *            The behavioural half of the evidence is T-C2-26 (Need / Fit / coverage agree) plus
 *            T-C2-36 (CLI / Agent agree).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
import { ActiveRequirementResolver } from "./domain/index.js";
import type { PositionCoverage } from "./domain/index.js";

const INDUSTRY = "C2 Step2A 行业";

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;

  const chain = new ChainProjectionService(db.db);
  chain.project(sid);
  const customer = repo.listPositions(sid).find((p) => p.kind === "customer")!;
  const target = new TargetService(db.db).add({
    industryId: sid,
    subjectKey: "Step2A 客户甲",
    targetKind: customer.suggestedTargetKinds[0]!,
    positionRef: customer.positionRef,
    researchPurpose: "验证采购意愿",
    selectionReason: "行业头部采购方",
  });

  return {
    db,
    repo,
    discovery,
    chain,
    sid,
    target,
    needs: new ResearchNeedService(db.db),
    fits: new QuestionTargetFitService(db.db),
  };
}

const activeTotal = (coverage: PositionCoverage[]) =>
  coverage.reduce((sum, c) => sum + c.activeRequirementRefs.length, 0);

/**
 * Stable, order-independent summary of a coverage set — the FULL ref lists, not just counts,
 * so "restored" means the SAME requirements are active again (not merely the same number).
 */
const coverageSummary = (coverage: PositionCoverage[]) =>
  coverage
    .map(
      (c) =>
        `${c.positionRef}|all=[${c.allRequirementRefs.join(",")}]|active=[${c.activeRequirementRefs.join(",")}]`,
    )
    .sort();

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("Phase C2 · Step 2-A · Coverage Closure", () => {
  test("T-C2-26: coverage is DERIVED — all ≡ capability, active = all ∩ active requirement", async () => {
    const { db, repo, chain, sid, target, needs, fits } = await setup();
    try {
      const positions = repo.listPositions(sid);
      const gaps = repo.listGaps(sid);
      const requirements = repo.listRequirements(sid);
      const activeRefs = ActiveRequirementResolver.activeRequirementRefs(gaps, requirements);
      const coverage = chain.positionCoverage(sid);

      assert.equal(coverage.length, positions.length, "every projected position has a coverage view");
      assert.ok(activeRefs.length > 0, "fixture: requirements are still research-needed");
      assert.equal(
        activeRefs.length,
        requirements.length,
        "fixture: every gap is still open at this point, so active == all",
      );

      for (const cov of coverage) {
        const position = positions.find((p) => p.positionRef === cov.positionRef)!;
        // ① `all` is the ALIAS of the existing capability refs — not a new column / new computation
        assert.deepEqual(cov.allRequirementRefs, position.satisfiesRequirementRefs);
        // ② `active` is exactly all ∩ the shared active set (order inherited, §4.3.2)
        assert.deepEqual(
          cov.activeRequirementRefs,
          position.satisfiesRequirementRefs.filter((ref) => activeRefs.includes(ref)),
        );
        // ③ active ≤ all
        assert.ok(cov.activeRequirementRefs.length <= cov.allRequirementRefs.length);
      }

      // ④ Fit's `questionRef` IS the Requirement's identity — the contract says so explicitly
      //    ("The question — a Phase B question IS an open Requirement", domain/question-target-fit.ts),
      //    the service sets `questionRef: requirement.requirementId` (question-target-fit-service.ts)
      //    and looks the requirement up by that very ref. We PROVE that identity first, instead of
      //    relying on the fixture's values happening to line up.
      const requirementIds = new Set(requirements.map((r) => r.requirementId));
      const fitsNow = fits.fitAll(target.targetRef);
      assert.ok(fitsNow.length > 0, "fixture: the target has fits");
      for (const f of fitsNow) {
        assert.ok(
          requirementIds.has(f.questionRef),
          `fit.questionRef is a requirementId (got '${f.questionRef}')`,
        );
      }

      //    …only THEN may the shared-predicate claim be stated this way: the DEFAULT fit scope
      //    equals the shared active set.
      const fitScope = [...new Set(fitsNow.map((f) => f.questionRef))].sort();
      assert.deepEqual(fitScope, [...activeRefs].sort(), "the fit scope equals the shared active set");
      const needList = needs.list(sid);
      assert.equal(needList.length, ActiveRequirementResolver.activeGaps(gaps).length);
      assert.ok(needList.length > 0, "needs are derived from the same active gaps");
      //    `need` uses the same identity vocabulary too (no second one)
      for (const n of needList) {
        assert.ok(requirementIds.has(n.requirementId), "need.requirementId is a requirementId");
      }

      // ⑤ cross-check against an INDEPENDENT oracle written inside the test: a test-local
      //    implementation is fine — the point is that PRODUCTION has exactly one.
      const oracle = new Set(
        gaps
          .filter((g) => g.status === "open" || g.status === "mitigating")
          .flatMap((g) => g.relatedRequirementIds),
      );
      assert.deepEqual([...activeRefs].sort(), [...oracle].sort());
    } finally {
      db.close();
    }
  });

  test("T-C2-27: every gap resolved ⇒ active coverage 0, never a fallback to the full set", async () => {
    const { db, repo, chain, sid, target, needs, fits } = await setup();
    try {
      const positions = repo.listPositions(sid);
      const allBefore = new Map(positions.map((p) => [p.positionRef, p.satisfiesRequirementRefs.length]));

      // converge EVERY gap (simulating the upstream pipeline's outcome — C2 only consumes it)
      for (const gap of repo.listGaps(sid)) repo.upsertGap({ ...gap, status: "resolved" });

      const coverage = chain.positionCoverage(sid);
      assert.equal(coverage.length, positions.length, "positions are still rendered at zero coverage");
      assert.equal(activeTotal(coverage), 0, "active coverage is 0 — the converged state");
      for (const cov of coverage) {
        // ★ capability refs are untouched: no fallback to "all", no write-back
        assert.equal(cov.allRequirementRefs.length, allBefore.get(cov.positionRef));
      }

      // Need / Fit follow the same predicate — and they do NOT silently widen either
      assert.equal(needs.list(sid).length, 0);
      assert.equal(fits.fitAll(target.targetRef).length, 0, "the default scope is empty, never widened");
      assert.ok(
        fits.fitAll(target.targetRef, { all: true }).length > 0,
        "--all remains the explicit audit mode",
      );
    } finally {
      db.close();
    }
  });

  test("T-C2-29: re-degradation re-opens the SAME gap; coverage recovers; Position never converges", async () => {
    const { db, repo, discovery, chain, sid } = await setup();
    try {
      const positionsBefore = repo
        .listPositions(sid)
        .map((p) => `${p.positionRef}|${p.satisfiesRequirementRefs.join(",")}|${p.answersQuestionRefs.join(",")}`)
        .sort();
      const gapsBefore = repo.listGaps(sid).length;
      const coverageBefore = chain.positionCoverage(sid);
      const market = repo.listRequirements(sid).find((r) => r.dimension === "market")!;
      const gapBefore = repo.listGaps(sid).find((g) => g.relatedRequirementIds.includes(market.requirementId))!;

      // ① converge through the EXISTING pipeline (claim → knowledge → pool → gap)
      await discovery.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market A", dimension: "market" }],
      });
      assert.equal(
        repo.listGaps(sid).find((g) => g.gapId === gapBefore.gapId)!.status,
        "resolved",
        "the gap converged",
      );
      const coverageConverged = chain.positionCoverage(sid);
      assert.ok(
        activeTotal(coverageConverged) < activeTotal(coverageBefore),
        "coverage shrank while the gap was resolved",
      );

      // ② re-degrade: a CONFLICT re-opens the SAME gap — `reopened` is a lifecycle EVENT,
      //    not a `GapStatus` value
      await discovery.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market B", dimension: "market", relationHint: { kind: "CONFLICT" } }],
      });
      const reopened = repo.listGaps(sid).find((g) => g.gapId === gapBefore.gapId)!;
      assert.equal(reopened.status, "open", "the SAME gapId is open again (no `reopened` status)");
      assert.equal(reopened.discoveredAt, gapBefore.discoveredAt, "discoveredAt is preserved");
      assert.equal(repo.listGaps(sid).length, gapsBefore, "no new gap row was created");

      // ③ coverage recovers to exactly the earlier picture
      assert.deepEqual(coverageSummary(chain.positionCoverage(sid)), coverageSummary(coverageBefore));

      // ④ the Position never converged. I-C2-16 protects the position's IDENTITY + CAPABILITY
      //    refs (`positionRef` / `satisfiesRequirementRefs` — contract §4.1 "本体不变"), and this
      //    test additionally pins `answersQuestionRefs`. The remaining fields (label / kind /
      //    importance / limitations …) are deliberately NOT part of the invariant: this code path
      //    performs no repository write at all (`positionCoverage()` reads only), so fingerprinting
      //    them would overstate what Step 2-A claims.
      assert.deepEqual(
        repo
          .listPositions(sid)
          .map((p) => `${p.positionRef}|${p.satisfiesRequirementRefs.join(",")}|${p.answersQuestionRefs.join(",")}`)
          .sort(),
        positionsBefore,
      );
    } finally {
      db.close();
    }
  });

  test("static: no production consumer re-implements the KNOWN-FORM active predicate", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const files = [...collect(join(root, "packages", "research", "src")), ...collect(join(root, "src"))].filter(
      (f) => !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
    );
    const rel = (f: string) => relative(root, f).replace(/\\/g, "/");

    // ★ STRENGTH, stated honestly: this is a TEXTUAL audit of the KNOWN predicate forms — it is
    //   NOT a proof against arbitrary re-implementations (a disguised helper or an AST-level
    //   rewrite would pass it). Two forms are checked:
    //     (a) the literal `"mitigating"` — ANY active predicate must name it;
    //     (b) the explicit `status === "open" || … === "mitigating"` form.
    //   The BEHAVIOURAL half of the evidence is T-C2-26 (Need / Fit / coverage agree) together
    //   with T-C2-36 (CLI / Agent agree).
    const withLiteral = files.filter((f) => /["']mitigating["']/.test(readFileSync(f, "utf8"))).map(rel);
    const withPredicate = files
      .filter((f) => /status === "open" \|\| [^;]*=== "mitigating"/.test(readFileSync(f, "utf8")))
      .map(rel);

    const resolver = "packages/research/src/domain/active-requirement.ts";
    const gapStatusType = "packages/research/src/domain/research-gap.ts"; // the GapStatus union
    assert.ok(withPredicate.includes(resolver), "the shared resolver defines the predicate");
    assert.ok(withLiteral.includes(gapStatusType), "…and the GapStatus type is where the literal belongs");

    // FROZEN exceptions C2 must NOT touch (contract §3 red lines: "Phase 2 only READS them"):
    //   C1's knowledge projection, S5's priority rules, S6's report projection and the
    //   pre-existing ingest pipeline each keep their own (identical) predicate.
    // ★ Unifying them is NOT part of Step 2-A's authorized scope — it would edit files whose
    //   rules are frozen; doing so needs separate authorization.
    const frozen = new Set([
      "packages/research/src/application/knowledge-projection-service.ts",
      "packages/research/src/application/priority-service.ts",
      "packages/research/src/application/report-service.ts",
      "packages/research/src/application/opportunity-discovery-service.ts",
    ]);
    assert.deepEqual(
      withPredicate.filter((f) => f !== resolver && !frozen.has(f)),
      [],
      "no consumer may re-implement the active predicate (explicit form)",
    );
    // the broader check: the `mitigating` literal itself may only live in the resolver, the type
    // union and the frozen exceptions — this also catches forms like `["open","mitigating"].includes(…)`
    assert.deepEqual(
      withLiteral.filter((f) => f !== resolver && f !== gapStatusType && !frozen.has(f)),
      [],
      "the `mitigating` literal only appears in the resolver, the GapStatus type and the frozen exceptions",
    );

    // …and the Step 2-A consumers really go through the shared implementation
    for (const rel of [
      "packages/research/src/application/research-need-service.ts",
      "packages/research/src/application/question-target-fit-service.ts",
      "src/cli/research-commands.ts",
      "src/agent/research-tools.ts",
    ]) {
      assert.ok(
        readFileSync(join(root, rel), "utf8").includes("ActiveRequirementResolver"),
        `${rel} consumes the shared resolver`,
      );
    }
    assert.ok(
      readFileSync(join(root, "packages/research/src/application/chain-projection-service.ts"), "utf8").includes(
        "positionCoverages",
      ),
      "chain projection derives coverage through the shared domain derivation",
    );
  });
});
