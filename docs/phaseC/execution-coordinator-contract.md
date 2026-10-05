# AF-4 · Execution Coordinator Contract

> **Status:** rev1 — DESIGN ONLY · **FINAL LOCK CANDIDATE**（待 Human Contract Review）
> **Scope:** docs-only。本契约不含任何实现；**未授权**：AF-4 implementation · AF-2/AF-3 implementation · 任何代码修改 · 任何既有契约修改 · 测试修改/新增 · README / INDEX / HANDOFF 修改 · commit · push · 任何额外 slice。
> **上游依据（严格继承，均不修改）:** `docs/phaseC/execution-provider-contract.md`（AF-1 rev2 · FROZEN @c3fb4d6）· `docs/phaseC/task-engine-failure-boundary-contract.md`（AF-2+AF-3 · FROZEN @eef63ac）· `docs/phaseC/round-execution-driver-contract.md`（R2 · FROZEN @275b84d）· `docs/phaseC/round-lifecycle-contract.md`（rev1 · FROZEN）· `docs/phaseC/c7b-execution-wiring-contract.md`（rev4 · FROZEN）
> **证据基础:** AF-4 Read-only Preflight（12 项 + R-EC-8…R-EC-14）+ AF-4 Contract 落笔前的 `TaskAttempt` execution-facts 核对

---

## §0 Status / Frozen Boundary

```text
AF-4 Execution Coordinator              📄 rev1 · DOCS-ONLY · 待 Human Contract Review · 未 commit / 未 push
   Read-only Preflight                  CLOSED（12 项 · R-EC-8…R-EC-14 · Q-EC-1…Q-EC-7）
   Contract                             ⬜ rev1（本文件）
   Implementation                       ❌ NOT AUTHORIZED
AF-1 rev2 (Execution Provider)          🔒 FROZEN · 🟢 PUBLISHED（c3fb4d6）
AF-2 + AF-3 (Failure Boundary)          🔒 FROZEN · 🟢 PUBLISHED（eef63ac）
R2 (Round Execution Driver)             🔒 FROZEN · 🟢 PUBLISHED（275b84d）
R1 (Round Lifecycle)                    🔒 FROZEN · 🟢 PUBLISHED（fc19961）
G2-b · G2-e · C7-C · Run lifecycle      🔴 HOLD
Concurrency                             ⛔ OUT / FUTURE
```

**冻结声明：** 本契约**严格继承** AF-1 rev2 / AF-2+AF-3 / R2 / R1 的既有语义，**不修改其中任何一条**；AF-1 rev2 的 `ExecutionOutcome.status` 判别字段沿用，**不产生 AF-1 rev3**。

---

## §1 Purpose

本契约定义 **一个已经由 R2 `stepRound()` dispatch 成功的 Task，如何完成一次真实 execution 并把 execution outcome 结算回现有 TaskEngine**。

它回答四个问题：

```text
① "已 dispatch" 的输入前提是什么（AF-4 从哪里开始、到哪里为止）？
② AF-4 如何取得并使用执行事实（execution facts），而不重新推导它们？
③ 成功/失败两条路径上，execution outcome 如何落到既有 TaskEngine outcome API？
④ AF-4 绝对不做哪些事（防止调度器化 / 第二套状态机 / 知识偷渡）？
```

---

## §2 Non-goals（OUT）

```text
❌ Round readiness / dispatch / Round settlement            → 属 R2（FROZEN）
❌ Task / TaskAttempt lifecycle 定义、start failure boundary、
   post-outcome finalization                                → 属 AF-2 + AF-3（FROZEN）
❌ Provider 执行语义 / settled 锚点 / Pi 内部重试 / timeout  → 属 AF-1 rev2（FROZEN）
❌ Run lifecycle · TaskDerivation（G2-b）· recovery/resume（G2-e）· C7-C
❌ concurrency · automatic retry · cancellation · 第二套 scheduler
❌ 新增 execution / provider / coordinator status（第二套状态机）
❌ Knowledge / Claim / Fact / Evidence / Candidate 写回 · Round evaluation · Human Gate
❌ persistence / schema 改造 · 事件载体改造
❌ CLI / Agent Tool / workflow entry 等具体 caller 的实现（只定义调用边界）
```

---

## §3 Terminology

