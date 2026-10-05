# AF-1C · Pi Execution Provider Implementation Contract

> **状态：🔒 FROZEN（AF-1C Contract Freeze）· DOCS-ONLY · P6 已 CLOSED**
> **AF-1C Implementation：⛔ NOT AUTHORIZED**（★ Freeze ≠ Implementation）
> **AF-1C Contract Freeze：🟢 FROZEN**（本次 Freeze Gate 完成；P6 已不再构成阻塞）
> **P6（Prompt Input Source）：🟢 CLOSED**（五载体 prompt carrier / source chain 已全部闭合，并通过各自 Review）
>   · **① Port**：🟢 已完成（`ExecutionRequest.prompt: string` 落入 `execution-provider.port.ts`）
>   · **② AF-1 rev2 §18.2（+ §18.9 Amendment 1）**：🟢 已完成
>   · **③ AF-1 Impl（+ §18 Amendment 2）**：🟢 已完成
>   · **④ AF-4 Design（+ R-5 · §20 Amendment 1）**：🟢 已完成
>   · **⑤ AF-4 Impl（+ §4.3 A-9 · Amendment 1）**：🟢 已完成
>   · **Source of Truth**：`prompt` 的唯一来源 = 上游 execution caller（显式提供）；
>     ❌ 不归属 `TaskEngine` / `TaskAttempt` / `ResearchContext` · `taskId`/`runId`/`roundId` · `objective` · provider 自造
>   · **审计证据**：见 §19 O-AIC-P6（含各载体 blob / sha256）
> **G-04（production writer）：🟡 DEFERRED / OUT OF SCOPE**
>
> **Scope:** docs-only contract。冻结 AF-1C（Pi Execution Provider）的工程边界与实现语义；**不实现代码**、**不创建 Adapter**、**不修改任何既有文件**。
> **上游依据（严格继承，均不修改）:** `docs/phaseC/execution-provider-contract.md`（AF-1 rev2 · FROZEN `c3fb4d6`）· `docs/phaseC/execution-provider-implementation-contract.md`（AF-1 Impl rev1+Amd1 · FROZEN `3294b72`）· `packages/research/src/ports/execution-provider.port.ts`（AF-1A · FROZEN / PUBLISHED `d6d81f1` · 现为 **①② 校正后** sha256 `68a45c3f…`，即 ① AF-1A Port Amendment 已落地 `prompt: string`）· `docs/phaseC/execution-session-lookup-seam-contract.md`（AF-1B · FROZEN / PUBLISHED `a97cf6b`）· `docs/phaseC/execution-session-lookup-seam-implementation-contract.md`（AF-1B-I · FROZEN / PUBLISHED `d64b824`）· `packages/research/src/runtime/execution-session.ts`（`8b98a0f3…`）· `packages/research/src/runtime/session-registry.ts`（`4f4b7c22…`）· `docs/phaseC/execution-coordinator-implementation-contract.md`（AF-4 Impl rev2 · FROZEN `38862f5`）· `docs/phaseC/task-engine-failure-boundary-contract.md`（AF-2+AF-3 · FROZEN `eef63ac`）· `docs/phaseC/c7b-execution-wiring-contract.md`（rev4 · FROZEN）· `docs/phaseC/af1a-contract-change-proposal-execution-request-prompt.md`（AF-1A Change Proposal · 🟢 APPROVED）
> **证据基础:** AF-1C Read-only Preflight（P1–P8，只读）
> **本契约不授权实现。** 未授权：AF-1C Provider 实现 · Adapter 创建 · 修改 Registry / TaskEngine / Orchestrator / AF-4 / AF-1A Port（`execution-provider.port.ts`）· G-03 / G-04 / G-05 / G-06 · commit · push。

---

## §0 Status / Authorization

```text
AF-1A（Execution Provider Port + 6 types）        🟢 CLOSED / PUBLISHED（d6d81f1）
AF-1B（Session Lookup Seam Contract）              🟢 FROZEN / PUBLISHED（a97cf6b）
AF-1B-I（Registry Implementation）                 🟢 CLOSED / PUBLISHED（bfe563f）
AF-1C Read-only Preflight（P1–P8）                 🟢 COMPLETE
AF-1C Implementation Contract（本文）              🔒 FROZEN（AF-1C Contract Freeze）
AF-1C Implementation                               ⛔ NOT AUTHORIZED
AF-1A Port modification                            ⛔ NOT AUTHORIZED
G-04 Integration                                   ⛔ NOT AUTHORIZED
G-03 / G-05 / G-06                                 🟡 DEFERRED
TaskEngine · R2 · AF-4                             🔒 FROZEN / 不修改
```

