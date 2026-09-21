/**
 * ResearchRun — one complete research goal. Allows loops (multiple rounds).
 * Layer P1 (04 §1.2 / 07 §5.1): Run state is independent from Round/Task state.
 */

export type ResearchRunStatus =
  | "planning"
  | "active"
  | "waiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export const RUN_TERMINAL_STATUSES: ReadonlySet<ResearchRunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export interface ResearchRunBudget {
  maxRounds: number;
  maxCost: number;
  maxTurns: number;
}

export interface ResearchRun {
  runId: string;
  objective: string;
  status: ResearchRunStatus;
  projectId?: string;
  industryId?: string;
  budget: ResearchRunBudget;
  rounds: string[];
  createdAt: string;
  updatedAt: string;
}

export function isRunTerminal(status: ResearchRunStatus): boolean {
  return RUN_TERMINAL_STATUSES.has(status);
}
