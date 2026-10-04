# AF-4 · Execution Coordinator Implementation Contract

> **Status:** rev1 — DOCS-ONLY · **AUTHORIZED TO DRAFT** · **NOT YET APPROVED**（待 Human Contract Review）
> **Scope:** docs-only。把已冻结的 AF-4 设计语义压缩成**可直接执行的工程合同**；**不重复** `execution-coordinator-contract.md`（693 行设计契约）。
> **上游依据（严格继承，均不修改）:** `docs/phaseC/execution-coordinator-contract.md`（AF-4 Contract rev1 · APPROVED @1e796a5）· `docs/phaseC/execution-provider-contract.md`（AF-1 rev2 · FROZEN @c3fb4d6）· `docs/phaseC/task-engine-failure-boundary-contract.md`（AF-2+AF-3 · FROZEN @eef63ac）· `docs/phaseC/round-execution-driver-contract.md`（R2 · FROZEN @275b84d）· `docs/phaseC/round-lifecycle-contract.md`（FROZEN）· `docs/phaseC/c7b-execution-wiring-contract.md`（rev4 · FROZEN）
> **本契约不授权实现。** 未授权：AF-4 production implementation · AF-2/AF-3 implementation · Run lifecycle implementation · Concurrency · Scheduler · G2-b · G2-e · C7-C · 任何代码 / 测试 / README / INDEX / HANDOFF / commit / push。

---

## §0 授权与状态

```text
AF-4 Contract rev1                       ✅ APPROVED · 🟢 PUBLISHED · 🔒 FROZEN（1e796a5）
AF-4 Implementation Contract（本文）     🟡 AUTHORIZED TO DRAFT · DOCS-ONLY · ❌ NOT YET APPROVED
AF-4 Implementation                      ❌ NOT AUTHORIZED
AF-2 / AF-3 Implementation               ❌ NOT AUTHORIZED
Run lifecycle implementation             ❌ NOT AUTHORIZED
Concurrency · Scheduler                  ⛔ OUT
G2-b · G2-e · C7-C                       🔴 HOLD
```

**本轮唯一允许的动作：在 `docs/phaseC/` 下新建本契约文件。不碰代码、不 commit、不 push。**

---

## §1 Purpose

把 AF-4 已冻结的语义（AC-1…AC-14、Gate A–E、Q-EC-1…Q-EC-7）翻译成**工程可执行、可验收**的合同：

```text
输入边界 → Provider 调用 → Outcome 处理 → Artifact → Task settlement
         → 失败/部分成功矩阵 → 时序约束 → 验证 Gate
```

**本契约的读者是未来的实现者与验收者**：它必须能被直接转成代码改动清单与测试义务。

---

## §2 Scope / Non-goals

### §2.1 Scope（本契约覆盖）

```text
S-1  输入边界与字段冻结（A）
S-2  Provider 调用边界（B）
S-3  Outcome 工程处理规则（C）
S-4  Artifact 规则与隔离（D）
S-5  Task settlement 规则（E）
S-6  失败 / 部分成功工程矩阵（F）
S-7  live-reference 时序约束（G）
S-8  验证 Gate 的工程化形式（H）
```

### §2.2 Non-goals

```text
❌ 不重复设计契约的架构论证（见 execution-coordinator-contract.md §4–§15）
❌ 不定义 R2 readiness / dispatch / settlement 语义
❌ 不定义 AF-2/AF-3 的 start failure boundary / finalization 实现
❌ 不定义 AF-1 的 Provider 内部语义（settled 锚点 / Pi 重试 / timeout 数值来源）
❌ 不实现 concurrency / retry queue / provider registry / scheduler
❌ 不做 Run lifecycle / G2-b / G2-e / C7-C / Knowledge writeback / Round evaluation
```

---

## §3 交付物白名单（Deliverables）

**实现阶段（未来、另行授权）允许触碰的文件白名单**（本契约只登记，不修改）：

