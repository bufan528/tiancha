/**
 * Orchestrator skeleton -Run/Round lifecycle. Creates runs, starts rounds,
 * validates the round DAG, emits durable events. No LLM planning in Phase 1.
 */

import { randomUUID } from "node:crypto";
import { isTaskTerminal } from "../domain/index.js";
import type {
  ResearchRun,
  ResearchRound,
  ResearchRunStatus,
  ResearchRoundStatus,
  ResearchTask,
} from "../domain/index.js";
import { buildTaskGraph, validateDAG } from "../domain/task-graph.js";
import type { TaskEngine } from "./task-engine.js";
import type { ResearchEventAdapter } from "./research-event-adapter.js";

export class Orchestrator {
  private readonly runs = new Map<string, ResearchRun>();
  private readonly rounds = new Map<string, ResearchRound>();

  constructor(
    private readonly engine: TaskEngine,
    private readonly events: ResearchEventAdapter,
  ) {}

  startRun(params: {
    objective: string;
    projectId?: string;
    industryId?: string;
    maxRounds?: number;
  }): ResearchRun {
    const now = new Date().toISOString();
    const run: ResearchRun = {
      runId: randomUUID(),
      objective: params.objective,
      status: "planning",
      projectId: params.projectId,
      industryId: params.industryId,
      budget: { maxRounds: params.maxRounds ?? 5, maxCost: 0, maxTurns: 0 },
      rounds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(run.runId, run);
    return run;
  }

  startRound(runId: string, tasks: ResearchTask[]): ResearchRound {
    const run = this.mustGetRun(runId);
    const graph = buildTaskGraph(runId, tasks);
    const topo = validateDAG(graph);
    if (!topo.ok) {
      throw new Error(`invalid round DAG: ${topo.errors.join("; ")}`);
    }
    const now = new Date().toISOString();
    const round: ResearchRound = {
      roundId: randomUUID(),
      runId,
      status: "running",
      taskIds: topo.order,
      createdAt: now,
      updatedAt: now,
    };
    this.rounds.set(round.roundId, round);
    run.rounds.push(round.roundId);
    this.setRunStatus(run, "active");

    for (const task of tasks) this.engine.enqueue(task);

    void this.events.emit({
      eventId: randomUUID(),
      runId,
      roundId: round.roundId,
      type: "round_created",
      payload: { taskOrder: topo.order },
      occurredAt: now,
      source: "orchestrator",
    });
    return round;
  }

  /**
   * Pure terminal-fact check: does every task belonging to this round sit in a Task
   * terminal state? Reads the TaskEngine read-only surface only — no side effects.
   *
   * Membership is taken from the round's own `taskIds` (the DAG topo order), NOT from
   * `task.roundId`: the latter is filled in by the caller when constructing tasks, and the
   * existing call sites pass a placeholder value, so it is not authoritative. A task that
   * is not registered in the engine (stage ① "do not enqueue a not-ready task", C7-B rev4
   * §5.1 L-3) therefore counts as NOT terminal and blocks settlement.
   *
   * NOTE (round-lifecycle-contract rev1 §4): an empty task set satisfies `every`, so a
   * round with `taskIds = []` counts as settled. This slice deliberately does NOT
   * introduce an "a round must have at least one task" rule.
   */
  allRoundTasksTerminal(roundId: string): boolean {
    const round = this.mustGetRound(roundId);
    const byId = new Map(this.engine.list().map((task) => [task.taskId, task]));
    return round.taskIds.every((taskId) => {
      const task = byId.get(taskId);
      return task !== undefined && isTaskTerminal(task.status);
    });
  }

  /**
   * Orchestrator lifecycle operation (NOT a pure predicate — it writes `round.status`):
   *   running --(all round tasks terminal)--> review
   *
   * Only valid from `running`; any other status is returned unchanged, so a round is
   * never settled twice. Creates no TaskAttempt, mutates no task, and does not touch
   * TaskEngine lifecycle.
   */
  settleRound(roundId: string): ResearchRound {
    const round = this.mustGetRound(roundId);
    if (round.status !== "running") return round;
    if (!this.allRoundTasksTerminal(roundId)) return round;
    return this.setRoundStatus(round, "review");
  }

  /**
   * Round lifecycle closure. The only legal transitions are:
   *   review -> completed | rejected
   *
   * Everything else throws: `running -> completed|rejected`, `review -> review`, and any
   * transition out of a terminal round (terminal is irreversible).
   *
   * `completed` additionally requires every round task to be terminal — a state
   * invariant, not merely a caller assumption.
   *
   * `rejected` never reopens a task: this method never touches task state.
   */
  finishRound(roundId: string, status: ResearchRoundStatus, rejectionReason?: string): ResearchRound {
    const round = this.mustGetRound(roundId);
    if (round.status !== "review") {
      throw new Error(
        `cannot finish round ${roundId} from status "${round.status}" (only "review" may close)`,
      );
    }
    if (status !== "completed" && status !== "rejected") {
      throw new Error(
        `cannot finish round ${roundId} as "${status}" (only "completed" | "rejected")`,
      );
    }
    if (status === "completed" && !this.allRoundTasksTerminal(roundId)) {
      throw new Error(`cannot complete round ${roundId}: not every round task is terminal`);
    }
    const updated: ResearchRound = {
      ...round,
      status,
      rejectionReason: status === "rejected" ? rejectionReason : undefined,
      updatedAt: new Date().toISOString(),
    };
    this.rounds.set(roundId, updated);
    return updated;
  }

  private setRoundStatus(round: ResearchRound, status: ResearchRoundStatus): ResearchRound {
    const updated: ResearchRound = { ...round, status, updatedAt: new Date().toISOString() };
    this.rounds.set(round.roundId, updated);
    return updated;
  }

  finishRun(runId: string, status: ResearchRunStatus): ResearchRun {
    const run = this.mustGetRun(runId);
    const updated: ResearchRun = { ...run, status, updatedAt: new Date().toISOString() };
    this.runs.set(runId, updated);
    return updated;
  }

  getRun(runId: string): ResearchRun | undefined {
    return this.runs.get(runId);
  }

  getRound(roundId: string): ResearchRound | undefined {
    return this.rounds.get(roundId);
  }

  private setRunStatus(run: ResearchRun, status: ResearchRunStatus): void {
    this.runs.set(run.runId, { ...run, status, updatedAt: new Date().toISOString() });
  }

  private mustGetRun(runId: string): ResearchRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    return run;
  }

  private mustGetRound(roundId: string): ResearchRound {
    const round = this.rounds.get(roundId);
    if (!round) throw new Error(`unknown round ${roundId}`);
    return round;
  }
}
