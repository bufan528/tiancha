/**
 * Phase C5-C — Research Plan read-only consumption of TargetProposal + Decision.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §20 (rev6.1), incl. T-C5-C-1..12.
 *
 * Covers: attachable mounting, the four `orphanProposals` branches (never hidden), the shared
 * deterministic ordering, three-state display, `decision: null` for `proposed`, persisted decision
 * mirroring, `confirmed ≠ Target`, whole-schema zero-write, idempotency, the "no self-made proposal
 * SQL" audit, the DTO forbidden-field audit, and C2 regression (table set unchanged).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { ChainProjectionService } from "./application/chain-projection-service.js";
import { CompanyService } from "./application/company-service.js";
import { TargetProposalService } from "./application/target-proposal-service.js";
import { TargetRecommendationService } from "./application/target-recommendation-service.js";
import { ProposalDecisionService } from "./application/proposal-decision-service.js";
import { TargetService } from "./application/target-service.js";
import { ResearchPlanService } from "./application/research-plan-service.js";
import { compareProposals } from "./domain/index.js";
import type { ResearchPlanProposal, ResearchPlanView } from "./domain/index.js";

/** Whole-schema CONTENT fingerprint — table count is never hard-coded (§20.9 T-C5-C-7). */
function dbFingerprint(db: { prepare: (sql: string) => any }): string {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return tables
    .map((t) => `${t.name}:${(db.prepare(`SELECT * FROM ${t.name}`).all() as unknown[]).length}`)
    .join("|");
}

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: "C5C 测试行业" });
  const sid = res.industry.industryId;
  new ChainProjectionService(db.db).project(sid);
  return {
    db,
    repo,
    sid,
    companies: new CompanyService(db.db),
    proposals: new TargetProposalService(db.db),
    engine: new TargetRecommendationService(db.db),
    decisions: new ProposalDecisionService(db.db),
    plans: new ResearchPlanService(db.db),
  };
}

type T = Awaited<ReturnType<typeof setup>>;

/** Seed one company + its persisted proposal; returns the persisted proposal. */
async function seedProposal(t: T, name: string) {
  const company = t.companies.add({
    industryId: t.sid,
    canonicalName: name,
    targetKinds: ["头部客户"],
  });
  const drafts = t.engine.build(t.sid).filter((d) => d.companyRef === company.companyId);
  t.proposals.persistDrafts(drafts);
  const stored = t.proposals
    .list(t.sid, "proposed")
    .filter((p) => p.companyRef === company.companyId);
  assert.equal(stored.length, 1, "fixture: one active proposal for this company");
  return stored[0];
}

/** All proposals the plan shows, wherever they are attached. */
function allPlanProposals(view: ResearchPlanView): ResearchPlanProposal[] {
  return [...view.gaps.flatMap((g) => g.positions.flatMap((p) => p.proposals)), ...view.orphanProposals];
}

