/**
 * AF-1B-I · session lookup registry (ownership seam).
 *
 * Maps an opaque `sessionId` to an execution-session capability. It is ONLY a
 * mapping:
 *   · NOT a lifecycle owner   (remove ≠ close ≠ dispose ≠ abort ≠ finishSession)
 *   · NOT a model resolver    (never calls ModelRouter, never reads session.model)
 *   · NOT the TaskEngine      (never touches TaskEngine private state)
 *   · NOT the Orchestrator
 *   · NOT the execution provider
 *
 * Production integration is deliberately NOT wired here:
 *   · writer (who calls register) → G-04 future integration caller   🟡 DEFERRED
 *   · reader (who calls lookup)   → AF-1C PiExecutionProvider        🟡 DEFERRED
 *   · Factory / CLI capability    → R-2B                             🟡 DEFERRED
 *
 * Semantics (frozen):
 *   register  — duplicate sessionId ⇒ explicit failure, never a silent overwrite
 *   lookup    — hit ⇒ the very same registered instance; miss ⇒ undefined
 *   remove    — mapping-only; missing key ⇒ idempotent no-op
 */
import type { ExecutionSessionCapability } from "./execution-session.js";

export class SessionRegistry {
  private readonly bySessionId = new Map<string, ExecutionSessionCapability>();

  /**
   * Register an execution session under an opaque `sessionId`.
   * @throws if `sessionId` is already registered (ownership conflict).
   */
  register(sessionId: string, session: ExecutionSessionCapability): void {
    if (this.bySessionId.has(sessionId)) {
      throw new Error(`session ${sessionId} already registered`);
    }
    this.bySessionId.set(sessionId, session);
  }

  /** Resolve `sessionId` to the registered instance, or `undefined` on miss. */
  lookup(sessionId: string): ExecutionSessionCapability | undefined {
    return this.bySessionId.get(sessionId);
  }

  /** Remove the mapping only. Idempotent: a missing key is a no-op. */
  remove(sessionId: string): void {
    this.bySessionId.delete(sessionId);
  }
}
