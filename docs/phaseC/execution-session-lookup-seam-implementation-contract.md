# AF-1B-I · Execution Session Lookup Seam Implementation Contract

> **Status:** rev1 — DOCS-ONLY · **AUTHORIZED TO DRAFT** · **NOT YET APPROVED**（待 Human Contract Review）
> **Scope:** docs-only。把已冻结的 `Minimum Execution-Session Capability` + AF-1B 设计契约，收敛成 **registry 本体（register / lookup / remove）可实施、可验收的工程合同**；**不实现代码**、**不预设 runtime 文件 / class / 结构**（除证据证明必要）。
> **上游依据（严格继承，均不修改）:** `docs/phaseC/execution-session-lookup-seam-contract.md`（AF-1B rev1 + Amendment 1 · FROZEN / PUBLISHED `a97cf6b` · sha256 `72ba1179…`）· `docs/phaseC/execution-provider-contract.md`（AF-1 rev2 · FROZEN `c3fb4d6`）· `docs/phaseC/execution-provider-implementation-contract.md`（AF-1 Impl rev1+Amd1 · FROZEN `3294b72`）· `docs/phaseC/execution-coordinator-implementation-contract.md`（AF-4 Impl rev2 · FROZEN `38862f5`）· `docs/phaseC/task-engine-failure-boundary-contract.md`（AF-2+AF-3 · FROZEN `eef63ac`）· `docs/phaseC/round-execution-driver-contract.md`（R2 · FROZEN `275b84d`）· `docs/phaseC/c7b-execution-wiring-contract.md`（rev4 · FROZEN）
> **证据基础:** AF-1B Implementation Preflight（只读）· AF-1B Settlement / Output Semantics Preflight（只读）· AF-1B-I Implementation Preflight（只读）· R-1 / R-2 裁定
> **本契约不授权实现。** 未授权：AF-1B-I 实现 · AF-1C · AF-4 implementation · 任何 .ts/.tsx/.js · 修改 AF-1B 设计契约 / AF-1A port / TaskEngine / Orchestrator / CLI / ModelRouter / `AgentSessionFactoryPort` · G-04 · G-05 · G-06 · `5d45e3d` / `.gitattributes` · commit · push。

---

## §0 授权与状态

```text
AF-1 rev2 / AF-1 Impl Contract                  🔒 FROZEN · 🟢 PUBLISHED
AF-1A（Provider Port + 6 types）                🟢 CLOSED / PUBLISHED（d6d81f1）
AF-1B（Session Lookup Seam Contract）           🟢 FROZEN / PUBLISHED（a97cf6b）
Settlement / Output Semantics Preflight         🟢 PASS / CLOSED
Minimum Execution-Session Capability            🟢 FROZEN
AF-1B-I Implementation Preflight                🟢 PASS
R-1 Registry Writer                             🟢 裁定 (a)（G-04 DEFERRED）
R-2A Registry Capability                        🟢 Registry 可独立实现
R-2B Factory / CLI Integration                  🟡 DEFERRED
AF-1B-I Implementation Contract（本文）          🟡 AUTHORIZED TO DRAFT · DOCS-ONLY · ❌ NOT YET APPROVED
AF-1B-I Code Implementation                     ⛔ NOT AUTHORIZED
AF-1C PiExecutionProvider                       ⛔ NOT AUTHORIZED
AF-4 Coordinator                                ⛔ NOT AUTHORIZED
TaskEngine · R2                                 🔒 FROZEN / 不修改
G-03 · G-04 · G-05 · G-06                       🟡 DEFERRED
```

**本轮唯一允许的动作：在 `docs/phaseC/` 下新建本契约文件。不碰代码、不改既有契约、不 commit、不 push。**

---

## §1 Purpose

AF-1B 已冻结「谁拥有 / 谁注册 / 谁 lookup / 谁移除」与「lookup 返回抽象 execution-session seam」。此后仍缺一份**可实施的工程合同**，回答 registry 本体的十个语义问题：

