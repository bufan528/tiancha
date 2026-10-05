# AF-1 · Execution Provider Implementation Contract

> **Status:** rev1 + **Amendment 1** — DOCS-ONLY · **REVIEWED（第一轮）** · **NOT YET APPROVED**（待第二轮 Contract Review）· 未 commit
> **Amendment 1（最小修订，落实 A-1…A-4 + 责任矩阵 + 5 个硬 Gate）:**
> · **A-1 → §3**：`AF-1 creates execution-provider.port.ts` · `AF-4 only consumes`（**不改 AF-4 文件**）
> · **A-2 → §6.1**：新增 **IP-R2-1…IP-R2-4**（ownership 必须固定；`openSessions = inaccessible`；具体形态不锁）
> · **A-3 → §7**：新增结果不变量（preserve `TaskAttempt.model`；禁 re-resolve；禁 substitute）
> · **A-4 → §8**：R-4 保持 DEFER；新增「AF-1 implementation 不得复制 `close()` bug」约束
> · 额外 → **§9 责任矩阵**（AF-1 / AF-4 逐能力归属）· **§13.3 T-G1…T-G5**（五个硬 Gate）
> **Scope:** docs-only。把 AF-1 rev2 已冻结的 Provider 语义 + 本次 Preflight 的 BLOCKING 缺口（G-01/G-02/G-03/G-06）收敛成**可实施、可验收的工程合同**；**不重复** `execution-provider-contract.md`（AF-1 rev2 设计契约）。
> **上游依据（严格继承，均不修改）:** `docs/phaseC/execution-provider-contract.md`（AF-1 rev2 · FROZEN @c3fb4d6）· `docs/phaseC/execution-coordinator-contract.md`（AF-4 · FROZEN @1e796a5）· `docs/phaseC/execution-coordinator-implementation-contract.md`（AF-4 rev2+A-9 · FROZEN @19d8758）· `docs/phaseC/task-engine-failure-boundary-contract.md`（AF-2+AF-3 · FROZEN @eef63ac）· `docs/phaseC/round-execution-driver-contract.md`（R2 · FROZEN @275b84d）· `docs/phaseC/round-lifecycle-contract.md`（FROZEN）· `docs/phaseC/c7b-execution-wiring-contract.md`（rev4 · FROZEN）
> **证据基础:** AF-1 Provider Implementation Preflight（只读 · P0 / P0-1 / P0-2 全 **BLOCKED** · G-01…G-08）
> **本契约不授权实现。** 未授权：AF-1 Provider implementation · AF-4 implementation · AF-2/AF-3 implementation · 任何代码 / 测试 / R2 / TaskEngine / CLI / ModelRouter / Adapter 修改 · commit · push。

---

## §0 授权与状态

```text
AF-1 rev2（Execution Provider Contract）     🔒 FROZEN · 🟢 PUBLISHED（c3fb4d6）
AF-1 Provider Preflight                     🟢 COMPLETE / READ-ONLY
                                              P0 = BLOCKED · P0-1 = BLOCKED · P0-2 = BLOCKED
AF-1 Implementation Contract（本文）        🟡 rev1 + Amendment 1 · DOCS-ONLY
                                              REVIEWED（第一轮）· ❌ NOT YET APPROVED · 未 commit
                                              待修订项 A-1…A-4 已落实
AF-1 Provider Implementation                ⛔ NOT AUTHORIZED
AF-4 Implementation                         ⛔ NOT AUTHORIZED
AF-2 / AF-3 Implementation                  ⛔ NOT AUTHORIZED
R2 · TaskEngine                             🔒 FROZEN / 不修改
Run lifecycle · G2-b · G2-e · C7-C          🔴 HOLD
Concurrency · Scheduler · Retry             ⛔ OUT
```

**本轮唯一允许的动作：修订本契约文件（Amendment 1）。不碰代码、不改 AF-4 / TaskEngine / R2 / CLI / ModelRouter / Adapter、不 commit、不 push。**

---

## §1 Purpose

AF-1 rev2 已经把 Provider 的**语义**冻结（execution boundary / settlement anchor / Handle / Outcome / timeout）。
Preflight 证明这些语义在**代码中零存在**（`ExecutionProviderPort` / `ExecutionProvider` / `provider.execute` / `ExecutionOutcome` 全仓 0 命中，含测试）。

本契约要把四件**最危险的边界**翻译成可实施、可验收的工程约束：

```text
① Provider 到底是什么（与 buildAgentSessionFactory 的区分）
② concrete session 到底谁拥有（ownership）
③ sessionId 到底怎么解析（opaque lookup）
④ Attempt.model 到底怎么进入实际执行（model propagation）
```

