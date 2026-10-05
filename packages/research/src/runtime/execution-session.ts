/**
 * AF-1B-I · minimal execution-session capability seam.
 *
 * This is the ONLY capability the session lookup seam exposes. It exists solely
 * to type the value a `SessionRegistry` stores — it is deliberately NOT a
 * product-level Port: there is still **no `ports/` entry** for it, and no new
 * Port interface was introduced for it.
 *
 * 可达性（AF-1C · 实现轮更正）：自 AF-1C Implementation Slice 起，本模块经
 * `runtime/index.ts` 的 `export *` 对包外可达，用途有二：
 *   · composition root（src/cli）取得【同一个】`SessionRegistry` 实例；
 *   · src/ 侧的 `PiSessionCapabilityAdapter` 实现本类型。
 * ★ 这仍【不是】把它升级为 product-level Port —— 它的能力面未变（下方冻结边界为准），
 *   也未新增任何 Port interface；仅由「runtime 内部 seam」变为「包边界可达」。
 *   （此前注释写的 "no barrel export / no index export" 已随该变更过时，故更正。）
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
