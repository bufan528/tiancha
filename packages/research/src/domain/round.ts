/**
 * ResearchRound — one round of a Run. A single round's TaskGraph is a strict
 * DAG (acyclic). Rejection does NOT reopen old tasks: the orchestrator creates
 * a new round instead.
 *
 * Round lifecycle (see docs/phaseC/round-lifecycle-contract.md rev1):
 *   running --(all round tasks terminal)--> review --(Orchestrator evaluation)-->
 *   completed | rejected
 * `planned` is declared-but-unreachable in v1 (no v1 transition may enter it).
 */

export type ResearchRoundStatus =
  | "planned"
  | "running"
  | "review"
  | "completed"
  | "rejected";

/**
 * Round terminal statuses. Mirrors RUN_TERMINAL_STATUSES / TASK_TERMINAL_STATUSES.
 * `review` is NOT terminal — it is the pre-closure evaluation state.
 */
export const ROUND_TERMINAL_STATUSES: ReadonlySet<ResearchRoundStatus> = new Set([
  "completed",
  "rejected",
]);

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

export function isRoundTerminal(status: ResearchRoundStatus): boolean {
  return ROUND_TERMINAL_STATUSES.has(status);
}
