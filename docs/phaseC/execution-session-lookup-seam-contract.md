# AF-1B · Execution Session Lookup Seam Contract

> **Status:** rev1 — DOCS-ONLY · **AUTHORIZED TO DRAFT** · **NOT YET APPROVED**（待 Human Contract Review / 五边界审查）
> **Scope:** docs-only。冻结 **opaque `sessionId` → concrete execution-session** 的 lookup seam **语义与 ownership 边界**；**不实现接口**（可定义语义，不得写 class / module / 实现文件）。
> **上游依据（严格继承，均不修改）:** `docs/phaseC/execution-provider-contract.md`（AF-1 rev2 · FROZEN @c3fb4d6）· `docs/phaseC/execution-provider-implementation-contract.md`（AF-1 Impl Contract rev1+Amendment 1 · FROZEN @3294b72）· `packages/research/src/ports/execution-provider.port.ts`（AF-1A 已落地 · d6d81f1）· `docs/phaseC/execution-coordinator-contract.md`（AF-4 Design · FROZEN @1e796a5）· `docs/phaseC/execution-coordinator-implementation-contract.md`（AF-4 Impl · FROZEN @38862f5）· `docs/phaseC/task-engine-failure-boundary-contract.md`（AF-2+AF-3 · FROZEN @eef63ac）· `docs/phaseC/round-execution-driver-contract.md`（R2 · FROZEN @275b84d）· `docs/phaseC/c7b-execution-wiring-contract.md`（rev4 · FROZEN）
> **证据基础:** AF-1 Provider Implementation Preflight（G-01/G-02/G-03/G-06）· C7 Contract Cross-Audit（PASS WITH DEFERRED GAPS）· AF-1A 落地
> **本契约不授权实现。** 未授权：任何 .ts/.tsx/.js 实现代码 · 创建 registry.ts 或其他 runtime 实现 · TaskEngine / CLI / ModelRouter / R2 / AF-4 修改 · G-05 lifecycle repair · 处理 `5d45e3d` / `.gitattributes` · `git add --renormalize` · 修改任何既有契约 · commit · push。

---

## §0 授权与状态

```text
AF-1 rev2（Execution Provider Contract）        🔒 FROZEN · 🟢 PUBLISHED（c3fb4d6）
AF-1 Implementation Contract（Provider）        🔒 FROZEN · 🟢 PUBLISHED（3294b72）
AF-1A（Execution Provider Port + 6 types）      🟢 CLOSED / PUBLISHED（d6d81f1）
AF-4 Design / Implementation Contract          🔒 FROZEN · 🟢 PUBLISHED（1e796a5 / 38862f5）
C7 Contract Cross-Audit                        🟢 PASS WITH DEFERRED GAPS
AF-1B Session Lookup Seam Contract（本文）      🟡 AUTHORIZED TO DRAFT · DOCS-ONLY · ❌ NOT YET APPROVED
AF-1B Seam Implementation                      ⛔ NOT AUTHORIZED
AF-1C PiExecutionProvider                      ⛔ NOT AUTHORIZED
AF-1D Lifecycle                                ⛔ NOT AUTHORIZED
AF-4 Coordinator                               ⛔ NOT AUTHORIZED
TaskEngine · R2                                🔒 FROZEN / 不修改
G-03 · G-04 · G-05 · G-06                      🟡 DEFERRED
```

**本轮唯一允许的动作：在 `docs/phaseC/` 下新建本契约文件。不碰代码、不改既有契约、不 commit、不 push。**

---

## §1 Purpose

AF-1A 已把 `ExecutionHandle { sessionId }` 与 `ExecutionProviderPort` 落成类型。但此后仍存在一个**未冻结的接缝**：

```text
opaque sessionId  →  ???  →  concrete execution-session
```

本契约把该接缝的**语义与 ownership 边界**一次性冻结，回答七个问题：

