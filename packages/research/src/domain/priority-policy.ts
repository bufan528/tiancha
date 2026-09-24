/**
 * Priority Policy (S5) — the injectable, VERSIONED rule set behind PriorityService.
 *
 * Same shape as the other policies (evaluation / aggregation / sufficiency): the rules
 * are NOT hard-coded in the service, and a version id is immutable (PolicyRegistry).
 *
 * Deliberately NOT in here (S5 red line 9): any Target / Chain / company logic. The
 * `acquisitionCost` table below is an **information-acquisition DIFFICULTY prior** keyed
 * by the gap's current state — it is NOT a visit cost and must never be read as one.
 */

import { PolicyRegistry } from "./policy-registry.js";
import type { GapType } from "./research-gap.js";
import type { PoolSlotStatus } from "./information-pool.js";
import type { NextActionKind } from "./next-action.js";

export interface PriorityWeights {
  importance: number;
  criticality: number;
  uncertainty: number;
  coverageGap: number;
  /** Expected value of RESOLVING this gap (see PriorityService). */
  acquisitionValue: number;
  /** Information-acquisition difficulty — SUBTRACTED from the score. */
  acquisitionCost: number;
}

export interface PriorityPolicy {
  policyId: string;
  /** Immutable version identity (PolicyRegistry). */
  versionId: string;
  weights: PriorityWeights;
  /** Coverage gap implied by the pool slot's status (0..1). */
  coverageGapByStatus: Record<PoolSlotStatus, number>;
  /**
   * Information-acquisition DIFFICULTY prior by gap type (0..1):
   *   conflict     -> high  (needs extra independent evidence to break the tie)
   *   unknown      -> medium (must obtain from scratch)
   *   insufficient -> medium (some material exists, condition still unmet)
   */
  acquisitionCostByGapType: Record<GapType, number>;
  /** Extra difficulty when the dimension demands first-hand evidence. */
  firstHandCostPenalty: number;
  /** Value multiplier: a critical dimension's gap blocks the decision, so it is worth more. */
  criticalValueBoost: number;
  normalValueBoost: number;
  /** Gap state decides WHAT to do; Priority only decides the ORDER (S5 red line 8). */
  actionKindByGapType: Record<GapType, NextActionKind>;
}

export const PRIORITY_POLICY_V1: PriorityPolicy = {
  policyId: "priority",
  versionId: "prio-v1",
  weights: {
    importance: 0.25,
    criticality: 0.15,
    uncertainty: 0.15,
    coverageGap: 0.15,
    acquisitionValue: 0.2,
    acquisitionCost: 0.1,
  },
  coverageGapByStatus: {
    unknown: 1.0,
    conflicting: 0.7,
    partial: 0.4,
    sufficient: 0.0,
  },
  acquisitionCostByGapType: {
    conflict: 0.9,
    unknown: 0.6,
    insufficient: 0.5,
  },
  firstHandCostPenalty: 0.2,
  criticalValueBoost: 1.0,
  normalValueBoost: 0.7,
  actionKindByGapType: {
    // no information at all -> go get data; partial/conflicting -> a human must step in
    // (supply material / break the tie). No Target-specific kind is used here.
    unknown: "retrieve_data",
    insufficient: "request_manual_input",
    conflict: "request_manual_input",
  },
};

export const priorityPolicies = new PolicyRegistry<PriorityPolicy>("priority");
priorityPolicies.register(PRIORITY_POLICY_V1);
