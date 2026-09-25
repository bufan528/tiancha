# Tiancha Phase C · Step C3 — Priority / NextAction Verification Contract

> **状态：DRAFT（第 2 版，含 `C3 Contract 预审` 的 5 处补强，等待 `C3 Contract Gate`）**
> 本文档 **docs-only**：不含任何代码改动、不含 migration、未 commit、未 push。
> 它把 Phase C 主契约 `docs/phaseC/implementation-contract.md` 的 §22 / §25 / §26 **展开成可逐条 Gate 的工程契约**，
> **不修改、不覆盖**主契约，也不修改 C1 / C2 已 FINAL LOCK 的契约。
> 上游依据：`implementation-contract.md` §22（C3 = Priority / NextAction，重定义：验证）、§25（实现顺序）、§26（Phase C 最终验收场景）。

---

## 0. Baseline 与历史注记

### 0.1 代码基线

```text
code baseline : ee16851（= origin/main）— C2 Phase 2 已发布
C2 closures   : 2-A Coverage / 2-B Target Linkage / 2-C Research Plan（全部 ACCEPTED）
contract chain: 69d2b1d（C2 Phase 2 Contract FINAL LOCK）
```

本契约的**每一条现状事实**都以 `ee16851` 为准，并带 `file:line` 以便逐条核验。若实现阶段发现基线事实已漂移，必须先报告、后实现。

### 0.2 历史注记（不改旧契约，只加注记）

- 主契约 §21 说明：C2 已改由专项契约定义；原 §21 的"Pool → Gap 传播验证"已并入 C1 回归。
- 因此 **C3 是本条链上第一个"验证型"阶段**：它的对象是**既有 persisted 状态**，不是从零实现。

### 0.3 ★ C3 定位（一句话，钉死）

> **C3 不是 Priority 建设阶段，而是对既有 Priority / NextAction 持久化生命周期及其只读消费链进行验证，
> 并在发现既有语义不一致时，仅允许实施最小的 contract-conformance fix。**

```text
Gap Lifecycle
     │
     ▼
existing persisted Priority
     │
     ▼
existing persisted NextAction
     │
     ├──────────────┐
     ▼              ▼
Priority read     C2 Plan / Report / other
view              read consumers
     │              │
     └──────┬───────┘
            ▼
      consistency verification
```

**必须继续挡住**的下述走向（不属 C3）：

```text
C3 → 重新设计 Priority → 重新设计 NextAction → 做 Field Research
   → 做 Target Recommendation → 做 Report 建设
```

---

## 1. 目标与语义链

### 1.1 一句话目标（继承 §22 原文）

> **验证 Knowledge 引起的 Gap 变化能正确驱动既有 persisted Priority / NextAction。**

必须继续遵守（§22 原文）：Priority 是 persisted SoT；Report 不重新计算；Policy version 保留；Priority 解释可追溯；**reopened Gap 能重新进入研究队列**。
**不新增 Priority 规则、不改 Policy、不改 acquisitionValue 定义。**

### 1.2 语义链（方向写死，禁止反向）

```text
Claims → Knowledge Evolution（C1）
       → Pool（reconcile）
       → Gap lifecycle（refreshGaps）
       → persisted Priority + persisted NextAction（refreshNextActions）
       → Priority read view（currentPriorities）
       → Report / C2 Plan 等只读消费者
```

### 1.3 ★ C3 真正负责的段（写死）

```text
Gap state change
      ↓
existing persisted Priority
      ↓
existing persisted NextAction
```

上游（Claims / Knowledge / Pool / Gap lifecycle）由 C1 负责，C3 **只验证、不改其规则**；
下游（Report / C2 Plan）由 C4 / C2 负责，C3 **只验证其消费一致性**。

### 1.4 ★ Priority 的 persisted 载体（唯一事实，写死）

**不存在独立 priority 表**（24 表清单见 §7.4）。一个 gap 的 priority 持久化在**它的 NextAction 行**上：

```text
next_action.priority                              = score（0..100，整数）
next_action.params.gapId                          = 该 action 服务的 gap
next_action.params.gapType                        = 生成时的 gap 类型（可追溯）
next_action.params.priorityBreakdown              = 六因子 { raw, normalized, weight, contribution }
next_action.params.priorityPolicyVersionId        = 该分数所用 policy 版本（当前 prio-v1）
```