```text
① 谁拥有 concrete session？
② Registry 的职责与归属是什么（它不是什么）？
③ lookup 返回什么（不得返回什么）？
④ 创建 / 注册 / lookup / 移除 各由谁负责？
⑤ sessionId 是否是唯一 lookup key（可否被推导）？
⑥ lookup seam 是否改变 model 事实来源？
⑦ lookup seam failure 与 provider execution failure 是否同层？
```

**目的不是解决 session 生命周期（那是 G-05），而是把 ownership 边界钉死，使 AF-1C 与 AF-4 不再各自发明。**

---

## §2 Scope / Non-goals

### §2.1 Scope

```text
S-1  Session ownership（§5）
S-2  Registry 的职责与 ownership seam 性质（§6）
S-3  lookup 返回值抽象与最小能力原则（§7）
S-4  生命周期 ownership 边界（§8）
S-5  sessionId 唯一性与禁止推导（§9）
S-6  与 Model fidelity 的对齐（§10）
S-7  错误语义层级（§11）
S-8  禁止面（§12）· 不变量（§13）· 五边界审查 Gate（§15）
```

### §2.2 Non-goals

```text
❌ 不实现接口（不写 class / module / registry 实现文件 / 不预设实现位置）
❌ 不解决 session 生命周期修复（G-05：close / dispose / abort / finishSession / CLI cleanup）
❌ 不解决 future integration caller（G-04：DispatchedExecutionContext 的生产者）
❌ 不解决 model 注入落点（G-06）
❌ 不修改 TaskEngine / CLI / ModelRouter / R2 / AF-4 的任何语义或代码
❌ 不定义 AF-4 Coordinator 的执行协调
❌ 不定义 AF-1C 的 provider 实现细节
❌ 不引入 scheduler / concurrency / retry / 第二套状态机
```

---

## §3 Terminology

| 术语 | 含义（本契约内冻结） |
| --- | --- |
| **concrete execution session** | composition-root / concrete-session owning side 真实持有的执行会话（当前实现即 Pi `AgentSession`，但本契约**只用抽象名**表达） |
| **opaque `sessionId`** | `ExecutionHandle` 携带的唯一身份字符串；research 侧不解释其结构、不推导其来源 |
| **session registry** | 把 `sessionId` 映射到 concrete session 的**ownership seam**（**不是** AF-4 Coordinator，**不是** 生命周期权威） |
| **lookup seam** | Provider 依 `sessionId` 取得 concrete session 的**唯一合法通道** |
| **execution-session seam** | lookup **返回**的抽象（Provider 从此获得完成 `execute()` 所需的最小能力） |
| **session owner** | concrete session 的**实际持有者**（= composition-root / concrete-session owning side）；【不是】AF-1C `ExecutionProvider` 本身 |
| **session creation / acquisition path** | 负责**产生或取得** concrete session 的路径（= `TaskEngine.start()` / composition root）；⇒ 它【不等于】session ownership（二者必须分开） |
| **lookup seam failure** | 因 `sessionId` 无法解析等原因**在执行开始前**发生的失败（§11） |

**术语纪律：** 本契约中 `registry` **始终**指 ownership seam，**绝不**指 AF-4 Coordinator；`lookup` 指 research-facing 的 opaque 解析，**不是** Pi 层的方法名；`session creation / acquisition path`（= `TaskEngine.start()` / composition root）**不等于** `session ownership` —— 产生/取得 session 的路径不得被读成 session owner。

---

## §4 现况事实（只读取证，登记不改）

