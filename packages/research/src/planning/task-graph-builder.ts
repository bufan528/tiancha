/**
 * Deterministic TaskGraph builder. Phase 1: thin wrapper over domain DAG utils.
 */
import { buildTaskGraph, validateDAG, type TaskGraph } from "../domain/task-graph.js";
import type { ResearchTask } from "../domain/index.js";

export function buildRoundGraph(roundId: string, tasks: ResearchTask[]): TaskGraph {
  return buildTaskGraph(roundId, tasks);
}

export { validateDAG };
