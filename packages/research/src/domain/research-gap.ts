/**
 * ResearchGap — what is NOT yet known / uncertain enough to proceed.
 * Drives: Gap → Question → InformationRequirement → Target → Diligence → NextAction.
 * NOT a string[] on ResearchState.
 *
 * S4.5 `gapType` — WHY the gap exists, mirroring the PoolSlot status that produced it
 * (07 §4 GapType / §7 state machine):
 *   unknown      <- slot.status = unknown       (no information at all)
 *   insufficient <- slot.status = partial       (some information, condition not met)
 *   conflict     <- slot.status = conflicting   (unresolved disagreement, never auto-resolved)
 *
 * A gap exists ONLY for those three states; a `sufficient` slot CLOSES its gap.
 * `importance` / `criticality` are gap ATTRIBUTES supplied to S5's PriorityService —
 * they are NOT the condition that opens a gap (that was the old `importance >= 2` bug).
 */

export type GapStatus = "open" | "mitigating" | "resolved" | "accepted";

/** S4.5: why a gap exists. */
export type GapType = "unknown" | "insufficient" | "conflict";

export interface ResearchGap {
  gapId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  description: string;
  /** S4.5: derived from the producing PoolSlot status. */
  gapType: GapType;
  /** Requirement importance — an input fact for S5 Priority, not an open condition. */
  importance: number;
  uncertainty: number;
  relatedRequirementIds: string[];
  relatedQuestionIds: string[];
  status: GapStatus;
  discoveredAt: string;
  updatedAt: string;
}