```text
F-1  TaskEngine.openSessions 为 `private readonly Map<string, ChildSession>`
     （runtime/task-engine.ts:30；set@84 / get@154 / delete@157）
     ⇒ research 侧外部不可读（AF-1 IP-R2-2 已冻结为 inaccessible）
F-2  TaskEngine.start() 返回 `{ task, attempt, session }`
     但 Orchestrator.stepRound() 在 :215 调用后【丢弃返回值】（只 return { kind:"dispatched", taskId }）
     ⇒ 当前不存在任何"持有 start() 返回值并向 AF-4 传递"的合法调用者（= G-04，DEFERRED）
F-3  CLI 的 ChildSession.close() 实现为 `await s?.close?.()`
     而 concrete session 的真实 API 是 `dispose()` / `abort()`（无 close()）
     ⇒ 当前为静默 no-op（= G-05，DEFERRED；本契约【不修】）
F-4  ExecutionHandle / ExecutionProviderPort 已于 AF-1A 落地（ports/execution-provider.port.ts）
     ⇒ 本契约只定义其【消费侧】的 lookup 语义
F-5  当前不存在任何 session registry、lookup 通道或 execution-session seam（全仓 0 命中）
```

**⇒ 本契约不改变 F-1…F-5 中的任何一项；它们只作为边界设计的既定事实。**

---

## §5 ① Session ownership（冻结）

```text
SL-OWN-1  concrete session 的【创建 / 取得路径】 = `TaskEngine.start()` / composition root。
          ⇒ Provider 【不】创建 session。
          ⇒ 但**这【不等于】TaskEngine 成为 concrete session 的 owner**：
            该路径只负责「产生 / 取得」，不承担 session 所有权。
SL-OWN-2  concrete session 的【所有权】 = **composition-root / concrete-session owning side**。
          ⇒ AF-1C `ExecutionProvider` 本身【不是】session owner，也【不是】registry owner。
          ⇒ TaskEngine 只持有不透明句柄（AF-1 IP-4）。
SL-OWN-3  `ExecutionHandle = { sessionId: string }` 是唯一对外身份（AF-1A 已落地）；
          它【不是】能力对象。
SL-OWN-4  TaskEngine 【不得】成为 Provider 的 concrete-session lookup backend
          （AF-1 IP-R2-1 已在 AF-1 Impl Contract 冻结）。
SL-OWN-5  AF-4 【不得】访问 TaskEngine private state，【不得】lookup concrete session
          （AF-4 Impl §12 D-10 / AC-13）。
```

```text
合法形态：
    TaskEngine.start()  ──creates──▶  concrete session
                                            │ register
                                            ▼
                                    session registry  ◀── ownership seam
                                            │ lookup(handle.sessionId)
                                            ▼
                                    execution-session seam
                                            │
                                            ▼
                                    PiExecutionProvider（AF-1C）
```

```text
禁止形态：
    ExecutionProvider ──▶ 自己创建 session
    AF-4              ──▶ 访问 TaskEngine.openSessions
    ExecutionProvider ──▶ 猜 / 构造 sessionId
```

---

## §6 ② Registry 的职责与 ownership seam 性质

### §6.1 语义职责（冻结）

```text
registry 承担三个语义操作：
    register(sessionId, session)    —— 登记（由 session owner 执行）
    lookup(sessionId)               —— 解析（由 Provider 经 seam 执行）
    remove(sessionId)               —— 移除（由 session owner / 生命周期结束侧执行）

★ `remove(sessionId)` 的语义【仅为】从 registry 移除映射；
  本契约【不】定义、也【不】授权由 remove 隐式执行
  close / dispose / abort / finishSession 等 concrete-session lifecycle 操作。
  ⇒ remove ≠ close ≠ dispose ≠ abort ≠ finishSession（彻底锁死）
```

### §6.2 性质（冻结）

```text
SL-REG-1  Registry 是 **ownership seam**，【不等于】AF-4 Coordinator。
          ⇒ AF-4 只消费 opaque `sessionId`，不接触 registry 内部。
SL-REG-2  Registry 【不】是 lifecycle 权威：它记录"当前被拥有的会话句柄"，
          而【不是】"已成功关闭的资源集合"（与 AF-2/3 FB-12 的 registry 语义一致）。
SL-REG-3  【禁止】第二套隐藏 registry：Provider 不得自建私有 map 缓存 session
          （否则出现两个 lookup 来源）。
SL-REG-4  Registry 的【具体实现归属】——位置 / class / 文件 / 数据结构 ——
          【不在本契约冻结】，留待 AF-1B implementation（§14 O-SL-1）。
          ⇒ 本契约只冻结 `ownership + register + lookup + remove + lifecycle boundary` 语义。
```

