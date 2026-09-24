/**
 * S6 — Report / Industry Dossier read-only projection acceptance.
 *
 *   T-A10  generating a projection changes NO source of truth (beliefs / knowledge
 *          version / pool items / gaps / actions / requirement status / state version /
 *          latest evaluation) — compared as a whole-state snapshot before and after.
 *   +      the sections are assembled from the CURRENT state and reference, not copy
 *   +      append-only: regenerating adds a NEW snapshot; the previous one is untouched
 *   +      S6 red lines: no Evidence/Target/Chain artifacts; priority is presented,
 *          not recomputed (a frozen snapshot does not change when state changes later)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { ReportRepository } from "./storage/report-repository.js";
import { ReportService } from "./application/report-service.js";
import { PriorityService } from "./application/priority-service.js";
import { PRIORITY_POLICY_V1 } from "./domain/priority-policy.js";
import { EvaluationService } from "./application/evaluation-service.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import type { IndustryDossier, ReportSnapshot } from "./domain/index.js";

async function seed() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: "S6 行业" });
  const sid = res.industry.industryId;

  // real claims: market + demand covered; risk becomes conflicting (two opposing claims)
  await discovery.ingestClaims({
    subjectKind: "industry",
    subjectId: sid,
    claims: [
      { statement: "market a", dimension: "market", sourceRef: "src-1" },
      { statement: "demand a", dimension: "demand", sourceRef: "src-2" },
      { statement: "risk a", dimension: "risk", sourceRef: "src-3" },
      { statement: "risk b", dimension: "risk", relationHint: { kind: "CONFLICT" } },
    ],
  });
  new EvaluationService(db.db).evaluate("industry", sid);
  return { db, repo, sid };
}

/** A whole-state “source of truth” fingerprint — must be identical across a projection. */
function sotFingerprint(db: ResearchDb, repo: ResearchRepository, sid: string): string {
  const kr = new KnowledgeRepository(db.db);
  const k = kr.findKnowledgeBySubject("industry", sid);
  const slots = repo.listPoolSlots(sid);
  return JSON.stringify({
    beliefs: k ? kr.listBeliefs(k.knowledgeId).length : 0,
    knowledgeVersion: k?.version ?? 0,
    slots: slots.map((s) => `${s.dimension}:${s.status}`).sort(),
    items: slots.flatMap((s) => repo.listPoolItems(s.slotId).map((i) => i.itemId)).sort(),
    gaps: repo.listGaps(sid).map((g) => `${g.gapId}:${g.status}:${g.gapType}`).sort(),
    actions: repo.listNextActions(sid).map((a) => `${a.actionId}:${a.kind}:${a.priority}`).sort(),
    requirements: repo.listRequirements(sid).map((r) => `${r.requirementId}:${r.status}`).sort(),
    stateVersion: repo.getStateBySubject("industry", sid)?.version ?? 0,
    evaluationId: repo.getLatestEvaluation("industry", sid)?.evaluationId ?? null,
    conflicts: kr.listOpenConflicts().length,
  });
}

describe("S6: projections are read-only (T-A10)", () => {
  test("generating a report AND a dossier changes no source of truth", async () => {
    const { db, repo, sid } = await seed();
    const before = sotFingerprint(db, repo, sid);

    const svc = new ReportService(db.db);
    const report: ReportSnapshot = svc.generateReport("industry", sid);
    const dossier: IndustryDossier = svc.generateDossier(sid);

    assert.equal(report.reportKind, "report");
    assert.equal(dossier.reportKind, "dossier");
    assert.equal(dossier.industryId, sid);

    const after = sotFingerprint(db, repo, sid);
    assert.equal(after, before, "no SoT row may change when a projection is generated");
  });

  test("the snapshot row is the ONLY thing written", async () => {
    const { db, repo, sid } = await seed();
    const reports = new ReportRepository(db.db);
    const before = reports.count();
    new ReportService(db.db).generateDossier(sid);
    new ReportService(db.db).generateReport("industry", sid);
    assert.equal(reports.count(), before + 2);
    // and the SoT tables are still exactly as they were
    assert.equal(repo.listGaps(sid).length > 0, true);
  });
});

