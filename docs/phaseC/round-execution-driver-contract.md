# Round Execution Driver Contract（rev1）

> 状态：**DESIGN ONLY · NOT IMPLEMENTED · NOT AUTHORIZED FOR IMPLEMENTATION**。
> 基线：`HEAD = origin/main = ls-remote = fc19961`（Round Lifecycle R1 = PUBLISHED）。
> 只读引用（不得修改）：[`c7b-execution-wiring-contract.md`](c7b-execution-wiring-contract.md) **rev4 = FROZEN（`10c1529`）** ·
> [`round-lifecycle-contract.md`](round-lifecycle-contract.md) **rev1（`c61e3b1`）**。
> 前置裁定：**R2 Execution Driver Semantic Adjudication = CLOSED**（Q-A1…Q-A7）· Q-C1（需独立契约）· Q-C2（先做契约设计）· Q-C3（scope 收紧）。
> 本文件只定义**执行流程语义**；不含实现、不含 schema、不含 event carrier。

---

## §1 Purpose / Non-goals

```text
Purpose（为什么存在）
  定义「谁把已经存在的 Task DAG 向前推进」：Orchestrator 内部的一个 execution procedure
  （Round Execution Driver），它【消费】现有 Task graph，串行地把 ready Task 交给既有 TaskEngine，
  在 Task 进入 terminal 后重新评估，并在全部 terminal 时触发 settlement。

Non-goals
  见 §16（明确排除）。特别地：不产生 Task（G2-b）· 不做 recovery（G2-e）· 不做并发 · 不做持久化 ·
  不实现 permanent impossibility（P-1 ∧ P-2 ∧ P-3）· 不定义 evaluation criteria。
```

---

## §2 Terminology

```text
Round Execution Driver（A）  Orchestrator 内的 execution procedure。【不是】生命周期实体（D-RED-1）。
readiness predicate          对该 Round 当前 taskIds 的【瞬时事实计算】，返回当前满足执行前提的 Task。
                             它的结果是【瞬时值】，【不是】持久状态。
serial dispatch              一次 execution procedure 内至多启动一个 Task。
terminal outcome             Task 进入 TASK_TERMINAL_STATUSES（completed | failed | cancelled）的事实。
dispatch                     Driver 决定调用 `TaskEngine.start(taskId)` 的动作。
                             **不是** `TaskEngine.enqueue(task)` —— 后者属"创建 / 登记 Task"
                             （C7-B O-2 的 Orchestrator 职责），R2 **不产生** Task。
invocation / step            一次 `execution procedure` 的【程序调用】。
                             它是调用事件，**不是** Driver 的持久状态（D-RED-1）。
                             ⇒ 全文不得出现 `Driver status` / `Driver instance state` /
                               `Driver paused` / `Driver resumed` / `Driver completed` 之类的状态化表述；
                               若描述调用结果，只能表述为"该次 invocation 的结果"。
引用既有概念（不重定义）：TaskStatus · TaskAttempt · TaskGraph · TaskEngine · settleRound ·
                        RUN_/TASK_/ROUND_TERMINAL_STATUSES。
```

---

## §3 Execution boundary

```text
· 边界：**Round = 协调边界；Task = 最小执行单位**（Q-A1，依据 C7-B R-1）
· 输入：一个已存在的 Round（roundId）及其 `round.taskIds` 对应的 Task（已在 TaskEngine 中）
· 输出：状态推进事实（Task：queued → running → terminal；Round：running → review）
· 明确：Driver **不产生/不删除 Task**；**不回答"这个 Round 应该有哪些 Task"**（属 G2-b TaskDerivation）
        —— 否则 G2-b 与 R2 会发生职责泄漏（Q-C3 §八）
```

---

## §4 Readiness predicate（保守）

