/**
 * ★ C2 Phase 2 · Step 2-C — `ResearchPlanView` and its pure derivations.
 *
 * `ResearchPlanView` is a **read-model / projection DTO**:
 *   ≠ SoT · ≠ entity · ≠ aggregate · ≠ persisted domain object.
 * It has **no identity** and deliberately carries NO lifecycle/写法 fields:
 *   `planId` / `createdAt` / `updatedAt` / `versionId` / `status` / `save()` / `upsert()`
 * must never appear here (contract §4.3 / I-C2-17).
 *
 * The ONLY build path is `ResearchPlanService.build(industryId)` (application layer).
 * Everything in THIS file is a pure helper it composes — target association, preparation
 * summarisation and the deterministic ordering of §4.3.2. There is no second view assembly.
 */

import { currentPreparationView, type DiligencePreparation } from "./diligence-preparation.js";
import type { ResearchTarget } from "./research-target.js";

/** ★ FINAL LOCK §4.3.1: the exclusive, complete tri-state of a target's association. */
export type TargetAssociationStatus = "mapped" | "unlinked" | "non_currently_mapped";

/** The plan's read-only view of `ResearchState` (`null` = no persisted state — never faked as 0). */
export interface ResearchPlanState {
  version: number;
  known: number;
  confirmed: number;
  uncertain: number;
  conflicting: number;
  unknown: number;
  keyQuestionCount: number;
}

/** A read-only fit summary (consumed from `QuestionTargetFitService.summarize`). */
export interface ResearchPlanFit {
  questionCount: number;
  strong: number;
  partial: number;
  weak: number;
  none: number;
  requiresFallback: number;
}

/** Current-vs-history preparation counts (Phase 1 view; `null` when the target has none). */
export interface ResearchPlanPreparation {
  preparationRef: string;
  currentQuestionCount: number;
  retiredQuestionCount: number;
  status: string;
}

export interface ResearchPlanTarget {
  targetRef: string;
  subjectKey: string;
  targetKind: string;
  /** Which chain position this human-confirmed subject sits at. */
  positionRef: string;
  isFallback: boolean;
  fallbackForTargetRef: string | null;
  /** ★ Derived ONLY from the Requirement intersection (§1.4) — never stored. */
  associationStatus: TargetAssociationStatus;
  fit: ResearchPlanFit;
  preparation: ResearchPlanPreparation | null;
  /** Human-readable refs: `{ ref, label }` (dimension name when known, else the ref itself). */
  requirementLabels: Array<{ ref: string; label: string }>;
}

export interface ResearchPlanPosition {
  positionRef: string;
  label: string;
  kind: string;
  /** ≡ the position's capability refs (§1.3) — never re-sorted. */
  allRequirementRefs: string[];
  /** `all ∩ active` — today's research state (Step 2-A derivation) — never re-sorted. */
  activeRequirementRefs: string[];
  /** The `mapped` targets that sit at this position and belong to this gap. */
  targets: ResearchPlanTarget[];
}

export interface ResearchPlanGap {
  gapId: string;
  dimension: string;
  dimensionLabel: string;
  gapType: string;
  status: string;
  /** The requirement(s) this gap asks for (today exactly one — see the service docblock). */
  requirementRefs: string[];
  whyStudyNotJustFetch: string;
  priorityScore: number;
  priorityPolicyVersionId: string;
  positions: ResearchPlanPosition[];
}

export interface ResearchPlanNextAction {
  actionId: string;
  gapId: string | null;
  kind: string;
  priority: number;
  rationale: string;
  status: string;
}

export interface ResearchPlanView {
  industryRef: string;
  industryName: string;
  /** `null` ⇒ the industry simply has no persisted ResearchState (a normal state). */
  state: ResearchPlanState | null;
  /** Active gaps, ordered (§4.3.2: priority desc → gapId asc). */
  gaps: ResearchPlanGap[];
  /** Targets belonging to no active gap: `unlinked ∪ non_currently_mapped` (never hidden). */
  industryTargets: ResearchPlanTarget[];
  /** Next actions, ordered (§4.3.2: priority desc → actionId asc). */
  nextActions: ResearchPlanNextAction[];
}

// ---- pure derivations ---------------------------------------------------------

/**
 * ★ FINAL LOCK §1.4 / §4.3.1 — the three-state association, derived ONLY from the intersection
 * between the target's requirement refs and the ACTIVE gaps' requirement refs.
 *
 * `activeRequirementRefs` must be the shared Step 2-A active set (never a local predicate).
 */
export function targetAssociationStatus(
  target: Pick<ResearchTarget, "relatedRequirementRefs">,
  activeRequirementRefs: ReadonlySet<string>,
): TargetAssociationStatus {
  if (target.relatedRequirementRefs.length === 0) return "unlinked";
  return target.relatedRequirementRefs.some((ref) => activeRequirementRefs.has(ref))
    ? "mapped"
    : "non_currently_mapped";
}

/** §1.4: a target belongs to a gap iff their requirement refs intersect. */
export function targetBelongsToGap(
  target: Pick<ResearchTarget, "relatedRequirementRefs">,
  gapRequirementRefs: readonly string[],
): boolean {
  return target.relatedRequirementRefs.some((ref) => gapRequirementRefs.includes(ref));
}

/** Read-only preparation summary — uses the Phase 1 `current`/`retired` projection (no re-judging). */
export function preparationSummary(
  preparation: DiligencePreparation | undefined,
): ResearchPlanPreparation | null {
  if (!preparation) return null;
  const view = currentPreparationView(preparation);
  return {
    preparationRef: preparation.preparationRef,
    currentQuestionCount: view.currentQuestionCount,
    retiredQuestionCount: view.retiredQuestionCount,
    status: preparation.status,
  };
}

// ---- deterministic ordering (§4.3.2) -----------------------------------------

/** Gaps: priority desc → gapId asc. */
export function compareGaps(a: ResearchPlanGap, b: ResearchPlanGap): number {
  return b.priorityScore - a.priorityScore || (a.gapId < b.gapId ? -1 : a.gapId > b.gapId ? 1 : 0);
}

/** Targets: targetRef asc. */
export function compareTargets(
  a: Pick<ResearchPlanTarget, "targetRef">,
  b: Pick<ResearchPlanTarget, "targetRef">,
): number {
  return a.targetRef < b.targetRef ? -1 : a.targetRef > b.targetRef ? 1 : 0;
}

/** Next actions: priority desc → actionId asc. */
export function compareNextActions(a: ResearchPlanNextAction, b: ResearchPlanNextAction): number {
  return b.priority - a.priority || (a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0);
}
