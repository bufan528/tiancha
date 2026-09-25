/**
 * ★ C2 Phase 2 · Step 2-A — **ActiveRequirementResolver**.
 *
 * THE single source of the "which requirements still need research?" predicate
 * (contract §4.1 / I-C2-13 / Step 2-A). It answers exactly one question:
 *
 *     Gap[] + Requirement[]  →  active requirement refs
 *
 * Deliberately OUT of scope: priority, position, target, fit, preparation, research plan.
 * This module holds no state, takes no repository and never writes anything — it must never
 * grow into a catch-all orchestrator (that is what I-C2-13 forbids).
 *
 * The active Gap lifecycle is the EXISTING one — C2 only CONSUMES it (I-C2-2 / I-C2-20):
 *
 *     active ≡ gap.status ∈ { open, mitigating }
 *
 * `reopened` is a lifecycle EVENT (a previously resolved gap going back to `open`), never a
 * status value: `GapStatus` remains `open | mitigating | resolved | accepted`.
 *
 * Every consumer — `ResearchNeedService`, `QuestionTargetFitService`, position coverage and
 * (later, Step 2-C) the research plan — must call this module instead of re-writing the
 * predicate. There is exactly ONE place in the codebase that may compare gap statuses.
 */

import type { InformationRequirement } from "./information-requirement.js";
import type { GapStatus, ResearchGap } from "./research-gap.js";

/**
 * The ONLY active-status predicate in the codebase.
 *
 * If the existing Gap semantics ever change, they change HERE and every consumer follows —
 * that is the whole point of Step 2-A.
 */
export function isActiveGapStatus(status: GapStatus): boolean {
  return status === "open" || status === "mitigating";
}

/** Gaps that are still open to research — filtered by the single predicate above. */
export function activeGaps(gaps: readonly ResearchGap[]): ResearchGap[] {
  return gaps.filter((gap) => isActiveGapStatus(gap.status));
}

/**
 * The requirement refs that at least one active gap still asks for.
 * Order follows the `requirements` input (deterministic; §4.3.2 keeps existing stable order
 * and never re-sorts by ref).
 */
export function activeRequirementRefs(
  gaps: readonly ResearchGap[],
  requirements: readonly InformationRequirement[],
): string[] {
  const needed = new Set(activeGaps(gaps).flatMap((gap) => gap.relatedRequirementIds));
  return requirements.filter((r) => needed.has(r.requirementId)).map((r) => r.requirementId);
}

/** Same single predicate, returning the requirement objects (input order kept). */
export function activeRequirements(
  gaps: readonly ResearchGap[],
  requirements: readonly InformationRequirement[],
): InformationRequirement[] {
  const needed = new Set(activeGaps(gaps).flatMap((gap) => gap.relatedRequirementIds));
  return requirements.filter((r) => needed.has(r.requirementId));
}

/**
 * ★ The Step 2-A consumption interface, exposed under the contract's name so consumers (and the
 * Step 2-C static audit) can point at ONE implementation source.
 *
 * It is intentionally a thin namespace, not a service: no state, no repository, no side effects.
 */
export const ActiveRequirementResolver = {
  isActiveGapStatus,
  activeGaps,
  activeRequirementRefs,
  activeRequirements,
} as const;
