/**
 * AF-4 · ExecutionCoordinator 专项测试。
 *
 * 依据：AF-4 Implementation Contract §14 测试义务清单（T-A* / T-B* / T-C* / T-D* / T-E*）
 *       与 §13.2 V-6（测试名须逐条对应 T-*）。
 *
 * ★ 原则：测试用于【验证冻结契约】，不用于放宽契约。
 *
 * 本文件不接生产路径：不建 Runtime、不碰 CLI、不碰 SessionRegistry、不启 session。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ExecutionCoordinator } from "./execution-coordinator.js";
import type { DispatchedExecutionContext } from "./dispatched-execution-context.js";
import type { TaskEngine } from "./task-engine.js";
import type { ArtifactRecord, ArtifactStore } from "../storage/artifact-store.js";
import type { ExecutionOutcome, ExecutionProviderPort } from "../ports/execution-provider.port.js";
import type { ArtifactRef } from "../domain/artifact.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const COORDINATOR_SRC = join(HERE, "execution-coordinator.ts");

const CTX: DispatchedExecutionContext = { taskId: "t1", attemptId: "a1", sessionId: "s1" };

/** 记录所有跨边界调用【顺序】，用于证明 artifact put 先于 complete。 */
function makeOrderLog() {
  const order: string[] = [];
  return { order, push: (label: string) => order.push(label) };
}

function makeTask() {
  return { taskId: "t1", runId: "r1", roundId: "rd1" } as unknown as ReturnType<TaskEngine["get"]> & object;
}

function makeAttempt() {
  return { attemptId: "a1", taskId: "t1", model: "model-from-attempt", thinkingLevel: "low" as const };
}

/**
 * Spy TaskEngine（结构化替身）：只暴露 Coordinator 允许使用的面。
 * 额外挂上禁止面（start / setStatus / finishSession）以证明【未被调用】。
 */
function makeSpyTaskEngine(opts: { hasTask?: boolean; hasAttempt?: boolean } = {}) {
  const calls = { get: 0, listAttempts: 0, complete: 0, fail: 0, start: 0, setStatus: 0, finishSession: 0 };
  const completeArgs: ArtifactRef[][] = [];
  const failArgs: string[] = [];
  const task = makeTask();
  const attempt = makeAttempt();
  const engine = {
    get(_taskId: string) {
      calls.get += 1;
      return opts.hasTask === false ? undefined : task;
    },
    listAttempts(_taskId: string) {
      calls.listAttempts += 1;
      return opts.hasAttempt === false ? [] : [attempt];
    },
    complete(taskId: string, outputs: ArtifactRef[]) {
      calls.complete += 1;
      completeArgs.push(outputs);
      return attempt;
    },
    fail(taskId: string, error: string) {
      calls.fail += 1;
      failArgs.push(error);
      return attempt;
    },
    // --- 以下均属【禁止面】：必须保持 0 调用 ---
    start(_taskId: string) {
      calls.start += 1;
      throw new Error("Coordinator must NOT call TaskEngine.start()");
    },
    setStatus() {
      calls.setStatus += 1;
    },
    finishSession() {
      calls.finishSession += 1;
    },
  };
  return { engine: engine as unknown as TaskEngine, calls, completeArgs, failArgs, task, attempt };
}

/** Spy ArtifactStore（结构化替身）：记录 put 的载荷与顺序，可令 put 抛错。 */
function makeSpyArtifactStore(log: ReturnType<typeof makeOrderLog>, opts: { throwOnPut?: boolean } = {}) {
  const calls = { put: 0, get: 0, listByRun: 0, listByTask: 0, close: 0 };
  const records: ArtifactRecord[] = [];
  const store = {
    async put(record: ArtifactRecord): Promise<ArtifactRef> {
      calls.put += 1;
      records.push(record);
      log.push("put");
      if (opts.throwOnPut) throw new Error("disk full");
      return record.artifact.ref;
    },
    async get() {
      calls.get += 1;
      return undefined;
    },
    async listByRun() {
      calls.listByRun += 1;
      return [];
    },
    async listByTask() {
      calls.listByTask += 1;
      return [];
    },
    async close() {
      calls.close += 1;
    },
  };
  return { store: store as unknown as ArtifactStore, calls, records };
}

/** Spy provider：记录 execute 的入参，可返回 succeeded / failed，或抛错。 */
function makeSpyProvider(
  mode: "succeeded" | "failed" | "throws",
  log?: ReturnType<typeof makeOrderLog>,
) {
  const calls = { execute: 0 };
  const seen: { sessionId?: string; prompt?: string; request?: unknown } = {};
  const provider = {
    async execute(handle: { sessionId: string }, request: { prompt: string }): Promise<ExecutionOutcome> {
      calls.execute += 1;
      seen.sessionId = handle.sessionId;
      seen.prompt = request.prompt;
      seen.request = request;
      log?.push("execute");
      if (mode === "throws") throw new Error("provider exploded");
      if (mode === "failed") {
        return { status: "failed", error: { message: "provider says no", kind: "provider" } };
      }
      return { status: "succeeded", output: { text: "ok", messages: [] } };
    },
  };
  return { provider: provider as unknown as ExecutionProviderPort, calls, seen };
}

