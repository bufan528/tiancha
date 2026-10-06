# Composition / Session Ownership Contract（rev1）

> 状态：**🔒 FROZEN（rev1）**。本契约只定义 ownership 与 composition 边界；**实现仍未授权**。
> 基线：`HEAD = origin/main = ls-remote = 237eddd`（AF-4 Execution Coordinator = PUBLISHED）。
> 只读引用（不得修改）：
> [`execution-provider-af1c-implementation-contract.md`](execution-provider-af1c-implementation-contract.md) **🔒 FROZEN（`ce0802a`）** ·
> [`af1c-implementation-contract.md`](af1c-implementation-contract.md) **🔒 FROZEN（`d9af5983…`）** ·
> [`execution-coordinator-contract.md`](execution-coordinator-contract.md) **🔒 FROZEN（`2abc4ae7…`）** ·
> [`execution-coordinator-implementation-contract.md`](execution-coordinator-implementation-contract.md) **🔒 FROZEN（`4d4cf36c…`）** ·
> [`round-execution-driver-contract.md`](round-execution-driver-contract.md) **🔒 FROZEN（rev1 + Amendment 1）** ·
> [`execution-provider-contract.md`](execution-provider-contract.md) **🔒 FROZEN（rev2）**。
> 前置裁定：**O-AC-6 Execution Caller Architecture = CLOSED**（Q1=A · Q2=(c) · Q3=(i) · Q4=OUT OF SCOPE）·
> **O-AC-7 Production Session Identity / Ownership Preflight = 🟢 PASS**
> （[5] Registry → TianchaRuntime · [6] sessionId → Session creator（修正）· [7] `child-${taskId}` REJECT ·
> [8] AF-4 unchanged · [9] unified contract + 独立 Gate）。
> **本文件只定义 ownership 与 composition 边界；不含实现、不含代码、不含 schema 变更。**

---

## §1 Purpose / Non-goals

```text
【Purpose】
本契约把「谁拥有什么」在 Execution 层的 composition 与 session identity 上一次定干净，
使 AF-1C Provider / AF-4 Coordinator / R2 Driver 之上，存在一个**单一、可验证的装配与身份边界**，
从而：(a) 收口 AF-1C 已登记但未闭合的 G-04 / R-2B；(b) 为后续 Execution Caller 提供稳定的地基。

【Non-goals】（本契约【不】解决，且【不得】顺手解决）
  ❌ G-05 Session lifecycle（close / dispose / abort / remove / timeout / cancellation / resource release）
  ❌ ResearchContext producer（G-07）
  ❌ G-06 model fidelity
  ❌ G-03
  ❌ Execution Caller 本体（其契约是独立的下一阶段）
  ❌ retry / scheduler / concurrency / queue
  ❌ 任何 Research 业务语义（Claim / Fact / Knowledge / Evidence / Evaluation）
  ❌ CLI 的整体重构（只定义其【最终角色】，不做重构）
```

---

## §2 Terms（术语冻结）

```text
Composition Root
    创建并持有 runtime 内部依赖、把它们装配成可运行整体的【唯一】位置。
    本契约下 = TianchaRuntime（§5 §A）。

Entrypoint / Command Adapter
    面向调用者的入口（CLI / Web / API / Agent Host / automation）。
    它【消费】composition root，但【不】自己组装 runtime 内部依赖（§5 §A · §10 §F）。

Session Identity
    一次 concrete execution session 的身份标识（`sessionId`）。
    它属于【被创建出来的 session】，不属于创建它的装配器（§6 §B）。

Creator
    负责【创建】对象的组件（谁构造它）。
    Creator = 创建行为的主体；不因此获得该对象的长期归属。

Owner
    对该对象负【长期 composition / lifecycle / 架构责任】的组件
    （谁持有它、谁决定它的可用期、谁在架构上为它负责）。

★ Creator ≠ Owner（除非契约明确规定二者相同）。
  本契约下已按此分离，例如：
    · ChildSession      Creator = Factory（session creator）· Owner = TaskEngine 持有
    · sessionId         Creator = Session creator（factory 实现）· Owner = 被创建的 session（identity）
    · SessionRegistry   Creator = Owner = TianchaRuntime

SessionRegistry
    按 opaque `sessionId` 索引 `ExecutionSessionCapability` 的【能力索引】。
    ❌ 不是 lifecycle owner；❌ 不创建 session；❌ 不生成 identity（§7 §C）。

Production Registry Writer（G-04）
    生产路径上【唯一】调用 `registry.register(sessionId, capability)` 的落点（§8 §D）。

Factory / Session Creator（R-2B）
    生产路径上创建 concrete session（并因此拥有其 identity）的实现（§9 §E）。

G-05
    Session lifecycle semantics（close / dispose / abort / remove 的语义与时序）。
    ★ 本契约【只承认其边界】，不实现、不定义、不吸收（§13）。
```