| 术语 | 含义（本契约内冻结） |
| --- | --- |
| **dispatched task** | 一个**已经成功经过 `TaskEngine.start()`** 的 Task；它是 AF-4 的唯一合法输入前提 |
| **execution facts** | `TaskEngine.start()` 已建立的执行事实：`attemptId` · `model` · `thinkingLevel` · `sessionId` · `runId` · `roundId?` |
| **coordination** | AF-4 对一个已 dispatch Task 执行的一次「provider 调用 → outcome → settlement」过程 |
| **execution artifact** | 一次 execution 产生的**输出载体**（`ArtifactKind = "execution"`），不是 Claim / Fact / Evidence / Knowledge |
| **orphan execution artifact** | `ArtifactStore.put()` 成功但 `TaskEngine.complete()` 失败的产物；属**允许的契约结果** |
| **settlement** | 既有 TaskEngine outcome API（`complete()` / `fail()`）被调用后，Task/Attempt 进入终态 |
| **knowledge SoT** | 研究事实/知识的唯一权威来源（Evidence → Claim/Fact → Knowledge 链路）；**execution artifact 不属于它** |

**术语纪律：** 本契约中 `dispatch` **始终**指 R2 的语义（`TaskEngine.start()`），不指 `execute`；`settlement` **始终**指 Task/Attempt 的终态落地（AF-2/3 语境），不指 Round 收口（R2 语境）。

---

## §4 AF-4 Position in C7-B Execution Architecture

```text
                    R2（FROZEN）
             ┌──────────────────────┐
             │ stepRound()          │
             │ readiness            │
             │ dispatch             │
             └──────────┬───────────┘
                        │ TaskEngine.start()
                        ▼
             ┌──────────────────────┐
             │ AF-2 / AF-3（FROZEN）│
             │ Task lifecycle       │
             │ Attempt lifecycle    │
             │ start failure边界    │
             │ finalization 边界     │
             └──────────┬───────────┘
                        │ { attemptId, model, thinkingLevel, sessionId }
                        ▼
             ┌──────────────────────────────┐
             │ AF-4 Execution Coordinator   │  ← 本契约
             │ 一次已 dispatch Task 的 execution │
             └──────────┬───────────────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │ AF-1 rev2（FROZEN）  │
             │ ExecutionProvider    │
             │ execute(handle, req) │
             │ → ExecutionOutcome   │
             └──────────┬───────────┘
                        │ ExecutionOutcome
                        ▼
             ┌──────────────────────────────┐
             │ ArtifactStore（execution     │
             │ artifact）→ ArtifactRef      │
             └──────────┬───────────────────┘
                        │ complete() / fail()（既有 API）
                        ▼
             ┌──────────────────────┐
             │ TaskEngine           │
             │ Task / Attempt 终态   │
             └──────────────────────┘
```

```text
AF-4 ≠ scheduler
AF-4 ≠ TaskEngine
AF-4 ≠ Provider
AF-4 ≠ Round lifecycle
AF-4 ≠ knowledge writer
```

---

## §5 Preconditions

AF-4 的一次 coordination 只有在下列前提**全部成立**时才可发起：

```text
P-1  **已 dispatch**：该 Task 已经成功经过 `TaskEngine.start(taskId)`。
     ⇒ AF-4 【不】负责 readiness / dependency evaluation / `stepRound` / enqueue / start。
     ⇒ "已 dispatch" 的最小证据 = 一次成功的 `TaskEngine.start()` 返回。
P-2  execution facts 已存在（由 `TaskEngine.start()` 建立）：
       attemptId · model · thinkingLevel · sessionId（· runId · roundId?）
P-3  `ExecutionHandle = { sessionId }` 可得（AF-1 rev2 §18.2 冻结形状）。
P-4  该 Task/Attempt 尚未进入终态（settlement 只发生一次；终态不可转移由 AF-2/3 既有守卫保证）。
```

**⇒ AF-4 的输入不是 `queued` Task；把 readiness / dispatch 纳入 AF-4 即为越界（会与 R2 合并）。**

---

## §6 Execution Coordinator Responsibility

### §6.1 职责（做）

```text
1. 接收一个已 dispatch 的 Task（见 §5）。
2. 读取其 execution facts（attemptId / model / thinkingLevel / sessionId / runId / roundId?）。
3. 组装 `ExecutionHandle` 与 `ExecutionRequest`（§7）。
4. 调用 `provider.execute(handle, request)` **一次**，并 await 其 `ExecutionOutcome`（§8）。
5. 按 outcome 分派（§9 / §11 / §12）：
     succeeded ⇒ execution artifactization ⇒ `TaskEngine.complete(taskId, ArtifactRef[])`
     failed    ⇒ `TaskEngine.fail(taskId, error)`
6. 保证一次 coordination 只涉及一个 Task、一次 provider 执行。
```

