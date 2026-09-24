/**
 * KnowledgeBelief — a single evidence/claim-grounded cognition entry (Phase 2C).
 *
 * Phase C (C1) semantics — **the ONE current criterion** (C-FIX-12 / P5):
 *
 *     current belief  ≡  state === "confirmed"
 *
 * `candidate` / `rejected` / `revised` / `conflicting` / `superseded` are **NOT** current.
 * Belief rows are never deleted; a lifecycle change only ever *flips* `state`.
 */

export type KnowledgeBeliefState =
  /** Phase C: awaits an explicit human confirmation. Never current. */
  | "candidate"
  /** The ONLY current state. */
  | "confirmed"
  /** Phase C: explicitly rejected by a human. Neither current nor historical fact. */
  | "rejected"
  /** Kept as history; no longer current. */
  | "revised"
  /** Part of an unresolved (dimension-level) conflict; not current. */
  | "conflicting"
  /** Replaced as a whole; kept as history. */
  | "superseded";

/** The single value that means "current". */
export const CURRENT_BELIEF_STATE = "confirmed" as const;

/**
 * The ONE current predicate (C-FIX-12).
 * `KnowledgeRepository.listCurrentBeliefs()` is the single accessor; every other layer
 * (Pool / Report / CLI / Agent) must go through it instead of re-deriving "current".
 */
export function isCurrentBelief(state: KnowledgeBeliefState): boolean {
  return state === CURRENT_BELIEF_STATE;
}

/**
 * States a `REVISE` / `SUPERSEDE` target may legally be in (C-FIX-13).
 *
 * Dimension-level CONFLICT moves EVERY confirmed belief of that dimension to
 * `conflicting`; if only `confirmed` were evolvable, "explicit evolution is the legal way
 * out of an open conflict" would be algorithmically unreachable.
 */
export function isEvolvableBeliefState(state: KnowledgeBeliefState): boolean {
  return state === "confirmed" || state === "conflicting";
}

export type KnowledgeRelationType = "SUPPORT" | "REVISE" | "CONFLICT" | "SUPERSEDE";

export interface KnowledgeRelation {
  relation: KnowledgeRelationType;
  otherBeliefId: string;
  at: string;
}

export interface KnowledgeBelief {
  beliefId: string;
  knowledgeId: string;
  /** Artifact claim ref (kind="claim"), i.e. `artifact:claim/<claimId>`. */
  claimRef: string;
  /** research_source row id (traceability). */
  sourceRef?: string;
  /** evidence placeholder ref (traceability; may be empty in Echo path). */
  evidenceRef?: string;
  dimension: string;
  topic?: string;
  /** 0..1 */
  confidence: number;
  state: KnowledgeBeliefState;
  historicalRelations: KnowledgeRelation[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Deterministic belief identity (P6 / C-FIX-11):
 *
 *     beliefId = f(knowledgeId, claimRef)
 *
 * No timestamp, no randomness, no sequence number — so a repeated projection of the same
 * claim always maps to the same row and can be answered with an exact no-op.
 * Historical belief ids are NEVER rewritten (they may be referenced by conflicts/Pool/tests).
 */
export function beliefIdFor(knowledgeId: string, claimRef: string): string {
  return `bel-${knowledgeId}-${claimRef.replace(/[^A-Za-z0-9]+/g, "_")}`;
}