```text
逻辑（瞬时事实）：
  ready(task)  ⇔  task ∈ round.taskIds
                ∧ task.status == "queued"
                ∧ ∀ dep ∈ task.dependencies : dep.status == "completed"

约束（硬）：
  R-4.1  **纯函数 / 瞬时事实**：无副作用、不持久化、**不新增任何状态**（不得引入 `readyTasks` 状态）
  R-4.2  **保守原则**：不能证明 ready ⇒ 不 dispatch
  R-4.3  **不得**由"不 ready"推导 failed / waiting / cancelled（Q-A6 · D-RED-4）
  R-4.4  **不负责** P-1 ∧ P-2 ∧ P-3（permanent impossibility closure 属另一条 capability，见 §16）
         ⇒ 明确禁止：`if (dependency.status === "failed") task.status = "failed"`
  R-4.5  空 dependencies ⇒ 在 queued 前提下立即 ready
  R-4.6  未注册进 TaskEngine 的 task ⇒ **不可证明 ready** ⇒ 不 dispatch
         （与 R1 的「未注册 = 不可证明 terminal」对称）
  R-4.7  依赖判定只看 `completed`；`failed` / `cancelled` 的依赖 ⇒ 当前 non-runnable（**不是** failed）
  R-4.8  该 non-runnable 判断**仅属于 R2 readiness 层**，**不得**被解释为 C7-B §5.1 L-5 / L-6 所定义的
         **permanent impossibility** 结论 —— 后者必须经 P-1 ∧ P-2 ∧ P-3 判定（属另一条 capability，见 §16）。
         ⇒ `failed` 依赖在 R2 层只表示"当前不能证明 ready"，**不表示**"系统已证明其永久不可执行"。
```

---

## §5 Serial dispatch

```text
· **R2 v1 = deterministic serial execution driver**：一次 execution procedure 至多启动一个 Task（Q-A3 冻结）
· 并发明确 OUT（见 §16）；未来若需 DAG 并行，另立并发语义设计
· 选取顺序（确定性）：按 `round.taskIds`（DAG 拓扑序）**第一个**满足 readiness 的 Task
  ⇒ 同输入必得同选择（确定性）；不依赖挂钟、不依赖 Map 迭代顺序
· 一次 procedure 内：选出 1 个 ⇒ dispatch ⇒ 结束本次 procedure（下一 step 由 outcome 驱动，见 §7/§8）
· 选取顺序的正式语义（Q-RED-3 裁定）：
    R2-ORDER-1  When multiple Tasks are ready, the Driver selects the **first ready Task according to
                the existing order of `round.taskIds`**.
    ⇒ 消费已有顺序（源自 `buildTaskGraph` → `topo.order` → `round.taskIds`）；**不重新计算**拓扑排序；
      **不引入** priority / timestamp / score / scheduler policy。
```

---

## §6 TaskEngine interaction

```text
· Driver 只调用**既有公开 API**：`start(taskId)` · `get(taskId)` · `list()`
· **不得修改 `TaskEngine`**；**不得**把 TaskEngine 改造成 scheduler 或自动执行器（D-RED-3）
· 既有语义（已取证，本契约不改变）：
    `async start(taskId)` → `setStatus(running)` → `modelRouter.resolve(agentRole, modelPolicy)` →
      构造 TaskAttempt → `factory.create(session)` → `openSessions.set` → emit(task_attempt_started)
      → 返回 `{ task, attempt, session }`
    ⇒ **不查任何依赖**（= O-4 的 "only local start guards" 成立）
    ⇒ **不等待业务执行完成**
· 因此「execution outcome 从哪里来」必须在 §7 明确（本契约最关键的待裁定点）
```

---

## §7 Step semantics（step-shaped execution procedure）

```text
形式（Q-RED-1 = (a) + (c)，正式裁定）：
  Execution Driver is **step-shaped**.

  Each invocation:
    · evaluates current facts（读 `round.taskIds` + 各 `Task.status` + `dependencies`）
    · dispatches **at most one** ready Task
    · does **not** wait for Task completion
    · returns after one of: dispatch / settlement / no-progress condition

  A subsequent invocation re-evaluates current facts.
```

一次 execution step 的精确语义：