```text
① Registry 的 ownership 归谁（且【不】因此绑定具体文件 / class）？
② register 的输入是什么能力？sessionId 从哪来？重复注册如何处理？
③ lookup 命中返回什么？miss 如何表达？是否允许返回内部引用？
④ remove 的边界（只删 mapping，不做 lifecycle）？
⑤ sessionId 的 identity 约束（唯一、不可推导、不可生成）？
⑥ 注册对象必须满足哪条最小能力（以及【不得】暴露什么）？
⑦ Registry 参与 model 解析吗？
⑧ Registry 拥有 lifecycle authority 吗？
⑨ 当前 Factory / CLI 能满足能力吗？本契约修吗？
⑩ AF-4 如何（不）接触 Registry？
```

**目的不是解决集成（那是 G-04 / R-2B），而是把 registry 本体的行为边界钉死，使实现阶段不再自行发明。**

---

## §2 Scope / Non-goals

### §2.1 Scope

```text
S-1  Registry ownership（§5）
S-2  register 语义（§6）
S-3  lookup 语义（§7）
S-4  remove 语义（§8）
S-5  Identity（§9）
S-6  Minimum Capability 对齐（§10）
S-7  Model（§11）
S-8  Lifecycle（§12）
S-9  Factory / CLI（§13）
S-10 AF-4 boundary（§14）
S-11 禁止面（§15）· 不变量（§16）· Review Gate（§18）
```

### §2.2 Non-goals

```text
❌ 不实现任何代码（不写 class / module / registry 实现文件 / 不预设实现位置 / 结构）
❌ 不解决 production writer（R-1：谁调用 register）= G-04
❌ 不解决 Factory / CLI 集成（R-2B）= 独立 Integration seam
❌ 不解决 G-05（lifecycle）· G-06（model fidelity）· G-03
❌ 不修改 AF-1B 设计契约 / AF-1A port / TaskEngine / Orchestrator / CLI / ModelRouter
❌ 不定义 AF-1C 的 Provider 实现
❌ 不定义 AF-4 的执行协调
❌ 不引入 scheduler / concurrency / retry / 第二套状态机 / TTL / 淘汰策略
```

---

## §3 Terminology

| 术语 | 含义（本契约内冻结） |
| --- | --- |
| **execution session** | lookup 所返回的抽象对象；其能力面由 §10 冻结（**不是** Pi `AgentSession`） |
| **registered capability** | 被 register 的 execution session 实例（满足 §10 能力边界） |
| **registry** | `sessionId` → registered capability 的 ownership seam 本体（见 §5） |
| **opaque `sessionId`** | 唯一 lookup key；registry 不解释其结构、不推导、不生成 |
| **writer** | 在生产路径上调用 `register` 的一侧（= R-1 / G-04，**本契约不解决**） |
| **reader** | 通过 `lookup` 取得 execution session 的一侧（= AF-1C Provider，未来） |

**术语纪律：** 本契约中 `registry` **始终**指 registry 本体，**绝不**指 AF-4 Coordinator；`lookup` 指 research-facing 的 opaque 解析，**不是** Pi 层的方法名。

---

## §4 现况事实（只读取证，登记不改）

