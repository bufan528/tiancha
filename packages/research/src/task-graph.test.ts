import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskGraph, validateDAG } from "./domain/task-graph.js";
import type { ResearchTask } from "./domain/task.js";

function t(id: string, deps: string[]): ResearchTask {
  const now = new Date().toISOString();
  return {
    taskId: id,
    type: "collect",
    status: "queued",
    priority: 0,
    dependencies: deps,
    inputs: {},
    outputs: [],
    agentRole: "scout",
    modelPolicy: { tier: "cheap", thinkingLevel: "off" },
    humanGate: "none",
    retry: { maxAttempts: 1, backoffMs: 0 },
    budget: { maxTurns: 1, maxCost: 0 },
    roundId: "r1",
    runId: "run-1",
    createdAt: now,
    updatedAt: now,
  };
}

test("DAG: linear chain topologically orders", () => {
  const g = buildTaskGraph("r1", [t("a", []), t("b", ["a"]), t("c", ["b"])]);
  const res = validateDAG(g);
  assert.equal(res.ok, true);
  assert.deepEqual(res.order, ["a", "b", "c"]);
});

test("DAG: cycle detected", () => {
  const g = buildTaskGraph("r1", [t("a", ["c"]), t("b", ["a"]), t("c", ["b"])]);
  const res = validateDAG(g);
  assert.equal(res.ok, false);
});

test("DAG: unknown dependency rejected", () => {
  const g = buildTaskGraph("r1", [t("a", ["ghost"])]);
  const res = validateDAG(g);
  assert.equal(res.ok, false);
});
