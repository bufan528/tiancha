/**
 * IndustryKnowledge — first-class long-term Research Cognition (Phase 2C).
 * Not a Claim list and not a SELECT projection: it is evidence/claim-grounded
 * cognition with provenance, time, confidence, state, history and conflict.
 * Knowledge.beliefs[] is the *current* projection; historical belief rows are
 * never deleted.
 */

import type { KnowledgeBelief } from "./knowledge-belief.js";

export type KnowledgeSubjectKind = "industry" | "company" | "general";

export interface IndustryKnowledge {
  knowledgeId: string;
  subjectKind: KnowledgeSubjectKind;
  subjectId: string;
  /** Current projection only; historical belief rows persist in storage. */
  beliefs: KnowledgeBelief[];
  version: number;
  createdAt: string;
  updatedAt: string;
}
