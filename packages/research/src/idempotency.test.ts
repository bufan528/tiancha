/**
 * S2 · E2: idempotent identity — match-or-create on deterministic keys.
 *
 * Acceptance (from the S2 gate):
 *   T-A3 question identity stable (subject + dimension)
 *   T-A4 requirement identity stable (same question)
 *   T-A5 pool entry identity stable (same subject + requirement)
 *   T-A6 repeated ingest does not grow the skeleton
 *   T-A7 different subject / dimension does NOT wrongly merge
 *   T-A8 re-running the same operation leaves an identical skeleton state
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { questionKey, requirementKey, poolEntryKey } from "./domain/identity.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  return { db, repo, artifacts, svc };
}

/** Deterministic, order-stable snapshot of the idempotent skeleton (no timestamps/version). */
function skeletonSnapshot(repo: ResearchRepository, sid: string): string {
  return JSON.stringify({
    questions: repo.listQuestions(sid).map((q) => q.questionId).sort(),
    requirements: repo
      .listRequirements(sid)
      .map((r) => ({ id: r.requirementId, dim: r.dimension, imp: r.importance }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    pool: repo
      .listPoolEntries(sid)
      .map((p) => ({ id: p.entryId, topic: p.topic, status: p.status, refs: p.relatedRequirementIds }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    gaps: repo
      .listGaps(sid)
      .map((g) => ({ id: g.gapId, status: g.status, reqs: g.relatedRequirementIds }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    actions: repo
      .listNextActions(sid)
      .map((a) => ({ id: a.actionId, status: a.status }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  });
}

describe("S2 E2 idempotent identity", () => {
  test("T-A3 / T-A4 / T-A5: identity keys are deterministic and correctly linked", async () => {
    const { db, repo, svc } = setup();
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "新能源" });
    const sid = res.industry.industryId;

    // T-A3: question identity = subject + dimension
    assert.ok(repo.getQuestion(questionKey(sid, "market")), "question key is deterministic");
    assert.equal(repo.getQuestion(`q-${sid}-no_such_dimension`), undefined, "unknown dimension => no question");

    // T-A4: requirement identity is stable AND points at the stable question
    const req = repo.getRequirement(requirementKey(sid, "market"))!;
    assert.ok(req, "requirement key is deterministic");
    assert.equal(req.questionId, questionKey(sid, "market"), "requirement links to the stable question");

    // T-A5: pool entry identity stable, linked to the same requirement
    const pool = repo.getPoolEntry(poolEntryKey(sid, "market"))!;
    assert.ok(pool, "pool key is deterministic");
    assert.deepEqual(pool.relatedRequirementIds, [requirementKey(sid, "market")]);

    db.close();
  });

  test("T-A6 / T-A8: repeated ingest neither grows the skeleton nor changes its state", async () => {
    const { db, repo, svc } = setup();
    const first = await svc.ingestMaterial({ materialText: "first material", industryName: "固态电池" });
    const sid = first.industry.industryId;

    const before = {
      q: repo.listQuestions(sid).length,
      r: repo.listRequirements(sid).length,
      pool: repo.listPoolEntries(sid).length,
      gaps: repo.listGaps(sid).length,
      actions: repo.listNextActions(sid).length,
      snapshot: skeletonSnapshot(repo, sid),
    };

    // re-run the SAME semantic operation on the SAME industry
    await svc.ingestMaterial({ materialText: "second material", industryName: "固态电池" });

    const after = {
      q: repo.listQuestions(sid).length,
      r: repo.listRequirements(sid).length,
      pool: repo.listPoolEntries(sid).length,
      gaps: repo.listGaps(sid).length,
      actions: repo.listNextActions(sid).length,
      snapshot: skeletonSnapshot(repo, sid),
    };

    assert.equal(after.q, before.q, "questions must not grow");
    assert.equal(after.r, before.r, "requirements must not grow");
    assert.equal(after.pool, before.pool, "pool entries must not grow");
    assert.equal(after.gaps, before.gaps, "gaps must not grow");
    assert.equal(after.actions, before.actions, "next actions must not grow");
    // T-A8: identical final skeleton state
    assert.equal(after.snapshot, before.snapshot, "skeleton state must be identical after re-run");

    db.close();
  });

  test("T-A7: different subject does not wrongly merge (keys are subject-scoped)", async () => {
    const { db, repo, svc } = setup();
    const a = await svc.ingestMaterial({ materialText: "x", industryName: "新能源" });
    const b = await svc.ingestMaterial({ materialText: "x", industryName: "光伏" });
    const sidA = a.industry.industryId;
    const sidB = b.industry.industryId;

    assert.notEqual(sidA, sidB);
    assert.equal(repo.listQuestions(sidA).length, 12);
    assert.equal(repo.listQuestions(sidB).length, 12);
    assert.notEqual(questionKey(sidA, "market"), questionKey(sidB, "market"), "same dimension, different subject");
    assert.ok(repo.getQuestion(questionKey(sidA, "market")));
    assert.ok(repo.getQuestion(questionKey(sidB, "market")));

    db.close();
  });

  test("identity keys contain no timestamp / randomness (deterministic by construction)", () => {
    assert.equal(questionKey("ind-1", "market"), questionKey("ind-1", "market"));
    assert.equal(requirementKey("ind-1", "market"), "ir-ind-1-market");
    assert.equal(poolEntryKey("ind-1", "market"), "pe-ind-1-market");
    // no digits that look like a ms-timestamp / uuid segment
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}/.test(questionKey("ind-1", "market")));
  });
});
