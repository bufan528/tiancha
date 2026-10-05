/**
 * AF-1C · PiExecutionProvider 专项测试（≥10 项行为 + 反例门）。
 *
 * 依据：AF-1C Implementation Contract §10 IC-10-1 / IC-10-4（🔒 FROZEN）
 *   T1  lookup hit ⇒ prompt 被调用一次，入参 = request.prompt
 *   T2  lookup hit ⇒ status="succeeded"，output.text 为 messages 投影
 *   T3  lookup miss ⇒ status="failed"，error.kind="session_lookup_miss"
 *   T4  lookup miss ⇒ 【不】调用 capability.prompt（spy = 0）
 *   T5  lookup miss ⇒ 【不】产 output
 *   T6  prompt throw ⇒ status="failed"，error.kind="prompt_failed"
 *   T7  prompt throw ⇒ 【不】再调 waitForIdle / 任何 settlement（spy = 0）
 *   T8  messages 保持 unknown[]，且不暴露 Pi 类型（结构断言）
 *   T8b 投影规则（IC-4-3.1）逐条
 *   T9  构造/API-shape gate（非运行时 spy）+ 源码门
 *   T10 双重证明：spy 调用数 = 0 + 源码反例门
 *
 * 本文件不接生产路径：无 TaskEngine / Orchestrator / CLI / Factory / ModelRouter / Pi。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PiExecutionProvider } from "./pi-execution-provider.js";
import type { SessionRegistry } from "./session-registry.js";
import type { ExecutionSessionCapability } from "./execution-session.js";
import type { ExecutionRequest } from "../ports/execution-provider.port.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROVIDER_SRC = join(HERE, "pi-execution-provider.ts");

function makeRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    taskId: "t1",
    runId: "r1",
    model: "m1",
    thinkingLevel: "low",
    prompt: "PROMPT-TEXT",
    ...overrides,
  };
}

/** 只暴露守恒最小能力的 session（prompt + messages），并记录 prompt 调用。 */
function makeCapability(messages: unknown[], opts: { throwOnPrompt?: boolean } = {}) {
  const calls = { prompt: 0, lastPromptText: undefined as string | undefined };
  const capability: ExecutionSessionCapability = {
    async prompt(text: string): Promise<void> {
      calls.prompt += 1;
      calls.lastPromptText = text;
      if (opts.throwOnPrompt) throw new Error("boom");
    },
    get messages(): unknown[] {
      return messages;
    },
  };
  return { capability, calls };
}

/**
 * Spy registry（结构化替身）：计数 register / lookup / remove，并驱动 lookup 结果。
 * 目的：证明 Provider 只 lookup，绝不 register / remove（T10 第一层）。
 */
function makeSpyRegistry(hit?: ExecutionSessionCapability) {
  const calls = { register: 0, lookup: 0, remove: 0 };
  const spy = {
    register(_id: string, _cap: unknown): void {
      calls.register += 1;
    },
    lookup(_id: string): ExecutionSessionCapability | undefined {
      calls.lookup += 1;
      return hit;
    },
    remove(_id: string): void {
      calls.remove += 1;
    },
  };
  return { registry: spy as unknown as SessionRegistry, calls };
}

describe("AF-1C PiExecutionProvider — happy path", () => {
  test("T1 lookup hit ⇒ prompt 被调用一次，且入参 = request.prompt", async () => {
    const { capability, calls } = makeCapability([{ role: "assistant", content: "hello" }]);
    const { registry } = makeSpyRegistry(capability);
    await new PiExecutionProvider(registry).execute({ sessionId: "s1" }, makeRequest());
    assert.equal(calls.prompt, 1);
    assert.equal(calls.lastPromptText, "PROMPT-TEXT");
  });

  test("T2 lookup hit ⇒ status=succeeded，output.text 为 messages 的投影", async () => {
    const { capability } = makeCapability([
      { role: "user", content: "q" },
      { role: "assistant", content: "the-answer" },
    ]);
    const { registry } = makeSpyRegistry(capability);
    const outcome = await new PiExecutionProvider(registry).execute({ sessionId: "s1" }, makeRequest());
    assert.equal(outcome.status, "succeeded");
    if (outcome.status !== "succeeded") return;
    assert.equal(outcome.output.text, "the-answer");
  });

  test("T2b output.messages 原样透传（同一引用，不筛选/不裁剪/不重排）", async () => {
    const messages = [{ role: "assistant", content: "x" }];
    const { capability } = makeCapability(messages);
    const { registry } = makeSpyRegistry(capability);
    const outcome = await new PiExecutionProvider(registry).execute({ sessionId: "s1" }, makeRequest());
    assert.equal(outcome.status, "succeeded");
    if (outcome.status !== "succeeded") return;
    assert.equal(outcome.output.messages, messages);
  });
});

