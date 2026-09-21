/**
 * Evidence + EvidenceAssertion. Evidence→Claim is a stance-bearing assertion.
 * Contradiction engine queries stance=contradict (04 §4.3).
 */

export type EvidenceStance = "support" | "contradict" | "contextualize" | "weaken";

export type VerificationStatus = "verified" | "partially" | "unverified" | "contradicted";

export type EvidenceLocator =
  | { kind: "pdf_page"; page: number }
  | { kind: "web"; url: string; paragraph?: number }
  | { kind: "wind_field"; dataset: string; field: string; query?: string }
  | { kind: "interview"; recordId: string; timestamp?: string };

export interface Evidence {
  evidenceId: string;
  claimId: string;
  sourceId: string;
  locator: EvidenceLocator;
  verificationStatus: VerificationStatus;
  confidence: number;
  provenance: string;
  conflictOfInterest: boolean;
}

export interface EvidenceAssertion {
  evidenceId: string;
  claimId: string;
  stance: EvidenceStance;
  /** 0..1 argument strength for this claim. */
  strength: number;
  /** 0..1 system-combined confidence. */
  confidence: number;
}