```text
【Freeze 说明 · 本契约固化的有效依赖（frozen baseline + effective amendments）】
  AF-1 rev2（execution-provider-contract.md）            baseline `c3fb4d6` + **Amendment 1**（§18.9 prompt carrier）
  AF-1 Implementation（execution-provider-implementation-contract.md）
                                                         baseline `3294b72` + **Amendment 2**（§18 prompt carrier）
                                                         ⇒ effective ExecutionRequest shape =
                                                           taskId / runId / roundId? / model / thinkingLevel / prompt / context?
  AF-1A Port（execution-provider.port.ts）               `d6d81f1` + **① Port Amendment**（`prompt: string`）
  AF-1B（execution-session-lookup-seam-contract.md）     `a97cf6b`（FROZEN / PUBLISHED）
  AF-1B-I（execution-session-lookup-seam-implementation-contract.md） `d64b824`（CLOSED / PUBLISHED）
  AF-4 Design（execution-coordinator-contract.md）       baseline `1e796a5` + **Amendment 1**（R-5 prompt source）
  AF-4 Implementation（execution-coordinator-implementation-contract.md）
                                                         baseline `38862f5` + **Amendment 1**（§4.3 A-9 prompt source）
  AF-2 + AF-3（task-engine-failure-boundary-contract.md） `eef63ac`（FROZEN）
  R2（round-execution-driver-contract.md）               `275b84d`（FROZEN）
  ⇒ ★ 说明：`baseline` = 已发布基线；`Amendment N` = 其后的**有效同步修订**（二者并存，非「二选一」）。

【Freeze 时仍开放、但不阻塞 Freeze 的项（Implementation 前置决策）】
  O-AIC-1 / O-AIC-2 / O-AIC-3 / O-AIC-6 —— 见 §19（状态：`OPEN · implementation decision`）

【Freeze 明确不处理（独立问题）】
  · AF-4 Design Status Cleanup（该文件 L3 / L13 的状态文字滞后）
  · AF-4 Impl Status Cleanup（该文件 L3 / L15 的状态文字滞后）
```

**本轮唯一允许的动作：AF-1C Contract Freeze Gate（仅更新本文件的状态与依赖固化）。不碰代码、不改既有契约、不实现 Provider、不 commit、不 push。**

---

## §1 Purpose

AF-1A / AF-1B / AF-1B-I 已分别冻结「Provider 端口与结果类型」「session lookup seam」「registry 本体」。此后仍缺一份把 **AF-1C（Pi Execution Provider）** 的工程边界收敛成可实施、可验收的合同。本 Draft 回答八个问题（对应 Preflight 的 P1–P8）：

```text
P1  Provider 的实现落点在哪（且不能落在哪）？
P2  Provider 如何获得 SessionRegistry（依赖方向与禁止面）？
P3  Pi AgentSession → ExecutionSessionCapability 的 adapter 是什么、归谁？
P4  production writer（G-04）是否属于 AF-1C？
P5  Provider 的最小职责是什么？
P6  ★ session.prompt(text) 的 text 从哪里来？（当前缺口）
P7  lookup miss / prompt throw / prompt resolve 如何映射到 ExecutionOutcome？
P8  model / thinkingLevel 的真相来源是什么？
```

**目的不是解决集成（G-04），而是把 Provider 本体的行为边界钉死，并显式暴露 P6 这一契约级缺口。**

---

## §2 Scope / Non-goals

### §2.1 Scope

```text
S-1  Provider ownership（§3）
S-2  Implementation location（§4 · P1）
S-3  Registry dependency（§5 · P2）
S-4  Pi → ExecutionSessionCapability adapter（§6 · P3）
S-5  Execution flow（§7）
S-6  Prompt input source（§8 · P6 ★）
S-7  Lookup miss / Prompt failure / Output projection（§9 / §10 / §11）
S-8  Model / thinkingLevel（§12 · P8）
S-9  Lifecycle（§13）· G-04 boundary（§14 · P4）· AF-4 boundary（§15）· C6 RMA boundary（§16）
S-10 Forbidden surface（§17）· Invariants（§18）· Open questions（§19）· Review gates（§20）
```

### §2.2 Non-goals

```text
❌ 不实现 AF-1C Provider（不写 class / module / 实现文件）
❌ 不创建 Pi → ExecutionSessionCapability adapter
❌ 本 Draft 不修改 AF-1A Port（`execution-provider.port.ts`）——该改动只能来自 ① AF-1A Port Amendment 这一独立 Gate（已完成）；本 Draft 不得代其执行，也不得再改
❌ 不修改 AF-1B / AF-1B-I 契约与其实现（`execution-session.ts` / `session-registry.ts`）
❌ 不修改 TaskEngine / Orchestrator / R2 / AF-4 / CLI / AgentSessionFactoryPort
❌ 不解决 G-04（production writer）· G-05（lifecycle）· G-06（model fidelity）· G-03
❌ 不引入 scheduler / retry / concurrency / timeout 实现 / 第二套状态机
❌ 不定义 Artifact 持久化 / Round settlement / Task settlement
```

---

## §3 Provider ownership

```text
AI-3-1  AF-1C Provider 的 ownership = **composition-root / concrete-session owning side**
        （继承 AF-1B SL-OWN-2 / AF-1 rev2 Q-EP-4）。
AI-3-2  AF-1C Provider 【不是】下列任一者：
            Provider ≠ session creator
            Provider ≠ session owner
            Provider ≠ registry owner
            Provider ≠ adapter creator
            Provider ≠ TaskEngine / Orchestrator / ModelRouter
AI-3-3  AF-1C Provider 的角色 = **consumer**（消费 lookup + 执行 + 产出 research-neutral outcome）。
AI-3-4  AF-1C Provider 的具体实现归属（文件 / class / 结构）【不在本 Draft 冻结】；
        见 §4 的方向裁定与 §19 O-AIC-1。
```