**这四条锁住以后，AF-1 才具备进入 Implementation Gate 的资格。**

---

## §2 Scope / Non-goals

### §2.1 Scope

```text
S-1  类型落地位置（A）
S-2  Provider implementation 形态与依赖（B）
S-3  session ownership / registry 的**行为边界**（C）
S-4  model propagation（D · HARD REQUIREMENT）
S-5  session lifecycle：close() 与 dispose()/abort() 的关系（E）
S-6  与 AF-4 的接口关系（F）
```

### §2.2 Non-goals

```text
❌ 不重复 AF-1 rev2 的语义论证（settlement anchor / Pi internal retry / timeout 归 provider）
❌ 不定义 AF-4 Coordinator 的执行协调（属 AF-4 rev2）
❌ 不定义 AF-2/AF-3 的 failure boundary / finalization
❌ 不解决 G-04（future integration caller）—— 属 AF-4 的集成边界，DEFERRED
❌ 不解决 G-05（现有 CLI close→dispose 缺陷）—— 记录但不实现，DEFERRED
❌ 不引入 scheduler / concurrency / retry / 第二套状态机
❌ 不在本契约阶段锁死具体技术方案（尤其 registry 的具体实现类）
```

---

## §3 交付物白名单（Deliverables）

**实现阶段（未来、另行授权）允许触碰的文件白名单**（本契约只登记，不修改）：

```text
D-1  新增  packages/research/src/ports/execution-provider.port.ts
          `ExecutionProviderPort` · `ExecutionHandle` · `ExecutionRequest` ·
          `ExecutionOutcome` · `ExecutionOutput` · `ExecutionError`
          （结构严格等于 AF-1 rev2 §18.2；不得新增字段）
D-2  新增  packages/research/src/providers/pi-execution-provider.ts（放置位置见 §5 IP-B-1）
          `PiExecutionProvider implements ExecutionProviderPort`
D-3  修改  packages/research/src/ports/index.ts
          导出 D-1 的新端口
D-4  装配  src/cli/tiancha.ts（composition root）
          注入 provider 实现；**不新增 CLI 子命令**
D-5  新增  packages/research/src/phase-c7-execution-provider.test.ts
          测试义务 T-*（§13）
```

```text
⛔ 白名单之外不得改动：task-engine.ts · domain/** · runtime/orchestrator.ts ·
   runtime/model-router.ts · storage/artifact-store.ts · 任何既有测试 · R2 相关文件
```

**★ A-1（已裁定·冻结）：端口文件的创建顺序唯一**

```text
唯一合法顺序：
    AF-1 Provider Implementation  →  创建 packages/research/src/ports/execution-provider.port.ts（本契约 D-1）
    AF-4 Implementation           →  只 import / consume 该文件
                                  →  【不得】再次创建、不得重新定义、不得复制

⇒ AF-1 侧：D-1 = NEW（保留）
⇒ AF-4 侧：其 Implementation Contract §3 的 D-1 应改为
     D-1 = existing dependency / consume only
   并明确：AF-4 不创建、不重新定义、不复制 execution-provider.port.ts。
⇒ ⛔ 本契约【不改动 AF-4 契约文件】；AF-4 侧的表述修订属
     「AF-4 Contract micro-amendment」，须由用户单独授权（见 §15 R-1）。
```

---

## §4 A · 类型落地

```text
IP-A-1  下列 6 个类型全部落在【同一新增文件】
          packages/research/src/ports/execution-provider.port.ts
            · ExecutionProviderPort   （interface）
            · ExecutionHandle         （interface）
            · ExecutionRequest        （interface）
            · ExecutionOutcome        （type，判别字段 = status）
            · ExecutionOutput         （interface）
            · ExecutionError          （interface）
IP-A-2  结构【逐字等于】AF-1 rev2 §18.2；【不得】新增字段、不得改名、不得引入第二套判别字段
IP-A-3  【禁止】在这些类型中出现 Pi 类型（AgentSession / AgentMessage / PromptOptions /
        AgentSessionServices）；`messages` / `raw` 一律保持 `unknown` 系（EP-15 / AF-1 rev2 §18.5①）
IP-A-4  该文件属 research 层 ⇒ 仍适用「packages/research 永不 import @earendil-works/pi-coding-agent」
```

---

## §5 B · Provider implementation

### §5.1 形态