### §6.3 注入关系（语义层，不预设实现）

```text
Provider 必须通过【由 composition root 注入的】seam 获得 lookup 能力；
⇒ 具体注入形态（构造参数 / 闭包 / 工厂）【不在本契约冻结】（§14 O-SL-3）。
```

---

## §7 ③ lookup 返回值：execution-session seam

```text
SL-LKP-1  lookup(sessionId) → **concrete execution-session seam**。
          ⇒ 【不得】直接返回 Pi `AgentSession`（会把 AF-1 的抽象层污染成 Pi 类型）。
SL-LKP-2  该 seam 的**最小能力**必须【从 AF-1C 真正需要反推】而确定；
          ⇒ 不得因"未来可能需要"提前膨胀（不得预先塞入完整生命周期方法集）。
SL-LKP-3  该 seam 中【不得】出现任何 Pi 类型，也不得经类型别名间接泄漏（EP-15 / IP-3）。
SL-LKP-4  该 seam 【不得】成为第二套 model 来源（见 §10）。
```

```text
【方法论约束（冻结）】
    本契约【不】规定 execution-session seam 的具体成员。
    它只冻结："成员集合必须由 AF-1C 的 `execute()` 实际需要反推"这一约束。
    ⇒ 若未来需要在契约层固定成员集合，应在本契约 rev2 中基于 AF-1C 的取证追加，
      而不是在此处预留"可能有用的方法"。
```

---

## §8 ④ 生命周期 ownership（与 G-05 分离）

```text
SL-LIF-1  创建   ：TaskEngine.start() / composition root（【不是】Provider）
SL-LIF-2  注册   ：由 **session owner**（composition-root / concrete-session owning side）
                   在创建后完成（【不是】AF-1C ExecutionProvider 自身维护）
SL-LIF-3  lookup ：由 **Provider** 经 §7 的 seam 完成
SL-LIF-4  移除   ：由 **session owner / 生命周期结束侧**负责（`remove(sessionId)`）；
                   其【具体时机】不在本契约冻结（§14 O-SL-4）
★ `remove(sessionId)` 的语义【仅为】移除 registry mapping；
  本契约【不】定义、也【不】授权由 remove 隐式执行
  close / dispose / abort / finishSession 等 concrete-session lifecycle 操作
  （与 §6.1 为同一语义锚点）。
  ⇒ remove ≠ close ≠ dispose ≠ abort ≠ finishSession
SL-LIF-5  ★ 与 G-05 分离（冻结）：本契约只定义 **ownership boundary**；
          【不】修：`ChildSession.close()` · Pi `dispose()` / `abort()` ·
                    `TaskEngine.finishSession()` · CLI session cleanup
SL-LIF-6  ⛔ 不得把「Session Lookup Seam」扩大成「Session Lifecycle Repair」。
```

```text
where each lives（冻结的分界）：
    AF-1B          → ownership boundary（谁创建 / 注册 / lookup / remove）
    G-05           → 实际 lifecycle mismatch 的修复（独立授权、独立切片）
```

---

## §9 ⑤ sessionId 唯一性

```text
SL-ID-1  `sessionId` 是 registry 的【唯一 lookup key】。
SL-ID-2  ❌【禁止】由其他标识推导 sessionId：
              taskId → sessionId
              attemptId → sessionId
SL-ID-3  一律使用：`registry.lookup(handle.sessionId)`，其中 handle 来自 AF-1A 的
         `ExecutionHandle`。
SL-ID-4  ❌【禁止】字符串约定反推（例如 `child-${taskId}` 一类形态；
         AF-1 rev2 §18.4 已冻结该禁止，本契约重申）。
```

