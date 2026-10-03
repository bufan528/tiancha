# AF-1 · Execution Provider Contract

> **Status:** rev2 — DESIGN ONLY · **O-AF1-1 ADJUDICATED**（rev2 仅收口 Q-EP9-1…Q-EP9-4 的最小接口语义；rev1 的 EP-1…EP-15 与 §1–§17 语义**逐字未改**）
> **Scope:** docs-only。本契约不含任何实现；未授权 production code / port implementation / TaskEngine 修改 / adapter 修改 / `stepRound()` 修改 / AF-4 caller / timeout 实现 / persistence / tests。**rev2 亦未授权**：任何 TypeScript 改动 / Provider 实现 / ExecutionOutcome 代码类型 / AF-4 / Artifactization / commit / push。
> **上游依据:** `docs/phaseC/round-execution-driver-contract.md`（R2 · FROZEN）· `docs/phaseC/round-lifecycle-contract.md`（rev1 · FROZEN）· `docs/phaseC/c7b-execution-wiring-contract.md`（rev4 · FROZEN）
> **证据基础:** R2 Post-Publish Architecture Audit（AF-1/AF-4 findings）+ AF-1-B Preflight（P1–P4）+ O-AF1-1 Preflight（既有载体取证）

---

## §0 状态

```text
AF-1  Execution Provider Wiring Gap     🟢 ACCEPTED（原 IG-2，已升级定性）
   Preflight                            CLOSED（P1–P4）
   Q-EP-1 … Q-EP-8                      CLOSED
   O-AF1-1 Adjudication (rev2)          CLOSED（Q-EP9-1…Q-EP9-4 → §18）
本契约                                  📄 rev2 · DOCS-ONLY · 待 Human Contract Review · 未 commit / 未 push
AF-2 + AF-3                             🔒 FROZEN · 🟢 PUBLISHED（eef63ac）
AF-4                                    🟡 HOLD（execution coordinator / caller，本契约显式保留；其 Contract
                                        依赖的 O-AF1-1 最小 shape 已于 rev2 裁定）
R2 / R2 Contract                        🔒 FROZEN · 🟢 PUBLISHED（275b84d）
G2-b · G2-e · C7-C · Run lifecycle      🔴 HOLD
Concurrency                             ⛔ OUT / FUTURE
```

---

## §1 Purpose

本契约定义 **dispatch 之后的执行边界**：Task 被 dispatch 后，**谁执行、执行终止的事实如何产生、成功/失败如何形成一个抽象的、与投资研究领域无关的执行结论**。

它回答四个问题：

```text
① 执行发生在哪里（哪一层、由谁拥有 concrete Pi session）？
② 一次执行的【终局】如何判定（settlement anchor）？
③ 执行结果以什么【抽象形态】离开 provider 层？
④ provider 层【绝对不做】什么（防止架构漂移）？
```

---

## §2 Non-goals（OUT）

本契约 **不定义**：

```text
❌ Round readiness / Round dispatch / Round settlement        → 属 R2（FROZEN）
❌ TaskDerivation（Task 怎么产生）                            → 属 G2-b（HOLD）
❌ Run lifecycle                                              → HOLD
❌ Task retry / recovery / permanent impossibility            → HOLD（G2-e / C7-B 保留）
❌ TaskEngine failure-boundary 语义（start 部分失败、收口清理失败）→ 属 AF-2/AF-3（OPEN）
❌ AF-4 execution coordinator（谁 await / 谁收口到 complete()/fail()）→ §9 显式保留
❌ 并发执行                                                   → OUT / FUTURE
❌ research target selection / Human Gate / evaluation criteria
❌ persistence / schema / 事件载体改造
```

---

## §3 Terminology