```text
F-1  全仓【无】session registry（AF-1B-I Preflight 扫描确认）。
     domain/policy-registry.ts:17  PolicyRegistry<T extends VersionedPolicy>（byVersion + 拒绝覆盖）
     domain/chain-template.ts:43   ChainTemplateRegistry（同为 immutable version-keyed）
     ⇒ 二者语义为「版本化不变策略」，**不是** sessionId → handle ⇒ 【不可复用】
F-2  TaskEngine.openSessions = private readonly Map<string, ChildSession>
     （runtime/task-engine.ts:30；set(taskId,session) :84 · get(taskId) :154 · delete(taskId) :157）
     ⇒ key 是 **taskId**（不是 sessionId）；且 private ⇒ Provider 不可访问（IP-R2-2）
F-3  TaskEngine.start() 返回 { task, attempt, session }，但
     Orchestrator.stepRound()（orchestrator.ts:215）调用后【丢弃返回值】
     ⇒ 当前不存在任何合法的 production writer（= G-04 / R-1）
F-4  AgentSessionFactoryPort.create() 返回 ChildSession = { sessionId, taskId, close() }
     （ports/agent-session-factory.port.ts:46-51）
     ⇒ ❌ 不满足 §10 冻结能力（无 prompt / 无 messages）（= R-2B）
F-5  TianchaRuntime（composition root，runtime/tiancha-runtime.ts:20-29）deps 6 项，
     【无】provider、【无】registry；modelRouter 为构造内局部变量（:44）
F-6  concrete Pi AgentSession 已具备所需能力（prompt() agent-session.d.ts:393 ·
     get messages() :331 = agent.state.messages），但 CLI 将其窄化丢弃（tiancha.ts:123）
F-7  AF-1B 设计契约已冻结：SL-OWN-1…5 · SL-REG-1…4 · SL-LKP-1…4 · SL-LIF-1…6 · SL-ID-1…4 · SL-MOD-1…4 · SL-ERR-1…4
```

**⇒ 本契约不改变 F-1…F-7 中的任何一项；它们只作为行为边界设计的既定事实。**

---

## §5 ① Registry ownership（冻结）

```text
SI-OWN-1  Registry 的 ownership = **composition-root / concrete-session owning side**
          （继承 AF-1B SL-OWN-2；【不是】AF-1C ExecutionProvider 本身）。
SI-OWN-2  Registry 【不】等同于下列任一者（等价于不变量 SI-11…SI-15）：
              Registry ≠ lifecycle owner
              Registry ≠ model resolver
              Registry ≠ TaskEngine
              Registry ≠ Orchestrator
              Registry ≠ Provider
SI-OWN-3  Registry 的【具体实现归属】——位置 / class / 文件 / 数据结构 ——
          【不在本契约冻结】；留待 AF-1B-I implementation（§17 O-SI-1）。
          ⇒ 仅当实施时出现**证据证明必要**，才在该轮另行裁定（不得在本契约预设）。
SI-OWN-4  Registry 必须与 TaskEngine 分离（IP-R2-1 / IP-R2-2：TaskEngine 不得成为 lookup backend，
          Provider 不得访问其 private state）。
SI-OWN-5  Registry 不得由 AF-4 Coordinator 承担（AF-1B SL-REG-1）。
```

```text
合法形态（继承 AF-1B §5 图）：
    TaskEngine.start()  ──creates──▶  concrete session
                                            │ register（writer = G-04，DEFERRED）
                                            ▼
                                       registry
                                            │ lookup(handle.sessionId)
                                            ▼
                                   execution-session seam
                                            │
                                            ▼
                                   PiExecutionProvider（AF-1C）
```

---

## §6 ② register 语义（冻结）

```text
SI-REG-1  输入语义 = { sessionId（opaque 身份）, executionSession（满足 §10 能力边界的对象） }。
          ⇒ 只接受这两个语义输入；【不】接受 taskId / attemptId / model / 任何 Pi 类型作为参数。
SI-REG-2  sessionId 的【来源】= **由调用方（writer）提供**。
          · Registry 【不生成】sessionId
          · Registry 【不推导】sessionId（不得由 taskId / attemptId 计算）
          · Registry 【不解析】sessionId 的结构（不得识别 typeof / 前缀 / 分隔符）
          · 现有 CLI 的 `child-${opts.taskId}` 形态属 CLI 现状（fact F-6 / G-06）；
            Registry 【不】复制该约定，也【不】为其做兼容分支。
SI-REG-3  ★ 重复 register 同一 `sessionId`：【裁定 = 拒绝，不得静默覆盖】。
          规则：同一 key 再次 register（无论对象是否相同）⇒ 必须【显式失败】。
          理由（冻结）：registry 是 ownership seam；同一身份出现两个持有者即身份冲突，
                        静默覆盖不可审计。
          一致性：与既有 `TaskEngine.enqueue()`（task-engine.ts:35-37 已存在即 throw）
                  和 `PolicyRegistry.register()`（拒绝覆盖）同构。
SI-REG-4  register 【不】触碰 concrete session 的任何 lifecycle 方法
          （不 close / 不 dispose / 不 abort）；register 只登记映射。
SI-REG-5  register 【不】对 executionSession 做真实模型 / 网络 / Pi 调用。
```

