# R-2B-A Implementation Contract（Composition Root / Factory Integration）（rev1）

> 状态：**🔒 FROZEN（rev1）**。本契约只定义 R-2B-A 的实施边界；**实现仍未授权**。
> 基线：`HEAD = origin/main = ls-remote = 237eddd`（AF-4 Execution Coordinator = PUBLISHED）。
> ★ 上位契约（**不得修改**，本契约从它派生）：
> [`composition-session-ownership-contract.md`](composition-session-ownership-contract.md)
> **🔒 FROZEN（rev1 · 573 行 · sha256 `eb0ef7ce07ee0daf4e13736e9fa4f5814f7006e5c987f8511b62cda2bab2ec07`）**。
> 只读引用（不得修改）：
> [`execution-provider-af1c-implementation-contract.md`](execution-provider-af1c-implementation-contract.md) **🔒 FROZEN（`ce0802a`）** ·
> [`af1c-implementation-contract.md`](af1c-implementation-contract.md) **🔒 FROZEN（`d9af5983…`）** ·
> [`round-execution-driver-contract.md`](round-execution-driver-contract.md) **🔒 FROZEN（rev1 + Amendment 1）**。
> 前置：**G-04 / R-2B Preflight = 🟡 PASS WITH ONE ARCHITECTURE TENSION**（6 面已核）；
> 用户裁定：Pi 隔离张力按「**registry 入 Runtime、Pi factory 留 src**」定。
> **本文件只定义 R-2B-A 的实施边界；不含实现、不含代码落地。**

---

## §1 Purpose / Non-goals

```text
【Purpose】
把已冻结的 Composition Contract（§A Composition Root / §C Registry Ownership / §F CLI）中
属于 **R-2B-A** 的那一部分，转成**可执行、可验收**的实施边界：
  · SessionRegistry ownership 由 CLI 迁入 TianchaRuntime；
  · CLI 降级为 entrypoint（不再拥有 runtime internals）；
  · 保持 Factory / identity / Adapter 三条既有边界不变。

【Non-goals】（本契约【不】解决，且【不得】顺手解决）
  ❌ G-04（production register writer 接入）—— 独立 Slice（Composition Contract §8 §D）
  ❌ G-05 Session lifecycle（close / dispose / abort / remove / timeout / cancellation / resource release）
  ❌ G-06 model fidelity · G-07 ResearchContext producer · G-03
  ❌ Execution Caller（契约与实现均为后续独立阶段）
  ❌ retry / scheduler / concurrency / queue
  ❌ CLI 的广义重构（命令体系 / UX / help / 参数 / 输出）
  ❌ 任何 Research 业务语义
```

---

## §2 Terms

```text
R-2B-A
  Composition Root / Factory Integration 的**实施 Slice**。见 AF-1C IC-11-2 登记的 R-2B。
  它解决「东西怎么组装到正确的 Composition Root」，【不】解决「谁拥有 production write authority」。

G-04
  Production Registry Writer Integration。★ 独立 Slice；R-2B-A 【不得】触及（§14）。

Composition boundary（src/ 侧）
  允许接触 Pi 类型的装配层。`packages/research` 【永不】import Pi（EP-15 / IP-3）。

Runtime internals
  eventStore · artifactStore · events · ModelRouter · TaskEngine · Orchestrator ·（★ 新增）SessionRegistry。
```

---

## §3 Current Facts（G-04 / R-2B Preflight 取证 · 逐字）