| 术语 | 含义（本契约内冻结） |
| --- | --- |
| **execution context** | 一次 Task dispatch 所建立的、可供执行的上下文；在 Tiancha 侧表现为 `TaskEngine.start()` 返回的 `{ task, attempt, session }`，其中 `session` 是 research 侧的**不透明句柄** |
| **concrete session** | composition root 侧真实存在的 Pi `AgentSession` 实例 |
| **execution provider** | 驱动 concrete session 执行、判定本次执行终局、产出 `ExecutionOutcome` 的组件（跨 research 契约 / composition root 实现两侧） |
| **settlement** | 一次 provider 执行**彻底终止**（成功、失败或被 abort 后）的状态；判定见 §5 |
| **`ExecutionOutcome`** | provider 产出的、research-neutral 的执行结论（§7） |
| **dispatch** | R2 语义：向 `TaskEngine.start()` 提交一个 ready Task（**不等待执行**） |
| **coordinator（未来 AF-4）** | 消费 `ExecutionOutcome` 并把 Task lifecycle 收口的层（§9，本契约不定义） |

**术语纪律：** `dispatch` 在本契约中**始终**指 R2 的 "start"，不得被解释为 "execute"；`settlement` 在 R2 语境中表示 **Round** 的收口，在 AF-1 语境中表示 **execution** 的终止，两者**不得混用**（R2 语境一律写 `settleRound` / "Round settlement"）。

---

## §4 分层与所有权

```text
┌──────────────────────────────────────────────────────────┐
│ Research layer（packages/research）                       │
│                                                          │
│  · Orchestrator / R2 stepRound()      ← dispatch only    │
│  · TaskEngine                        ← Task / Attempt     │
│  · ChildSession                       ← 【不透明句柄】     │
│  · ExecutionProviderPort（本契约定义其职责，非 Pi 类型）    │
│  · ExecutionOutcome（research-neutral value type）         │
│                                                          │
│  ⇒ 依赖规则：本层 NEVER imports @earendil-works/pi-coding-agent │
└───────────────────────────┬──────────────────────────────┘
                            │ opaque boundary
┌───────────────────────────▼──────────────────────────────┐
│ Composition root（src/，CLI / host 装配处）                │
│                                                          │
│  · Pi AgentSession（concrete）  ← 【composition-root owned】│
│  · Pi AgentSessionServices                                  │
│  · Pi-specific lifecycle（prompt / subscribe / abort / dispose）│
│  · ExecutionProviderPort 的实现                              │
└──────────────────────────────────────────────────────────┘
```

**冻结（P1 裁定）：**

```text
Concrete Pi AgentSession is composition-root owned.
```

**不冻结（有意留给实现）：**

```text
Provider 是否同时持有所依赖的 AgentSessionServices —— 属实现细节。
research 契约 MUST NOT 依赖 Pi 内部 services 的生命周期。
```

---

## §5 Pi execution semantics（Q-EP-1 · CLOSED）

**冻结语义（契约锚点 = "prompt execution returned / settled"）：**

```text
Pi execution semantics:
- agent_end is observational/intermediate and MUST NOT by itself settle a TaskAttempt.
- Pi internal retry remains inside the same TaskAttempt.
- A provider execution is considered settled only after the underlying
  AgentSession.prompt() execution has returned, whose implementation
  guarantees agent_settled emission in the run-finalization path.
- agent_settled may be observed for lifecycle/diagnostic purposes,
  but the provider MUST NOT treat an intermediate agent_end as final outcome.
```

**事件时序（已由 Pi 源码取证确认，见 §14）：**

```text
agent_end
    ↓
可能 willRetry = true
    ↓
Pi internal retry（auto_retry / summarization_retry / compaction retry）
    ↓
...
    ↓
agent_settled          ← run-finalization 路径必定 emit（含 abort 场景）
    ↓
prompt() returns
    ↓
ExecutionProvider produces final ExecutionOutcome
```

**语义纪律：** `agent_settled` 是 Pi 对"本次执行已终局"的**可观察事件**；契约的**语义锚点**是 `prompt()` 执行返回/已 settled。两者**不是两个并列可任选的语义源**——provider 的实现路径必须以"执行返回即终局"为准，`agent_settled` 仅供生命周期/诊断观察。

---

## §6 Provider 的职责边界（Q-EP-6 · CLOSED）

```text
ExecutionProviderPort
        ↓
    execute(...)
        ↓
  ExecutionOutcome
```

**冻结方向：** `ExecutionProviderPort` 产出 `ExecutionOutcome`；**`ExecutionProviderPort` 直接调用 `TaskEngine.complete()` / `TaskEngine.fail()` 是 PROHIBITED。**

