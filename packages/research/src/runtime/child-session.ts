/**
 * ChildSession wrapper type + lifecycle helpers. The real Pi AgentSession is
 * created by the composition root's AgentSessionFactoryPort implementation; this
 * file only defines the minimal lifecycle contract research consumes.
 */

import type { AgentRole, ModelPolicy } from "../domain/index.js";
import type {
  ChildSession,
  ChildSessionOptions,
} from "../ports/agent-session-factory.port.js";

export type { ChildSession, ChildSessionOptions };

/** Build the canonical ChildSessionOptions for a task. */
export function buildChildSessionOptions(params: {
  cwd: string;
  taskId: string;
  runId: string;
  roundId?: string;
  role: AgentRole;
  modelPolicy: ModelPolicy;
  noTools?: boolean;
  resourceLoaderOptions?: Record<string, unknown>;
}): ChildSessionOptions {
  return {
    cwd: params.cwd,
    taskId: params.taskId,
    runId: params.runId,
    roundId: params.roundId,
    role: params.role,
    modelPolicy: params.modelPolicy,
    noTools: params.noTools ?? true,
    resourceLoaderOptions: params.resourceLoaderOptions,
  };
}

/** A safe no-op child session used when LLM is disabled (Phase 1 smoke). */
export function noopChildSession(taskId: string): ChildSession {
  return {
    sessionId: `noop-${taskId}`,
    taskId,
    async close() {
      /* noop */
    },
  };
}
