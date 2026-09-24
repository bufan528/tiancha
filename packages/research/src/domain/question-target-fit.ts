/**
 * QuestionTargetFit (Phase B v1 · Step B3) — a RULE-DERIVED judgement of
 * "can this target actually answer this question?".
 *
 * B3 red lines (contract §2.5 + reviewer):
 *  - **deterministic & rule-based**: `targetKind × dimension → answerability`; NO model.
 *    The whole judgement lives in the pure function `evaluateFit()` below.
 *  - **`fitReason` is REQUIRED** and drawn from a closed set of rule phrases.
 *  - `weak | none` on an **important** question ⇒ `requiresFallback` + a reason/caveat —
 *    never a silent downgrade.
 *  - **B3 STATES the fallback need; it NEVER picks or creates another target.** A fallback
 *    subject must still pass B2's human-confirmed boundary.
 *  - Fit is **not persisted** and writes nothing: it is an explanation layer over
 *    Question × Target.
 */

import { FALLBACK_CAVEAT } from "./research-target.js";

export type Answerability = "strong" | "partial" | "weak" | "none";

/** The closed set of rule phrases (no free prose — this runs without a model). */
export const FIT_REASONS = [
  "该对象类型匹配，且所在位置正是该问题的目标位置",
  "该对象类型匹配，但不在该问题的目标位置",
  "该对象在目标位置，但类型不完全匹配",
  "该对象所在位置可提供相关证据，但不专门服务该维度",
  "该对象与该问题无明确关联",
] as const;
export type FitReason = (typeof FIT_REASONS)[number];

/** An importance at or above this forces a fallback when the fit is weak/none. */
export const IMPORTANT_QUESTION_MIN_IMPORTANCE = 4;

/** Deterministic confidence per answerability (no randomness, no model). */
const CONFIDENCE: Record<Answerability, number> = {
  strong: 0.9,
  partial: 0.6,
  weak: 0.3,
  none: 0.1,
};

const DOWNGRADE: Record<Answerability, Answerability> = {
  strong: "partial",
  partial: "weak",
  weak: "none",
  none: "none",
};

export interface QuestionTargetFit {
  /** Deterministic: `fit-<targetRef>-<questionRef>`. */
  fitRef: string;
  /** The question — a Phase B question IS an open Requirement. */
  questionRef: string;
  targetRef: string;
  canAnswer: boolean;
  answerability: Answerability;
  /** REQUIRED, rule-derived. */
  fitReason: string;
  /** Traceability: what the judgement was based on. */
  evidenceBasisRefs: string[];
  confidence: number;
  /** Caveats contributed by the target and the position (fed downstream). */
  limitations: string[];
  /** READ ONLY: the S5 priority of this question's gap. */
  priority: number;
  /** ★ B3 raises the fallback NEED — it never chooses a fallback target. */
  requiresFallback: boolean;
  fallbackReason: string | null;
}

/** The minimal facts `evaluateFit()` needs (all already persisted). */
export interface FitInput {
  target: { targetRef: string; targetKind: string; isFallback: boolean; limitations: string[] };
  position: {
    positionRef: string;
    /** Requirements this position serves — a position INSTANCE stores requirement refs,
     *  not raw dimension keys (contract §2.3). "Serves the question" replaces the old
     *  `dimensionKeys.includes(dimension)` check, with identical semantics. */
    satisfiesRequirementRefs: string[];
    suggestedTargetKinds: string[];
    suitableEvidenceKinds: string[];
    limitations: string[];
  };
  question: { requirementId: string; dimension: string; importance: number };
}

export interface FitEvaluation {
  answerability: Answerability;
  fitReason: string;
  evidenceBasisRefs: string[];
  limitations: string[];
  confidence: number;
  requiresFallback: boolean;
  fallbackReason: string | null;
}

/** ★ The one and only fit rule. Pure, deterministic, model-free. */
export function evaluateFit(input: FitInput): FitEvaluation {
  const { target, position, question } = input;
  const kindMatch = position.suggestedTargetKinds.includes(target.targetKind);
  const servesQuestion = position.satisfiesRequirementRefs.includes(question.requirementId);

  let answerability: Answerability;
  let baseReason: FitReason;
  if (kindMatch && servesQuestion) {
    answerability = "strong";
    baseReason = FIT_REASONS[0];
  } else if (kindMatch) {
    answerability = "partial";
    baseReason = FIT_REASONS[1];
  } else if (servesQuestion) {
    answerability = "partial";
    baseReason = FIT_REASONS[2];
  } else if (position.suitableEvidenceKinds.length > 0) {
    answerability = "weak";
    baseReason = FIT_REASONS[3];
  } else {
    answerability = "none";
    baseReason = FIT_REASONS[4];
  }

  // Deterministic downgrade on an explicit signal only (a fallback SOURCE is at least one
  // step lower). Free-text `limitations` are carried as caveats, never pattern-matched.
  let fitReason: string = baseReason;
  if (target.isFallback && answerability !== "none") {
    answerability = DOWNGRADE[answerability];
    fitReason = `${baseReason}；但该对象为备选来源（${FALLBACK_CAVEAT}），适配度降一级`;
  }

  const limitations = [...new Set([...target.limitations, ...position.limitations])];
  const weak = answerability === "weak" || answerability === "none";
  const requiresFallback = weak && question.importance >= IMPORTANT_QUESTION_MIN_IMPORTANCE;

  return {
    answerability,
    fitReason,
    evidenceBasisRefs: [
      `position:${position.positionRef}`,
      `targetKind:${target.targetKind}`,
      `dimension:${question.dimension}`,
      `requirement:${question.requirementId}`,
    ],
    limitations,
    confidence: CONFIDENCE[answerability],
    requiresFallback,
    fallbackReason: requiresFallback
      ? `问题重要度 ${question.importance}（≥${IMPORTANT_QUESTION_MIN_IMPORTANCE}）而该对象适配度仅 ${answerability}，需要更合适的对象，并降低置信度、交叉验证`
      : null,
  };
}

/** `canAnswer` is derived, never stored separately. */
export function canAnswer(answerability: Answerability): boolean {
  return answerability !== "none";
}

/**
 * B5 exposure: a READ-ONLY count of one target's fits — "how well does this object cover
 * the open questions, and how often does it raise a fallback need?".
 *
 * It is pure aggregation over `QuestionTargetFit[]` (no new semantics, no new state), so
 * the CLI and the Agent render the SAME numbers instead of each re-deriving them.
 */
export interface FitSummary {
  questionCount: number;
  strong: number;
  partial: number;
  weak: number;
  none: number;
  /** Questions where this target cannot do the job and a fallback is demanded (I-B4). */
  requiresFallback: number;
}

export function summarizeFits(fits: QuestionTargetFit[]): FitSummary {
  const summary: FitSummary = {
    questionCount: fits.length,
    strong: 0,
    partial: 0,
    weak: 0,
    none: 0,
    requiresFallback: 0,
  };
  for (const fit of fits) {
    summary[fit.answerability] += 1;
    if (fit.requiresFallback) summary.requiresFallback += 1;
  }
  return summary;
}
