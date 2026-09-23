/**
 * Methodology — Human-approved research framework (Phase 2A).
 * v1 is a frozen baseline; model must NOT auto-modify v1.
 * Changes flow: Material → MethodologyCandidate → Agent Explanation →
 * Human Review → New Version → Activate.
 */

export interface MethodologyDimension {
  key: string;
  name: string;
  description: string;
  whyNeeded: string;
  requiredInfo: string;
  confirmedCondition: string;
  uncertainCondition: string;
  unknownCondition: string;
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