---

## §3 Current Facts（Preflight 取证 · 逐字事实）

```text
[F-1] ExecutionSessionCapability（runtime/execution-session.ts，38 行）
      { prompt(text: string): Promise<void>; readonly messages: unknown[] }
      · prompt() resolve ≡ execution settled（实现属性，非额外成员）
      · ❌ abort/dispose/close/waitForIdle（→ G-05）· ❌ model/thinkingLevel · ❌ state/raw/subscribe
      · 自 AF-1C 起经 runtime/index.ts 的 `export *` 对包外可达（用途：composition root 取同一实例；
        src/ 侧 adapter 实现本类型）；★ 仍【不是】product-level Port

[F-2] SessionRegistry（runtime/session-registry.ts）
      private readonly bySessionId = new Map<string, ExecutionSessionCapability>()
      公开面：register(sessionId, session) · lookup(sessionId) · remove(sessionId)
      ★ 无 dispose / close / clear / size / 任何生命周期 API
      头注：NOT a lifecycle owner（remove ≠ close ≠ dispose ≠ abort ≠ finishSession）

[F-3] TaskEngine.start()（task-engine.ts:53-98）
      const session = await this.deps.factory.create({ cwd, taskId, runId, roundId, role,
            modelPolicy, model, thinkingLevel, noTools: true });     ← ★ 入参【无 sessionId】
      this.openSessions.set(taskId, session);                        ← private，key = taskId
      return { task, attempt, session };

[F-4] AgentSessionFactoryPort（ports/agent-session-factory.port.ts）
      create(opts: ChildSessionOptions): Promise<ChildSession>
      · ChildSessionOptions = { cwd, taskId, runId, roundId?, role, modelPolicy, model?,
                                thinkingLevel?, tools?, …, resourceLoaderOptions?, researchContext? }
        ⇒ ★ 【不含 sessionId】
      · ChildSession = { sessionId: string; taskId: string; close(): Promise<void> }
        ⇒ ★ sessionId 是【输出】

[F-5] 当前 sessionId 生产点（全仓仅 2 处）
      src/cli/tiancha.ts:147      const sessionId = `child-${opts.taskId}`;   ← smoke factory
      runtime/child-session.ts:41 sessionId: `noop-${taskId}`                 ← no-op 实现

[F-6] 当前 register 落点（全仓唯一）
      src/cli/tiancha.ts:148  registry.register(sessionId, new PiSessionCapabilityAdapter(result.session));
      AF-1C IC-6-2：唯一【注册调用点】= create() 内、`return ChildSession` 之前（同栈帧 ⇒ 不可错配）
      IC-6-2.1：register 调用点已裁定 ≠ register 已接入生产运行链（无任何消费者 lookup）

[F-7] 当前 remove 落点（全仓唯一）
      src/cli/tiancha.ts:158  registry.remove(sessionId);   ← 在 ChildSession.close() 内
      AF-1C IC-6-3：remove 绑定 ChildSession.close()（先关底层 session，再移除映射）

[F-8] 生命周期链（实测）
      TaskEngine.complete()/fail()  → void finishSession(taskId)  → await session.close()
                                    → registry.remove(sessionId)
      ● ChildSession.close() 的底层语义 = no-op（G-05 锁定，不得升级为 dispose/abort）

[F-9] 当前 Registry 持有者 = 仅 src/cli/tiancha.ts:177（cmdResearchSmoke 函数作用域）
      ⇒ 随函数作用域结束而丢弃；TianchaRuntime.close() 当前【不】处理 registry

[F-10] TianchaRuntimeDeps（tiancha-runtime.ts:20-29）= { cwd, eventDbPath, artifactDbPath,
       eventBus, agentSessionFactory, modelResolver } ⇒ ★ 无 registry / 无 provider /
       无 coordinator / 无 caller；内部 new：eventStore · artifactStore · events · ModelRouter ·
       TaskEngine · Orchestrator ⇒ ★ 不 new factory（factory 由外部注入）

[F-11] AF-1C 契约明文（已冻结）
       AI-5-1  SessionRegistry 由 composition root（**TianchaRuntime**）创建并持有（AF-1B-I SI-OWN-1）
       AI-5-2  Registry 实例由 composition root【注入】给 AF-1C Provider
       L549    Provider 与 runtime 必须是【同一实例】
       ★ 与 [F-9] 构成**契约—实现漂移**：契约要求 TianchaRuntime 持有，实现放在 CLI

[F-12] AF-1C IC-5-3（Adapter 禁止面）
       PiSessionCapabilityAdapter ❌ 不生成 sessionId · ❌ 不调 registry.register/remove ·
       ❌ 不持有 SessionRegistry · ❌ 不做 model resolution · ❌ 不做 session lifecycle 决策
```