---

## §4 Implementation location（P1）

```text
【事实（Preflight P1）】
  packages/research/src/providers/ 共 7 个文件，全部属于 C6 RMA 区域：
    echo-data-provider · model-adapter-assembly · model-credentials · model-provider-errors ·
    openai-compatible-model-adapter（class OpenAiCompatibleModelAdapter implements ModelExtractionAdapter）·
    openai-compatible-transport · real-model-adapter.test

AI-4-1  ★ AF-1C 【不进入】`packages/research/src/providers/`。
AI-4-2  ★ AF-1C 是 **Execution Provider**，不是 **Model Provider**；它与 C6 的
        `ModelExtractionAdapter` / `OpenAiCompatibleModelAdapter` 属【两个不同的 provider 概念】，
        不得共享命名空间、不得并入同一目录语义。
AI-4-3  方向裁定（架构偏好，非最终路径）：AF-1C 归属 **execution / runtime assembly boundary**，
        即 `packages/research/src/runtime/` 或其相邻的 execution assembly 位置。
AI-4-4  具体文件路径 / class 名【留待 AF-1C Contract Freeze 时确定】（§19 O-AIC-1）；
        本 Draft 不创建任何文件。
```

```text
C6 RMA adapter 导入点（composition root 侧）：
  providers/model-adapter-assembly.ts:63  export function assembleModelAdapter(...)
  ⇒ AF-1C 【不得】import `assembleModelAdapter` / `ModelExtractionAdapter` / `ProviderError` 等 C6 符号。
     （执行失败的诊断分类属于 provider 自己的 `ExecutionError.kind`，不借用 C6 的 `ProviderErrorCode`。）
```

---

## §5 Registry dependency（P2）

```text
【架构已定（Preflight P2）】
                    TianchaRuntime（composition root）
                   /                              \
        creates/owns SessionRegistry        creates/owns AF-1C Provider
                   \                              /
                    \                            /
                     ── same registry instance ──
                                │
                                ▼
                        AF-1C Provider
                                │
                          lookup(sessionId)      ← 唯一允许的访问
```

```text
AI-5-1  SessionRegistry 由 **composition root（TianchaRuntime）创建并持有**（AF-1B-I SI-OWN-1）。
AI-5-2  ★ Registry 实例由 composition root **注入**给 AF-1C Provider；
        两边必须是【同一个实例】。
AI-5-3  ❌ 【禁止】`new SessionRegistry()`（Provider 自建）—— 否则出现 Runtime Registry A
        ≠ Provider Registry B，`register → A` 而 `lookup → B`，表面正常但永远 miss。
AI-5-4  ❌ 【禁止】Provider 调用 `register()` / `remove()`。
        Provider 的依赖 = **lookup-only**（仅 `lookup(sessionId)`）。
AI-5-5  ❌ 【禁止】把 SessionRegistry 改造成 / 命名为 `ExecutionProviderRegistry` 或任何
        provider 侧注册表；Registry 的语义恒为「sessionId → execution capability」。
AI-5-6  本 Draft【不】新增 `SessionLookup` 之类的新 interface（避免泛化）；
        先由 composition root 注入现有 Registry，Provider 只调用 `lookup()`。
        若 Contract Review 判定需要类型级隔离，再单独裁定（§19 O-AIC-2）。
AI-5-7  ❌ Provider 不得访问 `TaskEngine` private state（含 `openSessions`），
        不得访问 `TaskEngine.openSessions`，不得成为 TaskEngine 的 lookup backend（IP-R2-1/R2-2）。
```

---

## §6 Pi → ExecutionSessionCapability adapter（P3）

```text
【事实（Preflight P3）】
  Registry 期望类型（AF-1B-I）：ExecutionSessionCapability { prompt(text): Promise<void>; readonly messages: unknown[] }
  Pi 真实能力：prompt(text, options?): Promise<void>（agent-session.d.ts L393）· get messages(): AgentMessage[]（L331）
  现状 ChildSession = { sessionId, taskId, close() }（ports/agent-session-factory.port.ts:46-51）⇒ ❌ 不满足能力

AI-6-1  ★ 必须存在一个【极小 adapter】：
            Pi AgentSession  →  minimal adapter  →  ExecutionSessionCapability  →  SessionRegistry
        ❌ 不得是：Pi AgentSession → ChildSession → SessionRegistry（ChildSession 不具备 prompt / messages）。
AI-6-2  Adapter 只做两个映射：
            Pi AgentSession.prompt(text)        →  ExecutionSessionCapability.prompt(text)
            Pi AgentSession.messages（getter）   →  ExecutionSessionCapability.messages
AI-6-3  ❌ Adapter【不得】增加任何成员：
            model · thinkingLevel · state · raw · abort · dispose · close ·
            waitForIdle · subscribe · sessionId · taskId · services
AI-6-4  ❌ Adapter【不得】`extends AgentSession`；❌ 不得把 Pi 类型（`AgentSession` / `AgentMessage` /
        `PromptOptions` / `AgentSessionServices`）放入 `packages/research`，也不得通过类型别名间接泄漏
        （EP-15 / AF-1B-I SI-CAP-3）。
AI-6-5  Adapter 的创建者 = **concrete-session owning / composition-root side**
        （不是 Provider）；Provider 只是 adapter 的消费方。
AI-6-6  Adapter 类型本身应位于 research 层（例如与 `runtime/execution-session.ts` 的
        `ExecutionSessionCapability` 同层），但其【具体实现】（包装真实 Pi session）位于
        composition root / assembly 层 —— 具体路径见 §19 O-AIC-1。
```

