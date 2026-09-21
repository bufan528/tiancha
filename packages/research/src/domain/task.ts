/**
 * ResearchTask -immutable execution unit. Once running, deps/inputs are frozen;
 * changing intent means creating a NEW task (never mutating this one).
 * A task has 1..N TaskAttempts (see task-attempt.ts) for retries/resume.
 */

import type { ModelPolicy } from "./research-context.js";

export type TaskType =
  | "plan"
  | "hypothesis"
  | "collect"
  | "extract_industry"
  | "resolve"
  | "enrich"
  | "evaluate"
  | "critic"
  | "dossier_update"
  | "report"
  | "human_gate";

export type AgentRole =
  | "planner"
  | "scout"
  | "resolver"
  | "analyst"
  | "critic"
  | "writer";

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export const TASK_TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export type HumanGateKind = "none" | "before_reserve" | "before_major_conclusion";

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface TaskBudget {
  maxTurns: number;
  maxCost: number;
}

export interface TaskInputs {
  industryId?: string;
  companyId?: string;
  question?: string;
  /** References to known Fact/Claim/Evidence artifact ids. */
  knownArtifactRefs?: string[];
}

export interface ResearchTask {
  taskId: string;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  /** Dependency task ids within the same round's DAG. */
  dependencies: string[];
  inputs: TaskInputs;
  /** Outputs: ArtifactRefs only (never inline blobs). See artifact.ts. */
  outputs: string[];
  agentRole: AgentRole;
  modelPolicy: ModelPolicy;
  humanGate: HumanGateKind;
  retry: RetryPolicy;
  budget: TaskBudget;
  roundId: string;
  runId: string;
  /** The attempt currently in flight, if any. */
  activeAttemptId?: string;
  createdAt: string;
  updatedAt: string;
}

export function isTaskTerminal(status: TaskStatus): boolean {
  return TASK_TERMINAL_STATUSES.has(status);
}