```text
D-1  新增  packages/research/src/ports/execution-provider.port.ts
          `ExecutionProviderPort` · `ExecutionHandle` · `ExecutionRequest` ·
          `ExecutionOutcome` · `ExecutionOutput` · `ExecutionError`
          （结构严格等于 AF-1 rev2 §18.2）
D-2  新增  packages/research/src/application/execution-coordinator.ts
          `ExecutionCoordinator`：单 Task coordination entry + 成功/失败两条路径
D-3  修改  packages/research/src/domain/artifact.ts
          `ArtifactKind` 增加 `"execution"` 单一值（不改既有 6 值）
D-4  修改  packages/research/src/ports/index.ts
          导出 D-1 的新端口
D-5  新增  packages/research/src/phase-c7-execution-coordinator.test.ts
          测试义务 T-*（§14）
D-6  装配  src/cli/tiancha.ts（composition root）
          注入 provider 实现 + coordinator 装配（**不新增 CLI 子命令**，见 §15 O-IC-1）
```

```text
⛔ 白名单之外不得改动：task-engine.ts · domain/task.ts · domain/task-attempt.ts ·
   domain/round.ts · domain/run.ts · runtime/orchestrator.ts · runtime/model-router.ts ·
   storage/artifact-store.ts（除如实现必须，需单独授权）· 任何既有测试
```

---

## §4 A · 输入边界（`ExecutionRequest` → Coordinator）

### §4.1 唯一入口

```text
ExecutionRequest → Coordinator
```

```text
A-1  唯一合法输入 = 一个【已 dispatch】的 Task（成功经过 `TaskEngine.start()` 的返回）。
A-2  Coordinator 的 entry 语义（单 Task，不循环）：
         executeDispatchedTask(taskId: string): Promise<void>
     ⇒ 只处理这一个 Task 的一次 coordination。
A-3  Coordinator 【不】接受 queued Task，【不】做 readiness / dependency evaluation /
     `stepRound` / enqueue / start（那些属 R2 + TaskEngine）。
```

### §4.2 `ExecutionRequest` 字段冻结（结构 = AF-1 rev2 §18.2，不新增字段）

```ts
interface ExecutionRequest {
    taskId: string;          // 来自该 Task 的 domain context
    runId: string;           // 来自该 Task 的 domain context
    roundId?: string;        // 来自该 Task 的 domain context（可缺省）
    model: string;           // ★ 来自 TaskEngine.start() 建立的 TaskAttempt.model
    thinkingLevel: string;   // ★ 来自同一 TaskAttempt.thinkingLevel
    context?: ResearchContext;  // 可复用既有载体；可由上层提供，缺省即不注入
}
```

### §4.3 关联 / 身份 / 参数（工程冻结）

```text
A-4  task-attempt 关联：`attemptId` 取自【当前 active attempt】
       （权威来源：`TaskEngine.start()` 的返回 `{ attempt }`；
        不得自行生成 attempt 身份 —— R-EC-9）
A-5  provider reference：`ExecutionHandle = { sessionId: string }`
       （取自 `TaskEngine.start()` 返回的 `{ session }` 的 `sessionId`）
A-6  invocation parameters：`model` / `thinkingLevel` 一律取自 A-4 的 attempt，
       **不得重新调用 `ModelRouter.resolve()`**（AC-3 / Gate E-1/E-2）
A-7  correlation / identity：
       · Task 关联键 = `taskId`
       · artifact 关联键 = `{ taskId, attemptId, runId, roundId? }`
       · 不得引入第三套 identity 函数（C7-B I-3）
A-8  artifact kind = `"execution"`（常量，不由调用方传入）
```

---

## §5 B · Provider 调用边界

```text
Coordinator
    ↓
Provider boundary（ExecutionProviderPort）
    ↓
Provider result / error
```

```text
B-1  调用形态：`await provider.execute(handle, request): Promise<ExecutionOutcome>`
B-2  一次 coordination 至多调用 **一次**（AC-2）。
B-3  Coordinator 【不】拥有 provider registry · 【不】负责 provider discovery。
B-4  Coordinator 【不】resolve business target · 【不】替上层决定"执行什么业务"。
B-5  Provider 返回值即 `ExecutionOutcome`（AF-1 rev2）；provider 抛错 = execution failure
       （由 AF-1 rev2 定义，AF-4 只按 §9 处理）。
```

---

## §6 C · Outcome 处理规则

### §6.1 判别字段（严格继承 AF-1 rev2）