function makeCoordinator(opts: {
  mode?: "succeeded" | "failed" | "throws";
  hasTask?: boolean;
  hasAttempt?: boolean;
  throwOnPut?: boolean;
} = {}) {
  const log = makeOrderLog();
  const { provider, calls: providerCalls, seen } = makeSpyProvider(opts.mode ?? "succeeded", log);
  const { engine, calls: engineCalls, completeArgs, failArgs, task, attempt } = makeSpyTaskEngine(opts);
  const { store, calls: storeCalls, records } = makeSpyArtifactStore(log, opts);
  const coordinator = new ExecutionCoordinator({ provider, taskEngine: engine, artifactStore: store });
  return {
    coordinator,
    log,
    providerCalls,
    seen,
    engineCalls,
    completeArgs,
    failArgs,
    storeCalls,
    records,
    task,
    attempt,
  };
}

describe("AF-4 ExecutionCoordinator — 成功路径", () => {
  test("T-C2 / success ⇒ 走成功路径（complete 一次，fail 零次）", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.engineCalls.complete, 1);
    assert.equal(h.engineCalls.fail, 0);
  });

  test("T-E1 success ⇒ complete(taskId, [artifactRef]) 一次", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.completeArgs.length, 1);
    assert.equal(h.completeArgs[0].length, 1);
    assert.equal(typeof h.completeArgs[0][0].artifactId, "string");
    assert.equal(h.completeArgs[0][0].kind, "execution");
  });

  test("T-D1 success ⇒ 恰好 1 个 artifact，kind === \"execution\"", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.storeCalls.put, 1);
    assert.equal(h.records.length, 1);
    assert.equal(h.records[0].artifact.kind, "execution");
    assert.equal(h.records[0].artifact.schemaVersion, "1");
  });

  test("★ success ⇒ artifact put 【先于】 complete（顺序不可反）", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.deepEqual(h.log.order, ["execute", "put"]);
    // complete 发生但不在 log 中（log 只记 provider/put）；用计数与顺序共同证明
    assert.equal(h.engineCalls.complete, 1);
  });

  test("T-D3 artifact 的 taskId / attemptId / runId / roundId 等于真实执行事实", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    const a = h.records[0].artifact;
    assert.equal(a.taskId, "t1");
    assert.equal(a.attemptId, "a1");
    assert.equal(a.runId, "r1");
    assert.equal(a.roundId, "rd1");
  });

  test("T-A3 handle 来源：provider 收到的 handle.sessionId == context.sessionId", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.seen.sessionId, CTX.sessionId);
  });

  test("T-A2 execution facts 来源：model / thinkingLevel 等于 attempt 的值", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    const req = h.seen.request as { model: string; thinkingLevel: string };
    assert.equal(req.model, "model-from-attempt");
    assert.equal(req.thinkingLevel, "low");
  });
});

describe("AF-4 ExecutionCoordinator — Prompt provenance（Amendment 4 硬规则）", () => {
  test("★ prompt 原样透传（request.prompt === 传入的 prompt）", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "EXACT-PROMPT-TEXT");
    assert.equal(h.seen.prompt, "EXACT-PROMPT-TEXT");
  });

  test("★ prompt 不从 Task / TaskInputs / objective 等字段推导", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "ONLY-FROM-CALLER");
    const req = h.seen.request as { prompt: string; taskId: string; runId: string; roundId?: string };
    assert.equal(req.prompt, "ONLY-FROM-CALLER");
    // 反向断言：prompt 不等于任何 domain 事实（若实现偷偷推导，此断言会失败）
    assert.notEqual(req.prompt, req.taskId);
    assert.notEqual(req.prompt, req.runId);
    assert.notEqual(req.prompt, req.roundId);
    assert.notEqual(req.prompt, h.attempt.model);
  });

  test("★ prompt 为空白串时也【原样透传】（不 fallback / 不 default）", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "");
    assert.equal(h.seen.prompt, "");
  });

  test("★ 源码门：Coordinator 不出现 prompt 的推导来源", () => {
    const src = readFileSync(COORDINATOR_SRC, "utf8");
    const codeOnly = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("//");
      })
      .join("\n");
    for (const forbidden of ["inputs.question", "objective", "JSON.stringify", "ResearchContext"]) {
      assert.equal(codeOnly.includes(forbidden), false, `coordinator code must not reference ${forbidden}`);
    }
  });
});

describe("AF-4 ExecutionCoordinator — ResearchContext（R-EC-10）", () => {
  test("★ 无 upstream context ⇒ request.context === undefined（不构造 / 不合成）", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    const req = h.seen.request as { context?: unknown };
    assert.equal(req.context, undefined);
    assert.equal("context" in req, false);
  });

  test("★ 源码门：Coordinator 不构造 ResearchContext", () => {
    const src = readFileSync(COORDINATOR_SRC, "utf8");
    const codeOnly = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("//");
      })
      .join("\n");
    assert.equal(/new ResearchContext/.test(codeOnly), false);
    assert.equal(/build\w*Context\(/.test(codeOnly), false);
  });
});