```text
step(roundId):
  1. 读取当前 Round / Task / dependency facts
  2. 计算当前 ready Tasks（§4）
  3. 若存在 ready Task：
       选择一个（R2-ORDER-1，§5）
       调用 engine.start(taskId)
       本次 procedure 结束（返回）
  4. 若不存在 ready Task：
       若 allRoundTasksTerminal(roundId)：
           触发 settleRound(roundId)（§8）
       否则：
           本次 procedure 停止（§9）
       （两种情况都结束本次 procedure）
```

★ 概念澄清（关键）：

```text
re-evaluation occurs at the beginning of a **subsequent** execution step,
after the outcome has already been reported through the **existing TaskEngine API**.

⇒ outcome 的【报告】（`complete()` / `fail()`，由既有调用方在适当时机触发）
  与 execution 的【协调】（Driver 的 step）是两件事：

    facts changed（经 TaskEngine 既有 outcome API）
        → next execution step
        → re-evaluate

⇒ 完整合法链路示例：
    Execution Step #1 → start(Task A) → procedure returns
      → [外部实际执行 Task A] → engine.complete(A)（既有 outcome API）
      → Execution Step #2 → 重读 facts（A = completed）→ B 现 ready → start(B)
```

★ 明确排除（Q-RED-1 的否定项）：

```text
❌ (b) Driver 同步等待 Task 完成 —— 既有 API 不提供（无回调 / 无 outcome Promise）；
   若为此新增 `onTaskComplete` / Promise / callback / polling / `TaskEngine.wait()`
   ⇒ 等于改造 TaskEngine，违反 D-RED-3 / D-RED-10
❌ 用"轮询 + 超时"猜测 terminal
❌ 把"未见 outcome"当作 failed
❌ 在 `start()` 返回后自行循环 dispatch 下一个 Task（见 §14 D-RED-7）
```

## §8 Settlement trigger

```text
· 每次 Task 进入 terminal 后，Orchestrator 重评 readiness（Q-A5）
· 若 `round.taskIds` **全部 terminal** ⇒ 调用既有 `settleRound(roundId)`
· 该调用发生在 §7 的 step 第 4 步（不存在 ready Task 且 all terminal 时）；**不引入**独立触发机制。
  （R1 已实现：`running → review`，且仅从 running；否则原样返回）
· **不得**新增 Round 状态；**不得**由 Driver 直接写 `round.status`
  ⇒ Round 状态变更的通路仍然唯一 = `settleRound()` / `finishRound()`（R1 的 `setRoundStatus` 语义）
· settlement 之后是否 `finishRound(...)`（completed/rejected）**不在本契约**（evaluation criteria 属 OUT）
```

---

## §9 No-ready-task behavior（hard invariant）

```text
条件：`readyTasks = []` **AND** `!allRoundTasksTerminal`

⇒ 语义（**唯一允许的解释**）：
     「本次 execution procedure 无可合法 dispatch 的 Task，**停止本次推进**」

⇒ **不得**推出：Task.waiting · Task.failed · Task.cancelled · Round.rejected · Run.failed
⇒ **甚至不得**推出：Round.review
   （因为 Round Lifecycle Contract rev1 §4 规定：`running → review` **必须**满足 "all Round tasks terminal"）
⇒ **不新增**任何状态来表达"暂停"；Driver 本身没有状态（§13 / D-RED-1）
★ 这是 D-RED-4 的直接落地，也是与 C7-B rev4 §5.1 L-3 **阶段①** 的接口。
```

---

## §10 Empty Round behavior

```text
· 空 Round（`taskIds = []`）：R1 已确认 `allRoundTasksTerminal([]) === true`（`[].every` ≡ true）
· 本契约 **不改变** 该语义，也**不新增**「Round 必须至少一个 Task」的规则（沿用 R1 的记录）
· ⇒ 对空 Round：全部 terminal ⇒ 可直接 `settleRound()`（与 R1 一致）
· ★ Q-RED-4（正式裁定）：**保持 R1 已有行为** —— 空 Round 可以 settlement。
    Empty Round does not introduce a special Driver state or error;
    it follows the existing R1 settlement semantics.
  ⇒ 明确禁止：在实现里写 `if (taskIds.length === 0) throw ...`（那会新增 business invariant）
```

