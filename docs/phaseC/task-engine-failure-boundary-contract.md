# AF-2 + AF-3 · TaskEngine Execution Failure Boundary Contract

> **Status:** rev1 — DESIGN ONLY · **FINAL LOCK CANDIDATE**（待 Human Contract Review）
> **Scope:** docs-only。本契约不含任何实现；未授权 `task-engine.ts` 修改 / Task·TaskAttempt domain 修改 / EventBus·EventStore 修改 / AgentSessionFactory 修改 / Provider 修改 / Orchestrator 修改 / R2 修改 / 新增状态 / 新增 recovery API / 新增 cancellation semantics / 测试实现 / INDEX.md / commit / push。
> **上游依据:** `docs/phaseC/execution-provider-contract.md`（AF-1 rev1 · FROZEN @cb708b9）· `docs/phaseC/round-execution-driver-contract.md`（R2 · FROZEN）· `docs/phaseC/c7b-execution-wiring-contract.md`（rev4 · FROZEN）· `docs/phaseC/round-lifecycle-contract.md`（rev1 · FROZEN）
> **证据基础:** AF-2/AF-3 read-only Preflight（§A / §B evidence，见 §16）

---

## §0 状态

```text
AF-2  TaskEngine.start failure boundary        🟢 ACCEPTED
AF-3  Outcome-side fire-and-forget             🟢 ACCEPTED（并入 AF-2）
   Preflight                                   CLOSED（§A / §B evidence）
   Q-FB-1 … Q-FB-8                             CLOSED（裁定见 §18）
本契约                                         📄 DOCS-ONLY · 待 Human Contract Review · 未 commit / 未 push
AF-1 Execution Provider Contract               🔒 FROZEN · 📦 COMMITTED cb708b9 · NOT PUSHED
AF-4                                           🟡 HOLD（本契约显式保留）
R2 / R2 Contract                               🔒 FROZEN · 🟢 PUBLISHED（275b84d）
G2-b · G2-e · C7-C · Run lifecycle             🔴 HOLD
Concurrency                                    ⛔ OUT / FUTURE
```

---

## §1 Purpose

本契约定义 **TaskEngine 的执行事务边界（execution transaction boundary）**：`start()` 在哪个点之前必须无副作用、哪个点之后进入"已建立执行"的世界、进入之后失败如何收口，以及**任务结局（outcome）确定之后**发生的清理/事件失败会怎样。

它回答三个问题：

```text
① start() 的"启动前原子区"与"启动后失败收口区"如何划分？
② 执行失败（execution failure）、生命周期收口失败、事件持久化失败、资源清理失败
   这四类问题分别意味着什么，哪些可以反转结局、哪些不可？
③ 结论确定之后的 post-outcome finalization 失败如何被观察，而不是被吞掉或造成泄漏？
```

---

## §2 Non-goals（OUT）

本契约 **不定义**：

```text
❌ Provider 执行语义 / settled 锚点 / timeout / Pi 内部重试                 → 属 AF-1（FROZEN）
❌ AF-4 execution coordinator（谁 await / 谁调 complete()/fail()）           → §11 显式保留
❌ Round readiness / dispatch / settlement                                  → 属 R2（FROZEN）
❌ TaskDerivation / Run lifecycle / G2-e recovery / permanent impossibility → HOLD
❌ 新增 Task 状态 / 新增 TaskAttempt 状态 / 第二套 recovery state machine    → 明确不新增
❌ 新增 recovery API / 新增 cancellation semantics                           → 明确不新增
❌ 并发执行                                                                  → OUT / FUTURE
❌ persistence / schema 改造 / 事件载体改造
```

---

## §3 Terminology（本契约内冻结）

