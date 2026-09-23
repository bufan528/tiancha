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

export type ClaimSubjectKind = "industry" | "company" | "general";

/** Temporal relation of this Claim to prior claims (T9: never overwrite silently). */
export type ClaimTemporalRelation = "current" | "old" | "superseded";

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
  /** Which research object this claim belongs to (Phase 2A). */
  subjectKind: ClaimSubjectKind;
  subjectId: string;
  /** current = live; old = retained but superseded by a newer claim; superseded = replaced. */
  temporalRelation: ClaimTemporalRelation;
  /**
   * Whether the evidence behind this claim comes from a real external data
   * source. Placeholder providers (e.g. Echo) MUST set false so downstream
   * Knowledge projection never promotes placeholder data into confirmed beliefs.
   */
  isRealExternalData: boolean;
}