---

## §4 Target Architecture（目标 owns 图）

```text
                    ┌──────────────────────────────────────┐
                    │            TianchaRuntime            │
                    │         Composition Root（唯一）      │
                    │                                      │
                    │  owns:                               │
                    │    · SessionRegistry                 │
                    │    · TaskEngine                      │
                    │    · Orchestrator                    │
                    │    · (wires) Provider  ← same Registry│
                    │    · (wires) Coordinator             │
                    │    · (wires) Caller                  │
                    │    · eventStore / artifactStore      │
                    └───────────────┬──────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
        SessionFactory         Provider              Caller
              │                     │                     │
              ▼                     │ lookup              │
        ChildSession ── identity ──►│                     │
              │  sessionId          │                     │
              └──────────► SessionRegistry ◄──────────────┘
                                (capability index)

  ⇒ identity 的 source of truth = 创建出来的 ChildSession（其实现内部生成 sessionId）
  ⇒ Registry 只按 identity 索引 capability；Registry owner ≠ identity owner
```

**三层责任不可混（本契约的核心）：**

```text
① TianchaRuntime   = composition owner（拥有 Registry、装配、注入）
② Session creator  = session identity owner（创建 session、产生 sessionId）
③ TaskEngine       = task/session execution lifecycle coordinator（持有 openSessions、触发 finishSession）
   SessionRegistry  = capability index（只有 register / lookup / remove）
   G-04             = production registration（唯一 register 落点）
   G-05             = session lifecycle semantics（★ 本契约不解决）
```

---

## §5 §A — Composition Root

```text
CSO-A-1  TianchaRuntime = **primary composition root**（唯一）。
CSO-A-2  entrypoint（CLI / Web / API / Agent Host / automation）【不得】成为第二 composition root。
CSO-A-3  entrypoint 的职责 = 参数解析 + 调用 runtime 的公开面 + 输出；❌ 不组装 runtime 内部依赖。
CSO-A-4  ★ 禁止出现两个 composition root 并存：
             ❌ CLI 组装 Registry / Provider / Coordinator / Caller
             ❌ Runtime 只做一半装配
CSO-A-5  TianchaRuntime 负责把【同一个】SessionRegistry 实例提供给所有需要的运行组件
         （AF-1C AI-5-1 / AI-5-2 / L549）。
CSO-A-6  装配是【构造期】行为：TianchaRuntime 构造完成后，运行期组件之间的引用即固定。
CSO-A-7  TianchaRuntimeDeps 的【最终形态】由本契约的 §D / §E / §F 与各自 Gate 决定；
        本契约只冻结「它必须能持有 Registry 并完成装配」这一事实，不预先写死字段清单。
CSO-A-8  ★ TianchaRuntime.close() 是否纳入 Registry 的结束语义，属 **G-05** 边界（§13）；
         本契约【不】裁定，也不得以「方便」为由顺手加入。
```

---

## §6 §B — Session Identity

