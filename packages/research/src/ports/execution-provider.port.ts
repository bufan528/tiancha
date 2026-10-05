/**
 * AF-1 · Execution Provider Port — research-facing, Pi-neutral.
 *
 * ★ 这 6 个类型由 `docs/phaseC/execution-provider-contract.md` §18.2（AF-1 rev2 ·
 *   FROZEN @c3fb4d6）冻结；本文件只把它们落成 TypeScript，**不引入任何运行时行为**
 *   （AF-1A 范围）。
 *
 * 依赖方向（EP-15 / IP-3）：本文件属 research 层，**永不** import 任何 coding-agent
 * 运行时包，也不得出现任何其专有类型（详见 §V-4 静态边界断言）。
 *
 * Ownership（AF-4 Impl Contract D-1 / D-4）：**AF-1 创建并拥有本文件**；
 * AF-4 仅 import / consume，并在 `ports/index.ts` re-export —— 不得 create / recreate /
 * redefine / duplicate / modify。
 */

import type { ResearchContext } from "../domain/research-context.js";

/**
 * AF-1 rev2 §18.2 — opaque execution identity.
 *
 * 这是**身份**（identity），不是能力对象（capability object）：只携带 `sessionId`，
 * 不得暴露 concrete Pi session / prompt / abort / dispose / services 等能力。
 */
export interface ExecutionHandle {
  sessionId: string;
}

/**
 * AF-1 rev2 §18.2 — execution input（shape 冻结（含 Amendment 1：+ prompt）：
 * 字段名 / 类型 / 可选性逐字一致）。
 *
 * 来源规则（AF-4 Impl Contract A-9 · 事实来源唯一性）：本类型由图层的合法来源装配，
 * 不由本文件推导。
 */
export interface ExecutionRequest {
  taskId: string;
  runId: string;
  roundId?: string;
  model: string;
  thinkingLevel: string;
  context?: ResearchContext;
  prompt: string;
}

/**
 * AF-1 rev2 §18.2 — provider-owned、research-neutral 的输出载体。
 *
 * `messages` / `raw` 保持 `unknown` 系：**不是**允许 provider 专有类型借此穿透
 * （`messages` 不得声明为该 provider 的具体 message 类型，也不得通过别名间接泄漏）。
 */
export interface ExecutionOutput {
  text?: string;
  messages?: unknown[];
  raw?: unknown;
}

/**
 * AF-1 rev2 §18.2 — 诊断分类（diagnostic classification）。
 *
 * `kind` **不是** outcome 判别字段，也不是 Task / TaskAttempt lifecycle state。
 */
export interface ExecutionError {
  message: string;
  kind?: string;
}

/**
 * AF-1 rev2 §18.2 — execution outcome。
 *
 * 判别字段唯一为 `status`，取值集合唯一为 `{ "succeeded", "failed" }`；
 * 不得引入第二套分类字段。
 *
 * ★ 分层不变量：`ExecutionOutcome.status` 与 `TaskAttemptStatus` 是**不同语义层**，
 * 不得因取值同名（如 "succeeded"/"failed"）而互相推断 —— settlement 一律经既有
 * `TaskEngine.complete()` / `fail()` API。
 */
export type ExecutionOutcome =
  | {
      status: "succeeded";
      output: ExecutionOutput;
    }
  | {
      status: "failed";
      error: ExecutionError;
    };

/**
 * AF-1 rev2 §18.2 — the execution provider seam.
 *
 * **AF-1 实现本端口；AF-4 消费本端口。**
 * Provider 不写 Task / Round / Run 状态、不做 artifactization、不调度、不重试
 * （AF-1 EP-6 / EP-7 / EP-10）。
 */
export interface ExecutionProviderPort {
  execute(handle: ExecutionHandle, request: ExecutionRequest): Promise<ExecutionOutcome>;
}
