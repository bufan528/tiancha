/**
 * Target discovery / screening entities (P1; Phase 1 = contract only).
 */

export type TargetDecisionKind = "reserve" | "watch" | "reject";

export interface ScreeningRun {
  runId: string;
  industryId: string;
  ruleIds: string[];
  startedAt: string;
  finishedAt?: string;
  universeSize: number;
  candidateIds: string[];
}

export interface ScreeningRule {
  ruleId: string;
  name: string;
  predicate: string;
  weight: number;
}

export interface TargetCandidate {
  companyId: string;
  industryId: string;
  screeningScore: number;
  selectionReason: string;
  evidenceIds: string[];
  risks: string[];
  whyNow?: string;
  status: "eligible" | "selected" | "rejected";
}

export interface TargetDecision {
  companyId: string;
  runId: string;
  decision: TargetDecisionKind;
  decidedBy: string;
  decidedAt: string;
  reason: string;
}