### §6.2 明确禁止（不做）

```text
❌ 不直接写 Task.status / TaskAttempt.status / Round.status / Run.status
❌ 不创建 TaskAttempt（attempt 由 `TaskEngine.start()` 建立，属 AF-2/3）
❌ 不建立第二个 session（Q-EC-… / AF-1 Q-EP9-1 = B：复用 start() 已建立的 session）
❌ 不重新调用 `ModelRouter.resolve()`（见 §7 / Gate E-1/E-2）
❌ 不调用 `stepRound()`、不推进 Round、不寻找下一个 ready Task
❌ 不循环（无 while / 无递归 driver / 无 nextTask）
❌ 不做 automatic retry / resume / recovery / cancellation / concurrency
❌ 不写 Knowledge / Claim / Fact / Evidence / Candidate
❌ 不持有 concrete Pi session 或 `sessionId → AgentSession` registry（§13）
❌ 不自行发明事务 / 回滚 / 补偿（§12）
```

### §6.3 职责矩阵

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| R2 `stepRound` | readiness / dispatch | execution |
| **AF-4 Coordinator** | **单 Task execution coordination** | **scheduler** |
| Provider（AF-1） | 执行模型、产出 `ExecutionOutcome` | Task lifecycle |
| ArtifactStore | execution artifact 持久化 | Task lifecycle |
| TaskEngine（AF-2/3） | Attempt / Task lifecycle | model execution |
| Orchestrator | Round coordination | Provider execution |
| CLI / adapter | future trigger | lifecycle ownership |

---

## §7 ExecutionRequest

**形状（严格继承 AF-1 rev2 §18.2 · 含 Amendment 1 的 `prompt` carrier）：**

```ts
interface ExecutionRequest {
    taskId: string;
    runId: string;
    roundId?: string;
    model: string;
    thinkingLevel: string;
    prompt: string;
    context?: ResearchContext;
}
```

**来源约束（冻结）：**

```text
R-1  model         ← 来自 `TaskEngine.start()` 建立的 `TaskAttempt.model`，**不得重新 resolve**
R-2  thinkingLevel ← 来自同一 `TaskAttempt.thinkingLevel`，**不得重新 resolve**
R-3  taskId / runId / roundId ← 来自该 Task 的 domain context
R-4  context       ← 可复用既有 `ResearchContext`（AF-1 rev2 Q-EP9-4）；
                     **不得**由 AF-4 另造第二套 execution context
R-5  prompt        ← **上游 execution caller 显式提供**；
                     AF-4 **不生成 / 不推断 / 不改写 / 不替换**
                     （事实来源唯一性 ⇒ 不得由 `taskId` / `objective` / `context` 推导或猜测）
```

**⇒ 禁止形态（会导致 start 与 execute 使用不同模型，并与 Attempt 执行事实脱节）：**

```text
TaskEngine.start() → ModelRouter.resolve() → （结果丢弃） → AF-4 再次 resolve()
```

**⇒ AF-4 也不得把 `ResearchContext` 当作领域写入口（AF-1 rev2 §18.1 冻结）。**

---

## §8 Provider Invocation

```text
await provider.execute(handle, request) → ExecutionOutcome
```

```text
I-1  一次 coordination 【至多】调用 provider.execute() 一次。
I-2  不重试、不并发、不批量、不做多 Task 流水线。
I-3  provider 侧异常语义由 AF-1 rev2 定义（preflight 抛错 / timeout / abort 均归入 execution failure）；
     AF-4 不解释 Pi 内部重试（Pi retry ∈ 同一 TaskAttempt，AF-1 Q-EP-2）。
I-4  AF-4 不调用 `TaskEngine.complete()` / `fail()` 之外的任何 Task lifecycle API；
     provider 亦不得直调它们（AF-1 EP-7 / §6.2 PROHIBITED）。
```

---

## §9 ExecutionOutcome Handling

**形状（AF-1 rev2 §18.2，判别字段为 `status`）：**

```ts
type ExecutionOutcome =
    | { status: "succeeded"; output: ExecutionOutput }
    | { status: "failed";    error:  ExecutionError };

interface ExecutionOutput { text?: string; messages?: unknown[]; raw?: unknown; }
interface ExecutionError  { message: string; kind?: string; }
```

**★ Invariant（同名不同层，冻结）：**