端口的具体 API shape（方法签名、参数、返回值载体）**不在本契约冻结**，属后续设计项（§15）。

### §6.1 Provider 职责（应做）

```text
1. 接收已经建立的 execution context / session；
2. 驱动模型执行；
3. 等待本次执行真正 settled；
4. 将执行结果转换成 research-neutral 的 ExecutionOutcome；
5. 负责 provider-owned execution timeout；
6. 负责把 Pi / provider 层异常转换成 execution failure；
7. 释放 / 关闭自己拥有的 concrete session。
```

### §6.2 Provider PROHIBITED（绝对不做）

```text
Provider MUST NOT:
- 修改 Task.status
- 创建 TaskAttempt
- 调 TaskEngine.complete()
- 调 TaskEngine.fail()
- 修改 Round
- 修改 Run
- 创建 Claim / Fact / Knowledge
- 创建 Candidate
- 决定 Task retry
- 创建第二套 scheduler
- 创建第二套 lifecycle state machine
```

---

## §7 `ExecutionOutcome`（research-neutral）

Provider 只产出**抽象执行结论**，不承载投资研究语义：

```text
ExecutionOutcome
├── succeeded
│   └── output / messages / raw result        （provider-owned、research-neutral）
└── failed
    └── error                                 （不推断 Task/Round 终态）
```

**冻结：**

```text
Pi AgentMessage  →  Execution Provider  →  provider-owned / research-neutral output
                                          →  TaskEngine.complete()
```

```text
Provider MUST NOT 直接进入 Claim / Fact / Knowledge / Candidate / Industry。
（同时保持 C7-B I-1：adapter 不产生领域判断。）
```

---

## §8 Timeout（Q-EP-7 · CLOSED）

```text
ExecutionProvider owns execution timeout.

Timeout:
    Provider detects timeout
        ↓
    (abort / terminate execution)
        ↓
    ExecutionOutcome = failed
        ↓
    future coordinator（AF-4）closes Task lifecycle
```

```text
NO automatic retry
NO TaskEngine scheduler
NO second timeout mechanism in TaskEngine
```

**已核实（P4）：** `ChildSessionOptions` 中 **不存在** `timeoutMs`，也 **不存在** `onSession` ⇒ 无历史字段需要兼容或复用；timeout 在端口层面属**纯新增**设计项。

> 边界说明：`timeout → failed outcome` **不等于** `timeout → retry`。R2 / C7-B 当前未授权任何自动 retry。

---

## §9 AF1-COORDINATION-BOUNDARY（AF-4 显式保留）

```text
AF1-COORDINATION-BOUNDARY

AF-1 defines the execution-provider boundary and outcome semantics.

AF-1 does NOT define:
- the production caller of stepRound();
- the owner of awaiting provider.execute();
- the exact orchestration procedure that consumes ExecutionOutcome;
- the point at which TaskEngine.complete()/fail() is invoked.

Those responsibilities belong to the future AF-4 execution-coordination layer.
```

**这不是设计漏洞，而是有意保留的架构边界。**

**并明确（EP-12）：** AF-1 **不修改** R2 `stepRound()` 的既有语义：

```text
one invocation ≤ one dispatch
MUST NOT loop to dispatch another Task after start() returns
```

⇒ 因此**禁止**以下形态（会把执行协调暗中塞进 R2）：

```text
await engine.start(taskId)
await provider.execute(session)      ← ❌ 违反 R2 step boundary
await engine.complete(...)           ← ❌
```

---

## §10 收口关系图（AF-1 Provider → Outcome；AF-4 → lifecycle closure）

```text
                    R2
             ┌────────────────┐
             │ stepRound()    │
             │ readiness      │
             │ dispatch       │
             └───────┬────────┘
                     │
                     │ engine.start()
                     ▼
             ┌────────────────┐
             │   TaskEngine   │
             │ TaskAttempt    │
             │ session handle │
             └───────┬────────┘
                     │
                     │ execution context
                     ▼
             ┌──────────────────────┐
             │ ExecutionProvider    │  ← AF-1（本契约）
             │                      │
             │ Pi AgentSession      │
             │ prompt()             │
             │ settled              │
             └──────────┬───────────┘
                        │
                        │ ExecutionOutcome
                        ▼
             ┌──────────────────────┐
             │ Future AF-4          │
             │ execution            │
             │ coordinator          │
             └──────────┬───────────┘
                        │
                 complete()/fail()
                        │
                        ▼
                 ┌─────────────┐
                 │ TaskEngine  │
                 └─────────────┘
```

