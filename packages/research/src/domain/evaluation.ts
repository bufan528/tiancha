/**
 * Investment Evaluation (S4) — the FOUR-FACE model, kept explicitly separated:
 *
 *   ① Evidence Assessment  : is the evidence ENOUGH?      (pure judgement, no score)
 *   ② Dimension Evaluation : if enough, how much?         (score, rationale, evidence)
 *   ③ Investment Aggregation: 12 research → 7 investment   (Aggregation Policy)
 *   ④ Decision             : reserve / watch / park / pending
 *
 * HARD RULES (locked with the reviewer):
 *  - `insufficient_evidence` is an EVALUATION status, NOT a decision. When evidence
 *    is insufficient the DECISION is `pending` — never "insufficient_evidence".
 *  - A dimension may only carry a `score` when its status is `evaluated`.
 *    `conflicting` / `insufficient_evidence` MUST NOT get a score (no silent averaging).
 *  - Scoring / aggregation / decision rules live in the injected Policy
 *    (Methodology's Evaluation Policy + Aggregation Policy), never hard-coded here.
 */

export type DimensionEvalStatus = "evaluated" | "insufficient_evidence" | "conflicting" | "not_applicable";

/** Evidence sufficiency of a single dimension (face ①). */
export interface EvidenceSufficiency {
  itemCount: number;
  independentSources: number;
  firstHand: boolean;
}

/** A single research dimension's evaluation (face ②). */
export interface DimensionEvaluation {
  dimension: string;
  status: DimensionEvalStatus;
  /** Present ONLY when status === "evaluated". */
  score?: number;
  scoreScale?: string;
  rationale: string;
  evidenceRefs: string[];
  sufficiency: EvidenceSufficiency;
  /** Present only for `conflicting`. */
  conflictingClaimRefs?: string[];
}

/** How many dimensions ended up in each state. */
export interface EvaluationCoverage {
  evaluated: number;
  insufficient: number;
  conflicting: number;
  notApplicable: number;
  total: number;
}

/** 12 → 7 aggregation result (face ③). `null` = that investment dimension is evidence-insufficient. */
export interface Aggregation {
  sevenDimScores: Record<string, number | null>;
}

/** The DECISION status is its own enum; `insufficient_evidence` is deliberately NOT a member. */
export type ReservationStatus = "reserve" | "watch" | "park" | "pending";

export interface ReserveDecision {
  decisionStatus: ReservationStatus;
  decisionReason: string;
  decidedAt: string;
}

export interface InvestmentEvaluation {
  evaluationId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  /** The evaluation is bound to the methodology version it was computed against. */
  methodologyVersionId: string;
  dimensionEvaluations: DimensionEvaluation[];
  aggregation: Aggregation;
  coverage: EvaluationCoverage;
  sufficiencySummary: { minIndependentSources: number; anyFirstHand: boolean };
  /** critical dimension -> whether its evidence was sufficient (false blocks a plain "reserve"). */
  criticalFlags: Record<string, boolean>;
  decision: ReserveDecision;
  createdAt: string;
}