| 术语 | 含义 |
| --- | --- |
| **pre-execution resolution** | `start()` 中**任何 Task 生命周期突变之前**的解析阶段（当前实现 = `modelRouter.resolve`） |
| **execution attempt established** | Task/Attempt 已进入 running 的执行事实成立点 |
| **execution failure** | 执行本身未能成立或未能推进（含 factory 建立执行上下文失败、由 AF-1 定义的 provider execution failure） |
| **outcome** | Task/Attempt 的终局状态落地（`completed/failed` 与 `succeeded/failed/aborted`） |
| **post-outcome finalization** | outcome 已落地之后发生的收尾动作（session 清理、事件发布） |
| **lifecycle finalization failure** | 收尾阶段与生命周期登记相关的失败 |
| **event persistence failure** | 事件在 bus/store 两段路径上的失败 |
| **resource cleanup failure** | concrete session 的 `close()` 等资源释放失败 |
| **lifecycle authority（SoT）** | 生命周期事实的唯一权威来源 = Task/TaskAttempt 状态本身 |

**四类失败必须保持分离（§12）**：

```text
execution failure ≠ lifecycle finalization failure ≠ event persistence failure ≠ resource cleanup failure
```

---

## §4 两阶段边界模型（Q-FB-1 · CLOSED）

**冻结（Q-FB-1）：** 采用方向 **A，但限定为"启动前原子化 + 启动后可收口"**，**不是**整个 `start()` 全部原子。

```text
                 start()
                    │
                    ▼
        ┌─────────────────────┐
        │ PRE-EXECUTION       │
        │ RESOLUTION          │
        │ modelRouter.resolve │   ← 必须发生在任何 Task 生命周期突变【之前】
        └──────────┬──────────┘
                   │
              success
                   │
                   ▼
        ┌─────────────────────┐
        │ EXECUTION ATTEMPT   │
        │ ESTABLISHED         │
        │ Task    = running   │
        │ Attempt = running   │
        └──────────┬──────────┘
                   │
             factory.create
                   │
          ┌────────┴─────────┐
        success            failure
          │                   │
          ▼                   ▼
      session            failure settlement
      registered         （Attempt.failed + Task.failed）
```

**为何不做"全副作用原子"（理由，冻结）：** `factory.create()` 自身会产生**外部副作用**（Pi `AgentSession` 可能已被创建）⇒ 不存在真正意义上的回滚；因此边界只能落在"**解析先行 + attempt 建立后收口**"。

**特别冻结（第一条）：** 不要把 `start()` 做成"所有副作用完全原子"。真正要的是：

```text
resolve-before-mutation  +  post-attempt failure settlement
```

---

## §5 Phase 1 — Pre-Execution Resolution（Q-FB-2 · CLOSED）

**冻结契约句：**

```text
A TaskEngine pre-execution resolution failure MUST occur before any Task lifecycle mutation.
```

```text
resolve()
   ↓ throw
Task    = queued        ← 未被突变
Attempt = none
Session = none
lifecycle event = none
cleanup = none
```

**明确禁止：**

```text
❌ try { ... } catch { this.fail(taskId, error) }
   —— resolve 失败时【不存在 activeAttempt】⇒ 现行 fail() 会 throw "has no active attempt"
       ⇒ 该"修复"在语义上不可行（且已在 AF-2 Preflight 中被证明）
❌ 为 resolve 失败伪造（fake）TaskAttempt
❌ 在 resolve 之前 setStatus(task, "running")
```

**实现方向（契约要求，非本轮实施）：** 将现存的

```text
resolve(...)
setStatus(task, "running")
```

在**语义上**调整为

```text
const resolved = await resolve(...);
setStatus(task, "running");
```

即 **顺序修复（ordering fix），不新增状态**。

---

## §6 Phase 2 — Execution Attempt Established & factory failure（Q-FB-3 · CLOSED）

**冻结（Q-FB-3）：** `factory.create()` 失败属于 **"attempt 已建立后的 execution-start failure"**，由 **TaskEngine 内部完成失败收口**；**不得依赖外部 `fail()`**。

```text
factory.create()
    ↓ throw
Attempt.running → failed
Task.running    → failed
```

**明确禁止：**

```text
❌ 留下 (Task = running, Attempt = running) 后由 start() 抛出，并等某个未来 caller 猜测发生了什么
   —— 这违反 C7-B R-2（recoverability based on executable facts）
❌ 不留下任何 running attempt（收口是义务，不是可选项）
```

**返回值形态**（抛错 vs 返回失败结果）**留给实现层裁定**；本契约只冻结"**不能留下 running attempt**"这一条语义。