```text
IP-B-1  【放置位置】新增 `packages/research/src/providers/pi-execution-provider.ts`
          · ⚠️ `providers/` 目录已被 C6 RMA 的 ModelExtractionAdapter 占用 ⇒
            新文件必须以 **execution-provider** 命名，class 以 **PiExecutionProvider** 命名，
            与 `OpenAiCompatibleModelAdapter`（`implements ModelExtractionAdapter`）显式区分
          · 备选位置（待裁定）：`runtime/`（与 TaskEngine/Orchestrator 同层）
IP-B-2  【implementation 边界】`PiExecutionProvider implements ExecutionProviderPort`
          · 它是 **composition root 侧** 的实现（可 import Pi）
          · research 的 ports 只提供接口；实现不得反向把 Pi 类型带回 research 的 domain
IP-B-3  【务必区分】`buildAgentSessionFactory`
            ≠ `ExecutionProvider`
          · 前者只 `create()` 出 session（无 execute / 无 ExecutionOutcome）
          · ⛔【禁止】把 `buildAgentSessionFactory` 包装一下即宣布 Provider 完成
IP-B-4  【务必区分】`OpenAiCompatibleModelAdapter implements ModelExtractionAdapter`
            ≠ `ExecutionProvider`
          · 前者用于 C6 RMA 的**模型提取**（`extractBatch`），与执行无关
```

### §5.2 调用契约（严格继承 AF-1 rev2）

```text
IP-B-5  `execute(handle: ExecutionHandle, request: ExecutionRequest): Promise<ExecutionOutcome>`
          · 入参 handle  = { sessionId: string }（opaque 身份，非能力对象）
          · 入参 request = { taskId, runId, roundId?, model, thinkingLevel, prompt, context? }
          · 返回 outcome = AF-1 rev2 §18.2 的联合类型（status: "succeeded" | "failed"）
IP-B-6  一次 execute 对应一次执行；provider 不循环、不批量、不自建 scheduler
IP-B-7  error semantics：provider 抛错 ⇒ 归入 execution failure（由 AF-1 rev2 定义）
          · preflight throw / timeout / abort 等一律表达为 `{ status: "failed", error }`
          · `ExecutionError.kind` 仅作 provider 侧诊断分类（不是 lifecycle state）
IP-B-8  settlement anchor：provider 内部必须遵守 AF-1 rev2 §5
          （`agent_end` 带 willRetry 不得单独作为终态；以 `prompt()` 执行返回 / settled 为准）
          ⇒ 本契约不重复该语义，只要求 provider 实现遵守
IP-B-9  timeout：归 provider（AF-1 EP-8）；`timeout → failed outcome`，**不是** retry
```

---

## §6 C · Session ownership / Registry（**只锁行为边界**）

### §6.1 冻结的 ownership 边界（★ A-2 已裁定）

```text
IP-C-1  【行为边界·冻结】
          Provider 必须通过 composition-root / provider-owned 的
          **opaque session lookup** 获得 concrete session；
          【不得】访问 TaskEngine 的 private state。
IP-C-2  语义问题与答案（冻结）：
          · 谁 register  ：session 创建方在创建后登记（宿主 = composition root / provider 侧）
          · 谁 lookup    ：provider（以 opaque `ExecutionHandle.sessionId` 为键）
          · 谁持有 concrete session ：composition root / provider 侧
          · 谁 dispose   ：session 生命周期结束时（见 §8）
          · 何时 remove  ：session 生命周期结束后
IP-C-3  【禁止·冻结】
          ❌ Provider 访问 `TaskEngine.openSessions`（private）
          ❌ 按 `child-${taskId}` 之类的字符串约定反推 session
          ❌ 把 lookup 暴露为 Research port
          ❌ 通过 `ExecutionHandle` 暴露 concrete session
          ❌ 让 AF-4 Coordinator 承担 registry 职责（AF-4 rev2 AC-13）

★ A-2（已裁定·冻结）：**ownership 必须在契约中固定；具体形态不锁** ——
IP-R2-1  TaskEngine 【不得】成为 Provider 的 concrete-session lookup backend。
IP-R2-2  Provider 【不得】访问 TaskEngine private `openSessions`（= **inaccessible**）。
IP-R2-3  Provider 【只能】通过 opaque `sessionId` 访问 provider / composition-root-owned lookup。
IP-R2-4  lookup 的具体数据结构 / 类名可以留给 implementation，
         但 **ownership 必须在契约中固定**。
           ⇒ 本契约固定的 ownership = composition root / provider side（IP-C-1 / IP-C-2）
           ⇒ 具体形态（SessionRegistry class / Map / provider-owned store /
             composition-root closure）不锁（IP-C-4）

⇒ 「TaskEngine 只持 opaque 句柄」是 **AF-1 Provider Implementation 的实现前提**
   （必须落实 ownership seam），但 ⛔【不得】为此刻意修改 TaskEngine（见 IP-C-6）。
```

