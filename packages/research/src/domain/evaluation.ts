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
  /**
   * ★ §29.14 (5a): evidence that came from a material which is NOT `completed`. It is NOT counted
   * as confirmed evidence (`evidenceRefs`), but it is not hidden either — optional / additive, so
   * it never breaks an existing consumer.
   */
  unconfirmedEvidenceRefs?: string[];
  sufficiency: EvidenceSufficiency;
  /**
   * ★ H-1（H1-INV-5）：本维度 sufficiency 判定实际采用的 policy provenance。
   *   `sufficiencyPolicyRef`      = requirement 声明的引用（如 `suf-v1`）
   *   `sufficiencyPolicyVersionId` = 经 PolicyRegistry 解析出的版本（如 `suf-v1`）
   * ★ 它【独立于】`InvestmentEvaluation.evaluationPolicyVersionId`（eval-* 评分规则）——
   *   二者属不同 policy domain，不得互相压写。
   * optional / additive（与 `unconfirmedEvidenceRefs` 同模式）：不破坏既有消费者，
   * 且经既有 JSON 列 `dimension_evaluations_json` 往返，无需 schema migration。
   */
  sufficiencyPolicyRef?: string;
  sufficiencyPolicyVersionId?: string;
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
  /**
   * S4.5 provenance: the EXACT policy versions this evaluation was computed with.
   * A historical evaluation must always be answerable: "which rules produced this?"
   */
  evaluationPolicyVersionId: string;
  aggregationPolicyVersionId: string;
  dimensionEvaluations: DimensionEvaluation[];
  aggregation: Aggregation;
  coverage: EvaluationCoverage;
  sufficiencySummary: { minIndependentSources: number; anyFirstHand: boolean };
  /** critical dimension -> whether its evidence was sufficient (false blocks a plain "reserve"). */
  criticalFlags: Record<string, boolean>;
  decision: ReserveDecision;
  createdAt: string;
}