**理由（冻结）：** Attempt 已真正进入 execution-started 状态，该执行事实应被保留——**这里不是 rollback**。

---

## §7 Event 不是 lifecycle authority（Q-FB-4 · CLOSED）

**冻结契约句：**

```text
Research events are observational/audit projections, not lifecycle authority.
```

```text
Task / TaskAttempt lifecycle  ≠  ResearchEvent bus  ≠  ResearchEventStore
```

**两阶段失败的语义（冻结）：**

```text
③a  bus.emit() → listener throw → store.append() 未执行
    ⇒ 不得推导"task_attempt_started 没有发生"（bus fan-out 已发生）

③b  bus.emit() → store.append() → throw
    ⇒ 不得推导"Attempt 没有启动"（Attempt lifecycle 已经成立）
```

**⇒ 事件持久化的成败【不倒推】生命周期事实。**

---

## §8 Post-outcome finalization（Q-FB-5 · CLOSED）

**冻结契约句：**

```text
Post-outcome failure is not execution failure.
```

```text
EXECUTION OUTCOME
        ↓
Task/Attempt lifecycle committed        （Task = completed/failed；Attempt = succeeded/failed/aborted）
        ↓
POST-OUTCOME FINALIZATION
        ├── session close
        └── event publication
```

**冻结规则：**

```text
① finalization 动作（session close / event publication）MUST 被 await
② 一旦 outcome 落地，【不能因为 finalization 失败】重新打开或改变它
③ finalization 失败 MUST：
     · 被 await
     · 可被调用者观察
     · 不得成为 unhandled rejection
     · 不得被静默吞掉
④ 现存 `void this.finishSession(...)` / `void this.emitFinished(...)` 的形态【被本契约否定】
```

**明确留给实现层（本契约不发明新返回状态）：**

```text
finalization 失败的承载形态：throw AggregateError  或  structured secondary result
⇒ 属实现层裁定，本契约不冻结
```

**⇒ 核心语义只有一句：Post-outcome failure is not execution failure。**

---

## §9 Session ownership registry cleanup（Q-FB-6 · CLOSED）

**冻结契约句：**

```text
openSessions represents currently owned execution-session handles,
not successfully closed resources.
```

```text
try {
    await session.close();
} finally {
    openSessions.delete(taskId);        ← 即使 close() throw 也必须移除
}
```

```text
close() → throw
    ⇒ Task outcome       = unchanged
    ⇒ openSessions       = no longer owns the handle
    ⇒ cleanup failure    = observable
```

**理由（冻结）：** 现行 `await close(); delete();` 的形态把 **resource cleanup failure** 错误地变成 **lifecycle ownership never ended**（永久泄漏 handle）。concrete Pi session 是否仍存在，由 concrete provider / composition layer 自行负责其资源语义；**Research TaskEngine 不得因 close 抛错而卡死 lifecycle**。

---

## §10 Attempt ↔ Task 状态映射（Q-FB-7 · CLOSED）

**冻结（Q-FB-7）：**

```text
Attempt.aborted ≠ Task.cancelled
```

```text
Task    : queued | running | waiting | completed | failed | cancelled
Attempt : running | succeeded | failed | aborted
⇒ 两套状态【不是一一对应】⇒ 在没有新的专门契约之前【不得自动映射】
```

**冻结契约句：**

```text
TaskEngine.fail() 不得通过任意 Attempt status 参数制造未定义的 Attempt↔Task 映射。
```

```text
⇒ 现行 `fail(taskId, error, "aborted")` 得到 (Attempt = aborted, Task = failed) 的形态
  属【未定义的 lifecycle mapping】，本契约要求禁止 / 重构。
```

**明确不做（边界）：**

```text
❌ 不借本契约新增 Task.cancelled 的写入路径
   （现状：Task.cancelled 无任何写入路径 —— 该事实被记录，但 cancellation 属另一个 lifecycle 问题）
❌ 不新增 cancellation semantics
```

---

## §11 与 AF-1 / AF-4 的边界（Q-FB-8 · CLOSED）

