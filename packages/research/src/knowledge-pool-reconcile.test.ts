/**
 * Phase 2C Step 2-B-1: Knowledge -> InformationPool reconcile tests.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeProjectionService } from "./application/knowledge-projection-service.js";
import type { Claim, InformationPoolEntry } from "./domain/index.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const svc = new KnowledgeProjectionService(db.db);
  return { db, repo, svc };
}

function mkClaim(subjectId: string): Claim {
  return {
    claimId: randomUUID(),
    statement: "x",
    claimType: "descriptive",
    provenance: "analyst",
    conflictOfInterest: false,
    factIds: [],
    evidenceIds: [],
    subjectKind: "industry",
    subjectId,
    temporalRelation: "current",
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

function poolOf(repo: ResearchRepository, subjectId: string, topic: string): InformationPoolEntry {
  return repo.listPoolEntries(subjectId).find((e) => e.topic === topic)!;
}

describe("Knowledge -> InformationPool reconcile", () => {
  test("unknown + matching confirmed belief -> partial, with traceable claim refs", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolEntry(mkPool(subj, "market", "unknown"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    svc.reconcilePool(subj, "industry");

    const e = poolOf(repo, subj, "market");
    assert.equal(e.status, "partial");
    assert.ok(e.evidenceRefs.length >= 1);
    assert.match(e.evidenceRefs[0], /^artifact:claim\//);
  });

  test("never auto-upgrades partial->confirmed with a single confirmed belief", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolEntry(mkPool(subj, "demand", "partial"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand" });
    svc.reconcilePool(subj, "industry");
    assert.equal(poolOf(repo, subj, "demand").status, "partial");
  });

  test("open conflict on dimension -> pool conflict, both beliefs retained", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolEntry(mkPool(subj, "demand", "partial"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand" });
    svc.projectFromClaim({
      claim: mkClaim(subj),
      dimension: "demand",
      relationHint: { kind: "CONFLICT" },
    });
    svc.reconcilePool(subj, "industry");
    assert.equal(poolOf(repo, subj, "demand").status, "conflict");
    // both beliefs still present
    const k = svc.repository().findKnowledgeBySubject("industry", subj)!;
    assert.equal(k.beliefs.length, 2);
  });

  test("revised/superseded belief not used as current sole support", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolEntry(mkPool(subj, "technology", "unknown"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "technology" });
    svc.projectFromClaim({
      claim: mkClaim(subj),
      dimension: "technology",
      relationHint: { kind: "SUPERSEDE", supersedesClaimRef: "old" },
    });
    svc.reconcilePool(subj, "industry");
    // new current confirmed belief still supports -> partial
    assert.equal(poolOf(repo, subj, "technology").status, "partial");
  });

  test("idempotent: repeated reconcile yields same state, no new entries/refs", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolEntry(mkPool(subj, "market", "unknown"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    svc.reconcilePool(subj, "industry");
    const first = poolOf(repo, subj, "market");
    svc.reconcilePool(subj, "industry");
    svc.reconcilePool(subj, "industry");
    const second = poolOf(repo, subj, "market");
    assert.equal(second.status, first.status);
    assert.deepEqual(second.evidenceRefs, first.evidenceRefs);
    assert.equal(repo.listPoolEntries(subj).length, 1);
  });

  test("conflict is subject-scoped: A's conflict must not mark B's pool", () => {
    const { repo, svc } = setup();
    const subjA = "ind-" + randomUUID();
    const subjB = "ind-" + randomUUID();
    repo.upsertPoolEntry(mkPool(subjA, "demand", "partial"));
    repo.upsertPoolEntry(mkPool(subjB, "demand", "unknown"));
    // A develops an open conflict on demand
    svc.projectFromClaim({ claim: mkClaim(subjA), dimension: "demand" });
    svc.projectFromClaim({
      claim: mkClaim(subjA),
      dimension: "demand",
      relationHint: { kind: "CONFLICT" },
    });
    // B gets a confirmed belief on demand but no conflict
    svc.projectFromClaim({ claim: mkClaim(subjB), dimension: "demand" });

    svc.reconcilePool(subjA, "industry");
    svc.reconcilePool(subjB, "industry");

    // A: conflict (correct)
    assert.equal(poolOf(repo, subjA, "demand").status, "conflict");
    // B: must NOT inherit A's conflict; its own support drives partial
    assert.equal(poolOf(repo, subjB, "demand").status, "partial");
  });

  test("State is NOT touched in this step (refreshState still throws)", () => {
    const { svc } = setup();
    assert.throws(() => svc.refreshState("anything"), /Step 2-B-2/);
  });
});
