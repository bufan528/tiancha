/**
 * Claim — semantic proposition with orthogonal claimType + provenance.
 * source_role mixing is deprecated (04 §4.2).
 */

export type ClaimType =
  | "descriptive"
  | "causal"
  | "forecast"
  | "interpretation"
  | "hypothesis";

export type Provenance =
  | "official"
  | "management"
  | "analyst"
  | "expert"
  | "user"
  | "third_party";

export type HypothesisStatus = "confirmed" | "refuted" | "open";

export interface Hypothesis {
  hypothesisId: string;
  statement: string;
  status: HypothesisStatus;
  evidenceIds: string[];
}

export interface Claim {
  claimId: string;
  statement: string;
  claimType: ClaimType;
  provenance: Provenance;
  conflictOfInterest: boolean;
  factIds: string[];
  evidenceIds: string[];
}
