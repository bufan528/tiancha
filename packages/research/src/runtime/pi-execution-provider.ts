/**
 * AF-1C · Pi Execution Provider（research 侧 · ExecutionProviderPort 的实现）。
 *
 * 依据：AF-1C Implementation Contract（docs/phaseC/af1c-implementation-contract.md · 🔒 FROZEN）
 *   · IC-3-1  落点 = packages/research/src/runtime/（runtime 内部 seam）
 *             ❌ 不进入 providers/（C6 RMA 命名空间）· ❌ 不加入 runtime/index.ts
 *             ❌ 不得 import 任何 Pi 类型（EP-15）
 *   · IC-4-1  实现 ExecutionProviderPort
 *   · IC-4-2  构造输入最小 = { registry }；❌ 不接收 source / factory / taskEngine / modelRouter
 *   · IC-4-3  执行流程唯一形态：① lookup → ② prompt → ③ 读 messages → ④ return
 *   · IC-4-3.1 messages → text 的确定性投影规则（本契约裁定 · 唯一允许的实现）
 *   · IC-4-4  绝对禁止：register/remove / new SessionRegistry / lifecycle /
 *             读 session.model·thinkingLevel / ModelRouter.resolve / TaskEngine private /
 *             写 Task·Round·Run 状态 / artifactize / 调度 / 重试 / 从非 request 来源推导 prompt
 *   · IC-8-1/8-2 诊断 kind：session_lookup_miss / prompt_failed
 *   · IC-8-3  ExecutionError.kind 仍为 optional string；两个值【不构成】全系统 exhaustive enum
 *   · IC-INV-1 本文件不出现任何 Pi 类型
 *   · IC-INV-5 Provider 对 Registry 只读（只 lookup）
 */

import type { SessionRegistry } from "./session-registry.js";
import type {
  ExecutionHandle,
  ExecutionOutcome,
  ExecutionOutput,
  ExecutionProviderPort,
  ExecutionRequest,
} from "../ports/execution-provider.port.js";

/** AF-1C §8 IC-8-1 —— Provider 侧诊断分类（非 outcome 判别字段·非 exhaustive enum）。 */
const KIND_SESSION_LOOKUP_MISS = "session_lookup_miss";
const KIND_PROMPT_FAILED = "prompt_failed";

export class PiExecutionProvider implements ExecutionProviderPort {
  /**
   * IC-4-2：只接收 registry（最小依赖；由 composition root 注入同一实例 · IC-7-1.1）。
   * IC-9-5：本类只允许使用 registry.lookup(...)。
   */
  constructor(private readonly registry: SessionRegistry) {}

  async execute(handle: ExecutionHandle, request: ExecutionRequest): Promise<ExecutionOutcome> {
    // ① lookup —— miss ⇒ 显式失败（IC-4-3 / IC-8-2）；此时不得读 messages、不得产 output（AI-9-3）
    const capability = this.registry.lookup(handle.sessionId);
    if (capability === undefined) {
      return {
        status: "failed",
        error: {
          message: `execution session not found for sessionId=${handle.sessionId}`,
          kind: KIND_SESSION_LOOKUP_MISS,
        },
      };
    }

    // ② prompt —— resolve ≡ execution settled（IC-13-3）；throw ⇒ 显式失败（IC-8-2）
    try {
      await capability.prompt(request.prompt);
    } catch (err) {
      return {
        status: "failed",
        error: {
          message: err instanceof Error ? err.message : String(err),
          kind: KIND_PROMPT_FAILED,
        },
      };
    }

    // ③ 读 messages（原样透传）+ 确定性投影出 text（IC-4-3.1）
    const messages = capability.messages;
    const text = projectText(messages);

    // ④ return —— 顶层判别字段唯一为 status；text 无 assistant 时【省略】
    const output: ExecutionOutput = { messages };
    if (text !== undefined) output.text = text;
    return { status: "succeeded", output };
  }
}

/**
 * IC-4-3.1 —— messages → text 的确定性投影（唯一允许的实现）。
 *
 *   从后向前找【最后一条】role === "assistant" 的 message，返回其 content 的投影；
 *   若不存在 assistant message ⇒ 返回 undefined（调用方据此【省略】text 字段）。
 *
 * ❌ 不得 JSON.stringify · ❌ 不得拼接全部 message · ❌ 不得取非 assistant message
 * ❌ 不得引入任何 Pi 类型或消息类型声明（按结构化假设读取 role / content）
 */
function projectText(messages: unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown } | null | undefined;
    if (m?.role !== "assistant") continue; // 只认 assistant
    return projectContent(m.content);
  }
  return undefined; // 无 assistant message ⇒ 省略 text
}

/**
 * IC-4-3.1 —— content 的投影：
 *   · string        ⇒ 原样返回
 *   · 数组          ⇒ 按【数组顺序】取所有 { type: "text", text: string } 块的 text，
 *                     以 "\n" 连接；其余元素【跳过】（不产片段、不报错、不占位）
 *   · 其它形状      ⇒ 返回 ""（不得编造、不得 JSON.stringify）
 */
function projectContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const element of content) {
      const block = element as { type?: unknown; text?: unknown } | null | undefined;
      // type 严格等于 "text" 且 text 为 string 才算 text block；其余跳过
      if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
    }
    return parts.join("\n");
  }
  return "";
}
