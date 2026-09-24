/**
 * Phase 2C Step 2-B-1: Knowledge -> InformationPool reconcile tests.
 * S3: the Pool is now Slot + Item (slot read from `information_pool_slot`,
 * support read from `information_pool_item`).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeProjectionService } from "./application/knowledge-projection-service.js";
import type { Claim, InformationPoolSlot } from "./domain/index.js";

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
    isRealExternalData: true,
  };
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

function poolOf(repo: ResearchRepository, subjectId: string, dimension: string): InformationPoolSlot {
  return repo.getPoolSlot(`slot-${subjectId}-${dimension}`)!;
}

describe("Knowledge -> InformationPool reconcile", () => {
  test("unknown + matching confirmed belief -> partial, with traceable claim refs", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "market", "unknown"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    svc.reconcilePool(subj, "industry");

    const slot = poolOf(repo, subj, "market");
    assert.equal(slot.status, "partial");
    const items = repo.listPoolItems(slot.slotId);
    assert.ok(items.length >= 1);
    assert.match(items[0].claimRef, /^artifact:claim\//);
  });

  test("never auto-upgrades partial->sufficient with a single confirmed belief", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "demand", "partial"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand" });
    svc.reconcilePool(subj, "industry");
    assert.equal(poolOf(repo, subj, "demand").status, "partial");
  });

  test("open conflict on dimension -> pool conflicting, both beliefs retained", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "demand", "partial"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand" });
    svc.projectFromClaim({
      claim: mkClaim(subj),
      dimension: "demand",
      relationHint: { kind: "CONFLICT" },
    });
    svc.reconcilePool(subj, "industry");
    assert.equal(poolOf(repo, subj, "demand").status, "conflicting");
    // both beliefs still present
    const k = svc.repository().findKnowledgeBySubject("industry", subj)!;
    assert.equal(k.beliefs.length, 2);
  });

  test("revised/superseded belief not used as current sole support", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "technology", "unknown"));
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

  test("idempotent: repeated reconcile yields same state, no new slots/items", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "market", "unknown"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    svc.reconcilePool(subj, "industry");
    const first = poolOf(repo, subj, "market");
    svc.reconcilePool(subj, "industry");
    svc.reconcilePool(subj, "industry");
    const second = poolOf(repo, subj, "market");
    assert.equal(second.status, first.status);
    assert.deepEqual(
      repo.listPoolItems(second.slotId).map((i) => i.claimRef),
      repo.listPoolItems(first.slotId).map((i) => i.claimRef),
    );
    assert.equal(repo.listPoolSlots(subj).length, 1);
  });

  test("conflict is subject-scoped: A's conflict must not mark B's pool", () => {
    const { repo, svc } = setup();
    const subjA = "ind-" + randomUUID();
    const subjB = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subjA, "demand", "partial"));
    repo.upsertPoolSlot(mkSlot(subjB, "demand", "unknown"));
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

    // A: conflicting (correct)
    assert.equal(poolOf(repo, subjA, "demand").status, "conflicting");
    // B: must NOT inherit A's conflict; its own support drives partial
    assert.equal(poolOf(repo, subjB, "demand").status, "partial");
  });
});