---

## §7 ③ lookup 语义（冻结）

```text
SI-LKP-1  命中 ⇒ 返回注册时登记的 execution session（§10 能力对象），
          【不得】直接返回 Pi `AgentSession`（AF-1B SL-LKP-1）。
SI-LKP-2  ★ 是否允许返回内部对象引用：【裁定 = 返回原实例引用，不复制、不包装、不代理】。
          理由（冻结）：registry 是映射（ownership seam），不是工厂；
                        execution session 是【有状态执行体】，复制无意义且会制造第二身份。
          ⚠️ 明文声明：返回引用【不】授予 lifecycle 权威 —— 调用方不得因持有引用而
                        close / dispose / abort（§12 SI-LIF-2）。
SI-LKP-3  ★ miss 的表达：【裁定 = 必须与「命中」显式可区分】
          · 允许的具体形态（返回值 / 抛错 / 结果对象）【不预设】—— 由 AF-1C 定义到
            `ExecutionOutcome` 的映射（AF-1B SL-ERR-2）。
          · 但冻结两条硬约束：
              (a) lookup miss 【不得】被静默当作「命中了一个空对象」；
              (b) lookup seam failure 【不得】被伪装成 model / execution failure
                  （AF-1B SL-ERR-1 / SL-ERR-3 / SL-ERR-4）。
SI-LKP-4  lookup 必须【无副作用】：不得借由 lookup 触发 register / remove /
          close / dispose / abort / 任何 lifecycle 动作。
SI-LKP-5  lookup 【不】触发 model 解析（§11）。
```

---

## §8 ④ remove 语义（冻结）

```text
SI-REM-1  `remove(sessionId)` 的语义【仅为】从 registry 移除该 key 的映射
          （继承 AF-1B §6.1 / §8 SL-LIF-4 的同一语义锚点）。
SI-REM-2  ❌ remove 不得隐式执行任何 concrete-session lifecycle 操作：
              remove ≠ close
              remove ≠ dispose
              remove ≠ abort
              remove ≠ finishSession
          （AF-1B Amendment 1 · B）
SI-REM-3  ★ remove 不存在 key：【裁定 = 幂等 no-op，不抛错】。
          理由（冻结）：register 是「取得所有权」（冲突必须显式失败，SI-REG-3）；
                        remove 是「释放所有权」（重复释放无害，重试安全）。
                        ★ 二者方向相反，故裁决相反，不是不一致。
SI-REM-4  remove 【不】负责资源回收语义：registry 不保证对象被回收，
          【不】持久化、【不】记账、【不】发事件（AF-1B SL-REG-2）。
```

---

## §9 ⑤ Identity（冻结）

```text
SI-ID-1  key = **opaque `sessionId`**，且是唯一 lookup key（AF-1B SL-ID-1）。
SI-ID-2  ❌ 不得由其他标识推导：taskId → sessionId · attemptId → sessionId
SI-ID-3  ❌ 不得生成 / 拼接 / 规范化 sessionId；Registry 不承担 id 生产职责。
SI-ID-4  ❌ 不得使用字符串约定反推（例如 `child-${taskId}` 一类形态；AF-1B SL-ID-4）。
SI-ID-5  Registry 对 sessionId 的唯一允许操作 = 作为 **Map 键** 使用（等值比较）。
```

---

## §10 ⑥ Minimum Capability 对齐（冻结）