依据：`packages/research/src/application/knowledge-projection-service.ts:744-755`（写入）、
`packages/research/src/application/priority-service.ts:143-163`（读取）、
`packages/research/src/domain/priority-policy.ts:51-83`（policy）。

### 1.5 ★ 生命周期语义 ≠ 重新计算（预审补强 ②）

关于 reopen 之后 priority / factor breakdown / policy version 的"恢复"，本契约**不使用"重新计算"表述**：

> **reopen 之后，既有 persisted Priority / Factor Breakdown / Policy Version 的生命周期语义必须保持契约一致；
> 若既有写入路径按现有规则重新产生持久化值，则验证其结果与既有语义一致，
> 但 C3 不新增或修改 Priority 计算规则。**

这条把**"验证已有写入机制"**与**"C3 重新计算 Priority"**彻底隔开，从而保护：

```text
Priority       = persisted SoT
rank()         = 写入面（既有）
currentPriorities() = 只读消费面
```

---

## 2. 现状核查（基线 `ee16851` 的真实事实）

### 2.1 Priority：计算面 与 只读面（严格分离，且**调用者已核实**）

| 面 | 位置 | 事实 |
|---|---|---|
| 计算面 | `priority-service.ts:50-75` `rank()` | 只对 **active gap** 计算；`score desc → gapId asc`（确定序，非插入序） |
| 计算面 | `priority-service.ts:78-123` `computeFor()` | 六因子加权：importance / criticality / uncertainty / coverageGap / acquisitionValue − acquisitionCost；`score = round(clamp01(Σcontribution)×100)`；记录 raw/normalized/weight/contribution |
| 规则源 | `priority-policy.ts:28-83` | **版本化、不可变**的 `PriorityPolicy`；`PRIORITY_POLICY_V1.versionId = "prio-v1"` |
| KIND 规则 | `priority-service.ts:126-128` + `priority-policy.ts:76-82` | **gap state 决定 action kind**（`actionKindByGapType`）；priority 只决定**顺序与分数** |
| 只读面 | `priority-service.ts:143-163` `currentPriorities()` | **S6-R1**：只从既有 `next_action` 行重建，**不重算、不查 policy**；缺 breakdown 的 action **跳过**（不伪造） |

**★ 调用者核实（基线 grep 全量结果）**：生产代码中**唯一**调用计算面 `rank()` 的地方是写入路径本身（`knowledge-projection-service.ts:720`）；
**所有消费者一律使用只读面** `currentPriorities()`：

```text
report-service.ts:181-183           （注释明写 "the read-only face; it consults no policy"）
research-need-service.ts:25
question-target-fit-service.ts:92
src/cli/research-commands.ts:171    （CLI `research priority`）
src/agent/research-tools.ts:352     （Agent `research_priority`）
src/agent/research-tools.ts:430,439 （evaluate 工具的前后快照）
```

### 2.2 NextAction：唯一的 Gap → Action 驱动

`knowledge-projection-service.ts:700-772` `refreshNextActions(subjectId, subjectKind)`：

```text
输入：active gaps（open | mitigating）
      existing = repo.listNextActions()
      ranked   = PriorityService.rank()
跳过：既有 action 为 open 且 (priority, kind) 均未变 ⇒ 不 churn 行        (:735-742)
写入：upsertNextAction({
        actionId = existingAction?.actionId ?? `act-<gapId>`              (:745)
        kind     = actionKindFor(gap.gapType)                             (:733)
        params   = { gapId, gapType, priorityBreakdown, priorityPolicyVersionId } (:749-755)
        priority = score                                                  (:757)
        status   = "open"                                                 (:759)
        createdAt= existingAction?.createdAt ?? now                       (:761)
      })
取消：既有 action 的 gap 不再 active 且其为 open ⇒ status = "cancelled"    (:766-771)
```

其它事实：
- `NextActionKind` 含 `retrieve_data / read_material / research_company / **interview** / **field_visit** / wait_evidence / request_manual_input / reevaluate / escalate_gap`（`domain/next-action.ts:6-15`）。
- `NextActionStatus = "open" | "done" | "cancelled"`（`domain/next-action.ts:17`）。
- `createdBy = "planner" | "user"`；本路径一律 `"planner"`（`:760`）。
- 全链单一入口：`refreshSubject()` = `reconcilePool → refreshGaps → refreshNextActions → refreshState`（`:779-798`）。