```text
CSO-B-1  `sessionId` = **ExecutionSession identity**，属于被创建出来的 session。
CSO-B-2  ★ identity 的三条独立性（必须同时成立）：
             sessionId ≠ taskId
             sessionId ≠ attemptId
             sessionId ≠ runId
CSO-B-3  ★ 禁止把任何其他 identity 派生为 sessionId，包括但不限于：
             ❌ `child-${taskId}`（[F-5] smoke 约定）
             ❌ `session-${attemptId}` / `${runId}-${taskId}` / 任何拼接式派生
CSO-B-4  `sessionId` 由 **Session creator（concrete factory 实现）** 产生（O-AC-7 [6]）。
CSO-B-5  ★ TianchaRuntime **不生成** `sessionId`。
CSO-B-6  ★ **禁止**为了让 Runtime 提供 identity 而给 `ChildSessionOptions` 增加 `sessionId` 字段。
         （[F-4] 已证明当前 Options 不含 sessionId；O-AC-7 [6] 明确此变化非必要，
           且会把 composition owner 与 identity owner 混淆。）
CSO-B-7  `sessionId` 一旦产生即**【不可变】**；任何一方不得改写、重映射或事后替换。
CSO-B-8  ★ identity 的**唯一事实源** = `ChildSession.sessionId`（该 session 实例自身）。
         禁止出现第二事实源：❌ TaskEngine 另存 sessionId · ❌ Runtime 另存 sessionId ·
         ❌ Registry key 与 session.sessionId 不一致 · ❌ 由 taskId 反查 sessionId。
CSO-B-9  Caller / Provider 只【消费】identity（传递 / lookup），不产生、不派生。
         依据：R2 Amendment 1 · D-RED-11（dispatched result 只暴露 identity 级事实）。

★ 澄清（防歧义）：`child-${taskId}` 与 `noop-${taskId}`（[F-5]）**仅可作为 smoke / no-op 实现细节保留**，
  禁止升格为生产 identity 规则；生产路径不得经过该 smoke factory 的 identity 字面量。
```

---

## §7 §C — SessionRegistry Ownership

```text
CSO-C-1  `SessionRegistry` 由 **TianchaRuntime 创建并持有**（AF-1C AI-5-1 · O-AC-7 [5]）。
CSO-C-2  ★ 一个 TianchaRuntime 实例的生命周期内，**恰有一个** `SessionRegistry` 实例。
         ❌ 禁止第二个 Registry / ❌ 禁止「每个 task 一个 registry」/ ❌ 禁止 per-session registry。
CSO-C-3  Registry 的能力面【保持不变】：`register(sessionId, capability)` · `lookup(sessionId)` ·
         `remove(sessionId)`。★ 本契约【不】扩展其 API。
CSO-C-4  Registry **不是** lifecycle owner（[F-2]）：
         ❌ 不 dispose / ❌ 不 close / ❌ 不 abort / ❌ 不 finishSession / ❌ 不做 resource release。
CSO-C-5  Registry 的 key 必须是【创建出来的 session 的 sessionId】（CSO-B-8），
         不得是 taskId / attemptId / 与 session.sessionId 无关的独立生成 UUID /
         任何由 Registry 或注册调用方另行生成的 key。
CSO-C-6  Provider 与任何需要 lookup 的组件，必须拿到**与 Runtime 持有的同一个实例**
         （AF-1C AI-5-2 / L549）。
CSO-C-7  Registry 的【结束/释放】属 **G-05** 边界；本契约不裁定 Runtime.close() 是否纳入它。
```

---

## §8 §D — G-04: Production Registry Writer

```text
【定义（必须窄）】
CSO-D-1  G-04 = **Production Registry Writer Integration**。
         它只负责：ChildSession 创建完成 ⇒ 取得其 sessionId ⇒ 取得对应 capability
                   ⇒ `registry.register(sessionId, capability)` ⇒ **停止**。
CSO-D-2  G-04 的落点必须是【生产路径上唯一】的 register 调用点。
         ★ 验收要求：证明 register 的 production writer 只有一个（§15）。

【G-04 MUST NOT】
CSO-D-3  ❌ 创建 Session
         ❌ 生成 sessionId
         ❌ 修改 `ChildSessionOptions`
         ❌ 修改 `ExecutionSessionCapability`
         ❌ 修改 Provider
         ❌ 修改 Coordinator
         ❌ 实现 close / dispose / abort（★ 那是 G-05）
         ❌ 改变 TaskEngine lifecycle
         ❌ 实现 retry
         ❌ 实现 scheduler
         ❌ 创建新的 Registry 或引入第二个 Registry
         ❌ 修改 AF-4

CSO-D-4  ★ G-04 **不得**顺手把 G-05 做了（§13）。
CSO-D-5  G-04 **不得**把 register 的语义从「写入 capability 索引」扩大为
         「管理 session 生命周期」或「决定 session 何时销毁」。
CSO-D-6  G-04 的 key 必须来自 session 自身（CSO-C-5）；❌ 不得 register(taskId, capability)、
         ❌ 不得 register(独立于 session.sessionId 重新生成的 key, capability)。
```

