/**
 * Evaluation / Aggregation Policy (S4 / S4.5).
 *
 * B3: these are the Methodology's **Evaluation Policy** and **Aggregation Policy**
 * responsibilities — kept as injectable, VERSIONED policy objects so that no
 * scoring / decision / 12→7 formula is hard-coded inside EvaluationService.
 *
 * S4.5 provenance rule (locked with the reviewer):
 *   - Every policy carries a `versionId` that is IMMUTABLE (see PolicyRegistry).
 *   - An InvestmentEvaluation records the exact versions it was computed with:
 *     methodologyVersionId + evaluationPolicyVersionId + aggregationPolicyVersionId.
 *   - Changing any rule means publishing a NEW versionId (v1 -> v2); the old one
 *     stays resolvable, so a historical evaluation never silently changes meaning.
 *
 * Policies are NOT embedded into `MethodologyVersion` (that would blur B3); the
 * Evaluation aggregate simply references the three version ids.
 */

import { PolicyRegistry } from "./policy-registry.js";
import { SUFFICIENCY_POLICY_V1, type SufficiencyPolicy } from "./sufficiency.js";
import type {
  Aggregation,
  DimensionEvaluation,
  EvidenceSufficiency,
  ReserveDecision,
} from "./evaluation.js";

// ---- Evaluation Policy -------------------------------------------------------

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
  /**
   * Investment-dimension weights from the Aggregation Policy (S4.5). The v1
   * decision uses these so `AggregationRule.weight` is REAL, not decorative.
   */
  sevenDimWeights: Record<string, number>;
}
export type DecisionRule = (input: DecisionInput) => ReserveDecision;

export interface EvaluationPolicy {
  policyId: string;
  /** Immutable version identity (see PolicyRegistry). */
  versionId: string;
  scoreScale: string;
  /**
   * S4.5: the SAME sufficiency policy object the Pool judges with — one rule,
   * no drifting second copy (see domain/sufficiency.ts).
   */
  sufficiency: SufficiencyPolicy;
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
  /** Immutable version identity (see PolicyRegistry). */
  versionId: string;
  rules: AggregationRule[];
}

// ---- v1 defaults -------------------------------------------------------------

export const EVALUATION_POLICY_V1: EvaluationPolicy = {
  policyId: "evaluation",
  versionId: "eval-v1",
  scoreScale: "0-100",
  // Shared with the Pool — the single "is the evidence enough?" rule (S4.5).
  sufficiency: SUFFICIENCY_POLICY_V1,
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
  decision: ({ dimensionEvaluations, aggregation, criticalFlags, sevenDimWeights }) => {
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

    // S4.5: WEIGHTED total, using the Aggregation Policy's investment-dimension
    // weights. Only dimensions that actually got a score contribute; dims with a
    // `null` score (evidence-insufficient, e.g. exit_env in v1) are NOT averaged in.
    let weightedSum = 0;
    let weightTotal = 0;
    for (const [dim, score] of Object.entries(aggregation.sevenDimScores)) {
      if (score === null) continue;
      const w = sevenDimWeights[dim] ?? 0;
      weightedSum += score * w;
      weightTotal += w;
    }
    const avg = weightTotal > 0 ? weightedSum / weightTotal : 0;
    const status = avg >= 70 ? "reserve" : avg >= 50 ? "watch" : "park";
    return {
      decisionStatus: status,
      decisionReason: `加权综合分 ${Math.round(avg)}（已评 ${evaluated}/${total}${conflicting ? `，冲突 ${conflicting}` : ""}）`,
      decidedAt: now,
    };
  },
};

/**
 * 12 → 7 mapping (per 07 §3.8a). This is the versioned "methodology configuration"
 * the aggregation code only does MATH over — changing the matrix means a new
 * aggregation policy version, never a code edit that keeps the same versionId.
 *
 * `exit_env` has NO research-dimension source in v1, so its aggregated score stays
 * `null` (evidence-insufficient) instead of being faked.
 */
export const AGGREGATION_POLICY_V1: AggregationPolicy = {
  policyId: "aggregation",
  versionId: "agg-v1",
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

// ---- Registries (immutable version identity) ---------------------------------

export const evaluationPolicies = new PolicyRegistry<EvaluationPolicy>("evaluation");
evaluationPolicies.register(EVALUATION_POLICY_V1);

export const aggregationPolicies = new PolicyRegistry<AggregationPolicy>("aggregation");
aggregationPolicies.register(AGGREGATION_POLICY_V1);
