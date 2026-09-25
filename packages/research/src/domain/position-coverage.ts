/**
 * ★ C2 Phase 2 · Step 2-A — read-only Position coverage.
 *
 * The contract (§4.1 / §1.3 / I-C2-16) keeps the Position BODY stable and derives coverage:
 *
 *     allRequirementRefs    ≡ position.satisfiesRequirementRefs    (capability — existing)
 *     activeRequirementRefs ≡ all ∩ active requirement refs         (current research state)
 *
 * Coverage exists ONLY in this view. Nothing here is written back to `research_position` —
 * a position never "converges", and `positionRef` never changes with the Gap lifecycle.
 *
 * `positionCoverages()` is the ONE assembly used by both the CLI (`research chain`) and the
 * Agent (`research_chain_show`), so the two surfaces can never disagree: the Agent deliberately
 * has no ChainProjectionService injected (B5 governance), yet it shares this derivation.
 */

import { activeRequirementRefs as resolveActiveRequirementRefs } from "./active-requirement.js";
import type { InformationRequirement } from "./information-requirement.js";
import type { ResearchGap } from "./research-gap.js";
import type { ResearchPosition } from "./research-position.js";

export interface PositionCoverage {
  positionRef: string;
  /** ≡ the position's `satisfiesRequirementRefs` (alias, §1.3) — never a new column. */
  allRequirementRefs: string[];
  /** `all ∩ active` — today's research state, derived through the shared resolver. */
  activeRequirementRefs: string[];
}

/**
 * Coverage of ONE position, given the industry's current active requirement refs.
 * Order is inherited from `satisfiesRequirementRefs` (§4.3.2: existing stable order first).
 */
export function positionCoverage(
  position: ResearchPosition,
  activeRefs: ReadonlySet<string>,
): PositionCoverage {
  const all = position.satisfiesRequirementRefs;
  return {
    positionRef: position.positionRef,
    allRequirementRefs: all,
    activeRequirementRefs: all.filter((ref) => activeRefs.has(ref)),
  };
}

/**
 * Coverage for every position of an industry — the shared, read-only derivation.
 * Reads only; it never projects a chain and never writes.
 */
export function positionCoverages(
  positions: readonly ResearchPosition[],
  gaps: readonly ResearchGap[],
  requirements: readonly InformationRequirement[],
): PositionCoverage[] {
  const active = new Set(resolveActiveRequirementRefs(gaps, requirements));
  return positions.map((position) => positionCoverage(position, active));
}