> **AF-1 Provider → Outcome；AF-4 → lifecycle closure。**
> 这样 AF-4 不会重新发明 Provider 语义。

---

## §11 核心不变量（EP-1 … EP-15）

| ID | 冻结语义 |
| --- | --- |
| **EP-1** | `agent_end` 不是 TaskAttempt 终态 |
| **EP-2** | Pi internal retry 属于同一 TaskAttempt |
| **EP-3** | `prompt()` 抛错 = 当前 execution failure |
| **EP-4** | execution settlement 以 `prompt()` 完成 / settled 语义为锚 |
| **EP-5** | concrete Pi session 属于 composition root / provider 侧，不泄漏 Pi 类型到 research |
| **EP-6** | Provider 只产生 research-neutral `ExecutionOutcome` |
| **EP-7** | Provider 不调用 `TaskEngine.complete/fail` |
| **EP-8** | Provider 拥有 execution timeout |
| **EP-9** | Provider 不创建 TaskAttempt / Task lifecycle |
| **EP-10** | Provider 不创建 Claim / Fact / Knowledge / Candidate |
| **EP-11** | AF-1 不定义 AF-4 execution coordinator |
| **EP-12** | AF-1 不修改 R2 `stepRound()` 一次 invocation ≤ 一次 dispatch 语义 |
| **EP-13** | `agent_settled` 不得被解释为 TaskEngine retry / recovery event |
| **EP-14** | Provider failure 不自动触发 Task retry |
| **EP-15** | Pi-specific types 不进入 `packages/research` |

**不变量的解释纪律：**

```text
· EP-1 / EP-4 必须一起读：终局判定的唯一锚点是"执行返回"，agent_end 只是中途观测。
· EP-2 / EP-13 / EP-14 必须一起读：Pi 的内层重试既不是 TaskAttempt、也不是 TaskEngine
  retry/recovery 事件，更不得自动升级为 Task 级 retry。
· EP-7 / EP-9 / EP-10 必须一起读：Provider 只产出事实，不写任何 lifecycle / 领域实体。
· EP-11 / EP-12 必须一起读：AF-1 的边界止于 Outcome；R2 的边界止于 dispatch，二者不得互相侵入。
```

---

## §12 责任矩阵

| 关注点 | Orchestrator / R2 | TaskEngine | Execution Provider | AF-4 coordinator（future） |
| --- | --- | --- | --- | --- |
| Round readiness | ✅ | ❌ | ❌ | ❌ |
| dispatch（≤1 / invocation） | ✅ | ❌ | ❌ | ❌ |
| Task / TaskAttempt 创建 | ❌ | ✅ | ❌ | ❌ |
| 建立 execution context / session handle | ❌ | ✅ | ❌ | ❌ |
| 驱动执行 / 等待 settled | ❌ | ❌ | ✅ | ❌ |
| 产出 `ExecutionOutcome` | ❌ | ❌ | ✅ | ❌ |
| execution timeout | ❌ | ❌ | ✅ | ❌ |
| `complete()` / `fail()` 收口 | ❌ | ✅（API 提供） | ❌ （PROHIBITED） | ✅（调用方） |
| Round settlement | ✅ | ❌ | ❌ | ❌ |
| Claim / Fact / Knowledge / Candidate | ❌ | ❌ | ❌（PROHIBITED） | ❌ |

---

## §13 与既有契约的关系

