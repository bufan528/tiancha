/**
 * HumanGate primitive -resumeToken safe handling.
 *  - 鈮?56 bit high-entropy random token
 *  - only SHA-256 hash is persisted; plaintext returned once at creation
 *  - expiresAt + scope(projectId/runId/gateId) binding
 *  - single-use (consumed on success)
 *
 * This file holds behavior; the entity contract is domain/human-gate.ts.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type {
  HumanGate,
  HumanGateDecision,
  HumanGateScope,
} from "../domain/index.js";

export interface CreatedHumanGate {
  gate: HumanGate;
  /** Plaintext resume token -returned ONCE, never persisted. */
  resumeToken: string;
}

export function hashResumeToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Generate a 鈮?56-bit high-entropy resume token (base64url). */
export function generateResumeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createHumanGate(params: {
  gateId: string;
  taskId: string;
  type: HumanGate["type"];
  scope: HumanGateScope;
  ttlMs: number;
  now?: Date;
}): CreatedHumanGate {
  const now = params.now ?? new Date();
  const resumeToken = generateResumeToken();
  const gate: HumanGate = {
    gateId: params.gateId,
    taskId: params.taskId,
    type: params.type,
    status: "pending",
    requestedAt: now.toISOString(),
    resumeTokenHash: hashResumeToken(resumeToken),
    resumeTokenScope: params.scope,
    resumeTokenExpiresAt: new Date(now.getTime() + params.ttlMs).toISOString(),
    resumeTokenConsumed: false,
  };
  return { gate, resumeToken };
}

export function decideHumanGate(
  gate: HumanGate,
  decision: HumanGateDecision,
  operator: string,
  comment?: string,
  now?: Date,
): HumanGate {
  const nowTs = (now ?? new Date()).toISOString();
  if (gate.status !== "pending") {
    throw new Error(`HumanGate ${gate.gateId} is not pending (status=${gate.status})`);
  }
  return {
    ...gate,
    status: decision,
    decision,
    operator,
    comment,
    decidedAt: nowTs,
  };
}

export interface ConsumeResult {
  ok: boolean;
  reason?: "consumed" | "expired" | "bad_scope" | "mismatch";
  gate?: HumanGate;
}

/**
 * Validate + single-use consume a resume token. Marks the gate consumed so the
 * token cannot be replayed. Timing-safe comparison of hashes.
 */
export function consumeResumeToken(
  gate: HumanGate,
  plaintextToken: string,
  expectedScope: HumanGateScope,
  now?: Date,
): ConsumeResult {
  const nowTs = now ?? new Date();
  if (gate.resumeTokenConsumed) return { ok: false, reason: "consumed" };
  if (!gate.resumeTokenHash || !gate.resumeTokenExpiresAt || !gate.resumeTokenScope) {
    return { ok: false, reason: "mismatch" };
  }
  if (nowTs.toISOString() > gate.resumeTokenExpiresAt) {
    return { ok: false, reason: "expired" };
  }
  const scope = gate.resumeTokenScope;
  if (
    scope.projectId !== expectedScope.projectId ||
    scope.runId !== expectedScope.runId ||
    scope.gateId !== expectedScope.gateId
  ) {
    return { ok: false, reason: "bad_scope" };
  }
  const candidate = Buffer.from(hashResumeToken(plaintextToken));
  const stored = Buffer.from(gate.resumeTokenHash);
  if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, gate: { ...gate, resumeTokenConsumed: true } };
}