```text
理由（冻结）：一旦允许推导，未来 retry / 多 attempt 场景下将出现
              "同一 task 多个 session 无法区分"的错误，且无法审计。
```

---

## §10 ⑥ 与 Model fidelity 的对齐

```text
SL-MOD-1  model 事实链必须单向：
              TaskAttempt.model → ExecutionRequest.model → actual execution
          （AF-1 IP-D-1 / AF-4 A-6 已冻结）
SL-MOD-2  ❌【禁止】重新调用 `ModelRouter.resolve()`（AF-1 IP-D-8 / IP-D-2 · AF-4 A-6）
SL-MOD-3  ❌【禁止】出现 session / model 双来源：concrete session 【不】提供 model 真值
          ⇒ lookup seam 【不】改变 model 的事实验证来源
SL-MOD-4  lookup 成功【不】意味着 model 正确；两者必须分别可验证
```

---

## §11 ⑦ 错误语义层级

```text
SL-ERR-1  **lookup seam failure ≠ provider execution failure**（不同层级，冻结）。
SL-ERR-2  本契约只冻结【层级边界】；两者如何映射到 `ExecutionOutcome` 由 **AF-1C** 定义。
SL-ERR-3  ❌【禁止】Provider 把 lookup failure 伪装成 model failure / execution failure
          （会导致诊断污染与错误归因）。
SL-ERR-4  lookup seam failure 发生时，Provider 【尚未】开始执行；
          ⇒ 它不属于"执行中失败"这一类（与 AF-1 rev2 §6.2 的 provider failure 不同层）。
```

```text
【本契约不裁决】lookup failure 在 AF-1C 中最终映射为哪种 outcome 形态
（例如 `{ status: "failed", error }` 的具体 kind）⇒ 属 AF-1C 的实现裁定（§14 O-SL-5）。
```

---

## §12 禁止面（冻结）

### §12.1 Provider 禁止

```text
❌ create session
❌ resolve model
❌ access TaskEngine private state（含 openSessions）
❌ guess sessionId
❌ construct sessionId
❌ maintain a second hidden session registry
```

### §12.2 AF-4 禁止

```text
❌ access registry internals
❌ lookup concrete session
❌ create session
❌ destroy session
❌ access TaskEngine.openSessions
```

### §12.3 TaskEngine 禁止被 AF-1B 改造

```text
❌ 修改 start() 返回结构
❌ 修改 private openSessions
❌ 修改 ModelRouter
❌ 修改 dispatch
❌ 修改 retry
（除非之后单独授权）
```

---

## §13 核心不变量（SL-1 … SL-16）

| ID | 冻结语义 |
| --- | --- |
| **SL-1** | concrete session 的创建 / 取得路径 = `TaskEngine.start()` / composition root（Provider 不创建）；**该路径 ≠ session ownership** |
| **SL-2** | concrete session 的所有权 = composition-root / concrete-session owning side；AF-1C `ExecutionProvider` 本身【不是】session owner，也【不是】registry owner；TaskEngine 只持 opaque 句柄 |
| **SL-3** | `ExecutionHandle = { sessionId }` 是唯一对外身份（非能力对象） |
| **SL-4** | TaskEngine 不得成为 Provider 的 lookup backend；AF-4 不得访问其 private state |
| **SL-5** | Registry 是 ownership seam，**不等于** AF-4 Coordinator |
| **SL-6** | Registry 不是 lifecycle 权威（记录"当前被拥有的句柄"，非"已关闭的资源"） |
| **SL-7** | 禁止第二套隐藏 registry（Provider 不得自建私有 session 缓存） |
| **SL-8** | Registry 的具体实现归属（位置 / class / 文件）不在本契约冻结 |
| **SL-9** | `lookup(sessionId)` 返回 execution-session seam，**不得**直接返回 Pi `AgentSession` |
| **SL-10** | execution-session seam 的最小能力必须从 AF-1C 实际需要反推，不得未来式膨胀 |
| **SL-11** | 创建 / 注册 / lookup / 移除的 ownership 归属按 §8 冻结；与 G-05 严格分离 |
| **SL-12** | `sessionId` 是唯一 lookup key；禁止 taskId/attemptId 推导与字符串反推 |
| **SL-13** | model 事实链单向；lookup seam 不改变 model 来源，禁止重 resolve 与双来源 |
| **SL-14** | lookup seam failure ≠ provider execution failure（层级分离；映射由 AF-1C 定义） |
| **SL-15** | 禁止 Provider 将 lookup failure 伪装成 model / execution failure |
| **SL-16** | 本契约不实现任何接口（语义冻结 ≠ 接口实现） |

