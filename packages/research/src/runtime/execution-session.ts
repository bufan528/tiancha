/**
 * AF-1B-I · minimal execution-session capability seam.
 *
 * This is the ONLY capability the session lookup seam exposes. It exists solely
 * to type the value a `SessionRegistry` stores — it is deliberately NOT a
 * product-level Port (no `ports/` entry, no barrel export, no index export).
 *
 * Frozen capability boundary (execution-session-lookup-seam-implementation-contract.md):
 *   ✅ execute prompt(text)
 *   ✅ read messages
 *   ✅ prompt() resolve ≡ execution settled   (a property of the implementation,
 *                                             not an additional member)
 *   ❌ abort / dispose / close / waitForIdle  → G-05 lifecycle
 *   ❌ model / thinkingLevel                  → would be a second truth source
 *   ❌ state / raw / subscribe                → no consumer
 *
 * Nothing here may import Pi types; `messages` stays structurally opaque
 * (`unknown[]`) exactly like `ExecutionOutput.messages` in AF-1A.
 */
export interface ExecutionSessionCapability {
  /**
   * Run one prompt against the concrete execution session.
   * Resolving implies the execution has settled (no extra settlement call).
   */
  prompt(text: string): Promise<void>;

  /** Messages produced by the execution (provider-neutral, structurally opaque). */
  readonly messages: unknown[];
}