```text
R2（round-execution-driver-contract.md，FROZEN）
   · 保持完整：dispatch / readiness / no-progress / settlement 语义均不因本契约改变
   · 本契约只在【dispatch 之后】接续，不回头修改 R2（EP-12）

C7-B（c7b-execution-wiring-contract.md，FROZEN）
   · 保持 I-1（adapter 不产生领域判断）与既有依赖方向
   · 本契约不重开任何 C7-B 裁定

Round Lifecycle（round-lifecycle-contract.md，FROZEN）
   · Task.failed ≠ 机械 rejected 等既有裁定不变
   · 本契约不定义 Round 状态转移

AF-2 + AF-3（TaskEngine Execution Failure Boundary，OPEN）
   · 与本契约职责不重叠：AF-1 定义【执行边界】，AF-2/3 定义【TaskEngine 失败边界】
   · 但共享一处证据：concrete session 的生命周期与清理（见 §14 P1/P4）

AF-4（execution coordinator，HOLD）
   · 本契约显式保留其职责（§9）；AF-4 不得重新发明 Provider 语义
```

---

## §14 证据基础（只读取证，0 改动）

```text
E-1  Pi AgentSession 公开表面（node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts）
     · L285 subscribe(listener): () => void     · L393 prompt(text, options?): Promise<void>
     · L292 dispose(): void                     · L485 abort(): Promise<void>
     · ★ AgentSession 上没有 close()（只有 dispose()）
E-2  Pi 结束信号（同 .d.ts）
     · L41-46 { type:"agent_end"; messages; willRetry: boolean }
     · L47-48 { type:"agent_settled" }          · L72-82 auto_retry_start / auto_retry_end
     · L66-71 compaction_end（含 aborted / willRetry / errorMessage）
E-3  Pi 运行时实现（dist/core/agent-session.js）
     · L937 async prompt(...)  →  L1057 await this._runAgentPrompt(messages)
     · L860 _runAgentPrompt：重试 while 循环 + finally { await this._emitAgentSettled(); }
       ⇒ prompt() 返回时本次执行已 settled（成功/失败/abort 均终局）
     · L367-377 _emitAgentSettled：extension emit + this._emit({ type:"agent_settled" }) + resolveIdleWait
     · L451-465 _willRetryAfterAgentEnd：依据 Pi 自身 getRetrySettings() 判定
     · L657 get isIdle() = !_isAgentRunActive && !isCompacting
     · L1334-1343 abort()：置 abort 标记 + await waitForIdle()
E-4  composition root 现状（AF-1 Wiring Gap 的直接证据）
     · src/cli/tiancha.ts:117-130 buildAgentSessionFactory()：
       const s = result.session as unknown as { close?: () => Promise<void> } | undefined;
       return { sessionId, taskId, async close() { await s?.close?.(); } }
       ⇒ 类型窄化 + 仅暴露 close()；且因 AgentSession 无 close() ⇒ 【静默 no-op，未 dispose】
     · src/agent/tiancha-agent-host.ts:134-149 askOneShot()：
       subscribe(agent_end) + await session.prompt(prompt)  ← 现有唯一执行范例
     · src/agent-factory.ts:46/55/77/92：模块级 cached 长期持有 { session }（services 为局部变量）
E-5  research 依赖方向
     · packages/research/package.json：无 dependencies / devDependencies（仅 node builtins）
       描述原文："Depends only on node builtins (structural ports; never imports coding-agent)."
     · src/index.ts 注释："Dependency rule: this package NEVER imports @earendil-works/pi-coding-agent."
     · research 全树扫描：零 @earendil 导入
     · 既有护栏：phase-b-step-b3.test.ts:90 · phase-b-step-b4.test.ts:190（no model call 正则）
E-6  TaskEngine.start() 现状（packages/research/src/runtime/task-engine.ts:53-98）
     · setStatus(running) → modelRouter.resolve → attempt 构造 → attempts.set + activeAttemptId
       → factory.create → openSessions.set → events.emit(task_attempt_started)
       → return { task, attempt, session }        ⇒ ★ session 已交给调用者
E-7  端口现状（packages/research/src/ports/agent-session-factory.port.ts:46-51）
     · ChildSession = { sessionId; taskId; close(): Promise<void> }
       注释："Minimal lifecycle wrapper around a Pi AgentSession. Deliberately does NOT expose
              the full pi session surface to research."
     · ★ ChildSessionOptions 中【不存在】timeoutMs / onSession（onSession 全仓 0 命中）
```

---

## §15 Open（本契约不裁决，供后续裁定）