describe("AF-1C PiExecutionProvider — lookup miss", () => {
  test("T3 lookup miss ⇒ status=failed，error.kind=session_lookup_miss", async () => {
    const { registry } = makeSpyRegistry(undefined);
    const outcome = await new PiExecutionProvider(registry).execute({ sessionId: "nope" }, makeRequest());
    assert.equal(outcome.status, "failed");
    if (outcome.status !== "failed") return;
    assert.equal(outcome.error.kind, "session_lookup_miss");
  });

  test("T4 lookup miss ⇒ 【不】调用 capability.prompt（spy = 0）", async () => {
    const { capability, calls } = makeCapability([{ role: "assistant", content: "x" }]);
    const { registry } = makeSpyRegistry(undefined); // miss：不返回该 capability
    await new PiExecutionProvider(registry).execute({ sessionId: "nope" }, makeRequest());
    assert.equal(calls.prompt, 0);
    assert.equal(capability.messages.length, 1); // 该实例未被触碰
  });

  test("T5 lookup miss ⇒ 【不】产 output（failed 分支无 output 字段）", async () => {
    const { registry } = makeSpyRegistry(undefined);
    const outcome = await new PiExecutionProvider(registry).execute({ sessionId: "nope" }, makeRequest());
    assert.equal(outcome.status, "failed");
    assert.equal("output" in outcome, false);
  });
});

describe("AF-1C PiExecutionProvider — prompt failure", () => {
  test("T6 prompt throw ⇒ status=failed，error.kind=prompt_failed", async () => {
    const { capability } = makeCapability([], { throwOnPrompt: true });
    const { registry } = makeSpyRegistry(capability);
    const outcome = await new PiExecutionProvider(registry).execute({ sessionId: "s1" }, makeRequest());
    assert.equal(outcome.status, "failed");
    if (outcome.status !== "failed") return;
    assert.equal(outcome.error.kind, "prompt_failed");
  });

  test("T6b prompt throw ⇒ 失败不是 lookup miss（诊断不串味）", async () => {
    const { capability } = makeCapability([], { throwOnPrompt: true });
    const { registry } = makeSpyRegistry(capability);
    const outcome = await new PiExecutionProvider(registry).execute({ sessionId: "s1" }, makeRequest());
    if (outcome.status !== "failed") return assert.fail("expected failed");
    assert.notEqual(outcome.error.kind, "session_lookup_miss");
  });

  test("T7 prompt throw ⇒ 【不】再调 settlement（capability 面只有 prompt+messages，无 waitForIdle 可调）", async () => {
    const { capability, calls } = makeCapability([], { throwOnPrompt: true });
    // 结构化断言：capability 面【不含】settlement / lifecycle 成员
    const keys = Object.keys(capability as unknown as Record<string, unknown>);
    assert.equal(keys.includes("waitForIdle"), false);
    assert.equal(keys.includes("close"), false);
    assert.equal(keys.includes("dispose"), false);
    assert.equal(keys.includes("abort"), false);
    const { registry } = makeSpyRegistry(capability);
    await new PiExecutionProvider(registry).execute({ sessionId: "s1" }, makeRequest());
    assert.equal(calls.prompt, 1); // 只调了 prompt 一次，无额外调用
  });
});