### §6.2 明确**不**在本契约锁死的部分

```text
IP-C-4  【不锁具体实现】lookup 的具体形态（SessionRegistry class / Map / provider-owned store /
        composition-root closure）留给 Implementation Contract review 时，基于当前代码决定。
        ⇒ 本契约只锁 IP-C-1…IP-C-3 的行为边界（先锁行为，再决定最小实现）。
```

### §6.3 与既有代码的关系（事实）

```text
IP-C-5  现状（事实，不改）：session 目前只存在于 `TaskEngine.openSessions`（private Map，
        `task-engine.ts:30`；set@84 / get@154 / delete@157），且 `start()` 的返回值在
        `orchestrator.ts:215` 被丢弃 ⇒ 当前**不存在**任何可供 provider 使用的 lookup。
IP-C-6  ⛔ 本契约**不**要求修改 TaskEngine 来开放该 Map（会重新打开已冻结的生命周期边界）。
        ⇒ lookup 的宿主与建立方式属本契约的**待裁定项**（§15 R-2）。
```

---

## §7 D · Model propagation（**HARD REQUIREMENT**）

```text
IP-D-1  【HARD REQUIREMENT·冻结】模型传递链必须成立且可验证：
            TaskAttempt.model  →  provider execution input  →  concrete AgentSession  →  实际执行 model
IP-D-2  ❌ 不得重新调用 `ModelRouter.resolve()`（AF-1 rev2 Q-EP9-5 / AF-4 rev2 A-6）
IP-D-3  ❌ 不得接受一个与 `TaskAttempt.model` 不一致的 model
          ⇒ provider 必须把 `request.model` 实际用于 concrete session 的构造/执行
IP-D-4  【现状缺口 G-06（事实）】`src/cli/tiancha.ts:117-122`
            `createAgentSessionFromServices({ services, sessionManager, noTools: "all", model: undefined })`
          ⇒ 当前 concrete Pi session **未证明**使用了 attempt 记录的 resolved model
IP-D-5  【测试 Gate】必须存在可测试证据证明「attempt.model 与实际执行 model 一致」
          · 测试必须能证否「provider 忽略了 request.model」
          · 不得仅以「理论上应该一样」作为验收依据

★ A-3（已裁定·冻结）：**锁结果不变量，不锁实现位置**（原文）

```text
Provider execution path MUST preserve the TaskAttempt.model selected by the upstream attempt;
the concrete implementation may place the final model injection at the provider /
composition-root boundary, but must not re-resolve or substitute a different model.
```

```text
⇒ 必须可测试证明：`attempt.model === actualModel`（T-3 / T-D1）
⇒ `ModelRouter.resolve()` 调用次数 = 0（T-2 / T-D2 · forbidden）
⇒ 允许实现选择 composition-root/provider seam 放置 model 注入；
   ⛔ 但【不得】重新 resolve、不得替换成不同的 model
```
```

---

## §8 E · Session lifecycle（`close()` 与 `dispose()` / `abort()`）

```text
IP-E-1  【必须明确】`ChildSession.close()` 的语义，以及它与 Pi `dispose()` / `abort()` 的关系。
          【事实·G-05】Pi `AgentSession` 的真实 API：
              dispose(): void        （`agent-session.d.ts:292`）
              abort(): Promise<void> （`:485`）
              ⇒ 【没有 close()】
          【事实·G-05】CLI 实现（`src/cli/tiancha.ts:123/127-129`）：
              const s = result.session as unknown as { close?: () => Promise<void> } | undefined;
              async close() { await s?.close?.(); }
              ⇒ 可选调用 ⇒ **静默 no-op** ⇒ concrete Pi session 从未 dispose
IP-E-2  【本契约的权限边界·冻结】
          · 契约可以规定**正确的 ownership / lifecycle 语义**
          · ⛔ 但【不在本契约撰写阶段修改现有 CLI / R2】
IP-E-3  【G-05 的处置·冻结】**记录但不实现**（DEFER）
          ⇒ 本契约只在 §16 登记该偏离，不引入修复切片
IP-E-4  【候选语义·待裁定，不锁】`close()` 的工程语义 = 释放执行会话；
          其实现是否委托 `dispose()`、是否需要先 `abort()`（`abort → dispose` 还是 `dispose only`），
          属实现层裁定（与 AF-1 rev2 O-AF1-7 / AF-2/3 O-FB-4 同源）。
IP-E-5  【约束】无论采用何种语义，provider / composition root **不得**沿用
          「调用一个不存在的 `close()` 再静默忽略」的形态。

★ A-4（已裁定·冻结）：R-4 保持 **DEFER**，并加一条实现期约束 ——

```text
AF-1 implementation 【不得】继续依赖当前已经确认存在问题的
`close()` → Pi `AgentSession` 生命周期假设。