```text
TaskAttemptStatus and ExecutionOutcome.status are distinct semantic layers.

AF-4 MUST NOT infer one from the other solely because their values
share names such as "succeeded" or "failed".
```

**正确关系：**

```text
Provider
   │
   ▼
ExecutionOutcome
   │
   │ coordinator interprets（本契约 §11）
   ▼
TaskEngine.complete() / fail()
   │
   ▼
TaskAttempt.status + Task.status
```

**禁止形态：**

```text
ExecutionOutcome.status === "failed"
        ⇒ TaskAttempt.status = "failed"      ❌（会把 AF-4 变成第二个 lifecycle writer）
```

**三层严格分离：**

```text
ExecutionOutcome.status   = execution outcome 的判别字段
ExecutionError.kind       = 可选的错误诊断分类（不是 lifecycle state）
TaskAttempt.status        = TaskAttempt lifecycle 状态（AF-2/3 域）
⇒ 三者不得混用、不得互推。
```

---

## §10 Execution Artifact

### §10.1 `ArtifactKind` 新增中性值（冻结）

```ts
ArtifactKind =
  | "fact"
  | "claim"
  | "evidence"
  | "score"
  | "report"
  | "dossier"
  | "execution"        // ★ 新增：一次 execution 的输出载体
```

```text
语义冻结：
  `execution` 仅表示一次执行产生的原始/结构化【输出载体】，
  不是 Claim、不是 Fact、不是 Evidence、不是 Knowledge，
  也不是新的知识 SoT。
```

### §10.2 知识边界（与 C7-B I-1 的关系，措辞按裁定收紧）

```text
C7-B I-1 直接禁止的是：**执行层不得直接产生 Claim / Fact / Knowledge**
（必须经 Candidate → Human Review → projection）。
⇒ 本契约【不】把 "Evidence" 口头扩大解释成 I-1 的直接文字约束；
   但架构上 AF-4 同样【不得】把执行结果伪装成 Evidence
   —— 那会把 execution output 偷渡进研究事实层。

⇒ 因此 AF-4 的 artifactization 只允许落在中性 `execution` kind 上。
```

```text
AF-4 的职责止于：
    Execution → execution Artifact → Task completed

后续（不属于 AF-4）：
    execution artifact → candidate extraction → human review → Claim/Evidence → Knowledge
```

### §10.3 `ArtifactStore.put()` 与必需字段

```text
`ResearchArtifact` 必需字段（storage/artifact-store.ts 表结构 NOT NULL）：
    artifactId · kind("execution") · schemaVersion · ref · createdAt · taskId · attemptId · runId
    （roundId 可选）
⇒ `attemptId` 必须来自 §5 P-2 的**真实 active attempt**，【不得】新建 execution attempt identity
   （AF-4 Q-EC-… / R-EC-9）。

调用：`artifactStore.put({ artifact, blob }) → ArtifactRef`
      blob 承载 provider-owned opaque 输出（AF-1 rev2 §18.5②：其 persistence/materialization
      语义属本契约；但【不】暗示它进入知识层）。
```

### §10.4 禁止

```text
❌ execution artifact ⇒ Claim / Fact / Evidence / Knowledge
❌ 用 report / dossier / score / claim / fact / evidence 复用来承载执行输出
❌ 让 provider 自己写 ArtifactStore（AF-1 §6.2 PROHIBITED：Provider 只产出 ExecutionOutcome）
❌ 让 TaskEngine 调用 provider 或 ArtifactStore（会使其承担 execution orchestration）
```

---

## §11 Task Lifecycle Settlement

### §11.1 成功路径（顺序冻结）

```text
1. 确认 Task/Attempt execution context（§5）
2. 读取 execution facts（在执行前完成，见 §15 的 live-reference 时序约束）
3. 构造 ExecutionRequest（§7）
4. `await provider.execute(handle, request)`
5. outcome = succeeded
6. 构造 execution ArtifactRecord（kind = "execution"）
7. `await artifactStore.put(...)` → 获得 `ArtifactRef`
8. `TaskEngine.complete(taskId, [artifactRef])`
```

### §11.2 失败路径（顺序冻结）

```text
1. `await provider.execute(handle, request)`
2. outcome = failed
3. `TaskEngine.fail(taskId, error)`
   ⇒ error 取自 `ExecutionError.message`
   ⇒ **默认不产生 execution artifact**（Q-EC-4；错误已由 AF-2/3 的 TaskAttempt.error 承载）
```

### §11.3 唯一 settlement API