---

## §7 Execution flow

```text
AI-7-1  AF-1C Provider 的执行链（唯一形态）：
            execute(handle, request)
                    │
                    ├── lookup(handle.sessionId)
                    │        ├── miss  →  ExecutionOutcome.failed          （§9）
                    │        └── hit   →  ExecutionSessionCapability
                    │
                    ├── prompt(<prompt input>)                              （§8 ★）
                    │        ├── throw  → ExecutionOutcome.failed           （§10）
                    │        └── resolve→ 执行已 settled（AF-1B-I SI-13）
                    │
                    ├── read messages（投影为 ExecutionOutput）              （§11）
                    │
                    └── ExecutionOutcome.succeeded / failed
AI-7-2  全链【无】timeout / retry / scheduler / concurrency 语义（AF-1 rev2 Q-EP-7 / EP-8）。
AI-7-3  全链【不】写 Task / Round / Run 状态，【不】artifactize，【不】调度（EP-6 / EP-10）。
```

---

## §8 ★ Prompt input source（P6 · 🟢 CLOSED）

```text
【缺口事实（Preflight P6）】
  ExecutionRequest（AF-1A port L34-41）= { taskId, runId, roundId?, model, thinkingLevel, context?: ResearchContext }
  ⇒ 【无】prompt / text 字段
  ResearchContext（domain/research-context.ts L33-46）= { runId, roundId?, taskId?, objective, scope,
    systemPrompt?, appendSystemPrompt?, agentsFilesOverride? }
  其文件头 L2-5 明确：它是被 composition root 映射到 Pi resource-loader 通道
    （systemPrompt / appendSystemPrompt / promptsOverride / agentsFilesOverride）的【资源/配置】载体，
    "never passed as a raw session arg"。
```

```text
AI-8-1  ★ AF-1C Provider 【不得】自行发明业务 prompt 文本。
AI-8-2  ★ ResearchContext 【不得】被当作 prompt 文本使用（含其 `objective` / `systemPrompt` /
        `appendSystemPrompt` 字段）—— 那会把 "objective = prompt" 变成隐含业务语义。
AI-8-3  ❌ 禁止的 prompt 来源：
            taskId · runId · roundId（任何推导）
            objective（业务语义偷换）
            JSON.stringify(request)
            "Execute task " + taskId 之类拼接
            provider 本地固定文本 / 运行时生成文本
AI-8-4  prompt 文本必须来自一个**显式定义的上游 execution-input 来源**，并由该来源
        在调用 `execute()` 之前确定。
AI-8-5  ★ `ExecutionRequest.prompt`（A1 · 见 §8.1）的语义定义为：
        「**已经由上游 execution caller 确定的、供本次 execution session 执行的
          user/task prompt text**」。
            ❌ 不是 `ResearchContext.objective`
            ❌ 不是 `ResearchContext.systemPrompt` / `appendSystemPrompt`
            ❌ 不是 provider 生成的指令文本
        数据流（唯一形态）：
            上游 execution caller
                    │（已确定的 prompt）
                    ▼
            ExecutionRequest.prompt
                    │
                    ▼
            AF-1C Provider
                    │
                    ▼
            ExecutionSessionCapability.prompt(text)
AI-8-6  ★ SoT 分离：`ExecutionRequest.prompt` ≠ `ResearchContext`；
        二者在 `ExecutionRequest` 内【并列且独立】，不得互相充抵：
            prompt  = execution input（本次要执行的用户 / 任务提示文本）
            context = research / resource context（system prompt 类资源注入通道）
AI-8-7  ❌ 不得用 `context` 的任何字段回填 / 推导 `prompt`；
        ❌ 不得用 `prompt` 回填 `context`。
```

### §8.1 Closure — 裁定结果（AF-1C Contract Draft Review 已裁定）