```ts
type ExecutionOutcome =
    | { status: "succeeded"; output: ExecutionOutput }
    | { status: "failed";    error:  ExecutionError };
```

```text
C-1  判别字段唯一 = `status`；取值集合唯一 = { "succeeded", "failed" }。
C-2  【禁止】重新引入 `kind` / `resultType` / `outcomeType` 作为第二套分类体系。
C-3  `ExecutionError.kind?: string` 仅作 provider 侧诊断分类，
       **不是** Outcome 判别字段，也不是 Task/Attempt lifecycle state。
```

### §6.2 工程处理规则

| `outcome.status` | 工程动作 |
| --- | --- |
| `"succeeded"` | 取 `output` ⇒ 走成功路径（§7 D → §8 E） |
| `"failed"` | 取 `error.message` ⇒ 走失败路径（§8 E，**不生成 artifact**） |

```text
C-4  两条路径互斥；不得对同一个 outcome 同时走两条。
C-5  【禁止】把 `ExecutionOutcome.status` 直接映射为 `TaskAttempt.status` 或 `Task.status`
       （AC-11 / Gate E-6）—— settlement 一律经 §8 E 的既有 API。
```

---

## §7 D · Artifact

### §7.1 kind 与隔离

```text
D-1  `ArtifactKind` 新增单一值 `"execution"`（中性执行输出载体）。
D-2  隔离（不得混用）：
         execution artifact  ≠  Evidence
                             ≠  Claim
                             ≠  Fact
                             ≠  Knowledge
                             ≠  Candidate
D-3  AF-4 【不】把 execution output 冒充 Evidence（§10.2 设计契约的措辞保持不变：
       正确边界是 "AF-4 cannot create Evidence"，**不是** "execution artifact can never become Evidence"）。
```

### §7.2 落盘字段（对齐既有 `ArtifactStore.put`）

```text
D-4  put 载荷：`{ artifact: ResearchArtifact, blob: unknown }`
D-5  ResearchArtifact 必需字段（表结构 NOT NULL）：
         artifactId · kind("execution") · schemaVersion · ref · createdAt ·
         taskId · attemptId · runId（roundId 可选）
       ⇒ `taskId` / `attemptId` / `runId` 一律取自 §4.3 A-4/A-7 的真实执行事实。
D-6  blob 承载 provider-owned 输出（opaque）；其持久化语义属本契约，但**不进入知识层**。
D-7  返回值 `ArtifactRef` 是 §8 E 成功路径的唯一输入载体。
```

### §7.3 路径规则

```text
D-8  `status === "succeeded"` ⇒ 形成 **1 个** execution artifact（不批量、不多产物）。
D-9  `status === "failed"`    ⇒ **不 artifactize**（AC-7 / Q-EC-4）。
D-10 【禁止】为失败执行自动制造 artifact（即使 provider 返回了错误 payload）。
D-11 【禁止】用 report / dossier / score / claim / fact / evidence 承载执行输出。
```

---

## §8 E · Task settlement

### §8.1 唯一结算路径

```text
成功路径：
  1. 读取 execution facts（§10 G 时序约束）
  2. 构造 ExecutionRequest（§4.2 / §4.3）
  3. await provider.execute(handle, request)
  4. outcome.status === "succeeded" ⇒ 构造 execution artifact ⇒ await artifactStore.put(...)
  5. TaskEngine.complete(taskId, [artifactRef])

失败路径：
  1. await provider.execute(handle, request)
  2. outcome.status === "failed" ⇒ TaskEngine.fail(taskId, error.message)
```

```text
E-1  `TaskEngine.complete()` / `TaskEngine.fail()` 是**唯一** Task lifecycle settlement API（AC-10）。
E-2  Coordinator 【不】直接写 `Task.status` / `TaskAttempt.status` / `Round.status` / `Run.status`。
E-3  一次 Task 只能 settlement 一次：
       · 由 TaskEngine 既有 terminal 守卫保证（终态不可转移）
       · AF-4 **不得**新增第二套幂等/去重机制
```

### §8.2 Ownership

