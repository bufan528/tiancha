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
  InformationPoolSlot,
  InformationPoolItem,
  ResearchState,
  ResearchSource,
  ResearchDocument,
  NextAction,
  MethodologyVersion,
  MethodologyCandidate,
  HumanGate,
  InvestmentEvaluation,
  GapType,
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

  getQuestion(questionId: string): ResearchQuestion | undefined {
    const r = this.db.prepare("SELECT * FROM research_question WHERE question_id = ?").get(questionId) as any;
    return r
      ? {
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
        }
      : undefined;
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
          importance, required_evidence_type, sufficiency_policy_ref, confirmed_condition,
          uncertain_condition, unknown_condition, preferred_position_kinds_json, status,
          created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        r.sufficiencyPolicyRef ?? null,
        r.confirmedCondition,
        r.uncertainCondition,
        r.unknownCondition,
        JSON.stringify(r.preferredPositionKinds),
        r.status,
        r.createdAt,
        r.updatedAt,
      );
  }

  getRequirement(requirementId: string): InformationRequirement | undefined {
    const r = this.db
      .prepare("SELECT * FROM information_requirement WHERE requirement_id = ?")
      .get(requirementId) as any;
    if (!r) return undefined;
    return {
      requirementId: r.requirement_id,
      questionId: r.question_id,
      subjectKind: r.subject_kind,
      subjectId: r.subject_id,
      dimension: r.dimension,
      description: r.description,
      importance: r.importance,
      requiredEvidenceType: r.required_evidence_type,
      sufficiencyPolicyRef: r.sufficiency_policy_ref ?? undefined,
      confirmedCondition: r.confirmed_condition ?? "",
      uncertainCondition: r.uncertain_condition ?? "",
      unknownCondition: r.unknown_condition ?? "",
      preferredPositionKinds: r.preferred_position_kinds_json ? JSON.parse(r.preferred_position_kinds_json) : [],
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
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
      sufficiencyPolicyRef: r.sufficiency_policy_ref ?? undefined,
      confirmedCondition: r.confirmed_condition ?? "",
      uncertainCondition: r.uncertain_condition ?? "",
      unknownCondition: r.unknown_condition ?? "",
      preferredPositionKinds: r.preferred_position_kinds_json ? JSON.parse(r.preferred_position_kinds_json) : [],
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
         (gap_id, subject_kind, subject_id, description, gap_type, importance, uncertainty,
          related_requirement_ids_json, related_question_ids_json, status,
          discovered_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        g.gapId,
        g.subjectKind,
        g.subjectId,
        g.description,
        g.gapType,
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
      gapType: (r.gap_type ?? "unknown") as GapType,
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

  getPoolEntry(entryId: string): InformationPoolEntry | undefined {
    const r = this.db.prepare("SELECT * FROM information_pool_entry WHERE entry_id = ?").get(entryId) as any;
    return r
      ? {
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
        }
      : undefined;
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

  // ---- InformationPool: S3 Slot + Item ----
  upsertPoolSlot(s: InformationPoolSlot): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO information_pool_slot
         (slot_id, subject_kind, subject_id, dimension, status, coverage_judgement, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        s.slotId,
        s.subjectKind,
        s.subjectId,
        s.dimension,
        s.status,
        s.coverageJudgement,
        s.createdAt,
        s.updatedAt,
      );
  }

  getPoolSlot(slotId: string): InformationPoolSlot | undefined {
    const r = this.db.prepare("SELECT * FROM information_pool_slot WHERE slot_id = ?").get(slotId) as any;
    return r ? rowToPoolSlot(r) : undefined;
  }

  listPoolSlots(subjectId: string): InformationPoolSlot[] {
    const rows = this.db
      .prepare("SELECT * FROM information_pool_slot WHERE subject_id = ? ORDER BY created_at ASC")
      .all(subjectId) as any[];
    return rows.map(rowToPoolSlot);
  }

  /**
   * Upsert ONE pool item (S3-R1). Items are an ORGANIZING index of the claims under a
   * slot — they are never wholesale-replaced, so historical claims are never dropped.
   * I5: an item MUST reference a Claim.
   */
  upsertPoolItem(it: InformationPoolItem): void {
    if (!it.claimRef) throw new Error(`pool item ${it.itemId} must reference a Claim (I5)`);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO information_pool_item
         (item_id, slot_id, value_text, caliber, as_of, claim_ref, source_ref, relation, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        it.itemId,
        it.slotId,
        it.valueText,
        it.caliber ?? null,
        it.asOf ?? null,
        it.claimRef,
        it.sourceRef ?? null,
        it.relation,
        it.createdAt,
      );
  }

  /** Replace a slot's items wholesale. Used by migration/tests, NOT by the projection. */
  replacePoolItems(slotId: string, items: InformationPoolItem[]): void {
    this.db.prepare("DELETE FROM information_pool_item WHERE slot_id = ?").run(slotId);
    const ins = this.db.prepare(
      `INSERT OR REPLACE INTO information_pool_item
       (item_id, slot_id, value_text, caliber, as_of, claim_ref, source_ref, relation, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    for (const it of items) {
      // I5: an item MUST reference a Claim (Pool is an organizing layer, not a source of truth).
      if (!it.claimRef) throw new Error(`pool item ${it.itemId} must reference a Claim (I5)`);
      ins.run(
        it.itemId,
        it.slotId,
        it.valueText,
        it.caliber ?? null,
        it.asOf ?? null,
        it.claimRef,
        it.sourceRef ?? null,
        it.relation,
        it.createdAt,
      );
    }
  }

  listPoolItems(slotId: string): InformationPoolItem[] {
    const rows = this.db
      .prepare("SELECT * FROM information_pool_item WHERE slot_id = ? ORDER BY item_id ASC")
      .all(slotId) as any[];
    return rows.map(rowToPoolItem);
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
      // S5: `priority` is a 0..100 priority score (higher = do first); action_id keeps
      // the order deterministic when two actions share a score.
      .prepare("SELECT * FROM next_action WHERE subject_id = ? ORDER BY priority DESC, action_id ASC")
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

  // ---- HumanGate (durable approval credential; plaintext token never stored) ----
  upsertHumanGate(g: HumanGate): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO human_gate
         (gate_id, task_id, type, status, requested_at, decided_at, decision, operator, comment,
          resume_token_hash, resume_token_scope_json, resume_token_expires_at, resume_token_consumed)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        g.gateId,
        g.taskId,
        g.type,
        g.status,
        g.requestedAt,
        g.decidedAt ?? null,
        g.decision ?? null,
        g.operator ?? null,
        g.comment ?? null,
        g.resumeTokenHash ?? null,
        g.resumeTokenScope ? JSON.stringify(g.resumeTokenScope) : null,
        g.resumeTokenExpiresAt ?? null,
        g.resumeTokenConsumed ? 1 : 0,
      );
  }

  getHumanGate(id: string): HumanGate | undefined {
    const row = this.db.prepare("SELECT * FROM human_gate WHERE gate_id = ?").get(id) as any;
    return row ? rowToHumanGate(row) : undefined;
  }

  listHumanGates(status?: HumanGate["status"]): HumanGate[] {
    const rows = (
      status
        ? this.db.prepare("SELECT * FROM human_gate WHERE status = ? ORDER BY requested_at ASC").all(status)
        : this.db.prepare("SELECT * FROM human_gate ORDER BY requested_at ASC").all()
    ) as any[];
    return rows.map(rowToHumanGate);
  }

  // ---- InvestmentEvaluation (S4) ----
  upsertEvaluation(e: InvestmentEvaluation): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO investment_evaluation
         (evaluation_id, subject_kind, subject_id, methodology_version_id,
          evaluation_policy_version_id, aggregation_policy_version_id,
          dimension_evaluations_json, aggregation_json, coverage_json,
          sufficiency_summary_json, critical_flags_json, decision_json, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.evaluationId,
        e.subjectKind,
        e.subjectId,
        e.methodologyVersionId,
        e.evaluationPolicyVersionId,
        e.aggregationPolicyVersionId,
        JSON.stringify(e.dimensionEvaluations),
        JSON.stringify(e.aggregation),
        JSON.stringify(e.coverage),
        JSON.stringify(e.sufficiencySummary),
        JSON.stringify(e.criticalFlags),
        JSON.stringify(e.decision),
        e.createdAt,
      );
  }

  getEvaluation(evaluationId: string): InvestmentEvaluation | undefined {
    const r = this.db
      .prepare("SELECT * FROM investment_evaluation WHERE evaluation_id = ?")
      .get(evaluationId) as any;
    return r ? rowToEvaluation(r) : undefined;
  }

  getLatestEvaluation(subjectKind: string, subjectId: string): InvestmentEvaluation | undefined {
    const r = this.db
      .prepare(
        "SELECT * FROM investment_evaluation WHERE subject_kind = ? AND subject_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(subjectKind, subjectId) as any;
    return r ? rowToEvaluation(r) : undefined;
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

function rowToHumanGate(row: any): HumanGate {
  return {
    gateId: row.gate_id,
    taskId: row.task_id,
    type: row.type,
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at ?? undefined,
    decision: row.decision ?? undefined,
    operator: row.operator ?? undefined,
    comment: row.comment ?? undefined,
    resumeTokenHash: row.resume_token_hash ?? undefined,
    resumeTokenScope: row.resume_token_scope_json ? JSON.parse(row.resume_token_scope_json) : undefined,
    resumeTokenExpiresAt: row.resume_token_expires_at ?? undefined,
    resumeTokenConsumed: row.resume_token_consumed === 1,
  };
}

function rowToPoolSlot(row: any): InformationPoolSlot {
  return {
    slotId: row.slot_id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    dimension: row.dimension,
    status: row.status,
    coverageJudgement: row.coverage_judgement,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPoolItem(row: any): InformationPoolItem {
  return {
    itemId: row.item_id,
    slotId: row.slot_id,
    valueText: row.value_text,
    caliber: row.caliber ?? undefined,
    asOf: row.as_of ?? undefined,
    claimRef: row.claim_ref,
    sourceRef: row.source_ref ?? undefined,
    relation: row.relation,
    createdAt: row.created_at,
  };
}

function rowToEvaluation(row: any): InvestmentEvaluation {
  return {
    evaluationId: row.evaluation_id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    methodologyVersionId: row.methodology_version_id,
    evaluationPolicyVersionId: row.evaluation_policy_version_id ?? "",
    aggregationPolicyVersionId: row.aggregation_policy_version_id ?? "",
    dimensionEvaluations: JSON.parse(row.dimension_evaluations_json),
    aggregation: JSON.parse(row.aggregation_json),
    coverage: JSON.parse(row.coverage_json),
    sufficiencySummary: JSON.parse(row.sufficiency_summary_json),
    criticalFlags: JSON.parse(row.critical_flags_json),
    decision: JSON.parse(row.decision_json),
    createdAt: row.created_at,
  };
}
