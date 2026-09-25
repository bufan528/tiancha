/**
 * ResearchNeed (Phase B v1) — a **derived, read-only ValueObject**.
 *
 * Contract §2.1 / I-B6: it is a projection of `Gap + Requirement + Priority + Methodology`.
 * It is NEVER persisted, NEVER mutated, and NEVER written back to Gap / Requirement /
 * Priority. Its `whyStudyNotJustFetch` is a RULE EXPLANATION drawn from a closed enum —
 * not free-form prose (which, without a model, would be a pile of hard-coded copy).
 */

import type { GapStatus, GapType } from "./research-gap.js";

export interface ResearchNeed {
  /** Derived identity: the gap it comes from. */
  needId: string;
  gapId: string;
  /** ★ C2 Step 2-C: the gap's own lifecycle attributes, carried through VERBATIM (read-only). */
  gapType: GapType;
  status: GapStatus;
  requirementId: string;
  /** ★ C2 Step 2-C: the gap's FULL requirement set, verbatim (`gap.relatedRequirementIds`). */
  requirementRefs: string[];
  dimension: string;
  /** The question to answer — taken from the requirement, not newly authored. */
  question: string;
  /** ★ Rule explanation, drawn from `WHY_STUDY_REASONS`. */
  whyStudyNotJustFetch: WhyStudyReason;
  /** Positions (under the current template) that satisfy this requirement. */
  suggestedPositionRefs: string[];
  /** S5 priority, READ ONLY. */
  priorityScore: number;
  priorityPolicyVersionId: string;
}

/** The closed set of explanations (contract §2.1). */
export const WHY_STUDY_REASONS = [
  "需要一手信息",
  "需要独立第三方证据消解分歧",
  "需要补充一手证据以满足确认条件",
  "需要补充可溯源证据",
  "需要补充证据",
] as const;

export type WhyStudyReason = (typeof WHY_STUDY_REASONS)[number];

/**
 * The ONLY mapping allowed for `whyStudyNotJustFetch` (contract §2.1). Deterministic,
 * auditable, and testable — no free text.
 */
export function whyStudyNotJustFetch(gapType: GapType, requiresFirstHand: boolean): WhyStudyReason {
  if (gapType === "conflict") return "需要独立第三方证据消解分歧";
  if (gapType === "unknown") {
    return requiresFirstHand ? "需要一手信息" : "需要补充证据";
  }
  // insufficient
  return requiresFirstHand ? "需要补充一手证据以满足确认条件" : "需要补充可溯源证据";
}