describe("AF-1C PiExecutionProvider — 投影规则（IC-4-3.1）", () => {
  async function textOf(messages: unknown[]): Promise<string | undefined> {
    const { capability } = makeCapability(messages);
    const { registry } = makeSpyRegistry(capability);
    const outcome = await new PiExecutionProvider(registry).execute({ sessionId: "s1" }, makeRequest());
    if (outcome.status !== "succeeded") return undefined;
    return outcome.output.text;
  }

  test("T8b-1 最后一条 assistant，content 为 string ⇒ text = 该串", async () => {
    assert.equal(await textOf([{ role: "assistant", content: "abc" }]), "abc");
  });

  test("T8b-2 最后一条 assistant，content 为 text 块数组 ⇒ 各块按数组顺序以 \\n 连接", async () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "l1" }, { type: "tool_use", id: "x" }, { type: "text", text: "l2" }] },
    ];
    assert.equal(await textOf(messages), "l1\nl2");
  });

  test("T8b-3 无 assistant（只有 user）⇒ text 省略（undefined）", async () => {
    assert.equal(await textOf([{ role: "user", content: "q" }]), undefined);
  });

  test("T8b-4 多条 assistant ⇒ 取【最后一条】", async () => {
    const messages = [
      { role: "assistant", content: "first" },
      { role: "user", content: "mid" },
      { role: "assistant", content: "last" },
    ];
    assert.equal(await textOf(messages), "last");
  });

  test("T8b-5 content 形状未知 ⇒ text = \"\"（不抛错、不 JSON.stringify）", async () => {
    assert.equal(await textOf([{ role: "assistant", content: { weird: true } }]), "");
    assert.equal(await textOf([{ role: "assistant", content: undefined }]), "");
  });

  test("T8b-6 数组内全为非 text 块 ⇒ text = \"\"；messages 为空 ⇒ undefined", async () => {
    assert.equal(await textOf([{ role: "assistant", content: [{ type: "image", url: "u" }] }]), "");
    assert.equal(await textOf([]), undefined);
  });
});

describe("AF-1C PiExecutionProvider — 边界与反例门", () => {
  test("T8 成功输出的 messages 保持 unknown[] 边界（无 Pi 类型泄漏）", async () => {
    const { capability } = makeCapability([{ role: "assistant", content: "x" }]);
    const { registry } = makeSpyRegistry(capability);
    const outcome = await new PiExecutionProvider(registry).execute({ sessionId: "s1" }, makeRequest());
    if (outcome.status !== "succeeded") return assert.fail("expected succeeded");
    assert.ok(Array.isArray(outcome.output.messages));
    // 顶层判别字段唯一为 status
    assert.deepEqual(Object.keys(outcome).sort(), ["output", "status"]);
  });

  test("T9 构造/API-shape gate：Provider 只接收一个依赖（registry）", () => {
    const src = readFileSync(PROVIDER_SRC, "utf8");
    // 构造参数恰为一个（arity gate）
    assert.equal(PiExecutionProvider.length, 1);
    // 源码门（只查【可执行代码面】：import 语句块），不受文档注释干扰
    const importBlocks = src.match(/^import\b[\s\S]*?from\s+"[^"]+";/gm) ?? [];
    assert.equal(importBlocks.length, 2, "provider must import exactly: SessionRegistry + execution-provider.port");
    const importText = importBlocks.join("\n");
    assert.ok(importText.includes('"./session-registry.js"'));
    assert.ok(importText.includes('"../ports/execution-provider.port.js"'));
    // 且不得出现任何构造/引用被禁依赖的【代码】（非注释）
    const codeOnly = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("//");
      })
      .join("\n");
    for (const forbidden of ["new TaskEngine", "new Orchestrator", "new ModelRouter", "new SessionRegistry", "createAgentSessionFromServices"]) {
      assert.equal(codeOnly.includes(forbidden), false, `provider code must not contain ${forbidden}`);
    }
  });

  test("T10 Provider 全流程【不】调用 register / remove（spy = 0）", async () => {
    const { capability } = makeCapability([{ role: "assistant", content: "x" }]);
    const { registry, calls } = makeSpyRegistry(capability);
    await new PiExecutionProvider(registry).execute({ sessionId: "s1" }, makeRequest());
    assert.equal(calls.register, 0);
    assert.equal(calls.remove, 0);
    assert.equal(calls.lookup, 1); // 只做了一次 lookup
  });

  test("T10b 源码反例门：Provider 源码不出现 .register( / .remove(", () => {
    const src = readFileSync(PROVIDER_SRC, "utf8");
    assert.equal(/\.register\(/.test(src), false, "provider source must not call .register(");
    assert.equal(/\.remove\(/.test(src), false, "provider source must not call .remove(");
  });

  test("T10c 反例门：Provider 源码不 import Pi", () => {
    const src = readFileSync(PROVIDER_SRC, "utf8");
    assert.equal(src.includes("pi-coding-agent"), false);
  });
});