| 对象 | Owner | AF-4 的角色 |
| --- | --- | --- |
| Task / TaskAttempt lifecycle | TaskEngine（AF-2/3） | 调既有 API，不写状态 |
| concrete Pi session / registry | composition root / provider 实现 | 只传 opaque `ExecutionHandle` |
| execution artifact（持久化） | ArtifactStore | 调既有 `put()` |
| ExecutionOutcome | Provider（AF-1） | 消费，不生产 |
| coordination 过程 | **AF-4 Coordinator** | 唯一负责者（单 Task） |

---

## §9 F · 失败 / 部分成功工程矩阵

> **本契约不实现任何 retry。** 下表只定义「现象 → 工程处置」；`是否可重试` 列一律为 **NO（本契约内）**，retry policy 未来的立项**不得**变成 scheduler。

| # | 现象（来源） | outcome `status` | 生成 artifact | 允许 settlement | 错误归属 | 可重试（本契约内） |
| --- | --- | --- | --- | --- | --- | --- |
| F-1 | `provider timeout`（AF-1 EP-8：provider 侧 timeout） | `"failed"`（`error.kind="timeout"`） | ❌ | ✅ `fail()` | Provider / AF-1 | ❌ NO |
| F-2 | `provider abort`（执行被中止） | `"failed"`（`error.kind="abort"`） | ❌ | ✅ `fail()` | Provider / AF-1 | ❌ NO |
| F-3 | `invalid output`（provider 返回不可用输出） | `"failed"`（`error.kind="provider"`） | ❌ | ✅ `fail()` | Provider / AF-1 | ❌ NO |
| F-4 | `transport failure`（链路失败） | `"failed"`（`error.kind="provider"`） | ❌ | ✅ `fail()` | Provider / AF-1 | ❌ NO |
| F-5 | `execution failure`（preflight throw 等，AF-1 Q-EP-3） | `"failed"`（`error.kind="preflight"`） | ❌ | ✅ `fail()` | Provider / AF-1 | ❌ NO |
| F-6 | `artifact failure`（`ArtifactStore.put()` 抛错） | —（outcome 已是 succeeded） | ❌（未落盘） | ❌（**不**调 `complete()`） | AF-4 / storage | ❌ NO |
| F-7 | `settlement failure`（`complete()` 抛错，如 terminal 守卫） | —（已是 succeeded） | ✅（已落盘） | ❌（调用失败） | TaskEngine（AF-2/3） | ❌ NO |

```text
F-8   orphan 允许：F-7 的产物即 orphan execution artifact；
      处置 = 不回滚 / 不伪造 completed / 不重调 complete / 不删 artifact（AC-8/AC-9）。
F-9  F-6 的语义：artifact 未落盘 ⇒ **不得**调用 `complete()`（因为没有 ArtifactRef 可传）。
      ⇒ 此时不产生 settlement；Task 保持非终态（其后续处置属 AF-2/3 / 上层问题，不在本契约）。
F-10 【禁止】rollback / transaction / compensation / delete artifact / retry complete / 自动修复。
F-11 【禁止】任何自动重试、重试队列、退避调度（本契约内）。
```

---

## §10 G · Live-reference 时序约束（原文冻结）

```text
AF-4 MUST capture/read the execution facts it needs
(model, thinkingLevel, attemptId, etc.)
before invoking TaskEngine.complete() or TaskEngine.fail().

AF-4 MUST NOT depend on the pre-settlement mutable state of
the TaskAttempt after complete()/fail() has been invoked.
```

```text
G-1  工程含义（不得被实现"优化"掉）：
       · 执行前一次性读取并保存所需 execution facts（model / thinkingLevel / attemptId / sessionId / runId / roundId?）
       · settlement 之后不得再从同一 live `TaskAttempt` 对象反推"执行前事实"
G-2  依据（事实）：`TaskEngine.start()` 返回的 attempt 与内部 registry 是**同一对象引用**，
      且 `complete()` / `fail()` 对其**原地 mutation**（task-engine.ts:70 / :103-105 / :116-118）。
G-3  【禁止】以"重新读一次会更准"为由，在 settlement 后重读 attempt 推断执行事实。
```

---

## §11 可观测性（correlation / evidence）

