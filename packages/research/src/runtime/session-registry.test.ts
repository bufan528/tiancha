/**
 * AF-1B-I · SessionRegistry 专项测试（≥10 项行为）。
 *
 * 覆盖契约（execution-session-lookup-seam-implementation-contract.md）：
 *   SI-4  register 只接受 { sessionId, ExecutionSessionCapability }
 *   SI-5  duplicate register ⇒ 显式失败（不静默覆盖）
 *   SI-7  lookup 返回【同一实例引用】（不复制/不包装/不代理）
 *   SI-8  lookup miss 与命中显式可区分
 *   SI-9  lookup 无副作用
 *   SI-10 remove 仅移除 mapping
 *   SI-11 remove missing ⇒ 幂等 no-op
 *   SI-12 key = opaque sessionId（禁 taskId/attemptId 推导）
 *   SI-14 capability 边界最小（不含 lifecycle / model / state / raw）
 *
 * 本文件不接生产路径：无 TaskEngine / Orchestrator / CLI / Factory / ModelRouter。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SessionRegistry } from "./session-registry.js";
import type { ExecutionSessionCapability } from "./execution-session.js";

/**
 * Spy execution session.
 *
 * It satisfies `ExecutionSessionCapability` (prompt + messages) AND deliberately
 * carries lifecycle-shaped extras (close / dispose / abort / finishSession).
 * Passing it as a *variable* keeps TS structural typing satisfied while proving
 * the registry's declared type cannot see — and therefore cannot call — those extras.
 */
function makeSpySession(label: string) {
  const calls = { prompt: 0, close: 0, dispose: 0, abort: 0, finishSession: 0 };
  const session = {
    label,
    prompt: async (_text: string): Promise<void> => {
      calls.prompt += 1;
    },
    get messages(): unknown[] {
      return [{ role: "assistant", content: label }];
    },
    // --- must never be reached through the registry ---
    close: async (): Promise<void> => {
      calls.close += 1;
    },
    dispose: (): void => {
      calls.dispose += 1;
    },
    abort: async (): Promise<void> => {
      calls.abort += 1;
    },
    finishSession: (): void => {
      calls.finishSession += 1;
    },
  };
  return { session, calls };
}

/** A session exposing ONLY the frozen minimal capability. */
function makeMinimalSession(): ExecutionSessionCapability {
  return {
    prompt: async (_text: string): Promise<void> => {},
    get messages(): unknown[] {
      return [];
    },
  };
}

describe("SessionRegistry — register", () => {
  test("T1 register then lookup hits the same key", () => {
    const registry = new SessionRegistry();
    const { session } = makeSpySession("a");
    registry.register("s1", session);
    assert.equal(registry.lookup("s1"), session);
  });

  test("T2 lookup returns the very same instance reference (no copy / no wrapper / no proxy)", () => {
    const registry = new SessionRegistry();
    const { session } = makeSpySession("b");
    registry.register("s1", session);
    const got = registry.lookup("s1");
    assert.ok(got === session, "lookup must return the identical object reference");
    // `messages` is a getter on the fixture (returns a fresh array each access),
    // so only instance identity is asserted here — structure is asserted separately.
    assert.deepEqual(got!.messages, [{ role: "assistant", content: "b" }]);
  });

  test("T4 duplicate register for the same sessionId fails explicitly", () => {
    const registry = new SessionRegistry();
    const { session } = makeSpySession("c");
    registry.register("s1", session);
    assert.throws(
      () => registry.register("s1", makeMinimalSession()),
      /already registered/,
    );
  });

  test("T5 after a rejected duplicate, the original mapping is unchanged", () => {
    const registry = new SessionRegistry();
    const { session: first } = makeSpySession("d");
    registry.register("s1", first);
    assert.throws(() => registry.register("s1", makeMinimalSession()));
    assert.equal(registry.lookup("s1"), first);
  });

  test("T10 register does not touch any lifecycle method", () => {
    const registry = new SessionRegistry();
    const { session, calls } = makeSpySession("e");
    registry.register("s1", session);
    assert.deepEqual(
      { close: calls.close, dispose: calls.dispose, abort: calls.abort, finishSession: calls.finishSession },
      { close: 0, dispose: 0, abort: 0, finishSession: 0 },
    );
  });

  test("T14 a session exposing only the minimal capability can be registered", () => {
    const registry = new SessionRegistry();
    const minimal = makeMinimalSession();
    registry.register("s1", minimal);
    assert.equal(registry.lookup("s1"), minimal);
  });
});

