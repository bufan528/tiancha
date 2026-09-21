/**
 * TaskGraph -strict DAG over task ids within one round. Pure deterministic
 * topology helpers (Kahn's algorithm). No LLM, no side effects.
 */

import type { ResearchTask } from "./task.js";

export interface TaskGraph {
  roundId: string;
  /** task ids in this graph. */
  nodes: string[];
  /** edges[taskId] = ids this task depends on (must complete first). */
  edges: Record<string, string[]>;
}

export interface TopologyResult {
  ok: boolean;
  /** Topologically sorted task ids (only when ok === true). */
  order: string[];
  /** Cycle / missing-node diagnostics (only when ok === false). */
  errors: string[];
}

/** Build a TaskGraph from tasks and validate it is a well-formed DAG. */
export function buildTaskGraph(roundId: string, tasks: ResearchTask[]): TaskGraph {
  const edges: Record<string, string[]> = {};
  const nodes: string[] = [];
  for (const t of tasks) {
    nodes.push(t.taskId);
    edges[t.taskId] = [...t.dependencies];
  }
  return { roundId, nodes, edges };
}

/** Kahn's algorithm: returns a topo order or reports cycles/missing nodes. */
export function validateDAG(graph: TaskGraph): TopologyResult {
  const errors: string[] = [];
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    indegree.set(node, 0);
    adjacency.set(node, []);
  }

  for (const [node, deps] of Object.entries(graph.edges)) {
    if (!indegree.has(node)) {
      errors.push(`node "${node}" referenced in edges but not in nodes`);
      continue;
    }
    for (const dep of deps) {
      if (!indegree.has(dep)) {
        errors.push(`node "${node}" depends on unknown node "${dep}"`);
        continue;
      }
      indegree.set(node, (indegree.get(node) ?? 0) + 1);
      adjacency.get(dep)?.push(node);
    }
  }

  if (errors.length > 0) {
    return { ok: false, order: [], errors };
  }

  const queue: string[] = graph.nodes.filter((n) => (indegree.get(n) ?? 0) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    order.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  if (order.length !== graph.nodes.length) {
    const inCycle = graph.nodes.filter((n) => !order.includes(n));
    return {
      ok: false,
      order: [],
      errors: [`cycle detected; nodes not topologically orderable: ${inCycle.join(", ")}`],
    };
  }

  return { ok: true, order, errors: [] };
}