⇒ 【不要求现在修】（不改 CLI / 不改 R2）—— 该缺陷属独立 session lifecycle 边界（G-05，DEFERRED）；
⇒ ⛔ 但【也不能在新 Provider 中复制这个 bug】
   （即：新建的 Provider 不得写出「调用不存在的 close() 并静默忽略」的代码）。
```
```

---

## §9 F · 与 AF-4 的接口关系

```text
IP-F-1  【依赖方向·冻结】
            AF-4 Coordinator  ──consumes──▶  AF-1 Provider
          ⇒ AF-1 【不修改】 AF-4；AF-1 的实现不得反向要求 AF-4 变更契约
IP-F-2  ⛔【禁止】把 G-04（future integration caller：谁持有 `TaskEngine.start()` 返回值
          并投影为 `DispatchedExecutionContext`）偷塞进 Provider 的实现范围。
          ⇒ G-04 属 AF-4 的 future integration seam，状态 = DEFERRED（§14）
IP-F-3  ⛔【禁止】Provider 直接调用 `TaskEngine.complete()` / `fail()`（AF-1 EP-7）
IP-F-4  ⛔【禁止】Provider 承担 artifactization（AF-1 EP-6 / AF-4 AC-5）
```

### §9.1 AF-1 / AF-4 责任矩阵（★ A-1 配套新增 · 可审计事实）

| 能力 | AF-1 | AF-4 |
| --- | --- | --- |
| `ExecutionProviderPort` | **定义 / 提供** | 消费 |
| concrete Provider | **实现** | 不实现 |
| session lookup | **提供 / 使用既定 ownership** | 不访问内部实现 |
| TaskEngine dispatch | 不负责 | 不负责 |
| `DispatchedExecutionContext` | 不生产 | 消费 |
| `ArtifactStore` | 不负责 artifact settlement | **负责** |
| `complete()` / `fail()` | 不调用 | **负责** |
| `ModelRouter.resolve` | 禁止重新调用 | 禁止重新调用 |
| Knowledge writeback | 禁止 | 禁止 |

```text
⇒ 用途：implementation review 时一眼即可发现
   「AF-1 改了不该改的东西」或「AF-4 偷偷实现 Provider」。
```

---

## §10 四个最危险边界的冻结（本契约的核心）

```text
① Provider 到底是什么
     执行 provider ≠ session factory ≠ model extraction adapter。
     Provider = `ExecutionProviderPort` 的实现，输入 opaque handle + ExecutionRequest，
     输出 ExecutionOutcome；不写 Task/Round/Run 状态，不 artifactize，不调度。
     ⇒ IP-B-3 / IP-B-4 / IP-B-5 / IP-F-3 / IP-F-4

② concrete session 到底谁拥有
     composition root / provider 侧拥有 concrete Pi AgentSession；
     TaskEngine 只持不透明句柄；AF-4 只传 opaque handle。
     ⇒ IP-C-1 / IP-C-3 / AF-1 rev2 Q-EP-4 / AF-4 rev2 AC-13

③ sessionId 到底怎么解析
     经 composition-root / provider-owned 的 **opaque lookup**；
     禁止访问 TaskEngine private state、禁止字符串反推、禁止经 handle 暴露 concrete session。
     具体 lookup 形态【不在本契约锁定】。
     ⇒ IP-C-1 / IP-C-3 / IP-C-4

④ Attempt.model 到底怎么进入实际执行
     `TaskAttempt.model → provider execution input → concrete session → 实际执行 model`，
     必须可测试证明；禁止重新 resolve、禁止不一致 model。
     ⇒ IP-D-1…IP-D-5
```

---

## §11 核心不变量（IP-1 … IP-13）

