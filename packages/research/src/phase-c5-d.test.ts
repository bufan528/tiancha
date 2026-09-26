/**
 * Phase C5-D — Diligence Preparation boundary freeze + read-only `ResearchPlan` summary.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §21 rev2 (document rev8).
 *   D1  the entry gate is ResearchTarget EXISTENCE, not TargetStatus.
 *   D2  three access layers: prepare() = materialisation/write, get()/list() = read,
 *       ResearchPlanService.build() = read-only projection.
 *   D4  positions[].proposals[].preparation = { preparationRef, status, questionCount } | null.
 *   R10 build() never triggers prepare() and never writes.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
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
import { DiligencePreparationService } from "./application/diligence-preparation-service.js";
import { ResearchPlanService } from "./application/research-plan-service.js";
import type { ResearchPlanProposal, ResearchPlanView } from "./domain/index.js";

/** Whole-schema CONTENT fingerprint (same standard as §20.9 T-C5-C-7): a rewrite that keeps
 *  every row count identical must still be caught. Table names are never hard-coded. */
function dbFingerprint(db: { prepare: (sql: string) => any }): string {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return tables
    .map((t) => `${t.name}:${JSON.stringify(db.prepare(`SELECT * FROM ${t.name}`).all())}`)
    .join("|");
}

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: "C5D 测试行业" });
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
    targets: new TargetService(db.db),
    prep: new DiligencePreparationService(db.db),
    plans: new ResearchPlanService(db.db),
  };
}

type T = Awaited<ReturnType<typeof setup>>;

function allPlanProposals(view: ResearchPlanView): ResearchPlanProposal[] {
  return [
    ...view.gaps.flatMap((g) => g.positions.flatMap((p) => p.proposals)),
    ...view.orphanProposals,
  ];
}

function proposalOf(view: ResearchPlanView, ref: string): ResearchPlanProposal {
  const found = allPlanProposals(view).find((x) => x.proposalRef === ref);
  assert.ok(found, `fixture: the plan emits proposal ${ref}`);
  return found;
}

/** Seed one company + its persisted proposal (same fixture shape as the C5-C suite). */
async function seedProposal(t: T, name: string) {
  const company = t.companies.add({ industryId: t.sid, canonicalName: name, targetKinds: ["头部客户"] });
  t.proposals.persistDrafts(t.engine.build(t.sid).filter((d) => d.companyRef === company.companyId));
  const stored = t.proposals.list(t.sid, "proposed").filter((p) => p.companyRef === company.companyId);
  assert.equal(stored.length, 1, "fixture: exactly one active proposal for this company");
  return stored[0];
}

/** A confirmed proposal whose ResearchTarget exists; optionally a materialised preparation. */
async function seedConfirmed(t: T, name: string, opts: { prepare?: boolean } = {}) {
  const seeded = await seedProposal(t, name);
  assert.equal(t.decisions.confirm(seeded.proposalRef, "张三").status, "confirmed");
  const targetRef = t.repo.listTargets(t.sid)[0].targetRef;
  const preparation = opts.prepare ? t.prep.prepare(targetRef) : null;
  return { seeded, targetRef, preparation };
}

describe("C5-D · D1 Target Gate (§21.2)", () => {
  test("T-D-1: an unknown targetRef is a DETERMINISTIC error — not a degraded or empty preparation", async () => {
    const t = await setup();
    try {
      assert.throws(() => t.prep.prepare("tgt-does-not-exist"), /unknown target/, "unknown target throws");
      assert.equal(t.repo.listPreparations(t.sid).length, 0, "nothing was created on the way out");
    } finally {
      t.db.close();
    }
  });

  test("T-D-2/3: a `dropped` target still materialises, and prepare() never rewrites its status", async () => {
    const t = await setup();
    try {
      const { targetRef } = await seedConfirmed(t, "已弃公司");
      t.targets.setStatus(targetRef, "dropped");
      assert.equal(t.repo.getTarget(targetRef)!.status, "dropped", "fixture: the target is dropped");

      const preparation = t.prep.prepare(targetRef);

      assert.equal(preparation.targetRef, targetRef, "a dropped target is still admissible (existence, not status)");
      assert.equal(t.repo.getTarget(targetRef)!.status, "dropped", "T-D-3: prepare() left the status alone");
      assert.equal(t.repo.getPreparation(preparation.preparationRef)!.targetRef, targetRef, "and it was persisted");
    } finally {
      t.db.close();
    }
  });
});

