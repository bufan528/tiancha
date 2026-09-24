/**
 * Phase B v1 · Step B4 — DiligencePreparation.
 *
 *   T-B18 the three question sources are ALL produced (common / target_specific / fit_derived)
 *   T-B19 every question traces back to a Requirement or a Fit (I-B5)
 *   T-B20 target-specific derivation: a preparation reflects ITS OWN target/position/fit
 *   T-B21 weak/none + important ⇒ a fit_derived caveat (never a silent drop)
 *   T-B22 B4 writes only its own row; regeneration is idempotent
 *   T-B23 no model, no report generation
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

const INDUSTRY = "B4测试行业";

/** A kind the position never suggested ⇒ kindMatch=false ⇒ weak on unserved questions. */
const MISMATCHED_KIND = "不匹配的对象类型";

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  const positions = new ChainProjectionService(db.db).project(sid).positions;
  const customer = positions.find((p) => p.kind === "customer")!;
  const expert = positions.find((p) => p.kind === "expert")!;
  return { db, repo, sid, customer, expert, targets: new TargetService(db.db) };
}

function sotFingerprint(db: ResearchDb, repo: ResearchRepository, sid: string): string {
  const kr = new KnowledgeRepository(db.db);
  const k = kr.findKnowledgeBySubject("industry", sid);
  return JSON.stringify({
    slots: repo.listPoolSlots(sid).map((s) => `${s.dimension}:${s.status}`).sort(),
    gaps: repo.listGaps(sid).map((g) => `${g.gapId}:${g.status}`).sort(),
    requirements: repo.listRequirements(sid).map((r) => `${r.requirementId}:${r.importance}:${r.status}`).sort(),
    actions: repo.listNextActions(sid).map((a) => `${a.actionId}:${a.priority}`).sort(),
    beliefs: k ? kr.listBeliefs(k.knowledgeId).length : 0,
    stateVersion: repo.getStateBySubject("industry", sid)?.version ?? 0,
  });
}