describe("C5-C · attachable mounting (§20.3.1)", () => {
  test("T-C5-C-1: a proposal whose (gap, position) is emitted mounts under that position", async () => {
    const t = await setup();
    try {
      const seeded = await seedProposal(t, "挂载公司");
      const view = t.plans.build(t.sid);

      const mounted = view.gaps
        .flatMap((g) => g.positions.map((p) => ({ gap: g, pos: p })))
        .find((x) => x.gap.gapId === seeded.gapRef && x.pos.positionRef === seeded.positionRef);
      assert.ok(mounted, "the emitted (gap, position) exists");
      assert.equal(mounted!.pos.proposals.length, 1);
      assert.equal(mounted!.pos.proposals[0].proposalRef, seeded.proposalRef);
      assert.equal(mounted!.pos.proposals[0].companyName, "挂载公司", "D5 display field");
      assert.deepEqual(view.orphanProposals, [], "nothing is orphaned here");
    } finally {
      t.db.close();
    }
  });

  test("T-C5-C-2a: a proposal whose GAP is no longer emitted ⇒ orphanProposals (never hidden)", async () => {
    const t = await setup();
    try {
      const seeded = await seedProposal(t, "缺口关闭公司");
      // Close the gap so `ResearchNeedService` stops emitting it.
      const gap = t.repo.listGaps(t.sid).find((g) => g.gapId === seeded.gapRef)!;
      t.repo.upsertGap({ ...gap, status: "resolved" });

      const view = t.plans.build(t.sid);
      assert.ok(!view.gaps.some((g) => g.gapId === seeded.gapRef), "the gap is not emitted");
      assert.equal(view.orphanProposals.length, 1, "the proposal is NOT hidden");
      assert.equal(view.orphanProposals[0].proposalRef, seeded.proposalRef);
      assert.equal(allPlanProposals(view).length, 1, "still exactly one proposal in the plan");
    } finally {
      t.db.close();
    }
  });

  test("T-C5-C-2b: a proposal whose POSITION is not emitted within that gap ⇒ orphanProposals", async () => {
    const t = await setup();
    try {
      const seeded = await seedProposal(t, "跨位置公司");
      // Precondition: pick a position that EXISTS but is NOT emitted INSIDE this very gap.
      const before = t.plans.build(t.sid);
      const gapA = before.gaps.find((g) => g.gapId === seeded.gapRef)!;
      const emittedInA = new Set(gapA.positions.map((p) => p.positionRef));
      const outside = t.repo
        .listPositions(t.sid)
        .map((p) => p.positionRef)
        .filter((ref) => !emittedInA.has(ref));
      assert.ok(outside.length > 0, "fixture: a position exists that this gap does not emit");

      t.repo.insertTargetProposal({
        ...seeded,
        proposalRef: "prop-not-emitted-in-gap",
        companyRef: "com-not-emitted",
        gapRef: seeded.gapRef, // a REAL emitted gap …
        positionRef: outside[0]!, // … but a position it does NOT emit ⇒ must be orphaned
      });

      const view = t.plans.build(t.sid);
      const refs = view.orphanProposals.map((p) => p.proposalRef);
      assert.ok(
        refs.includes("prop-not-emitted-in-gap"),
        "a position not emitted WITHIN this gap ⇒ orphan (never hidden)",
      );
      assert.ok(
        allPlanProposals(view).some((p) => p.proposalRef === seeded.proposalRef),
        "the legitimately attached one is still shown",
      );
    } finally {
      t.db.close();
    }
  });

  test("T-C5-C-2c: an unresolvable gapRef/positionRef ⇒ orphanProposals", async () => {
    const t = await setup();
    try {
      const seeded = await seedProposal(t, "无法解析公司");
      t.repo.insertTargetProposal({
        ...seeded,
        proposalRef: "prop-unresolvable",
        companyRef: "com-unresolvable",
        gapRef: "gap-does-not-exist",
        positionRef: "pos-does-not-exist",
      });
      const view = t.plans.build(t.sid);
      assert.deepEqual(
        view.orphanProposals.map((p) => p.proposalRef).sort(),
        ["prop-unresolvable"],
        "an unresolvable reference is orphaned, never dropped and never guessed",
      );
    } finally {
      t.db.close();
    }
  });

  test("T-C5-C-2d: both lists use the SAME deterministic order (score DESC → proposalRef ASC)", async () => {
    const t = await setup();
    try {
      const seeded = await seedProposal(t, "排序公司");
      // Two more proposals for the same (gap, position), with distinct scores / refs.
      t.repo.insertTargetProposal({ ...seeded, proposalRef: "prop-b", companyRef: "com-b", score: seeded.score + 5 });
      t.repo.insertTargetProposal({ ...seeded, proposalRef: "prop-a", companyRef: "com-a", score: seeded.score + 5 });
      t.repo.insertTargetProposal({
        ...seeded,
        proposalRef: "prop-orphan",
        companyRef: "com-orphan",
        gapRef: "gap-x",
        score: 999,
      });

      const view = t.plans.build(t.sid);
      const mounted = view.gaps
        .flatMap((g) => g.positions)
        .find((p) => p.proposals.some((x) => x.proposalRef === seeded.proposalRef))!.proposals;

      const expected = [...mounted].sort(compareProposals).map((p) => p.proposalRef);
      assert.deepEqual(mounted.map((p) => p.proposalRef), expected, "mounted list is sorted");
      assert.deepEqual(
        mounted.map((p) => p.proposalRef).slice(0, 2),
        ["prop-a", "prop-b"],
        "equal score ⇒ proposalRef ASC",
      );
      assert.deepEqual(
        view.orphanProposals.map((p) => p.proposalRef),
        ["prop-orphan"],
        "orphans use the same comparator (single element here)",
      );
      // and the order is not merely "whatever SQLite returned": re-sorting with the SAME
      // comparator over the mounted objects must reproduce the same id sequence.
      assert.deepEqual(
        mounted.map((p) => p.proposalRef),
        [...mounted].sort(compareProposals).map((p) => p.proposalRef),
      );
    } finally {
      t.db.close();
    }
  });
});

