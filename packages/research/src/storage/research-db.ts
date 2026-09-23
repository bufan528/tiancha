/**
 * ResearchDb — unified SQLite connection for Phase 2A business entities.
 * Owns a single DatabaseSync and creates all 2A tables idempotently.
 * Existing Phase 1 stores (ArtifactStore/EventStore) keep their own DB files;
 * this DB holds the research memory: industry/company/question/requirement/
 * gap/pool/state/source/document/next_action/methodology.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ResearchDbOptions {
  path: string;
}

export class ResearchDb {
  readonly db: DatabaseSync;
  readonly path: string;

  constructor(options: ResearchDbOptions) {
    this.path = options.path;
    if (this.path !== ":memory:" && !existsSync(dirname(this.path))) {
      mkdirSync(dirname(this.path), { recursive: true });
    }
    this.db = new DatabaseSync(this.path);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS industry (
        industry_id TEXT PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        description TEXT,
        reserve_status TEXT NOT NULL,
        current_state_id TEXT,
        current_evaluation_run_id TEXT,
        first_discovered_at TEXT NOT NULL,
        last_evaluated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS company (
        company_id TEXT PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        primary_industry_id TEXT,
        chain_position TEXT,
        current_state_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_question (
        question_id TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        statement TEXT NOT NULL,
        origin TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        depends_on_json TEXT NOT NULL,
        answer_claim_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS information_requirement (
        requirement_id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        dimension TEXT NOT NULL,
        description TEXT NOT NULL,
        importance INTEGER NOT NULL,
        required_evidence_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_gap (
        gap_id TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        description TEXT NOT NULL,
        importance INTEGER NOT NULL,
        uncertainty REAL NOT NULL,
        related_requirement_ids_json TEXT NOT NULL,
        related_question_ids_json TEXT NOT NULL,
        status TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS information_pool_entry (
        entry_id TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        status TEXT NOT NULL,
        related_requirement_ids_json TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_state (
        state_id TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        known_json TEXT NOT NULL,
        confirmed_json TEXT NOT NULL,
        uncertain_json TEXT NOT NULL,
        conflicting_json TEXT NOT NULL,
        unknown_json TEXT NOT NULL,
        key_question_ids_json TEXT NOT NULL,
        research_gap_ids_json TEXT NOT NULL,
        next_action_ids_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_source (
        source_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        publisher TEXT,
        title TEXT,
        published_at TEXT,
        is_real_external_data INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_document (
        document_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        raw_text_locator TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS next_action (
        action_id TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        params_json TEXT NOT NULL,
        depends_on_json TEXT NOT NULL,
        priority INTEGER NOT NULL,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS methodology (
        methodology_id TEXT PRIMARY KEY,
        version_tag TEXT NOT NULL,
        is_human_approved_baseline INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        activated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_industry_subject ON information_requirement(subject_id);
      CREATE INDEX IF NOT EXISTS idx_gap_subject ON research_gap(subject_id);
      CREATE INDEX IF NOT EXISTS idx_pool_subject ON information_pool_entry(subject_id);
      CREATE INDEX IF NOT EXISTS idx_state_subject ON research_state(subject_kind, subject_id);
      CREATE INDEX IF NOT EXISTS idx_action_subject ON next_action(subject_id);

      CREATE TABLE IF NOT EXISTS industry_knowledge (
        knowledge_id TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_belief (
        belief_id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        claim_ref TEXT NOT NULL,
        source_ref TEXT,
        evidence_ref TEXT,
        dimension TEXT NOT NULL,
        topic TEXT,
        confidence REAL NOT NULL,
        state TEXT NOT NULL,
        historical_relations_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_conflict (
        conflict_id TEXT PRIMARY KEY,
        claim_a_ref TEXT NOT NULL,
        claim_b_ref TEXT NOT NULL,
        dimension TEXT NOT NULL,
        status TEXT NOT NULL,
        related_gap_id TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_subject ON industry_knowledge(subject_kind, subject_id);
      CREATE INDEX IF NOT EXISTS idx_belief_knowledge ON knowledge_belief(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_belief_claim ON knowledge_belief(claim_ref);
      CREATE INDEX IF NOT EXISTS idx_belief_dimension ON knowledge_belief(dimension);
      CREATE INDEX IF NOT EXISTS idx_conflict_claims ON knowledge_conflict(claim_a_ref, claim_b_ref);
      CREATE INDEX IF NOT EXISTS idx_conflict_status ON knowledge_conflict(status);

      CREATE TABLE IF NOT EXISTS methodology_candidate (
        candidate_id TEXT PRIMARY KEY,
        base_version_id TEXT NOT NULL,
        proposed_dimensions_json TEXT NOT NULL,
        rationale TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        operator TEXT,
        comment TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_candidate_status ON methodology_candidate(status);

      CREATE TABLE IF NOT EXISTS human_gate (
        gate_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        decision TEXT,
        operator TEXT,
        comment TEXT,
        resume_token_hash TEXT,
        resume_token_scope_json TEXT,
        resume_token_expires_at TEXT,
        resume_token_consumed INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gate_status ON human_gate(status);
    `);
    this.ensureIndustryKnowledgeColumn();
    this.ensureMethodologyDimensionsColumn();
    this.ensureRequirementConditionColumns();
  }

  /**
   * Add industry.current_knowledge_id via PRAGMA pre-check (normal path).
   * try/catch is only a safety net; we never rely on swallowing "duplicate column".
   */
  private ensureIndustryKnowledgeColumn(): void {
    const cols = this.db.prepare("PRAGMA table_info(industry)").all() as { name: string }[];
    const exists = cols.some((c) => c.name === "current_knowledge_id");
    if (exists) return;
    try {
      this.db.exec("ALTER TABLE industry ADD COLUMN current_knowledge_id TEXT");
    } catch (err) {
      // Re-check after the fact: another writer may have added it concurrently.
      const after = this.db.prepare("PRAGMA table_info(industry)").all() as { name: string }[];
      if (!after.some((c) => c.name === "current_knowledge_id")) throw err;
    }
  }

  /**
   * Add methodology.dimensions_json via PRAGMA pre-check (same discipline as
   * ensureIndustryKnowledgeColumn): an activated version's dimensions must be
   * readable back, never re-derived from a constant.
   */
  private ensureMethodologyDimensionsColumn(): void {
    const cols = this.db.prepare("PRAGMA table_info(methodology)").all() as { name: string }[];
    if (cols.some((c) => c.name === "dimensions_json")) return;
    try {
      this.db.exec("ALTER TABLE methodology ADD COLUMN dimensions_json TEXT");
    } catch (err) {
      const after = this.db.prepare("PRAGMA table_info(methodology)").all() as { name: string }[];
      if (!after.some((c) => c.name === "dimensions_json")) throw err;
    }
  }

  /**
   * E1: information_requirement inherits the methodology dimension's judgement
   * conditions + preferred position kinds. Added via PRAGMA pre-check.
   */
  private ensureRequirementConditionColumns(): void {
    const cols = this.db.prepare("PRAGMA table_info(information_requirement)").all() as { name: string }[];
    const add = (name: string, ddl: string): void => {
      if (cols.some((c) => c.name === name)) return;
      try {
        this.db.exec(ddl);
      } catch (err) {
        const after = this.db.prepare("PRAGMA table_info(information_requirement)").all() as { name: string }[];
        if (!after.some((c) => c.name === name)) throw err;
      }
    };
    add("confirmed_condition", "ALTER TABLE information_requirement ADD COLUMN confirmed_condition TEXT");
    add("uncertain_condition", "ALTER TABLE information_requirement ADD COLUMN uncertain_condition TEXT");
    add("unknown_condition", "ALTER TABLE information_requirement ADD COLUMN unknown_condition TEXT");
    add(
      "preferred_position_kinds_json",
      "ALTER TABLE information_requirement ADD COLUMN preferred_position_kinds_json TEXT",
    );
  }

  close(): void {
    this.db.close();
  }
}
