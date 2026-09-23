/**
 * KnowledgeConflict — preserved disagreement as a knowledge asset (Phase 2C).
 * Never silently pick a side: resolving only changes status; neither Claim/Belief
 * is deleted.
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
