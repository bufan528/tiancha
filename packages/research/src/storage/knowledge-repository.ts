/**
 * KnowledgeRepository — SQLite persistence for Phase 2C knowledge entities.
 *
 * Invariant-driven design:
 *  - belief rows are INSERTed and never DELETEd; REVISE/SUPERSEDE add a new row
 *    and only *flip* the old row's state (old row content is preserved).
 *  - conflict resolution flips status only; neither Claim/Belief is deleted.
 *  - no method overwrites history.
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  IndustryKnowledge,
  KnowledgeBelief,
  KnowledgeBeliefState,
  KnowledgeConflict,
} from "../domain/index.js";

export class KnowledgeRepository {
  constructor(private readonly db: DatabaseSync) {}

  // ---- IndustryKnowledge (header) ----
  upsertKnowledge(k: IndustryKnowledge): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO industry_knowledge
         (knowledge_id, subject_kind, subject_id, version, created_at, updated_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(k.knowledgeId, k.subjectKind, k.subjectId, k.version, k.createdAt, k.updatedAt);
  }

  getKnowledge(id: string): IndustryKnowledge | undefined {
    const row = this.db
      .prepare("SELECT * FROM industry_knowledge WHERE knowledge_id = ?")
      .get(id) as any;
    return row ? rowToKnowledge(row) : undefined;
  }

  /** Latest-version knowledge for a subject (current projection anchor). */
  findKnowledgeBySubject(kind: string, subjectId: string): IndustryKnowledge | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM industry_knowledge WHERE subject_kind = ? AND subject_id = ? ORDER BY version DESC",
      )
      .get(kind, subjectId) as any;
    if (!row) return undefined;
    const knowledge = rowToKnowledge(row);
    knowledge.beliefs = this.listCurrentBeliefs(knowledge.knowledgeId);
    return knowledge;
  }

  // ---- KnowledgeBelief ----
  /** INSERT only — never REPLACE, to preserve history. */
  insertBelief(b: KnowledgeBelief): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_belief
         (belief_id, knowledge_id, claim_ref, source_ref, evidence_ref, dimension, topic,
          confidence, state, historical_relations_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        b.beliefId,
        b.knowledgeId,
        b.claimRef,
        b.sourceRef ?? null,
        b.evidenceRef ?? null,
        b.dimension,
        b.topic ?? null,
        b.confidence,
        b.state,
        JSON.stringify(b.historicalRelations),
        b.createdAt,
        b.updatedAt,
      );
  }

  getBelief(id: string): KnowledgeBelief | undefined {
    const row = this.db.prepare("SELECT * FROM knowledge_belief WHERE belief_id = ?").get(id) as any;
    return row ? rowToBelief(row) : undefined;
  }

  /** All beliefs for a knowledge record, INCLUDING historical (revised/superseded). */
  listBeliefs(knowledgeId: string): KnowledgeBelief[] {
    const rows = this.db
      .prepare("SELECT * FROM knowledge_belief WHERE knowledge_id = ? ORDER BY created_at ASC")
      .all(knowledgeId) as any[];
    return rows.map(rowToBelief);
  }

  /** Current projection: beliefs not superseded (history retained elsewhere). */
  listCurrentBeliefs(knowledgeId: string): KnowledgeBelief[] {
    return this.listBeliefs(knowledgeId).filter((b) => b.state !== "superseded");
  }

  /**
   * Flip a belief's state (e.g. confirmed→revised/superseded/conflicting).
   * This mutates status only; the row and its provenance are preserved.
   */
  updateBeliefState(beliefId: string, state: KnowledgeBeliefState, updatedAt: string): void {
    this.db
      .prepare("UPDATE knowledge_belief SET state = ?, updated_at = ? WHERE belief_id = ?")
      .run(state, updatedAt, beliefId);
  }

  // ---- KnowledgeConflict ----
  insertConflict(c: KnowledgeConflict): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_conflict
         (conflict_id, claim_a_ref, claim_b_ref, dimension, status, related_gap_id,
          created_at, resolved_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        c.conflictId,
        c.claimARef,
        c.claimBRef,
        c.dimension,
        c.status,
        c.relatedGapId ?? null,
        c.createdAt,
        c.resolvedAt ?? null,
      );
  }

  getConflict(id: string): KnowledgeConflict | undefined {
    const row = this.db
      .prepare("SELECT * FROM knowledge_conflict WHERE conflict_id = ?")
      .get(id) as any;
    return row ? rowToConflict(row) : undefined;
  }

  /** Resolve / accept — flips status only, deletes neither Claim nor Belief. */
  resolveConflict(id: string, status: "resolved" | "accepted", resolvedAt: string): void {
    this.db.prepare("UPDATE knowledge_conflict SET status = ?, resolved_at = ? WHERE conflict_id = ?")
      .run(status, resolvedAt, id);
  }

  listOpenConflicts(): KnowledgeConflict[] {
    const rows = this.db
      .prepare("SELECT * FROM knowledge_conflict WHERE status = 'open' ORDER BY created_at ASC")
      .all() as any[];
    return rows.map(rowToConflict);
  }
}

function rowToKnowledge(row: any): IndustryKnowledge {
  return {
    knowledgeId: row.knowledge_id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    beliefs: [],
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToBelief(row: any): KnowledgeBelief {
  return {
    beliefId: row.belief_id,
    knowledgeId: row.knowledge_id,
    claimRef: row.claim_ref,
    sourceRef: row.source_ref ?? undefined,
    evidenceRef: row.evidence_ref ?? undefined,
    dimension: row.dimension,
    topic: row.topic ?? undefined,
    confidence: row.confidence,
    state: row.state,
    historicalRelations: JSON.parse(row.historical_relations_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToConflict(row: any): KnowledgeConflict {
  return {
    conflictId: row.conflict_id,
    claimARef: row.claim_a_ref,
    claimBRef: row.claim_b_ref,
    dimension: row.dimension,
    status: row.status,
    relatedGapId: row.related_gap_id ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}