```text
AF-1（FROZEN）
    Provider execution semantics
        · Pi execution / internal retry / prompt settlement
        · provider timeout / provider failure
        ↓
    ExecutionOutcome
    ⇒ AF-1 只定义 Provider execution failure 的【来源】与 ExecutionOutcome，
      【不】定义 Engine 的 failure settlement。

AF-2 / AF-3（本契约）
    TaskEngine execution failure boundary
        · Task start boundary / Attempt establishment
        · Task/Attempt failure settlement
        · session ownership registry / post-outcome cleanup
        · event publication failure / complete-fail semantics
        ↓
    Task / Attempt lifecycle
        ↓
    post-outcome finalization

AF-4（future · HOLD）
    ExecutionOutcome
        ↓  谁 await
        ↓  谁调用 complete()/fail()
        ↓  与 Orchestrator / Round 的协调
```

**⇒ 这三个层次不得再合并。**

---

## §12 四类失败的分离（特别冻结，第二条）

**冻结契约句：**

```text
execution failure
    ≠ lifecycle finalization failure
    ≠ event persistence failure
    ≠ resource cleanup failure
```

```text
⇒ 不要把 event / session cleanup failure 重新解释成 execution failure。
```

---

## §13 核心不变量（FB-1 … FB-16）

| ID | 冻结语义 |
| --- | --- |
| **FB-1** | `start()` 采用"启动前原子化 + 启动后可收口"，**不是**全副作用原子 |
| **FB-2** | pre-execution resolution 失败必须发生在任何 Task 生命周期突变之前 |
| **FB-3** | resolution 失败 ⇒ Task 保持 `queued`、无 Attempt、无生命周期事件、无清理 |
| **FB-4** | 禁止以 `catch → fail()` 处理 resolution 失败（无 active attempt，必然 throw） |
| **FB-5** | 不伪造 Attempt 来表达 resolution 失败 |
| **FB-6** | attempt 建立后的 `factory.create()` 失败由 TaskEngine 内部收口（Attempt.failed + Task.failed） |
| **FB-7** | 任何失败路径都**不得留下 running attempt** |
| **FB-8** | 事件不是 lifecycle authority（observational / audit projection） |
| **FB-9** | event bus/store 两阶段失败不倒推生命周期事实（③a / ③b 均不得反推） |
| **FB-10** | outcome 落地后，finalization 失败不得反转或重新打开 outcome |
| **FB-11** | finalization 动作必须被 await，且失败必须可观察（不得 unhandled rejection / 不得静默吞掉） |
| **FB-12** | `openSessions` 语义 = 当前持有的执行会话句柄，而非"已成功关闭的资源" |
| **FB-13** | `close()` 失败不得阻止 `openSessions` 移除该句柄（`finally` 语义） |
| **FB-14** | `Attempt.aborted ≠ Task.cancelled`；不得自动映射 |
| **FB-15** | `fail()` 不得通过任意 Attempt status 参数制造未定义的 Attempt↔Task 映射 |
| **FB-16** | 四类失败（execution / lifecycle finalization / event persistence / resource cleanup）必须保持分离 |

**解释纪律：**

```text
· FB-1…FB-7 构成 start 侧边界：先解析、后突变、失败必收口、不留 running attempt。
· FB-8 / FB-9 单独成组：事件永远不是 SoT。
· FB-10 / FB-11 构成 post-outcome 边界：可观察，但不可反转。
· FB-12 / FB-13 单独成组：registry 表示"仍持有的句柄"，不表示"关闭成功的资源"。
· FB-14 / FB-15 单独成组：两套状态机不自动映射；cancellation 不在本契约内。
· FB-16 是元规则：四类失败不得互相重新解释。
```

---

## §14 责任矩阵

| 关注点 | TaskEngine | EventAdapter / Store | Provider（AF-1） | AF-4 coordinator（future） |
| --- | --- | --- | --- | --- |
| pre-execution resolution | ✅（突变前） | ❌ | ❌ | ❌ |
| attempt 建立 | ✅ | ❌ | ❌ | ❌ |
| attempt 建立后的执行启动失败收口 | ✅（内部） | ❌ | ❌（只报失败事实） | ❌ |
| execution outcome 落地 | ✅（API 提供） | ❌ | ❌（PROHIBITED） | ✅（调用方） |
| post-outcome finalization（close / emit） | ✅（执行者） | ✅（持久化侧） | ❌ | ❌ |
| 事件持久化成败 | ❌（不持有该事实） | ✅ | ❌ | ❌ |
| session 句柄 registry | ✅ | ❌ | ❌ | ❌ |
| concrete session 资源语义 | ❌（composition/provider 侧） | ❌ | ✅ | ❌ |