---

## §11 Error / exception boundary

```text
Q-RED-2（正式裁定）：`TaskEngine.start()` 抛错（unknown task / 无 active attempt / 工厂失败等）⇒
  ① **向调用方传播**（propagate to caller）
  ② **立即结束本次 execution procedure**（terminate current procedure）
  ③ Driver **不调用** `complete()` / `fail()`
  ④ Driver **不推断** Task / Attempt 的终态语义

⇒ 明确禁止：`try { engine.start() } catch { engine.fail() }`
   （会让 Driver 拥有 Task lifecycle closure 权限 ⇒ 撞 O-5 / D-RED-6）
⇒ 明确禁止：`catch → ignore`（会吞掉执行错误）
⇒ 若现有 TaskEngine 在 `start()` 异常时存在状态不一致，那是【另一个 TaskEngine 契约/bug】，
   **不由 R2 偷补**。

`complete()` / `fail()` 的既有守卫抛错（terminal 不可转移）⇒ 同样传播，不做转换。
★ 通用硬边界：Driver **不得**把任何异常翻译成 Task 状态变更或 Round 状态变更；
   **不得**把"dispatch 失败"写成 `Task.failed`（Task 只能经 TaskEngine 的 outcome 入口进入终态）。
```

## §12 Recovery boundary

```text
· R2 **不做** resume / recovery（属 G2-e，OUT）
· 但明确声明：Driver 的 readiness 判定**只基于当前瞬时事实**（`Task.status`），
  **不依赖任何未持久化的假设** —— 与 C7-B rev4 `D-C7B-12` 的
  「恢复须从持久化事实 + DAG 重新推导」保持一致
· 执行层无持久化（D-C7-C 未授权）⇒ Driver 的运行**不跨进程**；本契约不定义跨进程语义
```

---

## §13 Ownership / authority

```text
· **Orchestrator = 唯一 readiness authority**（C7-B O-4 · D-RED-2）
· **TaskEngine = attempt 创建 + execution entry，不调度**（C7-B O-3 · D-RED-3）
· **Driver = Orchestrator 内部 execution procedure，不是 lifecycle entity**（Q-A7 · D-RED-1）
· 禁止：第二 scheduler；TaskEngine 自行寻找下一 Task（Q-A4）；
       任何"两个主体同时决定 Task 是否执行"的结构
· 正确结构：
      Orchestrator
        ├─ DAG / dependency facts（读）
        ├─ readiness evaluation
        ├─ 选出一个 legal runnable Task
        ├─ invoke TaskEngine.start(taskId)          → TaskEngine 创建 Attempt + session
        ├─ 读取已经过既有 outcome API 报告的 terminal Task facts（§7）
        ├─ 重读 facts + 重评 readiness
        └─ all terminal ⇒ settleRound()
```

---

## §14 Invariants

```text
D-RED-1  Driver is not a lifecycle entity.
D-RED-2  Orchestrator is the sole readiness authority.
D-RED-3  TaskEngine.start() creates execution attempt; it does not schedule.
D-RED-4  No ready Task never implies failed / waiting / cancelled.
D-RED-5  Driver does not create or remove Tasks（Task 产生属 G2-b）.
D-RED-6  Driver writes no Round status directly（只经 settleRound / finishRound）.
D-RED-7  A single execution procedure invocation may dispatch at most one Task.
         It MUST NOT loop to dispatch another Task after `start()` returns.
         （禁止 `while (readyTask) await engine.start(...)` 形式的伪串行 —— 那实际是多步 scheduler loop）
D-RED-8  保守就绪：不可证明 ready ⇒ 不 dispatch；且不得由"不 ready"推导任何终态.
D-RED-9  Driver 不实现 permanent impossibility（P-1 ∧ P-2 ∧ P-3）.
D-RED-10 Driver 只调用既有 TaskEngine 公开 API；不新增 TaskEngine 能力.
```

