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
  /**
   * CURRENT projection only — the live, re-computable view of this subject's
   * research cognition. This header row is UPDATABLE (INSERT OR REPLACE).
   *
   * VERSION SEMANTICS: `version` is the version number of the CURRENT projection,
   * NOT a snapshot/history table. We deliberately do NOT introduce a Knowledge
   * Snapshot / Version History table (out of 2C scope). v1→v2→v3 is expressed as:
   * same knowledgeId, current version=N, beliefs = current projection; old beliefs
   * keep their row but flip to revised/conflicting/superseded, new beliefs are
   * appended. The real Evolution History lives in KnowledgeBelief rows +
   * KnowledgeRelation + KnowledgeConflict — never in this header.
   */
  beliefs: KnowledgeBelief[];
  version: number;
  createdAt: string;
  updatedAt: string;
}