```text
`TaskEngine.complete()` / `TaskEngine.fail()` 仍是 Task lifecycle settlement 的【唯一】API。
⇒ AF-4 只调用它们，不直接写 status（§6.2）。
⇒ AF-4 不得把它们重解释为第二套 Task 生命周期状态机（C7-B I-13）。
```

---

## §12 Failure / Partial Success Boundary

### §12.1 无跨操作原子性（冻结）

```text
`ArtifactStore.put` 成功  ≠  `TaskEngine.complete` 成功
⇒ 两者不是一个事务；AF-4【不要求】跨操作原子性。
```

### §12.2 orphan execution artifact（允许）

```text
允许的契约结果：
    put() 成功 → complete() 失败
    ⇒ Task = 非 completed（仍为 running 等）；Artifact = 已存在
    ⇒ 称为 orphan execution artifact
```

```text
出现 orphan 时，AF-4：
✅ 不回滚已有 artifact
✅ 不伪造 Task completed
✅ 不重新调用 complete() 试图"修复"
✅ 不删除 artifact
✅ artifact 仍然只是 execution output carrier
⇒ 如何清理/诊断 orphan artifact 属【独立 persistence/recovery 议题】（本契约不解决）
```

### §12.3 禁止（防止第二套协调状态机）

```text
❌ rollback / transaction / compensation
❌ delete artifact / retry complete / 自动修复
```

### §12.4 前置自检（允许但有界限）

```text
AF-4 可以在 `put()` 前自检"自己仍持有合法的 Task/Attempt 执行上下文"，
以避免明显的无效写入；但【不得】因此宣称实现原子性。
```

---

## §13 Ownership / Dependency Direction

### §13.1 所有权

```text
· concrete Pi `AgentSession` / `AgentSessionServices` / `sessionId → AgentSession` registry
    → composition root（`src/cli/tiancha.ts`，见 §16 E-4）与 provider implementation 所有
· `ExecutionHandle = { sessionId }`  → AF-1 rev2 冻结的 opaque 身份
· Task / TaskAttempt lifecycle        → TaskEngine（AF-2/3）
· execution artifact（持久化）         → ArtifactStore
```

### §13.2 AF-4 不拥有 registry（四条禁令，引用 AF-1 rev2 §18.4）

```text
❌ 不允许根据 `child-${taskId}` 这种字符串约定反推 session
❌ 不允许 research 层自己维护 Pi session registry
❌ 不允许把 registry 暴露为 Research port
❌ 不允许通过 ExecutionHandle 暴露 concrete session
⇒ AF-4 只把 opaque `ExecutionHandle` 交给 Provider；查找 concrete session 是 provider 实现/装配问题。
```

### §13.3 依赖方向

```text
AF-4 ──依赖──▶ AF-1（ExecutionProviderPort / ExecutionOutcome，FROZEN）
AF-4 ──依赖──▶ AF-2/3（TaskEngine.complete / fail，FROZEN）
AF-4 ──依赖──▶ ArtifactStore（既有 API）
AF-4 ──不依赖──▶ Pi / AgentSession / AgentSessionServices / ModelRouter.resolve
⇒ 反向依赖禁止：TaskEngine 不得调用 provider；AF-4 不得被 R2 / Orchestrator 反向驱动成循环。
```

---

## §14 AF-4 vs R1 / R2 / AF-1 / AF-2·3

```text
R2（FROZEN）          readiness / dispatch / ≤1 dispatch per invocation
                      ⇒ 本契约不改 R2；AF-4 不调用 stepRound、不做 readiness
R1（FROZEN）          Round lifecycle（running → review → completed|rejected）
                      ⇒ 本契约不定义 Round 状态转移；AF-4 不写 Round
AF-1 rev2（FROZEN）   Provider execution semantics / ExecutionOutcome / Handle / timeout
                      ⇒ AF-4 只消费 provider 产出，不定义 Provider 内部语义
AF-2 + AF-3（FROZEN） Task/Attempt lifecycle / start failure boundary / finalization
                      ⇒ AF-4 调既有 outcome API，不重定义失败边界
                      ⇒ AF-4 继承并接受 AF-2/3 的 post-outcome finalization 语义（可观察、不可反转）
```

---

## §15 Invariants

### §15.1 核心不变量（AC-1 … AC-14）

