/**
 * KnowledgeConflict — preserved disagreement as a knowledge asset (Phase 2C).
 *
 * Phase C (C1) semantics:
 *  - **never pick a side**: two conflicting beliefs both lose `confirmed` (dimension-level);
 *  - a conflict is a **direct pair** record: state propagation to the whole dimension is NOT
 *    expressed as fake `B↔D` / `C↔D` edges (C-FIX-1: propagation ≠ relation graph);
 *  - `resolveConflict()` only moves `open → resolved`; it never restores current cognition
 *    (C-FIX-10: closing the event ≠ knowing which side is true);
 *  - neither Claim nor Belief is ever deleted.
 */

export type KnowledgeConflictStatus = "open" | "resolved" | "accepted";

export interface KnowledgeConflict {
  conflictId: string;
  claimARef: string;
  claimBRef: string;
  dimension: string;
  status: KnowledgeConflictStatus;
  relatedGapId?: string;
  createdAt: string;
  resolvedAt?: string;
}

/**
 * Canonical (direction-free) ordering of a conflicting pair (C-FIX-5).
 * `(A, B)` and `(B, A)` must describe the SAME conflict.
 */
export function canonicalClaimPair(aRef: string, bRef: string): [string, string] {
  return aRef <= bRef ? [aRef, bRef] : [bRef, aRef];
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_");
}

/**
 * Deterministic, direction-free conflict identity (P6 / C-FIX-5):
 *
 *     conflictId = f(dimension, sort([claimARef, claimBRef]))
 *
 * Without canonicalisation the same conflict would appear twice (`KCF-1: A↔B`, `KCF-2: B↔A`),
 * which would break the exact-no-op guarantee of §16.2.
 */
export function conflictIdFor(dimension: string, aRef: string, bRef: string): string {
  const [first, second] = canonicalClaimPair(aRef, bRef);
  return `kcf-${slug(dimension)}-${slug(first)}-${slug(second)}`;
}