### 2.3 Gap lifecycle：唯一的 open/resolve/reopen 规则

`knowledge-projection-service.ts:641-698` `refreshGaps()`：

```text
slot unknown      → open gap，gapType = unknown        (无信息)
slot partial      → open gap，gapType = insufficient   (条件未满足)
slot conflicting  → open gap，gapType = conflict        (不自动消解)
slot sufficient   → gap resolved（并 sync Requirement.status = met）
resolved 的 gap 其后 slot 退化 ⇒ 同 gapId 重新 open（discoveredAt 保留）
gapId = `gap-<requirementId>`（稳定派生）
```

### 2.4 ★ 状态枚举：声明存在但当前生产写入路径不可达的保留值（预审补强 ④）

```text
GapStatus = "open" | "mitigating" | "resolved" | "accepted"      (domain/research-gap.ts:17)
```

实测（基线 grep）：`refreshGaps()` 在生产路径上只产生 `open` / `resolved`。因此：

```text
mitigating : 类型合法，但当前生产写入路径不可达（"声明存在但不可达的保留值"）
accepted   : 属另一个类型 KnowledgeConflictStatus 的概念（domain/knowledge-conflict.ts:13）
```

`"mitigating"` 被**多个只读消费者显式识别**（共 7 处谓词）：

```text
knowledge-projection-service.ts:673 / :716 / :790
opportunity-discovery-service.ts:246
priority-service.ts:57
report-service.ts:130
domain/active-requirement.ts:35（Step 2-A 的共享 resolver）
```

> ⇒ C3 只登记、不修改、不新增写入点、不删除该类型值，并且**不使用"无效状态 / 错误状态 / 死状态"这类措辞**
> —— 它是**被显式识别的保留值**，贸然"清理类型"反而会扩大 C3 范围。
> C2 Step 2-A 已把它与上述 7 处谓词一并列为 **frozen exceptions**（`phase-c2-step2a.test.ts:267-298`）。

### 2.5 既有测试覆盖 vs 空白（决定验证矩阵）

| 已有覆盖 | 位置 |
|---|---|
| S5 计算面：六因子方向、acquisitionValue/Cost 真的改变结果、可审计、policy 版本、无 Target/Chain 泄漏 | `s5-priority.test.ts:101-286` |
| **KIND 由 gap state 决定、priority 决定顺序/分数** | `s5-priority.test.ts:306`（red line 8） |
| 无 Target/Chain/Company 泄漏进 NextAction | `s5-priority.test.ts:331`（red line 9） |
| 重复 refresh 稳定（无 timestamp/UUID/order drift） | `s5-priority.test.ts:342`（red line 10） |
| Gap→NextAction：每个 active gap 一个 action、幂等 | `knowledge-gap-refresh.test.ts:183` |
| Gap→NextAction：**gap resolved ⇒ action cancelled** | `knowledge-gap-refresh.test.ts:198` |
| **reopened 的 Gap 侧**（同 gapId、discoveredAt 保留） | `s45-signal-integrity.test.ts:157-164` |
| **Report 不重算 priority**（注入极端 policy 后对比 persisted 值） | `s6-report.test.ts:212-229` |
| Agent `research_priority` == 只读面 | `s7-exposure.test.ts:128-131` |
| CLI priority == 只读面 | `src/cli/s7-cli.test.ts:118` |

### ★ 空白（本契约 §5.1 的核心）

```text
没有任何测试覆盖：resolved → re-open（re-degrade）之后
        persisted NextAction 是否重新进入队列（cancelled → open）
        actionId / createdAt 是否稳定
        priority / priorityBreakdown / priorityPolicyVersionId 是否按既有语义一致
        currentPriorities() / ResearchState.nextActionIds / Report / C2 Plan 是否同步看到它
```

⇒ 这正是 §22 明文要求、而当前**未被证明**的一条：**"reopened Gap 能重新进入研究队列"**。

---

## 3. 红线（C3 一律不做）

