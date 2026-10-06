/**
 * Sufficiency Policy (S4.5) — the ONE shared judgement of "is the evidence enough?".
 *
 * B3 / bounded-context boundary (locked with the reviewer):
 *   This is a pure value object + pure function, NOT a service. The Information
 *   context (PoolSlot.status) and the Evaluation context (DimensionEvaluation.sufficiency)
 *   both judge with the SAME policy semantics:
 *
 *       Information  -> SufficiencyPolicy
 *       Evaluation   -> SufficiencyPolicy
 *
 *   Neither calls the other's service (the Pool must never call EvaluationService).
 *
 * Why a policy instead of `confirmedCondition`: confirmedCondition is human-readable
 * natural language ("至少 1 条可溯源 TAM + 结构拆分") and cannot be evaluated by code.
 * The machine-executable side of the same requirement lives here, referenced by
 * `InformationRequirement.sufficiencyPolicyRef`.
 */

import { PolicyRegistry } from "./policy-registry.js";
import type { InformationRequirement } from "./information-requirement.js";

export interface SufficiencyPolicy {
  policyId: string;
  /** Immutable version identity (see PolicyRegistry). */
  versionId: string;
  /** Minimum number of pool items (claims) on the dimension. */
  minItems: number;
  /** Minimum number of independent sources. */
  minIndependentSources: number;
  /** When true, at least one first-hand source is required. */
  requiresFirstHand: boolean;
}

/** Observed evidence facts about one slot/dimension. */
export interface SufficiencyFacts {
  itemCount: number;
  independentSources: number;
  firstHand: boolean;
}

/**
 * Derive sufficiency facts from pool items.
 *
 * S4-FOLLOWUP (Evidence layer, Phase C): an item's independent source is its
 * explicit `sourceRef`; an item WITHOUT one falls back to its claim ref. Once
 * `Claim -> Evidence -> Source` exists this must resolve through Evidence —
 * otherwise "one report extracted into 10 claims" is mis-counted as 10 sources.
 */
export function sufficiencyFacts(items: ReadonlyArray<{ claimRef: string; sourceRef?: string }>): SufficiencyFacts {
  const sources = new Set(items.map((i) => i.sourceRef ?? i.claimRef));
  return { itemCount: items.length, independentSources: sources.size, firstHand: false };
}

/** v1 baseline: any single traceable item from one source counts as enough. */
export const SUFFICIENCY_POLICY_V1: SufficiencyPolicy = {
  policyId: "sufficiency",
  versionId: "suf-v1",
  minItems: 1,
  minIndependentSources: 1,
  requiresFirstHand: false,
};

/**
 * Pure, shared judgement. Pool and Evaluation MUST both use this — never a
 * second, drifting copy of the rule.
 */
export function isSufficient(facts: SufficiencyFacts, policy: SufficiencyPolicy): boolean {
  if (facts.itemCount < policy.minItems) return false;
  if (facts.independentSources < policy.minIndependentSources) return false;
  if (policy.requiresFirstHand && !facts.firstHand) return false;
  return true;
}

export const sufficiencyPolicies = new PolicyRegistry<SufficiencyPolicy>("sufficiency");
sufficiencyPolicies.register(SUFFICIENCY_POLICY_V1);

/**
 * ★ H-1（docs/phaseC/h1-sufficiency-remediation-contract.md · H1-INV-2 / H1-7-10）：
 * 从 Requirement 的 `sufficiencyPolicyRef` 解析本次判定必须使用的 SufficiencyPolicy。
 *
 * 这是【共享的唯一】resolver：Pool（KnowledgeProjectionService）与 Evaluation（EvaluationService）
 * 都必须经它解析。NEVER a hard-coded version：
 *   - 无 requirement      → undefined（没有任何可判据；对应 slot 只能 `partial`，永不 `sufficient`）
 *   - ref 缺失 / 未知     → **THROW**（静默 fallback 到默认版本会让记录的 provenance 变成谎言）
 *
 * 纯函数：不访问 DB、不依赖任何 Service、无副作用、不改 PolicyRegistry / 版本语义。
 * 该函数由 `application/knowledge-projection-service.ts` 中原有的同名局部函数【迁移】而来，
 * 语义逐字保持不变（H1-7-10：允许纯 resolver 下沉到既有 domain 语义位置）。
 */
export function resolveSufficiencyPolicy(req?: InformationRequirement): SufficiencyPolicy | undefined {
  if (!req) return undefined;
  const ref = req.sufficiencyPolicyRef;
  if (!ref) {
    throw new Error(`requirement ${req.requirementId} has no sufficiencyPolicyRef (S4.5-R1)`);
  }
  const policy = sufficiencyPolicies.get(ref);
  if (!policy) {
    throw new Error(
      `unknown sufficiency policy version '${ref}' referenced by requirement ${req.requirementId}`,
    );
  }
  return policy;
}