---

## §14 未决项（Explicitly Deferred）

```text
O-SL-1  Registry 的具体实现归属：位置 / class / 文件名 / 数据结构（AF-1B implementation 阶段决定）
O-SL-2  execution-session seam 的最小能力面（从 AF-1C 实际需要反推）
O-SL-3  registry 的注入形态（composition root 如何把 lookup 能力交给 Provider）
O-SL-4  `remove(sessionId)` 的具体时机（与 session 生命周期结束绑定；实现期裁定）
O-SL-5  lookup seam failure → `ExecutionOutcome` 的具体映射（AF-1C 定义）
O-SL-6  G-04（future integration caller）—— 谁持有 start() 返回值并投影 DispatchedExecutionContext（DEFERRED）
O-SL-7  G-05（session lifecycle repair）—— 独立授权、独立切片（本契约不碰）
```

---

## §15 Contract Review Gate（五边界审查）

| Boundary | 检查点 |
| --- | --- |
| **① Ownership** | 谁创建 / 持有 / 注册 / lookup / 移除，是否唯一且无第二 owner（SL-1…SL-4 · SL-11） |
| **② Abstraction / Pi leakage** | 是否出现任何 Pi 类型 / `AgentSession` 泄漏；seam 返回值是否为抽象（SL-9 · SL-10 · EP-15） |
| **③ Model fidelity** | 是否重新 resolve model；是否存在 session / model 双来源（SL-13） |
| **④ Lifecycle / G-05 boundary** | 是否偷偷解决 G-05；是否改动 TaskEngine 生命周期（SL-11 · §2.2 · §8 SL-LIF-5） |
| **⑤ AF-4 boundary** | AF-4 是否仍只见 `taskId / attemptId / sessionId`；有否获得 registry 或 TaskEngine 私有状态（SL-5 · §12.2） |

```text
⇒ Contract Review PASS 后，才讨论冻结 / commit；本契约当前不包含 implementation、commit 或 push。
```

---

## §16 OUT 复核清单

```text
✅ 本契约未实现任何接口（无 class / module / registry 实现 / 无 .ts 文件）
✅ 本契约未预设 registry 的实现位置 / class / 文件名（§6.2 SL-REG-4 / §14 O-SL-1）
✅ 本契约未膨胀 execution-session seam 的能力面（§7 SL-LKP-2 / SL-LKP-4）
✅ 本契约未修改既有契约（AF-1 rev2 / AF-1 Impl / AF-4 Design / AF-4 Impl / AF-2·3 / R2 / C7-B）
✅ 本契约未修改 TaskEngine / CLI / ModelRouter / R2 / AF-4
✅ 本契约未解决 G-03 / G-04 / G-05 / G-06
✅ 本契约未处理 `5d45e3d` / `.gitattributes`；未执行 `--renormalize`
✅ 本契约未引入 scheduler / concurrency / retry / 第二套状态机
✅ 本契约未产生 Claim / Fact / Knowledge / Candidate / 0–100 分
✅ 本契约未修改 README / INDEX / HANDOFF；未 commit；未 push
```

---

**End of contract（rev1 · Execution Session Lookup Seam Contract）**