```text
【已裁定（AF-1C Contract Draft Review）】
  A1 — **SELECTED / PROPOSED**
        ExecutionRequest 增加 `prompt: string`
        · 最小改动；符合「不做 future-proof 扩张」原则
        · 语义直白：execute() 的入参自带其执行输入（语义定义见 AI-8-5）

  A2 — **REJECTED FOR THIS SLICE**
        ExecutionRequest 增加 `input: ExecutionInput { prompt: string }`
        · 当前只有 prompt 一项；无证据表明需要容器抽象
        · 避免无证据的 ExecutionInput 泛化

  B  — **REJECTED**
        改端口签名 `execute(handle, request, input)`
        · 会改变 AF-1 rev2 §18.2 已冻结的 `execute(handle, request)` 形状
        · 属更大的 Contract Surface Change；prompt 本质属一次 execution request 的输入事实

  ★ 状态纪律（冻结）：
        SELECTED / PROPOSED  ≠  IMPLEMENTED
        SELECTED / PROPOSED  ≠  FROZEN
        SELECTED / PROPOSED  ≠  AUTHORIZED
        ⇒ 它只表示「AF-1C 对 AF-1A 的变更提案已有了明确推荐方案」，
          【不等于】已授权修改 AF-1A Port，也不等于 AF-1C 已可 Freeze。

  ★ 共同前置与【现况】（本轮校正）：
        本变更【必然】改动 AF-1A 已冻结的类型（`ExecutionRequest`），因此必须登记为
            ★ AF-1A Contract Change Proposal（需重走 AF-1A Contract Review → 授权 → Freeze）
        ⇒ 该链条【已全部闭合 · P6 CLOSED】：
              ✅ AF-1A Contract Change Proposal —— 已通过 Proposal Review（🟢 APPROVED）
              ✅ ① AF-1A Port Amendment —— `ExecutionRequest.prompt: string` 已落入 Port
              ✅ ② AF-1 rev2 Contract sync（§18.2 + §18.9 Amendment 1）—— 🟢 Review PASS
              ✅ ③ AF-1 Impl Contract sync（§5.2 IP-B-5 + §18 Amendment 2）—— 🟢 Review PASS
              ✅ ④ AF-4 Design Contract sync（§7 shape + R-5 + §20 Amendment 1）—— 🟢 Review PASS
              ✅ ⑤ AF-4 Impl Contract sync（§4.2 shape + §4.3 A-9 + Amendment 1）—— 🟢 Review PASS
        ⇒ ★ 因此：**AF-1C P6 Contract Closure = 🟢 CLOSED**（技术条件 100% 满足）
              P6 closure requires the `ExecutionRequest` prompt carrier **and** all applicable
              frozen-contract synchronization to be closed through **their independent authorized gates**。
              ⇒ 该条件现已满足。
        ⇒ 后续顺序：AF-1C Draft 状态校正（已完成 · ⑦）→ AF-1C Contract Freeze Preflight（已完成 · ⑧）→
                **AF-1C Contract Freeze（已执行 · 本 Freeze Gate；待 Freeze Review）** →
                AF-1C Implementation（仍需显式授权）
```

```text
AI-8-8  【现况更新 · P6 CLOSED】五个 prompt carrier / source 载体均已【单独授权并完成】，并通过各自 Review：
            ① AF-1A Port Amendment          = ✅ 已完成
            ② AF-1 rev2 §18.2（+§18.9 Amd 1）= ✅ 已完成
            ③ AF-1 Impl（+§18 Amd 2）        = ✅ 已完成
            ④ AF-4 Design（+R-5 · §20 Amd 1）= ✅ 已完成
            ⑤ AF-4 Impl（+§4.3 A-9 · Amd 1） = ✅ 已完成
            AF-1C P6 Contract Closure        = 🟢 CLOSED（技术条件 100% 满足）
        仍保持（本 Gate 不越权）：
            AF-1C Contract Freeze            = ⛔ NOT AUTHORIZED（需显式裁定；本 Gate 不提前宣布 Freeze）
            AF-1C Implementation             = ⛔ NOT AUTHORIZED
AI-8-9  本 Draft 【不】修改 `execution-provider.port.ts`（该改动只能来自 ① AF-1A Port Amendment 这一独立 Gate），
        【不】新增任何 prompt 载体类型。
```

```text
AI-8-5  【现况更新 · 两条件均已满足】：
            (a) `ExecutionRequest` prompt carrier 已落地 —— ✅ 已完成（① AF-1A Port Amendment）
            (b) 全部适用同步面各自闭合 —— ✅ 已完成（②③④⑤ 各自 Gate 完成并通过 Review）
        因此：
            AF-1C P6 Contract Closure = 🟢 CLOSED
            AF-1C Implementation      = ⛔ NOT AUTHORIZED（仍需显式授权）
            AF-1C Contract Freeze     = ⛔ NOT AUTHORIZED（需显式裁定；本 Gate 不宣布 Freeze）
AI-8-6  本 Draft 【不】修改 `execution-provider.port.ts`，【不】新增任何 prompt 载体类型。
```

---

## §9 Lookup miss

```text
AI-9-1  lookup miss ⇒ `ExecutionOutcome = { status: "failed", error }`（AF-1B SL-LKP-3 / SL-ERR-1…4）。
AI-9-2  ❌ 不得把 lookup miss 伪装成 model failure / execution-internal failure（诊断污染）。
        `ExecutionError.kind` 可携带诊断分类，但【不】得让 miss 看起来像「执行了一半失败」。
AI-9-3  lookup miss 发生时，Provider 【尚未】开始执行 ⇒ 不读 messages、不产 output。
```

---

## §10 Prompt failure