1. **不新增 Priority 规则、不改 `PriorityPolicy`、不改任何因子权重/阈值**（§22 原文）。
2. **不重新定义 `acquisitionValue` / `acquisitionCost`**（`priority-policy.ts:22-25` 的语义冻结）。
3. **不新增 Priority factor**，不把任一因子的来源改成 Target / Chain / Company / LLM。
4. **不把 Priority 从 persisted SoT 改成 runtime 计算**；不得让任何投影消费者在读取时重算 priority。
5. **不重新定义 NextAction**：不改 `NextActionKind` / `NextActionStatus` 取值，不改 `actionId = act-<gapId>` 派生，不改 `createdBy` 语义。
6. **不新增 Gap→Priority / Gap→Action 规则**；不改 `actionKindByGapType` 映射。
7. **不引入 LLM**（决定 priority / kind / action 的任何环节都不用模型）。
8. **不新增表 / 不迁移**（Priority 无独立表的现状保持不变；不得为 C3 新建 `priority` / `*_snapshot` 表）。
9. **Agent 写权限不扩大**：Agent 侧新增能力只能只读；不得新增"创建/修改 NextAction / Priority / policy"的工具。
10. **legacy / 未接线资产一律不接入**（C3 边界裁定 ②）：

```text
planning/      → 不接入（research-planner / task-graph-builder）
evidence/      → 不接入（evidence-engine / evidence-extractor）
agents/        → 不接入（analyst / critic / planner-agent / scout / writer）
dossier/       → 不接入
scheduler/     → 不接入
legacy plans   → 不接入、不删除、不标记（src/server.ts / src/store.ts /
                 src/invest-extension.ts / data/plans.json 保持隔离）
```

> **立即阻断条件**：若 C3 验证中发现上述任一模块被 Research Core **间接调用**，那不是技术债而是**边界污染**，必须停止并先重新审查，不得顺手修。

11. **不执行、不安排、不联系、不推荐任何实地调研**（C3 边界裁定 ③）：

```text
field_visit / interview 属于 C3 的 NextAction kind 验证对象，
但 C3 不执行、不排期、不联系人、不推荐、不自动化 field research。
```

12. **不统一 / 不重构 §2.4 的 7 处 frozen 谓词**：C3 只**验证它们行为一致**；形式统一不属 contract-conformance fix。
13. **不为测试写死实现**：测试必须证明真实不变量（行为 / 持久化行 / 全状态指纹），不是"测试全绿"本身。
14. **不修改保留值的可达性、不删除保留值**（§2.4）：既不引入 `mitigating` / `accepted` 的生产写入点，也不清理类型。

---

## 4. 允许的 Contract-conformance fix（白名单，带边界）

**C3 permits bounded implementation fixes required to make the existing Priority / NextAction contract conformant; it does not permit semantic redesign, policy changes, or acquisition-value redefinition.**

### 4.1 允许（属于取证范围内的实现缺陷修复）

```text
- reopened Gap 已正确恢复，但其 NextAction 没有重新进入既有队列（仍为 cancelled / 丢失）
- 既有 persisted priority 未被正确读取（读取面漏读、错读、状态过滤错误）
- priorityPolicyVersionId 丢失或被覆盖为错误版本
- priorityBreakdown 未正确保留 / 被清空
- NextAction ↔ Gap 既有映射读取错误（params.gapId 解析错误）
- 既有实现与 §22 / §26 明文的既有语义不一致（contract non-conformance）
- 投影消费者错误地重算 priority（例如用 rank() 代替 currentPriorities()）
- actionId / createdAt 在 re-entry 时发生不应有的漂移
```

### 4.2 禁止（属于语义重设计，必须另立契约 / Phase）

```text
- 修改 Priority 公式 / 权重 / 阈值 / 因子集合
- 修改 acquisitionValue 或 acquisitionCost 的定义
- 修改 Priority Policy 或其版本
- 新增 Priority factor
- 重新定义 NextAction 的 kind / status / 语义
- 新增 Gap→Priority 规则
- 把 Priority 改为 runtime 计算
- 引入 LLM 参与 priority / kind 判定
- 重新设计研究规划算法
```

### 4.3 判定程序（避免"边验证边改规则"）

每次允许的 fix 必须同时交付：

