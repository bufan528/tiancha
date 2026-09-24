/**
 * PriorityService (S5) — turns the CURRENT research state into ranked ResearchPriority
 * value objects, and (through the projection) drives NextAction.
 *
 * It does NOT sort by importance. "Which gap is most worth resolving NEXT?" is a
 * weighted question over six real signals, with the rules living in the injected
 * PriorityPolicy (versioned; see domain/priority-policy.ts).
 *
 * S5 red lines enforced here:
 *  2/3  importance, criticality, uncertainty, coverageGap, acquisitionValue and
 *       acquisitionCost ALL feed the score (acquisitionCost is subtracted).
 *  4/5  acquisitionValue/Cost come only from existing Requirement/Gap/Pool/Methodology
 *       signals — no Target, no Chain, no invented company data.
 *  7    every factor is recorded with raw / normalized / weight / contribution, plus the
 *       policy version, so the ranking is auditable.
 *  10   deterministic: inputs come from persisted state only; sorting has a stable
 *       tie-break on gapId; nothing depends on timestamps, UUIDs or insertion order.
 */

import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { MethodologyService } from "./methodology-service.js";
import { PRIORITY_POLICY_V1, type PriorityPolicy } from "../domain/priority-policy.js";
import { sufficiencyPolicies } from "../domain/sufficiency.js";
import type {
  InformationRequirement,
  MethodologyDimension,
  NextActionKind,
  PoolSlotStatus,
  PriorityFactor,
  ResearchGap,
  ResearchPriority,
} from "../domain/index.js";

/** Everything one priority computation needs — all of it already persisted. */
export interface PriorityInput {
  gap: ResearchGap;
  requirement?: InformationRequirement;
  dimension?: MethodologyDimension;
  slotStatus: PoolSlotStatus;
}