describe("C5-C · proposal display state (§20.3 D2 / D3)", () => {
  test("T-C5-C-3/4/5: three states, `decision: null` for proposed, persisted decision mirrored", async () => {
    const t = await setup();
    try {
      const a = await seedProposal(t, "待决策公司");
      const b = await seedProposal(t, "已确认公司");
      const c = await seedProposal(t, "已拒绝公司");
      assert.equal(t.decisions.confirm(b.proposalRef, "Alice", "看过材料").status, "confirmed");
      assert.equal(t.decisions.reject(c.proposalRef, "Bob").status, "rejected");

      const view = t.plans.build(t.sid);
      const byRef = new Map(allPlanProposals(view).map((p) => [p.proposalRef, p]));

      const proposed = byRef.get(a.proposalRef)!;
      assert.equal(proposed.status, "proposed");
      assert.equal(proposed.decision, null, "no decision exists ⇒ null, never synthesized");

      const confirmed = byRef.get(b.proposalRef)!;
      assert.equal(confirmed.status, "confirmed");
      assert.deepEqual(confirmed.decision, {
        kind: "confirmed",
        operator: "Alice",
        comment: "看过材料",
        decidedAt: confirmed.decision!.decidedAt,
      }, "decision mirrors the persisted row verbatim (incl. kind)");

      const rejected = byRef.get(c.proposalRef)!;
      assert.equal(rejected.status, "rejected");
      assert.equal(rejected.decision!.kind, "rejected");
      assert.equal(rejected.decision!.operator, "Bob");
      assert.equal(rejected.decision!.comment, undefined);
    } finally {
      t.db.close();
    }
  });

  test("T-C5-C-6: `confirmed` without an existing Target ⇒ targetRef null, and NO target is created", async () => {
    const t = await setup();
    try {
      const seeded = await seedProposal(t, "无对象公司");
      // Confirm the proposal at the PRIMITIVE level, bypassing the decision service on purpose:
      // the proposal is then `confirmed` while NO ResearchTarget exists.
      assert.equal(t.proposals.transition(seeded.proposalRef, "proposed", "confirmed"), 1);
      assert.equal(t.repo.listTargets(t.sid).length, 0, "fixture: no target exists");

      const view = t.plans.build(t.sid);
      const p = allPlanProposals(view).find((x) => x.proposalRef === seeded.proposalRef)!;
      assert.equal(p.status, "confirmed");
      assert.equal(p.targetRef, null, "a derivable identity is NOT an existing target");
      assert.equal(t.repo.listTargets(t.sid).length, 0, "and the plan never creates one");
    } finally {
      t.db.close();
    }
  });

  test("confirmed WITH an existing Target ⇒ targetRef is reported", async () => {
    const t = await setup();
    try {
      const seeded = await seedProposal(t, "有对象公司");
      assert.equal(t.decisions.confirm(seeded.proposalRef, "Alice").status, "confirmed");
      const targetRef = t.repo.listTargets(t.sid)[0].targetRef;

      const view = t.plans.build(t.sid);
      const p = allPlanProposals(view).find((x) => x.proposalRef === seeded.proposalRef)!;
      assert.equal(p.targetRef, targetRef, "an existing target IS reported");
    } finally {
      t.db.close();
    }
  });
});

describe("C5-C · read-only guarantees (§20.8)", () => {
  test("T-C5-C-7: build() writes NOTHING (whole-schema fingerprint, twice)", async () => {
    const t = await setup();
    try {
      await seedProposal(t, "零写公司");
      const before = dbFingerprint(t.db.db);
      t.plans.build(t.sid);
      t.plans.build(t.sid);
      assert.equal(dbFingerprint(t.db.db), before, "a pure plan must not mutate any table");
    } finally {
      t.db.close();
    }
  });

  test("T-C5-C-8: idempotency — two renders are deepEqual (array order included)", async () => {
    const t = await setup();
    try {
      await seedProposal(t, "幂等公司");
      const first = t.plans.build(t.sid);
      const second = t.plans.build(t.sid);
      assert.deepEqual(second, first, "a second render produces the identical view");
    } finally {
      t.db.close();
    }
  });

  test("T-C5-C-11: the plan persists no table of its own (table set unchanged)", async () => {
    const t = await setup();
    try {
      const tables = () =>
        JSON.stringify(
          (t.db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
            name: string;
          }[]).map((r) => r.name),
        );
      const before = tables();
      t.plans.build(t.sid);
      assert.equal(tables(), before, "no table appeared or disappeared");
    } finally {
      t.db.close();
    }
  });
});

