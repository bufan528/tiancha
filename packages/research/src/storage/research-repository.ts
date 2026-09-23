/**
 * ResearchRepository — SQLite CRUD for Phase 2A business entities.
 * Pure persistence; no business logic. Business rules live in application/.
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  Industry,
  Company,
  ResearchQuestion,
  InformationRequirement,
  ResearchGap,
  InformationPoolEntry,
  ResearchState,
  ResearchSource,
  ResearchDocument,
  NextAction,
  MethodologyVersion,
  MethodologyCandidate,
} from "../domain/index.js";

export class ResearchRepository {
  constructor(public readonly db: DatabaseSync) {}

  /**
   * Run fn inside a single SQLite transaction; rolls back on any throw.
   * Used for atomic multi-row decisions (e.g. methodology activation check+write).
   */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---- Industry ----
  upsertIndustry(i: Industry): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO industry
         (industry_id, canonical_name, aliases_json, description, reserve_status,
          current_state_id, current_evaluation_run_id, current_knowledge_id,
          first_discovered_at, last_evaluated_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        i.industryId,
        i.canonicalName,
        JSON.stringify(i.aliases),
        i.description ?? null,
        i.reserveStatus,
        i.currentStateId ?? null,
        i.currentEvaluationRunId ?? null,
        i.currentKnowledgeId ?? null,
        i.firstDiscoveredAt,
        i.lastEvaluatedAt ?? null,
        i.createdAt,
        i.updatedAt,
      );
  }

  getIndustry(id: string): Industry | undefined {
    const row = this.db.prepare("SELECT * FROM industry WHERE industry_id = ?").get(id) as any;
    return row ? rowToIndustry(row) : undefined;
  }

  findIndustryByName(name: string): Industry | undefined {
    const like = `%${name}%`;
    const rows = this.db
      .prepare("SELECT * FROM industry WHERE canonical_name LIKE ? OR aliases_json LIKE ?")
      .all(like, like) as any[];
    if (rows.length === 0) return undefined;
    // exact canonicalName match wins, else first alias hit
    const exact = rows.find((r) => r.canonical_name === name);
    return rowToIndustry(exact ?? rows[0]);
  }

  listIndustries(): Industry[] {
    const rows = this.db.prepare("SELECT * FROM industry ORDER BY created_at ASC").all() as any[];
    return rows.map(rowToIndustry);
  }

  // ---- Company ----
  upsertCompany(c: Company): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO company
         (company_id, canonical_name, aliases_json, primary_industry_id, chain_position,
          current_state_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        c.companyId,
        c.canonicalName,
        JSON.stringify(c.aliases),
        c.primaryIndustryId ?? null,
        c.chainPosition ?? null,
        c.currentStateId ?? null,
        c.createdAt,
        c.updatedAt,
      );
  }

  getCompany(id: string): Company | undefined {
    const row = this.db.prepare("SELECT * FROM company WHERE company_id = ?").get(id) as any;
    return row
      ? {
          companyId: row.company_id,
          canonicalName: row.canonical_name,
          aliases: JSON.parse(row.aliases_json),
          primaryIndustryId: row.primary_industry_id ?? undefined,
          chainPosition: row.chain_position ?? undefined,
          currentStateId: row.current_state_id ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : undefined;
  }

  // ---- ResearchQuestion ----
  upsertQuestion(q: ResearchQuestion): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO research_question
         (question_id, subject_kind, subject_id, statement, origin, status, priority,
          depends_on_json, answer_claim_ref, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        q.questionId,
        q.subjectKind,
        q.subjectId,
        q.statement,
        q.origin,
        q.status,
        q.priority,
        JSON.stringify(q.dependsOn),
        q.answerClaimRef ?? null,
        q.createdAt,
        q.updatedAt,
      );
  }

  listQuestions(subjectId: string): ResearchQuestion[] {
    const rows = this.db
      .prepare("SELECT * FROM research_question WHERE subject_id = ? ORDER BY priority ASC")
      .all(subjectId) as any[];
    return rows.map((r) => ({
      questionId: r.question_id,
      subjectKind: r.subject_kind,
      subjectId: r.subject_id,
      statement: r.statement,
      origin: r.origin,
      status: r.status,
      priority: r.priority,
      dependsOn: JSON.parse(r.depends_on_json),
      answerClaimRef: r.answer_claim_ref ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // ---- InformationRequirement ----
  upsertRequirement(r: InformationRequirement): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO information_requirement
         (requirement_id, question_id, subject_kind, subject_id, dimension, description,
          importance, required_evidence_type, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        r.requirementId,
        r.questionId,
        r.subjectKind,
        r.subjectId,
        r.dimension,
        r.description,
        r.importance,
        r.requiredEvidenceType,
        r.status,
        r.createdAt,
        r.updatedAt,
      );
  }

  listRequirements(subjectId: string): InformationRequirement[] {
    const rows = this.db
      .prepare("SELECT * FROM information_requirement WHERE subject_id = ? ORDER BY importance DESC")
      .all(subjectId) as any[];
    return rows.map((r) => ({
      requirementId: r.requirement_id,
      questionId: r.question_id,
      subjectKind: r.subject_kind,
      subjectId: r.subject_id,
      dimension: r.dimension,
      description: r.description,
      importance: r.importance,
      requiredEvidenceType: r.required_evidence_type,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // ---- ResearchGap ----
  upsertGap(g: ResearchGap): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO research_gap
         (gap_id, subject_kind, subject_id, description, importance, uncertainty,
          related_requirement_ids_json, related_question_ids_json, status,
          discovered_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        g.gapId,
        g.subjectKind,
        g.subjectId,
        g.description,
        g.importance,
        g.uncertainty,
        JSON.stringify(g.relatedRequirementIds),
        JSON.stringify(g.relatedQuestionIds),
        g.status,
        g.discoveredAt,
        g.updatedAt,
      );
  }

  listGaps(subjectId: string): ResearchGap[] {
    const rows = this.db
      .prepare("SELECT * FROM research_gap WHERE subject_id = ? ORDER BY importance DESC, uncertainty DESC")
      .all(subjectId) as any[];
    return rows.map((r) => ({
      gapId: r.gap_id,
      subjectKind: r.subject_kind,
      subjectId: r.subject_id,
      description: r.description,
      importance: r.importance,
      uncertainty: r.uncertainty,
      relatedRequirementIds: JSON.parse(r.related_requirement_ids_json),
      relatedQuestionIds: JSON.parse(r.related_question_ids_json),
      status: r.status,
      discoveredAt: r.discovered_at,
      updatedAt: r.updated_at,
    }));
  }

  // ---- InformationPool ----
  upsertPoolEntry(e: InformationPoolEntry): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO information_pool_entry
         (entry_id, subject_kind, subject_id, topic, status, related_requirement_ids_json,
          evidence_refs_json, note, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.entryId,
        e.subjectKind,
        e.subjectId,
        e.topic,
        e.status,
        JSON.stringify(e.relatedRequirementIds),
        JSON.stringify(e.evidenceRefs),
        e.note ?? null,
        e.createdAt,
        e.updatedAt,
      );
  }

  listPoolEntries(subjectId: string): InformationPoolEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM information_pool_entry WHERE subject_id = ? ORDER BY created_at ASC")
      .all(subjectId) as any[];
    return rows.map((r) => ({
      entryId: r.entry_id,
      subjectKind: r.subject_kind,
      subjectId: r.subject_id,
      topic: r.topic,
      status: r.status,
      relatedRequirementIds: JSON.parse(r.related_requirement_ids_json),
      evidenceRefs: JSON.parse(r.evidence_refs_json),
      note: r.note ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // ---- ResearchState ----
  upsertState(s: ResearchState): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO research_state
         (state_id, subject_kind, subject_id, known_json, confirmed_json, uncertain_json,
          conflicting_json, unknown_json, key_question_ids_json, research_gap_ids_json,
          next_action_ids_json, version, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        s.stateId,
        s.subjectKind,
        s.subjectId,
        JSON.stringify(s.known),
        JSON.stringify(s.confirmed),
        JSON.stringify(s.uncertain),
        JSON.stringify(s.conflicting),
        JSON.stringify(s.unknown),
        JSON.stringify(s.keyQuestionIds),
        JSON.stringify(s.researchGapIds),
        JSON.stringify(s.nextActionIds),
        s.version,
        s.createdAt,
        s.updatedAt,
      );
  }

  getStateBySubject(kind: string, subjectId: string): ResearchState | undefined {
    const row = this.db
      .prepare("SELECT * FROM research_state WHERE subject_kind = ? AND subject_id = ? ORDER BY version DESC")
      .get(kind, subjectId) as any;
    return row ? rowToState(row) : undefined;
  }

  // ---- Source / Document ----
  upsertSource(s: ResearchSource): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO research_source
         (source_id, type, publisher, title, published_at, is_real_external_data, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        s.sourceId,
        s.type,
        s.publisher ?? null,
        s.title ?? null,
        s.publishedAt ?? null,
        s.isRealExternalData ? 1 : 0,
        s.createdAt,
      );
  }

  getSource(id: string): ResearchSource | undefined {
    const row = this.db.prepare("SELECT * FROM research_source WHERE source_id = ?").get(id) as any;
    return row
      ? {
          sourceId: row.source_id,
          type: row.type,
          publisher: row.publisher ?? undefined,
          title: row.title ?? undefined,
          publishedAt: row.published_at ?? undefined,
          isRealExternalData: row.is_real_external_data === 1,
          createdAt: row.created_at,
        }
      : undefined;
  }

  upsertDocument(d: ResearchDocument): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO research_document
         (document_id, source_id, title, raw_text_locator, created_at)
         VALUES (?,?,?,?,?)`,
      )
      .run(d.documentId, d.sourceId, d.title, d.rawTextLocator ?? null, d.createdAt);
  }

  // ---- NextAction ----
  upsertNextAction(a: NextAction): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO next_action
         (action_id, subject_kind, subject_id, kind, params_json, depends_on_json, priority,
          rationale, status, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        a.actionId,
        a.subjectKind,
        a.subjectId,
        a.kind,
        JSON.stringify(a.params),
        JSON.stringify(a.dependsOn),
        a.priority,
        a.rationale,
        a.status,
        a.createdBy,
        a.createdAt,
        a.updatedAt,
      );
  }

  listNextActions(subjectId: string): NextAction[] {
    const rows = this.db
      .prepare("SELECT * FROM next_action WHERE subject_id = ? ORDER BY priority ASC")
      .all(subjectId) as any[];
    return rows.map((r) => ({
      actionId: r.action_id,
      subjectKind: r.subject_kind,
      subjectId: r.subject_id,
      kind: r.kind,
      params: JSON.parse(r.params_json),
      dependsOn: JSON.parse(r.depends_on_json),
      priority: r.priority,
      rationale: r.rationale,
      status: r.status,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // ---- Methodology (versioned; Invariant 6: only human-approved versions activate) ----
  upsertMethodology(m: MethodologyVersion): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO methodology
         (methodology_id, version_tag, is_human_approved_baseline, created_at, activated_at, dimensions_json)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        m.versionId,
        m.versionTag,
        m.isHumanApprovedBaseline ? 1 : 0,
        m.createdAt,
        m.activatedAt ?? null,
        JSON.stringify(m.dimensions),
      );
  }

  getMethodology(id: string): MethodologyVersion | undefined {
    const row = this.db.prepare("SELECT * FROM methodology WHERE methodology_id = ?").get(id) as any;
    return row ? rowToMethodology(row) : undefined;
  }

  listMethodologies(): MethodologyVersion[] {
    const rows = this.db.prepare("SELECT * FROM methodology ORDER BY created_at ASC").all() as any[];
    return rows.map(rowToMethodology);
  }

  /** The currently activated version (latest activatedAt). Never a constant. */
  getActiveMethodology(): MethodologyVersion | undefined {
    const row = this.db
      .prepare("SELECT * FROM methodology WHERE activated_at IS NOT NULL ORDER BY activated_at DESC LIMIT 1")
      .get() as any;
    return row ? rowToMethodology(row) : undefined;
  }

  // ---- MethodologyCandidate (proposal; never active until human-approved) ----
  upsertMethodologyCandidate(c: MethodologyCandidate): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO methodology_candidate
         (candidate_id, base_version_id, proposed_dimensions_json, rationale, evidence_refs_json,
          status, created_by, created_at, decided_at, operator, comment)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        c.candidateId,
        c.baseVersionId,
        JSON.stringify(c.proposedDimensions),
        c.rationale,
        JSON.stringify(c.evidenceRefs),
        c.status,
        c.createdBy,
        c.createdAt,
        c.decidedAt ?? null,
        c.operator ?? null,
        c.comment ?? null,
      );
  }

  getMethodologyCandidate(id: string): MethodologyCandidate | undefined {
    const row = this.db
      .prepare("SELECT * FROM methodology_candidate WHERE candidate_id = ?")
      .get(id) as any;
    return row ? rowToMethodologyCandidate(row) : undefined;
  }

  listMethodologyCandidates(status?: MethodologyCandidate["status"]): MethodologyCandidate[] {
    const rows = (
      status
        ? this.db
            .prepare("SELECT * FROM methodology_candidate WHERE status = ? ORDER BY created_at ASC")
            .all(status)
        : this.db.prepare("SELECT * FROM methodology_candidate ORDER BY created_at ASC").all()
    ) as any[];
    return rows.map(rowToMethodologyCandidate);
  }
}

function rowToIndustry(row: any): Industry {
  return {
    industryId: row.industry_id,
    canonicalName: row.canonical_name,
    aliases: JSON.parse(row.aliases_json),
    description: row.description ?? undefined,
    reserveStatus: row.reserve_status,
    currentStateId: row.current_state_id ?? undefined,
    currentEvaluationRunId: row.current_evaluation_run_id ?? undefined,
    currentKnowledgeId: row.current_knowledge_id ?? undefined,
    firstDiscoveredAt: row.first_discovered_at,
    lastEvaluatedAt: row.last_evaluated_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToState(row: any): ResearchState {
  return {
    stateId: row.state_id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    known: JSON.parse(row.known_json),
    confirmed: JSON.parse(row.confirmed_json),
    uncertain: JSON.parse(row.uncertain_json),
    conflicting: JSON.parse(row.conflicting_json),
    unknown: JSON.parse(row.unknown_json),
    keyQuestionIds: JSON.parse(row.key_question_ids_json),
    researchGapIds: JSON.parse(row.research_gap_ids_json),
    nextActionIds: JSON.parse(row.next_action_ids_json),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMethodology(row: any): MethodologyVersion {
  return {
    versionId: row.methodology_id,
    versionTag: row.version_tag,
    dimensions: row.dimensions_json ? JSON.parse(row.dimensions_json) : [],
    isHumanApprovedBaseline: row.is_human_approved_baseline === 1,
    createdAt: row.created_at,
    activatedAt: row.activated_at ?? undefined,
  };
}

function rowToMethodologyCandidate(row: any): MethodologyCandidate {
  return {
    candidateId: row.candidate_id,
    baseVersionId: row.base_version_id,
    proposedDimensions: JSON.parse(row.proposed_dimensions_json),
    rationale: row.rationale,
    evidenceRefs: JSON.parse(row.evidence_refs_json),
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
    operator: row.operator ?? undefined,
    comment: row.comment ?? undefined,
  };
}