```text
AI-10-1 prompt() throw ⇒ 当前 execution failure（AF-1 rev2 EP-3 / Q-EP-3）⇒
        `ExecutionOutcome = { status: "failed", error }`。
AI-10-2 失败【统一】为 `ExecutionOutcome.failed`（AF-1 rev2 Q-EP9-2）；
        `ExecutionError.kind` 只作 provider 侧诊断分类。
AI-10-3 ❌ 不在 `ExecutionOutcome` 顶层增加 timeout / aborted / preflight_failed / provider_failed
        等第二套判别字段（AF-1 rev2 §18 · L550）。
AI-10-4 `ExecutionOutcome.status` 与 `TaskAttemptStatus` 是【不同语义层】：
        `failed + kind="timeout"` ⇏ `TaskAttempt = failed`；
        settlement 一律经既有 `TaskEngine.complete()` / `fail()`（AF-1A port 注 L71-73 · AF-1B O-AC）。
```

---

## §11 Output projection

```text
AI-11-1 成功路径：prompt() resolve 后读取 messages，投影为
            `ExecutionOutput = { text?, messages?, raw? }`（AF-1A port L49-53）。
AI-11-2 `messages` 保持 `unknown[]`；❌【不得】声明为 `AgentMessage[]` 或任何 Pi 类型，
        也不得经别名间接泄漏（AF-1 rev2 §18 · L653 / AF-1B-I SI-CAP）。
AI-11-3 `text` 是 messages 的【确定性投影】（AF-1B Settlement/Output Preflight 结论）；
        Provider 【不】新增 Pi-specific "final text" API，也不从 session 取 text getter。
AI-11-4 `raw` 当前【无消费者】；本 Draft 不要求 Provider 填充 `raw`
        （AF-1 rev2 O-AF1-4 CLOSED 只冻结了【形态】，未要求【必填】）。
AI-11-5 ❌ Provider 不 artifactize、不写 ArtifactStore（AF-4 职责）。
```

---

## §12 Model / thinkingLevel（P8）

```text
AI-12-1 真相链（单向，AF-1 IP-D-1 / AF-4 Impl A-6 / AC-3 / E-1·E-2）：
            TaskAttempt.model / TaskAttempt.thinkingLevel
                    ↓（由 AF-4 integration context 携带）
            ExecutionRequest.model / ExecutionRequest.thinkingLevel
                    ↓
            AF-1C Provider（消费）
AI-12-2 ❌ Provider 【不得】调用 `ModelRouter.resolve()`。
AI-12-3 ❌ Provider 【不得】读取 `session.model` / `session.thinkingLevel` 建立第二真相。
AI-12-4 Registry 的 seam 不含 model / thinkingLevel（AF-1B-I SI-14）⇒ 结构上不可能成为第二来源。
AI-12-5 G-06（真实 model 注入）不由 AF-1C 解决（§14 同类的边界纪律）。
```

---

## §13 Lifecycle

```text
AI-13-1 AF-1C Provider 【不】拥有 concrete session 的 lifecycle authority。
AI-13-2 ❌ Provider 不得调用 close / dispose / abort / finishSession / waitForIdle；
        `ExecutionSessionCapability` 在【类型层面】不含这些成员（AF-1B-I SI-14）。
AI-13-3 prompt() resolve ≡ execution settled（AF-1B-I SI-13）⇒ 【不需要】额外 settlement 调用。
AI-13-4 G-05（ChildSession.close() 与 Pi dispose/abort 的历史问题）由 AF-1C 之外的独立切片处理（§14 同纪律）。
```

---

## §14 G-04 boundary（P4）

```text
【事实（Preflight P4）】
  TaskEngine.start(taskId) L53 返回 { task, attempt, session }（L97）；openSessions.set(taskId, session) L84（private）
  Orchestrator.stepRound() L215 `await this.engine.start(taskId);` ⇒ 【返回值丢弃】；L216 仅 return { kind: "dispatched", taskId }
  src/cli/tiancha.ts:190 ⇒ 仅 smoke 读 started.session.sessionId，不注册
  AF-4 Impl L484 已明确：writer 的归属指向 AF-4 integration boundary
```

```text
AI-14-1 ★ G-04（production registration / integration gap）= **独立 integration concern**，
        【不属于】AF-1C Provider 的职责。
AI-14-2 ❌ AF-1C 【不】负责 register：
            ❌ 不调用 `registry.register(...)`
            ❌ 不调用 `TaskEngine.start()` / `TaskEngine.get()` / `TaskEngine.listAttempts()`
            ❌ 不读取 `TaskEngine.openSessions`
            ❌ 不修改 `Orchestrator.stepRound()`
            ❌ 不创建 production writer
AI-14-3 本 Draft 描述 production flow 时，writer 一律标注为「G-04（DEFERRED）」，
        不得因描述流程而把它设计成 AF-1C 的职责。
AI-14-4 预期中间态（允许且正确）：
            AF-1C Provider  🟢 implemented
                ├── writer  → 🟡 G-04 DEFERRED
                └── reader  → AF-1B-I Registry（已具备 ⛔ 但无 production writer）
```

---

## §15 AF-4 boundary