| ID | 冻结语义 |
| --- | --- |
| **AC-1** | AF-4 的输入前提是「已 dispatch」（成功经过 `TaskEngine.start()`）；不承担 readiness / dispatch |
| **AC-2** | 一次 coordination 只处理一个 Task、只调用 provider 一次（one invocation · one task · one execution） |
| **AC-3** | `model` / `thinkingLevel` 来自 `TaskEngine.start()` 建立的 `TaskAttempt`，**不重新 resolve** |
| **AC-4** | 不建立第二个 session（复用 `start()` 已建立的 session；AF-1 Q-EP9-1 = B） |
| **AC-5** | `artifactization` 只使用中性 `execution` ArtifactKind |
| **AC-6** | execution artifact 不是知识 SoT；不得成为 Claim / Fact / Evidence / Knowledge |
| **AC-7** | 失败默认不产生 execution artifact（Q-EC-4） |
| **AC-8** | `put()` 与 `complete()` 无跨操作事务；orphan execution artifact 允许 |
| **AC-9** | 不得 rollback / transaction / compensation / delete artifact / retry complete / 自动修复 |
| **AC-10** | `TaskEngine.complete()` / `fail()` 是唯一 Task lifecycle settlement API；AF-4 不直接写 status |
| **AC-11** | `TaskAttemptStatus` 与 `ExecutionOutcome.status` 是不同语义层，**不得互推** |
| **AC-12** | AF-4 不循环、不做 scheduler、不调 `stepRound()`、不推进 Round、不写 Run |
| **AC-13** | AF-4 不持有 registry，不通过 `ExecutionHandle` 暴露 concrete session |
| **AC-14** | 不新增 execution / provider / coordinator status（第二套状态机） |

### §15.2 ★ live-reference 消费时序约束（冻结原文）

```text
AF-4 MUST capture/read the execution facts it needs
(model, thinkingLevel, attemptId, etc.)
before invoking TaskEngine.complete() or TaskEngine.fail().

AF-4 MUST NOT depend on the pre-settlement mutable state of
the TaskAttempt after complete()/fail() has been invoked.
```

```text
说明：核心不是禁止引用 attempt 对象，而是禁止
    complete()/fail() → 再从同一个 live attempt 推断"执行前事实"。
（依据：`TaskEngine.start()` 返回的 attempt 与 `this.attempts` 中的是同一对象引用，
 complete()/fail() 对其原地 mutation —— 见 §16 E-3。）
```

### §15.3 可验证性（Contract Review 闸门 A–E → 测试义务）

**Gate A · 架构边界** —— 不得出现：

```text
AF-4 → scheduler · AF-4 → Round · AF-4 → Run · AF-4 → Knowledge · AF-4 → Claim · AF-4 → second lifecycle
（任一出现即退回）
```

**Gate B · 状态机** —— 不得新增：

```text
execution status · provider status · coordinator status
且不得把 ExecutionOutcome 解释成 Task 状态。
```

**Gate C · 副作用顺序** —— 必须为：

```text
Provider → ArtifactStore.put → TaskEngine.complete（成功路径）
Provider → TaskEngine.fail（失败路径）
并允许 orphan（put 成功 + complete 失败）。
```

**Gate D · 未来实现可验证性** —— 实现必须能直接导出下列测试义务：

```text
one invocation · one task · one provider execution
no re-resolve（AC-3）· no second session（AC-4）
no scheduler（AC-12）· no direct lifecycle writes（AC-10）
success → artifact → complete（§11.1）
failure → fail（§11.2）
```

**Gate E · 事实来源一致性** ——

```text
E-1  model 来自 TaskAttempt，不重新 resolve
E-2  thinkingLevel 来自 TaskAttempt，不重新 resolve
E-3  attemptId 来自当前 active Attempt
E-4  ExecutionHandle 来自已 dispatch 的 session
E-5  不在 settlement 后从 live Attempt 反推 execution facts
E-6  ExecutionOutcome ≠ TaskAttemptStatus
E-7  ExecutionError ≠ TaskAttempt.error 的生命周期写入动作
```

---

## §16 Evidence / Current-Code Facts