| ID | 冻结语义 |
| --- | --- |
| **IP-1** | Provider = `ExecutionProviderPort` 实现；`buildAgentSessionFactory` 与 `ModelExtractionAdapter` 均**不是** Provider |
| **IP-2** | 6 个类型落在同一新增端口文件，结构逐字等于 AF-1 rev2 §18.2，不得新增字段 |
| **IP-3** | 类型中不得出现任何 Pi 类型（含别名间接泄漏）；research 层仍零 Pi import |
| **IP-4** | concrete Pi session 归 composition root / provider 侧拥有；TaskEngine 只持 opaque 句柄 |
| **IP-5** | Provider 仅通过 composition-root/provider-owned opaque lookup 解析 `sessionId` |
| **IP-6** | 【禁止】访问 TaskEngine private state / 字符串反推 sessionId / 暴露 concrete session |
| **IP-7** | lookup 的具体实现形态**不在本契约锁定**（先锁行为边界） |
| **IP-8** | `TaskAttempt.model → execution → 实际 model` 必须成立且可测试证明（HARD REQUIREMENT） |
| **IP-9** | 禁止重新 `ModelRouter.resolve()`；禁止与 attempt 不一致的 model |
| **IP-10** | `close()` 与 `dispose()`/`abort()` 的关系必须明确；不得沿用「调用不存在的 close() 再静默忽略」 |
| **IP-11** | Provider 不写 Task/Round/Run 状态、不 artifactize、不调度、不 retry |
| **IP-12** | AF-1 不修改 AF-4；G-04（future integration caller）不进入 Provider 实现 |
| **IP-13** | ownership 边界按 §6.1 的 **IP-R2-1…IP-R2-4** 执行：TaskEngine 不得作 concrete-session lookup backend；`openSessions` = inaccessible；Provider 只能经 opaque sessionId 走 provider/composition-root-owned lookup；**具体形态不锁，ownership 固定** |

---

## §12 Gap 处置登记（按裁定归类）

| Gap | 裁定 | 下一步 |
| --- | --- | --- |
| **G-01** 类型零存在 | 🔴 BLOCKING | 本契约 §4（A）解决 |
| **G-02** 无 concrete Provider | 🔴 BLOCKING | 本契约 §5（B）解决 |
| **G-03** session lookup 无宿主 | 🔴 BLOCKING | 本契约 §6（C）锁行为边界；具体形态留待实施裁定 |
| **G-04** `DispatchedExecutionContext` 无生产者 | 🟡 DEFER | future integration caller（AF-4 集成边界），**不进入 AF-1 实现**（§9 IP-F-2） |
| **G-05** `close()` → no-op | 🟡 DEFER | 记录、**暂不修**（§8 IP-E-3 / §16） |
| **G-06** `model: undefined` | 🔴 BLOCKING | 本契约 §7（D）HARD REQUIREMENT |
| **G-07** `complete()/fail()` 生产调用点 = 0 | 🟢 AF-4 范围 | 不处理 |
| **G-08** `providers/` 命名混淆 | 🟢 Contract clarification | 本契约 §5 IP-B-1 / IP-B-4 明确 |

**⇒ 本契约必须解决：G-01 · G-02 · G-03 · G-06；记录但不实现：G-05；明确不处理：G-04 · G-07 · G-08。**

---

## §13 验证 Gate（工程化）

### §13.1 通过条件

| Gate | 通过条件 |
| --- | --- |
| **A · 类型落地** | 6 类型存在于同一端口文件；结构逐字等于 AF-1 rev2 §18.2；类型文本零 Pi 类型（静态断言） |
| **B · Provider 身份** | `PiExecutionProvider implements ExecutionProviderPort`；静态断言其不依赖 `buildAgentSessionFactory` 作为 execute 实现；不存在 `ModelExtractionAdapter` 混用 |
| **C · session 解析** | 行为/静态断言：provider 不引用 `openSessions`；不出现 `child-${`反推；`ExecutionHandle` 仅含 `sessionId` |
| **D · model 传递** | 行为断言：provider 实际使用 `request.model`（stub 可观察）；`ModelRouter.resolve()` 调用次数 = 0；不一致 model 被拒绝或不可能出现 |
| **E · lifecycle** | 契约层：`close()` 语义与 `dispose()`/`abort()` 关系明确；实现层不得出现「可选调用 + 静默忽略」形态 |
| **F · 接口关系** | 静态断言：AF-1 未修改 AF-4 相关文件；无 `TaskEngine.complete/fail` 调用；无 artifact 写入 |

### §13.2 验证命令（实现完成后必须全绿）

```text
V-1  npx tsc --noEmit
V-2  npm --prefix packages/research run typecheck
V-3  node --import tsx --test packages/research/src/*.test.ts packages/research/src/providers/*.test.ts src/agent/*.test.ts src/cli/*.test.ts
V-4  node --import tsx src/cli/tiancha.ts research smoke
V-5  基线参照：实现前 full-suite 通过数与 smoke 结果须先记录，实现后不得回归
```

### §13.3 测试义务（T-*）