```text
O-AF1-1  ExecutionProviderPort 的具体 API shape（方法签名 / 参数 / 返回载体 / 是否使用
         ExecutionOutcome 联合类型）                            🟢 CLOSED（rev2 → §18，Q-EP9-1/2/3/4）
O-AF1-2  Provider 持有粒度（session 单独 / session+services）               → 实现细节（§4）
O-AF1-3  execution timeout 的具体数值来源（配置项 / 端口参数 / 环境）        → 后续设计项
O-AF1-4  ExecutionOutcome 的 output 承载形态（文本 / messages 原件 / 引用）
                                                                🟢 CLOSED（rev2 → §18，ExecutionOutput）
O-AF1-5  「谁 await provider.execute()」+「谁收口 complete()/fail()」        → AF-4（HOLD）
O-AF1-6  preflight throw 之后 session 是否仍需 dispose 的运行时验证          → 需运行时取证（非只读可得）
O-AF1-7  concrete session 清理的真实语义（abort → dispose 还是 dispose only）→ 与 AF-2/AF-3 共同裁定
```

---

## §16 裁定记录（Q-EP-1 … Q-EP-8）

```text
Q-EP-1   🟢 CLOSED   settlement anchor = prompt() 执行返回 / settled；
                     agent_settled 为该终局的可观察事件；agent_end 不得单独作为终态
Q-EP-2   🟢 CLOSED   Pi internal retry ∈ 同一 TaskAttempt（Pi retry ≠ Task retry）
Q-EP-3   🟢 CLOSED   prompt preflight 抛错 ⇒ 当前 TaskAttempt 的 execution failure；
                     不以 Pi 的 preflightResult 钩子作为契约依赖
Q-EP-4   🟢 CLOSED   concrete Pi AgentSession → composition root / provider owned；
                     ChildSession → research 侧不透明生命周期句柄；TaskEngine 只持句柄
Q-EP-5   🟢 CLOSED   Provider 只产生 research-neutral ExecutionOutcome，不进入 Claim/Fact/Knowledge
Q-EP-6   🟢 CLOSED   新建独立 ExecutionProviderPort = YES；方向冻结为 execute(...) → ExecutionOutcome；
                     API shape 保持 OPEN（§15 O-AF1-1）
Q-EP-7   🟢 CLOSED   execution timeout 归 Provider；不新增 TaskEngine scheduler / timeout / retry
Q-EP-8   🟢 CLOSED   Provider 不直接调用 TaskEngine.complete()/fail()（PROHIBITED）
```

**rev2 追加（O-AF1-1 收口 —— 详见 §18）：**

```text
Q-EP9-1  🟢 CLOSED   session 建立者 = B（复用 TaskEngine.start() 已建立的 session）
Q-EP9-2  🟢 CLOSED   失败统一为 ExecutionOutcome.failed（+ ExecutionError.kind 作 provider 侧诊断分类）
Q-EP9-3  🟢 CLOSED   ExecutionHandle 只允许 sessionId
Q-EP9-4  🟢 CLOSED   ExecutionRequest 接受 ResearchContext
```

**仍显式保留：**

```text
AF-2 + AF-3   TaskEngine Execution Failure Boundary → 🔒 FROZEN · 🟢 PUBLISHED（eef63ac）
AF-4          execution coordinator / stepRound caller → HOLD（其依赖的最小 shape 已由 §18 裁定）
```

---

## §17 OUT 复核清单（防止越界）

```text
✅ 本契约未修改 R2 任何语义（EP-12）
✅ 本契约未定义 AF-4 coordinator 职责（EP-11，仅保留）
✅ 本契约未定义实现（无 production code / 无端口实现 / 无 TaskEngine 修改 / 无 adapter 修改）
✅ 本契约未定义 Task retry / recovery / concurrency / persistence / schema
✅ 本契约未产生 Claim / Fact / Knowledge / Candidate / 0–100 分
✅ 本契约未引入任何 Pi 类型进入 research 层的定义（EP-15）
```

---

## §18 rev2 · O-AF1-1 Adjudication — ExecutionProviderPort / ExecutionOutcome 最小语义 shape

