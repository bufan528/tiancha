/**
 * TaskAttempt -FROZEN CONTRACT (lock (4). A task is immutable; retries/resume
 * append a new attempt. Outputs are ArtifactRefs only.
 */

import type { ArtifactRef } from "./artifact.js";
import type { ThinkingLevel } from "./research-context.js";

export type TaskAttemptStatus = "running" | "succeeded" | "failed" | "aborted";

export interface ToolCallRecord {
  toolName: string;
  callId: string;
  status: "ok" | "error" | "aborted";
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface TaskAttempt {
  attemptId: string;
  taskId: string;
  startedAt: string;
  endedAt?: string;
  /** Concrete model id actually used (resolved from ModelPolicy). */
  model: string;
  thinkingLevel: ThinkingLevel;
  toolCalls: ToolCallRecord[];
  tokenUsage: TokenUsage;
  cost: number;
  status: TaskAttemptStatus;
  error?: string;
  /** Output references -ArtifactRefs only. Never inline payloads. */
  outputs: ArtifactRef[];
}