```text
① 失败证据（在 §5 矩阵中的哪一条、失败的断言/指纹）
② 根因（指出实现与 §22/§26 的哪一条不符）
③ 最小改动说明（且不触碰 §3 任何红线）
④ 修复后的同一测试转红→绿
⑤ 若无法在不改语义的前提下修复 ⇒ 立即停止并上报（不得自行放宽规则）
```

---

## 5. 验证矩阵（核心）

编号：**`T-C3-1 … T-C3-22`**（不沿用 C2 的编号空间）。
每条都必须证明**真实不变量**（读取 persisted 行本身，或对其取指纹），不接受"只测 mock 层"。

### 5.1 ★★ 核心闭环：reopened → Priority / NextAction re-entry

> **门禁语：没有通过 reopened re-entry 核心矩阵，C3 不得出门。**

必须验证到的**完整闭环**（缺一不可）：

```text
Gap reopen
   → NextAction re-entry（cancelled → open）
   → actionId unchanged
   → createdAt unchanged
   → priority 生命周期语义一致（§1.5：按既有写入机制，不新增计算规则）
   → factor breakdown 生命周期语义一致
   → policyVersionId 生命周期语义一致
   → currentPriorities() 可见
   → ResearchState.nextActionIds 可见
   → Report 可见
   → C2 ResearchPlan 可见
   → 多轮 reopen / resolve 循环收敛（无重复 Action、无重复 Gap）
```

| # | 验证内容 | 证明方式 |
|---|---|---|
| T-C3-1 | gap resolved ⇒ 其 action 变为 `cancelled`（**前置**，建立基线） | 读取 `next_action` 行 `status` |
| T-C3-2 | 同一 gapId re-open（slot 退化）⇒ 原 action **重新 `status = "open"`** | 读取行（`knowledge-projection-service.ts:744-763` 的实际后果） |
| T-C3-3 | re-entry 后 **actionId 不变**（≡ `act-<gapId>`），且**不产生第二个 action** | 全表扫描该 gap 的 action 数 = 1 |
| T-C3-4 | re-entry 后 **`createdAt` 保留首次创建值**，`updatedAt` 前进 | 行级比较 |
| T-C3-5 | re-entry 后 **`priority` / `priorityBreakdown` / `priorityPolicyVersionId` 的生命周期语义与既有契约一致**（§1.5；不表述为"重新计算"） | 行 vs 既有写入机制的产出；**不得**由消费者侧重算 |
| T-C3-6 | re-entry 后 **`kind` 与 `actionKindByGapType[gapType]` 一致** | 行 vs policy 表 |
| T-C3-7 | re-entry 后 `currentPriorities()` **重新包含**该 gap，且 score/factors/policyVersion 与行一致 | 只读面 vs 行 |
| T-C3-8 | re-entry 后 `ResearchState.nextActionIds` **重新包含**该 action | `research_state` 行（`knowledge-projection-service.ts:791-796`） |
| T-C3-9 | re-entry 后 **C2 Plan（只读投影）重新看到该 gap**（openGaps 计数 + 其 NextAction 出现） | `ResearchPlanService.build()` 与基线对比 |
| T-C3-10 | **多轮 resolve ↔ re-open 循环**后：状态收敛、无重复 action、无重复 gap、identity 稳定 | 循环 N 次后取全状态指纹 |

### 5.2 驱动链其余段

| # | 验证内容 | 证明方式 |
|---|---|---|
| T-C3-11 | gapType 变化（unknown→insufficient→conflict）⇒ `kind` 跟随 policy 映射变化（**gap state 决定 KIND**） | 行 vs `PRIORITY_POLICY_V1.actionKindByGapType` |
| T-C3-12 | 仅 priority 变化（kind 不变）⇒ 既有行**被更新**而非新建 | 行数不变 + 值变化 |
| T-C3-13 | **no-change refresh 零写入**（同一状态重复 refresh ⇒ 该行 byte-identical） | 行级指纹（强化 `s5-priority.test.ts:342`） |
| T-C3-14 | ★ **读取面永不重算**：注入偏离 policy 的 persisted `priority`/breakdown ⇒ `currentPriorities()` **如实反映**该值 | **两层证据**：① 静态调用点审计（见 T-C3-21）；② 行为证据（注入/替换 policy；既有先例 `s6-report.test.ts:229`） |
| T-C3-15 | 无 breakdown 的 action 被**跳过而非伪造** | 清空 `params.priorityBreakdown` 后读取面不产出该 gap |
| T-C3-16 | cancelled / done 的 action **不进入** Priority 读取面 | 状态过滤 |

