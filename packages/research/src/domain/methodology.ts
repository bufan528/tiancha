/**
 * Methodology — Human-approved research framework (Phase 2A).
 * v1 is a frozen baseline; model must NOT auto-modify v1.
 * Changes flow: Material → MethodologyCandidate → Agent Explanation →
 * Human Review → New Version → Activate.
 */

/**
 * MethodologyDimension — one research dimension of a methodology version.
 *
 * B3: three responsibilities stay semantically separate even though they live in
 * one aggregate:
 *   - Research Framework : key/name/description/whyNeeded/requiredInfo + 三个 condition
 *   - Evaluation Policy  : weight + criticality（how this dimension is judged）
 *   - Aggregation Policy : NOT here（12→7 位于聚合策略，后续阶段）
 */
export interface MethodologyDimension {
  // --- Research Framework：该研究什么 ---
  key: string;
  name: string;
  description: string;
  whyNeeded: string;
  requiredInfo: string;
  confirmedCondition: string;
  uncertainCondition: string;
  unknownCondition: string;
  // --- Evaluation Policy：怎么评 ---
  /** Relative weight of this dimension in research evaluation (0..1). */
  weight: number;
  /** Critical dimension: insufficient evidence here must block a direct "reserve" conclusion. */
  criticality: "normal" | "critical";
}

/**
 * E1: derive a requirement's 1..5 importance level from the dimension's
 * Evaluation-Policy weight. Kept in the domain so that changing a dimension's
 * weight (through methodology evolution) changes requirement importance,
 * instead of relying on a hard-coded constant.
 */
export function dimensionImportance(weight: number): number {
  if (weight >= 0.1) return 5;
  if (weight >= 0.08) return 4;
  if (weight >= 0.06) return 3;
  if (weight >= 0.04) return 2;
  return 1;
}

export interface MethodologyVersion {
  versionId: string;
  versionTag: string;
  dimensions: MethodologyDimension[];
  isHumanApprovedBaseline: boolean;
  createdAt: string;
  activatedAt?: string;
}

export type MethodologyCandidateStatus = "pending" | "approved" | "rejected";

/**
 * MethodologyCandidate — a proposed change to the research framework.
 * Flow: Material → MethodologyCandidate → Human Review → New Version → Activate.
 * A candidate NEVER takes effect by itself: only after a human decision does the
 * activation create a NEW MethodologyVersion; the previous version is retained
 * (Invariant 6: Methodology cannot Activate without Human Gate).
 */
export interface MethodologyCandidate {
  candidateId: string;
  /** The version this proposal is based on. */
  baseVersionId: string;
  /** Full proposed dimension list (base with the changes applied). */
  proposedDimensions: MethodologyDimension[];
  /** Why this change is proposed (from material or field-research counterexamples). */
  rationale: string;
  /** Evidence / material refs that triggered the proposal. */
  evidenceRefs: string[];
  status: MethodologyCandidateStatus;
  createdBy: "agent" | "user";
  createdAt: string;
  decidedAt?: string;
  operator?: string;
  comment?: string;
}