---

## §15 对当前代码的登记性偏离清单（登记，未实施）

> **本节仅为"现状 vs 本契约要求"的事实登记，用于未来 implementation 切片；本轮未做任何代码修改。**

| # | 现状（已取证） | 本契约要求 | 相关不变量 |
| --- | --- | --- | --- |
| D-1 | `task-engine.ts:55` `setStatus(running)` 在 `:57` `resolve()` **之前** | resolve 必须先于任何 Task 生命周期突变 | FB-2 · FB-3 |
| D-2 | `:57` resolve 失败 ⇒ Task=running、无 attempt ⇒ `fail()` 必然 throw | 失败时 Task 保持 `queued` | FB-3 · FB-4 |
| D-3 | `:73` `factory.create()` 失败 ⇒ 留下 (Task=running, Attempt=running) | 由 TaskEngine 内部收口为 failed | FB-6 · FB-7 |
| D-4 | `:84` `openSessions.set` 早于 `:86` `events.emit` ⇒ emit 失败时 session 不可达 | 该形态不得保留 running 半状态 / 不可达句柄 | FB-7 · FB-12 |
| D-5 | `:108-109` / `:120-121` `void finishSession` / `void emitFinished` | 必须 await 且失败可观察 | FB-10 · FB-11 |
| D-6 | `:157` `openSessions.delete` 仅在 `close()` 成功后执行 | 必须 `finally` 语义移除 | FB-12 · FB-13 |
| D-7 | `:113` `fail(taskId, error, status="aborted")` ⇒ Attempt=aborted 而 Task=failed | 禁止未定义映射 | FB-14 · FB-15 |
| D-8 | `task_attempt_started` 事件经 bus + store 两段发布 | 事件失败不倒推生命周期 | FB-8 · FB-9 |

**说明：** 上表**不构成修改授权**；每一条都需在未来的 implementation 切片中单独授权。

---

## §16 证据基础（只读取证 · 0 改动）