---

## §9 §E — R-2B: Factory / Capability Integration

```text
【定义】
CSO-E-1  R-2B = **Factory / CLI capability integration**（AF-1C IC-11-2 登记项）。
         它只解决生产路径：production Factory ⇒ production Session ⇒ Capability Adapter ⇒ Registry，
         以及 TianchaRuntime 的统一装配。

CSO-E-2  ★ R-2B 的边界收紧（不得越界）：
         · ❌ 不因 R-2B 顺手重构整个 CLI（CLI 只做 entrypoint 化，不做重写）
         · ❌ 不改变 `ExecutionSessionCapability` 的冻结能力面（[F-1]）
         · ❌ 不让 Factory 变成 God Object：Factory ≠ SessionFactory + Registry + LifecycleManager
         · ❌ 不让 Adapter 越权（[F-12] IC-5-3 继续成立）
         · ❌ 不把 session lifecycle 决策放进 Factory

CSO-E-3  R-2B 可以建立 composition boundary 层面的装配关系
         （Factory 由 Runtime 装配、Registry 由 Runtime 持有），
         但 Factory【不得】成为第二套 session creation seam 之外的 Registry 持有者。

CSO-E-3.1  ★ 「Factory integration」≠「Factory owns Registry」。
           R-2B 的 Factory Integration 属 **composition wiring responsibility**，
           不构成 SessionRegistry 的 ownership transfer。
           ⇒ 即使装配形式上出现 `buildAgentSessionFactory(registry)` 这类参数传递，
              Registry 的 Owner 仍是 TianchaRuntime（§11 表）；Factory 只是被接线的一方。

CSO-E-3.2  ★ R-2B-A 不得成为 production Registry Writer。
           R-2B-A 可以完成 Factory / Session / Capability / Registry 的 composition wiring，
           但任何 production `registry.register(...)` 调用只能由 G-04 引入；
           R-2B-A 不得提前实现、复制或隐藏 register 行为。

CSO-E-4  R-2B 落地后，`AgentSessionFactoryPort.create()` 的【调用链】与【Options 形状】保持不变
         （[F-3] / [F-4]）；变化只在「谁提供生产实现」与「装配点在哪」。
```

---

## §10 §F — CLI Migration Boundary

```text
CSO-F-1  CLI 的最终角色 = **entrypoint / command adapter**。
         ❌ 不是整个系统的 composition root。
CSO-F-2  ★ 目标形态：
             CLI → TianchaRuntime → { SessionRegistry, Factory, Provider, Coordinator, Caller, … }
         禁止形态：
             CLI → { new SessionRegistry(), new Provider(), new Coordinator(), new Caller(), new Runtime() }
CSO-F-3  ★ 本契约只冻结【最终角色】；CLI 的实际迁移属 R-2B 的实施范围，
         且【不得】夹带无关重构（CSO-E-2）。
CSO-F-4  CLI 现有的 smoke 装配（src/cli/tiancha.ts cmdResearchSmoke 内的
         `new SessionRegistry()` + `buildAgentSessionFactory(registry)`）**保持原样**，
         直到 R-2B 明确授权改动。★ 本契约不授权改动它。
CSO-F-5  entrypoint 数量的增长（Web / API / Agent Host / Desktop / automation）**不得**导致
         runtime 装配逻辑被复制；装配必须复用 TianchaRuntime（CSO-A-2 / CSO-A-3）。
```

---

## §11 Ownership Matrix（冻结表）

