/**
 * AF-4 · ExecutionCoordinator —— 单 Task execution coordination（薄协调器）。
 *
 * 依据：AF-4 Implementation Contract
 *       （docs/phaseC/execution-coordinator-implementation-contract.md
 *        · 🔒 FROZEN rev2 + Amendment 1 + Amendment 2 + Amendment 3 + Amendment 4）
 *
 * ★ 唯一入口（§4.1 A-2b ★Amendment 4）：
 *      executeDispatchedExecution(context: DispatchedExecutionContext, prompt: string): Promise<void>
 *   · `prompt` 是【第二个显式参数】= upstream execution caller 提供的 execution input
 *   · Prompt Source Rule：accept → pass through unchanged → assign to `ExecutionRequest.prompt`
 *     ❌ 不 generate / infer / rewrite / replace；❌ 不从 Task / TaskInputs / taskId / runId /
 *        roundId / objective / ResearchContext 推导；❌ 不使用 fixed/default 文本
 *
 * ★ 成功路径（§8.1 E，顺序不可反）：
 *      get task → assemble ExecutionRequest → await provider.execute(handle, request)（至多一次）
 *        → succeeded → put【恰好 1 个】execution artifact → 得 ArtifactRef
 *        → TaskEngine.complete(taskId, [artifactRef])
 *      · put 失败 ⇒ TaskEngine.fail(taskId, reason)，reason 标记为 artifact persistence failure
 *        （F-6 / J-4；【不是】Provider failure）
 *
 * ★ 失败路径：provider threw / returned failed ⇒ TaskEngine.fail(taskId, error) ⇒ 【0 artifact】
 *
 * ★ 明确禁止（§6.2 / §12 / §13）：
 *   ❌ 不持有 sessionId → session 映射（不碰 SessionRegistry / ExecutionSession / concrete Pi session）
 *   ❌ 不拥有 dispatch / 不重新 start / 不创建 session / 不猜 sessionId
 *   ❌ 不调 stepRound / startRound / 不推进 Round / 不寻找 ready Task / 无循环 / 无 scheduler
 *   ❌ 不 retry / 不 fallback / 不 concurrency / 不 queue / 不 timeout 实现
 *   ❌ 不重新 resolve model（model / thinkingLevel 一律取自 attempt）
 *   ❌ 不创建 TaskAttempt / 不直接写 Task·TaskAttempt·Round·Run status（settlement 只经 complete/fail）
 *   ❌ 不构造 / 不推断 / 不合成 ResearchContext（R-EC-10）；upstream 未提供 ⇒ context 保持 undefined
 *   ❌ 不引入 artifact dedupe / identity registry / schema registry
 *
 * ★ 实现期细节（已登记，不构成新机制）：
 *   · artifactId 由本 Coordinator 生成：`art-${randomUUID()}`（既有 smoke 的等价做法）
 *   · createdAt 由本 Coordinator 生成：ISO 时间戳
 */

import { randomUUID } from "node:crypto";

import type { ArtifactRef, ResearchArtifact } from "../domain/artifact.js";
import type { ExecutionProviderPort, ExecutionHandle, ExecutionRequest } from "../ports/execution-provider.port.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import type { DispatchedExecutionContext } from "./dispatched-execution-context.js";
import type { TaskEngine } from "./task-engine.js";

/** AF-4 §7.1 D-1 / A-8：execution artifact 的中性 kind（常量，不由调用方传入）。 */
const ARTIFACT_KIND_EXECUTION = "execution" as const;

/** AF-4 Amendment 2 A4：execution artifact 的 schemaVersion（常量，本 Slice 不建 registry）。 */
const ARTIFACT_SCHEMA_VERSION = "1";

/** AF-4 §7 的 locator 类型（与 ArtifactStore 既有实现一致）。 */
const ARTIFACT_LOCATOR_TYPE = "sqlite:research_artifact";