---

## §15 Test obligations（实施时将验证）

```text
readiness（§4）
  · queued + 全部依赖 completed ⇒ ready
  · queued + 某依赖非 completed ⇒ 非 ready
  · 依赖为 cancelled / failed ⇒ 当前 non-runnable（且**不得**因此改 Task 状态）
  · 空 dependencies + queued ⇒ ready
  · running / 终态 task ⇒ 非 ready
  · 未注册进 TaskEngine 的 task ⇒ 非 ready
serial（§5）
  · 一次 procedure 至多产生一次 dispatch（可断言 start 调用次数）
  · 选取确定性：同输入 ⇒ 同选择（拓扑序第一个 ready）
no-ready（§9）
  · readyTasks=[] 且非全 terminal ⇒ Task 与 Round 状态**均不变**（无 waiting/failed/cancelled/review）
settlement（§8）
  · 全 terminal ⇒ settleRound ⇒ Round = review
  · settlement 不由 Driver 直接写状态（只经既有通路）
empty round（§10）
  · taskIds=[] ⇒ all terminal ⇒ 可 settle（沿用现状）
error（§11）
  · start() 抛错 ⇒ 不被翻译成任何状态变更
边界（§14）
  · Driver 不修改 TaskEngine（仅调用既有 API）；无新增状态/状态机
```

---

## §16 Explicit exclusions

```text
❌ Driver state machine（D-RED-1）              ❌ second scheduler（O-4 / D-RED-2）
❌ TaskEngine 修改（D-RED-10）                  ❌ Task state machine 修改
❌ permanent impossibility closure（P-1∧P-2∧P-3，D-RED-9）
❌ Run lifecycle                                  ❌ persistence（D-C7-C）
❌ event carrier（`round_finished` 等；GAP-EVENT-1）  ❌ evaluation criteria（含 critical path）
❌ critic 实现 · HumanGate 实现                    ❌ G2-b TaskDerivation
❌ G2-e recovery                                  ❌ **并发执行**（Q-A3 冻结为串行）
❌ C7-C                                           ❌ 修改 C7-B rev4（10c1529）
❌ 修改 Round Lifecycle Contract rev1（c61e3b1）
```

---

## §17 裁定记录（Q-RED-1…Q-RED-5 —— 全部已裁定）

```text
Q-RED-1  (a) + (c) —— Execution Driver is **step-shaped**（§7）：
           each invocation evaluates facts · dispatches at most one ready Task ·
           does not wait for Task completion · returns after dispatch / settlement / no-progress；
           a subsequent invocation re-evaluates current facts。
           ★ re-evaluation occurs at the beginning of a subsequent step, after the outcome has
             already been reported through the existing TaskEngine API（§7 概念澄清）。
           ★ (b) 明确排除：Driver 不同步等待；不得新增 onTaskComplete / Promise / callback /
             polling / TaskEngine.wait()（D-RED-3 / D-RED-10）。
Q-RED-2  start() 异常 ⇒ propagate to caller · terminate current procedure ·
           Driver 不调 complete()/fail() · 不推断 Task/Attempt 终态（§11）
Q-RED-3  多个 ready ⇒ 选 **round.taskIds 顺序中的第一个 ready Task**（R2-ORDER-1，§5）；
           不重算拓扑排序 · 不引入 priority/timestamp/score/policy
Q-RED-4  空 Round ⇒ **保持 R1 行为**（可 settle）· 不新增 special state/error（§10）
Q-RED-5  流程：rev1 amendment → pure document review → **Final Lock** →
Q-RED-6  Final-Lock 前文字级防漂移检查（本轮完成，三项均 PASS）：
           ① `dispatch` 全文统一指「Driver 调用 TaskEngine.start(taskId)」，**无 enqueue 混用**；
              §2 已补术语定义以固化该口径；
           ② 无把 Driver 写成持久对象/状态机的措辞（仅有的 2 处命中均为否定/排除语境）；
           ③ `outcome` 与 `Task lifecycle state` 未混用（§13 结构图措辞已校正为"读取已报告的 facts"）。
           implementation preflight → implementation separately authorized
```

