/**
 * ResearchGap — what is NOT yet known / uncertain enough to proceed.
 * Drives: Gap → Question → InformationRequirement → Target → Diligence → NextAction.
 * NOT a string[] on ResearchState.
 */

export type GapStatus = "open" | "mitigating" | "resolved" | "accepted";

export interface ResearchGap {
  gapId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  description: string;
  importance: number;
  uncertainty: number;
  relatedRequirementIds: string[];
  relatedQuestionIds: string[];
  status: GapStatus;
  discoveredAt: string;
  updatedAt: string;
}