| 对象 | 创建者 | Owner | 读取者 | 修改者 | 生命周期 |
|---|---|---|---|---|---|
| `SessionRegistry` | TianchaRuntime | **TianchaRuntime** | Provider / 需要 lookup 的组件 | G-04 `register` / G-05 `remove` | 随 Runtime（★ 结束语义 = G-05） |
| `ChildSession` | Factory（session creator） | **TaskEngine 持有**（`openSessions`，private） | TaskEngine | Factory 实现 | Task lifecycle |
| `sessionId` | **Session creator（factory 实现）** | **被创建的 session（identity）** | Caller / Provider（只消费） | ★ **不可变**（无修改者） | Session |
| `ExecutionSessionCapability` | Adapter（`PiSessionCapabilityAdapter`） | Registry 中的映射值 | Provider（`lookup`） | ★ 不修改 | Session |
| `ExecutionRequest` | Caller（构造）/ Coordinator（传递） | Coordinator 的调用边界 | Provider | Provider 不改 | 单次 execution |
| `DispatchedExecutionContext` | Caller（由 R2 dispatched result 投影） | Caller | Coordinator | ★ 不可变 | 单次 execution |
| register 落点 | G-04 | G-04 | — | G-04 | 每个 session 一次 |
| close / dispose / abort / remove 语义 | — | **G-05（DEFERRED）** | — | G-05 | ★ 本契约不定义 |

```text
★ 本表的使用方式：任何实现前，先确认「该对象的 Owner 只有一处」。
   若出现两个候选 owner ⇒ STOP ⇒ 报告 ⇒ 裁定（这是本表存在的唯一目的）。
```

---

## §12 Invariants（CSO-*）

```text
CSO-INV-1   TianchaRuntime 是唯一 composition root（CSO-A-1）。
CSO-INV-2   禁止第二个 SessionRegistry（CSO-C-2）。
CSO-INV-3   sessionId 的唯一事实源 = ChildSession.sessionId（CSO-B-8）。
CSO-INV-4   sessionId 三独立：≠ taskId / ≠ attemptId / ≠ runId（CSO-B-2 / CSO-B-3）。
CSO-INV-5   TianchaRuntime 不生成 sessionId；ChildSessionOptions 不因本契约新增 sessionId（CSO-B-5 / CSO-B-6）。
CSO-INV-6   register 的 key 必须来自 session 自身（CSO-C-5 / CSO-D-6）。
CSO-INV-7   Adapter 的禁止面继续成立（IC-5-3）：不生成 sessionId / 不注册 / 不持有 Registry（CSO-E-2）。
CSO-INV-8   Provider 与 Runtime 必须使用同一个 Registry 实例（AF-1C AI-5-2 / L549 · CSO-C-6）。
CSO-INV-9   本契约不解决 Session lifecycle；close / dispose / abort / timeout / cancellation
            继续归 G-05（§13 · CSO-D-4）。
CSO-INV-10  AF-1C / AF-4 / R2 的冻结语义不被本契约改变；如需变更，必须走 Amendment（§18）。
```

---

## §13 G-05 Boundary（严禁顺手吸收）

```text
CSO-G05-1  ★ 本契约【只承认】G-05 的归属，不实现、不定义、不部分实现。
CSO-G05-2  以下概念在本契约与 G-04 / R-2B 的范围内一律【禁止被改变或实现】：
             close · dispose · abort · timeout · cancellation · waiting · resource release ·
             waitForIdle · registry 的结束语义
CSO-G05-3  现行事实（[F-8]）继续成立且【不得改变】：
             ChildSession.close() 的底层语义 = no-op（Pi 只有同步 dispose() / async abort()）
             ⇒ ❌ 不得「因为要 remove 就顺手升级成 dispose()/abort()」
CSO-G05-4  禁止出现把 registration 与 lifecycle 合并的单一对象
           （例如 SessionManager 同时拥有 register + close + dispose + abort）。
CSO-G05-5  若实施中发现必须触碰上述任一概念 ⇒ STOP ⇒ 报告 ⇒ 裁定是否另开 G-05 切片。
```

---

## §14 Contract Review Checklist（8 问 · 实施前必须逐条回答）