---

## §18 R2 · Amendment 1（Dispatch Result Exposure）

```text
Amendment: 1
Status:    🔒 FROZEN（Amendment 1 · Dispatch Result Exposure —— 已经 Contract Review 通过并 Freeze）
Subject:   Dispatch result exposure —— 把 `TaskEngine.start()` 已产生的执行事实投影进 dispatched result
Change:
  ① RoundStepResult 的 dispatched 分支形状扩展（§7）——
       旧：{ kind: "dispatched"; taskId: string }
       新：{ kind: "dispatched"; taskId: string; attemptId: string; sessionId: string }
  ② §7 Step semantics 补充：`engine.start(taskId)` 返回的本次 execution facts
       被投影进 dispatched result
  ③ §14 新增 D-RED-11（Dispatched Result Identity Boundary）
Reason:    未来 Execution Caller 需要把一次 dispatch 的 execution identity
           （taskId / attemptId / sessionId）投影为 AF-4 的 `DispatchedExecutionContext`；
           而本契约当前只返回 `taskId`，且 `stepRound()` 丢弃了 `start()` 的返回值
           ⇒ 执行事实无合法上行通道（`sessionId` 全仓无其他公开读取面 —— 已取证：
             `TaskEngine.openSessions` 为 private / `TaskAttempt` 不含 sessionId）。
Scope:     dispatched result 的 identity 字段 + 一条 identity-only 不变式 only
Selected:  ★（i）平铺（不使用 R2 侧 DTO；❌ 不复用 AF-4 `DispatchedExecutionContext` ——
              形状虽恰好相同，但架构所有权不同：复用会让下层 R2 反向依赖上层 AF-4 的类型）
粒度:      ★ 只暴露 opaque `sessionId: string`
           ❌ 不暴露 `ChildSession` 对象（其含 `close(): Promise<void>`，属 lifecycle capability）
语义边界:  dispatched 的三字段表达「这次 dispatch 创建了哪一个 attempt / session」，
           【不是】execution outcome —— 不表达 completed / failed / timeout / aborted /
           artifact / provider outcome
           ⇒ 与 AF-4 的 `provider.execute()` → `ExecutionOutcome` → `complete()`/`fail()`
             之间【无语义重叠】。

D-RED-11 — Dispatched Result Identity Boundary

    The dispatched result exposes execution identity facts only:
    taskId, attemptId, and sessionId.

    It MUST NOT expose ChildSession, execution capabilities,
    lifecycle operations, or other session objects.

Semantics:
  · 不新增 TaskEngine API（D-RED-10 继续成立）
  · 不新增查询（值直接取自【同一次】 `start()` 的返回值）
  · 不等待 completion（§7「does not wait for Task completion」继续成立）
  · 不改变 dispatch 语义（仍只表示"已 dispatch"，不表示完成）
  · 不承担 `complete()` / `fail()`（§11 / Q-RED-2 继续成立）
  · ❌ 不借机加入 model / prompt / context / provider / execution outcome /
    artifact / task object
Revision identity:
  · 本 Amendment 属 `rev1` 的后续同步修订 —— **不**升级为 rev2；
  · **不**重写 §1–§17 的任何冻结文本（Amendment 记录式追加；D-RED-1…D-RED-10 本体未改）；
  · ★ Freeze 记录：本 Amendment 1 已经 Contract Review PASS（15 项）+ Freeze Gate（1–6 项全 PASS）
    后冻结 ⇒ 本文档当前有效状态 = **`R2 rev1 + Amendment 1 · 🔒 FROZEN`**；
  · 【不】修改 L3 / L4 的 Status 行 —— R2 的状态文字滞后（L3 仍写 DESIGN ONLY /
    L4 基线仍写 `fc19961`）属【独立问题】，后续单独做
    `R2 Contract Status Synchronization`，不在本 Amendment 内处理。
```

