/**
 * R2 — Round Execution Driver (`stepRound`).
 * Contract: docs/phaseC/round-execution-driver-contract.md (rev1, FINAL LOCK).
 *
 *   R2-A readiness     1 queued+no dep → dispatch · 2 queued+completed dep → dispatch
 *                      3 failed/cancelled dep → no dispatch (and no state change)
 *   R2-B ordering      4 multiple ready → first according to round.taskIds
 *   R2-C step boundary 5 one invocation ≤ one TaskEngine.start() · 6 start() returns → step returns
 *   R2-D no progress   7 no ready + non-terminal → no_progress · 8 all terminal → settleRound()
 *   R2-E edge          9 empty Round → preserve R1 behavior · 10 start() throws → propagate
 *
 * Everything runs against a read-only TaskEngine stub: this slice does not touch TaskEngine.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Orchestrator } from "./runtime/orchestrator.js";
import type { ResearchTask, TaskStatus } from "./domain/index.js";
import type { TaskEngine } from "./runtime/task-engine.js";
import type { ResearchEventAdapter } from "./runtime/research-event-adapter.js";

function makeTask(taskId: string, status: TaskStatus, dependencies: string[] = []): ResearchTask {
  const now = new Date().toISOString();
  return {
    taskId,
    type: "collect",
    status,
    priority: 0,
    dependencies,
    inputs: {},
    outputs: [],
    agentRole: "scout",
    modelPolicy: { tier: "cheap", thinkingLevel: "off" },
    humanGate: "none",
    retry: { maxAttempts: 1, backoffMs: 0 },
    budget: { maxTurns: 1, maxCost: 0 },
    roundId: "placeholder",
    runId: "placeholder",
    createdAt: now,
    updatedAt: now,
  };
}

function harness(opts: { startThrows?: boolean } = {}) {
  const tasks: ResearchTask[] = [];
  const starts: string[] = [];
  let failCalls = 0;

  const engine = {
    list: () => tasks,
    enqueue: (task: ResearchTask) => {
      tasks.push(task);
    },
    start: async (taskId: string) => {
      if (opts.startThrows) throw new Error("start boom");
      starts.push(taskId);
      const task = tasks.find((t) => t.taskId === taskId);
      if (task) task.status = "running";
      return { task, attempt: {}, session: {} };
    },
    fail: () => {
      failCalls += 1;
      throw new Error("R2 must never call fail()");
    },
  } as unknown as TaskEngine;

  const events = { emit: async () => undefined } as unknown as ResearchEventAdapter;
  const orchestrator = new Orchestrator(engine, events);
  const run = orchestrator.startRun({ objective: "R2 step test" });

  const openRound = (tasksSpec: Array<{ id: string; status: TaskStatus; deps?: string[] }>) => {
    const list = tasksSpec.map((s) => makeTask(s.id, s.status, s.deps ?? []));
    const round = orchestrator.startRound(run.runId, list);
    return { round, list };
  };

  return { orchestrator, run, tasks, starts, openRound, failCount: () => failCalls };
}

const roundStatus = (h: ReturnType<typeof harness>, roundId: string) =>
  h.orchestrator.getRound(roundId)?.status;

// ───────────────────────────── R2-A readiness ─────────────────────────────

test("R2-A 1: queued + no dependency → dispatched", async () => {
  const h = harness();
  const { round } = h.openRound([{ id: "a", status: "queued" }]);
  const result = await h.orchestrator.stepRound(round.roundId);
  assert.deepEqual(result, { kind: "dispatched", taskId: "a" });
  assert.deepEqual(h.starts, ["a"], "exactly the ready task was handed to TaskEngine.start()");
});

test("R2-A 2: queued + completed dependencies → dispatched", async () => {
  const h = harness();
  const { round } = h.openRound([
    { id: "dep", status: "completed" },
    { id: "a", status: "queued", deps: ["dep"] },
  ]);
  const result = await h.orchestrator.stepRound(round.roundId);
  assert.deepEqual(result, { kind: "dispatched", taskId: "a" });
});

test("R2-A 3: failed / cancelled dependency → no dispatch, and no state change", async () => {
  for (const depStatus of ["failed", "cancelled"] as TaskStatus[]) {
    const h = harness();
    const { round, list } = h.openRound([
      { id: "dep", status: depStatus },
      { id: "a", status: "queued", deps: ["dep"] },
    ]);
    const before = list.map((t) => t.status);
    const result = await h.orchestrator.stepRound(round.roundId);
    assert.equal(result.kind, "no_progress", `${depStatus} dependency ⇒ not ready ⇒ no dispatch`);
    assert.equal(h.starts.length, 0, "nothing was started");
    assert.deepEqual(
      list.map((t) => t.status),
      before,
      "a non-ready task is NOT turned into failed/waiting/cancelled",
    );
    assert.equal(roundStatus(h, round.roundId), "running", "Round was not moved by a non-ready task");
  }
});

// ───────────────────────────── R2-B ordering ─────────────────────────────

test("R2-B 4: multiple ready → the first according to round.taskIds (no priority/score/timestamp)", async () => {
  const h = harness();
  const { round } = h.openRound([
    { id: "first", status: "queued" },
    { id: "second", status: "queued" },
    { id: "third", status: "queued" },
  ]);
  // round.taskIds is the DAG topo order produced by startRound.
  assert.deepEqual(round.taskIds, ["first", "second", "third"]);
  const result = await h.orchestrator.stepRound(round.roundId);
  assert.deepEqual(result, { kind: "dispatched", taskId: "first" });
});

// ───────────────────────────── R2-C step boundary ─────────────────────────────

test("R2-C 5+6: one invocation dispatches at most one Task, then returns (no loop)", async () => {
  const h = harness();
  const { round } = h.openRound([
    { id: "a", status: "queued" },
    { id: "b", status: "queued" },
  ]);
  const result = await h.orchestrator.stepRound(round.roundId);
  assert.equal(result.kind, "dispatched");
  assert.equal(h.starts.length, 1, "one invocation ≤ one TaskEngine.start()");
  assert.equal(
    h.tasks.filter((t) => t.status === "running").length,
    1,
    "the second ready task was NOT folded into this invocation",
  );
});

// ───────────────────────────── R2-D no progress / settlement ─────────────────────────────

test("R2-D 7: no ready + non-terminal → no_progress, and neither Task nor Round state changes", async () => {
  const h = harness();
  const { round, list } = h.openRound([
    { id: "a", status: "running" },
    { id: "b", status: "queued", deps: ["a"] },
  ]);
  const before = list.map((t) => t.status);
  const result = await h.orchestrator.stepRound(round.roundId);
  assert.deepEqual(result, { kind: "no_progress" });
  assert.deepEqual(list.map((t) => t.status), before, "no waiting / failed / cancelled is invented");
  assert.equal(roundStatus(h, round.roundId), "running", "no_progress never implies review");
});

test("R2-D 8: all terminal → settled, and the Round moves running → review (via settleRound)", async () => {
  const h = harness();
  const { round } = h.openRound([
    { id: "a", status: "completed" },
    { id: "b", status: "failed" },
    { id: "c", status: "cancelled" },
  ]);
  const result = await h.orchestrator.stepRound(round.roundId);
  assert.deepEqual(result, { kind: "settled", roundId: round.roundId });
  assert.equal(roundStatus(h, round.roundId), "review");
});

// ───────────────────────────── R2-E edge ─────────────────────────────

test("R2-E 9: empty Round preserves R1 behavior (all terminal ⇒ settled)", async () => {
  const h = harness();
  const { round } = h.openRound([]);
  assert.equal(round.taskIds.length, 0);
  const result = await h.orchestrator.stepRound(round.roundId);
  assert.deepEqual(result, { kind: "settled", roundId: round.roundId });
  assert.equal(roundStatus(h, round.roundId), "review");
});

test("R2-E 10: TaskEngine.start() throwing propagates; fail() is never called", async () => {
  const h = harness({ startThrows: true });
  const { round } = h.openRound([{ id: "a", status: "queued" }]);
  await assert.rejects(() => h.orchestrator.stepRound(round.roundId), /start boom/);
  assert.equal(h.failCount(), 0, "the driver must not translate a dispatch error into Task.failed");
  assert.equal(roundStatus(h, round.roundId), "running", "Round was not moved by a failed dispatch");
});
