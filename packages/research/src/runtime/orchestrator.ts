/**
 * Orchestrator skeleton -Run/Round lifecycle. Creates runs, starts rounds,
 * validates the round DAG, emits durable events. No LLM planning in Phase 1.
 */

import { randomUUID } from "node:crypto";
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

  finishRound(roundId: string, status: ResearchRoundStatus, rejectionReason?: string): ResearchRound {
    const round = this.mustGetRound(roundId);
    const updated: ResearchRound = {
      ...round,
      status,
      rejectionReason,
      updatedAt: new Date().toISOString(),
    };
    this.rounds.set(roundId, updated);
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