export interface ExecutionCoordinatorDeps {
  /** AF-1 的 execution provider seam（唯一被调用的执行入口）。 */
  provider: ExecutionProviderPort;
  /** Task / TaskAttempt 生命周期的唯一 owner（settlement 只经其 complete / fail）。 */
  taskEngine: TaskEngine;
  /** execution artifact 的持久化入口（既有 API）。 */
  artifactStore: ArtifactStore;
}

export class ExecutionCoordinator {
  constructor(private readonly deps: ExecutionCoordinatorDeps) {}

  /** AF-4 §4.1 A-2b ★Amendment 4 —— 单 Execution 的唯一入口（不循环、不 dispatch）。 */
  async executeDispatchedExecution(
    context: DispatchedExecutionContext,
    prompt: string,
  ): Promise<void> {
    // ① 读取 execution facts（§4.3 A-4 / A-7 / A-9：唯一来源，不二次猜测）
    const task = this.deps.taskEngine.get(context.taskId);
    if (task === undefined) {
      this.deps.taskEngine.fail(context.taskId, `task ${context.taskId} not found`);
      return;
    }
    const attempt = this.deps.taskEngine
      .listAttempts(context.taskId)
      .find((candidate) => candidate.attemptId === context.attemptId);
    if (attempt === undefined) {
      this.deps.taskEngine.fail(context.taskId, `attempt ${context.attemptId} not found for task ${context.taskId}`);
      return;
    }

    // ② 组装 handle（§4.3 A-5：opaque sessionId）与 request（§4.2；prompt 原样透传）
    const handle: ExecutionHandle = { sessionId: context.sessionId };
    const request: ExecutionRequest = {
      taskId: task.taskId,
      runId: task.runId,
      roundId: task.roundId,
      model: attempt.model,
      thinkingLevel: attempt.thinkingLevel,
      prompt,
      // ★ R-EC-10：context 不由本 Coordinator 构造 / 推断 / 合成 —— upstream 未提供即【不设置】
    };

    // ③ 调用 provider：【至多一次】（§5 B-2）；provider 抛错 = execution failure（§6.2 / F-5）
    let outcome;
    try {
      outcome = await this.deps.provider.execute(handle, request);
    } catch (error) {
      this.deps.taskEngine.fail(context.taskId, error instanceof Error ? error.message : String(error));
      return;
    }

    // ④ 失败路径：failed ⇒ fail() ⇒ 【0 artifact】（§8.1 E / D-9 / D-10）
    if (outcome.status === "failed") {
      this.deps.taskEngine.fail(context.taskId, outcome.error.message);
      return;
    }

    // ⑤ 成功路径：先 put【恰好 1 个】execution artifact，得 ArtifactRef，再 complete()（顺序不可反）
    const artifactId = `art-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const ref: ArtifactRef = {
      artifactId,
      kind: ARTIFACT_KIND_EXECUTION,
      locator: { type: ARTIFACT_LOCATOR_TYPE, id: artifactId },
    };
    const artifact: ResearchArtifact = {
      artifactId,
      kind: ARTIFACT_KIND_EXECUTION,
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      ref,
      createdAt,
      taskId: task.taskId,
      attemptId: attempt.attemptId,
      runId: task.runId,
      roundId: task.roundId,
    };

    let persisted: ArtifactRef;
    try {
      persisted = await this.deps.artifactStore.put({ artifact, blob: outcome.output });
    } catch (error) {
      // F-6 / J-4：artifact 未落盘 ⇒【不得】调 complete()（无 ArtifactRef 可传），改调 fail()，
      //          reason 必须标记为 artifact persistence failure（【不是】Provider failure）
      const detail = error instanceof Error ? error.message : String(error);
      this.deps.taskEngine.fail(context.taskId, `artifact persistence failure: ${detail}`);
      return;
    }
    this.deps.taskEngine.complete(context.taskId, [persisted]);
  }
}
