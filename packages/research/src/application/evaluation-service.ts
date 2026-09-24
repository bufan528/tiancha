/**
 * EvaluationService (S4 / S4.5) — the FOUR-FACE model, each face its own method.
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
 *
 * S4.5:
 *  - Face ① judges with the SHARED SufficiencyPolicy (domain/sufficiency.ts) — the
 *    same rule the Pool uses, so the two never drift apart.
 *  - The produced InvestmentEvaluation records the exact `evaluationPolicyVersionId`
 *    and `aggregationPolicyVersionId` used (immutable provenance).
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
} from "../domain/evaluation-policy.js";
import { isSufficient, sufficiencyFacts } from "../domain/sufficiency.js";
import type {
  Aggregation,
  DimensionEvalStatus,
  DimensionEvaluation,
  EvaluationCoverage,
  EvidenceSufficiency,
  InvestmentEvaluation,
  MethodologyDimension,
  ReserveDecision,
} from "../domain/index.js";

export interface EvidenceAssessment {
  status: DimensionEvalStatus;
  sufficiency: EvidenceSufficiency;
  evidenceRefs: string[];
  conflictingClaimRefs?: string[];
}

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

    // S4.5: investment-dimension weights come from the Aggregation Policy, so
    // `AggregationRule.weight` actually participates in the decision (was unused).
    const sevenDimWeights: Record<string, number> = {};
    for (const rule of this.aggregationPolicy.rules) sevenDimWeights[rule.sevenDim] = rule.weight;

    const decision = this.decide({ dimensionEvaluations, aggregation, criticalFlags, sevenDimWeights });

    const evaluation: InvestmentEvaluation = {
      evaluationId: `eval-${randomUUID()}`,
      subjectKind,
      subjectId,
      methodologyVersionId: methodology.versionId,
      // S4.5 provenance: record the EXACT rules this evaluation was computed with.
      evaluationPolicyVersionId: this.policy.versionId,
      aggregationPolicyVersionId: this.aggregationPolicy.versionId,
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

  // ---- ① Evidence Assessment -------------------------------------------------

  /**
   * Face ①: is the evidence ENOUGH? Pure judgement — **never** produces a score.
   * Uses the SHARED sufficiency policy (same rule the Pool judges with).
   */
  assessEvidence(subjectId: string, dim: MethodologyDimension): EvidenceAssessment {
    const repo = new ResearchRepository(this.db);
    const slotId = poolSlotKey(subjectId, dim.key);
    const slot = repo.getPoolSlot(slotId);
    const items = slot ? repo.listPoolItems(slotId) : [];

    const sufficiency = sufficiencyFacts(items);
    const evidenceRefs = items.map((i) => i.claimRef);

    if (!slot || slot.status === "unknown" || items.length === 0) {
      return { status: "insufficient_evidence", sufficiency, evidenceRefs };
    }
    if (slot.status === "conflicting") {
      return {
        status: "conflicting",
        sufficiency,
        evidenceRefs,
        conflictingClaimRefs: items.filter((i) => i.relation === "contradicts").map((i) => i.claimRef),
      };
    }
    if (isSufficient(sufficiency, this.policy.sufficiency)) {
      return { status: "evaluated", sufficiency, evidenceRefs };
    }
    return { status: "insufficient_evidence", sufficiency, evidenceRefs };
  }

  // ---- ② Dimension Evaluation ------------------------------------------------

  /** Face ②: score ONLY when face ① says the evidence is sufficient. */
  evaluateDimension(subjectId: string, dim: MethodologyDimension): DimensionEvaluation {
    const assessment = this.assessEvidence(subjectId, dim);

    const evaluation: DimensionEvaluation = {
      dimension: dim.key,
      status: assessment.status,
      rationale: rationaleFor(assessment.status, dim, assessment.sufficiency),
      evidenceRefs: assessment.evidenceRefs,
      sufficiency: assessment.sufficiency,
    };
    if (assessment.conflictingClaimRefs && assessment.conflictingClaimRefs.length > 0) {
      evaluation.conflictingClaimRefs = assessment.conflictingClaimRefs;
    }

    // score is attached ONLY for `evaluated` (and only if a scoring rule exists)
    if (assessment.status === "evaluated" && this.policy.scoring) {
      evaluation.score = this.policy.scoring({
        dimension: dim.key,
        scoreScale: this.policy.scoreScale,
        sufficiency: assessment.sufficiency,
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