### 5.3 读取面与消费者一致性

| # | 验证内容 | 证明方式 |
|---|---|---|
| T-C3-17 | CLI（`research priority`）输出与 `currentPriorities()` 严格一致（同源） | CLI `--json` vs 服务输出 |
| T-C3-18 | Report 的 priority 段**消费 persisted 值、不重算** | **两层证据**：① 静态调用点审计；② 行为证据（注入法；既有先例 `s6-report.test.ts:212-229`） |
| T-C3-19 | `priorityPolicyVersionId` 在 **action 行 / Priority view / Report** 三处一致 | 三处比较 |
| T-C3-20 | C2 Plan 的 gap/priority 展示与 persisted 行一致（跨阶段一致性，不重算） | Plan 输出 vs 行 |

### 5.4 边界与静态审计

| # | 验证内容 | 证明方式 |
|---|---|---|
| T-C3-21 | **生产调用点审计**：`rank()` 的生产调用者只能存在于既有 Priority 持久化写入路径（`knowledge-projection-service.ts:720`）；消费者一律 `currentPriorities()` | 全仓静态扫描 + 调用链审计 |
| T-C3-22 | 静态审计 + 24 表 runtime 指纹：C3 新增/修改不引入新写路径、无 LLM、无新表、无 legacy 引用、Agent 无新写工具；新增只读出口零写入 | 静态 grep + 调用链审计 + 全状态指纹 |

---

## 6. 不变量（I-C3-x）

```text
I-C3-1  Priority 的 persisted 载体唯一 = next_action 行（priority + params.priorityBreakdown +
        params.priorityPolicyVersionId）；不存在独立 priority 表。
I-C3-2  KIND 由 gapType 经 policy 映射决定；priority 只决定顺序与分数。
I-C3-3  actionId ≡ `act-<gapId>`；gapId ≡ `gap-<requirementId>`（两者永不漂移）。
I-C3-4  reopened 不产生新 gap、不产生新 action（同 id 复用）。
I-C3-5  读取面永不重算、永不查 policy；缺 breakdown 的 action 被跳过而非伪造。
I-C3-6  无变化的 refresh 零写入（不 churn 行）。
I-C3-7  cancelled 的 action 保留在表中（历史不删除）。
I-C3-8  ★ 生产消费者不得调用 Priority 计算面 `rank()`；`rank()` 的生产调用者只能存在于
        既有 Priority 持久化写入路径。所有 Priority 消费必须通过既有只读面
        `currentPriorities()` 或其合法上层只读投影。
I-C3-9  §2.4 的 7 处 active 谓词在 C3 中保持 frozen（只验证行为一致）。
I-C3-10 mitigating / accepted 是"声明存在但当前生产写入路径不可达的保留值"：
        C3 不引入写入点、不清理类型。
I-C3-11 legacy 隔离与 Agent 写权限边界不得扩大。
I-C3-12 Priority Policy 版本（prio-v1）与其语义在 C3 中冻结。
I-C3-13 reopen 的持久化语义遵循 §1.5：验证既有写入机制的产出，不新增计算规则。
```

---

## 7. 验收测试与门禁

### 7.1 必须执行

- 既有 S5 / Gap / Report / C1 相关用例**全部保持通过**（回归）；
- §5 的 `T-C3-1 … T-C3-22` 全部落地为可执行测试；
- 每条测试必须能在**故意破坏实现**时转红（红→绿证据）。

### 7.2 门禁

```text
npx tsc --noEmit                            → 0
npm --prefix packages/research run typecheck → 0
全量测试（packages/research + src/agent + src/cli）
真实 child-session smoke：tiancha research smoke → PASS (child-session=real)
真实库演练 + 恢复（byte-identical）
越界自检（黑名单零触碰）
```

测试结论必须**如实记录既有 flaky**（当前为 `C1-29`，双侧对照已证与 C2/C3 无关；不得为"全绿"而修）。