```text
OBS-1  执行关联键：`taskId`（+ `attemptId`）——不新增第三套 identity。
OBS-2  可观测事实来源：既有事件载体（`task_attempt_started` / `task_attempt_finished`，由 TaskEngine 发布）
       ⇒ AF-4 **不新增**事件类型、不新增持久化（C7-B I-12）。
OBS-3  artifact 可追溯：`artifactId` ↔ `{ taskId, attemptId, runId, roundId? }`（既有表结构已支持）。
OBS-4  【禁止】为 observability 新增 execution/provider/coordinator status。
```

---

## §12 特别禁止的实现漂移（逐条 + 验收断言）

| # | 禁止项 | 验收断言（未来测试必须能证否） |
| --- | --- | --- |
| D-1 | 在 Coordinator 中加入 scheduler | 全文无 `while` 循环驱动 / 无 `nextTask` / 无 `stepRound` 调用 |
| D-2 | 在 Coordinator 中做 target resolution | 无 readiness / dependency / target 解析代码 |
| D-3 | 在 Coordinator 中写 Claim / Fact / Knowledge | 无对应领域实体的构造或写回调用 |
| D-4 | 用 execution output 冒充 Evidence | artifact `kind` 恒为 `"execution"`，无 `"evidence"` |
| D-5 | 给失败执行自动制造 artifact | `status==="failed"` 路径不调用 `artifactStore.put` |
| D-6 | 用多套 outcome 分类字段 | 仅 `status` + `ExecutionError.kind?`；无 `resultType` / `outcomeType` |
| D-7 | 为了消灭 orphan 引入全局事务 | 无 transaction / rollback / compensation / 删 artifact / 重调 complete |
| D-8 | 顺手实现 concurrency | 无并发原语（Promise.all 批处理 / 队列 / 锁） |
| D-9 | 顺手实现 retry queue | 无 retry / backoff / 队列 |
| D-10 | 顺手实现 provider registry | Coordinator 不含 `sessionId → session` 映射 |

---

## §13 H · 验证 Gate（工程化）

### §13.1 每个 Gate 的**通过条件**（不再是设计可验证性，而是命令 + 测试 + observable evidence）

| Gate | 通过条件 |
| --- | --- |
| **A · 架构边界** | 静态断言：Coordinator 源文件不含 scheduler / Round / Run / Knowledge / Claim / second-lifecycle 调用（正则 + 符号扫描）；§12 D-1…D-3 全部证否 |
| **B · 状态机** | 静态断言：无新增 `execution/provider/coordinator` status 类型；`ExecutionOutcome.status` 未被映射为 Task/Attempt 状态（§12 D-6 证否） |
| **C · 副作用顺序** | 行为断言：成功路径调用序 = `provider.execute` → `artifactStore.put` → `TaskEngine.complete`；失败路径 = `provider.execute` → `TaskEngine.fail`；orphan（put 成功 + complete 抛错）时**不回滚**（§12 D-7 证否） |
| **D · 实现可验证性** | 行为断言集合：one invocation · one task · one provider execution · no re-resolve · no second session · no scheduler · success→artifact→complete · failure→fail · no direct lifecycle writes |
| **E · 事实来源一致性** | 行为断言：E-1 model 来自 attempt（不重 resolve）· E-2 thinkingLevel 同上 · E-3 attemptId 来自 active attempt · E-4 handle 来自已 dispatch session · E-5 settlement 后不反推 · E-6 `ExecutionOutcome` ≠ `TaskAttemptStatus` · E-7 `ExecutionError` ≠ `TaskAttempt.error` 写入动作 |

### §13.2 验证命令（实现完成后必须全绿）

```text
V-1  npx tsc --noEmit
V-2  npm --prefix packages/research run typecheck
V-3  node --import tsx --test packages/research/src/*.test.ts packages/research/src/providers/*.test.ts src/agent/*.test.ts src/cli/*.test.ts
V-4  node --import tsx src/cli/tiancha.ts research smoke
```

```text
V-5  基线参照：实现前的 full-suite 通过数与 smoke 结果须先记录，实现后不得回归。
V-6  observable evidence：新测试文件 `packages/research/src/phase-c7-execution-coordinator.test.ts`
     的测试名必须逐条对应 §14 的 T-* 清单。
```