```text
E-1  task-engine.ts（177 行全文）
     :28-30 三个 Map（tasks / attempts / openSessions）
     :53-98 start()：setStatus(running)@55 → resolve@57 → attempt 构造@58-69 → attempts.set@70 →
            activeAttemptId@71 → factory.create@73 → openSessions.set@84 → events.emit@86 →
            return {task, attempt, session}@97
     :100-111 complete()：attempt 变更 → task.outputs → setStatus("completed") → void×2
     :113-123 fail()：task.status 硬编码 "failed"@119 → void×2
     :142-147 setStatus 守卫：terminal 且目标不同 ⇒ throw
     :153-159 finishSession：`await session.close()` 后 `delete`（无 try/finally）
     :161-176 emitFinished：await events.emit(task_attempt_finished)
E-2  端口/实现
     · EventBusPort.emit(channel, data): void            （同步签名；listener 可同步抛错）
     · ResearchEventAdapter.emit：bus.emit 先、await store.append 后（两段式）
     · SqliteResearchEventStore.append：INSERT OR REPLACE + prepare/run（可抛错）
     · ModelRouter.resolve：单行委托 ModelResolverPort
     · src/cli/tiancha.ts:93-99 resolveModel()：纯字符串插值 ⇒ 【永不抛错】
E-3  domain
     · TaskStatus = queued|running|waiting|completed|failed|cancelled；TASK_TERMINAL_STATUSES = {completed,failed,cancelled}
     · TaskAttemptStatus = running|succeeded|failed|aborted
     · TaskAttempt = FROZEN CONTRACT（"A task is immutable; retries/resume append a new attempt"）
E-4  openSessions 生命期：declare@30 · set@84（唯一）· get@154 · delete@157（唯一，仅 close 成功后）
E-5  既有契约覆盖扫描：`docs/**` 中 start() 失败 / 部分失败 / 半完成 / partial failure /
     failure boundary / atomicity / 原子 ⇒ 命中全部属 C2/C5/C6/R1 的【事务原子性】主题；
     与 start() 相关的唯一命中是 AF-1 契约自身的 4 处引用 ⇒ 【既有契约未覆盖】
E-6  AF-1 契约 §11 明确：AF-1 不定义 start() 异常对应的 Task/Attempt 持久状态语义
E-7  C7-B R-2：recoverability based on executable facts
```

**关于 `resolveModel()` 永不抛错的记录方式（冻结表述）：**

```text
当前 composition root:   resolve failure = unreachable
generic TaskEngine contract: resolve failure = legal failure path
```

**⇒ 该事实被记录，但【不降低 AF-2 的契约优先级】。** `TaskEngine` 是 research runtime，不应因当前 CLI 的 resolver 恰好是纯插值，就把异常路径从契约中删除；否则未来更换 remote model router / provider selection / policy validation / model availability / credential resolution 时会重新遇到同一问题。

---

## §17 Open（本契约不裁决）

```text
O-FB-1  start() 在 attempt-建立后失败时的返回形态（throw vs 返回失败结果）      → 实现层
O-FB-2  post-outcome finalization 失败的承载形态（AggregateError vs structured
        secondary result）                                                  → 实现层
O-FB-3  finalization 的失败如何向上暴露（事件 / 日志 / 返回值）                → 实现层
O-FB-4  concrete session 资源语义（abort → dispose / dispose only）           → AF-1 O-AF1-7 与实现层
O-FB-5  Task.cancelled 的写入路径与 cancellation 语义                         → 独立 lifecycle 议题（本契约不处理）
O-FB-6  谁 await provider.execute() / 谁调用 complete()/fail()                → AF-4（HOLD）
```

---

## §18 裁定记录（Q-FB-1 … Q-FB-8）

```text
Q-FB-1  🟢 CLOSED   A，但限定为"启动前原子化 + 启动后可收口"，不是整个 start() 全部原子
Q-FB-2  🟢 CLOSED   resolve() 必须发生在 Task 状态突变之前；失败时保持 queued，不需要 fake attempt
Q-FB-3  🟢 CLOSED   factory.create() 失败属"attempt 已建立后的 execution-start failure"，
                    由 TaskEngine 内部失败收口；不得依赖外部 fail()
Q-FB-4  🟢 CLOSED   event bus/store 两阶段失败不倒推生命周期事实；事件不是 Task/Attempt lifecycle SoT
Q-FB-5  🟢 CLOSED   cleanup/event persistence 必须被 await，但其失败不得反转已确定的 outcome；
                    属 post-outcome failure
Q-FB-6  🟢 CLOSED   close() 失败不得阻止 openSessions 从 lifecycle registry 中移除；
                    具体资源清理失败必须可观察
Q-FB-7  🟢 CLOSED   aborted 不等于 Task cancelled；当前 fail(...,"aborted") 的映射需要禁止/重构；
                    cancelled 暂不新增写入路径
Q-FB-8  🟢 CLOSED   AF-2/3 定义 lifecycle/failure boundary；AF-1 只定义 Provider execution failure
                    的来源和 ExecutionOutcome，不定义 Engine 的 failure settlement
```

**特别冻结（两条）：**

```text
① 不要把 start() 做成"所有副作用完全原子" —— 要的是 resolve-before-mutation + post-attempt failure settlement
② 不要把 event/session cleanup failure 重新解释成 execution failure（四类失败必须分离）
```

---

## §19 OUT 复核清单

```text
✅ 未修改 task-engine.ts / Task·TaskAttempt domain / EventBus·EventStore / AgentSessionFactory /
   Provider / Orchestrator / R2
✅ 未新增 Task 状态 / TaskAttempt 状态 / recovery state machine / recovery API / cancellation semantics
✅ 未定义实现（返回形态、错误承载、暴露方式均标为 Open → 实现层）
✅ 未越界到 AF-1（Provider 执行语义）或 AF-4（coordinator）
✅ 未产生 Claim / Fact / Knowledge / Candidate / 0–100 分
✅ 未修改 INDEX.md；未 commit；未 push
```