```text
SI-CAP-1  registered capability 必须满足【已冻结】的最小能力：
              ① 执行一次 prompt
              ② 读取本次执行产生的 messages
              ③ prompt() resolve ≡ execution settled（无需额外 settlement 调用）
          （Settlement / Output Semantics Preflight 结论）
SI-CAP-2  ❌ 注册对象【不得】以最小能力的形式暴露：
              abort · dispose · close · waitForIdle · model · thinkingLevel · state · raw
          （AF-1B §7 SL-LKP-2 最小能力原则）
SI-CAP-3  Registry 【不】校验具体类型（不 import Pi 类型、不做 instanceof）；
          能力边界由本契约冻结，由【提供方】（未来 legal integration path）负责满足。
SI-CAP-4  Registry 【不】转发 prompt / messages；也不提供任何执行辅助
          （「执行 session」是 AF-1C 的职责，AF-1B 只「找到 session」）。
SI-CAP-5  ❌ 不得因为 `ExecutionOutput` 预留了 `text` / `raw`，就要求 registered capability
          提供它们（AF-1B：`text` 由 messages 投影；`raw` / `state` 无消费者 ⇒ 不进入）。
```

---

## §11 ⑦ Model（冻结）

```text
SI-MOD-1  Registry ❌ 不解析 model；❌ 不调用 `ModelRouter.resolve()`（AF-1 IP-D-2 / AF-4 A-6）。
SI-MOD-2  Registry ❌ 不从 execution session 读取 `model` / `thinkingLevel` getter 建立第二真来源
          （AF-1B SL-MOD-3）。
SI-MOD-3  Registry 不参与 model propagation：`TaskAttempt.model → ExecutionRequest.model → actual execution`
          链与 registry 无关（那是 AF-1C 与 G-06）。
SI-MOD-4  register 的输入【不含】model（SI-REG-1）⇒ registry 在结构上无法成为 model 来源。
```

---

## §12 ⑧ Lifecycle（冻结）

```text
SI-LIF-1  Registry 【不】拥有 lifecycle authority（AF-1B SL-REG-2 / SL-LIF-5 / SL-LIF-6）。
SI-LIF-2  持有 lookup 返回的引用【不】授予 lifecycle 权威：
          close / dispose / abort / finishSession / CLI cleanup 全部属 **G-05**，本契约不碰。
SI-LIF-3  remove ≠ lifecycle 终点（SI-REM-2）；
          registry 也不因 remove 而成为「已关闭资源集合」的记录者。
SI-LIF-4  ★ 与 G-05 严格分离（冻结）：
          【不】修 `ChildSession.close()` · Pi `dispose()` / `abort()` ·
                `TaskEngine.finishSession()` · CLI session cleanup
SI-LIF-5  ⛔ 不得把 AF-1B-I 扩大成「Session Lifecycle Repair」。
```

---

## §13 ⑨ Factory / CLI（冻结）

```text
SI-FAC-1  【事实声明】当前 `AgentSessionFactoryPort.create()` → `ChildSession`
          = { sessionId, taskId, close() }（ports/agent-session-factory.port.ts:46-51）
          ⇒ ❌ **不满足** §10 冻结的最小 execution capability（无 prompt、无 messages）。
SI-FAC-2  本契约【不修】`AgentSessionFactoryPort`、`ChildSession`、`child-session.ts`、
          `src/cli/tiancha.ts` 或任何组装层。
SI-FAC-3  「谁生产满足能力的对象并交给 register」= **R-2B / G-04** ⇒ 🟡 DEFERRED。
SI-FAC-4  ⇒ 因此在本契约范围内：registry 本体可独立实现与验收，但
          · 【无】production writer（R-1 = G-04）
          · 【无】production reader（AF-1C 未授权）
          ⇒ 这【不】构成实现阻塞，但必须在实现报告中如实声明「未接入生产路径」。
SI-FAC-5  ⛔ 不得为了让 registry「跑起来」而修改 Factory / CLI / TaskEngine / Orchestrator。
```

---

## §14 ⑩ AF-4 boundary（冻结）