```text
① 是否存在两个 composition root？
     必须：TianchaRuntime = primary（唯一）。
     禁止：CLI 与 Runtime 同时是 composition root。

② 是否存在两个 Registry？
     必须：一个 Runtime 实例生命周期内恰有一个 SessionRegistry。

③ sessionId 是否有第二事实源？
     必须：ChildSession.sessionId 是唯一 identity source。
     禁止：TaskEngine / Runtime / Registry key 各自保存一份。

④ register 的 key 是否可能错配？
     必须保证：register(session.sessionId, capabilityFor(session))。
     禁止：register(taskId, capability) · register(与 session.sessionId 无关的独立生成 key, capability)。

⑤ Factory 是否开始知道 Registry？
     允许：composition boundary 层面的装配关系。
     禁止：Factory 退化为 SessionFactory + Registry + LifecycleManager 的 God Object。

⑥ CLI 是否继续拥有 runtime dependencies？
     目标：CLI → Runtime。
     禁止：CLI 重新组装内部依赖。

⑦ G-05 是否被偷偷吸收？
     重点查：close / remove / abort / dispose / timeout / cancellation 出现时是否越界。

⑧ AF-1C / AF-4 / R2 是否被反向污染？
     检查是否新增 dependency、是否改变 identity semantics。
     若有 ⇒ 必须重新开 Amendment，不得偷偷修改。
```

---

## §15 G-04 / R-2B 独立 Gate

```text
CSO-GATE-1  契约【统一】，验收【独立】。本契约是一份文档，但 G-04 与 R-2B 各自有独立 Gate。
CSO-GATE-2  G-04 Gate 必须证明：register 的 **production writer 只有一个**（唯一落点）。
CSO-GATE-3  R-2B Gate 必须证明：
              · production factory 的落点唯一；
              · TianchaRuntime → Factory → Session → Capability → Registry 的装配链闭合；
              · CLI 降级为 entrypoint（不含内部依赖组装）。
CSO-GATE-4  两个 Gate 各自独立 Review / 独立授权 / 独立 commit；
            ❌ 不得合并为一次提交、❌ 不得一次改十几个文件。
CSO-GATE-5  ★ 禁止「G-04 顺带完成 G-05」或「R-2B 顺带重构 CLI」（CSO-D-4 / CSO-E-2）。
CSO-GATE-6  R-2B-A 验收必须证明其变更不产生任何新的 production `registry.register(...)` writer；
            G-04 是唯一允许新增该 production writer 的 Slice。
```

---

## §16 Implementation Slicing（建议顺序 · 均需单独授权）

```text
Slice 1（R-2B-A）  Composition Root / Factory integration
                   · TianchaRuntime 持有 SessionRegistry；
                   · 生产 Factory 落点确定；
                   · CLI 降级为 entrypoint（最小改动）。
Slice 2（G-04）    Production Registry Writer
                   · 唯一 register 落点接入生产路径；
                   · 不放宽、不扩展、不吸收 G-05。

★ 两个 Slice 各自：Preflight（只读）→ Review → 明确授权 → 落盘 → 验收 → 停。
★ 本契约【不】授权任一个 Slice 开始。
```

---

## §17 Downstream: Execution Caller（边界预告 · 非本契约范围）

```text
CSO-DOWN-1  在 G-04 / R-2B 闭合后，Caller 才能可靠地只做五件事：
              ① 调用 Orchestrator
              ② 获取 dispatched result（R2 rev1 + Amendment 1：taskId / attemptId / sessionId）
              ③ 组装 DispatchedExecutionContext
              ④ 接收 upstream prompt（source-agnostic · O-AC-6 Q2(c)）
              ⑤ 调用 Coordinator
CSO-DOWN-2  Caller ❌ 不创建 Task / ❌ 不创建 Attempt / ❌ 不创建 Session / ❌ 不生成 sessionId /
            ❌ 不注册 Session / ❌ 不 complete / ❌ 不 fail / ❌ 不 retry / ❌ 不 scheduler /
            ❌ 不推断 prompt。
CSO-DOWN-3  Caller 的宿主已裁定为 `runtime/execution-caller.ts`（O-AC-6 Q1=A）；
            其契约与实现均为【后续独立阶段】。
CSO-DOWN-4  ★ Caller 不需要自己解决 session creation —— 这正是本契约先行的理由。
```

---

## §18 Relationship to Frozen Contracts