> **本节范围：** 只解决 `execute(...)` 与 `ExecutionOutcome` 的最小 shape。
> **明确不解决：** Artifactization · `TaskEngine.complete()/fail()` 的调用责任 · AF-4 coordinator 形态 · timeout 实现 · cleanup 实现 · retry · recovery · concurrency。
> rev1 的 EP-1…EP-15 与 §1–§17 语义**逐字未改**。

### §18.1 裁定汇总（Q-EP9-1 … Q-EP9-4）

| 问题 | 裁定 |
| --- | --- |
| **Q-EP9-1** | **B** —— 复用 `TaskEngine.start(taskId)` 已建立的 session（**不**新建第二个 session） |
| **Q-EP9-2** | 失败**统一**为 `ExecutionOutcome.failed`；`ExecutionError.kind` 只作 provider 侧诊断分类 |
| **Q-EP9-3** | `ExecutionHandle` **只允许** `sessionId` |
| **Q-EP9-4** | `ExecutionRequest` **接受** `ResearchContext` |

**Q-EP9-1 = B 的实现边界（同时冻结）：**

```text
选 B ≠ 允许 Provider 直接依赖 ChildSession 的具体能力。
ExecutionHandle 是 AF-1 的 research-neutral opaque handle；
concrete Pi session 及其 sessionId → concrete session registry
仍归 composition root / provider implementation 所有。
⇒ 因此【不得】写成 execute(session: ChildSession, ...)
   （否则 Provider 会开始依赖 research-facing lifecycle abstraction，并被逐步塞入
    prompt / abort / subscribe，最终把 Pi execution API 泄漏进 research）。
```

**Q-EP9-2 = 统一为单一出口（冻结）：**

```text
不在 ExecutionOutcome 顶层增加 timeout / aborted / preflight_failed / provider_failed ...
—— 这些不是同一层面的 lifecycle state。
⇒ Provider 保持单一语义出口：
     provider.execute(...)
        ├── success            → succeeded
        └── execution failure  → failed
   而不是把 Provider 逐渐变成第二套 lifecycle engine。
```

**Q-EP9-4 = 接受 ResearchContext（冻结）：**

```text
ResearchContext 已是 research-neutral 上下文载体，且明确不是 Pi AgentMessage / entry。
⇒ 不重新拆出 resourceLoaderOptions / systemPrompt / scope / objective 再由 AF-4 造第二套
   execution context（不重复造轮子 / 不新增第二套上下文模型）。

⚠️ 但它也不能成为领域写入口：
     ResearchContext → provider execution input                     ✅
     ResearchContext → Claim / Fact / Knowledge / Candidate          ❌
   Provider 能看到 context 【不等于】Provider 可进行研究知识写回。
```

### §18.2 最小语义 shape（冻结）

```ts
interface ExecutionProviderPort {
    execute(
        handle: ExecutionHandle,
        request: ExecutionRequest
    ): Promise<ExecutionOutcome>;
}

interface ExecutionHandle {
    sessionId: string;
}

interface ExecutionRequest {
    taskId: string;
    runId: string;
    roundId?: string;
    model: string;
    thinkingLevel: string;
    context?: ResearchContext;
}

type ExecutionOutcome =
    | {
        status: "succeeded";
        output: ExecutionOutput;
      }
    | {
        status: "failed";
        error: ExecutionError;
      };

interface ExecutionOutput {
    text?: string;
    messages?: unknown[];
    raw?: unknown;
}

interface ExecutionError {
    message: string;
    kind?: string;
}
```

> **注：** 上表为**语义 shape**，**不是**实现授权；rev2 未创建任何 TypeScript。

### §18.3 `ExecutionHandle` 的构成约束（冻结）

```text
ExecutionHandle = identity，而不是 capability object。

✅ 只允许：sessionId
❌ 当前不得加入：taskId · runId · roundId · prompt() · abort() · dispose() ·
                agent · services · messages

理由：
 · taskId / runId / roundId 已属 ExecutionRequest / Task domain context；
 · prompt / abort / AgentSession / AgentSessionServices 属 concrete
   provider / composition-root implementation。
```

### §18.4 `sessionId → concrete session` registry 的四条禁令（冻结）

