/**
 * Phase 2C Step 2-B-3-A: Gap evaluation tests.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeProjectionService } from "./application/knowledge-projection-service.js";
import type { InformationPoolEntry, InformationRequirement } from "./domain/index.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const svc = new KnowledgeProjectionService(db.db);
  return { db, repo, svc };
}

function mkReq(subjectId: string, dimension: string, importance: number): InformationRequirement {
  const now = new Date().toISOString();
  return {
    requirementId: "req-" + randomUUID(),
    questionId: "q-" + randomUUID(),
    subjectKind: "industry",
    subjectId,
    dimension,
    description: "需要掌握 " + dimension,
    importance,
    requiredEvidenceType: "text",
    confirmedCondition: "c",
    uncertainCondition: "u",
    unknownCondition: "n",
    preferredPositionKinds: [],
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
}

function mkPool(subjectId: string, topic: string, status: InformationPoolEntry["status"]): InformationPoolEntry {
  const now = new Date().toISOString();
  return {
    entryId: "pe-" + randomUUID(),
    subjectKind: "industry",
    subjectId,
    topic,
    status,
    relatedRequirementIds: [],
    evidenceRefs: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("Gap evaluation (Requirement-centered)", () => {
  test("high+unknown creates gap; low+unknown does not", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    const high = mkReq(subj, "market", 3);
    const low = mkReq(subj, "policy", 1);
    repo.upsertRequirement(high);
    repo.upsertRequirement(low);
    repo.upsertPoolEntry(mkPool(subj, "market", "unknown"));
    repo.upsertPoolEntry(mkPool(subj, "policy", "unknown"));

    svc.refreshGaps(subj, "industry");
    const gaps = repo.listGaps(subj);
    assert.equal(gaps.length, 1);
    assert.deepEqual(gaps[0].relatedRequirementIds, [high.requirementId]);
    assert.deepEqual(gaps[0].relatedQuestionIds, [high.questionId]);
  });

  test("high+partial creates gap (partial != sufficient)", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    const r = mkReq(subj, "demand", 2);
    repo.upsertRequirement(r);
    repo.upsertPoolEntry(mkPool(subj, "demand", "partial"));
    svc.refreshGaps(subj, "industry");
    assert.equal(repo.listGaps(subj).length, 1);
  });

  test("confirmed closes active gap (row kept, not deleted)", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    const r = mkReq(subj, "technology", 3);
    repo.upsertRequirement(r);
    repo.upsertPoolEntry(mkPool(subj, "technology", "unknown"));
    svc.refreshGaps(subj, "industry");
    assert.equal(repo.listGaps(subj).length, 1);
    // now confirmed (update the SAME pool entry, not a second one)
    const entry = repo.listPoolEntries(subj)[0];
    repo.upsertPoolEntry({ ...entry, status: "confirmed" });
    svc.refreshGaps(subj, "industry");
    const gaps = repo.listGaps(subj);
    assert.equal(gaps.length, 1); // row preserved
    assert.equal(gaps[0].status, "resolved");
  });

  test("high+conflict keeps conflict gap (no auto-resolution)", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    const r = mkReq(subj, "profitability", 3);
    repo.upsertRequirement(r);
    repo.upsertPoolEntry(mkPool(subj, "profitability", "conflict"));
    svc.refreshGaps(subj, "industry");
    const g = repo.listGaps(subj);
    assert.equal(g.length, 1);
    assert.equal(g[0].status, "open");
  });

  test("idempotent: repeated refresh does not duplicate gaps", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    const r = mkReq(subj, "market", 3);
    repo.upsertRequirement(r);
    repo.upsertPoolEntry(mkPool(subj, "market", "unknown"));
    svc.refreshGaps(subj, "industry");
    svc.refreshGaps(subj, "industry");
    svc.refreshGaps(subj, "industry");
    assert.equal(repo.listGaps(subj).length, 1);
  });

  test("subject isolation: A gaps do not pollute B", () => {
    const { repo, svc } = setup();
    const subjA = "ind-" + randomUUID();
    const subjB = "ind-" + randomUUID();
    const ra = mkReq(subjA, "market", 3);
    repo.upsertRequirement(ra);
    repo.upsertPoolEntry(mkPool(subjA, "market", "unknown"));
    svc.refreshGaps(subjA, "industry");
    assert.equal(repo.listGaps(subjB).length, 0);
    assert.equal(repo.listGaps(subjA).length, 1);
  });

  test("one-way: refreshGaps does not modify pool", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    const r = mkReq(subj, "market", 3);
    repo.upsertRequirement(r);
    repo.upsertPoolEntry(mkPool(subj, "market", "unknown"));
    const before = repo.listPoolEntries(subj)[0];
    svc.refreshGaps(subj, "industry");
    const after = repo.listPoolEntries(subj)[0];
    assert.equal(after.status, before.status);
  });
});

describe("Gap -> NextAction refresh", () => {
  test("creates one action per active gap, idempotent", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    const r = mkReq(subj, "market", 3);
    repo.upsertRequirement(r);
    repo.upsertPoolEntry(mkPool(subj, "market", "unknown"));
    svc.refreshGaps(subj, "industry");
    svc.refreshNextActions(subj, "industry");
    assert.equal(repo.listNextActions(subj).length, 1);
    assert.equal(repo.listNextActions(subj)[0].status, "open");
    // idempotent: second refresh does not duplicate
    svc.refreshNextActions(subj, "industry");
    assert.equal(repo.listNextActions(subj).length, 1);
  });

  test("cancels the action when its gap resolves", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    const r = mkReq(subj, "technology", 3);
    repo.upsertRequirement(r);
    repo.upsertPoolEntry(mkPool(subj, "technology", "unknown"));
    svc.refreshGaps(subj, "industry");
    svc.refreshNextActions(subj, "industry");
    assert.equal(repo.listNextActions(subj)[0].status, "open");
    // resolve the gap by confirming its pool entry
    const entry = repo.listPoolEntries(subj)[0];
    repo.upsertPoolEntry({ ...entry, status: "confirmed" });
    svc.refreshGaps(subj, "industry");
    svc.refreshNextActions(subj, "industry");
    assert.equal(repo.listNextActions(subj)[0].status, "cancelled");
  });
});
