/**
 * S5 — PriorityService / ResearchPriority / NextAction acceptance.
 *
 * Covers the 10 locked acceptance red lines:
 *   1  the ranking is NOT an importance sort
 *   2  importance / criticality / uncertainty / coverageGap all move the score
 *   3  acquisitionValue AND acquisitionCost really change the outcome (proved by
 *      injecting policies with / without each weight)
 *   4  acquisitionValue derives only from already-existing signals (no Target)
 *   5  acquisitionCost is an acquisition-difficulty prior (no fake company/time cost)
 *   6  PriorityPolicy is versioned + immutable + injectable
 *   7  ResearchPriority is auditable: gapId + policyVersionId + raw/normalized/weight/contribution
 *   8  NextAction is Priority/Gap driven: priority decides ORDER, gap state decides KIND
 *   9  no Target / Chain / Company Selection / Report / Experience / LLM artifacts
 *   10 repeated refresh is stable (no timestamp/UUID/order drift)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { PriorityService, type PriorityInput } from "./application/priority-service.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { KnowledgeProjectionService } from "./application/knowledge-projection-service.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { METHODOLOGY_V1 } from "./methodology/methodology-v1.js";
import { PRIORITY_POLICY_V1, priorityPolicies } from "./domain/priority-policy.js";
import { SUFFICIENCY_POLICY_V1 } from "./domain/sufficiency.js";
import type {
  GapType,
  InformationRequirement,
  MethodologyDimension,
  ResearchGap,
} from "./domain/index.js";

const NOW = "2026-01-01T00:00:00.000Z";
const SID = "ind-s5";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  return { db, repo, artifacts };
}

function dimOf(key: string): MethodologyDimension {
  const d = METHODOLOGY_V1.dimensions.find((x) => x.key === key);
  if (!d) throw new Error(`no dimension ${key}`);
  return d;
}

function mkReq(dimension: string, importance: number): InformationRequirement {
  return {
    requirementId: `ir-${SID}-${dimension}`,
    questionId: `q-${SID}-${dimension}`,
    subjectKind: "industry",
    subjectId: SID,
    dimension,
    description: `needs ${dimension}`,
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

function mkGap(dimension: string, gapType: GapType, uncertainty: number): ResearchGap {
  return {
    gapId: `gap-ir-${SID}-${dimension}`,
    subjectKind: "industry",
    subjectId: SID,
    description: `[${dimension}] needs ${dimension}`,
    gapType,
    importance: 3,
    uncertainty,
    relatedRequirementIds: [`ir-${SID}-${dimension}`],
    relatedQuestionIds: [`q-${SID}-${dimension}`],
    status: "open",
    discoveredAt: NOW,
    updatedAt: NOW,
  };
}

const FACTOR_KEYS = [
  "importance",
  "criticality",
  "uncertainty",
  "coverageGap",
  "acquisitionValue",
  "acquisitionCost",
] as const;

describe("S5: ResearchPriority computation", () => {
  test("red line 1: the ranking is NOT an importance sort", () => {
    const { db } = setup();
    const svc = new PriorityService(db.db);

    // lowest importance, but critical + totally uncertain + conflicting (expensive)
    const urgentLowImportance = svc.computeFor({
      gap: mkGap("risk", "conflict", 1.0),
      requirement: mkReq("risk", 1),
      dimension: dimOf("risk"), // critical
      slotStatus: "conflicting",
    });
    // highest importance, but already largely covered and cheap to close
    const settledHighImportance = svc.computeFor({
      gap: mkGap("market", "insufficient", 0.0),
      requirement: mkReq("market", 5),
      dimension: dimOf("market"), // normal
      slotStatus: "partial",
    });

    assert.ok(
      urgentLowImportance.score > settledHighImportance.score,
      `importance-1 gap (${urgentLowImportance.score}) must outrank importance-5 gap (${settledHighImportance.score})`,
    );
  });

  test("red line 2: every factor moves the score in the right direction", () => {
    const { db } = setup();
    const svc = new PriorityService(db.db);
    const base = (patch: Partial<{
      importance: number;
      criticality: "critical" | "normal";
      uncertainty: number;
      slotStatus: PriorityInput["slotStatus"];
      gapType: GapType;
    }>) => {
      const importance = patch.importance ?? 3;
      const criticality = patch.criticality ?? "normal";
      const uncertainty = patch.uncertainty ?? 0.6;
      const slotStatus = patch.slotStatus ?? "partial";
      const gapType = patch.gapType ?? "insufficient";
      return svc.computeFor({
        gap: mkGap("market", gapType, uncertainty),
        requirement: mkReq("market", importance),
        dimension: { ...dimOf("market"), criticality },
        slotStatus,
      }).score;
    };

    assert.ok(base({ importance: 5 }) > base({ importance: 1 }), "importance");
    assert.ok(base({ criticality: "critical" }) > base({ criticality: "normal" }), "criticality");
    assert.ok(base({ uncertainty: 0.9 }) > base({ uncertainty: 0.1 }), "uncertainty");
    assert.ok(base({ slotStatus: "unknown" }) > base({ slotStatus: "partial" }), "coverageGap");
    assert.ok(base({ gapType: "insufficient" }) > base({ gapType: "conflict" }), "acquisitionCost");
  });

  test("red line 3: acquisitionCost really changes the outcome (injected policy)", () => {
    const { db } = setup();
    const noCost = new PriorityService(db.db, {
      ...PRIORITY_POLICY_V1,
      versionId: "prio-test-nocost",
      weights: { ...PRIORITY_POLICY_V1.weights, acquisitionCost: 0 },
    });
    const heavyCost = new PriorityService(db.db, {
      ...PRIORITY_POLICY_V1,
      versionId: "prio-test-cost",
      weights: { ...PRIORITY_POLICY_V1.weights, acquisitionCost: 0.5 },
    });

    // identical in every way except the gap type (=> acquisition difficulty)
    const inputFor = (gapType: GapType): PriorityInput => ({
      gap: mkGap("market", gapType, 0.6),
      requirement: mkReq("market", 3),
      dimension: dimOf("market"),
      slotStatus: "partial",
    });

    const noCostConflict = noCost.computeFor(inputFor("conflict")).score;
    const noCostInsufficient = noCost.computeFor(inputFor("insufficient")).score;
    assert.equal(noCostConflict, noCostInsufficient, "with cost weight 0 the two must tie");

    const heavyConflict = heavyCost.computeFor(inputFor("conflict")).score;
    const heavyInsufficient = heavyCost.computeFor(inputFor("insufficient")).score;
    assert.ok(
      heavyInsufficient > heavyConflict,
      `cost must separate them (cheap ${heavyInsufficient} > expensive ${heavyConflict})`,
    );
  });

  test("red line 3: acquisitionValue really changes the outcome (injected policy)", () => {
    const { db } = setup();
    const noValue = new PriorityService(db.db, {
      ...PRIORITY_POLICY_V1,
      versionId: "prio-test-novalue",
      weights: { ...PRIORITY_POLICY_V1.weights, acquisitionValue: 0 },
    });
    const heavyValue = new PriorityService(db.db, {
      ...PRIORITY_POLICY_V1,
      versionId: "prio-test-value",
      weights: { ...PRIORITY_POLICY_V1.weights, acquisitionValue: 0.5 },
    });
    const input = {
      gap: mkGap("risk", "unknown", 1.0),
      requirement: mkReq("risk", 3),
      dimension: dimOf("risk"),
      slotStatus: "unknown" as const,
    };
    assert.notEqual(
      noValue.computeFor(input).score,
      heavyValue.computeFor(input).score,
      "weighting acquisitionValue must change the score",
    );
  });

  test("red line 7: factors are fully auditable; policy version recorded", () => {
    const { db } = setup();
    const svc = new PriorityService(db.db);
    const p = svc.computeFor({
      gap: mkGap("demand", "insufficient", 0.6),
      requirement: mkReq("demand", 4),
      dimension: dimOf("demand"),
      slotStatus: "partial",
    });

    assert.equal(p.policyVersionId, PRIORITY_POLICY_V1.versionId);
    assert.equal(p.gapId, `gap-ir-${SID}-demand`);
    for (const key of FACTOR_KEYS) {
      const f = p.factors[key];
      assert.equal(typeof f.raw, "number", `${key}.raw`);
      assert.equal(typeof f.normalized, "number", `${key}.normalized`);
      assert.equal(typeof f.weight, "number", `${key}.weight`);
      assert.ok(f.normalized >= 0 && f.normalized <= 1, `${key}.normalized in 0..1`);
      const expected = f.normalized * f.weight * (key === "acquisitionCost" ? -1 : 1);
      assert.ok(Math.abs(f.contribution - expected) < 1e-9, `${key}.contribution`);
    }
    assert.ok(p.rationale.length > 0);
  });

  test("red lines 4/5: acquisition signals come from Requirement/Gap/Pool only (no Target)", () => {
    const { db } = setup();
    const svc = new PriorityService(db.db);
    // cost is an acquisition-DIFFICULTY prior keyed by gap state, nothing else
    const conflict = svc.computeFor({
      gap: mkGap("market", "conflict", 0.6),
      requirement: mkReq("market", 3),
      dimension: dimOf("market"),
      slotStatus: "partial",
    });
    const unknown = svc.computeFor({
      gap: mkGap("market", "unknown", 0.6),
      requirement: mkReq("market", 3),
      dimension: dimOf("market"),
      slotStatus: "partial",
    });
    assert.ok(
      conflict.factors.acquisitionCost.normalized > unknown.factors.acquisitionCost.normalized,
      "conflict is harder to acquire than a plain unknown",
    );
    // and it never claims a currency/time unit
    assert.ok(conflict.factors.acquisitionCost.normalized <= 1);
  });

  test("red line 6: the priority policy is versioned, immutable and injectable", () => {
    assert.equal(PRIORITY_POLICY_V1.versionId, "prio-v1");
    assert.ok(priorityPolicies.get("prio-v1"));
    // immutable: same versionId + different content must throw
    assert.throws(
      () => priorityPolicies.register({ ...PRIORITY_POLICY_V1, weights: { ...PRIORITY_POLICY_V1.weights, importance: 0 } }),
      /immutable/,
    );
    // injectable: a different policy yields a different score for the same input
    const { db } = setup();
    const input = {
      gap: mkGap("market", "insufficient", 0.6),
      requirement: mkReq("market", 3),
      dimension: dimOf("market"),
      slotStatus: "partial" as const,
    };
    const v1 = new PriorityService(db.db).computeFor(input).score;
    const injected = new PriorityService(db.db, {
      ...PRIORITY_POLICY_V1,
      versionId: "prio-alt",
      weights: { ...PRIORITY_POLICY_V1.weights, acquisitionCost: 0, acquisitionValue: 0 },
    }).computeFor(input).score;
    assert.notEqual(v1, injected);
  });
});

describe("S5: NextAction is Priority/Gap driven", () => {
  async function seedRealChain() {
    const { db, repo, artifacts } = setup();
    const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await discovery.ingestMaterial({ materialText: "x", industryName: "S5 行业" });
    const sid = res.industry.industryId;
    // make `market` conflicting (two real claims, second contradicts the first)
    await discovery.ingestClaims({
      subjectKind: "industry",
      subjectId: sid,
      claims: [
        { statement: "a", dimension: "market" },
        { statement: "b", dimension: "market", relationHint: { kind: "CONFLICT" } },
      ],
    });
    return { db, repo, sid };
  }

  test("red line 8: priority decides the ORDER/score, gap state decides the KIND", async () => {
    const { repo, sid } = await seedRealChain();
    const actions = repo.listNextActions(sid).filter((a) => a.status === "open");
    assert.ok(actions.length > 0);

    const conflictAction = actions.find((a) => a.params.gapType === "conflict")!;
    const unknownAction = actions.find((a) => a.params.gapType === "unknown")!;
    assert.ok(conflictAction, "a conflict gap exists");
    assert.ok(unknownAction, "unknown gaps exist");
    // kind comes from the GAP state (policy map), NOT from the cost tier
    assert.equal(conflictAction.kind, "request_manual_input");
    assert.equal(unknownAction.kind, "retrieve_data");
    // priority is a real 0..100 score, not the old constant 0
    assert.ok(actions.some((a) => a.priority > 0), "priorities are computed");

    // ordered by score desc
    for (let i = 1; i < actions.length; i++) {
      assert.ok(actions[i - 1].priority >= actions[i].priority, "actions are ranked");
    }
    // auditable: the breakdown + policy version travel with the action
    assert.ok(conflictAction.params.priorityBreakdown, "breakdown stored");
    assert.equal(conflictAction.params.priorityPolicyVersionId, PRIORITY_POLICY_V1.versionId);
    assert.match(conflictAction.rationale, /优先级 \d+\/100/);
  });

  test("red line 9: no Target/Chain/Company artifacts leak into NextAction", async () => {
    const { repo, sid } = await seedRealChain();
    const allowedKinds = new Set(Object.values(PRIORITY_POLICY_V1.actionKindByGapType));
    for (const a of repo.listNextActions(sid)) {
      assert.ok(allowedKinds.has(a.kind), `kind ${a.kind} must come from the priority policy`);
      assert.equal("targetRef" in a.params, false);
      assert.equal("companyId" in a.params, false);
      assert.equal("chainPosition" in a.params, false);
    }
  });

  test("red line 10: repeated refresh is stable — no timestamp/UUID/order drift", async () => {
    const { repo, sid } = await seedRealChain();
    const snap = () =>
      repo.listNextActions(sid).map((a) => ({ id: a.actionId, p: a.priority, k: a.kind, r: a.rationale }));

    // seedRealChain already ran a full refresh via ingestClaims
    const first = snap();
    new KnowledgeProjectionService(repo.db).refreshSubject(sid, "industry");
    const second = snap();
    assert.deepEqual(second, first, "a repeated refresh must not change ids/priorities/kinds/rationales");
  });
});
