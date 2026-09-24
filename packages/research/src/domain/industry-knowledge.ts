/**
 * IndustryKnowledge — first-class long-term Research Cognition (Phase 2C).
 * Not a Claim list and not a SELECT projection: it is evidence/claim-grounded
 * cognition with provenance, time, confidence, state, history and conflict.
 * Knowledge.beliefs[] is the **current** projection; historical belief rows are
 * never deleted.
 *
 * Phase C (C1) notes:
 *  - `beliefs[]` carries the CURRENT cognition, defined by the single predicate
 *    `state === "confirmed"` (see knowledge-belief.ts / C-FIX-12). `candidate`,
 *    `rejected`, `revised`, `conflicting` and `superseded` are NOT current.
 *  - **`industry.current_knowledge_id` is DEPRECATED** (contract §2.4 / P4): it is a legacy
 *    column that would create a SECOND source of truth for "current". Phase C never reads or
 *    writes it; the current projection is derived from belief state only
 *    (`KnowledgeRepository.listCurrentBeliefs()`). Kept in the schema for compatibility and
 *    to be cleaned up in a later, separate migration.
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
