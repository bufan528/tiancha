/**
 * DiligencePreparationService (Phase B v1 · Step B4) — assembles a preparation from
 * persisted state, with NO model and NO report generation.
 *
 * The three question sources are produced explicitly (contract §2.6):
 *   ① common          — one per active Requirement (industry-wide), traceable to it;
 *   ② target_specific — only where this target can actually answer (answerability ≥ partial);
 *   ③ fit_derived     — where answerability is weak/none: the low fit is STATED as a caveat
 *                       instead of being silently dropped.
 *
 * It writes exactly one thing: its own `diligence_preparation` row (upsert by
 * `dp-<targetRef>`); every other source of truth is read-only here.
 */

import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { KnowledgeRepository } from "../storage/knowledge-repository.js";
import { MethodologyService } from "./methodology-service.js";
import { QuestionTargetFitService } from "./question-target-fit-service.js";
import type {
  CurrentUnderstanding,
  DiligencePreparation,
  DiligenceQuestion,
} from "../domain/index.js";

export class DiligencePreparationService {
  constructor(private readonly db: DatabaseSync) {}

  /** Generate (or regenerate) the preparation for one human-confirmed target. */
  prepare(targetRef: string): DiligencePreparation {
    const repo = new ResearchRepository(this.db);
    const target = repo.getTarget(targetRef);
    if (!target) throw new Error(`unknown target '${targetRef}'`);
    const position = repo.getPosition(target.positionRef);
    if (!position) throw new Error(`unknown position '${target.positionRef}'`);

    const requirementById = new Map(repo.listRequirements(target.industryId).map((r) => [r.requirementId, r]));
    const fits = new QuestionTargetFitService(this.db).fitAll(targetRef);

    const preparationRef = `dp-${targetRef}`;
    const questions: DiligenceQuestion[] = [];
    const cautions = new Set<string>();
    let index = 0;
    const push = (q: Omit<DiligenceQuestion, "questionRef">): void => {
      // Contract §4 identity: `dq-<preparationRef>-<n>`.
      questions.push({ questionRef: `dq-${preparationRef}-${++index}`, ...q });
    };
    const evidence = position.suitableEvidenceKinds.length > 0 ? position.suitableEvidenceKinds.join("、") : "相关证据";

    for (const fit of fits) {
      const requirement = requirementById.get(fit.questionRef);
      if (!requirement) continue;

      // ① common — the industry-wide question (always present, traceable to the Requirement)
      push({
        text: `请确认：${requirement.description}`,
        source: "common",
        fromRequirementRef: requirement.requirementId,
        fromFitRef: null,
        isFallbackSource: false,
        caveat: null,
        expectedAnswerType: "现状 + 依据 + 口径",
        priority: fit.priority,
      });

      // ② target_specific — only where this target can actually answer
      if (fit.answerability === "strong" || fit.answerability === "partial") {
        push({
          text: `请从「${target.subjectKey}（${target.targetKind}）」的角度说明：${requirement.description}（希望提供：${evidence}）`,
          source: "target_specific",
          fromRequirementRef: requirement.requirementId,
          fromFitRef: fit.fitRef,
          isFallbackSource: false,
          caveat: null,
          expectedAnswerType: position.suitableEvidenceKinds[0] ?? "相关证据",
          priority: fit.priority,
        });
      }

      // ③ fit_derived — the fit is too low; SAY SO rather than silently dropping the question
      if (fit.answerability === "weak" || fit.answerability === "none") {
        const caveat = fit.requiresFallback
          ? (fit.fallbackReason ?? "该对象适配度低，需要更合适的对象并交叉验证")
          : "该对象适配度低，仅作参考";
        cautions.add(caveat);
        push({
          text: `「${target.subjectKey}」对该问题的适配度仅 ${fit.answerability}：${
            fit.requiresFallback ? "需要更合适的对象并交叉验证" : "仅作参考"
          }`,
          source: "fit_derived",
          fromRequirementRef: requirement.requirementId,
          fromFitRef: fit.fitRef,
          isFallbackSource: fit.requiresFallback,
          caveat,
          expectedAnswerType: "（需另寻对象）",
          priority: fit.priority,
        });
      }
    }

    const now = new Date().toISOString();
    const existing = repo.getPreparation(preparationRef);

    const preparation: DiligencePreparation = {
      preparationRef,
      targetRef,
      industryRef: target.industryId,
      purpose: target.researchPurpose,
      targetBrief: `${target.subjectKey}（${target.targetKind}）· 位置：${position.label}`,
      currentUnderstanding: this.understanding(target.industryId),
      whyThisTarget: `${position.whyImportant}；${target.selectionReason}`,
      requestedData: [...new Set(position.suitableEvidenceKinds)],
      requestedMaterials: [],
      cautions: [...cautions],
      risks: [],
      limitations: target.limitations,
      methodologyVersionRef: new MethodologyService(repo).getActive().versionId,
      questions,
      status: existing?.status ?? "draft",
      createdAt: existing?.createdAt ?? now,
    };

    repo.upsertPreparation(preparation);
    return preparation;
  }

  get(preparationRef: string): DiligencePreparation | undefined {
    return new ResearchRepository(this.db).getPreparation(preparationRef);
  }

  list(industryId: string): DiligencePreparation[] {
    return new ResearchRepository(this.db).listPreparations(industryId);
  }

  /** ★ Read-only Knowledge projection (what we already understand). */
  private understanding(industryId: string): CurrentUnderstanding {
    const knowledge = new KnowledgeRepository(this.db);
    const subject = knowledge.findKnowledgeBySubject("industry", industryId);
    const beliefs = subject ? knowledge.listCurrentBeliefs(subject.knowledgeId) : [];
    const claimRefs = new Set(beliefs.map((b) => b.claimRef));
    const conflicts = knowledge
      .listOpenConflicts()
      .filter((c) => claimRefs.has(c.claimARef) || claimRefs.has(c.claimBRef));
    return {
      beliefs: beliefs.map((b) => ({ dimension: b.dimension, state: b.state, claimRef: b.claimRef })),
      conflictCount: conflicts.length,
      knowledgeVersion: subject?.version ?? 0,
    };
  }
}