describe("C5-D · D4 Plan → Preparation summary (§21.5)", () => {
  test("T-D-4: confirmed + Target EXISTS + no preparation ⇒ null (not an error, never fabricated)", async () => {
    const t = await setup();
    try {
      const { seeded, targetRef } = await seedConfirmed(t, "无准备公司", { prepare: false });
      assert.equal(t.repo.listPreparations(t.sid).length, 0, "fixture: no preparation exists");
      const before = dbFingerprint(t.db.db);

      const view = t.plans.build(t.sid);
      const p = proposalOf(view, seeded.proposalRef);

      assert.equal(p.status, "confirmed", "fixture: the proposal is confirmed");
      assert.equal(p.targetRef, targetRef, "the target IS verified, so it is reported");
      assert.equal(p.preparation, null, "§21.5 status table row 3: null means 'not materialised yet'");
      assert.equal(t.repo.listPreparations(t.sid).length, 0, "no preparation was back-filled");
      assert.equal(dbFingerprint(t.db.db), before, "and build() wrote absolutely nothing");
    } finally {
      t.db.close();
    }
  });

  test("T-D-5/6: the three fields mirror the SoT exactly; questionCount counts CURRENT only", async () => {
    const t = await setup();
    try {
      const { seeded, targetRef, preparation } = await seedConfirmed(t, "有准备公司", { prepare: true });
      const stored = t.repo.listPreparations(t.sid)[0];
      assert.equal(stored.targetRef, targetRef, "fixture: the preparation belongs to the confirmed target");

      // Add one RETIRED question so the `state === "current"` filter is genuinely falsifiable.
      const current = stored.questions.filter((q) => q.state === "current").length;
      const template = stored.questions[0];
      assert.ok(template, "fixture: prepare() produced at least one question");
      t.repo.upsertPreparation({
        ...stored,
        questions: [
          ...stored.questions,
          { ...template, questionRef: `${template.questionRef}-retired`, state: "retired", retiredAt: "2026-01-01" },
        ],
      });

      const view = t.plans.build(t.sid);
      const p = proposalOf(view, seeded.proposalRef);
      const reread = t.repo.getPreparation(stored.preparationRef)!;

      assert.deepEqual(
        p.preparation,
        {
          preparationRef: reread.preparationRef,
          status: reread.status,
          questionCount: current,
        },
        "T-D-5/6: exactly three fields, mirroring get() — the retired question is excluded",
      );
      assert.equal(reread.questions.length, stored.questions.length + 1, "fixture: the retired row really is there");
      assert.notEqual(p.preparation!.questionCount, reread.questions.length, "questionCount is NOT questions.length");
      assert.equal(preparation!.preparationRef, p.preparation!.preparationRef, "the ref came from the SoT");
    } finally {
      t.db.close();
    }
  });

  test("T-D-11: `confirmed` but NO ResearchTarget ⇒ null — status alone NEVER yields a preparation", async () => {
    const t = await setup();
    try {
      const seeded = await seedProposal(t, "只有建议公司");
      // Confirm at the PRIMITIVE level on purpose: `status` becomes confirmed while NO target exists.
      assert.equal(t.proposals.transition(seeded.proposalRef, "proposed", "confirmed"), 1);
      assert.equal(t.repo.listTargets(t.sid).length, 0, "fixture: no target exists");
      const before = dbFingerprint(t.db.db);

      const view = t.plans.build(t.sid);
      const p = proposalOf(view, seeded.proposalRef);

      assert.equal(p.status, "confirmed");
      assert.equal(p.targetRef, null, "confirmed ≠ target exists");
      assert.equal(p.preparation, null, "confirmed ≠ preparation exists");
      assert.equal(t.repo.listTargets(t.sid).length, 0, "the plan created no target");
      assert.equal(t.repo.listPreparations(t.sid).length, 0, "and no preparation");
      assert.equal(dbFingerprint(t.db.db), before, "build() wrote nothing at all");
    } finally {
      t.db.close();
    }
  });

  test("T-D-7: build() writes NOTHING — whole-schema CONTENT fingerprint, twice", async () => {
    const t = await setup();
    try {
      await seedConfirmed(t, "指纹公司", { prepare: true });
      const before = dbFingerprint(t.db.db);

      t.plans.build(t.sid);
      assert.equal(dbFingerprint(t.db.db), before, "one build() changed no row anywhere");
      t.plans.build(t.sid);
      assert.equal(dbFingerprint(t.db.db), before, "and a second build() still changed nothing");
    } finally {
      t.db.close();
    }
  });

  test("T-D-8: two builds are deepEqual — array order and the new field included", async () => {
    const t = await setup();
    try {
      await seedConfirmed(t, "幂等公司", { prepare: true });
      assert.deepEqual(t.plans.build(t.sid), t.plans.build(t.sid));
    } finally {
      t.db.close();
    }
  });
});

