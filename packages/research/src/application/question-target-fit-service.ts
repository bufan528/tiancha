/**
 * QuestionTargetFitService (Phase B v1 · Step B3) — assembles fits from persisted state.
 *
 * It READS target / position / requirement / gap + the S5 read-only priority face, and
 * returns `QuestionTargetFit` value objects. It **writes nothing** (there is no table),
 * and it **never creates or selects a target** — a fallback subject must still pass B2's
 * human-confirmed boundary.
 */

import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { PriorityService } from "./priority-service.js";
import { canAnswer, evaluateFit, summarizeFits } from "../domain/question-target-fit.js";
import { ActiveRequirementResolver } from "../domain/active-requirement.js";
import type {
  FitSummary,
  InformationRequirement,
  QuestionTargetFit,
  ResearchPosition,
  ResearchTarget,
} from "../domain/index.js";

export class QuestionTargetFitService {
  constructor(private readonly db: DatabaseSync) {}

  /** Fit ONE target against ONE question (a question = an InformationRequirement). */
  fit(targetRef: string, questionRef: string): QuestionTargetFit {
    const repo = new ResearchRepository(this.db);
    const target = repo.getTarget(targetRef);
    if (!target) throw new Error(`unknown target '${targetRef}'`);
    const requirement = repo.getRequirement(questionRef);
    if (!requirement) throw new Error(`unknown question '${questionRef}'`);
    const position = repo.getPosition(target.positionRef);
    if (!position) throw new Error(`unknown position '${target.positionRef}'`);

    return this.assemble(target, position, requirement);
  }

  /**
   * Fit one target against the industry's questions, most important first.
   *
   * ★ C2: by default only the **currently research-needed** requirements are fitted — i.e.
   * those whose Gap is still open/mitigating, read from the EXISTING Gap semantics (the same
   * reading `ResearchNeedService` uses). C2 does NOT define a second Gap state machine
   * (I-C2-2). `{ all: true }` is the explicit audit mode and must never be reached
   * implicitly when the active set happens to be empty (I-C2-9).
   */
  fitAll(targetRef: string, options: { all?: boolean } = {}): QuestionTargetFit[] {
    const repo = new ResearchRepository(this.db);
    const target = repo.getTarget(targetRef);
    if (!target) throw new Error(`unknown target '${targetRef}'`);

    // ★ C2 Step 2-A: the active scope comes from the SHARED resolver (I-C2-13). The private
    // gap-status predicate that used to live here was REMOVED, so there is exactly one source.
    const requirements = options.all
      ? repo.listRequirements(target.industryId)
      : ActiveRequirementResolver.activeRequirements(
          repo.listGaps(target.industryId),
          repo.listRequirements(target.industryId),
        );

    return requirements
      .map((r) => this.fit(targetRef, r.requirementId))
      .sort(
        (a, b) =>
          b.priority - a.priority || (a.questionRef < b.questionRef ? -1 : a.questionRef > b.questionRef ? 1 : 0),
      );
  }

  /** ★ The fallback NEEDS B3 raises. It reports; it never picks a substitute target. */
  fallbackRequirements(targetRef: string): QuestionTargetFit[] {
    return this.fitAll(targetRef).filter((f) => f.requiresFallback);
  }

  /** B5 exposure: the read-only fit counts shown next to a target (pure aggregation). */
  summarize(targetRef: string): FitSummary {
    return summarizeFits(this.fitAll(targetRef));
  }

  // ---- assembly ---------------------------------------------------------------

  private assemble(
    target: ResearchTarget,
    position: ResearchPosition,
    requirement: InformationRequirement,
  ): QuestionTargetFit {
    const repo = new ResearchRepository(this.db);
    const gap = repo
      .listGaps(target.industryId)
      .find((g) => g.relatedRequirementIds.includes(requirement.requirementId));
    const priority = gap
      ? (new PriorityService(this.db).currentPriorities(target.industryId).find((p) => p.gapId === gap.gapId)?.score ??
        0)
      : 0;

    const evaluated = evaluateFit({
      target: {
        targetRef: target.targetRef,
        targetKind: target.targetKind,
        isFallback: target.isFallback,
        limitations: target.limitations,
      },
      position: {
        positionRef: position.positionRef,
        satisfiesRequirementRefs: position.satisfiesRequirementRefs,
        suggestedTargetKinds: position.suggestedTargetKinds,
        suitableEvidenceKinds: position.suitableEvidenceKinds,
        limitations: position.limitations,
      },
      question: {
        requirementId: requirement.requirementId,
        dimension: requirement.dimension,
        importance: requirement.importance,
      },
    });

    return {
      fitRef: `fit-${target.targetRef}-${requirement.requirementId}`,
      questionRef: requirement.requirementId,
      targetRef: target.targetRef,
      canAnswer: canAnswer(evaluated.answerability),
      answerability: evaluated.answerability,
      fitReason: evaluated.fitReason,
      evidenceBasisRefs: evaluated.evidenceBasisRefs,
      confidence: evaluated.confidence,
      limitations: evaluated.limitations,
      priority,
      requiresFallback: evaluated.requiresFallback,
      fallbackReason: evaluated.fallbackReason,
    };
  }
}