```text
E-1  TaskAttempt 的 execution facts（domain/task-attempt.ts:25-40）
       attemptId · taskId · startedAt · endedAt?
       ★ model: string（:31）· ★ thinkingLevel: ThinkingLevel（:32）
       toolCalls · tokenUsage · cost · status · error? · outputs
E-2  它们的来源（runtime/task-engine.ts:57-63）
       :57 const resolved = await this.modelRouter.resolve(task.agentRole, task.modelPolicy)
       :62   model: resolved.model
       :63   thinkingLevel: resolved.thinkingLevel as TaskAttempt["thinkingLevel"]
     · ResolvedModel（ports/model-resolver.port.ts:8-11）= { model: string; thinkingLevel: string }
       ⇒ port 层为 `string`，写入时强转为 ThinkingLevel（无运行时校验）
     · TaskAttempt 只有一处定义（:25）+ 一处构造（:58）⇒ 无第二形状
     · ThinkingLevel 取值集（domain/research-context.ts:10-17）= off|minimal|low|medium|high|xhigh|max
E-3  ★ live reference（runtime/task-engine.ts）
       :70 this.attempts.set(attempt.attemptId, attempt)   ⇒ 与 start() 返回的是同一对象引用
       :103-105 complete() 原地 mutation（status/endedAt/outputs）
       :116-118 fail()     原地 mutation（status/endedAt/error）
E-4  composition root 与 registry 位置（src/cli/tiancha.ts:1-10 注释）
       "tiancha CLI — composition root.
        This is the ONLY place that imports @earendil-works/pi-coding-agent
        and binds the real Pi implementations to @tiancha/research Ports."
     · session 创建点：buildAgentSessionFactory()（L101-133，局部函数，丢弃 result.session，只留 { close? }）
     · 现有 3 个装配点：L147（research smoke → TianchaRuntime）· L278（research ingest material）·
       L488（research target/candidate CLI）—— 均与 execution 无关
E-5  ArtifactStore（storage/artifact-store.ts）
       ArtifactRecord = { artifact: ResearchArtifact; blob: unknown }
       put(record) → ArtifactRef · get · listByRun · listByTask · close
       表 research_artifact：artifact_id PK, kind, schema_version, run_id, round_id, task_id,
                             attempt_id, created_at, blob（task_id/attempt_id/run_id NOT NULL）
E-6  ArtifactKind（domain/artifact.ts:6-12）= fact | claim | evidence | score | report | dossier
       ⇒ 无中性 execution kind（R-EC-8）
     · 现网用法：opportunity-discovery-service.ts:211-223 `kind:"claim"`（C3/C4 material pipeline）
                 src/cli/tiancha.ts:202（smoke）`kind:"evidence"` + 假 attemptId "smoke-attempt"
     · 全仓不存在 execution 专用 kind 约定
E-7  TaskEngine complete/fail 行为（runtime/task-engine.ts）
       complete()（:100-111）：attempt 变更 → task.outputs → setStatus("completed")
                                → void finishSession → void emitFinished
       fail()（:113-123）：task.status 硬编码 "failed"（:119）→ void ×2
       ResearchTask.outputs 声明为 `string[]`（domain/task.ts:73），注释 "ArtifactRefs only"
E-8  AF-4 相关调用入口现状（全仓扫描）
       stepRound 生产调用者 = 0 · finishRound = 0 · TaskEngine.complete = 0 · TaskEngine.fail = 0
       startRound 唯一生产调用者 = smoke · ExecutionProviderPort / ExecutionOutcome / provider.execute = 0
E-9  R-EC-8…R-EC-14 全部 ACCEPTED（AF-4 Read-only Preflight）
```

---

## §17 Open Questions / Explicitly Deferred

```text
O-AC-1   ExecutionProviderPort 的最终放置位置（ports/ 内新增文件 vs 其他）           → Implementation Preflight
O-AC-2   ExecutionCoordinator 的最终放置位置（application/ vs runtime/ vs 新层）     → Implementation Preflight
O-AC-3   ArtifactKind 新增 "execution" 的具体修改点与迁移影响                         → Implementation Preflight
O-AC-4   execution artifact 的 schemaVersion 取值约定                                 → Implementation Preflight
O-AC-5   ExecutionRequest 中 context 的最终来源（谁构造 ResearchContext）             → Implementation Preflight
O-AC-6   具体 caller adapter（CLI / Runtime / future layer）的形态                    → 后续（本契约只定义调用边界）
O-AC-7   orphan execution artifact 的清理/诊断                                       → 独立 persistence/recovery 议题
O-AC-8   durable execution-error artifact（若未来需要）                              → 独立 observability 议题
O-AC-9   timeout 的具体数值来源（AF-1 O-AF1-3）                                       → AF-1 / 实现层
```

---

## §18 Decision Log（Q-EC-1 … Q-EC-7）

