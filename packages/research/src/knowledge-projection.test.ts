/**
 * Phase 2C Step 2-A: KnowledgeProjectionService tests.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchDb } from "./storage/research-db.js";
import { KnowledgeProjectionService } from "./application/knowledge-projection-service.js";
import type { Claim } from "./domain/index.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const svc = new KnowledgeProjectionService(db.db);
  return { db, svc, repo: svc.repository() };
}

function mkClaim(subjectId: string): Claim {
  return {
    claimId: randomUUID(),
    statement: "市场规模持续增长",
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

describe("KnowledgeProjectionService", () => {
  test("first claim creates IndustryKnowledge v1 (evolution=NEW)", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    const r = svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    assert.equal(r.evolution, "NEW");
    const k = repo.findKnowledgeBySubject("industry", subj)!;
    assert.equal(k.version, 1);
    assert.equal(k.beliefs.length, 1);
    assert.equal(k.beliefs[0].state, "confirmed");
  });

  test("SUPPORT: matching belief kept, new belief confirmed, no duplicate knowledge", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    const r = svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    assert.equal(r.evolution, "SUPPORT");
    const k = repo.findKnowledgeBySubject("industry", subj)!;
    assert.equal(k.beliefs.length, 2); // both kept
    assert.equal(k.beliefs.every((b) => b.state === "confirmed"), true);
    assert.equal(k.version, 2);
  });

  test("REVISE: old row content preserved as revised, new confirmed", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market_growth" });
    const r = svc.projectFromClaim({
      claim: mkClaim(subj),
      dimension: "market_growth",
      relationHint: { kind: "REVISE" },
    });
    assert.equal(r.evolution, "REVISE");
    const k = repo.findKnowledgeBySubject("industry", subj)!;
    const revised = k.beliefs.find((b) => b.state === "revised");
    const confirmed = k.beliefs.find((b) => b.state === "confirmed");
    assert.ok(revised, "old belief kept as revised");
    assert.ok(confirmed, "new belief confirmed");
    // history: current projection drops nothing unless superseded; both visible
    assert.equal(k.beliefs.length, 2);
  });

  test("CONFLICT (explicit): both sides conflicting + open conflict, nothing deleted", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand" });
    const r = svc.projectFromClaim({
      claim: mkClaim(subj),
      dimension: "demand",
      relationHint: { kind: "CONFLICT" },
    });
    assert.equal(r.evolution, "CONFLICT");
    const k = repo.findKnowledgeBySubject("industry", subj)!;
    assert.equal(k.beliefs.every((b) => b.state === "conflicting"), true);
    assert.equal(repo.listOpenConflicts().length, 1);
    // both beliefs still present (no overwrite/delete)
    assert.equal(k.beliefs.length, 2);
  });

  test("SUPERSEDE (explicit): old superseded, new confirmed, history kept", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "technology" });
    const r = svc.projectFromClaim({
      claim: mkClaim(subj),
      dimension: "technology",
      relationHint: { kind: "SUPERSEDE", supersedesClaimRef: "old" },
    });
    assert.equal(r.evolution, "SUPERSEDE");
    const k = repo.findKnowledgeBySubject("industry", subj)!;
    // current projection excludes superseded
    assert.equal(k.beliefs.length, 1);
    // history retained
    const hist = repo.listBeliefs(k.knowledgeId);
    assert.equal(hist.length, 2);
    assert.equal(hist.find((b) => b.state === "superseded")?.state, "superseded");
  });

  test("cross-dimension is never auto-judged (independent beliefs)", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    const r = svc.projectFromClaim({ claim: mkClaim(subj), dimension: "competition" });
    assert.equal(r.evolution, "NEW"); // not SUPPORT despite same subject
    const k = repo.findKnowledgeBySubject("industry", subj)!;
    assert.equal(k.beliefs.length, 2);
  });

  test("version increments across projections, header is current projection not history", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market" });
    const k = repo.findKnowledgeBySubject("industry", subj)!;
    assert.equal(k.version, 3);
    // only one header row (current projection), not version history rows
    assert.equal(k.beliefs.length, 3);
  });

  test("Pool/State reconcile stubs are not implemented in 2-A", () => {
    const { svc } = setup();
    assert.throws(() => svc.reconcilePool("x"), /Step 2-B/);
    assert.throws(() => svc.refreshState("x"), /Step 2-B/);
  });
});
