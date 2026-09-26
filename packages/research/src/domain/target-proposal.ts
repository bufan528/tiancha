/**
 * TargetProposal (C5-A) — a **system PROPOSAL** to study a company.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §4.4 (R1/R3/R5), §7, §8, §15.
 *
 * ★ C5-R1 — a proposal is NOT a fact:
 *   `TargetProposal ≠ ResearchTarget ≠ DiligencePreparation ≠ KnowledgeBelief ≠ research fact`.
 *   Until a human confirms it (C5-B), it means only: "a system, based on the currently
 *   persisted research state, suggests a human look at this subject."
 *
 * ★ The identity model is two-layered (§7.1–§7.3):
 *     ProposalKey            = (industryRef, gapRef, positionRef, companyRef)
 *     recommendationRevision = stableHash(canonicalJson(revisionInput))   — a state fingerprint
 *     proposalRef            = hash(ProposalKey, recommendationRevision)
 *   so the same input state always yields the same id (exact no-op on re-generate, P11),
 *   while a material change in the research state yields a NEW id (R4).
 *
 * ★ CLOSURE RULE (§7.5): every persisted field below is a deterministic function of
 *   `revisionInput`; `status` / `createdAt` are lifecycle fields and are the only exemptions.
 *
 * NOTE (C5-A scope): this module deliberately has **no** transition / decision / target
 * materialisation concept — those belong to C5-B and are physically absent here.
 */

/** The proposal's own state machine — deliberately NOT `TargetStatus` (§4.4 red line 4). */
export type TargetProposalStatus = "proposed" | "confirmed" | "rejected";

/** The lifecycle states a proposal may be CREATED in (C5-A can only produce `proposed`). */
export const INITIAL_PROPOSAL_STATUS: TargetProposalStatus = "proposed";

/**
 * The combination of facts "for THIS gap, THIS position suggests THIS company" (§7.1).
 * `proposalRef` is derived from it — plus the recommendation revision — never supplied by a caller.
 */
export interface TargetProposalKey {
  industryRef: string;
  gapRef: string;
  positionRef: string;
  companyRef: string;
}

/**
 * What the pure Recommendation Engine produces (§4.1): a value object with **no persistence
 * identity of its own** — it never touches the database (C5-R2 / P12).
 */
export interface TargetProposalDraft extends TargetProposalKey {
  /** `company.targetKinds ∩ position.suggestedTargetKinds` — persisted verbatim (§5.2). */
  matchedTargetKinds: string[];
  /** Consumed verbatim from `position.importance` (§7.5). */
  positionImportance: number;
  /** `position.satisfies_requirement_refs ∩ need.requirementRefs`, sorted. */
  coveredRequirementRefs: string[];
  /** The subset of `coveredRequirementRefs` that is still an ACTIVE requirement. */
  unresolvedRequirementRefs: string[];
  score: number;
  scoreVersion: string;
  kindVocabularyVersion: string;
  recommendationRevision: string;
  /** Deterministic rendering of the structured facts above — the ONLY free-text field. */
  selectionReason: string;
  proposalRef: string;
}

/** The PERSISTED proposal: a draft plus its lifecycle fields. */
export interface TargetProposal extends TargetProposalDraft {
  status: TargetProposalStatus;
  createdAt: string;
}

/**
 * `RECOMMENDATION_SCORE_V1` (§11.2) — integer weights, **fixed and versioned**; an
 * implementer may not re-derive or rearrange them. Ordering: score DESC, then
 * positionRef ASC, then companyRef ASC (total, deterministic — no randomness).
 *
 * ★ The POSITIVE weight on `unresolvedRequirementRefs` encodes a business stance:
 *   "more still-unknown information ⇒ more research value". It is NOT a completion metric,
 *   and must not be turned into a penalty.
 */
export const RECOMMENDATION_SCORE_V1 = {
  version: "rec-v1",
  importanceWeight: 100,
  coveredWeight: 10,
  unresolvedWeight: 15,
  alreadyTargetedPenalty: 25,
} as const;

/**
 * Score for one candidate. `alreadyTargeted` is 0 by construction in C5-A (eligibility
 * excludes companies that already have a target), but the term is kept so the frozen
 * formula shape survives future revisions.
 */
export function recommendationScoreV1(input: {
  importance: number;
  coveredCount: number;
  unresolvedCount: number;
  alreadyTargeted: boolean;
}): number {
  const w = RECOMMENDATION_SCORE_V1;
  return (
    w.importanceWeight * input.importance +
    w.coveredWeight * input.coveredCount +
    w.unresolvedWeight * input.unresolvedCount -
    (input.alreadyTargeted ? w.alreadyTargetedPenalty : 0)
  );
}

/**
 * §7.4 — the ONE normalisation of a company into a subject key.
 *
 * `Eligibility`, proposal generation and (in C5-B) confirm MUST all call exactly this, never
 * re-implement `.trim()` locally: two different normalisations would yield two different
 * `targetRef`s for the same company and silently split the identity.
 *
 * The target identity itself is still produced by `TargetService` via
 * `targetRefFor(industryId, subjectKey)` — C5 never assembles it by hand.
 */
export function subjectKeyForCompany(company: { canonicalName: string }): string {
  return company.canonicalName.trim();
}