### 7.3 ★ 证据强度（三层，锁死）

```text
Layer 1 — 静态结构证据（全仓调用点审计 / 黑名单 grep / 类型与不变量检查）
Layer 2 — 自动化测试证据（§5 矩阵，证明真实不变量与红→绿）
Layer 3 — 真实 SQLite / child-session 行为证据（真实库演练 + smoke）
```

> **核心 re-entry 矩阵（§5.1）必须至少达到 Layer 2 + Layer 3。**
> 任何"只读 / 零写入 / 不重算"的声明，必须同时给出 Layer 1 与 Layer 2（必要时 Layer 3）证据；
> **不接受**"grep 没发现写"作为唯一证据。

### 7.4 24 表基线（不得增删）

```text
company, diligence_preparation, human_gate, industry, industry_knowledge,
information_pool_entry, information_pool_item, information_pool_slot,
information_requirement, investment_evaluation, knowledge_belief, knowledge_conflict,
material, methodology, methodology_candidate, next_action, report_snapshot,
research_document, research_gap, research_position, research_question, research_source,
research_state, research_target
```

---

## 8. 明确不做（OUT）

```text
Priority 公式 / 权重 / 阈值 / 因子集合的修改
Priority Policy 与其版本的修改；acquisitionValue / acquisitionCost 的重新定义
NextAction kind / status / 语义的重新定义
新的 Gap→Priority 规则；actionKindByGapType 映射的修改
Priority 改为 runtime 计算；读取面重算
LLM / 外部数据 / web / 自动研究
Research execution / field research 的执行、排期、联系、推荐、自动化
新表 / 迁移 / snapshot 表
legacy plans 子系统的接入、删除、标记
planning / evidence / agents / dossier / scheduler 的接入或重构
§2.4 的 7 处 frozen 谓词的形式统一
mitigating / accepted 保留值的可达性"修复"或类型清理
C1-29 flaky 的修复（独立事项，不夹带）
Report 的深化（属 C4）
Company / Chain domain 完整化（仍为 OUT）
Target / Chain / Report / research plan 的主业务建设（它们在 C3 中仅是"消费者一致性验证对象"）
```

---

## 9. 裁决记录

### 9.1 已裁决（用户 2026-09 裁定，逐条落地）

| # | 问题 | 裁定 | 落地位置 |
|---|---|---|---|
| ① | 验证中发现 Bug 能否修 | 🟢 可以，**限于 contract-conformance fix** | §4.1 / §4.2 / §4.3 |
| ② | legacy / 未接线资产 | 🟢 C3 **不接管**，继续隔离，登记技术债 | §3.10 / §8 |
| ③ | `field_visit` / `interview` | 🟢 **纳入 NextAction 验证，但不执行调研** | §3.11 / §8 |
| ④ | CLI / Agent 出口 | 🟢 允许**验证所必需的只读 observability**，不扩大写能力 | §3.9 / §10.3 |
| ⑤ | 独立 C3 Contract | 🟢 **必须有，先 Contract 再实现** | 本文档 |

### 9.2 本契约在 `C3 Contract Gate` 必须**一次性定死**的四项（预审补强 ⑤）

**（1）实施拆分（预设，待 Gate 确认）**

```text
C3-A：Priority / NextAction lifecycle verification
      （§5.1 核心 re-entry 矩阵 + §5.2 驱动链其余段）
C3-B：cross-consumer consistency + regression verification
      （§5.3 读取面与消费者一致性 + §5.4 边界与静态审计 + 全量回归）
```

拆分**不得用于扩大范围**；两步各自独立验收、各自交付证据。

**（2）出口范围（预设，待 Gate 确认）**

```text
C3 的范围被限定为：Gap lifecycle → persisted Priority → persisted NextAction → read-only consumers
```

- 允许：读取既有 persisted SoT / 既有只读服务所需的、最小范围的只读 observability（含可能的只读 CLI/Agent 出口）；
- 禁止：把 `research plan` / Report / Target / Chain 重新拉成 C3 的主业务建设 —— 它们在 C3 中**只是"消费者一致性验证对象"**；
- 禁止：任何生成 / 重算 / 优化 / 修复 / 修改 priority、policy、NextAction 的出口。

**（3）证据强度（锁死）**

