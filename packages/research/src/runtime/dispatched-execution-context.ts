/**
 * AF-4 · DispatchedExecutionContext — execution dispatch 的【数据边界】。
 *
 * 依据：AF-4 Implementation Contract（docs/phaseC/execution-coordinator-implementation-contract.md
 *       · 🔒 FROZEN rev2 + Amendment 1 + Amendment 2 + Amendment 3）
 *   · §4.1 A-2a 窄化输入结构：AF-4 只消费这个，不消费完整 `TaskEngine.start()` 返回对象
 *   · §4.1 A-2b entry 语义：`executeDispatchedExecution(context: DispatchedExecutionContext)`
 *   · §4.1 A-2c 来源责任：`start()` 的返回值由 future integration caller 持有并投影为本结构
 *   · Amendment 3 D-7（★ APPROVED — FINAL · 方案 B）：
 *       落点 = 本文件（独立数据边界文件，而非定义在 execution-coordinator.ts 内）
 *       理由 = 数据契约不应与执行实现绑定；未来 caller 构造该上下文时不应被迫 import
 *              Coordinator implementation（Coordinator ≠ caller）
 *
 * 语义（必须逐条保持）：
 *   · data-only execution boundary（Coordinator 的【输入数据边界】）
 *   · 恰有 3 个字段：taskId · attemptId · sessionId
 *   · ❌ 不是 Port · ❌ 不是 Service · ❌ 不是 Registry · ❌ 不是 Adapter
 *   · ❌ 不得创建 `DispatchedExecutionContextPort` / `ExecutionCoordinatorPort` /
 *     `ExecutionDispatchPort`（Amendment 3 硬约束）
 *   · ★ `runtime/index.ts` MUST NOT export it in this Slice
 *     （当前无正式 caller integration boundary，不提前扩大 research runtime public surface；
 *       未来 O-AC-6 若需要公共出口，再单独决定）
 *   · Constraint: No additional execution boundary may be introduced.
 *
 * ❌ 不得增加字段：runId / roundId / prompt / context / model / provider 等
 *   ⇒ 这些属 Request assembly（见 §4.2 / §4.3），不属于 dispatch boundary。
 *
 * 本文件不 import 任何 Pi 类型，也不依赖任何实现（EP-15 / IP-3）。
 */

export interface DispatchedExecutionContext {
  taskId: string;
  attemptId: string;
  sessionId: string;
}
