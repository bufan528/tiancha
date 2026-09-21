/**
 * TaskEngine skeleton -enqueue/start/complete/fail task; append TaskAttempt.
 * No LLM reasoning here. A task needing LLM goes through
 * AgentSessionFactoryPort ->standard child session (lock (4).
 */

import { randomUUID } from "node:crypto";
import type {
  ResearchTask,
  TaskAttempt,
  TaskAttemptStatus,
  TaskStatus,
  ArtifactRef,
} from "../domain/index.js";
import { isTaskTerminal } from "../domain/index.js";
import type { AgentSessionFactoryPort, ChildSession } from "../ports/agent-session-factory.port.js";
import type { ModelRouter } from "./model-router.js";
import type { ResearchEventAdapter } from "./research-event-adapter.js";

export interface TaskEngineDeps {
  cwd: string;
  factory: AgentSessionFactoryPort;
  modelRouter: ModelRouter;
  events: ResearchEventAdapter;
}

export class TaskEngine {
  private readonly tasks = new Map<string, ResearchTask>();
  private readonly attempts = new Map<string, TaskAttempt>();
  private readonly openSessions = new Map<string, ChildSession>();

  constructor(private readonly deps: TaskEngineDeps) {}

  enqueue(task: ResearchTask): void {
    if (this.tasks.has(task.taskId)) {
      throw new Error(`task ${task.taskId} already enqueued`);
    }
    this.tasks.set(task.taskId, task);
  }

  get(taskId: string): ResearchTask | undefined {
    return this.tasks.get(taskId);
  }

  list(): ResearchTask[] {
    return [...this.tasks.values()];
  }

  /**
   * Start a task: flip to running, open a child session via the factory, and
   * record a running TaskAttempt. No LLM prompt is run in Phase 1.
   */
  async start(taskId: string): Promise<{ task: ResearchTask; attempt: TaskAttempt; session: ChildSession }> {
    const task = this.mustGet(taskId);
    this.setStatus(task, "running");

    const resolved = await this.deps.modelRouter.resolve(task.agentRole, task.modelPolicy);
    const attempt: TaskAttempt = {
      attemptId: randomUUID(),
      taskId,
      startedAt: new Date().toISOString(),
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel as TaskAttempt["thinkingLevel"],
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      cost: 0,
      status: "running",
      outputs: [],
    };
    this.attempts.set(attempt.attemptId, attempt);
    this.set(task, { activeAttemptId: attempt.attemptId });

    const session = await this.deps.factory.create({
      cwd: this.deps.cwd,
      taskId,
      runId: task.runId,
      roundId: task.roundId,
      role: task.agentRole,
      modelPolicy: task.modelPolicy,
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel,
      noTools: true,
    });
    this.openSessions.set(taskId, session);

    await this.deps.events.emit({
      eventId: randomUUID(),
      runId: task.runId,
      roundId: task.roundId,
      taskId,
      type: "task_attempt_started",
      payload: { attemptId: attempt.attemptId, model: resolved.model },
      occurredAt: new Date().toISOString(),
      source: "task-engine",
    });

    return { task, attempt, session };
  }

  complete(taskId: string, outputs: ArtifactRef[]): TaskAttempt {
    const task = this.mustGet(taskId);
    const attempt = this.currentAttempt(task);
    attempt.status = "succeeded";
    attempt.endedAt = new Date().toISOString();
    attempt.outputs = outputs;
    this.set(task, { outputs: [...task.outputs, ...outputs.map((o) => o.artifactId)] });
    this.setStatus(task, "completed");
    void this.finishSession(taskId);
    void this.emitFinished(task, attempt, "succeeded");
    return attempt;
  }

  fail(taskId: string, error: string, status: TaskAttemptStatus = "failed"): TaskAttempt {
    const task = this.mustGet(taskId);
    const attempt = this.currentAttempt(task);
    attempt.status = status;
    attempt.endedAt = new Date().toISOString();
    attempt.error = error;
    this.setStatus(task, "failed");
    void this.finishSession(taskId);
    void this.emitFinished(task, attempt, status);
    return attempt;
  }

  listAttempts(taskId: string): TaskAttempt[] {
    return [...this.attempts.values()].filter((a) => a.taskId === taskId);
  }

  private mustGet(taskId: string): ResearchTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`unknown task ${taskId}`);
    return task;
  }

  private currentAttempt(task: ResearchTask): TaskAttempt {
    if (!task.activeAttemptId) throw new Error(`task ${task.taskId} has no active attempt`);
    const attempt = this.attempts.get(task.activeAttemptId);
    if (!attempt) throw new Error(`missing attempt ${task.activeAttemptId}`);
    return attempt;
  }

  private setStatus(task: ResearchTask, status: TaskStatus): void {
    if (isTaskTerminal(task.status) && task.status !== status) {
      throw new Error(`cannot transition terminal task ${task.taskId} (${task.status})`);
    }
    this.set(task, { status, updatedAt: new Date().toISOString() });
  }

  private set(task: ResearchTask, patch: Partial<ResearchTask>): void {
    this.tasks.set(task.taskId, { ...task, ...patch });
  }

  private async finishSession(taskId: string): Promise<void> {
    const session = this.openSessions.get(taskId);
    if (session) {
      await session.close();
      this.openSessions.delete(taskId);
    }
  }

  private async emitFinished(
    task: ResearchTask,
    attempt: TaskAttempt,
    status: TaskAttemptStatus,
  ): Promise<void> {
    await this.deps.events.emit({
      eventId: randomUUID(),
      runId: task.runId,
      roundId: task.roundId,
      taskId: task.taskId,
      type: "task_attempt_finished",
      payload: { attemptId: attempt.attemptId, status, error: attempt.error ?? null },
      occurredAt: new Date().toISOString(),
      source: "task-engine",
    });
  }
}