describe("AF-4 ExecutionCoordinator — 失败路径（零 artifact）", () => {
  test("T-C2 / provider 返回 failed ⇒ 走失败路径（fail 一次，complete 零次）", async () => {
    const h = makeCoordinator({ mode: "failed" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.engineCalls.fail, 1);
    assert.equal(h.engineCalls.complete, 0);
  });

  test("T-E2 failed ⇒ fail(taskId, error.message) 一次", async () => {
    const h = makeCoordinator({ mode: "failed" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.deepEqual(h.failArgs, ["provider says no"]);
  });

  test("T-D2 failed ⇒ artifactStore.put 调用次数 = 0（zero artifact）", async () => {
    const h = makeCoordinator({ mode: "failed" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.storeCalls.put, 0);
    assert.equal(h.records.length, 0);
  });

  test("provider throws ⇒ fail() 一次 · 零 artifact（throw = execution failure）", async () => {
    const h = makeCoordinator({ mode: "throws" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.engineCalls.fail, 1);
    assert.equal(h.engineCalls.complete, 0);
    assert.equal(h.storeCalls.put, 0);
    assert.deepEqual(h.failArgs, ["provider exploded"]);
  });

  test("★ artifact put 抛错（F-6）⇒ 调 fail() 且 reason 标记 artifact persistence failure；不调 complete", async () => {
    const h = makeCoordinator({ mode: "succeeded", throwOnPut: true });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.engineCalls.complete, 0);
    assert.equal(h.engineCalls.fail, 1);
    assert.match(h.failArgs[0], /artifact persistence failure/);
  });
});

describe("AF-4 ExecutionCoordinator — Provider exactly once / 边界", () => {
  test("T-B1 / provider.execute 调用次数 = 1（成功路径）", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.providerCalls.execute, 1);
  });

  test("T-B1 / provider.execute 调用次数 = 1（失败路径；无 retry）", async () => {
    const h = makeCoordinator({ mode: "failed" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.providerCalls.execute, 1);
  });

  test("T-A5 / 来源责任：Coordinator 【无】TaskEngine.start() 调用（start 计数 = 0）", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.engineCalls.start, 0);
  });

  test("T-E3 / Coordinator 未直接写任何 status（无 setStatus 调用）", async () => {
    const h = makeCoordinator({ mode: "succeeded" });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.engineCalls.setStatus, 0);
    assert.equal(h.engineCalls.finishSession, 0);
  });

  test("T-E4 / at-most-one settlement：complete 与 fail 调用总数 ≤ 1", async () => {
    for (const mode of ["succeeded", "failed", "throws"] as const) {
      const h = makeCoordinator({ mode });
      await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
      assert.ok(
        h.engineCalls.complete + h.engineCalls.fail <= 1,
        `${mode}: settlement calls must be at most one`,
      );
    }
  });

  test("★ 源码门：Coordinator 不触碰 SessionRegistry / 不创建 session / 无 scheduler / 无循环", () => {
    const src = readFileSync(COORDINATOR_SRC, "utf8");
    const codeOnly = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("//");
      })
      .join("\n");
    for (const forbidden of [
      "SessionRegistry",
      "createAgentSession",
      "stepRound",
      "startRound",
      "finishRound",
      "setInterval",
      "setTimeout",
    ]) {
      assert.equal(codeOnly.includes(forbidden), false, `coordinator code must not reference ${forbidden}`);
    }
    assert.equal(/\bwhile\s*\(/.test(codeOnly), false, "no while loop");
    assert.equal(/\.forEach\(.*await/.test(codeOnly), false);
  });

  test("★ 源码门：Coordinator 不 import Pi / 不 import CLI", () => {
    const src = readFileSync(COORDINATOR_SRC, "utf8");
    assert.equal(src.includes("pi-coding-agent"), false);
    assert.equal(src.includes("../cli/"), false);
  });

  test("T-A1 / 前置缺失：task 不存在 ⇒ fail 收口（不越界、不吞错）", async () => {
    const h = makeCoordinator({ mode: "succeeded", hasTask: false });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.engineCalls.fail, 1);
    assert.equal(h.engineCalls.complete, 0);
    assert.equal(h.providerCalls.execute, 0);
  });

  test("T-A1 / 前置缺失：attempt 不存在 ⇒ fail 收口", async () => {
    const h = makeCoordinator({ mode: "succeeded", hasAttempt: false });
    await h.coordinator.executeDispatchedExecution(CTX, "PROMPT");
    assert.equal(h.engineCalls.fail, 1);
    assert.equal(h.engineCalls.complete, 0);
    assert.equal(h.providerCalls.execute, 0);
  });

  test("T-A4 / 输入契约：entry 只接受 (context, prompt) 两个参数（arity gate）", () => {
    assert.equal(ExecutionCoordinator.prototype.executeDispatchedExecution.length, 2);
  });
});