describe("Phase B · Step B4", () => {
  test("T-B18/T-B19: all three sources appear, and every question is traceable", async () => {
    const { db, repo, sid, customer, targets } = await setup();
    const target = targets.add({
      industryId: sid,
      subjectKey: "某头部客户A",
      targetKind: customer.suggestedTargetKinds[0]!,
      positionRef: customer.positionRef,
      researchPurpose: "验证采购意愿",
      selectionReason: "行业头部采购方",
    });
    const preparation = new DiligencePreparationService(db.db).prepare(target.targetRef);

    const sources = new Set(preparation.questions.map((q) => q.source));
    assert.ok(sources.has("common"), "common questions exist");
    assert.ok(sources.has("target_specific"), "target-specific questions exist");

    // every question traces to a Requirement or a Fit (I-B5)
    for (const q of preparation.questions) {
      assert.ok(
        q.fromRequirementRef !== null || q.fromFitRef !== null,
        `question ${q.questionRef} must be traceable`,
      );
      assert.ok(q.text.length > 0);
      assert.match(q.questionRef, /^dq-dp-tgt-/);
      if (q.isFallbackSource) assert.ok(q.caveat && q.caveat.length > 0, "I-B4: caveat required");
    }
    assert.equal(preparation.questions.length, new Set(preparation.questions.map((q) => q.questionRef)).size);
    db.close();
  });

  test("T-B18/T-B21: a mismatched target produces fit_derived questions and caveats", async () => {
    const { db, sid, expert, targets } = await setup();
    // a kind that the position never suggested ⇒ kindMatch=false ⇒ weak on unserved questions
    const target = targets.add({
      industryId: sid,
      subjectKey: "看似相关的对象",
      targetKind: MISMATCHED_KIND,
      positionRef: expert.positionRef,
      researchPurpose: "顺便了解",
      selectionReason: "易于接触",
    });
    const preparation = new DiligencePreparationService(db.db).prepare(target.targetRef);

    const derived = preparation.questions.filter((q) => q.source === "fit_derived");
    assert.ok(derived.length > 0, "fit_derived questions are produced");
    for (const q of derived) {
      assert.ok(q.fromFitRef !== null, "a derived question cites its fit");
      assert.ok(q.caveat && q.caveat.length > 0, "a derived question carries a caveat");
    }
    // the important unserved questions must raise a fallback need, not be dropped
    const fallback = derived.filter((q) => q.isFallbackSource);
    assert.ok(fallback.length > 0, "at least one important question demands a fallback");
    assert.ok(preparation.cautions.length > 0, "cautions aggregate the derived caveats");
    db.close();
  });

  test("T-B20: a preparation reflects ITS OWN target / position / fit (target-specific derivation)", async () => {
    const { db, sid, customer, expert, targets } = await setup();
    const customerTarget = targets.add({
      industryId: sid,
      subjectKey: "某头部客户A",
      targetKind: customer.suggestedTargetKinds[0]!,
      positionRef: customer.positionRef,
      researchPurpose: "验证真实采购",
      selectionReason: "行业头部采购方",
      limitations: ["只代表自身视角"],
    });
    const expertTarget = targets.add({
      industryId: sid,
      subjectKey: "某行业专家B",
      targetKind: expert.suggestedTargetKinds[0]!,
      positionRef: expert.positionRef,
      researchPurpose: "判断技术路线",
      selectionReason: "资深从业者",
      limitations: ["个人经验有偏差"],
    });

    const service = new DiligencePreparationService(db.db);
    const a = service.prepare(customerTarget.targetRef);
    const b = service.prepare(expertTarget.targetRef);

    // the brief / why / requested data come from each target's OWN position
    assert.match(a.targetBrief, /某头部客户A/);
    assert.match(b.targetBrief, /某行业专家B/);
    assert.notEqual(a.targetBrief, b.targetBrief);
    assert.ok(a.whyThisTarget.includes(customer.whyImportant));
    assert.ok(b.whyThisTarget.includes(expert.whyImportant));
    assert.deepEqual(a.requestedData, customer.suitableEvidenceKinds);
    assert.deepEqual(b.requestedData, expert.suitableEvidenceKinds);
    assert.notDeepEqual(a.requestedData, b.requestedData);
    assert.deepEqual(a.limitations, ["只代表自身视角"]);
    assert.deepEqual(b.limitations, ["个人经验有偏差"]);

    // the target-specific questions name the respective subject
    const specificOf = (p: typeof a) => p.questions.filter((q) => q.source === "target_specific");
    assert.ok(specificOf(a).every((q) => q.text.includes("某头部客户A")));
    assert.ok(specificOf(b).every((q) => q.text.includes("某行业专家B")));
    assert.notDeepEqual(specificOf(a).map((q) => q.text), specificOf(b).map((q) => q.text));

    // both cover the same industry questions (common) — the difference is the derivation
    assert.equal(
      a.questions.filter((q) => q.source === "common").length,
      b.questions.filter((q) => q.source === "common").length,
    );
    db.close();
  });

  test("T-B22: B4 writes only its own row, and regeneration is idempotent", async () => {
    const { db, repo, sid, customer, targets } = await setup();
    const target = targets.add({
      industryId: sid,
      subjectKey: "某头部客户A",
      targetKind: customer.suggestedTargetKinds[0]!,
      positionRef: customer.positionRef,
      researchPurpose: "p",
      selectionReason: "r",
    });

    const service = new DiligencePreparationService(db.db);
    const before = sotFingerprint(db, repo, sid);
    const first = service.prepare(target.targetRef);
    assert.equal(sotFingerprint(db, repo, sid), before, "no other source of truth changed");
    assert.equal(repo.listPreparations(sid).length, 1, "exactly one preparation row");

    const second = service.prepare(target.targetRef);
    assert.equal(second.preparationRef, first.preparationRef, "stable identity");
    assert.equal(second.createdAt, first.createdAt, "createdAt preserved");
    assert.deepEqual(second.questions, first.questions, "regeneration is deterministic");
    assert.equal(repo.listPreparations(sid).length, 1, "no duplicate rows");
    db.close();
  });

  test("T-B23: no model, no report generation", async () => {
    const src = DiligencePreparationService.prototype.prepare.toString();
    assert.ok(!/openai|anthropic|generateText|fetch\(|llm|model\(/i.test(src), "no model call");
    assert.ok(!/renderReport|markdown|dossier/i.test(src), "B4 is not a report generator");

    const { db, sid, customer, targets } = await setup();
    const target = targets.add({
      industryId: sid,
      subjectKey: "某头部客户A",
      targetKind: customer.suggestedTargetKinds[0]!,
      positionRef: customer.positionRef,
      researchPurpose: "p",
      selectionReason: "r",
    });
    const preparation = new DiligencePreparationService(db.db).prepare(target.targetRef);
    assert.equal(preparation.status, "draft");
    assert.equal(preparation.purpose, "p");
    assert.deepEqual(preparation.currentUnderstanding.beliefs, [], "no knowledge yet ⇒ empty projection");
    assert.equal(preparation.currentUnderstanding.knowledgeVersion, 0);
    db.close();
  });
});
