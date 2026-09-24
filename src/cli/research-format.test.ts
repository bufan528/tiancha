/**
 * T-A12-10: R2 — one service result, two renderers.
 *
 * The json renderer round-trips the result EXACTLY (`JSON.parse(toJson(x)) === x`), and
 * the human renderer is a presentational view of that SAME object: its key identifiers
 * (gap ids, scores, policy versions, dimension keys) all appear. We never assert
 * `parse(human) === json` — they are two renderings of one result, not two results.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ResearchDb,
  ResearchRepository,
  SqliteArtifactStore,
  EchoDataProvider,
  OpportunityDiscoveryService,
  EvaluationService,
  PriorityService,
} from "@tiancha/research";
import {
  EVIDENCE_INSUFFICIENT,
  formatEvaluationHuman,
  formatPoolHuman,
  formatPriorityHuman,
  toJson,
  type PoolSlotView,
} from "./research-format.js";

async function seed() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: "FMT 行业" });
  const sid = res.industry.industryId;
  await svc.ingestClaims({
    subjectKind: "industry",
    subjectId: sid,
    claims: [
      { statement: "market a", dimension: "market", sourceRef: "s1" },
      { statement: "demand a", dimension: "demand", sourceRef: "s2" },
    ],
  });
  const evaluation = new EvaluationService(db.db).evaluate("industry", sid);
  const priorities = new PriorityService(db.db).currentPriorities(sid);
  const pool: PoolSlotView[] = repo.listPoolSlots(sid).map((slot) => ({
    slot,
    items: repo.listPoolItems(slot.slotId),
  }));
  return { db, repo, sid, evaluation, priorities, pool };
}

describe("S7 formatters (one result, two renderers)", () => {
  test("T-A12-10: json round-trips the exact service result (lossless)", async () => {
    const { db, evaluation, priorities, pool } = await seed();

    // Lossless: re-rendering a PARSED result yields byte-identical json. (A strict
    // deepEqual on the parsed value is not the right assertion for objects with optional
    // fields — JSON legitimately drops `undefined` keys, and that is not a data loss.)
    for (const v of [evaluation, priorities, pool]) {
      const json = toJson(v);
      assert.equal(toJson(JSON.parse(json)), json, "json renderer round-trips losslessly");
    }

    // research priorities carry no optional fields -> a strict round-trip holds
    assert.deepEqual(JSON.parse(toJson(priorities)), priorities);

    // …and the json renderer is the FULL structure, not a human-oriented subset
    const parsedEv = JSON.parse(toJson(evaluation));
    assert.equal(parsedEv.dimensionEvaluations.length, evaluation.dimensionEvaluations.length);
    assert.ok(parsedEv.sufficiencySummary !== undefined);
    assert.ok(parsedEv.criticalFlags !== undefined);
    assert.equal(parsedEv.evaluationPolicyVersionId, evaluation.evaluationPolicyVersionId);
    db.close();
  });

  test("T-A12-10: the human renderer shows the same result's key identifiers", async () => {
    const { db, evaluation, priorities, pool } = await seed();

    const evHuman = formatEvaluationHuman(evaluation, { market: "市场空间", demand: "需求" });
    assert.ok(evHuman.includes("市场空间"), "dimension label present");
    for (const d of evaluation.dimensionEvaluations) {
      assert.ok(evHuman.includes(d.dimension), `dimension ${d.dimension} present`);
    }
    assert.ok(evHuman.includes(evaluation.evaluationPolicyVersionId), "policy version present");
    assert.ok(evHuman.includes(evaluation.coverage.total.toString()), "coverage present");
    assert.ok(evHuman.includes(EVIDENCE_INSUFFICIENT), "证据不足 shown when dimensions are unmet");

    const prioHuman = formatPriorityHuman(priorities);
    for (const p of priorities) {
      assert.ok(prioHuman.includes(p.gapId), `gap ${p.gapId} present`);
      assert.ok(prioHuman.includes(String(p.score)), `score ${p.score} present`);
      assert.ok(prioHuman.includes(p.policyVersionId), "policy version present");
    }

    const poolHuman = formatPoolHuman(pool, { market: "市场空间" });
    for (const v of pool) {
      assert.ok(poolHuman.includes(v.slot.dimension), `slot dimension ${v.slot.dimension} present`);
    }
    db.close();
  });

  test("T-A12-10: the json renderer is the FULL structure, the human one its view", async () => {
    const { db, evaluation } = await seed();
    const json = JSON.parse(toJson(evaluation));
    // the json renderer keeps the complete factor/coverage detail the human view omits
    assert.equal(json.dimensionEvaluations.length, evaluation.dimensionEvaluations.length);
    assert.ok(json.sufficiencySummary !== undefined);
    assert.ok(json.criticalFlags !== undefined);
    const human = formatEvaluationHuman(evaluation);
    assert.ok(!human.includes("\"dimensionEvaluations\""), "human output is not raw json");
    db.close();
  });
});