export class PriorityService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly policy: PriorityPolicy = PRIORITY_POLICY_V1,
  ) {}

  /** Rank every ACTIVE gap of a subject; highest score first, stable on ties. */
  rank(subjectId: string, subjectKind: ResearchPriority["subjectKind"] = "industry"): ResearchPriority[] {
    const repo = new ResearchRepository(this.db);
    const methodology = new MethodologyService(repo).getActive();
    const dimensionByKey = new Map(methodology.dimensions.map((d) => [d.key, d]));
    const requirementById = new Map(repo.listRequirements(subjectId).map((r) => [r.requirementId, r]));
    const slotByDimension = new Map(repo.listPoolSlots(subjectId).map((s) => [s.dimension, s]));

    const gaps = repo.listGaps(subjectId).filter((g) => g.status === "open" || g.status === "mitigating");

    const ranked = gaps.map((gap) => {
      const requirement = requirementById.get(gap.relatedRequirementIds[0] ?? "");
      const dimension = requirement ? dimensionByKey.get(requirement.dimension) : undefined;
      const slot = requirement ? slotByDimension.get(requirement.dimension) : undefined;
      return this.computeFor({
        gap,
        requirement,
        dimension,
        slotStatus: slot?.status ?? "unknown",
      });
    });

    // Deterministic total order: score desc, then gapId asc (never insertion order).
    ranked.sort((a, b) => b.score - a.score || (a.gapId < b.gapId ? -1 : a.gapId > b.gapId ? 1 : 0));
    void subjectKind;
    return ranked;
  }

  /** Compute one ResearchPriority (pure over its input + the injected policy). */
  computeFor(input: PriorityInput): ResearchPriority {
    const { gap, requirement, dimension, slotStatus } = input;
    const w = this.policy.weights;

    // --- factor inputs (raw) ---------------------------------------------------
    const importanceRaw = requirement?.importance ?? 0;
    const criticalityRaw = dimension?.criticality === "critical" ? 1 : 0;
    const uncertaintyRaw = gap.uncertainty;
    const coverageGapRaw = this.policy.coverageGapByStatus[slotStatus] ?? 1;

    // acquisitionValue = expected value of RESOLVING this gap, derived from state we
    // already have: how much uncertainty it removes × how much it blocks a decision.
    const isCritical = dimension?.criticality === "critical";
    const valueBoost = isCritical ? this.policy.criticalValueBoost : this.policy.normalValueBoost;
    const acquisitionValueRaw = valueBoost * (0.6 * clamp01(uncertaintyRaw) + 0.4 * coverageGapRaw);

    // acquisitionCost = information-acquisition DIFFICULTY prior (NOT a Target visit
    // cost): gap-type baseline + a penalty when the dimension demands first-hand data.
    const needsFirstHand = this.needsFirstHand(requirement);
    const acquisitionCostRaw =
      (this.policy.acquisitionCostByGapType[gap.gapType] ?? 0.6) +
      (needsFirstHand ? this.policy.firstHandCostPenalty : 0);

    // --- normalized + weighted contributions ----------------------------------
    const factors: Record<string, PriorityFactor> = {
      importance: this.factor(importanceRaw, clamp01((importanceRaw - 1) / 4), w.importance),
      criticality: this.factor(criticalityRaw, criticalityRaw, w.criticality),
      uncertainty: this.factor(uncertaintyRaw, clamp01(uncertaintyRaw), w.uncertainty),
      coverageGap: this.factor(coverageGapRaw, coverageGapRaw, w.coverageGap),
      acquisitionValue: this.factor(acquisitionValueRaw, clamp01(acquisitionValueRaw), w.acquisitionValue),
      acquisitionCost: this.factor(acquisitionCostRaw, clamp01(acquisitionCostRaw), w.acquisitionCost, true),
    };

    const weighted = Object.values(factors).reduce((sum, f) => sum + f.contribution, 0);
    const score = Math.round(clamp01(weighted) * 100);

    return {
      gapId: gap.gapId,
      subjectKind: gap.subjectKind,
      subjectId: gap.subjectId,
      policyVersionId: this.policy.versionId,
      score,
      factors: factors as ResearchPriority["factors"],
      rationale: this.rationale(gap, dimension, factors, needsFirstHand, score),
    };
  }

  /** The action kind is decided by the GAP state, not by the priority (red line 8). */
  actionKindFor(gapType: ResearchGap["gapType"]): NextActionKind {
    return this.policy.actionKindByGapType[gapType];
  }

  // ---- helpers ---------------------------------------------------------------

  private factor(raw: number, normalized: number, weight: number, subtract = false): PriorityFactor {
    const contribution = normalized * weight * (subtract ? -1 : 1);
    return { raw, normalized, weight, contribution };
  }

  /**
   * Does this requirement's dimension demand first-hand evidence? Used ONLY as a cost
   * hint. An unknown/missing ref is treated as "no extra penalty" rather than throwing —
   * unlike the Pool's sufficiency judgement, this does not assert a contract.
   */
  private needsFirstHand(req?: InformationRequirement): boolean {
    const ref = req?.sufficiencyPolicyRef;
    if (!ref) return false;
    return sufficiencyPolicies.get(ref)?.requiresFirstHand ?? false;
  }

  private rationale(
    gap: ResearchGap,
    dimension: MethodologyDimension | undefined,
    factors: Record<string, PriorityFactor>,
    needsFirstHand: boolean,
    score: number,
  ): string {
    const name = dimension ? `${dimension.name}（${dimension.key}）` : gap.relatedRequirementIds[0] ?? "未知维度";
    const crit = dimension?.criticality === "critical" ? "关键维度；" : "";
    return (
      `${name} 缺口类型 ${gap.gapType}：${crit}` +
      `不确定度 ${factors.uncertainty.normalized.toFixed(2)}、覆盖缺口 ${factors.coverageGap.normalized.toFixed(2)}；` +
      `解决价值 ${factors.acquisitionValue.normalized.toFixed(2)}、获取难度 ${factors.acquisitionCost.normalized.toFixed(2)}` +
      `${needsFirstHand ? "（需一手证据）" : ""} → 优先级 ${score}/100`
    );
  }
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