```text
Q-EC-1  🔒 CLOSED   新增中性 `execution` ArtifactKind（不复用 claim/fact/evidence/report/dossier/score）
Q-EC-2  🔒 CLOSED   不要求跨操作原子性（no cross-operation atomicity）；允许 orphan execution artifact
Q-EC-3  🔒 CLOSED   新建独立薄 Execution Coordinator / Application Service（不是 scheduler，
                    不放在 stepRound / TaskEngine / Provider / CLI 内部）
Q-EC-4  🔒 CLOSED   failed 默认不产生 execution artifact（错误由 ExecutionError → fail() 承载）
Q-EC-5  🔒 CLOSED   model / thinkingLevel 复用 `TaskEngine.start()` 建立的执行事实，不重新 resolve
Q-EC-6  🔒 CLOSED   定义单 Task coordination entry（语义如 `executeDispatchedTask(taskId)`）；
                    caller adapter 可后置；不循环、不调 stepRound、不推进 Round
Q-EC-7  🔒 CLOSED   AF-4 不承担 registry；只把 opaque ExecutionHandle 交给 Provider
```

**继承自上游的裁定（不重开）：**

```text
AF-1 rev2   Q-EP9-1 = B（复用 start() 的 session）· Q-EP9-2 = 统一 failed outcome ·
            Q-EP9-3 = ExecutionHandle 仅 sessionId · Q-EP9-4 = 接受 ResearchContext
AF-1        EP-1…EP-15（含 EP-7 Provider 不直调 complete/fail）
AF-2/3      FB-1…FB-16（含 FB-14 Attempt.aborted ≠ Task.cancelled · FB-16 四类失败分离）
R2          D-RED-1…D-RED-10（含 D-RED-7 一次 invocation ≤ 一次 dispatch）
```

---

## §19 OUT / Freeze Checklist

```text
✅ 本契约未修改 AF-1 rev2（沿用 ExecutionOutcome.status 判别字段；不产生 AF-1 rev3）
✅ 本契约未修改 AF-2/AF-3 / R2 / R1 / C7-B 任何既有语义
✅ 本契约未定义实现（无 production code / 无端口实现 / 无 coordinator 实现 / 无 TaskEngine 修改）
✅ 本契约未新增 execution / provider / coordinator status，也未新增第二套 scheduler / lifecycle writer
✅ 本契约未把 execution artifact 知识化（未进入 Claim / Fact / Evidence / Knowledge / Candidate）
✅ 本契约未定义 concurrency / retry / resume / recovery / cancellation / Run lifecycle / Round evaluation
✅ 本契约未产生 Claim / Fact / Knowledge / Candidate / 0–100 分
✅ 本契约未修改 README / INDEX / HANDOFF；未 commit；未 push
✅ 未引入任何 Pi 类型进入 research 层的定义
```

---

## §20 AF-4 Design · Amendment 1（ExecutionRequest `prompt` carrier）

```text
Amendment: 1
Status:    IMPLEMENTED / PENDING REVIEW（【不是】APPROVED / FROZEN —— 待 Contract Review）
Subject:   ExecutionRequest prompt carrier
Change:
  · §7 shape 增加 `prompt: string;`（位于 `thinkingLevel` 后、`context?` 前）
  · §7 来源约束增加 `R-5`（prompt 的唯一来源）
  · §7 继承声明同步更新（含 AF-1 rev2 Amendment 1 的 `prompt` carrier）
Reason:    synchronize AF-4 Design with AF-1 rev2 Amendment 1
Scope:     ExecutionRequest shape + prompt source constraint only
Semantics: prompt originates from the upstream execution caller;
           AF-4 does not generate / infer / rewrite / replace it
Revision identity:
  不创建新的 AF-4 contract revision（不产生 rev2；不改写 L3 / L13 的 Status 行）
```

```text
【声明（冻结）】
  · 本 Amendment 只同步 `ExecutionRequest.prompt` 的 shape 与来源约束；
  · 【不】改变 §8–§19 的任何语义；
  · 【不】修改 L3 / L13 的 Status 行（AF-4 Design 自身的状态文字滞后属【独立问题】，不在本 Amendment 内处理）；
  · 【不】引入任何 `ExecutionInput` / prompt resolver / prompt policy / runtime abstraction。
```

```text
✅ 本 Amendment 只改 §7（shape / 继承声明 / 来源约束）+ 新增本 §20。
✅ 本 Amendment 未改 `execute(handle, request)` 调用关系（§8 Provider Invocation 未动）。
✅ 本 Amendment 未改 Ownership / Invariants / Artifact / Settlement / Failure Boundary。
```

---

**End of contract（rev1）**
