/**
 * C6 fix (review P1) — the ONE place that decides whether an EXPLICIT evolution target
 * (`REVISE` / `SUPERSEDE`) is legal.
 *
 * Why a shared helper: the human DECISION (`CandidateReviewService.confirm`) and the
 * PROJECTION (`CandidateProjectionService.project`) must judge the same target the same way.
 * Previously the decision only checked that the ref was a non-empty string, while the
 * knowledge projection REJECTED anything else by returning `SKIPPED / INVALID_EVOLUTION_TARGET`
 * — a skip, not a throw. The projection wrapper ignored that return value and still closed the
 * candidate as `finalized`, so an impossible supersede was recorded as done, with no
 * `KnowledgeBelief` ever replaced.
 *
 * The predicate mirrors `KnowledgeProjectionService.projectFromClaim` step ② (C-FIX-8 /
 * C-FIX-13): the target must exist for the SAME subject, live on the SAME dimension, and be in
 * a state that evolution may leave (`confirmed` | `conflicting`).
 */

import { isEvolvableBeliefState, type KnowledgeBelief } from "../domain/index.js";
import type { KnowledgeRepository } from "../storage/knowledge-repository.js";
import { normalizeClaimRef } from "./knowledge-projection-service.js";

/** Closed, machine-readable refusal set — never free-form prose. */
export type EvolutionTargetRefusal =
  | "TARGET_NOT_FOUND"
  | "TARGET_DIMENSION_MISMATCH"
  | "TARGET_STATE_NOT_EVOLVABLE";

export type EvolutionTargetCheck =
  | { ok: true; belief: KnowledgeBelief }
  | { ok: false; reason: EvolutionTargetRefusal };

/** One message per refusal so the decision path and the projection path explain it identically. */
export function evolutionTargetRefusalMessage(reason: EvolutionTargetRefusal, targetClaimRef: string): string {
  switch (reason) {
    case "TARGET_NOT_FOUND":
      return `evolution target ${targetClaimRef} does not exist for this subject (no belief carries that claim ref)`;
    case "TARGET_DIMENSION_MISMATCH":
      return `evolution target ${targetClaimRef} belongs to a DIFFERENT dimension — a claim may only evolve a belief of its own dimension`;
    case "TARGET_STATE_NOT_EVOLVABLE":
      return `evolution target ${targetClaimRef} is not in an evolvable state (only "confirmed" or "conflicting" may be superseded/revised)`;
  }
}

/**
 * Read-only check. Returns the target belief when legal, otherwise a typed refusal.
 * Zero mutation in every branch.
 */
export function checkEvolutionTarget(input: {
  knowledge: KnowledgeRepository;
  subjectKind: string;
  subjectId: string;
  /** The dimension of the claim that wants to evolve the target. */
  dimension: string;
  targetClaimRef: string;
}): EvolutionTargetCheck {
  const knowledgeId = input.knowledge.findKnowledgeBySubject(input.subjectKind, input.subjectId)?.knowledgeId;
  if (knowledgeId === undefined) return { ok: false, reason: "TARGET_NOT_FOUND" };

  const belief = input.knowledge.findBeliefByKnowledgeAndClaim(knowledgeId, normalizeClaimRef(input.targetClaimRef));
  if (belief === undefined) return { ok: false, reason: "TARGET_NOT_FOUND" };
  if (belief.dimension !== input.dimension) return { ok: false, reason: "TARGET_DIMENSION_MISMATCH" };
  if (!isEvolvableBeliefState(belief.state)) return { ok: false, reason: "TARGET_STATE_NOT_EVOLVABLE" };

  return { ok: true, belief };
}