```text
AI-15-1 AF-1C 只实现 `ExecutionProviderPort`；调用方（谁 await execute()、谁收口 complete()/fail()）
        属 AF-4 / future integration（AF-1 rev2 O-AF-1-5 → AF-4）。
AI-15-2 ❌ AF-1C 【不得】修改 AF-4 的契约 / 实现 / AC-*；❌ 不得反向进入 AF-4。
AI-15-3 AF-4 只能经其既有 narrow context / provider boundary 使用 AF-1C；
        ❌ AF-4 不得访问 registry internals / concrete session（AF-1B §12.2 / AF-4 Impl D-10 / AC-13）。
AI-15-4 AF-1C 【不】产生 `DispatchedExecutionContext`，也【不】消费它（那是 AF-4 的入口类型）。
```

---

## §16 C6 RMA boundary

```text
AI-16-1 AF-1C 【不】import 任何 C6 RMA 符号：
            `ModelExtractionAdapter` · `OpenAiCompatibleModelAdapter` · `assembleModelAdapter` ·
            `ProviderError` · `ProviderErrorCode` · `readModelInstanceConfig` · `resolveModelCredential`
AI-16-2 ❌ AF-1C 的执行失败诊断【不】复用 C6 的 `ProviderErrorCode`；
        它只使用 `ExecutionError.kind`（provider 侧诊断分类）。
AI-16-3 ❌ 不得把 AF-1C 与 C6 RMA 的 provider 概念合并（§4 AI-4-2）。
AI-16-4 `packages/research` 整体仍【永不】import `@earendil-works/pi-coding-agent`（EP-15）——
        包括 AF-1C 及其 adapter 的 research 侧类型。
```

---

## §17 Forbidden surface

### §17.1 Provider 禁止

```text
❌ create session / acquire session
❌ resolve model（`ModelRouter.resolve()`）
❌ read `session.model` / `session.thinkingLevel`
❌ create / own SessionRegistry（`new SessionRegistry()`）
❌ call `registry.register()` / `registry.remove()`
❌ call close / dispose / abort / finishSession / waitForIdle
❌ access `TaskEngine` private state（含 `openSessions`）
❌ call `TaskEngine.start()` / `get()` / `listAttempts()`
❌ modify Orchestrator / AF-4 / AF-1A Port
❌ invent business prompt text（§8）
❌ artifactize / write ArtifactStore / emit events / write Task·Round·Run status
❌ timeout / retry / scheduler / concurrency
```

### §17.2 反泛化（继承 AF-1B-I SI-19）

```text
❌ 不得设计 `Registry<T>` / `UniversalSession` / `SessionManager` / `SessionHandle`
❌ 不得为「未来可能需要」增加 seam 成员
❌ 不得新增产品级 Port（新 interface）—— 除 Contract Review 明确裁定（§19 O-AIC-2）
```

### §17.3 上游禁止被改造

```text
❌ 修改 AF-1A Port · AF-1B / AF-1B-I 契约与实现 · TaskEngine · Orchestrator · R2 · AF-4 · CLI
  （除 Contract Review 明确裁定并单独授权）
```

---

## §18 Invariants（AI-1 … AI-16）

| ID | 冻结语义（Draft 级） |
| --- | --- |
| **AI-1** | AF-1C 的 ownership = composition-root / concrete-session owning side；Provider 是 consumer |
| **AI-2** | AF-1C Provider ≠ session creator / session owner / registry owner / adapter creator |
| **AI-3** | AF-1C 【不进入】`packages/research/src/providers/`（那是 C6 RMA 命名空间） |
| **AI-4** | AF-1C 归属 execution / runtime assembly boundary；具体路径留待 Freeze 时确定 |
| **AI-5** | SessionRegistry 由 composition root 创建 / 持有 / 注入；Provider 与 runtime 必须是同一实例 |
| **AI-6** | Provider 的 Registry 依赖 = lookup-only；禁 `new` / `register()` / `remove()` |
| **AI-7** | Pi → ExecutionSessionCapability 的 adapter 只映射 `prompt(text)` + `messages`，不得扩张 |
| **AI-8** | Adapter 不得 `extends AgentSession`；Pi 类型不得进入 `packages/research`（EP-15） |
| **AI-9** | ★ P6：`ResearchContext` ≠ prompt text；Provider 不得发明业务 prompt；prompt 来源须显式上游定义 |
| **AI-10** | ★ P6 closure 必须经各同步面的独立 Gate；**Port 已落地 ≠ P6 已 Contract Closed**（本 Draft 不得直接改 Port） |
| **AI-11** | lookup miss / prompt throw ⇒ 统一 `ExecutionOutcome.failed`；不新增顶层判别字段 |
| **AI-12** | `ExecutionOutcome.status` ≠ `TaskAttemptStatus`；settlement 只走 `complete()` / `fail()` |
| **AI-13** | 成功输出 = messages 的投影；`messages` 保持 `unknown[]`；`text` 由投影得出 |
| **AI-14** | model / thinkingLevel 真相来自 attempt → request；Provider 不重 resolve、不读 session getter |
| **AI-15** | Provider 无 lifecycle authority；不调 close / dispose / abort / finishSession / waitForIdle |
| **AI-16** | G-04 属独立 integration concern；AF-1C 不 register、不调 TaskEngine、不改 Orchestrator |

---

## §19 Open questions / gaps

