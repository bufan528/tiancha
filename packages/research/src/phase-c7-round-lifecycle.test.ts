/**
 * Slice R1 — Round lifecycle implementation.
 * Contract: docs/phaseC/round-lifecycle-contract.md (rev1).
 *
 *   R1-A  ROUND_TERMINAL_STATUSES + isRoundTerminal
 *   R1-B  allRoundTasksTerminal() + running → review settlement
 *   R1-C  review → completed|rejected guard · completed ⇒ all tasks terminal · terminal no-reopen
 *   D-R9  a task failure does not mechanically transition the round
 *
 * Everything runs against a read-only TaskEngine stub: this slice does not touch TaskEngine.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Orchestrator } from "./runtime/orchestrator.js";
import { ROUND_TERMINAL_STATUSES, isRoundTerminal } from "./domain/index.js";
import type { ResearchRoundStatus, ResearchTask, TaskStatus } from "./domain/index.js";
import type { TaskEngine } from "./runtime/task-engine.js";
import type { ResearchEventAdapter } from "./runtime/research-event-adapter.js";

const ALL_ROUND_STATUSES: ResearchRoundStatus[] = [
  "planned",
  "running",
  "review",
  "completed",
  "rejected",
];

function makeTask(taskId: string, status: TaskStatus): ResearchTask {
  const now = new Date().toISOString();
  return {
    taskId,
    type: "collect",
    status,
    priority: 0,
    dependencies: [],
    inputs: {},
    outputs: [],
    agentRole: "scout",
    modelPolicy: { tier: "cheap", thinkingLevel: "off" },
    humanGate: "none",
    retry: { maxAttempts: 1, backoffMs: 0 },
    budget: { maxTurns: 1, maxCost: 0 },
    // Deliberately a placeholder: round membership must NOT be inferred from this field.
    roundId: "placeholder",
    runId: "placeholder",
    createdAt: now,
    updatedAt: now,
  };
}

function harness() {
  const tasks: ResearchTask[] = [];
  const engine = {
    list: () => tasks,
    enqueue: (task: ResearchTask) => {
      tasks.push(task);
    },
  } as unknown as TaskEngine;
  const events = { emit: async () => undefined } as unknown as ResearchEventAdapter;
  const orchestrator = new Orchestrator(engine, events);
  const run = orchestrator.startRun({ objective: "slice R1" });

  const openRound = (...taskStatuses: TaskStatus[]) => {
    const list = taskStatuses.map((status, i) => makeTask(`t${i + 1}`, status));
    const round = orchestrator.startRound(run.runId, list);
    return { round, list };
  };

  return { orchestrator, run, tasks, openRound };
}

// ───────────────────────────── R1-A ─────────────────────────────

test("R1-A: ROUND_TERMINAL_STATUSES is exactly { completed, rejected }", () => {
  assert.deepEqual([...ROUND_TERMINAL_STATUSES].sort(), ["completed", "rejected"]);
});

test("R1-A: isRoundTerminal is true only for completed / rejected", () => {
  const terminal = ALL_ROUND_STATUSES.filter(isRoundTerminal);
  assert.deepEqual(terminal.sort(), ["completed", "rejected"]);
  assert.equal(isRoundTerminal("planned"), false);
  assert.equal(isRoundTerminal("running"), false);
  assert.equal(
    isRoundTerminal("review"),
    false,
    "review is the pre-closure evaluation state, not terminal",
  );
});

// ───────────────────────────── R1-B ─────────────────────────────

for (const blocking of ["queued", "waiting", "running"] as TaskStatus[]) {
  test(`R1-B: a ${blocking} task blocks running → review`, () => {
    const h = harness();
    const { round } = h.openRound(blocking);
    assert.equal(h.orchestrator.allRoundTasksTerminal(round.roundId), false);
    const after = h.orchestrator.settleRound(round.roundId);
    assert.equal(after.status, "running", `\"${blocking}\" is not a Task terminal state`);
  });
}

test("R1-B: all tasks terminal (completed / failed / cancelled) permits running → review", () => {
  const h = harness();
  const { round } = h.openRound("completed", "failed", "cancelled");
  assert.equal(h.orchestrator.allRoundTasksTerminal(round.roundId), true);
  const after = h.orchestrator.settleRound(round.roundId);
  assert.equal(after.status, "review");
});

test("R1-B: a dependency-impossibility failure counts as terminal", () => {
  const h = harness();
  // rev4's dependency-impossibility closure lands the Task in `failed` with no TaskAttempt.
  const { round } = h.openRound("failed");
  assert.equal(
    h.orchestrator.settleRound(round.roundId).status,
    "review",
    "a closed-out task must not block the round forever",
  );
});

test("R1-B: settlement is idempotent — a review round is never re-settled", () => {
  const h = harness();
  const { round } = h.openRound("completed");
  const first = h.orchestrator.settleRound(round.roundId);
  assert.equal(first.status, "review");
  const second = h.orchestrator.settleRound(round.roundId);
  assert.equal(second.status, "review");
  assert.equal(second.updatedAt, first.updatedAt, "a non-running round is returned unchanged");
});

test("R1-B: an unregistered round task blocks settlement (stage ① semantics)", () => {
  const h = harness();
  const { round } = h.openRound("completed");
  h.tasks.length = 0; // simulate "not registered in the engine" (C7-B rev4 §5.1 L-3, option 3a)
  assert.equal(h.orchestrator.allRoundTasksTerminal(round.roundId), false);
  assert.equal(h.orchestrator.settleRound(round.roundId).status, "running");
});

test("R1-B: an empty round settles (taskIds=[] ⇒ every ≡ true) — no new rule introduced", () => {
  const h = harness();
  const round = h.orchestrator.startRound(h.run.runId, []);
  assert.equal(round.taskIds.length, 0);
  assert.equal(h.orchestrator.allRoundTasksTerminal(round.roundId), true);
  assert.equal(h.orchestrator.settleRound(round.roundId).status, "review");
});

// ───────────────────────────── R1-C ─────────────────────────────

test("R1-C: review → completed is allowed once every task is terminal", () => {
  const h = harness();
  const { round } = h.openRound("completed", "failed");
  h.orchestrator.settleRound(round.roundId);
  const done = h.orchestrator.finishRound(round.roundId, "completed");
  assert.equal(done.status, "completed");
  assert.equal(done.rejectionReason, undefined);
  assert.equal(isRoundTerminal(done.status), true);
});

test("R1-C: review → rejected records the reason; no task is reopened", () => {
  const h = harness();
  const { round, list } = h.openRound("failed");
  h.orchestrator.settleRound(round.roundId);
  const before = list.map((task) => task.status);
  const done = h.orchestrator.finishRound(round.roundId, "rejected", "insufficient evidence");
  assert.equal(done.status, "rejected");
  assert.equal(done.rejectionReason, "insufficient evidence");
  assert.deepEqual(list.map((task) => task.status), before, "rejection never reopens a task");
});

test("R1-C: review → completed throws when some task is not terminal (state invariant)", () => {
  const h = harness();
  const { round, list } = h.openRound("completed");
  h.orchestrator.settleRound(round.roundId);
  list[0]!.status = "queued"; // force the invariant to be violated after settlement
  assert.throws(
    () => h.orchestrator.finishRound(round.roundId, "completed"),
    /not every round task is terminal/,
  );
});

test("R1-C: running → completed | rejected throws", () => {
  const h = harness();
  const { round } = h.openRound("completed");
  assert.throws(
    () => h.orchestrator.finishRound(round.roundId, "completed"),
    /only "review" may close/,
  );
  assert.throws(
    () => h.orchestrator.finishRound(round.roundId, "rejected"),
    /only "review" may close/,
  );
});

test("R1-C: finishRound only accepts completed | rejected", () => {
  const h = harness();
  const { round } = h.openRound("completed");
  h.orchestrator.settleRound(round.roundId);
  for (const invalid of ["planned", "running", "review"] as ResearchRoundStatus[]) {
    assert.throws(
      () => h.orchestrator.finishRound(round.roundId, invalid),
      /only "completed" \| "rejected"/,
    );
  }
});

test("R1-C: terminal rounds are irreversible", () => {
  const h = harness();
  const { round } = h.openRound("completed");
  h.orchestrator.settleRound(round.roundId);
  h.orchestrator.finishRound(round.roundId, "completed");
  for (const next of ["review", "rejected", "running"] as ResearchRoundStatus[]) {
    assert.throws(
      () => h.orchestrator.finishRound(round.roundId, next),
      /only "review" may close/,
      `a completed round must not move to "${next}"`,
    );
  }
  assert.equal(h.orchestrator.getRound(round.roundId)?.status, "completed");
});

test("R1-C: an empty round may be completed (taskIds=[] ⇒ every ≡ true)", () => {
  const h = harness();
  const round = h.orchestrator.startRound(h.run.runId, []);
  h.orchestrator.settleRound(round.roundId);
  assert.equal(h.orchestrator.finishRound(round.roundId, "completed").status, "completed");
});

// ───────────────────────────── D-R9 ─────────────────────────────

test("D-R9: a task failure does not mechanically transition the round", () => {
  const h = harness();
  const { round, list } = h.openRound("running");
  const before = h.orchestrator.getRound(round.roundId)?.status;
  list[0]!.status = "failed"; // execution failure, or a rev4 dependency-impossibility closure
  assert.equal(
    h.orchestrator.getRound(round.roundId)?.status,
    before,
    "Task.failed itself does not move the Round (no mechanical cascade)",
  );
});
