/**
 * AF-1C · PiSessionCapabilityAdapter 专项测试（跨边界 capability contract）。
 *
 * 依据：AF-1C Implementation Contract §10 IC-10-2（🔒 FROZEN）
 *   · 跨边界测试只验证 capability contract（prompt + messages 两项）
 *   · ❌ 不得把 Pi 类型带进 research 的测试（本文件在 src/ 侧，允许接触 Pi 类型）
 *   · 可注入 fake AgentSession（结构替身）验证适配
 *   · 验证 Adapter【不做】语义投影（messages 原样以 unknown[] 视图暴露）
 *
 * 本文件不接生产路径：无 TaskEngine / Orchestrator / CLI / Registry / ModelRouter。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { PiSessionCapabilityAdapter } from "./pi-session-capability-adapter.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTER_SRC = join(HERE, "pi-session-capability-adapter.ts");

/** 结构替身：只提供 adapter 真正需要的 prompt + messages（外加 lifecycle 形状的诱饵）。 */
function makeFakeAgentSession(messages: unknown[]) {
  const calls = { prompt: 0, lastText: undefined as string | undefined };
  const session = {
    async prompt(text: string): Promise<void> {
      calls.prompt += 1;
      calls.lastText = text;
    },
    get messages(): unknown[] {
      return messages;
    },
    // --- 诱饵：adapter 的声明类型看不见这些，也不得调用 ---
    dispose(): void {},
    abort: async (): Promise<void> => {},
  };
  return { session: session as unknown as AgentSession, calls };
}

describe("AF-1C PiSessionCapabilityAdapter", () => {
  test("A1 prompt(text) 1:1 映射到 wrapped session（调用一次，入参透传）", async () => {
    const { session, calls } = makeFakeAgentSession([{ role: "assistant", content: "x" }]);
    const capability = new PiSessionCapabilityAdapter(session);
    await capability.prompt("HELLO");
    assert.equal(calls.prompt, 1);
    assert.equal(calls.lastText, "HELLO");
  });

  test("A2 messages 以 unknown[] 视图暴露，且是【同一引用】（不拷贝 · SI-LKP-2）", () => {
    const messages = [{ role: "assistant", content: "x" }];
    const { session } = makeFakeAgentSession(messages);
    const capability = new PiSessionCapabilityAdapter(session);
    const got = capability.messages;
    assert.equal(got, messages); // 同一引用，非拷贝/非包装/非代理
    assert.ok(Array.isArray(got));
  });

  test("A3 Adapter 【不做】语义投影：不筛选 / 不裁剪 / 不重排（原样透传）", () => {
    const messages = [
      { role: "user", content: "q" },
      { role: "tool_use", id: "t" },
      { role: "assistant", content: [{ type: "text", text: "a" }] },
    ];
    const { session } = makeFakeAgentSession(messages);
    const capability = new PiSessionCapabilityAdapter(session);
    assert.equal(capability.messages.length, 3); // 无裁剪
    assert.equal(capability.messages[0], messages[0]); // 无重排 · 无拷贝
    assert.equal(capability.messages[2], messages[2]);
  });

  test("A4 capability 面恰为 prompt + messages 两项（IC-INV-2）", () => {
    const { session } = makeFakeAgentSession([]);
    const capability = new PiSessionCapabilityAdapter(session);
    assert.equal(typeof capability.prompt, "function");
    assert.ok("messages" in capability);
    // 第三项能力不存在（SI-14）
    const keys = new Set([...Object.keys(capability), ...Object.getOwnPropertyNames(Object.getPrototypeOf(capability))]);
    for (const forbidden of ["abort", "dispose", "close", "waitForIdle", "state", "raw", "subscribe"]) {
      assert.equal(keys.has(forbidden), false, `capability must not expose ${forbidden}`);
    }
  });

  test("A5 Adapter 不暴露 model / thinkingLevel（第二真相源）", () => {
    const { session } = makeFakeAgentSession([]);
    const capability = new PiSessionCapabilityAdapter(session) as unknown as Record<string, unknown>;
    assert.equal(capability.model, undefined);
    assert.equal(capability.thinkingLevel, undefined);
  });

  test("A6 源码门：Adapter 不 import research 内部实现（只取 capability 类型）", () => {
    const src = readFileSync(ADAPTER_SRC, "utf8");
    const importBlocks = src.match(/^import\b[\s\S]*?from\s+"[^"]+";/gm) ?? [];
    assert.equal(importBlocks.length, 2, "adapter must import exactly: Pi AgentSession type + ExecutionSessionCapability type");
    const importText = importBlocks.join("\n");
    assert.ok(importText.includes("@earendil-works/pi-coding-agent"));
    assert.ok(importText.includes('"@tiancha/research"'));
    // ❌ 不得 import registry / 内部实现模块
    assert.equal(importText.includes("session-registry"), false);
    assert.equal(importText.includes("pi-execution-provider"), false);
  });

  test("A7 源码门：Adapter 不调用 register / remove / dispose / abort", () => {
    const src = readFileSync(ADAPTER_SRC, "utf8");
    const codeOnly = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("//");
      })
      .join("\n");
    for (const pattern of [/\.register\(/, /\.remove\(/, /\.dispose\(/, /\.abort\(/, /\.close\(/]) {
      assert.equal(pattern.test(codeOnly), false, `adapter code must not contain ${String(pattern)}`);
    }
  });
});