```text
CSO-REL-1  ★ 本契约【不修改】AF-1C / AF-4 / R2 的任何冻结文本。
CSO-REL-2  本契约【不新增】对上述契约的 dependency，也不改变其 identity semantics。
CSO-REL-3  与 AF-1C 的关系：
             · AF-1C AI-5-1 / AI-5-2 / L549（Registry ownership = composition root）—— 本契约**确认并指向**它；
             · AF-1C IC-6-2 / IC-6-2.1 / IC-6-3（register / remove 落点）—— 本契约**不改**其位置语义，
               只把「production writer」这一归属交给 G-04；
             · ★ [F-11] 记录的「契约要求 TianchaRuntime 持有，而实现在 CLI」属**实现滞后**，
               由 R-2B 收敛为一致；本契约不修改 AF-1C 文本。
CSO-REL-4  与 R2（rev1 + Amendment 1）的关系：本契约消费其 dispatched result（taskId/attemptId/sessionId），
           不新增其字段、不改变其 D-RED-1…D-RED-11。
CSO-REL-5  与 AF-4 的关系：★ **无变化**（O-AC-7 [8]）。Coordinator 只消费 opaque `sessionId`。
CSO-REL-6  ★ 若实施中发现必须修改上述任一冻结契约 ⇒ STOP ⇒ 报告 ⇒ 另开 Amendment，
           ❌ 不得在本契约的 Slice 内偷偷修改。
```

---

## §19 Open Questions / To Be Adjudicated

```text
CSO-Q-1  TianchaRuntime.close() 是否纳入 SessionRegistry 的结束语义？（⇒ 归 G-05）
CSO-Q-2  TianchaRuntimeDeps 的最终字段清单（registry / provider / coordinator / caller 的注入形式）
         —— 由 R-2B-A Slice 的 Preflight 决定，本契约不预先写死（CSO-A-7）。
CSO-Q-3  生产 sessionId 的具体生成规则（格式/来源）—— 由 G-04 / R-2B Gate 决定；
         ★ 唯一硬约束 = CSO-B-2 / CSO-B-3 / CSO-B-4（不派生、不由 Runtime 生成）。
CSO-Q-4  CLI 迁移到 entrypoint 的【最小】形态（哪些行必须移出、哪些保留）—— 由 R-2B-A Preflight 取证。
CSO-Q-5  smoke 路径（cmdResearchSmoke）的最终去留 —— 不在本契约范围，单独裁定。
```

---

## §20 Status

```text
Composition / Session Ownership Contract（rev1）   🔒 FROZEN
  §A Composition Root            🔒 frozen（TianchaRuntime = primary；CLI = entrypoint）
  §B Session Identity            🔒 frozen（identity owner = session creator；三项独立；不可变）
  §C Registry Ownership          🔒 frozen（TianchaRuntime owns；恰一个；无 lifecycle API）
  §D G-04 Production Writer      🔒 frozen（定义 + MUST NOT 清单 + 独立 Gate）
  §E R-2B Factory Integration    🔒 frozen（边界收紧 + 独立 Gate）
  §F CLI Migration Boundary      🔒 frozen（角色定义；不授权迁移）
  §11 Ownership Matrix           🔒 frozen
  §12 Invariants（CSO-INV-1…10） 🔒 frozen
  §13 G-05 Boundary              🔒 frozen（严禁吸收）
  §14 Review Checklist（8 问）    🔒 frozen
  §16 Implementation Slicing     🟡 建议（R-2B-A → G-04；均需独立授权）
  §19 Open Questions            ⏳ 待裁定（CSO-Q-1…Q-5）

Implementation（任一部分）        ⛔ NOT AUTHORIZED
G-04 / R-2B                      ⛔ NOT AUTHORIZED
Execution Caller Contract / Impl   ⛔ NOT AUTHORIZED
G-05 / G-06 / G-07 / CLI 重构      ⛔ NOT AUTHORIZED
Commit / Push                    ⛔ NOT AUTHORIZED
```

---

## §21 Revision identity

```text
· 本文件为 rev1 首次落盘（初版为 DESIGN ONLY）。
· ★ Freeze 记录：rev1 经 Architecture / Ownership / Boundary / Identity Semantics /
  G-04 · R-2B Boundary / Frozen-contract Isolation / Internal Consistency /
  Scope · Authorization / Git · Change Isolation 全部 PASS，
  且 Final Freeze Readiness = 🟢 PASS 后，冻结为 **🔒 FROZEN（rev1）**。
· 本文件不重写任何已冻结契约（AF-1C / AF-4 / R2 / AF-1）的文本。
· 本文件不含任何代码、不含 schema、不含 migration、不含 CLI 改动。
```
