/**
 * Evaluation / Aggregation Policy (S4).
 *
 * B3: these are the Methodology's **Evaluation Policy** and **Aggregation Policy**
 * responsibilities — kept as an injectable policy object so that no scoring /
 * decision / 12→7 formula is hard-coded inside EvaluationService.
 *
 * v1 defaults live here; a future methodology version can swap the policy without
 * touching the service.
 */

import type {
  Aggregation,
  DimensionEvaluation,
  EvidenceSufficiency,
  ReserveDecision,
} from "./evaluation.js";

// ---- Evaluation Policy -------------------------------------------------------

/** How much evidence makes a dimension "evaluated" (face ①). */
export interface EvidenceSufficiencyRule {
  /** Minimum number of pool items (claims) on the dimension. */
  minItems: number;
  /** Minimum number of independent sources. */
  minIndependentSources: number;
  /** When true, at least one first-hand source is required. */
  requiresFirstHand: boolean;
}

/** Deterministic, evidence-driven score for an `evaluated` dimension (face ②). */
export type ScoringRule = (ctx: {
  dimension: string;
  scoreScale: string;
  sufficiency: EvidenceSufficiency;
}) => number;

export interface DecisionInput {
  dimensionEvaluations: DimensionEvaluation[];
  aggregation: Aggregation;
  /** critical dimension -> was its evidence sufficient? */
  criticalFlags: Record<string, boolean>;
}
export type DecisionRule = (input: DecisionInput) => ReserveDecision;

export interface EvaluationPolicy {
  policyId: string;
  scoreScale: string;
  sufficiency: EvidenceSufficiencyRule;
  /** Optional: when absent, an `evaluated` dimension carries NO score. */
  scoring?: ScoringRule;
  decision: DecisionRule;
}

// ---- Aggregation Policy (12 research → 7 investment) -------------------------

export interface AggregationSource {
  /** Research dimension key (12). */
  dimension: string;
  /** Relative contribution within this 7-dim rule (normalised over present sources). */
  contribution: number;
}

export interface AggregationRule {
  /** Investment dimension key (7). */
  sevenDim: string;
  /** Weight of this investment dimension in the investment view (0..1). */
  weight: number;
  /** Research dimensions that feed it. Empty => this 7-dim cannot be scored yet. */
  sources: AggregationSource[];
}

export interface AggregationPolicy {
  policyId: string;
  rules: AggregationRule[];
}

// ---- v1 defaults -------------------------------------------------------------

export const EVALUATION_POLICY_V1: EvaluationPolicy = {
  policyId: "eval-v1",
  scoreScale: "0-100",
  sufficiency: { minItems: 1, minIndependentSources: 1, requiresFirstHand: false },
  // v1 baseline: a DETERMINISTIC, evidence-driven score. It reflects evidence
  // strength, not a hand-waved investment judgement; real anchor-based scoring is a
  // Methodology Evaluation Policy concern and can replace this rule wholesale.
  scoring: ({ sufficiency }) => {
    const base = 40;
    const perSource = 20;
    const firstHandBonus = sufficiency.firstHand ? 20 : 0;
    const raw = base + sufficiency.independentSources * perSource + firstHandBonus;
    return Math.max(0, Math.min(100, raw));
  },
  decision: ({ dimensionEvaluations, aggregation, criticalFlags }) => {
    const now = new Date().toISOString();

    // ④ Critical dimensions gate the decision BEFORE any averaging.
    const failedCritical = Object.entries(criticalFlags)
      .filter(([, ok]) => !ok)
      .map(([dim]) => dim);
    if (failedCritical.length > 0) {
      return {
        decisionStatus: "pending",
        decisionReason: `关键维度证据不足，暂不判断：${failedCritical.join("、")}`,
        decidedAt: now,
      };
    }

    const total = dimensionEvaluations.length;
    const evaluated = dimensionEvaluations.filter((d) => d.status === "evaluated").length;
    const conflicting = dimensionEvaluations.filter((d) => d.status === "conflicting").length;

    // Too little coverage => cannot decide (NOT "park").
    if (total === 0 || evaluated / total < 0.6) {
      return {
        decisionStatus: "pending",
        decisionReason: `已评估维度不足（${evaluated}/${total}），暂不判断`,
        decidedAt: now,
      };
    }

    const scores = Object.values(aggregation.sevenDimScores).filter((s): s is number => s !== null);
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const status = avg >= 70 ? "reserve" : avg >= 50 ? "watch" : "park";
    return {
      decisionStatus: status,
      decisionReason: `综合分 ${Math.round(avg)}（已评 ${evaluated}/${total}${conflicting ? `，冲突 ${conflicting}` : ""}）`,
      decidedAt: now,
    };
  },
};

/**
 * 12 → 7 mapping (per 07 §3.8a). `exit_env` has NO research-dimension source in v1,
 * so its aggregated score stays `null` (evidence-insufficient) instead of being faked.
 */
export const AGGREGATION_POLICY_V1: AggregationPolicy = {
  policyId: "agg-v1",
  rules: [
    {
      sevenDim: "market_growth",
      weight: 0.2,
      sources: [
        { dimension: "market", contribution: 0.55 },
        { dimension: "market_growth", contribution: 0.45 },
      ],
    },
    { sevenDim: "policy_env", weight: 0.15, sources: [{ dimension: "policy", contribution: 1 }] },
    {
      sevenDim: "competition",
      weight: 0.15,
      sources: [
        { dimension: "competition", contribution: 0.75 },
        { dimension: "technology", contribution: 0.25 },
      ],
    },
    { sevenDim: "tech_maturity", weight: 0.15, sources: [{ dimension: "technology", contribution: 1 }] },
    {
      sevenDim: "commercialization",
      weight: 0.15,
      sources: [
        { dimension: "demand", contribution: 0.3 },
        { dimension: "supply", contribution: 0.15 },
        { dimension: "industry_chain", contribution: 0.2 },
        { dimension: "business_model", contribution: 0.2 },
        { dimension: "profitability", contribution: 0.15 },
      ],
    },
    // No research dimension maps to exit_env in v1.
    { sevenDim: "exit_env", weight: 0.1, sources: [] },
    {
      sevenDim: "risk_level",
      weight: 0.1,
      sources: [
        { dimension: "risk", contribution: 0.8 },
        { dimension: "key_validation", contribution: 0.2 },
      ],
    },
  ],
};
