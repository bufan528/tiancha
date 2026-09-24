/**
 * Phase C · C1 — Knowledge Projection Semantic Alignment.
 *
 * Acceptance suite for the frozen contract (docs/phaseC/implementation-contract.md):
 *   §26.1  >= 20 targeted invariants (current predicate / deterministic identity / exact
 *          no-op / candidate + rejected lifecycle / explicit evolution target / dimension-level
 *          conflict / open conflict precedence)
 *   §26.2  the full E2E chain (material → claim → knowledge → pool → gap)
 *   §26.3  the "must NOT pass" reverse case (an ordinary claim may not step around an open conflict)
 *   §26.4  the regression guard: after an open conflict an explicit evolution path MUST exist
 *
 * C1 scope reminder: this is a SEMANTIC ALIGNMENT of the existing projection, not a rewrite of
 * the downstream Pool / Gap / Priority / State rules.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import {
  KnowledgeProjectionService,
  normalizeClaimRef,
} from "./application/knowledge-projection-service.js";
import { beliefIdFor, conflictIdFor, isCurrentBelief } from "./domain/index.js";
import type { Claim, InformationPoolSlot } from "./domain/index.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const svc = new KnowledgeProjectionService(db.db);
  // `repo` = knowledge repository (beliefs / conflicts); `research` = pool / gap / state.
  const repo = new KnowledgeRepository(db.db);
  const research = new ResearchRepository(db.db);
  return { db, svc, repo, research };
}

function mkClaim(subjectId: string, statement = "市场规模持续增长"): Claim {
  return {
    claimId: randomUUID(),
    statement,
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

/** Project a fresh claim and return everything a test needs about the result. */
function project(
  svc: KnowledgeProjectionService,
  subjectId: string,
  dimension: string,
  extra: Partial<Parameters<KnowledgeProjectionService["projectFromClaim"]>[0]> = {},
) {
  const claim = mkClaim(subjectId);
  const result = svc.projectFromClaim({ claim, dimension, ...extra });
  return { claim, result };
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

const statesOf = (beliefs: { state: string }[]) => beliefs.map((b) => b.state).sort();

describe("Phase C · C1 · Knowledge Projection Semantic Alignment", () => {
  // ---- §26.1 current predicate (C-FIX-12 / P5) -----------------------------

  test("C1-01: current ≡ state === confirmed; every other state is NOT current", () => {
    assert.equal(isCurrentBelief("confirmed"), true);
    for (const s of ["candidate", "rejected", "revised", "conflicting", "superseded"] as const) {
      assert.equal(isCurrentBelief(s), false, `${s} must not be current`);
    }

    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const a = mkClaim(subject);
    const b = mkClaim(subject);
    svc.projectFromClaim({ claim: a, dimension: "market" });
    svc.projectFromClaim({ claim: b, dimension: "market", relationHint: { kind: "REVISE", revisesClaimRef: a.claimId } });

    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    assert.deepEqual(statesOf(repo.listCurrentBeliefs(knowledgeId)), ["confirmed"]);
    assert.equal(repo.listBeliefs(knowledgeId).length, 2, "the revised row is still stored");
  });

  // ---- §26.1 deterministic identity (P6) -----------------------------------

  test("C1-02: beliefId is deterministic in (knowledgeId, claimRef) — no time, no randomness", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const { claim, result } = project(svc, subject, "market");
    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;

    assert.equal(result.beliefId, beliefIdFor(knowledgeId, normalizeClaimRef(claim.claimId)));
    assert.equal(
      result.beliefId,
      repo.findBeliefByKnowledgeAndClaim(knowledgeId, `artifact:claim/${claim.claimId}`)!.beliefId,
    );
    assert.ok(!/\d{10,}/.test(result.beliefId), "no timestamp fragment in the id");
  });

  test("C1-03: exact replay — projecting the same claim three times keeps ONE belief", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const claim = mkClaim(subject);
    const first = svc.projectFromClaim({ claim, dimension: "market" });
    const second = svc.projectFromClaim({ claim, dimension: "market" });
    const third = svc.projectFromClaim({ claim, dimension: "market" });

    assert.equal(first.evolution, "NEW");
    for (const r of [second, third]) {
      assert.equal(r.evolution, "SKIPPED");
      assert.equal(r.reason, "ALREADY_PROJECTED");
      assert.equal(r.beliefId, "", "SKIPPED writes nothing");
    }
    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    assert.equal(repo.listBeliefs(knowledgeId).length, 1);
    assert.equal(repo.findKnowledgeBySubject("industry", subject)!.version, 1, "no version churn on replay");
  });

  // ---- §26.1 SUPPORT -------------------------------------------------------

  test("C1-04: SUPPORT keeps multiple confirmed beliefs side by side", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    project(svc, subject, "market");
    const { result } = project(svc, subject, "market");
    assert.equal(result.evolution, "SUPPORT");

    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    assert.deepEqual(statesOf(repo.listCurrentBeliefs(knowledgeId)), ["confirmed", "confirmed"]);
    assert.equal(repo.listBeliefs(knowledgeId).length, 2);
  });

  // ---- §26.1 explicit evolution target (C-FIX-8) ---------------------------

  test("C1-05: REVISE flips the NAMED target only", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const a = project(svc, subject, "market").claim;
    project(svc, subject, "market");
    const c = project(svc, subject, "market", {
      relationHint: { kind: "REVISE", revisesClaimRef: a.claimId },
    });

    assert.equal(c.result.evolution, "REVISE");
    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    const byRef = new Map(repo.listBeliefs(knowledgeId).map((b) => [b.claimRef, b.state]));
    assert.equal(byRef.get(`artifact:claim/${a.claimId}`), "revised");
    assert.equal(byRef.get(c.result.claimRef), "confirmed", "the new belief is current");
  });

  test("C1-06: SUPERSEDE hits the NAMED target, NOT the latest anchor", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const a = project(svc, subject, "market").claim;
    const b = project(svc, subject, "market").claim; // the latest anchor
    const r = project(svc, subject, "market", {
      relationHint: { kind: "SUPERSEDE", supersedesClaimRef: `artifact:claim/${a.claimId}` },
    });
    assert.equal(r.result.evolution, "SUPERSEDE");

    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    const byRef = new Map(repo.listBeliefs(knowledgeId).map((b) => [b.claimRef, b.state]));
    assert.equal(byRef.get(`artifact:claim/${a.claimId}`), "superseded", "exactly the named target");
    assert.equal(byRef.get(`artifact:claim/${b.claimId}`), "confirmed", "the latest anchor is untouched");
  });

  test("C1-07/08/09: illegal evolution targets are SKIPPED with ZERO mutation", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const a = project(svc, subject, "market").claim;      // confirmed
    const other = project(svc, subject, "demand").claim;  // another dimension
    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    const before = JSON.stringify(repo.listBeliefs(knowledgeId));

    const cases: Array<[string, Record<string, unknown>]> = [
      ["missing target", { kind: "SUPERSEDE", supersedesClaimRef: "artifact:claim/does-not-exist" }],
      ["no target at all", { kind: "REVISE" }],
      ["cross-dimension target", { kind: "SUPERSEDE", supersedesClaimRef: other.claimId }],
    ];
    for (const [label, relationHint] of cases) {
      const claim = mkClaim(subject);
      const r = svc.projectFromClaim({
        claim,
        dimension: "market",
        relationHint: relationHint as never,
      });
      assert.equal(r.evolution, "SKIPPED", label);
      assert.equal(r.reason, "INVALID_EVOLUTION_TARGET", label);
      assert.equal(r.beliefId, "", label);
    }
    assert.equal(JSON.stringify(repo.listBeliefs(knowledgeId)), before, "zero mutation for all three");

    // a target that already left current is not evolvable either
    svc.projectFromClaim({
      claim: mkClaim(subject),
      dimension: "market",
      relationHint: { kind: "SUPERSEDE", supersedesClaimRef: a.claimId },
    });
    const afterSupersede = JSON.stringify(repo.listBeliefs(knowledgeId));
    const again = svc.projectFromClaim({
      claim: mkClaim(subject),
      dimension: "market",
      relationHint: { kind: "REVISE", revisesClaimRef: a.claimId }, // now `superseded`
    });
    assert.equal(again.reason, "INVALID_EVOLUTION_TARGET", "a non-evolvable target is refused");
    assert.equal(JSON.stringify(repo.listBeliefs(knowledgeId)), afterSupersede);
  });

  // ---- §26.1 dimension-level CONFLICT (C-FIX-1) ----------------------------

  test("C1-10/11: CONFLICT is dimension-level, but only the DIRECT pair is recorded", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const a = project(svc, subject, "demand").claim;
    const b = project(svc, subject, "demand").claim;
    const c = project(svc, subject, "demand").claim;
    const d = project(svc, subject, "demand", { relationHint: { kind: "CONFLICT" } }).claim;

    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    const beliefs = repo.listBeliefs(knowledgeId);
    assert.equal(beliefs.length, 4, "nothing deleted");
    assert.deepEqual(statesOf(beliefs), ["conflicting", "conflicting", "conflicting", "conflicting"]);
    assert.deepEqual(repo.listCurrentBeliefs(knowledgeId), [], "no current cognition while conflicting");

    const conflicts = repo.listOpenConflicts();
    assert.equal(conflicts.length, 1, "exactly ONE direct pair");
    const directRefs = [conflicts[0]!.claimARef, conflicts[0]!.claimBRef].sort();
    assert.deepEqual(directRefs, [`artifact:claim/${c.claimId}`, `artifact:claim/${d.claimId}`].sort());
    for (const other of [a, b]) {
      assert.ok(!directRefs.includes(`artifact:claim/${other.claimId}`), "no fabricated edge for the others");
    }
  });

  test("C1-12: conflictId is direction-free (C-FIX-5)", () => {
    assert.equal(
      conflictIdFor("market", "artifact:claim/x", "artifact:claim/y"),
      conflictIdFor("market", "artifact:claim/y", "artifact:claim/x"),
    );
  });

  // ---- §26.1 open-conflict precedence (C-FIX-7) ----------------------------

  test("C1-13: an ordinary claim under an open conflict becomes a CANDIDATE, never confirmed", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    project(svc, subject, "demand");
    project(svc, subject, "demand", { relationHint: { kind: "CONFLICT" } });

    const { result } = project(svc, subject, "demand");
    assert.equal(result.requiresHumanGate, true);
    assert.equal(result.reason, "OPEN_CONFLICT_REQUIRES_REVIEW");
    assert.ok(result.beliefId, "a candidate row is written so a human can review it");

    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    assert.equal(repo.getBelief(result.beliefId)!.state, "candidate");
    assert.deepEqual(repo.listCurrentBeliefs(knowledgeId), [], "the candidate is NOT current");
  });

  test("C1-14: an EXPLICIT SUPPORT under an open conflict is a candidate too, not confirmed", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    project(svc, subject, "demand");
    project(svc, subject, "demand", { relationHint: { kind: "CONFLICT" } });

    const { result } = project(svc, subject, "demand", { relationHint: { kind: "SUPPORT" } });
    assert.equal(result.requiresHumanGate, true);
    assert.equal(repo.getBelief(result.beliefId)!.state, "candidate");
  });

  test("C1-15: an unbuildable candidate is SKIPPED (OPEN_CONFLICT_REQUIRES_REVIEW)", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    project(svc, subject, "demand");
    project(svc, subject, "demand", { relationHint: { kind: "CONFLICT" } });
    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    const before = JSON.stringify(repo.listBeliefs(knowledgeId));

    const empty = mkClaim(subject, ""); // no statement ⇒ nothing a human could review
    const r = svc.projectFromClaim({ claim: empty, dimension: "demand" });
    assert.equal(r.evolution, "SKIPPED");
    assert.equal(r.reason, "OPEN_CONFLICT_REQUIRES_REVIEW");
    assert.equal(JSON.stringify(repo.listBeliefs(knowledgeId)), before, "zero mutation");
  });

  // ---- §26.1 exact no-op in EVERY state (C-FIX-11) -------------------------

  test("C1-16: re-projecting is an exact no-op whatever the stored state is", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();

    // superseded
    const a = project(svc, subject, "market").claim;
    project(svc, subject, "market", {
      relationHint: { kind: "SUPERSEDE", supersedesClaimRef: a.claimId },
    });
    // candidate
    const cand = project(svc, subject, "supply", { requiresHumanGate: true }).claim;
    // conflicting
    const c1 = project(svc, subject, "competition").claim;
    const c2 = project(svc, subject, "competition", { relationHint: { kind: "CONFLICT" } }).claim;

    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    const before = JSON.stringify(repo.listBeliefs(knowledgeId));
    const conflictsBefore = JSON.stringify(repo.listOpenConflicts());

    for (const [claim, dimension] of [
      [a, "market"],
      [cand, "supply"],
      [c1, "competition"],
      [c2, "competition"],
    ] as const) {
      const r = svc.projectFromClaim({ claim: claim as Claim, dimension });
      assert.equal(r.evolution, "SKIPPED");
      assert.equal(r.reason, "ALREADY_PROJECTED");
    }

    assert.equal(JSON.stringify(repo.listBeliefs(knowledgeId)), before, "no belief changed");
    assert.equal(JSON.stringify(repo.listOpenConflicts()), conflictsBefore, "no conflict changed");
  });

  // ---- §26.1 candidate / rejected lifecycle (P3 / C-FIX-3 / C-FIX-9) -------

  test("C1-17: a candidate is confirmed ONLY by an explicit human action (never by re-projecting)", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const { claim, result } = project(svc, subject, "market", { requiresHumanGate: true });
    assert.equal(repo.getBelief(result.beliefId)!.state, "candidate");
    assert.equal(result.reason, "CANDIDATE_REQUIRES_CONFIRMATION");

    // re-projecting does NOT confirm it
    const replay = svc.projectFromClaim({ claim, dimension: "market" });
    assert.equal(replay.evolution, "SKIPPED");
    assert.equal(replay.reason, "ALREADY_PROJECTED");
    assert.equal(repo.getBelief(result.beliefId)!.state, "candidate", "still a candidate");

    const decision = svc.confirmCandidate(result.beliefId, "SUPPORT");
    assert.equal(decision.state, "confirmed");
    assert.equal(repo.getBelief(result.beliefId)!.state, "confirmed");
    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    assert.deepEqual(repo.listCurrentBeliefs(knowledgeId).map((b) => b.beliefId), [result.beliefId]);
  });

  test("C1-18: confirming with REVISE / SUPERSEDE applies the named target + records the relation", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const a = project(svc, subject, "market").claim;
    const { result } = project(svc, subject, "market", { requiresHumanGate: true });

    const decision = svc.confirmCandidate(result.beliefId, "REVISE", a.claimId);
    assert.deepEqual(decision.affectedBeliefRefs.length, 1);

    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    const byRef = new Map(repo.listBeliefs(knowledgeId).map((b) => [b.claimRef, b]));
    assert.equal(byRef.get(`artifact:claim/${a.claimId}`)!.state, "revised");
    const confirmed = byRef.get(result.claimRef)!;
    assert.equal(confirmed.state, "confirmed");
    assert.deepEqual(confirmed.historicalRelations.map((r) => r.relation), ["REVISE"]);
  });

  test("C1-19: confirmations are one-shot and validate their target", () => {
    const { svc } = setup();
    const subject = "ind-" + randomUUID();
    const { result } = project(svc, subject, "market", { requiresHumanGate: true });
    svc.confirmCandidate(result.beliefId, "NEW");

    assert.throws(() => svc.confirmCandidate(result.beliefId, "NEW"), /not a candidate/);
    assert.throws(() => svc.rejectCandidate(result.beliefId), /not a candidate/);

    const other = project(svc, subject, "market", { requiresHumanGate: true }).result;
    assert.throws(
      () => svc.confirmCandidate(other.beliefId, "SUPERSEDE", "artifact:claim/missing"),
      /invalid SUPERSEDE target/,
    );
    assert.throws(() => svc.confirmCandidate(other.beliefId, "SUPERSEDE"), /invalid SUPERSEDE target/);
  });

  test("C1-20: `rejected` is a terminal state that is neither current nor history", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const { result } = project(svc, subject, "market", { requiresHumanGate: true });
    svc.rejectCandidate(result.beliefId);

    const belief = repo.getBelief(result.beliefId)!;
    assert.equal(belief.state, "rejected");
    assert.notEqual(belief.state, "superseded", "rejection must not be faked with superseded");
    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    assert.deepEqual(repo.listCurrentBeliefs(knowledgeId), [], "a rejected candidate is not current");
  });

  // ---- §26.1 conflict event vs cognition (C-FIX-10) ------------------------

  test("C1-21: resolveConflictEvent closes the EVENT and never restores cognition", () => {
    const { svc, repo, research } = setup();
    const subject = "ind-" + randomUUID();
    research.upsertPoolSlot(mkSlot(subject, "demand", "partial"));
    project(svc, subject, "demand");
    project(svc, subject, "demand", { relationHint: { kind: "CONFLICT" } });
    const conflict = repo.listOpenConflicts()[0]!;

    const resolved = svc.resolveConflictEvent(conflict.conflictId);
    assert.equal(resolved.status, "resolved");
    assert.equal(repo.listOpenConflicts().length, 0);

    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    assert.deepEqual(statesOf(repo.listBeliefs(knowledgeId)), ["conflicting", "conflicting"]);
    assert.deepEqual(repo.listCurrentBeliefs(knowledgeId), [], "beliefs were not resurrected");

    // the dimension is no longer `conflicting`, but it is still not `sufficient`
    svc.reconcilePool(subject, "industry");
    const slot = research.listPoolSlots(subject).find((s) => s.dimension === "demand")!;
    assert.equal(
      slot.status,
      "unknown",
      "closing the event does not restore cognition: no current belief ⇒ no sufficiency",
    );
    assert.throws(() => svc.resolveConflictEvent(conflict.conflictId), /not open/);
  });

  test("C1-22: no code path deletes a claim-bearing belief row", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const a = project(svc, subject, "market").claim;
    project(svc, subject, "market", { relationHint: { kind: "REVISE", revisesClaimRef: a.claimId } });
    project(svc, subject, "market", { relationHint: { kind: "CONFLICT" } });

    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    const refs = repo.listBeliefs(knowledgeId).map((b) => b.claimRef);
    assert.ok(refs.includes(`artifact:claim/${a.claimId}`), "the original claim is still traceable");
    assert.equal(refs.length, 3);
  });

  // ---- §26.4 the conflict-resolution path MUST be reachable (C-FIX-13) -----

  test("C1-23 (§26.4): after an open conflict, explicit evolution still WORKS", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const a = project(svc, subject, "market").claim;
    const b = project(svc, subject, "market", { relationHint: { kind: "CONFLICT" } }).claim;

    // both sides are `conflicting` ⇒ a `conflicting` target must be evolvable
    const revise = project(svc, subject, "market", {
      relationHint: { kind: "REVISE", revisesClaimRef: a.claimId },
    });
    assert.equal(revise.result.evolution, "REVISE", "REVISE of a conflicting target must NOT be refused");

    const supersede = project(svc, subject, "market", {
      relationHint: { kind: "SUPERSEDE", supersedesClaimRef: b.claimId },
    });
    assert.equal(supersede.result.evolution, "SUPERSEDE");

    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    const byRef = new Map(repo.listBeliefs(knowledgeId).map((b) => [b.claimRef, b.state]));
    assert.equal(byRef.get(`artifact:claim/${a.claimId}`), "revised");
    assert.equal(byRef.get(`artifact:claim/${b.claimId}`), "superseded");
    assert.equal(repo.listOpenConflicts().length, 1, "the conflict EVENT is not auto-closed");
    assert.deepEqual(statesOf(repo.listCurrentBeliefs(knowledgeId)), ["confirmed", "confirmed"]);
  });

  test("C1-27: with an open conflict, a SECOND CONFLICT is SKIPPED (no mutation before review)", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    project(svc, subject, "demand");
    project(svc, subject, "demand", { relationHint: { kind: "CONFLICT" } });
    const knowledgeId = repo.findKnowledgeBySubject("industry", subject)!.knowledgeId;
    const beliefsBefore = JSON.stringify(repo.listBeliefs(knowledgeId));
    const conflictsBefore = JSON.stringify(repo.listOpenConflicts());

    const { result } = project(svc, subject, "demand", { relationHint: { kind: "CONFLICT" } });
    assert.equal(result.evolution, "SKIPPED");
    assert.equal(result.reason, "OPEN_CONFLICT_REQUIRES_REVIEW");
    assert.equal(result.beliefId, "", "nothing was written");
    assert.equal(
      JSON.stringify(repo.listBeliefs(knowledgeId)),
      beliefsBefore,
      "no dimension-level conflict mutation happened before any human review",
    );
    assert.equal(JSON.stringify(repo.listOpenConflicts()), conflictsBefore, "no second pair invented");
  });

  test("C1-28: confirmation cannot bypass an open conflict — only REVISE / SUPERSEDE can", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    project(svc, subject, "demand");
    const b = project(svc, subject, "demand", { relationHint: { kind: "CONFLICT" } }).claim;
    const candidate = project(svc, subject, "demand").result; // ordinary claim under the open conflict

    assert.throws(() => svc.confirmCandidate(candidate.beliefId, "NEW"), /open conflict/);
    assert.throws(() => svc.confirmCandidate(candidate.beliefId, "SUPPORT"), /open conflict/);
    assert.equal(repo.getBelief(candidate.beliefId)!.state, "candidate", "still unresolved");
    assert.equal(repo.listOpenConflicts().length, 1, "the conflict is still open");

    // The legal path out: an explicit evolution of one of the conflicting beliefs (§6.7).
    const decision = svc.confirmCandidate(candidate.beliefId, "SUPERSEDE", b.claimId);
    assert.equal(decision.state, "confirmed");
    assert.equal(repo.getBelief(decision.affectedBeliefRefs[0]!)!.state, "superseded");
    assert.equal(repo.listOpenConflicts().length, 1, "the conflict EVENT is NOT auto-closed");
    assert.deepEqual(
      repo.listCurrentBeliefs(decision.knowledgeId).map((x) => x.beliefId),
      [candidate.beliefId],
      "exactly the confirmed candidate is current",
    );
  });

  test("C1-29: confirming moves the CURRENT projection version; rejecting does not", () => {
    const { svc, repo } = setup();
    const subject = "ind-" + randomUUID();
    const { result } = project(svc, subject, "market", { requiresHumanGate: true });
    const knowledgeId = result.knowledgeId;

    const beforeConfirm = repo.findKnowledgeBySubject("industry", subject)!;
    assert.equal(beforeConfirm.version, 1);
    assert.deepEqual(beforeConfirm.beliefs, [], "a candidate is not current cognition");

    svc.confirmCandidate(result.beliefId, "SUPPORT");
    const afterConfirm = repo.findKnowledgeBySubject("industry", subject)!;
    assert.equal(afterConfirm.version, 2, "confirming changed current cognition ⇒ the version moves");
    assert.deepEqual(afterConfirm.beliefs.map((x) => x.beliefId), [result.beliefId]);
    assert.notEqual(afterConfirm.updatedAt, beforeConfirm.updatedAt);

    // A rejected candidate was never current ⇒ it must NOT move the version.
    const other = project(svc, subject, "supply", { requiresHumanGate: true }).result;
    const beforeReject = repo.findKnowledgeBySubject("industry", subject)!;
    svc.rejectCandidate(other.beliefId);
    const afterReject = repo.findKnowledgeBySubject("industry", subject)!;
    assert.equal(afterReject.version, beforeReject.version, "rejection never was current cognition");
    assert.equal(repo.getBelief(other.beliefId)!.state, "rejected");
  });
});

