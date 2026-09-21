/**
 * ResearchRound — one round of a Run. A single round's TaskGraph is a strict
 * DAG (acyclic). Rejection does NOT reopen old tasks: the orchestrator creates
 * a new round instead.
 */

export type ResearchRoundStatus =
  | "planned"
  | "running"
  | "review"
  | "completed"
  | "rejected";

export interface ResearchRound {
  roundId: string;
  runId: string;
  status: ResearchRoundStatus;
  /** Ordered task ids belonging to this round's DAG. */
  taskIds: string[];
  /** Why the round was rejected (when status === "rejected"). */
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}