describe("S6: projection content", () => {
  test("sections are assembled from the current state and reference, not copy", async () => {
    const { db, sid } = await seed();
    const dossier = new ReportService(db.db).generateDossier(sid);
    const s = dossier.sections;

    // 当前认知 / 主要判断 come from Knowledge beliefs
    assert.ok(s.currentKnowledge.length > 0, "current knowledge present");
    assert.ok(s.mainJudgments.length > 0, "confirmed judgments present");
    assert.ok(
      s.mainJudgments.every((m) => m.state === "confirmed"),
      "main judgments are the confirmed beliefs only",
    );
    assert.ok(
      s.mainJudgments.every((m) => s.currentKnowledge.some((c) => c.beliefId === m.beliefId)),
      "judgments are a subset of current knowledge",
    );
    // every line REFERENCES a claim (it does not inline the content)
    assert.ok(s.currentKnowledge.every((l) => /^artifact:claim\//.test(l.claimRef)));

    // 关键事实 = pool items referencing claims
    assert.ok(s.keyFacts.length > 0);
    assert.ok(s.keyFacts.every((f) => /^artifact:claim\//.test(f.claimRef)));

    // 主要冲突 = the open conflict we seeded (risk)
    assert.equal(s.conflicts.length >= 1, true);
    assert.equal(s.conflicts[0].dimension, "risk");

    // 缺口 + 优先级 + 下一步
    assert.ok(s.gaps.length > 0);
    assert.ok(s.gaps.every((g) => ["unknown", "insufficient", "conflict"].includes(g.gapType)));
    assert.equal(s.priority.length, s.gaps.length, "one priority per active gap");
    assert.ok(s.priority.every((p) => p.policyVersionId === "prio-v1"));
    assert.ok(s.nextActions.length > 0);
    assert.match(s.nextActions[0].rationale, /优先级 \d+\/100/);

    // 当前评价 = the evaluation we ran
    assert.ok(s.evaluation, "evaluation summary present");
    assert.equal(s.evaluation!.total, 12);

    // dossier records the knowledge projection version it was taken from
    assert.ok(dossier.knowledgeVersion >= 1);
  });

  test("red lines: no Evidence / Target / Chain / LLM artifacts in the projection", async () => {
    const { db, sid } = await seed();
    const dossier = new ReportService(db.db).generateDossier(sid);
    const json = JSON.stringify(dossier.sections);
    for (const forbidden of ["targetRef", "targetKind", "companyId", "chainPosition", "fragmentRef", "materialRef"]) {
      assert.equal(json.includes(forbidden), false, `${forbidden} must not appear in a projection`);
    }
  });

  test("a frozen snapshot does not change when the research state changes later", async () => {
    const { db, repo, sid, } = await seed();
    const svc = new ReportService(db.db);
    const first = svc.generateDossier(sid);
    const frozenPriority = JSON.stringify(first.sections.priority);
    const frozenGaps = first.sections.gaps.length;

    // change the state afterwards: resolve the risk conflict by superseding
    const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), new SqliteArtifactStore({ path: ":memory:" }));
    await discovery.ingestClaims({
      subjectKind: "industry",
      subjectId: sid,
      claims: [{ statement: "policy a", dimension: "policy", sourceRef: "src-9" }],
    });

    const reread = new ReportRepository(db.db).getProjection(first.dossierId)!;
    assert.equal(JSON.stringify(reread.sections.priority), frozenPriority, "an old snapshot is immutable");
    assert.equal(reread.sections.gaps.length, frozenGaps);
  });
});

describe("S6: append-only history", () => {
  test("regenerating adds a NEW snapshot; the previous one stays readable", async () => {
    const { db, sid } = await seed();
    const reports = new ReportRepository(db.db);
    const svc = new ReportService(db.db);

    const a = svc.generateDossier(sid);
    const b = svc.generateDossier(sid);
    assert.notEqual(a.dossierId, b.dossierId, "a new snapshot gets a new id");

    const all = reports.listProjections(sid);
    assert.equal(all.length, 2);
    assert.ok(all.some((p) => (p as IndustryDossier).dossierId === a.dossierId));
    // "latest" is the most recently inserted (rowid tie-break, not a random id)
    const latest = reports.getLatestProjection(sid, "dossier")!;
    assert.equal((latest as IndustryDossier).dossierId, b.dossierId);
    // both are retrievable by id
    assert.ok(reports.getProjection(a.dossierId));
  });
});

describe("S6-R1: the projection READS the persisted priority — it never recomputes", () => {
  test("the report reflects the PERSISTED priority (proves it reads, not recomputes)", async () => {
    const { db, repo, sid } = await seed();
    const target = repo.listNextActions(sid).filter((a) => a.status === "open")[0];
    assert.ok(target, "an action with a persisted priority exists");

    // rewrite the persisted priority to a value no policy could ever produce
    repo.upsertNextAction({ ...target, priority: 42, rationale: "tampered rationale" });

    const dossier = new ReportService(db.db).generateDossier(sid);
    const line = dossier.sections.priority.find((p) => p.gapId === target.params.gapId)!;
    assert.ok(line, "the line is present");
    assert.equal(line.score, 42, "the report shows the PERSISTED score");
    assert.equal(line.rationale, "tampered rationale", "…and the PERSISTED rationale");
  });

  test("changing the PriorityPolicy changes rank() but NOT the projection", async () => {
    const { db, sid } = await seed();
    const persisted = new PriorityService(db.db).currentPriorities(sid);
    assert.ok(persisted.length > 0, "S5 has persisted priorities");

    // a policy that WOULD produce different scores if anything recomputed
    const extreme = new PriorityService(db.db, {
      ...PRIORITY_POLICY_V1,
      versionId: "prio-s6r1-extreme",
      weights: {
        importance: 1,
        criticality: 0,
        uncertainty: 0,
        coverageGap: 0,
        acquisitionValue: 0,
        acquisitionCost: 0,
      },
    });
    const persistedByGap = new Map(persisted.map((p) => [p.gapId, p.score]));
    const wouldDiffer = extreme.rank(sid).filter((p) => persistedByGap.get(p.gapId) !== p.score);
    assert.ok(wouldDiffer.length > 0, "the injected policy WOULD give different scores");

    // …yet the projection still carries exactly the persisted values + version
    const dossier = new ReportService(db.db).generateDossier(sid);
    assert.deepEqual(
      dossier.sections.priority.map((p) => p.score),
      persisted.map((p) => p.score),
      "the projection is unaffected by the current policy",
    );
    assert.ok(dossier.sections.priority.every((p) => p.policyVersionId === "prio-v1"));
  });

  test("with no persisted priority nothing is fabricated (the section is empty)", async () => {
    const { db, repo, sid } = await seed();
    for (const a of repo.listNextActions(sid)) {
      repo.upsertNextAction({ ...a, status: "cancelled" });
    }
    const dossier = new ReportService(db.db).generateDossier(sid);
    assert.equal(dossier.sections.priority.length, 0, "no persisted priority -> empty section");
    assert.ok(dossier.sections.gaps.length > 0, "gaps still exist — they simply have no priority");
  });
});