// ---------------------------------------------------------------------------
// §26.2 E2E + §26.3 reverse case + §26.4 downstream guard, through the REAL
// material → claim → knowledge → pool → gap chain.
// ---------------------------------------------------------------------------

describe("Phase C · C1 · E2E (material → claim → knowledge → pool → gap)", () => {
  async function setupIndustry(industryName: string) {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const knowledge = new KnowledgeRepository(db.db);
    const artifacts = new SqliteArtifactStore({ path: ":memory:" });
    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName });
    return { db, repo, knowledge, svc, sid: res.industry.industryId };
  }

  test("C1-24 (§26.2): conflict opens the gap, and evolution advances without closing it", async () => {
    const { db, repo, knowledge, svc, sid } = await setupIndustry("C1 E2E 行业");
    try {
      const slotOf = (dimension: string) => repo.listPoolSlots(sid).find((s) => s.dimension === dimension)!;
      const gapOf = (dimension: string) =>
        repo.listGaps(sid).find((g) => g.relatedRequirementIds.some((r) => r.endsWith(`-${dimension}`)))!;

      // 1) a first claim makes `market` REAL coverage (Existing Sufficiency Policy decides it)
      const a = await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market A", dimension: "market" }],
      });
      assert.equal(slotOf("market").status, "sufficient", "existing policy is satisfied");
      assert.equal(gapOf("market").status, "resolved");

      // 2) an explicit CONFLICT: dimension-level, gap re-opens as `conflict`
      const b = await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market B", dimension: "market", relationHint: { kind: "CONFLICT" } }],
      });
      assert.equal(slotOf("market").status, "conflicting");
      assert.equal(gapOf("market").status, "open");
      assert.equal(gapOf("market").gapType, "conflict");

      // 3) an ORDINARY claim must NOT step around the open conflict (§26.3)
      await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market C (ordinary)", dimension: "market" }],
      });
      assert.equal(slotOf("market").status, "conflicting", "still conflicting");
      assert.equal(gapOf("market").status, "open", "the gap must NOT be resolved");
      const knowledgeId = knowledge.findKnowledgeBySubject("industry", sid)!.knowledgeId;
      assert.deepEqual(
        knowledge.listCurrentBeliefs(knowledgeId).map((x) => x.state),
        [],
        "no current cognition was smuggled in",
      );

      // 4) an EXPLICIT SUPERSEDE of a conflicting target advances cognition (C-FIX-13)
      await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [
          {
            statement: "market D (supersedes B)",
            dimension: "market",
            relationHint: { kind: "SUPERSEDE", supersedesClaimRef: b.claimIds[0]! },
          },
        ],
      });
      const states = new Map(knowledge.listBeliefs(knowledgeId).map((x) => [x.claimRef, x.state]));
      assert.equal(states.get(`artifact:claim/${b.claimIds[0]}`), "superseded");
      assert.equal(knowledge.listOpenConflicts().length, 1, "the conflict event stays OPEN");
      assert.equal(slotOf("market").status, "conflicting", "an open conflict still blocks sufficiency");
      assert.equal(gapOf("market").gapType, "conflict");

      // 5) nothing was deleted anywhere in the chain
      const hist = knowledge.listBeliefs(knowledgeId);
      assert.ok(hist.length >= 4);
      for (const id of [...a.claimIds, ...b.claimIds]) {
        assert.ok(hist.some((x) => x.claimRef === `artifact:claim/${id}`), `${id} kept`);
      }
    } finally {
      db.close();
    }
  });

  test("C1-25 (§26.3): 'an ordinary claim may not revive a conflicted dimension' is a real guard", async () => {
    const { db, repo, knowledge, svc, sid } = await setupIndustry("C1 反例行业");
    try {
      const slotOf = (dimension: string) => repo.listPoolSlots(sid).find((s) => s.dimension === dimension)!;

      await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "demand A", dimension: "demand" }],
      });
      await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "demand B", dimension: "demand", relationHint: { kind: "CONFLICT" } }],
      });
      assert.equal(slotOf("demand").status, "conflicting");

      // The dangerous pattern this contract forbids: a plain claim silently restoring `sufficient`.
      await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "demand C", dimension: "demand" }],
      });

      const knowledgeId = knowledge.findKnowledgeBySubject("industry", sid)!.knowledgeId;
      const candidates = knowledge.listBeliefs(knowledgeId).filter((x) => x.state === "candidate");
      assert.equal(candidates.length, 1, "the ordinary claim became a candidate awaiting a human");
      assert.deepEqual(knowledge.listCurrentBeliefs(knowledgeId), []);
      assert.equal(slotOf("demand").status, "conflicting", "NOT sufficient");
    } finally {
      db.close();
    }
  });

  test("C1-26: the downstream chain (Pool → Gap → NextAction → State) keeps working after C1", async () => {
    const { db, repo, svc, sid } = await setupIndustry("C1 下游行业");
    try {
      await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market vs policy", dimension: "policy" }],
      });
      const requirements = repo.listRequirements(sid);
      assert.ok(requirements.length > 0, "requirements exist");
      assert.equal(repo.listPoolSlots(sid).length, requirements.length, "one slot per requirement");
      assert.ok(repo.listGaps(sid).length > 0, "gaps are still produced");
      assert.ok(repo.listNextActions(sid).length > 0, "next actions are still produced");
      const state = repo.getStateBySubject("industry", sid)!;
      assert.ok(state.version >= 1, "state projection still runs");
      assert.ok(state.researchGapIds.length >= 1, "open gaps reach the state projection");
    } finally {
      db.close();
    }
  });
});
