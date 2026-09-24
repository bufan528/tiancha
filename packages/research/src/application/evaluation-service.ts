/**
 * EvaluationService (S4) — the FOUR-FACE model, each face its own method.
 *
 *   evaluate()          orchestration only (no business rules inline)
 *   ├─ evaluateDimension()  ② (+ ① via assessEvidence)
 *   ├─ aggregate()          ③ 12 → 7, driven entirely by AggregationPolicy
 *   └─ decide()             ④ driven entirely by EvaluationPolicy.decision
 *
 * LOCKED INVARIANTS:
 *  - A dimension carries a `score` ONLY when status === "evaluated".
 *    `insufficient_evidence` / `conflicting` => NO score (never a silent 0/low).
 *  - `insufficient_evidence` is an EVALUATION status; the DECISION for it is `pending`.
 *  - Critical dimensions are checked BEFORE any averaging (they cannot be averaged away).
 *  - Scoring / aggregation / decision rules come from the injected policy — nothing here
 *    hard-codes a formula.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { MethodologyService } from "./methodology-service.js";
import { poolSlotKey } from "../domain/identity.js";
import {
  AGGREGATION_POLICY_V1,
  EVALUATION_POLICY_V1,
  type AggregationPolicy,
  type DecisionInput,
  type EvaluationPolicy,
  type EvidenceSufficiencyRule,
} from "../domain/evaluation-policy.js";
import type {
  Aggregation,
  DimensionEvalStatus,
  DimensionEvaluation,
  EvaluationCoverage,
  EvidenceSufficiency,
  InformationPoolItem,
  InvestmentEvaluation,
  MethodologyDimension,
  ReserveDecision,
} from "../domain/index.js";

export class EvaluationService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly policy: EvaluationPolicy = EVALUATION_POLICY_V1,
    private readonly aggregationPolicy: AggregationPolicy = AGGREGATION_POLICY_V1,
  ) {}

  // ---- Orchestration ---------------------------------------------------------

  evaluate(subjectKind: "industry" | "company" | "general", subjectId: string): InvestmentEvaluation {
    const repo = new ResearchRepository(this.db);
    const methodology = new MethodologyService(repo).getActive();

    // ① + ②
    const dimensionEvaluations = methodology.dimensions.map((dim) => this.evaluateDimension(subjectId, dim));
    // ③
    const aggregation = this.aggregate(dimensionEvaluations);

    const coverage: EvaluationCoverage = {
      evaluated: dimensionEvaluations.filter((d) => d.status === "evaluated").length,
      insufficient: dimensionEvaluations.filter((d) => d.status === "insufficient_evidence").length,
      conflicting: dimensionEvaluations.filter((d) => d.status === "conflicting").length,
      notApplicable: dimensionEvaluations.filter((d) => d.status === "not_applicable").length,
      total: dimensionEvaluations.length,
    };

    const sufficiencySummary = {
      minIndependentSources: dimensionEvaluations.length
        ? Math.min(...dimensionEvaluations.map((d) => d.sufficiency.independentSources))
        : 0,
      anyFirstHand: dimensionEvaluations.some((d) => d.sufficiency.firstHand),
    };

    // ④ Critical dimensions must be able to block a plain "reserve".
    const criticalFlags: Record<string, boolean> = {};
    for (const dim of methodology.dimensions) {
      if (dim.criticality === "critical") {
        const ev = dimensionEvaluations.find((d) => d.dimension === dim.key);
        criticalFlags[dim.key] = ev?.status === "evaluated";
      }
    }

    const decision = this.decide({ dimensionEvaluations, aggregation, criticalFlags });

    const evaluation: InvestmentEvaluation = {
      evaluationId: `eval-${randomUUID()}`,
      subjectKind,
      subjectId,
      methodologyVersionId: methodology.versionId,
      dimensionEvaluations,
      aggregation,
      coverage,
      sufficiencySummary,
      criticalFlags,
      decision,
      createdAt: new Date().toISOString(),
    };
    repo.upsertEvaluation(evaluation);
    return evaluation;
  }

  // ---- ① Evidence Assessment + ② Dimension Evaluation ------------------------

  /** Face ①+②: judge sufficiency, and score ONLY when sufficient. */
  evaluateDimension(subjectId: string, dim: MethodologyDimension): DimensionEvaluation {
    const repo = new ResearchRepository(this.db);
    const slotId = poolSlotKey(subjectId, dim.key);
    const slot = repo.getPoolSlot(slotId);
    const items = slot ? repo.listPoolItems(slotId) : [];

    const sufficiency = sufficiencyOf(items);
    const evidenceRefs = items.map((i) => i.claimRef);

    // ① Evidence Assessment (pure judgement, no score)
    let status: DimensionEvalStatus;
    let conflictingClaimRefs: string[] | undefined;
    if (!slot || slot.status === "unknown" || items.length === 0) {
      status = "insufficient_evidence";
    } else if (slot.status === "conflicting") {
      status = "conflicting";
      conflictingClaimRefs = items.filter((i) => i.relation === "contradicts").map((i) => i.claimRef);
    } else if (isSufficient(sufficiency, this.policy.sufficiency)) {
      status = "evaluated";
    } else {
      status = "insufficient_evidence";
    }

    const evaluation: DimensionEvaluation = {
      dimension: dim.key,
      status,
      rationale: rationaleFor(status, dim, sufficiency),
      evidenceRefs,
      sufficiency,
    };
    if (conflictingClaimRefs && conflictingClaimRefs.length > 0) {
      evaluation.conflictingClaimRefs = conflictingClaimRefs;
    }

    // ② score is attached ONLY for `evaluated` (and only if a scoring rule exists)
    if (status === "evaluated" && this.policy.scoring) {
      evaluation.score = this.policy.scoring({
        dimension: dim.key,
        scoreScale: this.policy.scoreScale,
        sufficiency,
      });
      evaluation.scoreScale = this.policy.scoreScale;
    }
    return evaluation;
  }

  // ---- ③ Investment Aggregation (12 → 7) ------------------------------------

  /** Face ③: 12 research dimensions → 7 investment dimensions, via AggregationPolicy. */
  aggregate(dimensionEvaluations: DimensionEvaluation[]): Aggregation {
    const byDim = new Map(dimensionEvaluations.map((d) => [d.dimension, d]));
    const sevenDimScores: Record<string, number | null> = {};

    for (const rule of this.aggregationPolicy.rules) {
      if (rule.sources.length === 0) {
        // no research dimension feeds it (v1: exit_env) -> evidence insufficient, not faked
        sevenDimScores[rule.sevenDim] = null;
        continue;
      }
      let weighted = 0;
      let totalContribution = 0;
      let allEvaluated = true;
      for (const src of rule.sources) {
        const ev = byDim.get(src.dimension);
        if (!ev || ev.status !== "evaluated" || ev.score === undefined) {
          allEvaluated = false;
          break;
        }
        weighted += ev.score * src.contribution;
        totalContribution += src.contribution;
      }
      sevenDimScores[rule.sevenDim] = allEvaluated && totalContribution > 0 ? weighted / totalContribution : null;
    }
    return { sevenDimScores };
  }

  // ---- ④ Decision ------------------------------------------------------------

  /** Face ④: the decision comes from the policy (critical-first, coverage-aware). */
  decide(input: DecisionInput): ReserveDecision {
    return this.policy.decision(input);
  }
}

// ---- helpers -----------------------------------------------------------------

function sufficiencyOf(items: InformationPoolItem[]): EvidenceSufficiency {
  // An item's source is its sourceRef, else its claimRef (each claim is its own source).
  const sources = new Set(items.map((i) => i.sourceRef ?? i.claimRef));
  return { itemCount: items.length, independentSources: sources.size, firstHand: false };
}

function isSufficient(s: EvidenceSufficiency, rule: EvidenceSufficiencyRule): boolean {
  if (s.itemCount < rule.minItems) return false;
  if (s.independentSources < rule.minIndependentSources) return false;
  if (rule.requiresFirstHand && !s.firstHand) return false;
  return true;
}

function rationaleFor(status: DimensionEvalStatus, dim: MethodologyDimension, s: EvidenceSufficiency): string {
  switch (status) {
    case "evaluated":
      return `${dim.name}：证据充分（${s.itemCount} 条，${s.independentSources} 个独立来源）`;
    case "conflicting":
      return `${dim.name}：存在未解冲突，暂不评分`;
    case "not_applicable":
      return `${dim.name}：不适用`;
    default:
      return `${dim.name}：证据不足，暂不评分`;
  }
}
