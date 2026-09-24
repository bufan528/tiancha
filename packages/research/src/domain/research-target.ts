/**
 * ResearchTarget (Phase B v1 · Step B2) — a **Human-confirmed subject**.
 *
 * ★ ARCHITECTURAL RED LINE (contract §2.4):
 *   The system may SUGGEST "which KIND of object to study" (via `ResearchPosition.
 *   suggestedTargetKinds`), but it must NEVER decide "it is this company". The subject
 *   identity is supplied by a human, and `createdBy` is therefore always `"user"`.
 *   There is deliberately NO code path `Position → ResearchTarget`.
 */

export type Accessibility = "contactable" | "likely" | "unlikely" | "unknown";

export type TargetStatus =
  | "proposed"
  | "selected"
  | "contacted"
  | "scheduled"
  | "visited"
  | "completed"
  | "dropped";

export interface ResearchTarget {
  /** Deterministic: `tgt-<industryId>-<slug(subjectKey)>` — the same human-supplied
   *  subject in the same industry is ALWAYS the same target (T-B6). */
  targetRef: string;
  industryId: string;
  /** ★ The human-supplied subject identity (company / expert / institution name). */
  subjectKey: string;
  /** From `position.suggestedTargetKinds` (type level). */
  targetKind: string;
  /** Which chain position this target sits at. */
  positionRef: string;
  /** Type-specific profile (JSON extension; key types keep real columns). */
  kindSubject: Record<string, unknown>;
  /** REQUIRED (I-B2). */
  researchPurpose: string;
  /** REQUIRED (I-B2). */
  selectionReason: string;
  /** 0..1. Defaults to the position's derived `importance` (Q3 ruling). */
  expectedInformationValue: number;
  accessibility: Accessibility;
  limitations: string[];
  /** When true, `fallbackForTargetRef` AND `limitations` are REQUIRED (I-B3). */
  isFallback: boolean;
  fallbackForTargetRef: string | null;
  relatedQuestionRefs: string[];
  relatedRequirementRefs: string[];
  status: TargetStatus;
  /** Always `"user"` — the system cannot fabricate a human confirmation (T-B8). */
  createdBy: "user";
  createdAt: string;
  updatedAt: string;
}

/** Deterministic, name-safe subject key (∅ timestamps, ∅ randomness). */
export function slugSubjectKey(subjectKey: string): string {
  const slug = subjectKey
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "subject";
}

export function targetRefFor(industryId: string, subjectKey: string): string {
  return `tgt-${industryId}-${slugSubjectKey(subjectKey)}`;
}

/** The fallback caveat, worded exactly as the requirement states it (HANDOFF §1.2 step 13). */
export const FALLBACK_CAVEAT = "非最佳信息来源：需降低置信度并交叉验证";

/**
 * ★ T-B10: a fallback target is NOT just a boolean. Every caveat a target imposes on the
 * downstream layers (Fit / Outline) is produced HERE, so B3/B4 read them instead of
 * re-deriving or silently ignoring `isFallback`.
 */
export function targetCaveats(target: ResearchTarget): string[] {
  const caveats: string[] = [];
  if (target.isFallback) caveats.push(FALLBACK_CAVEAT);
  for (const limitation of target.limitations) {
    if (!caveats.includes(limitation)) caveats.push(limitation);
  }
  return caveats;
}