```text
T-A1  6 个类型可从 ports/execution-provider.port.ts 导入；结构断言（status 判别、无多余字段）
T-A2  静态断言：该文件文本不含 `@earendil` / `AgentSession` / `AgentMessage`（EP-15）
T-B1  PiExecutionProvider 满足 ExecutionProviderPort（类型层断言）
T-B2  静态断言：provider 源文件不含 `buildAgentSessionFactory` 作为执行实现
T-B3  execute 返回的 outcome.status ∈ {"succeeded","failed"}（无第二套分类字段）
T-C1  静态断言：provider 源文件不含 `openSessions` / 不含 `child-${`
T-C2  ExecutionHandle 仅含 sessionId（类型层断言）
T-C3  行为断言：provider 以 opaque sessionId 完成 lookup（可用 stub lookup 观察键值）
T-D1  行为断言：provider 实际使用 request.model（stub 记录）
T-D2  ModelRouter.resolve() 调用次数 = 0
T-D3  负例：request.model 与 attempt.model 不一致时，行为符合 IP-D-3
T-E1  静态断言：无「`?.close?.()`」形态的可选调用
T-F1  静态断言：无 TaskEngine.complete/fail 调用；无 ArtifactStore 写入
T-F2  静态断言：AF-4 相关文件未被修改（白名单外零改动）
```

### §13.4 ★ 五个硬 Gate（A-1 配套 · 必须成为 Implementation Gate）

```text
T-G1  【硬 Gate 1 · Provider identity】`PiExecutionProvider` ≠ `AgentSessionFactory`
        · 静态断言：provider 源文件不以 `buildAgentSessionFactory` 作为 execute 的实现
T-G2  【硬 Gate 2 · No re-resolve】`ModelRouter.resolve()` 调用次数 = 0
T-G3  【硬 Gate 3 · Model fidelity】`TaskAttempt.model === actual execution model`
T-G4  【硬 Gate 4 · Opaque lookup】provider 以合法 `sessionId` 完成 lookup；
        ⛔ 不得为 `child-${taskId}`（字符串反推）
        ⛔ 不得为 `TaskEngine.openSessions`（private）
T-G5  【硬 Gate 5 · Session lifecycle】provider 完成后 concrete session 生命周期必须有确定行为；
        ⛔ 至少不得为 `close?.() → no-op`
```

```text
⇒ 这五条是本契约在 Implementation Review 时的**首要检查项**；
   其余 T-* 为补充覆盖，不在本轮扩量。
```

---

## §14 延期项（Explicitly Deferred）

```text
O-IP-1  ★ G-04：future integration caller（谁持有 TaskEngine.start() 返回值并投影为
        DispatchedExecutionContext）—— AF-4 集成边界，DEFERRED
O-IP-2  ★ G-05：现有 CLI `close()` → no-op 缺陷的修复 —— 独立 session lifecycle 边界，DEFERRED
O-IP-3  lookup 的具体实现形态（SessionRegistry / Map / provider-owned store / closure）—— §6.2
O-IP-4  `close()` 的最终语义（abort → dispose / dispose only）—— 与 AF-1 rev2 O-AF1-7 同源
O-IP-5  provider 的最终放置位置（providers/ vs runtime/）—— §5 IP-B-1
O-IP-6  AF-2/AF-3 implementation（start failure boundary / finalization）—— 独立立项
O-IP-7  ✅ 已裁定（A-1 · §3）：D-1 端口文件由 **AF-1 创建**；AF-4 只消费（不得重复创建/重定义/复制）
```

---

## §15 风险与开放项（需另行裁定）

```text
R-1  ✅ **已裁定（A-1 · §3）**：D-1 端口文件由 **AF-1 创建**；AF-4 只消费。
        ⇒ AF-4 侧契约的表述修订属独立「AF-4 Contract micro-amendment」，
          **须由用户单独授权**（本契约不改 AF-4 文件）。
R-2  ✅ **已裁定（A-2 · §6.1）**：ownership 固定为 composition root / provider side；
        TaskEngine 不得作 lookup backend（**IP-R2-1…IP-R2-4**）；`openSessions` = inaccessible；
        **具体形态不锁**。⇒「实现 ownership seam」是 AF-1 Provider Implementation 的**前提**，
        但 ⛔【不得】为此刻意修改 TaskEngine。
R-3  ✅ **已裁定（A-3 · §7）**：锁**结果不变量**（preserve `TaskAttempt.model`；禁 re-resolve；
        禁 substitute），实现位置（provider 内 / composition-root seam）**不锁**；
        须可测试证明 model fidelity。⛔ `ModelRouter.resolve()` = forbidden。
R-4  ✅ **保持 DEFER（A-4 · §8）**：不修 CLI / 不修 R2；
        仅新增约束「AF-1 implementation 不得复制 `close()` bug」。
```

---

## §16 对当前代码的登记性偏离清单（登记，未实施）

> 本节仅为「现状 vs 本契约要求」的事实登记；**不构成修改授权**。

| # | 现状（已取证） | 本契约要求 | 相关不变量 |
| --- | --- | --- | --- |
| D-1 | `ports/execution-provider.port.ts` 不存在；6 类型全仓 0 命中 | 该文件存在且结构 = AF-1 rev2 §18.2 | IP-2 |
| D-2 | 无 concrete Provider；`buildAgentSessionFactory` 只 create session | `PiExecutionProvider implements ExecutionProviderPort` | IP-1 |
| D-3 | `TaskEngine.openSessions` 为 private；无 lookup 宿主 | provider 经 opaque lookup 解析 sessionId | IP-5 · IP-7 |
| D-4 | `createAgentSessionFromServices({ model: undefined })`（tiancha.ts:117-122） | `TaskAttempt.model` 实际进入 concrete session | IP-8 · IP-9 |
| D-5 | CLI `close()` → `s?.close?.()` = 静默 no-op（Pi 只有 dispose/abort） | close 语义明确；禁止「可选调用 + 静默忽略」 | IP-10 |
| D-6 | `providers/` 已被 `OpenAiCompatibleModelAdapter` 占用 | 新文件/类命名显式区分 | IP-1 |

---

## §17 OUT 复核清单

```text
✅ 本契约未修改 AF-1 rev2 / AF-4 rev1 / AF-4 rev2+A-9 / AF-2·3 / R2 / R1 / C7-B 任何语义
✅ 本契约未定义实现（无代码 / 无测试 / 无 CLI 改动）
✅ 本契约未新增端口字段或第二套判别字段
✅ 本契约未引入 scheduler / concurrency / retry / 第二套状态机
✅ 本契约未把 G-04（future integration caller）或 G-05（CLI close 修复）塞进实现范围
✅ 本契约未锁死 registry 的具体技术方案（只锁行为边界）
✅ 本契约未产生 Claim / Fact / Knowledge / Candidate / 0–100 分
✅ 本契约未修改 README / INDEX / HANDOFF；未 commit；未 push
✅ 未引入任何 Pi 类型进入 research 层的定义
```

---

## §18 Amendment 2 — ExecutionRequest `prompt` carrier synchronization

```text
Amendment: 2
Status:    IMPLEMENTED / PENDING REVIEW（【不是】APPROVED / FROZEN —— 本契约仍为 NOT YET APPROVED）
Subject:   ExecutionRequest prompt carrier synchronization
Change:    §5.2 IP-B-5 的 `request` 字段级 inline 列表加入 `prompt`
           （{ taskId, runId, roundId?, model, thinkingLevel, prompt, context? }）
Reason:    synchronize AF-1 Implementation Contract with AF-1 rev2 Amendment 1（②）· AF-1A Port Amendment（①）
Scope:     §5.2 IP-B-5 的 ExecutionRequest inline 字段列表 only
```

```text
【身份声明（冻结）】
  本 Amendment 2 是 `rev1 + Amendment 1` 的【后续同步修订】。
  · 只同步 `ExecutionRequest.prompt`；
  · 【不】创建新的 contract rev（不产生 rev2；不改写现有 Status / 状态表 / End of contract 行）；
  · 【不】改变既有 Amendment 1 的其他语义。
```

```text
【字段语义（沿用，不在本 Amendment 重新设计）】
  `prompt` 是【上游执行调用方】提供的数据字段，随 `ExecutionRequest` 传递。
  ⇒ Provider 【不】生成、不推断、不改写、不替换 prompt。
  ⇒ 【不】引入任何 `ExecutionInput` / prompt resolver / prompt generator / prompt policy /
     runtime abstraction 等新概念。
```

```text
【既有关系（同步后继续成立）】
  · §4 IP-A-2：「结构【逐字等于】AF-1 rev2 §18.2」—— 本 Amendment 同步后【继续成立】
    （AF-1 rev2 §18.2 已于 ② 落地 `prompt: string`；本处 inline 列表与之保持一致）。
  · §5.2 IP-B-5 的 `execute(handle, request)` 签名【未变】。
```

```text
✅ 本 Amendment 只改 §5.2 IP-B-5 的 ExecutionRequest inline 字段列表（新增 1 项 `prompt`）。
✅ 本 Amendment 未改 L3 Status / L23 状态表 / End of contract 行
   （保持 `rev1 + Amendment 1` 与 NOT YET APPROVED）。
✅ 本 Amendment 未改 `execute` 签名 / `ExecutionHandle` / `ResearchContext` / 其他 IP-A·IP-B 条款。
```

---

**End of contract（rev1 + Amendment 1 · Execution Provider Implementation Contract）**
