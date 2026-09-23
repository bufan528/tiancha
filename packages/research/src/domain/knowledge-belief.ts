/**
 * KnowledgeBelief — a single evidence/claim-grounded cognition entry (Phase 2C).
 * state enum deliberately omits "current": current projection is expressed by
 * Knowledge.beliefs[], not by state. Historical belief rows are never deleted.
 */

export type KnowledgeBeliefState = "confirmed" | "revised" | "conflicting" | "superseded";

export type KnowledgeRelationType = "SUPPORT" | "REVISE" | "CONFLICT" | "SUPERSEDE";

export interface KnowledgeRelation {
  relation: KnowledgeRelationType;
  otherBeliefId: string;
  at: string;
}

export interface KnowledgeBelief {
  beliefId: string;
  knowledgeId: string;
  /** Artifact claim ref (kind="claim"). */
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
