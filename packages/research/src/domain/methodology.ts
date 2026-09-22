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
