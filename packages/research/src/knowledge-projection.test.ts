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
    isRealExternalData: true,
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

  test("placeholder (Echo) claim is SKIPPED, never becomes a confirmed belief", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    const r = svc.projectFromClaim({
      claim: { ...mkClaim(subj), isRealExternalData: false },
      dimension: "market",
    });
    assert.equal(r.evolution, "SKIPPED");
    assert.equal(repo.findKnowledgeBySubject("industry", subj), undefined);
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

  test("REVISE: the NAMED target leaves current as `revised`, new belief is confirmed (C1)", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    const v1 = mkClaim(subj);
    svc.projectFromClaim({ claim: v1, dimension: "market_growth" });
    const r = svc.projectFromClaim({
      claim: mkClaim(subj),
      dimension: "market_growth",
      relationHint: { kind: "REVISE", revisesClaimRef: v1.claimId },
    });
    assert.equal(r.evolution, "REVISE");
    assert.equal(r.affectedBeliefRefs.length, 1, "the named target was flipped");

    const k = repo.findKnowledgeBySubject("industry", subj)!;
    // CURRENT ≡ confirmed only (C-FIX-12)
    assert.deepEqual(k.beliefs.map((b) => b.state), ["confirmed"]);
    // history keeps the revised row (never deleted)
    const hist = repo.listBeliefs(k.knowledgeId);
    assert.equal(hist.length, 2);
    assert.equal(hist.filter((b) => b.state === "revised").length, 1);
    assert.equal(hist.find((b) => b.claimRef === `artifact:claim/${v1.claimId}`)!.state, "revised");
  });

  test("REVISE without a target is SKIPPED and mutates NOTHING (C-FIX-8)", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "market_growth" });
    const knowledgeId = repo.findKnowledgeBySubject("industry", subj)!.knowledgeId;
    const before = JSON.stringify(repo.listBeliefs(knowledgeId));

    const r = svc.projectFromClaim({
      claim: mkClaim(subj),
      dimension: "market_growth",
      relationHint: { kind: "REVISE" },
    });
    assert.equal(r.evolution, "SKIPPED");
    assert.equal(r.reason, "INVALID_EVOLUTION_TARGET");
    assert.equal(r.beliefId, "", "nothing was written");
    assert.equal(JSON.stringify(repo.listBeliefs(knowledgeId)), before, "zero mutation");
  });

  test("CONFLICT (explicit): DIMENSION-LEVEL conflicting + one direct pair, nothing deleted (C1)", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand" });
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand" });
    svc.projectFromClaim({ claim: mkClaim(subj), dimension: "demand" });
    const r = svc.projectFromClaim({
      claim: mkClaim(subj),
      dimension: "demand",
      relationHint: { kind: "CONFLICT" },
    });
    assert.equal(r.evolution, "CONFLICT");
    assert.ok(r.conflictRef, "the DIRECT conflict pair was recorded");

    const k = repo.findKnowledgeBySubject("industry", subj)!;
    // Every confirmed belief of the dimension left current (C-FIX-1) ⇒ current is now empty.
    assert.deepEqual(k.beliefs, []);
    const hist = repo.listBeliefs(k.knowledgeId);
    assert.equal(hist.length, 4, "nothing deleted");
    assert.equal(hist.filter((b) => b.state === "conflicting").length, 4);
    // Only the DIRECT pair is recorded — no fake B↔D / C↔D edges (C-FIX-1).
    assert.equal(repo.listOpenConflicts().length, 1);
  });

  test("SUPERSEDE (explicit): the NAMED target leaves current, new belief is confirmed (C1)", () => {
    const { svc, repo } = setup();
    const subj = "ind-" + randomUUID();
    const old = mkClaim(subj);
    svc.projectFromClaim({ claim: old, dimension: "technology" });
    const r = svc.projectFromClaim({
      claim: mkClaim(subj),
      dimension: "technology",
      relationHint: { kind: "SUPERSEDE", supersedesClaimRef: `artifact:claim/${old.claimId}` },
    });
    assert.equal(r.evolution, "SUPERSEDE");

    const k = repo.findKnowledgeBySubject("industry", subj)!;
    // current projection = the new confirmed belief only
    assert.deepEqual(k.beliefs.map((b) => b.state), ["confirmed"]);
    const hist = repo.listBeliefs(k.knowledgeId);
    assert.equal(hist.length, 2, "history retained");
    assert.equal(hist.find((b) => b.claimRef === `artifact:claim/${old.claimId}`)!.state, "superseded");
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
});
