/**
 * ReportService (S6) — builds READ-ONLY projections from the CURRENT research state.
 *
 * Reads (never writes): IndustryKnowledge beliefs/conflicts · Pool slots/items · Gaps ·
 * NextActions · ResearchState · the latest InvestmentEvaluation · ResearchPriority.
 * Writes: ONLY the appended projection row (I14 — the projection is not a source of truth).
 *
 * Explicitly NOT here (S6 red lines): Evidence, Target/Chain/Strategy, LLM extraction,
 * and any recomputation of ResearchPriority — the priority is presented as-is.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { KnowledgeRepository } from "../storage/knowledge-repository.js";
import { ReportRepository } from "../storage/report-repository.js";
import { MethodologyService } from "./methodology-service.js";
import { PriorityService } from "./priority-service.js";
import type {
  ChangeLine,
  ConflictLine,
  EvaluationSummary,
  FactLine,
  GapLine,
  IndustryDossier,
  KnowledgeBelief,
  KnowledgeLine,
  NextActionLine,
  PriorityLine,
  ReportSections,
  ReportSnapshot,
} from "../domain/index.js";

const MAX_RECENT = 10;

export class ReportService {
  constructor(private readonly db: DatabaseSync) {}

  /** J1 — a ReportSnapshot for any subject. */
  generateReport(subjectKind: ReportSnapshot["subjectKind"], subjectId: string): ReportSnapshot {
    const { sections, methodologyVersionId } = this.build(subjectKind, subjectId);
    const snapshot: ReportSnapshot = {
      reportId: `report-${randomUUID()}`,
      reportKind: "report",
      subjectKind,
      subjectId,
      methodologyVersionId,
      generatedAt: new Date().toISOString(),
      sections,
    };
    new ReportRepository(this.db).saveProjection(snapshot);
    return snapshot;
  }

  /** J2 — an IndustryDossier: the same projection, specialised for an industry. */
  generateDossier(industryId: string): IndustryDossier {
    const { sections, methodologyVersionId } = this.build("industry", industryId);
    const knowledge = new KnowledgeRepository(this.db).findKnowledgeBySubject("industry", industryId);
    const dossier: IndustryDossier = {
      dossierId: `dossier-${randomUUID()}`,
      reportKind: "dossier",
      industryId,
      subjectKind: "industry",
      subjectId: industryId,
      knowledgeVersion: knowledge?.version ?? 0,
      methodologyVersionId,
      generatedAt: new Date().toISOString(),
      sections,
    };
    new ReportRepository(this.db).saveProjection(dossier);
    return dossier;
  }

  // ---- assembly (pure reads) -------------------------------------------------

  private build(
    subjectKind: ReportSnapshot["subjectKind"],
    subjectId: string,
  ): { sections: ReportSections; methodologyVersionId: string } {
    const repo = new ResearchRepository(this.db);
    const knowledgeRepo = new KnowledgeRepository(this.db);
    const methodology = new MethodologyService(repo).getActive();

    const knowledge = knowledgeRepo.findKnowledgeBySubject(subjectKind, subjectId);
    const allBeliefs: KnowledgeBelief[] = knowledge ? knowledgeRepo.listBeliefs(knowledge.knowledgeId) : [];
    const currentBeliefs: KnowledgeBelief[] = knowledge
      ? knowledgeRepo.listCurrentBeliefs(knowledge.knowledgeId)
      : [];

    const toLine = (b: KnowledgeBelief): KnowledgeLine => ({
      beliefId: b.beliefId,
      dimension: b.dimension,
      state: b.state,
      claimRef: b.claimRef,
      sourceRef: b.sourceRef,
    });

    // 当前认知 = every current belief; 主要判断 = the confirmed ones.
    const currentKnowledge = currentBeliefs.map(toLine);
    const mainJudgments = currentBeliefs.filter((b) => b.state === "confirmed").map(toLine);

    // 关键事实 = Pool items (they reference claims; the fact itself is not copied).
    const slots = repo.listPoolSlots(subjectId);
    const keyFacts: FactLine[] = slots.flatMap((s) =>
      repo.listPoolItems(s.slotId).map((it) => ({
        slotId: s.slotId,
        dimension: s.dimension,
        claimRef: it.claimRef,
        relation: it.relation,
      })),
    );

    // 主要冲突 (subject-scoped, both sides retained).
    const subjectClaimRefs = new Set(allBeliefs.map((b) => b.claimRef));
    const conflicts: ConflictLine[] = knowledgeRepo
      .listOpenConflicts()
      .filter((c) => subjectClaimRefs.has(c.claimARef) || subjectClaimRefs.has(c.claimBRef))
      .map((c) => ({
        conflictId: c.conflictId,
        dimension: c.dimension,
        claimARef: c.claimARef,
        claimBRef: c.claimBRef,
        status: c.status,
      }));

    // 缺口 (active gaps, with their producing dimension).
    const requirementById = new Map(repo.listRequirements(subjectId).map((r) => [r.requirementId, r]));
    const gaps: GapLine[] = repo
      .listGaps(subjectId)
      .filter((g) => g.status === "open" || g.status === "mitigating")
      .map((g) => ({
        gapId: g.gapId,
        dimension: requirementById.get(g.relatedRequirementIds[0] ?? "")?.dimension ?? "",
        gapType: g.gapType,
        status: g.status,
        importance: g.importance,
        uncertainty: g.uncertainty,
      }));

    // 最近变化 = belief relations, newest first (deterministic tie-break).
    const recentChanges: ChangeLine[] = allBeliefs
      .flatMap((b) =>
        b.historicalRelations.map((r) => ({
          beliefId: b.beliefId,
          relation: r.relation,
          otherBeliefId: r.otherBeliefId,
          at: r.at,
        })),
      )
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.beliefId < b.beliefId ? -1 : 1))
      .slice(0, MAX_RECENT);

    // 最近证据 = distinct claim refs, newest belief first.
    const seen = new Set<string>();
    const recentEvidence: string[] = [];
    for (const b of [...allBeliefs].sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : x.beliefId < y.beliefId ? -1 : 1))) {
      if (seen.has(b.claimRef)) continue;
      seen.add(b.claimRef);
      recentEvidence.push(b.claimRef);
      if (recentEvidence.length >= MAX_RECENT) break;
    }

    // 当前评价 = a summary of the latest evaluation (null when none exists).
    const ev = repo.getLatestEvaluation(subjectKind, subjectId);
    const evaluation: EvaluationSummary | null = ev
      ? {
          evaluationId: ev.evaluationId,
          methodologyVersionId: ev.methodologyVersionId,
          evaluated: ev.coverage.evaluated,
          insufficient: ev.coverage.insufficient,
          conflicting: ev.coverage.conflicting,
          total: ev.coverage.total,
          decisionStatus: ev.decision.decisionStatus,
          decisionReason: ev.decision.decisionReason,
        }
      : null;

    // 优先级 = READ-ONLY presentation of the S5 priorities (never recomputed here).
    const priority: PriorityLine[] = new PriorityService(this.db)
      .rank(subjectId, subjectKind)
      .map((p) => ({
        gapId: p.gapId,
        score: p.score,
        rationale: p.rationale,
        policyVersionId: p.policyVersionId,
      }));

    // 下一步 = open actions, already ordered by the repository (priority DESC).
    const nextActions: NextActionLine[] = repo
      .listNextActions(subjectId)
      .filter((a) => a.status === "open")
      .map((a) => ({
        actionId: a.actionId,
        kind: a.kind,
        priority: a.priority,
        rationale: a.rationale,
        gapId: typeof a.params?.gapId === "string" ? (a.params.gapId as string) : undefined,
      }));

    return {
      methodologyVersionId: methodology.versionId,
      sections: {
        currentKnowledge,
        keyFacts,
        mainJudgments,
        conflicts,
        gaps,
        recentChanges,
        recentEvidence,
        evaluation,
        priority,
        nextActions,
      },
    };
  }
}