采用 §7.3 的三层证据；**核心 re-entry 矩阵至少 Layer 2 + Layer 3**。

**（4）真实库演练对象（预设，待 Gate 确认）**

> 在真实 SQLite 上跑**一个完整的 Gap 生命周期**：`open → resolved → reopened → resolved → reopened`

并对**同一 `gapId`** 验证最终一致性：

```text
Gap（status / gapType / discoveredAt 稳定）
NextAction（status 在 re-entry 后为 open）
persisted priority / factor breakdown / policyVersionId
actionId / createdAt（稳定）
currentPriorities()
Report
C2 ResearchPlan
```

演练后必须把真实库**恢复为 byte-identical**。

---

## 10. 与既有契约的关系

### 10.1 层级

```text
docs/phaseC/implementation-contract.md          （Phase C 主契约，§22 = C3 原则）
        │
        ├── docs/phaseC/c2-implementation-contract.md          （C2 语义链）
        ├── docs/phaseC/c2-phase2-implementation-contract.md   （C2 Phase 2 FINAL LOCK）
        ├── docs/phaseC/c3-implementation-contract.md          ← 本文档（C3 展开）
        └── （未来）c4-…
```

### 10.2 与 C2 的关系

C2 Phase 2 的 Plan 是**只读投影**，C3 **不修改**它；C3 只**验证**它对 Gap/Priority/NextAction 的消费与 persisted 行一致（T-C3-9 / T-C3-20）。

### 10.3 出口原则（裁定 ④ 落地）

```text
允许：CLI / Agent 的只读 observability（读既有 persisted SoT 或既有只读服务）
禁止：任何生成 / 重算 / 优化 / 修复 / 修改 priority、policy、NextAction 的出口
Agent 写权限沿用 Phase B Q1 的永久裁决：不扩大。
```

---

## 11. 定稿确认

- 本契约**不修改**任何既有 FINAL LOCK 文档；
- 本契约**不含代码**，实现必须在其通过 `C3 Contract Gate` 后**单独授权**；
- Gate 只审**契约本身**；通过后再单独授权 `C3-A` / `C3-B` 实施；
- 每步交付遵循既有纪律：实现 → diff 摘要 → 测试（证明真实不变量）→ 两处 tsc + 全量 + smoke → 真实运行证据 → 越界自检 → 独立审计 → **commit 与 push 各自单独授权**。

---

## 12. 附：基线事实索引（供逐条核验）

```text
packages/research/src/domain/research-gap.ts:17          GapStatus
packages/research/src/domain/research-gap.ts:20          GapType
packages/research/src/domain/next-action.ts:6-17         NextActionKind / NextActionStatus
packages/research/src/domain/priority-policy.ts:28-83    PriorityPolicy + PRIORITY_POLICY_V1
packages/research/src/domain/active-requirement.ts:35    Step 2-A 共享 active 谓词
packages/research/src/application/priority-service.ts:50-75    rank()
packages/research/src/application/priority-service.ts:78-123   computeFor()
packages/research/src/application/priority-service.ts:126-128  actionKindFor()
packages/research/src/application/priority-service.ts:143-163  currentPriorities()（S6-R1 只读面）
packages/research/src/application/knowledge-projection-service.ts:641-698  refreshGaps()
packages/research/src/application/knowledge-projection-service.ts:700-772  refreshNextActions()
packages/research/src/application/knowledge-projection-service.ts:779-798  refreshSubject()
packages/research/src/application/report-service.ts:181-183               Report 走只读面
packages/research/src/application/opportunity-discovery-service.ts:246      冻结谓词
packages/research/src/application/report-service.ts:130                     冻结谓词
packages/research/src/s5-priority.test.ts:306/331/342   red line 8 / 9 / 10
packages/research/src/knowledge-gap-refresh.test.ts:183/198  Gap→NextAction（仅 2 例）
packages/research/src/s45-signal-integrity.test.ts:157-164   reopened（仅 Gap 侧）
packages/research/src/s6-report.test.ts:212-229              Report 不重算（注入法先例）
packages/research/src/phase-c2-step2a.test.ts:267-298        frozen exceptions 清单
```

（以上行号对应基线 `ee16851`；若实现阶段发现漂移，先报告。）