---

## §14 测试义务清单（T-*）

```text
T-A1  已 dispatch 前置：对未 dispatch / 终态 Task 调用 entry ⇒ 行为符合 §4.1（不越界、不吞错）
T-A2  execution facts 来源：model / thinkingLevel 等于 attempt 的值（stub 记录 resolve 调用次数 = 0）
T-A3  handle 来源：provider 收到的 handle.sessionId == start() 返回 session 的 sessionId
T-B1  一次 coordination 只调用 provider.execute 一次（stub 调用计数 = 1）
T-B2  不访问 registry / 不做 discovery（stub 断言无对应调用面）
T-C1  仅接受 status ∈ {"succeeded","failed"}；无第二套分类字段（类型层断言）
T-C2  succeeded ⇒ 走成功路径；failed ⇒ 走失败路径（互斥）
T-D1  成功 ⇒ 恰好 1 个 artifact，kind === "execution"
T-D2  失败 ⇒ artifactStore.put 调用次数 = 0
T-D3  artifact 的 taskId/attemptId/runId 等于真实执行事实
T-E1  成功 ⇒ 调用 complete(taskId, [artifactRef]) 一次
T-E2  失败 ⇒ 调用 fail(taskId, error.message) 一次
T-E3  Coordinator 未直接写任何 status（无 setStatus / 无直接赋值）
T-F1  put 抛错 ⇒ 不调用 complete（F-6）
T-F2  complete 抛错 ⇒ 不回滚 artifact / 不重调 complete（F-7 / AC-8）
T-G1  settlement 之后修改 stub attempt 的字段 ⇒ coordinator 结果不受影响（G 时序约束）
T-G2  coordinator 在 execute 前已抓取所需 facts（断言读取时机在 settlement 之前）
T-12  静态断言：§12 D-1…D-10 全部证否（可用源文本正则 + 符号扫描）
```

---

## §15 延期项（Explicitly Deferred）

```text
O-IC-1  具体 caller adapter（CLI 子命令 / Runtime 方法 / future layer）——本契约只定义 entry 语义
O-IC-2  ExecutionRequest.context 的构造者（谁提供 ResearchContext）
O-IC-3  execution artifact 的 schemaVersion 取值
O-IC-4  ExecutionProviderPort 的实现（Pi 侧 adapter / registry）—— 属 composition root
O-IC-5  orphan execution artifact 的清理 / 诊断 —— 独立 persistence/recovery 议题
O-IC-6  durable execution-error artifact（若未来需要）—— 独立 observability 议题
O-IC-7  timeout 数值来源（AF-1 O-AF1-3）
O-IC-8  AF-2/AF-3 implementation（start failure boundary / finalization）
```

---

## §16 风险与开放项（需另行裁定）

```text
R-1  F-6 的后果（artifact 未落盘 ⇒ 无 settlement）会使 Task 停在非终态；
     其后续处置需 AF-2/3 或上层裁定 —— 本契约不引入补偿机制。
R-2  `ResearchTask.outputs` 声明为 `string[]` 而注释写 "ArtifactRefs only"（既有宽泛），
     本契约沿用既有 `complete()` 行为，不做类型改造。
R-3  `artifacts DB` 与 `TaskEngine` 内存状态的持久性边界不在本契约内（无跨库事务）。
```

---

## §17 OUT 复核清单

```text
✅ 本契约未修改 AF-4 Contract rev1 / AF-1 rev2 / AF-2·3 / R2 / R1 / C7-B 任何语义
✅ 本契约未定义实现（无代码 / 无测试 / 无 CLI 改动）
✅ 本契约未新增 outcome 分类字段（仅 status），未新增 execution/provider/coordinator status
✅ 本契约未引入 retry / concurrency / scheduler / provider registry / 全局事务
✅ 本契约未把 execution output 与 Evidence / Claim / Fact / Knowledge 混同
✅ 本契约未产生 Claim / Fact / Knowledge / Candidate / 0–100 分
✅ 本契约未修改 README / INDEX / HANDOFF；未 commit；未 push
✅ 未引入任何 Pi 类型进入 research 层的定义
```

---

**End of contract（rev1 · Implementation Contract）**