describe("SessionRegistry — lookup", () => {
  test("T3 lookup on an unknown sessionId yields an explicit miss (undefined)", () => {
    const registry = new SessionRegistry();
    assert.equal(registry.lookup("missing"), undefined);
    // a miss is distinguishable from a hit in the type system itself
    // (`ExecutionSessionCapability | undefined`), never a silently empty object
    assert.equal(registry.lookup("missing") ?? null, null);
  });

  test("T9 lookup is side-effect free (repeatable, order-independent)", () => {
    const registry = new SessionRegistry();
    const { session } = makeSpySession("f");
    registry.register("s1", session);
    assert.equal(registry.lookup("s1"), session);
    assert.equal(registry.lookup("s1"), session);
    assert.equal(registry.lookup("nope"), undefined);
    // a miss must not evict or mutate the existing mapping
    assert.equal(registry.lookup("s1"), session);
  });

  test("T11 sessionIds are isolated from one another", () => {
    const registry = new SessionRegistry();
    const { session: s1 } = makeSpySession("s1-body");
    const { session: s2 } = makeSpySession("s2-body");
    registry.register("s1", s1);
    registry.register("s2", s2);
    assert.equal(registry.lookup("s1"), s1);
    assert.equal(registry.lookup("s2"), s2);
    assert.notEqual(registry.lookup("s1"), registry.lookup("s2"));
  });

  test("T12 sessionId is opaque: no derivation, no structure checks, no normalization", () => {
    const registry = new SessionRegistry();
    const { session } = makeSpySession("g");
    // arbitrary, non-derived keys are all valid; nothing is computed from them
    const opaqueKeys = ["child-task-1", "   spaced  ", "Σ-キー", "0"];
    for (const key of opaqueKeys) registry.register(key, session);
    for (const key of opaqueKeys) assert.equal(registry.lookup(key), session);
    // lookalike keys are distinct entries, never aliases
    assert.equal(registry.lookup("child-task-11"), undefined);
    assert.equal(registry.lookup("spaced"), undefined);
  });
});

describe("SessionRegistry — remove", () => {
  test("T6 remove drops the mapping (subsequent lookup misses)", () => {
    const registry = new SessionRegistry();
    const { session } = makeSpySession("h");
    registry.register("s1", session);
    registry.remove("s1");
    assert.equal(registry.lookup("s1"), undefined);
  });

  test("T7 remove on a missing key is an idempotent no-op (never throws)", () => {
    const registry = new SessionRegistry();
    assert.doesNotThrow(() => registry.remove("never-registered"));
    registry.remove("never-registered");
    assert.equal(registry.lookup("never-registered"), undefined);
  });

  test("T8 remove of one key does not affect other keys", () => {
    const registry = new SessionRegistry();
    const { session: a } = makeSpySession("i");
    const { session: b } = makeSpySession("j");
    registry.register("s1", a);
    registry.register("s2", b);
    registry.remove("s1");
    assert.equal(registry.lookup("s1"), undefined);
    assert.equal(registry.lookup("s2"), b);
  });

  test("T9b ★ spy: remove (and lookup) never invoke close / dispose / abort / finishSession", () => {
    const registry = new SessionRegistry();
    const { session, calls } = makeSpySession("k");
    registry.register("s1", session);

    registry.lookup("s1");
    registry.remove("s1");
    registry.remove("s1"); // idempotent path
    registry.lookup("s1"); // now a miss

    assert.equal(calls.close, 0, "remove must not close the session");
    assert.equal(calls.dispose, 0, "remove must not dispose the session");
    assert.equal(calls.abort, 0, "remove must not abort the session");
    assert.equal(calls.finishSession, 0, "remove must not finish the session");
    assert.equal(calls.prompt, 0, "the registry never executes the session");
  });
});