```text
SI-AF4-1  AF-4 只能通过其**既有 narrow context / provider boundary**使用；
          ❌ 不允许 AF-1B-I 反向进入 AF-4（不得修改 AF-4 契约 / 实现 / AC-*）。
SI-AF4-2  AF-4 ❌ 不得访问 registry internals；❌ 不得 lookup concrete session
          （AF-4 Impl §12 D-10 / AC-13 · AF-1B §12.2）。
SI-AF4-3  AF-4 ❌ 不得 create / destroy session；❌ 不得访问 `TaskEngine.openSessions`。
SI-AF4-4  Registry 的产物（execution session）只经 **AF-1C Provider** 进入执行链，
          再由 `ExecutionOutcome` 交给 AF-4（既有边界，不改）。
```

---

## §15 禁止面（冻结）

### §15.1 反泛化（★ 用户明确要求）

```text
❌ 不得设计 `Registry<T>` 一类把一切泛化掉的形式
❌ 不得设计「万能 Session」：
       ExecutionSession { prompt(); messages; abort(); dispose(); model; thinkingLevel; state; ... }
   ⇒ 这会把经证据审查才削掉的宽表面重新引回
❌ 不得为「未来可能需要」增加任何方法 / 字段 / 钩子
```

### §15.2 Registry 禁止

```text
❌ 生成 / 推导 / 解析 sessionId
❌ 调用 ModelRouter.resolve()
❌ 读 session 的 model / thinkingLevel getter
❌ 调用 close / dispose / abort / finishSession
❌ 持有 lifecycle authority / 资源回收职责
❌ 访问 TaskEngine private state（含 openSessions）
❌ 成为 AF-4 Coordinator
❌ 提供 prompt / messages 的转发或执行辅助
❌ 持久化 / 记账 / 发事件 / TTL / 淘汰策略（本 Slice 不含）
```

### §15.3 上游禁止被改造

```text
❌ 修改 AF-1B 设计契约 · AF-1A port · TaskEngine · Orchestrator · CLI · ModelRouter
❌ 修改 `AgentSessionFactoryPort` / `ChildSession`
（除非之后单独授权）
```

---

## §16 核心不变量（SI-1 … SI-20）

| ID | 冻结语义 |
| --- | --- |
| **SI-1** | Registry ownership = composition-root / concrete-session owning side；不是 AF-1C Provider 本身 |
| **SI-2** | Registry 的具体实现归属（位置 / class / 文件 / 结构）不在本契约冻结 |
| **SI-3** | Registry 必须与 TaskEngine 分离；不得成为 lookup backend；不得访问其 private state |
| **SI-4** | register 只接受 `{ sessionId, executionSession }`；不生成 / 不推导 / 不解析 sessionId |
| **SI-5** | 重复 register 同一 sessionId ⇒ **显式失败**，不得静默覆盖 |
| **SI-6** | register 不触碰任何 session lifecycle 方法 |
| **SI-7** | lookup 命中返回登记的原实例引用（不复制 / 不包装 / 不代理）；不得直接返回 Pi `AgentSession` |
| **SI-8** | lookup miss 必须与命中显式可区分；不得伪装成 model / execution failure |
| **SI-9** | lookup 无副作用（不触发 register / remove / lifecycle / model 解析） |
| **SI-10** | `remove` 仅移除 mapping；remove ≠ close ≠ dispose ≠ abort ≠ finishSession |
| **SI-11** | remove 不存在 key ⇒ 幂等 no-op（与 register 的严格失败方向相反，理由见 SI-REM-3） |
| **SI-12** | key = opaque `sessionId`；禁止 taskId / attemptId 推导与字符串约定反推 |
| **SI-13** | registered capability 必须满足：execute prompt · read messages · prompt resolve = settled |
| **SI-14** | registered capability 不得以最小能力形式暴露 abort / dispose / close / waitForIdle / model / thinkingLevel / state / raw |
| **SI-15** | Registry 不解析 model、不调用 ModelRouter、不建第二 model truth source |
| **SI-16** | Registry 不拥有 lifecycle authority；G-05 完全隔离 |
| **SI-17** | 本契约不修 `AgentSessionFactoryPort` / `ChildSession` / CLI / 组装层 |
| **SI-18** | AF-4 不得访问 registry internals / concrete session；不得反向进入 AF-4 |
| **SI-19** | 禁止反泛化：不得 `Registry<T>`、不得万能 Session、不得 future-proof 扩张 |
| **SI-20** | 本契约不实现任何代码；语义冻结 ≠ 接口实现 |

