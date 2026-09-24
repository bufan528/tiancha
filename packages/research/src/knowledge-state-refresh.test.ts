/**
 * Phase 2C Step 2-B-2-A: Pool -> ResearchState refresh tests.
 * S3: the Pool is now Slot + Item (read from `information_pool_slot`).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeProjectionService } from "./application/knowledge-projection-service.js";
import { emptyResearchState } from "./domain/index.js";
import type { InformationPoolSlot } from "./domain/index.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const svc = new KnowledgeProjectionService(db.db);
  return { db, repo, svc };
}

function mkSlot(
  subjectId: string,
  dimension: string,
  status: InformationPoolSlot["status"],
): InformationPoolSlot {
  const now = new Date().toISOString();
  return {
    slotId: `slot-${subjectId}-${dimension}`,
    subjectKind: "industry",
    subjectId,
    dimension,
    status,
    coverageJudgement: "test",
    createdAt: now,
    updatedAt: now,
  };
}

describe("Pool -> ResearchState refresh", () => {
  test("maps sufficient/partial/conflicting/unknown with known/uncertain split", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "market", "sufficient"));
    repo.upsertPoolSlot(mkSlot(subj, "demand", "partial"));
    repo.upsertPoolSlot(mkSlot(subj, "profitability", "conflicting"));
    repo.upsertPoolSlot(mkSlot(subj, "policy", "unknown"));

    svc.refreshState(subj, "industry");
    const s = repo.getStateBySubject("industry", subj)!;

    assert.equal(s.confirmed.length, 1);
    assert.equal(s.uncertain.length, 1);
    assert.equal(s.conflicting.length, 1);
    assert.equal(s.unknown.length, 1);
    // known = confirmed + partial (not mechanical union of all buckets)
    assert.equal(s.known.length, 2);
    // unknown never conflated into uncertain
    assert.equal(s.uncertain.every((r) => r.ref !== s.unknown[0].ref), true);
  });

  test("preserves existing gap/next-action/key-question ids; does not create them", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "market", "unknown"));
    // seed a prior state carrying auxiliary ids
    const prior = emptyResearchState({ stateId: `state-industry-${subj}`, subjectKind: "industry", subjectId: subj });
    prior.keyQuestionIds = ["q1"];
    prior.researchGapIds = ["g1", "g2"];
    prior.nextActionIds = ["a1"];
    repo.upsertState(prior);

    svc.refreshState(subj, "industry");
    const s = repo.getStateBySubject("industry", subj)!;
    assert.deepEqual(s.keyQuestionIds, ["q1"]);
    assert.deepEqual(s.researchGapIds, ["g1", "g2"]);
    assert.deepEqual(s.nextActionIds, ["a1"]);
    assert.equal(s.version, 2);
  });

  test("idempotent: repeated refresh yields same projection, version bumps but no dup ids", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "market", "partial"));
    svc.refreshState(subj, "industry");
    const s1 = repo.getStateBySubject("industry", subj)!;
    svc.refreshState(subj, "industry");
    const s2 = repo.getStateBySubject("industry", subj)!;
    assert.deepEqual(s1.confirmed, s2.confirmed);
    assert.deepEqual(s1.uncertain, s2.uncertain);
    assert.deepEqual(s1.known, s2.known);
    assert.equal(s2.version, s1.version + 1);
    // no duplicate state rows (single current projection by stateId)
    assert.equal(s1.stateId, s2.stateId);
  });

  test("subject isolation: refresh(A) does not touch B's state", () => {
    const { repo, svc } = setup();
    const subjA = "ind-" + randomUUID();
    const subjB = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subjA, "market", "sufficient"));
    repo.upsertPoolSlot(mkSlot(subjB, "market", "unknown"));

    svc.refreshState(subjA, "industry");
    const bBefore = repo.getStateBySubject("industry", subjB);
    svc.refreshState(subjB, "industry");
    const a = repo.getStateBySubject("industry", subjA)!;
    const b = repo.getStateBySubject("industry", subjB)!;

    assert.equal(a.confirmed.length, 1);
    assert.equal(b.unknown.length, 1);
    // B had no state before its own refresh; A refresh must not have created it
    assert.equal(bBefore, undefined);
  });

  test("one-way: refreshState does not modify pool slots", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "market", "unknown"));
    const before = repo.listPoolSlots(subj)[0];
    svc.refreshState(subj, "industry");
    const after = repo.listPoolSlots(subj)[0];
    assert.equal(after.status, before.status);
    assert.equal(after.dimension, before.dimension);
  });
});