```text
O-AIC-1  AF-1C 的具体实现落点（文件 / class / assembly 归属）—— `OPEN · implementation decision`（Freeze 后确定）
O-AIC-2  是否需要类型级 lookup-only 隔离（如 `SessionLookup` interface）—— `OPEN · implementation decision`（Freeze 后、实现设计时裁定；§5 AI-5-6）
O-AIC-3  Adapter 的归属层与创建点（composition root vs assembly）—— `OPEN · implementation decision`（与 O-AIC-1 一并确定）
O-AIC-P6 ★ P6 Closure（**🟢 CLOSED** · 五载体全部闭合）：
             ExecutionRequest.prompt: string            （A1）
                     │
                     ▼
             AF-1A Contract Change Proposal             ✅ APPROVED（🟢 Proposal Review PASS）
                     │
                     ▼
             ① AF-1A Port Amendment                     ✅ 已完成（🟢 Review PASS）
                     │
                     ▼
             ② AF-1 rev2 §18.2 + §18.9 Amendment 1      ✅ 已完成（🟢 Review PASS）
                     │
                     ▼
             ③ AF-1 Impl（§5.2 IP-B-5 + §18 Amendment 2）✅ 已完成（🟢 Review PASS）
                     │
                     ▼
             ④ AF-4 Design（§7 shape + R-5 + §20 Amd 1）✅ 已完成（🟢 Review PASS）
                     │
                     ▼
             ⑤ AF-4 Impl（§4.2 shape + §4.3 A-9 + Amd 1）✅ 已完成（🟢 Review PASS）
                     │
                     ▼
             P6 Contract Closure                        🟢 CLOSED
         ⇒ **AF-1C Contract Freeze 不再被 P6 阻塞**；Freeze 本身仍需【显式裁定与授权】。
         ⇒ ★ 仍禁止推断「Port 已落地 ⇒ 自动 Freeze」／「A1 已写在 Draft 里 ⇒ 已授权修改 Port」。
         ⇒ 【证据注记 · 非契约语义】各载体审计证据（blob / sha256）：
             ① port                          blob e122be0c · 96 行 · sha256 68a45c3f…
             ② execution-provider-contract.md      blob cf568c87 · 796 行 · sha256 a8b9cade…
             ③ execution-provider-implementation-contract.md  blob 19856308 · 582 行 · sha256 5893890e…
             ④ execution-coordinator-contract.md   blob 5faf6bc1 · 731 行 · sha256 55233e05…
             ⑤ execution-coordinator-implementation-contract.md blob 09623a9a · 559 行 · sha256 f9d08121…
O-AIC-5  已并入 O-AIC-P6
O-AIC-6  执行失败的 `ExecutionError.kind` 取值集合（是否需冻结枚举）—— `OPEN · implementation decision`（Implementation 前确定）
O-AIC-7  AF-1 rev2 O-AF1-2（Provider 持有粒度：session 单独 / session+services）· O-AF1-3（timeout 数值来源）·
         O-AF1-6 / O-AF1-7（lifecycle 运行时取证）—— 不在本 Draft 裁定
O-AIC-8  G-04（production writer）· G-05（lifecycle）· G-06（model fidelity）—— DEFERRED，独立切片
```

---

## §20 Review gates

| Boundary | 检查点 | Draft Review 裁定 |
| --- | --- | --- |
| **① Ownership** | Provider 是否确为 consumer；是否未成为 creator / owner / registrar（AI-1 / AI-2） | 🟢 PASS |
| **② Location** | 是否确认不进入 `providers/`；是否提出 execution/runtime assembly 方向（AI-3 / AI-4） | 🟢 PASS |
| **③ Registry dependency** | 是否 same instance；是否 lookup-only；是否无 `new` / `register` / `remove`（AI-5 / AI-6） | 🟢 PASS |
| **④ Adapter** | 是否最小（仅 prompt + messages）；是否无 Pi 类型泄漏；归属是否非 Provider（AI-7 / AI-8） | 🟢 PASS |
| **⑤ P6 Prompt source** | 是否明确 `ResearchContext ≠ prompt`；是否给出可审查 closure；是否标记 Change Proposal 路径（AI-8-1…9 / AI-9 / AI-10） | 🟢 **CLOSED**（五载体 prompt carrier / source chain 已全部闭合，并通过各自 Review） |
| **⑥ Failure / Output / Model** | 是否统一 failed；是否无新判别字段；是否 messages 投影；model 是否来自 attempt（AI-11…AI-14） | 🟢 PASS |
| **⑦ Lifecycle / G-04 / AF-4 / C6** | 是否无 lifecycle 调用；G-04 是否外置；AF-4 / C6 是否严格隔离（AI-15 / AI-16 / §15 / §16） | 🟢 PASS |

```text
⇒ 7 Gates：**7 PASS**（⑤ P6 已由五载体同步闭合 → 🟢 CLOSED）。
⇒ **P6 CLOSED ≠ AF-1C Contract Freeze**：Freeze 与 Implementation 仍需各自的【显式裁定与授权】；
   ★ 且「P6 CLOSED」**不构成** Freeze 的自动授权。
```

---

**End of contract（AF-1C · Pi Execution Provider Implementation Contract · 🔒 FROZEN）**