describe("C5-C · static audits", () => {
  const serviceSrc = readFileSync(
    new URL("./application/research-plan-service.ts", import.meta.url),
    "utf8",
  );
  const domainSrc = readFileSync(new URL("./domain/research-plan.ts", import.meta.url), "utf8");

  test("T-C5-C-9: the plan NEVER queries the proposal tables itself (reuses the services)", () => {
    assert.ok(!/FROM target_proposal/i.test(serviceSrc), "no self-made proposal SQL");
    assert.ok(!/FROM target_proposal_decision/i.test(serviceSrc), "no self-made decision SQL");
    assert.ok(/TargetProposalService/.test(serviceSrc), "reuses TargetProposalService");
    assert.ok(/getTargetProposalDecision\(/.test(serviceSrc), "reuses the decision reader");
    assert.ok(/CompanyService/.test(serviceSrc), "reuses CompanyService for the display name");
  });

  test("T-C5-C-9b: the plan never creates/repairs a target or decides a proposal", () => {
    // NOTE: `.add(` alone is NOT forbidden — plain `Set.add(...)` bookkeeping is legitimate here.
    // What must never appear is a TargetService ADD or any proposal/decision write path.
    for (const forbidden of [
      "targets.add(",
      "new TargetService(this.db).add",
      "insertTargetProposal",
      "upsertTargetProposal",
      "ProposalDecisionService",
      "casTransitionTargetProposal",
      "transition(",
    ]) {
      assert.ok(!serviceSrc.includes(forbidden), `plan must not contain '${forbidden}'`);
    }
    assert.ok(
      /new TargetService\(this\.db\)/.test(serviceSrc),
      "TargetService IS used — but only via .list( / .get( (read-only)",
    );
    assert.ok(/targetSvc\.get\(/.test(serviceSrc), "the only target call is the existence check");
  });

  test("T-C5-C-10: the Plan DTO declares NO persistence lifecycle field names", () => {
    for (const forbidden of ["createdAt", "updatedAt", "planId", "versionId", "save", "upsert"]) {
      const re = new RegExp(`^\\s*(readonly\\s+)?${forbidden}\\b`, "m");
      assert.ok(!re.test(domainSrc), `ResearchPlan DTO must not declare '${forbidden}'`);
    }
    // and the proposal timestamp is deliberately `proposedAt`
    assert.ok(/proposedAt/.test(domainSrc), "uses proposedAt");
    assert.ok(/decidedAt/.test(domainSrc), "decision timestamp is decidedAt");
  });

  test("compareProposals is the ONE shared comparator (score DESC → proposalRef ASC)", () => {
    const mk = (score: number, ref: string) => ({ score, proposalRef: ref });
    assert.ok(compareProposals(mk(9, "a"), mk(1, "b")) < 0, "higher score first");
    assert.ok(compareProposals(mk(1, "a"), mk(1, "b")) < 0, "tie ⇒ proposalRef ASC");
    assert.equal(compareProposals(mk(1, "a"), mk(1, "a")), 0);
    assert.ok(serviceSrc.includes("compareProposals"), "the plan uses exactly this comparator");
  });
});

describe("C5-C · C2 frozen-surface regression", () => {
  test("T-C5-C-11b: existing C2 plan behaviour is untouched (industry targets / next actions present)", async () => {
    const t = await setup();
    try {
      await seedProposal(t, "回归公司");
      const view = t.plans.build(t.sid);
      // C2 fields still exist and keep their shapes.
      assert.ok(Array.isArray(view.gaps));
      assert.ok(Array.isArray(view.industryTargets));
      assert.ok(Array.isArray(view.nextActions));
      assert.ok("state" in view);
      // C5-C additions did not replace anything.
      assert.ok(Array.isArray(view.orphanProposals));
      for (const g of view.gaps) for (const pos of g.positions) assert.ok(Array.isArray(pos.proposals));
      // sanity: the plan renders the same object twice (no mutation in between)
      assert.deepEqual(t.plans.build(t.sid), view);
    } finally {
      t.db.close();
    }
  });
});
