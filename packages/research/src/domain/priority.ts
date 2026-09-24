/**
 * ResearchPriority (S5) — a **value object** (07 §3.4 D3), NOT an aggregate root.
 *
 * It answers: "in the CURRENT research state, which gap is most worth resolving next?"
 * — NOT "which gap has the highest importance".
 *
 * Auditability (S5 red line 7): every factor keeps its RAW value, its NORMALIZED value,
 * the policy WEIGHT applied, and the resulting CONTRIBUTION — so "why is this gap first?"
 * is always answerable after the fact.
 *
 * S5 boundary (red lines 4/5): acquisitionValue / acquisitionCost are derived ONLY from
 * signals that already exist (Requirement / Gap / Pool / Knowledge / Methodology).
 * They NEVER pretend to model a Target, a Chain position, or a company — those belong to
 * Strategy/Target (Phase B) and are explicitly out of scope here.
 */

export type PriorityFactorKey =
  | "importance"
  | "criticality"
  | "uncertainty"
  | "coverageGap"
  | "acquisitionValue"
  | "acquisitionCost";

export interface PriorityFactor {
  /** The un-normalised input (e.g. requirement importance 1..5, or 0/1 for criticality). */
  raw: number;
  /** 0..1 form used by the formula. */
  normalized: number;
  /** Weight taken from the injected PriorityPolicy. */
  weight: number;
  /** normalized * weight. For `acquisitionCost` this is SUBTRACTED from the score. */
  contribution: number;
}

export interface ResearchPriority {
  gapId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  /** Immutable policy version this priority was computed with (S5 red line 6). */
  policyVersionId: string;
  /** Final 0..100 priority (higher = more worth doing next). */
  score: number;
  factors: Record<PriorityFactorKey, PriorityFactor>;
  /** Human-readable, per-factor explanation. */
  rationale: string;
}

/** Text explaining the acquisition signals, for traceability (red lines 4/5). */
export interface AcquisitionExplanation {
  valueBasis: string;
  costBasis: string;
}
