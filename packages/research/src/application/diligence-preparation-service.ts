/**
 * DiligencePreparationService (Phase B v1 · Step B4; identity/lifecycle aligned by Phase C2).
 *
 * For ONE human-confirmed target it assembles a preparation from persisted state, with NO
 * model and NO report generation.
 *
 * The three question sources are produced explicitly (contract §2.6):
 *   ① common          — one per active Requirement (industry-wide), traceable to it;
 *   ② target_specific — only where this target can actually answer (answerability ≥ partial);
 *   ③ fit_derived     — where answerability is weak/none: the low fit is STATED as a caveat
 *                       instead of being silently dropped.
 *
 * Phase C2 (Gap-driven Research Planning) changes IDENTITY + LIFECYCLE only — nothing else:
 *  - **deterministic question identity** from stable refs:
 *    `dq-<preparationRef>-<source>-<canonicalRef>`, `canonicalRef = fromRequirementRef ?? fromFitRef`;
 *  - **`current` / `retired` lifecycle**: one preparation row, but `questions[]` is
 *    **append + retire — never delete** (§4.4 / I-C2-6);
 *  - **revival reuses the SAME question** (identity + `firstAskedAt` preserved);
 *  - **scope follows the open gaps** (`{ all: true }` is an explicit audit mode only, I-C2-9).
 *
 * It writes exactly one thing: its own `diligence_preparation` row (upsert by `dp-<targetRef>`);
 * every other source of truth (Gap / Pool / Knowledge / Priority) is READ-ONLY here.
 */

import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { KnowledgeRepository } from "../storage/knowledge-repository.js";
import { MethodologyService } from "./methodology-service.js";
import { QuestionTargetFitService } from "./question-target-fit-service.js";
import {
  canonicalQuestionRef,
  questionRefFor,
  type CurrentUnderstanding,
  type DiligencePreparation,
  type DiligenceQuestion,
} from "../domain/index.js";

export interface PrepareOptions {
  /**
   * ★ C2 (I-C2-9): explicit AUDIT mode — fit the target against ALL requirements.
   * It is never reached implicitly: an empty active set stays empty (converged); it does
   * NOT fall back to the full requirement set.
   */
  all?: boolean;
}

/** One run's per-question input (identity + lifecycle fields are added by the merge). */
type QuestionDraft = Omit<DiligenceQuestion, "questionRef" | "state" | "firstAskedAt" | "retiredAt">;

export class DiligencePreparationService {
  constructor(private readonly db: DatabaseSync) {}

  /** Generate (or regenerate) the preparation for one human-confirmed target. */
  prepare(targetRef: string, options: PrepareOptions = {}): DiligencePreparation {
    const repo = new ResearchRepository(this.db);
    const target = repo.getTarget(targetRef);
    if (!target) throw new Error(`unknown target '${targetRef}'`);
    const position = repo.getPosition(target.positionRef);
    if (!position) throw new Error(`unknown position '${target.positionRef}'`);

    const requirementById = new Map(repo.listRequirements(target.industryId).map((r) => [r.requirementId, r]));
    // ★ C2: default scope = the requirements that are still research-needed.
    const fits = new QuestionTargetFitService(this.db).fitAll(targetRef, { all: options.all });

    const preparationRef = `dp-${targetRef}`;
    const now = new Date().toISOString();
    const evidence = position.suitableEvidenceKinds.length > 0 ? position.suitableEvidenceKinds.join("、") : "相关证据";
    const cautions = new Set<string>();

    /** ★ C2: this run's questions, keyed by DETERMINISTIC identity (stable refs only). */
    const desired = new Map<string, QuestionDraft>();
    const add = (source: DiligenceQuestion["source"], draft: Omit<QuestionDraft, "source">): void => {
      const canonicalRef = canonicalQuestionRef(draft);
      if (!canonicalRef) return; // I-B5: a question must trace back to a Requirement / Fit
      desired.set(questionRefFor(preparationRef, source, canonicalRef), { source, ...draft });
    };

    for (const fit of fits) {
      const requirement = requirementById.get(fit.questionRef);
      if (!requirement) continue;

      // ① common — the industry-wide question (always present, traceable to the Requirement)
      add("common", {
        text: `请确认：${requirement.description}`,
        fromRequirementRef: requirement.requirementId,
        fromFitRef: null,
        isFallbackSource: false,
        caveat: null,
        expectedAnswerType: "现状 + 依据 + 口径",
        priority: fit.priority,
      });

      // ② target_specific — only where this target can actually answer
      if (fit.answerability === "strong" || fit.answerability === "partial") {
        add("target_specific", {
          text: `请从「${target.subjectKey}（${target.targetKind}）」的角度说明：${requirement.description}（希望提供：${evidence}）`,
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
        add("fit_derived", {
          text: `「${target.subjectKey}」对该问题的适配度仅 ${fit.answerability}：${
            fit.requiresFallback ? "需要更合适的对象并交叉验证" : "仅作参考"
          }`,
          fromRequirementRef: requirement.requirementId,
          fromFitRef: fit.fitRef,
          isFallbackSource: fit.requiresFallback,
          caveat,
          expectedAnswerType: "（需另寻对象）",
          priority: fit.priority,
        });
      }
    }

    // ★ C2 merge (§4.4 / I-C2-6): the preparation stays ONE row, but its questions are
    // append + retire. Existing questions are REUSED — identity and `firstAskedAt` are
    // preserved, so a revived question IS the same question — questions that are no longer
    // needed are retired, and NOTHING is ever deleted.
    const existing = repo.getPreparation(preparationRef);
    const previous = new Map((existing?.questions ?? []).map((q) => [q.questionRef, q]));

    const questions: DiligenceQuestion[] = [];
    for (const [questionRef, draft] of desired) {
      const before = previous.get(questionRef);
      questions.push({
        questionRef,
        ...draft,
        state: "current",
        // ★ when this question FIRST entered a preparation — never changes (A / B / C).
        firstAskedAt: before?.firstAskedAt ?? now,
        // ★ a previously retired question keeps its retirement history when it revives.
        ...(before?.retiredAt !== undefined ? { retiredAt: before.retiredAt } : {}),
      });
    }
    for (const q of existing?.questions ?? []) {
      if (desired.has(q.questionRef)) continue;
      questions.push({
        ...q,
        state: "retired",
        // the first retirement time is kept; a later retirement refreshes it.
        retiredAt: q.state === "retired" && q.retiredAt !== undefined ? q.retiredAt : now,
      });
    }

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
    const repo = new ResearchRepository(this.db);
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
      // ★ C2: a READ-ONLY count of already-resolved gaps (nothing is recomputed or invented here).
      convergedGapCount: repo.listGaps(industryId).filter((g) => g.status === "resolved").length,
    };
  }
}