---

## §17 未决项（Explicitly Deferred）

```text
O-SI-1  Registry 的具体实现归属：位置 / class / 文件名 / 数据结构（AF-1B-I implementation 阶段决定）
O-SI-2  registered capability 的具体类型形状与名称（从 §10 能力边界落地，实施时裁定）
O-SI-3  lookup miss 的具体表达形态（返回值 / 抛错 / 结果对象）—— 与 AF-1C 的映射一并裁定（AF-1B O-SL-5）
O-SI-4  registry 的注入形态（composition root 如何把 registry 交给 Provider）（AF-1B O-SL-3）
O-SI-5  remove 的具体调用时机（与 session 生命周期结束绑定；实现期裁定）
O-SI-6  R-1：production writer（谁调用 register、如何从 `TaskEngine.start()` 取得 session）= G-04 DEFERRED
O-SI-7  R-2B：Factory / CLI 集成（`AgentSessionFactoryPort` 如何产出满足 §10 的对象）= 独立 Integration seam DEFERRED
O-SI-8  G-05（lifecycle）· G-06（model fidelity）· G-03 —— 独立授权、独立切片
```

---

## §18 Implementation Contract Review Gate

| Boundary | 检查点 |
| --- | --- |
| **① Ownership** | Registry 归属与「≠ lifecycle owner / model resolver / TaskEngine / Orchestrator / Provider」是否成立；是否未预设实现归属（SI-1…SI-3） |
| **② register / lookup / remove** | 重复注册是否显式失败；lookup miss 是否可区分；remove 是否仅 mapping（SI-4…SI-11） |
| **③ Identity** | 是否禁推导 / 禁生成 / 禁字符串约定（SI-12） |
| **④ Capability** | 注册对象能力边界是否与已冻结 Minimum Capability 一致；是否未回引宽表面（SI-13 / SI-14） |
| **⑤ Model / Lifecycle / Factory / AF-4** | 是否未参与 model；G-05 是否隔离；是否声明 Factory 不满足且不修；AF-4 是否隔离（SI-15…SI-18） |
| **⑥ 反泛化** | 是否出现 `Registry<T>` / 万能 Session / future-proof 扩张（SI-19） |

```text
⇒ Review PASS 后，才讨论冻结 / commit；本契约当前不包含 implementation、commit 或 push。
```

---

## §19 OUT 复核清单

```text
✅ 本契约未实现任何接口（无 class / module / registry 实现 / 无 .ts 文件）
✅ 本契约未预设 registry 的实现位置 / class / 文件名 / 数据结构（§5 SI-OWN-3 / §17 O-SI-1）
✅ 本契约未膨胀 execution-session 能力面；未回引 abort / dispose / model / state / raw
✅ 本契约未出现 `Registry<T>` 泛型或万能 Session 形态
✅ 本契约未修改既有契约（AF-1B / AF-1 rev2 / AF-1 Impl / AF-4 Design / AF-4 Impl / AF-2·3 / R2 / C7-B）
✅ 本契约未修改 TaskEngine / Orchestrator / CLI / ModelRouter / `AgentSessionFactoryPort` / AF-1A port
✅ 本契约未解决 G-03 / G-04 / G-05 / G-06；未接入生产路径
✅ 本契约未处理 `5d45e3d` / `.gitattributes`；未执行 `--renormalize`
✅ 本契约未引入 scheduler / concurrency / retry / TTL / 淘汰策略 / 第二套状态机
✅ 本契约未产生 Claim / Fact / Knowledge / Candidate / 0–100 分
✅ 本契约未修改 README / INDEX / HANDOFF；未 commit；未 push
```

---

**End of contract（rev1 · Execution Session Lookup Seam Implementation Contract）**