```text
Registry 允许存在（composition root / provider-owned），但【不得进入 research contract】：

❌ 不允许根据 `child-${taskId}` 这种字符串约定反推 session
❌ 不允许 research 层自己维护 Pi session registry
❌ 不允许把 registry 暴露为 Research port
❌ 不允许通过 ExecutionHandle 暴露 concrete session

⇒ Registry 是 implementation detail。
⇒ 并保持 AF-1 原有冻结：concrete Pi AgentSession is composition-root/provider owned.
```

### §18.5 类型泄漏与语义纪律（冻结）

```text
① `unknown[]` / `unknown` 的语义 = opaque provider output，
   【不是】允许 Pi 类型偷偷穿透：
     ExecutionOutput.messages 【不得】声明成 AgentMessage[]；
     亦【不得】通过类型别名间接泄漏 Pi 类型。

② `raw?: unknown` 可保留为最小 shape，但语义冻结为：
     "provider-owned opaque execution result;
      its persistence/materialization is outside O-AF1-1."
   ⇒ 不在 O-AF1-1 里暗示 raw → ArtifactStore（那是 R-EC-6 / AF-4 artifactization）。

③ ExecutionError.kind 不是 TaskAttempt.status，也不是 Task.status，
   更不是新的 lifecycle state machine。
     ExecutionOutcome.failed + error.kind = "timeout"
     ⇏ TaskAttempt = aborted
     ⇏ Task = cancelled
     ⇏ TaskAttempt = failed
   ⇒ Execution failure classification ≠ Task lifecycle classification（保持分离）。
```

### §18.6 四条护栏（rev2 冻结）

```text
1. Provider 不建立第二个 session
2. ExecutionHandle 不暴露 concrete Pi capability
3. ExecutionOutcome 不成为 Task/Attempt lifecycle
4. artifactization 不属于 O-AF1-1
```

### §18.7 四层关系（rev2 定格）

```text
┌───────────────────────────────────────────┐
│ R2 Round Execution Driver                 │
│  readiness → TaskEngine.start()           │
│  ≤ 1 dispatch / invocation                │
└─────────────────────┬─────────────────────┘
                      ▼
┌───────────────────────────────────────────┐
│ AF-2 / AF-3 TaskEngine                    │
│  Task lifecycle · Attempt lifecycle       │
│  start failure boundary                   │
│  finalization boundary                    │
└─────────────────────┬─────────────────────┘
                      │ ExecutionHandle
                      ▼
┌───────────────────────────────────────────┐
│ AF-1 Execution Provider                   │
│  execute(handle, request)                 │
│      → ExecutionOutcome (succeeded/failed)│
└─────────────────────┬─────────────────────┘
                      ▼
┌───────────────────────────────────────────┐
│ AF-4 Execution Coordinator                │
│  consume outcome · artifactization        │
│  complete / fail · execution coordination │
└───────────────────────────────────────────┘
```

```text
AF-4 ≠ scheduler
AF-4 ≠ TaskEngine
AF-4 ≠ Provider
AF-4 ≠ Round lifecycle
```

### §18.8 O-AF1-1 关闭声明

```text
O-AF1-1  SEMANTIC SHAPE ADJUDICATED（Q-EP9-1 … Q-EP9-4 CLOSED）
⇒ AF-4 Contract 的前置依赖已解除；但在 AF-1 rev2 Contract Review 通过前【不】进入 AF-4 Contract。
⇒ 仍未关闭：O-AF1-2（持有粒度 · 实现细节）· O-AF1-3（timeout 数值来源）·
             O-AF1-5（→ AF-4）· O-AF1-6（需运行时取证）· O-AF1-7（→ 与 AF-2/3 共同裁定）
```

---

## §19 rev2 OUT 复核清单

```text
✅ rev2 未改任何 TypeScript（未创建 Provider 实现 / 未创建 ExecutionOutcome 代码类型）
✅ rev2 未写 AF-4 / 未解决 Artifactization / 未修改 TaskEngine
✅ rev2 未修改 rev1 的 EP-1…EP-15 与 §1–§17 语义（逐字未改）
✅ rev2 未新增 Task/Round/Run lifecycle；未新增 scheduler / retry / recovery / concurrency
✅ rev2 未产生 Claim / Fact / Knowledge / Candidate / 0–100 分
✅ 未 commit · 未 push
```

---

**End of contract（rev2）**
