/**
 * AF-1C · Pi → ExecutionSessionCapability adapter（G-04 composition boundary · src/ 侧）。
 *
 * 这是 Pi 接触层里【唯一】把真实 Pi `AgentSession` 收窄为 research 侧 capability 的地方。
 * 它存在的理由就是 `packages/research` 永不 import Pi。
 *
 * ★ 职责（唯一）：类型/视图收窄
 *      Pi AgentSession  ──►  ExecutionSessionCapability { prompt(text): Promise<void>; readonly messages: unknown[] }
 *
 * 依据：AF-1C Implementation Contract（docs/phaseC/af1c-implementation-contract.md · 🔒 FROZEN）
 *   · IC-5-1  唯一职责 = Pi AgentSession → ExecutionSessionCapability
 *   · IC-5-2  只做【类型视图收窄】：❌ 不筛选 / ❌ 不裁剪 / ❌ 不重排 / ❌ 不浅深拷贝（保持原引用语义）
 *             语义投影（messages → text）只发生在 Provider 侧（IC-4-3.1），不在此处
 *   · IC-5-3  不得承担：不生成 sessionId · 不调 registry.register/remove · 不持有 SessionRegistry ·
 *             不做 model resolution · 不做 session lifecycle 决策 ·
 *             不暴露 abort / dispose / close / waitForIdle / model / thinkingLevel / state / raw（SI-14）
 *   · IC-5-4  本文件位于 src/ ⇒ 允许接触 Pi 类型；但它【产出】的类型不含任何 Pi 类型
 *   · IC-INV-2  ExecutionSessionCapability 恰有 prompt + messages 两项，无第三项
 *
 * 边界（不得越权）：
 *   ❌ 不创建 session（不是第二套 session creation seam）
 *   ❌ 不做 lifecycle（close/dispose/abort 的调用时机属 composition boundary，见契约 §6 IC-6-3）
 *   ❌ 不 import 任何 research 内部实现（只取 capability 类型）
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ExecutionSessionCapability } from "@tiancha/research";

export class PiSessionCapabilityAdapter implements ExecutionSessionCapability {
  constructor(private readonly session: AgentSession) {}

  /**
   * Run one prompt against the wrapped Pi session.
   * 直接映射 AgentSession.prompt(text)；resolve ≡ execution settled（无需额外 settlement 调用）。
   * ❌ 不传/不发明 PromptOptions；❌ 不在此处做 settlement / waitForIdle。
   */
  prompt(text: string): Promise<void> {
    return this.session.prompt(text);
  }

  /**
   * Pi messages 以【结构不透明】视图暴露（unknown[]）。
   * · 原样透传：不筛选、不裁剪、不重排、不拷贝（保持原引用语义 · SI-LKP-2）
   * · ❌ 不在此处做 messages → text 的语义投影（那是 Provider 的职责 · IC-4-3.1）
   */
  get messages(): unknown[] {
    return this.session.messages;
  }
}
