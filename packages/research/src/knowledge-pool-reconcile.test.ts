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
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { SUFFICIENCY_POLICY_V1 } from "./domain/sufficiency.js";
import type { Claim, InformationPoolSlot, InformationRequirement } from "./domain/index.js";

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

/**
 * S4.5-R1: the Pool resolves its sufficiency policy FROM the requirement, so the
 * reconcile tests must supply one (the real ingest chain always does).
 */
function mkReq(subjectId: string, dimension: string): InformationRequirement {
  const now = new Date().toISOString();
  return {
    requirementId: `ir-${subjectId}-${dimension}`,
    questionId: `q-${subjectId}-${dimension}`,
    subjectKind: "industry",
    subjectId,
    dimension,
    description: "needs " + dimension,
    importance: 3,
    requiredEvidenceType: "text",
    sufficiencyPolicyRef: SUFFICIENCY_POLICY_V1.versionId,
    confirmedCondition: "c",
    uncertainCondition: "u",
    unknownCondition: "n",
    preferredPositionKinds: [],
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
}

describe("Knowledge -> InformationPool reconcile", () => {
  test("unknown + matching confirmed belief -> sufficient (S4.5: policy satisfied)", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "market", "unknown"));
    repo.upsertRequirement(mkReq(subj, "market"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    svc.reconcilePool(subj, "industry");

    const slot = poolOf(repo, subj, "market");
    assert.equal(slot.status, "sufficient");
    const items = repo.listPoolItems(slot.slotId);
    assert.ok(items.length >= 1);
    assert.match(items[0].claimRef, /^artifact:claim\//);
  });

  test("S4.5: partial -> sufficient as soon as the shared sufficiency policy is met", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "demand", "partial"));
    repo.upsertRequirement(mkReq(subj, "demand"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand" });
    svc.reconcilePool(subj, "industry");
    // one traceable confirmed claim satisfies SUFFICIENCY_POLICY_V1 (minItems 1 / 1 source)
    assert.equal(poolOf(repo, subj, "demand").status, "sufficient");
  });

  test("S4.5: a `conflicting` slot is NOT sticky — it falls back once conflicts are gone", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "supply", "conflicting"));
    svc.reconcilePool(subj, "industry");
    // no beliefs / no open conflict -> recomputed as unknown, not stuck at conflicting
    assert.equal(poolOf(repo, subj, "supply").status, "unknown");
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

  test("S4.5: superseded history alone never satisfies sufficiency", () => {
    const { db, repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "technology", "unknown"));

    // craft a knowledge projection whose ONLY belief on the dimension is superseded
    const kr = new KnowledgeRepository(db.db);
    const now = new Date().toISOString();
    kr.upsertKnowledge({
      knowledgeId: "kn-" + subj,
      subjectKind: "industry",
      subjectId: subj,
      beliefs: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    kr.insertBelief({
      beliefId: "bel-old",
      knowledgeId: "kn-" + subj,
      claimRef: "artifact:claim/old",
      dimension: "technology",
      confidence: 0.5,
      state: "superseded",
      historicalRelations: [],
      createdAt: now,
      updatedAt: now,
    });
    // the organizing layer still indexes that claim as an item (history kept)
    repo.upsertPoolItem({
      itemId: "item-" + subj + "-old",
      slotId: `slot-${subj}-technology`,
      valueText: "artifact:claim/old",
      claimRef: "artifact:claim/old",
      relation: "consistent",
      createdAt: now,
    });

    svc.reconcilePool(subj, "industry");
    assert.equal(
      poolOf(repo, subj, "technology").status,
      "unknown",
      "superseded belief carries no current support",
    );
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
    repo.upsertRequirement(mkReq(subjB, "demand"));
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
    // B: must NOT inherit A's conflict; its own (sufficient) support drives the status
    assert.equal(poolOf(repo, subjB, "demand").status, "sufficient");
  });

  test("S4.5-R1: a slot with NO requirement can never reach `sufficient` (no silent default)", () => {
    const { repo, svc } = setup();
    const subj = "ind-" + randomUUID();
    repo.upsertPoolSlot(mkSlot(subj, "policy", "unknown"));
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "policy" });
    svc.reconcilePool(subj, "industry");
    // a confirmed belief exists, but nothing names a sufficiency policy -> partial, never sufficient
    assert.equal(poolOf(repo, subj, "policy").status, "partial");
  });
});