```text
[R-1] TianchaRuntime（runtime/tiancha-runtime.ts，59 行）内部 new：
        :39 SqliteResearchEventStore · :40 SqliteArtifactStore · :41 ResearchEventAdapter
        :44 ModelRouter · :45 TaskEngine · :51 Orchestrator
      TianchaRuntimeDeps = { cwd, eventDbPath, artifactDbPath, eventBus,
                             agentSessionFactory, modelResolver }
      ⇒ ★ 无 registry / 无 provider / 无 coordinator / 无 caller
      ⇒ ★ 不 new factory（factory 由外部注入）

[R-2] `new SessionRegistry()` 生产点 = 仅 src/cli/tiancha.ts:177（cmdResearchSmoke）
      `new TianchaRuntime(...)` 生产点 = 仅 src/cli/tiancha.ts:180（cmdResearchSmoke）
      ⇒ ★ 漂移：Composition Contract §C / AF-1C AI-5-1 要求 TianchaRuntime 持有，
              实现在 CLI

[R-3] CLI 命令面：cmdResearchSmoke（L165）是**唯一**做 runtime assembly 的命令；
      cmdSessionReadonly / cmdIndustryIngest / cmdIndustryShow / cmdStateShow / cmdMethodology 等
      均【不】创建 runtime internals（其 SqliteArtifactStore 属各命令自身数据访问）

[R-4] Factory：AgentSessionFactoryPort 的 production 实现 = 仅 src/cli/tiancha.ts:123
      `buildAgentSessionFactory(registry)`；内部**【依赖 Pi】**：
        createAgentSessionServices → SessionManager.inMemory(cwd) → createAgentSessionFromServices
      另一实现 = runtime/child-session.ts:39 `noopChildSession(taskId)`（no-op / 测试用）
      TaskEngine 经 `deps.factory.create({...})` 取得 session；★ 入参【不含 sessionId】

[R-5] sessionId：唯一 production 产生点 = src/cli/tiancha.ts:147 `child-${opts.taskId}`；
      另一处 = runtime/child-session.ts:41 `noop-${taskId}`；
      第二身份源扫描（taskId/attemptId/runId ↔ sessionId 混用）= 仅上述 2 处

[R-6] production register writer（★ 核心）：
        SessionRegistry.register = 恰 1 处 → src/cli/tiancha.ts:148
        SessionRegistry.remove   = 恰 1 处 → src/cli/tiancha.ts:158（在 ChildSession.close() 内）
        SessionRegistry.lookup   = 恰 1 处 → runtime/pi-execution-provider.ts:43
      ★ 另有 4 处 `register(` 属【其他 registry】（已逐一核实，类型不同）：
        chainTemplates = new ChainTemplateRegistry()
        evaluationPolicies / aggregationPolicies / priorityPolicies / sufficiencyPolicies
          = new PolicyRegistry<T>(...)
      ⇒ Gate 必须按【接收者类型】过滤，不得 grep `register`

[R-7] Adapter（src/agent/pi-session-capability-adapter.ts，49 行）：仅类型/视图收窄；
      IC-5-1…IC-5-4 全成立（❌ 生成 sessionId · ❌ register/remove · ❌ 持有 Registry ·
      ❌ model resolution · ❌ lifecycle 决策 · ❌ 暴露 abort/dispose/close/waitForIdle）

[R-8] TianchaRuntime.close()（:54-58）= 仅 eventStore.close() + artifactStore.close()
      ⇒ ★ 不碰 registry、不碰 session；ChildSession.close() 语义 = no-op（G-05 锁定）

[R-9] AF-1C IC-7-1：composition root 直接持有【同一个】SessionRegistry 实例，
      并把【最小能力】交给 factory（以构造参数形式传入，**不公开整个 registry**）；
      IC-6-2：register 的唯一调用点 = create() 内、`return ChildSession` 之前；
      IC-6-3：remove 绑定 ChildSession.close()。
```

---

## §4 Scope（R-2B-A 的边界）

```text
IN：
  ① SessionRegistry ownership：CLI → TianchaRuntime（Composition Contract §C CSO-C-1）；
  ② TianchaRuntime 向 src/ 侧 composition boundary 提供【取得同一 registry】的受控路径；
  ③ CLI 降级为 entrypoint：移除其 `new SessionRegistry()` 与相关内部装配（§8）；
  ④ 保持 TianchaRuntimeDeps.agentSessionFactory 注入形态与 create() 调用链不变。

OUT：
  · G-04（任何 production `registry.register(...)` 的接入/迁移）—— §14
  · Factory 的 Pi 实现迁移进 packages/research（★ 违反 Pi 隔离红线，§5）
  · sessionId 生成规则改变（§7）
  · Adapter / Provider / Coordinator / TaskEngine / Orchestrator 的行为改变
  · CLI 广义重构
```

---

## §5 ★ 核心裁定：registry 入 Runtime、Pi factory 留 src

```text
R2BA-5-1  ★ SessionRegistry 的 ownership 移入 **TianchaRuntime**（Composition Contract §C）。
R2BA-5-2  ★ `buildAgentSessionFactory` 的 **Pi 实现必须留在 src/ 侧**。
          理由（硬约束）：该实现依赖 Pi（createAgentSessionServices /
          createAgentSessionFromServices / SessionManager），而
          ★【packages/research 永不 import @earendil-works/pi-coding-agent】（EP-15 / IP-3）。
R2BA-5-3  ★ 因此 R-2B-A 【禁止】把 Pi 依赖搬进 `packages/research/src/runtime/`。
R2BA-5-4  二者通过【注入同一个 SessionRegistry 实例】相连（AF-1C IC-7-1 的既有形态）。
          ⇒ 正确形态：
                TianchaRuntime ── owns ──► SessionRegistry
                       │                        ▲
                       │ 受控提供                │ 同一实例
                       ▼                        │
                src/ composition boundary ──► Factory（Pi 实现，留在 src/）
R2BA-5-5  ★ 「Factory wiring → Runtime」在 R-2B-A 中的含义 = Runtime 装配并【提供】registry，
          ❌ 不是「把 factory 的 Pi 实现搬进 research」。
R2BA-5-6  若实现中发现必须搬动 Pi 依赖 ⇒ STOP ⇒ 报告（违反 IP-3 红线）。
```

---

## §6 目标形态

```text
CLI（entrypoint / command adapter）
  │
  ▼
TianchaRuntime（唯一 primary composition root）
  ├── SessionRegistry          ★ 本 Slice 新增持有
  ├── TaskEngine
  ├── Orchestrator
  ├── eventStore / artifactStore / events / ModelRouter
  └──（受控路径 → src/ composition boundary 取得同一 registry）

src/ composition boundary
  └── buildAgentSessionFactory（Pi 实现；留在 src/）
        └── 使用 Runtime 提供的【同一】registry 实例

⇒ CLI ❌ 不再 new SessionRegistry / 不再持 runtime internals。
```

---

## §7 R-2B-A MUST / MUST NOT

```text
【MUST】
R2BA-7-1  TianchaRuntime 创建并持有 SessionRegistry（唯一实例）。
R2BA-7-2  ★ CLI 不再创建或持有 SessionRegistry；CLI 通过 TianchaRuntime 完成运行时组合，
          **不获得完整 Registry 实例**（§9 R2BA-Q1）。
R2BA-7-3  提供给 src/ 侧的必须是【同一个实例】（AF-1C AI-5-2 / L549 · CSO-C-6）。
R2BA-7-4  `AgentSessionFactoryPort.create()` 的【签名】与 `ChildSessionOptions`【形状】保持不变
          （Composition Contract §E CSO-E-4）。
R2BA-7-5  sessionId 仍由 **factory 实现**产生；`ChildSession.sessionId` 仍是唯一 identity 源
          （CSO-B-4 / CSO-B-8）。
R2BA-7-6  Adapter / Provider / Coordinator / TaskEngine / Orchestrator 的行为【不变】。
R2BA-7-7  TianchaRuntime.close() 的现有语义【不变】（仍只关 eventStore / artifactStore）。

【MUST NOT】
R2BA-7-8  ❌ 产生【任何】新的 production `registry.register(...)` writer（★ G-04 专属；§14）。
R2BA-7-9  ❌ 提前实现 / 复制 / 隐藏 register 行为（Composition Contract §E CSO-E-3.2）。
R2BA-7-10 ❌ 生成 sessionId；❌ 给 `ChildSessionOptions` 增加 `sessionId`（CSO-B-5 / CSO-B-6）。
R2BA-7-11 ❌ 用 taskId / attemptId / runId 派生 sessionId（CSO-B-2 / CSO-B-3）。
R2BA-7-12 ❌ 引入第二个 SessionRegistry 或任何 second identity/registry source（CSO-C-2）。
R2BA-7-13 ❌ 把 Pi 依赖搬进 packages/research（R2BA-5-3）。
R2BA-7-14 ❌ 触碰 G-05（close / dispose / abort / remove / timeout / cancellation / resource release）。
R2BA-7-15 ❌ 让 Runtime.close() 顺手 remove registry / dispose session。
R2BA-7-16 ❌ 做 CLI 广义重构（命令体系 / UX / 参数 / 输出）。
R2BA-7-17 ❌ 修改 AF-1C / AF-4 / R2 / Composition 的任何冻结文本。
R2BA-7-18 ❌ 让 Adapter 承担生成 sessionId / register / 持有 registry（IC-5-3）。
```

---

## §8 CLI 最小迁移清单

```text
MOVE（迁入 TianchaRuntime）
  · `new SessionRegistry()`（src/cli/tiancha.ts:177）

KEEP（CLI 保留）
  · argv 解析 · 命令分派 · 用户可见输出
  · `resolveModel()`（模型解析属入口配置）
  · `createEventBus()`（入口侧基础设施注入）
  · cmdResearchSmoke 的 Run/Round/Task 构造与 smoke 编排（★ 非 runtime assembly）
  · ChildSession.close() 内的 `registry.remove(sessionId)`（★ 属 G-05 边界，本 Slice 不改）

DEFER（本 Slice 不做）
  · CLI 命令重构 / UX / help
  · 其他命令的装配调整
  · smoke 路径的去留（Composition Contract §19 CSO-Q-5）
  · `buildAgentSessionFactory` 的实现变更（除「从 Runtime 取同一 registry」外）

★ 迁移必须是最小的：CLI 只失去「拥有 registry」，不失去「作为命令入口」。
```

---

## §9 ★ R2BA-Q1（已冻结）：registry 的受控暴露形式

```text
R2BA-Q1  ★ TianchaRuntime 不公开整个 SessionRegistry。
         Runtime 向 src/ 侧 Factory composition 提供的必须是
         【最小、受控、仅满足 Factory 当前组合需求的能力视图】。

该能力视图：
  · ❌ 不暴露 SessionRegistry.lookup()
  · ❌ 不暴露 SessionRegistry.remove()
  · ❌ 不转移 SessionRegistry ownership
  · ❌ 不改变 SessionRegistry API
  · ❌ 不允许 Factory 持有完整 Registry
  · ❌ 不改变 G-04 的唯一 production register writer 约束
  · ★ 具体方法名 / 具体 TypeScript shape 在实现前另行冻结。

★ 该能力视图【不是】新增业务 Port：
  ❌ 不定义 SessionRegistryPort / SessionRegistrationPort / SessionLifecyclePort /
     SessionCapabilityPort 等
  ❌ 不放入 packages/research/src/ports/
  ⇒ 它是 **Composition wiring seam**，不是稳定跨模块业务边界。
  ⇒ 除非后续有证据表明它已成为稳定跨模块边界，否则【不得】升格为 Port。

★ 语言能力已足够：TypeScript 的函数类型 / 接口足以表达此类窄能力边界，
  无需为此引入完整 Registry 暴露或新的抽象层。

★ 长期形态（R-2B-A 与 G-04 正交）：
      TianchaRuntime ── owns ──► SessionRegistry
            │                          ▲
            │ 最小受控 capability        │ 同一实例
            ▼                          │
        Pi Factory（src/）─────────────┘
            │
        ChildSession → sessionId
            │
            ▼
          G-04 ──► register(sessionId, capability)    ← ★ 唯一 production mutation
  ⇒ R-2B-A 负责把【正确能力】接到【正确地方】；G-04 负责真正增加 production mutation。

★ 反抽象膨胀（若实现中出现以下任何文件 ⇒ STOP ⇒ 报告）：
  ❌ SessionRegistryBridge.ts · FactoryRegistryAdapter.ts · RuntimeCompositionPort.ts ·
     SessionRegistrationPort.ts · 或任何为 Q1 新增的第四、第五个抽象文件
  ⇒ 本 Slice 预期只改 2 个生产文件（§11）。
```

---

## §10 Forbidden Files（R-2B-A 不得触碰）

```text
· packages/research/src/ports/agent-session-factory.port.ts      （Options 不加 sessionId）
· packages/research/src/runtime/execution-session.ts             （能力面不变）
· packages/research/src/runtime/session-registry.ts              （API 不变：register/lookup/remove）
· packages/research/src/runtime/pi-execution-provider.ts         （行为不变）
· packages/research/src/runtime/execution-coordinator.ts         （行为不变）
· packages/research/src/runtime/dispatched-execution-context.ts  （形状不变）
· packages/research/src/runtime/task-engine.ts                   （行为/lifecycle 不变）
· packages/research/src/runtime/orchestrator.ts                  （行为不变）
· src/agent/pi-session-capability-adapter.ts                     （IC-5-* 不变）
· docs/phaseC/execution-provider*.md · execution-coordinator*.md · round-execution-driver*.md
· docs/phaseC/composition-session-ownership-contract.md（🔒 FROZEN）
· 任何 G-05 / G-06 / G-07 / Caller 相关文件
```

---

## §11 Expected File Impact

```text
Expected implementation files（预计 2 个）：
  1. packages/research/src/runtime/tiancha-runtime.ts   ← 持有 SessionRegistry + 受控提供路径（§9）
  2. src/cli/tiancha.ts                                 ← 移除 new SessionRegistry()；改从 Runtime 取

Expected test files（落点待 §9 裁定后确定）：
  1. ownership 相关测试（证明：唯一实例 / Provider 与 Runtime 同实例 / 无第二 registry）
  2. CLI 边界测试（证明：CLI 不再 new SessionRegistry）
  ⚠️ 不得为此新增测试工具链（no lint / format / coverage / e2e 引入）

★ 核心生产文件数 = 2 ⇒ 远低于 STOP 阈值（若实现中超出，STOP 并报告）。
```

---

## §12 验证计划（实现轮使用）

```text
（均为既有命令/既有测试体系，不新增工具链）
1. typecheck：根 `npm run typecheck`（tsc --noEmit）+ `npm run typecheck:research`
2. targeted tests：Runtime ownership / CLI 边界相关测试
3. full suite：research + src（报告 suite 数 / 失败 / skip 变化，不得只说“通过”）
4. Gate：production register writer 数【不增加】（仍 = 1，且在 CLI 的现有位置未扩展）；
         若本 Slice 移动了 register 的调用位置，必须明确属 G-04 范围 ⇒ STOP
5. Gate：exactly one SessionRegistry（静态 + 运行时）
6. Gate：CLI 不再 new SessionRegistry（源码门）
7. Gate：packages/research 对 Pi 的 import 数仍 = 0
8. Gate：sessionId 产生点未新增；`ChildSessionOptions` 形状未变
```

---

## §13 与已冻结契约的关系

```text
R2BA-REL-1 ★ 本契约【不修改】Composition / AF-1C / AF-4 / R2 的任何冻结文本。
R2BA-REL-2 本契约【严格派生】自 Composition Contract §A / §C / §E / §F / §8（G-04 边界）。
R2BA-REL-3 与 AF-1C：IC-6-2 / IC-6-3（register/remove 落点）、IC-7-1（同一实例、不公开整个 registry）、
           AI-5-1 / AI-5-2 / L549（composition root 持有并注入）—— 本契约【指向并遵守】，不修改。
           ★ 本次迁移正是把 [R-2] 的实现滞后收敛为与 AI-5-1 一致。
R2BA-REL-4 与 R2：本契约不触及 dispatched result 语义。
R2BA-REL-5 与 AF-4：★ 无变化。
R2BA-REL-6 若实现中发现必须修改任一冻结契约 ⇒ STOP ⇒ 报告 ⇒ 另开 Amendment。
```

---

## §14 G-04 边界（R-2B-A 严禁越界）

```text
R2BA-G04-1  R-2B-A 的 production `registry.register(...)` writer 数必须为 **0 增量**。
            ★ G-04 是唯一允许新增该 writer 的 Slice（Composition Contract §8 §D · §15 CSO-GATE-6）。
R2BA-G04-2  当前 production `registry.register(...)` 位于 `src/cli/tiancha.ts`。
            由于 rev1 Composition Contract 已冻结：
              · TianchaRuntime = SessionRegistry Owner；
              · CLI = Entrypoint；
              · G-04 = 唯一 production Registry Writer；
            因此当前 register 调用点【不得】作为 R-2B-A 的 production writer 保留目标。
            若 Registry ownership 迁移后该调用点需要移动，该移动属 **G-04 Slice**；
            R-2B-A 【不得】提前移动、复制、封装或隐藏 production register 行为。
            R-2B-A 仅完成 Registry ownership / composition wiring，
            并为 G-04 提供稳定的受控 registration seam。
R2BA-G04-3  R-2B-A 不得改变 remove 语义（G-05）。
```

---

## §15 Open Questions / To Be Adjudicated

```text
R2BA-Q-1  🟢 CLOSED —— 已于 rev1 Contract Review 裁定为 §9 R2BA-Q1：
          最小受控 capability；不公开完整 Registry；不进入 Research Port；
          具体 shape / 方法名实现前再定。
R2BA-Q-2  🟢 CLOSED —— 已于 rev1 Contract Review 裁定（§14 R2BA-G04-2）：
          G-04 是最终 production register writer；若 ownership migration 要求
          register 从 CLI 移动，该移动属 G-04，而非 R-2B-A。
R2BA-Q-3  测试落点与最小测试集合（§11）。
R2BA-Q-4  CLI 迁移后 cmdResearchSmoke 是否需要缩减（属 smoke 去留问题 · CSO-Q-5）。
```

---

## §16 Status

```text
R-2B-A Implementation Contract（rev1）  🔒 FROZEN
  §5 registry 入 Runtime / Pi factory 留 src   🔒 frozen（用户裁定）
  §7 MUST / MUST NOT                          🔒 frozen
  §8 CLI 最小迁移清单                          🔒 frozen
  §9 registry 受控暴露形式（R2BA-Q1）           🔒 frozen（最小受控 capability；非 Port；不公开完整 Registry）
  §10 Forbidden Files                         🔒 frozen
  §12 验证计划                                 🔒 frozen
  §14 G-04 边界（R2BA-Q-2）                    🔒 frozen（G-04 独占 production register writer）

Implementation                        ⛔ NOT AUTHORIZED
G-04 / G-05 / G-06 / G-07             ⛔ NOT AUTHORIZED
Execution Caller Contract / Impl       ⛔ NOT AUTHORIZED
Commit / Push                         ⛔ NOT AUTHORIZED
```

---

## §17 Revision identity

```text
· 本文件为 rev1 首次落盘（初版为 DESIGN ONLY）。
· ★ Freeze 记录：rev1 已经 Architecture / Composition Root / Registry Ownership / Session Identity /
  Pi Dependency Boundary / G-04 Isolation / G-05 Isolation / CLI Boundary / AF-1C Isolation /
  AF-4 Isolation / R2 Isolation / Scope / Q1 CLOSED / Q2 CLOSED / Internal Consistency 全部 PASS，
  且 Final Freeze Readiness = 🟢 PASS 后，冻结为 **🔒 FROZEN（rev1）**。
· 本文件严格派生自已冻结的 Composition / Session Ownership Contract（rev1），不修改其任何文本。
· 本文件不含代码、不含 schema、不含 migration、不含 CLI 改动。
```

---

## §18 R-2B-A · Amendment 1（R2BA-Q1 Contract Amendment · close-side remove）

```text
Amendment: 1
Kind:      ★ **Contract Amendment**（不是 clarification）—— implementation-discovered contradiction
Status:    🔒 FROZEN（实施前 Preflight 发现、经 Human Authorization 后冻结 —— 见 Reason）
Subject:   R2BA-Q1 的「❌ 不暴露 SessionRegistry.remove()」与 AF-1C IC-6-3 的冲突
           ⇒ 本项构成对 rev1 冻结正文的【实质修订】：
              Q1 capability surface 由 { register } 变为 { register, remove }
Change:
  ① §9 R2BA-Q1 的【枚举行】以本 Amendment 为准（冻结正文不改）：
       旧：· ❌ 不暴露 SessionRegistry.remove()
       新：· ❌ 不暴露 SessionRegistry 的【完整实例 / 查询面】（lookup 等）
           · close() 所需的 remove 以【受控方式】提供；且不得被 Factory 用作 lifecycle 决策
  ② ★ Q1 capability shape 冻结（最小受控能力视图；非 Port）：
       type SessionRegistrationCapability =
         (sessionId: string, session: ExecutionSessionCapability) => void;
       type SessionUnregistrationCapability =
         (sessionId: string) => void;
     两者由 TianchaRuntime 提供，绑定其持有的【同一个】registry 实例。

Reason:
  ★ 实施前 Preflight 发现 R2BA-Q1 的【原则句】与【枚举行】自相矛盾：
      原则句：「最小、受控、仅满足 Factory 当前组合需求的能力视图」
      枚举行：「❌ 不暴露 remove()」
    而 buildAgentSessionFactory（src/cli/tiancha.ts）在 ChildSession.close() 内
    调用 registry.remove(sessionId)（AF-1C IC-6-3：remove 绑定 close），
    且 G-05 已锁定该 close 语义（no-op，不得升级为 dispose/abort）。
    ⇒ 若严格照枚举行实施，close() 将无法 remove ⇒ 破坏 IC-6-3 的既有行为。

Selected:  ★ (A) cap = { register, remove }
           ❌ (B) remove 改由 Runtime 承担（改变 close() 既有职责，可能触及 IC-6-3 冻结）
           ❌ (C) 保持 CLI 拥有完整 registry（违反 CSO-C-1 / Q1）

Semantics:
  · remove 在 close() 内是【机械映射移除】，不是 lifecycle 决策
    （CSO-C-4 / CSO-D-4 / §14 R2BA-G04-3：lifecycle 语义仍归 G-05）
  · ❌ 不暴露 lookup() · ❌ 不转移 ownership · ❌ 不改变 SessionRegistry API
  · ❌ 不改变 G-04 的唯一 production register writer 约束
  · ❌ 不新增 Port / Bridge / Adapter（cap 为函数类型，定义于 runtime/ 内，不入 ports/）

Does NOT authorize:
  · ❌ G-04 implementation
  · ❌ G-05 implementation
  · ❌ 任何新 lifecycle 语义
  · ❌ 任何额外 registry mutation capability（除本 Amendment 冻结的 register + remove 两项）
  · ❌ 扩大 R-2B-A 的 Scope（仍为 2 个生产文件）

Revision identity:
  · 本 Amendment 属 rev1 的后续修订 —— 不升级为 rev2；
  · 不重写 §1–§17 的任何冻结文本（Amendment 记录式追加）；
  · 本修订【不】扩大 R-2B-A 的 Scope（仍为 2 个生产文件）。
```

---

## §19 R-2B-A · Amendment 2（R2BA-G04-2 Contract Amendment · seam-side register binding）

```text
Amendment: 2
Kind:      ★ **Contract Amendment**（不是 clarification）—— implementation-discovered contradiction
Status:    🔒 FROZEN（实施后 Verification 发现、经 Human Authorization 后冻结 —— 见 Reason）
Subject:   R2BA-G04-2 的「不得移动该 register 调用点」与 R2BA-Q1 seam 的冲突
           ⇒ 本项构成对 rev1 冻结正文的【实质修订】：
              判定标准由【源码物理位置】变为
              【semantic responsibility / authorized writer behavior】
Change:
  ★ §14 R2BA-G04-2 的解释以本 Amendment 为准（冻结正文不改）：
       · 「不得移动该调用点」= 【不得新增 / 改变 production writer 的语义与权力】：
           不得新增第二个 production register writer、
           不得改变写入语义、
           不得让 R-2B-A 取得 production registration authority；
       · 【不】禁止 Q1 seam 把 register / remove 接到 Runtime 持有的 registry 上 ——
           那是 capability 绑定（composition wiring），是 Q1 的必然实现；
       · ★ 判定标准 = writer 的【数量与语义】不变，而非【源码行的物理位置】。
         实测：production register = 1（绑定在 cap 闭包内）· remove = 1 · lookup = 1，
               数量未增加；业务上的注册动作仍由 factory 的 create() 触发（AF-1C IC-6-2 不变）。

Reason:
  实施后 Verification 发现：把 registry ownership 移入 TianchaRuntime
  （R2BA-Q1 + §18 Amendment 1）在物理上【必然】使 register / remove 的调用出现在 Runtime 内 ——
      tiancha-runtime.ts:84  this.registry.register(sessionId, session);
      tiancha-runtime.ts:86  this.registry.remove(sessionId);
  否则 cap 无法绑定到 Runtime 持有的 registry。
  而 R2BA-G04-2 的措辞（「该移动属 G-04 Slice / R-2B-A 不得提前移动」）按字面会禁止这一必然结果。
  ⇒ 用户裁定：保留现状 + 修订 G04-2 的判定口径（构成 Contract Amendment）。

Selected:  ★ 保留现状 + 修订 G04-2 的判定口径（本 Amendment）
           ❌ 回退 / 换机制

Semantics:
  · production register writer 数量 = 1（未增）· remove = 1 · lookup = 1
  · ❌ 不新增第二 writer · ❌ 不改变写入语义
  · ❌ 不使 R-2B-A 取得 production registration authority
  · G-04 = 仍唯一允许【引入 production registration behavior】的 Slice
  · G-05 = lifecycle 语义仍归独立切片（本次未触碰）

★ G-04 术语收紧（本 Amendment 冻结 —— 消除「sole writer」的物理位置歧义）：
    G-04            = 唯一允许【引入 / 决定 production registration behavior】的 Slice
    TianchaRuntime  = 唯一 Registry Owner + capability binder
    Factory         = capability consumer
    Session         = identity producer
    ⇒ 判定标准 = **semantic responsibility**，而非「源码里谁调用了 `.register()`」；
      ⇒ 因此 Runtime 内出现 `this.registry.register(...)`（作为 capability binder）
        【不】构成对 G-04 隔离的违反。
    ⇒ ⚠️ 遗留项（登记，不在本 Amendment 范围）：
       Composition Contract §D（CSO-D-1/CSO-D-2）与 §15（CSO-GATE-2）仍使用
       「唯一落点 / production writer 只有一个」的【物理位置口径】，与本 Amendment 的
       语义责任口径存在措辞不一致 → 归 **Composition Amendment（另行授权）**。

Does NOT authorize:
  · ❌ G-04 implementation
  · ❌ G-05 implementation
  · ❌ 任何新 lifecycle 语义
  · ❌ 任何额外 registry mutation capability
  · ❌ 扩大 R-2B-A 的 Scope（仍为 2 个生产文件）

Revision identity:
  · 本 Amendment 属 rev1 的后续修订 —— 不升级为 rev2；
  · 不重写 §1–§18 的任何冻结文本（Amendment 记录式追加）；
  · 本修订【不】扩大 R-2B-A 的 Scope（仍为 2 个生产文件）。
```