describe("C5-D · read-only boundary (§21.6 R1–R10)", () => {
  test("T-D-9: build() behaviourally creates no target, decides no proposal, starts no preparation", async () => {
    const t = await setup();
    try {
      const a = await seedConfirmed(t, "行为甲", { prepare: true });
      const b = await seedProposal(t, "行为乙"); // stays `proposed`: it must NOT be decided by a read
      const targetsBefore = t.repo.listTargets(t.sid).length;
      const prepsBefore = t.repo.listPreparations(t.sid).length;
      const before = dbFingerprint(t.db.db);

      const view = t.plans.build(t.sid);

      assert.equal(t.repo.listTargets(t.sid).length, targetsBefore, "no target was created");
      assert.equal(t.repo.listPreparations(t.sid).length, prepsBefore, "no preparation was created");
      assert.equal(
        t.repo.getTargetProposal(b.proposalRef)!.status,
        "proposed",
        "no proposal was confirmed/rejected by a read",
      );
      assert.equal(dbFingerprint(t.db.db), before, "no row was written anywhere in the schema");

      // The summary mirrors the EXISTING SoT (no second surface, nothing recomputed).
      const pa = proposalOf(view, a.seeded.proposalRef);
      assert.equal(pa.preparation!.preparationRef, a.preparation!.preparationRef);
      assert.equal(pa.preparation!.status, a.preparation!.status);

      // §21.5 mount point: the C2 target surface must NOT have gained a `questionCount`.
      const c2Targets = view.gaps.flatMap((g) => g.positions).flatMap((p) => p.targets);
      for (const tgt of c2Targets) {
        const c2 = tgt.preparation as unknown as Record<string, unknown> | null;
        assert.ok(c2 === null || !("questionCount" in c2), "C5-D added NO field to the C2 target surface");
      }
    } finally {
      t.db.close();
    }
  });

  test("T-D-10: currentUnderstanding beliefs keep a REAL claimRef provenance (honest degradation)", async () => {
    const t = await setup();
    try {
      const { targetRef } = await seedConfirmed(t, "溯源公司", { prepare: true });
      const preparation = t.repo.listPreparations(t.sid).find((p) => p.targetRef === targetRef)!;
      const known = new Set(
        (t.db.db.prepare("SELECT claim_ref FROM knowledge_belief").all() as Array<{ claim_ref: string }>).map(
          (r) => r.claim_ref,
        ),
      );

      for (const belief of preparation.currentUnderstanding.beliefs) {
        assert.ok(known.has(belief.claimRef), `belief ${belief.claimRef} resolves to a real knowledge_belief row`);
      }
      if (preparation.currentUnderstanding.beliefs.length === 0) {
        assert.equal(
          preparation.currentUnderstanding.knowledgeVersion,
          0,
          "no knowledge subject ⇒ the projection degrades honestly to version 0",
        );
      }
      // The projection still points at an INDUSTRY-level subject, never a company-level one (§21.4).
      const subject = t.db.db
        .prepare("SELECT subject_kind FROM industry_knowledge WHERE subject_id = ?")
        .all(t.sid) as Array<{ subject_kind: string }>;
      for (const row of subject) assert.equal(row.subject_kind, "industry", "no company-level Knowledge subject exists");
    } finally {
      t.db.close();
    }
  });
});
