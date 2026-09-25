# Tiancha Phase C · C2 Phase 2 · Step 2-C — Implementation Proposal

> **状态：PROPOSAL（实施前方案；**不是**契约修订，也**不是**实现授权）**
> **基线：`57789e5`（C2 Contract Final Lock）· `8029f52`（Phase 1）· `69d2b1d`（Phase 2 Contract FINAL LOCK）· `91bba15`（Step 2-A ACCEPTED）· `6bfd702`（Step 2-B ACCEPTED）**
> **契约依据**：`docs/phaseC/c2-phase2-implementation-contract.md` — §4.3 / §4.3.1 / §4.3.2 / §1.4 / §1.5 / §5 / §6（I-C2-17·22·24·25·26·27）/ §7（T-C2-26…41）/ §9（Q1=YES、Q3=NO、Q5=NO）/ §12（Step 2-C）。
> 本文件**不含任何实现**，也不修改 FINAL LOCK。

---

## 0. 定位（这是本阶段最容易被做歪的地方）

**正确的定位**：

```text
已有事实 / 已有投影
（Industry · ResearchState · ResearchNeed · Position coverage · Target · Fit · Preparation · NextAction）
        ↓  组合（不改写、不新算）
  ResearchPlanBuilder
        ↓
   ResearchPlanView
      ↙        ↘
 CLI plan    Agent research_plan_show
```

**错误的方向（一律禁止）**：

```text
已有信息 → LLM 重新思考 → 重新规划 → 生成新的 Gap / Target / Position / 判断
```

⇒ Step 2-C **不是**一个新的智能规划系统，而是把 C2 已经存在的确定性结果组合成**人类可读的"当前研究计划"视图**。

**IN（Step 2-C 的全部）**

```text
ResearchPlanBuilder（唯一计划投影源，CLI 与 Agent 共用）
CLI:    tiancha research plan <行业> [--json]
Agent:  research_plan_show({ name })
```

**OUT**：Target/Company/Chain recommendation · LLM · Web/外部数据 · Knowledge/Experience/Report 深化 · 新表/迁移 · Research Execution · 旧 `plans` 子系统 · Step 2-A/2-B 的任何重做。

---

## 1. ResearchPlanBuilder（审点 1）

### 1.1 硬约束

| 约束 | 内容 |
|---|---|
| 唯一投影源 | CLI 与 Agent **必须**读同一个 builder/View；**绝不**各自拼装 |
| 纯 projection | 调用前后 **24 张表**指纹完全一致（清单见 §5.4） |
| 不写 DB | 无 `upsert*` / `create*` / append / 落表；`ResearchPlanView` **无 identity** |
| 不刷新 State | **不得**调用 `refreshState` / `refreshGaps` / `refreshNextActions` / `syncRequirementStatus`；stale 就照实展示 |
| 不重算已有派生 | 只**消费** Step 2-A/既有服务的结果（详见 §4 静态审计） |
| 无「未生成」状态 | 只要 Industry 存在即可渲染；只有 `industry not found` 才是错误 |
| **唯一 build path（原 Gate ③）** | `ResearchPlanService.build(industryId)` 是**唯一**的 plan projection/build path；`domain/research-plan.ts` 只能作为它的**纯函数组件**（交集派生 / 三态 / 排序 helper），**不得**存在第二套 View 拼装；CLI human 仅 formatter，Agent 直接返回同一 View |
| **DTO 边界（原 Gate ④）** | `ResearchPlanView` 是 **read-model / projection DTO**：≠ SoT、≠ entity、≠ aggregate、≠ 持久化对象。**不得**出现 `planId` / `createdAt` / `updatedAt` / `versionId` / `status` / `save()` / `upsert()` 之类字段或方法 |

> 以上两条在**实现报告**里必须显式证明（展示唯一的 build 调用链 + DTO 字段清单），不是在文档里声明即可。

### 1.2 允许的输入（白名单 —— 与 FINAL LOCK §4.3 表逐条对应）

| 语义格 | 唯一来源 | 备注 |
|---|---|---|
| 行业标识（ref / name） | `Industry`（`repo.findIndustryByName`） | |
| Current State（version / known / confirmed / uncertain / conflicting / unknown / keyQuestion 计数） | `repo.getStateBySubject("industry", industryId)` | **只读**；不 refresh |
| **Active Gaps**（当前仍需要研究的缺口；`gapId` / `gapType` / `status` / Priority 分数 + 策略版本） | `ResearchNeedService.list(industryId)` | plan **不**再调用 `PriorityService`；"active" 的唯一口径见 §1.4 |
| 每个 Gap「为什么需要调研」 | 同上（`whyStudyNotJustFetch`，**透传**） | 不解释、不重判、不按 gapType 推导 |
| Suggested Positions（含 `active / all`） | `ChainProjectionService.positionCoverage(industryId)`（Step 2-A 产出） | **不重算** Gap→Position（§1.5 / I-C2-25） |
| Targets | `TargetService.list(industryId)` | 含 `isFallback` / `fallbackForTargetRef` |
| Per-Gap Targets / Industry-level Targets / `associationStatus` | **view 内**按 §1.4 交集派生 | 不落库、不新增关系 |
| Fit warnings | `QuestionTargetFitService.summarize(targetRef)`（`FitSummary`） | 只消费 |
| Preparation status（`current` / 历史计数） | `DiligencePreparationService.list(industryId)` + `currentPreparationView()` | **不得**自行判断 `q.state` |
| Next Actions | `repo.listNextActions(industryId)` | 只读；不 refresh |
| 维度标签（人类可读） | methodology 维度名（与 `research need` 同源 `dimensionNames`） | deterministic |

### 1.3 禁止清单（黑名单 —— 静态审计会 grep 这些符号）

```text
❌ refreshState / refreshGaps / refreshNextActions / syncRequirementStatus / reconcilePool
❌ 任何 upsert* / create* / append* / resolve*（含 report_snapshot）
❌ PriorityService（plan 的 priority 只来自 ResearchNeedService.list()）
❌ 直接读 SoR 表：listGaps / listPositions / listRequirements / listTargets(≠TargetService.list) / Pool / Knowledge
   （builder 只消费"服务层输出"；例外仅 §1.2 明确列出的两个 repo 读：getStateBySubject、listNextActions）
❌ 新增 Gap→Target 关系（不新增列 / 表 / 缓存副本）
❌ 重新判定 active（只消费 Step 2-A 的共享 resolver 产出）
❌ LLM / Web / HTTP / 外部数据源
❌ Knowledge / Pool / Evaluation 作为**计算**输入
❌ 新 DB table / schema / migration
❌ 写 Target / Gap / State / Preparation 或任何 SoT
❌ 生成 Company / Expert / Institution 名单（只输出"位置 + 建议对象**类型**"与"已确认对象数"）
❌ 复用 legacy `plans` 子系统（plans.json / server.ts / store.ts / invest-extension.ts）
```

### 1.4 Target 在 plan 中的归属（FINAL LOCK §4.3.1，逐字落实）

**★ "active Gap" 的唯一口径（原 Gate ①）**：

```text
Active / currently-needing Gap
  = 当前仍需要研究的 Gap
  = ActiveRequirementResolver 的 active gap 集合（C2 Step 2-A 的唯一实现源）
  = gap.status ∈ { open, mitigating }
```

⇒ **禁止**在 plan 里把 active 写成 `gap.status === "open"`（那会把 `mitigating` 排除掉，造成 T-C2-39 语义漂移）。
plan 侧只**消费** `ResearchNeedService.list()` 与 `positionCoverage()`（二者都已经共享 resolver），**不自行判定 active**。

```text
associationStatus（三态互斥且完备；"active Gap" 按上面的唯一口径）
  mapped                 = 存在至少一个 active Gap G，使 T.refs ∩ G.relatedRequirementIds ≠ ∅
  unlinked               = T.refs = []
  non_currently_mapped   = T.refs ≠ [] 且与所有 active Gap 的 relatedRequirementIds 均无交集

Per-Gap Targets(G) = { T | T.refs ∩ G.relatedRequirementIds ≠ ∅ }   ← 允许同一 T 出现在多个 Gap 下
Industry-level Targets = { T | associationStatus ∈ { unlinked, non_currently_mapped } }
```

- `mitigating` **属于** active ⇒ 与 `open` 同等参与 `mapped` 判定（T-C2-39 必须同时覆盖 `open` 与 `mitigating` 两种 active 状态）；
- 禁止隐藏 `non_currently_mapped`、禁止强塞进某个 Gap、禁止与 `unlinked` 合并；
- 禁止为"唯一归属"去重或截断 `mapped` 的跨 Gap 重复。

### 1.5 排序契约（FINAL LOCK §4.3.2 —— source order 为主，ID 仅作 tie-breaker）

```text
Gaps        : priority desc → gapId asc
Requirements: gap.relatedRequirementIds 的既有 SOURCE ORDER 为主；
              仅当 source order 无法稳定确定时，requirementId asc 才作为 fallback / tie-breaker
Positions   : suggestedPositionRefs 的既有 SOURCE ORDER 为主；
              仅当 source order 无法稳定确定时，positionRef asc 才作为 fallback / tie-breaker
Targets     : targetRef asc
NextActions : priority desc → actionId asc
Preparation : preparationRef asc
```

- ★ **禁止**"先取全部再按 ID 重排"的写法（那会打乱已有业务顺序）：source order 是**主**排序键，ID 只是**稳定兜底**；
- 若 source 本身已是有序数组（`relatedRequirementIds` / `suggestedPositionRefs` 都是），**直接保留**；
- CLI `--json` 与 Agent 返回**同一 View**：字段值与数组顺序一致；
- **CLI human 只是该 View 的确定性格式化**（不另造数据、不做语义重排）。

### 1.6 正常态（FINAL LOCK §4.3 / I-C2-19）

- 0 开放缺口 / 0 Target / 0 Preparation 都是**正常输出**，必须自然呈现 + 给"下一步"提示（例：`已确认对象：0` + `请研究者选择并录入对象（tiancha research target add …）`）；
- **不得**出现「plan 尚未生成，请先执行 CLI」之类的提示。

---

## 2. CLI（审点 2）

```
tiancha research plan <行业>
tiancha research plan <行业> --json
```

- 加入 `RESEARCH_SUBCOMMANDS` + `runResearchCommand` 的 switch（**已核对**：`phase-b-b5-cli.test.ts` 用的是 `RESEARCH_SUBCOMMANDS.includes(sub)`，属**包含式**断言 ⇒ 新增 `plan` 不会破坏它）；
- human 输出草案（**请裁**，见 §8 Q1）：

```text
研究计划（人形机器人）· 当前状态 v3
  认知：已知 5 · 确认 2 · 不确定 1 · 冲突 1 · 未知 3 · 关键问题 12

开放缺口（2，按优先级）
  1. [优先级 72/100 · 规则 pri-v1] 市场规模与口径（conflict · gap-084d…）
     为什么需要调研：需要独立第三方证据消解分歧
     建议研究位置：
       · 下游头部客户（customer）· 覆盖 active 4 / all 8
         已确认对象 1：
           · C2B验证对象（头部客户）· 适配：强 4 / 部分 8 / 弱 0 / 无 0
             用于补充 Requirement：关键验证假设（ir-f71a…）
        · 咨询/研究机构（consulting_research）· 覆盖 active 0 / all 7
          已确认对象 0 —— 下一步：请研究者选择并录入对象（tiancha research target add …）
  2. …

行业级对象（不属于任何开放缺口）
  · 某对象（头部客户）· non_currently_mapped（其 Requirement 的缺口已收敛）

下一步动作（2）
  1. [72] retrieve_data · 市场规模口径不清，需补全
  2. [40] interview · …
```

- 草案中的"**开放缺口**" = **active Gap**（唯一口径见 §1.4：`status ∈ { open, mitigating }`，由 `ActiveRequirementResolver` 判定）—— 输出文案可写"开放缺口"，但实现**不得**写成 `status === "open"`；
- 与既有出口的关系（**已核对**）：`tiancha state show <行业>` **已存在**（顶层命令，`tiancha.ts`）⇒ plan **不是** state 的首个 CLI 出口；但**NextAction 此前只有 Agent 出口**（`research_next_action_list`）⇒ plan 是**它的首个 CLI 出口**（消除"系统已有结构化下一步、人类看不到"的不对称）。

---

## 3. Agent（审点 3）

- 新增**只读**工具 `research_plan_show({ name })`（第 **19** 个工具）；
- **无「未生成」分支**（0/0/0 也正常返回）；
- 调用前后 24 表指纹一致；
- 需**同步**的两处既有产物（属"出口扩展"，不是改语义）：
  1. `src/agent/tiancha-agent-host.ts` 的 `TIANCHA_SYSTEM_PROMPT` 工具清单文本（加一行）；
  2. **核对** `src/agent/host.test.ts` 是否有"工具清单/数量"精确断言（若有 ⇒ 同步；已核对 `phase-b-b5-exposure.test.ts` 用的是工具名 `includes('"<name>"')`，属包含式 ⇒ 兼容）。
- 契约 §9 裁决遵守：**Q1 = YES**（plan 含 State 与 NextAction 的**展示**，不重新生成）；**Q3 = NO**（不把 `relatedRequirementRefs` 加进 `research_target_list`）；**Q5 = NO**（plan 无 `--target` 过滤）。

---

## 4. 静态依赖审计（审点 6 —— proposal 阶段先锁死）

★ **证据组合原则（Gate 明确）**：`grep` 只是**必要条件**，不是充分条件 —— `service.build(...)` 可以完全不含 `refresh` / `upsert` / `PriorityService` / `fetch`，但它内部调用的服务仍可能偷偷写库。因此 Step 2-C 的最终证据必须是**三者同时成立**：

```text
① 静态 grep 审计（下面的白名单 / 黑名单）
② 调用链审计：builder 实际调用的每个服务逐个确认只读 ——
     ResearchNeedService.list · ChainProjectionService.positionCoverage · TargetService.list ·
     QuestionTargetFitService.summarize · DiligencePreparationService.list ·
     currentPreparationView · repo.getStateBySubject · repo.listNextActions
③ 运行时 24 表 fingerprint（§5.4；调用前后完全一致）
```

实现完成后，**Step 2-C 独立复验**必须逐条执行（作为 checklist，不新增测试编号）：

```text
ResearchPlanBuilder（及 plan 相关文件）：
  □ 允许出现：getStateBySubject · ResearchNeedService · TargetService.list ·
              ChainProjectionService.positionCoverage · QuestionTargetFitService.summarize ·
              currentPreparationView · listNextActions · dimensionNames
  □ 禁止出现（grep）：
      /refresh/ · /syncRequirementStatus/ · /reconcilePool/
      /upsert[A-Z]/ · /create[A-Z]/ · /append[A-Z]/ · /resolve[A-Z]/
      /PriorityService/
      /listGaps\(/ · /listPositions\(/ · /listRequirements\(/ · /listPoolSlots\(/ · /listPoolItems\(/
      /KnowledgeRepository/ · /fallbackRequirements\(/
      /openai|anthropic|fetch\(|https?:\/\//
      /plans\.json|invest-extension|store\.ts|server\.ts/
  □ 不新增表 / 列 / migration（`research-db.ts` 零 diff）
  □ 写路径零命中（CLI/Agent 两侧都不写）
  □ 行为侧证据：全库指纹（§5.4）+ CLI/Agent 同源一致（T-C2-35）
```

> 说明：`listNextActions` / `getStateBySubject` 是**没有 service 包装**的两个只读 repo 读，FINAL LOCK §4.3 已把二者列为来源，故白名单放行；其余 SoR 表一律不得直读（必须经服务层）。

---

## 5. 测试矩阵（审点 5）

### 5.1 契约测试（T-C2-26 … T-C2-41，逐条落地）

| # | 断言要点 | 落地位置 |
|---|---|---|
| T-C2-26 | 逐格来源正确（Industry/State/Gap/Priority/Requirement/Position/Target/Fit/Preparation/NextAction）+ `active ≤ all` + **不重算**（priority 与 need 同值、active 与 resolver 一致、`suggestedPositionRefs` 逐字相同、fit/preparation/nextAction 与既有输出一致） | `phase-c2-step2c.test.ts` |
| T-C2-27 | 全 gap resolved ⇒ active = 0 /「无开放缺口」；**不得** fallback 到行业全量 Position；覆盖显示 `active 0 / all M`；已确认 Target 仍在行业级（`non_currently_mapped`） | 同上 |
| T-C2-28 | 每个 Gap 的 Requirement / Suggested Position（来自 `suggestedPositionRefs`）/ Per-Gap Target 集合**分别派生**，禁止跨 Gap 串线；未关联 Target 不得强行归属 | 同上 |
| T-C2-29 | gap resolved → slot 退化 ⇒ 同一 `gapId` 回 `open`；plan 的 active 覆盖恢复；`positionRef` 与 Target identity 不变 | 同上 |
| T-C2-30 | 无 Target ⇒ `已确认对象：0` + 明确「下一步」 | 同上 |
| T-C2-31 | `isFallback=true` 的 Target 带「备选 / 降置信度、交叉验证」标记 | 同上 |
| T-C2-32 | Target 存在但无 preparation ⇒ 「暂无调研准备 + 生成命令」，不报错 | 同上 |
| T-C2-33 | CLI 输出稳定（含数组顺序）；未知行业报错且**写零行** | `phase-c2-step2c-cli.test.ts` |
| T-C2-34 | Agent 直接返回 projection（0/0/0 也正常）；**无「未生成」提示**；前后全库指纹一致 | `phase-c2-step2c-exposure.test.ts` |
| T-C2-35 | CLI `--json` 与 Agent 同源：字段值 + 数组顺序一致；CLI human 只是 formatter | agent + cli 两处 |
| T-C2-36 | chain / chain_show 的 active·all 与 need / fit 口径一致（Step 2-A 已覆盖，plan 侧追加"与 plan 的 coverage 一致"） | 同上 |
| T-C2-37 | `--for-gap` 幂等 + 顺序（Step 2-B 已覆盖）；plan 侧追加"重复渲染 ⇒ 相同 View" | 同上 |
| T-C2-38 | grep：plan 路径不引用 `plans.json` / `server.ts` / `store.ts` / `invest-extension.ts`；无 LLM/HTTP | `phase-c2-step2c.test.ts`（静态） |
| T-C2-39 | 交集派生的三态：`Gap A→X`、`Gap B→Y`、`Z([])` 归行业级；`T2→[R1,R2]` 两个 Gap 都带它；`T3→[R5]`（R5 的 Gap 已 resolved）⇒ `non_currently_mapped`，不被隐藏/归属。★ **必须同时覆盖 `open` 与 `mitigating` 两种 active 状态**（`mitigating` 的 Gap 同样参与 `mapped`） | 同上 |
| T-C2-40 | ① 非法/跨行业 gap ⇒ 原子失败（Step 2-B 覆盖）；plan 侧：**工业级**保证 plan 不触发任何写（指纹） | 指纹测试 |
| T-C2-41 | 排序 tie-breaker（同 priority Gap / 同 priority NextAction / 同行业 Target）⇒ 由 §1.5 规则决定；重复调用逐字相同；CLI 与 Agent 顺序一致 | cli + agent |

### 5.2 回归

- Phase 1（`phase-c2-diligence` / `phase-c2-cli`）、Step 2-A（`phase-c2-step2a*`）、Step 2-B（`phase-c2-step2b*`）全绿；
- C1（`phase-c-c1`）**保持现状**（C1-02/C1-29 的既有 flaky **不修、不夹带、不计入本步回归**）；
- B5 出口测试（`phase-b-b5-cli` / `phase-b-b5-exposure`）保持全绿。

### 5.3 门禁

两处 `tsc` exit 0 · 全量测试全绿 · `research smoke` PASS（child-session=real）· 真实库 **backup → rehearsal → restore（byte-identical）** · 送审 patch + 文件清单 + **对象级 blob 对照** + 越界自检 + §4 静态审计逐条结果。

### 5.4 全库指纹（24 张表，复用 Step 2-A 的清单）

```text
industry · company · research_question · information_requirement · research_gap ·
information_pool_entry · information_pool_slot · information_pool_item · research_state ·
research_source · research_document · next_action · methodology · methodology_candidate ·
human_gate · industry_knowledge · knowledge_belief · knowledge_conflict ·
investment_evaluation · report_snapshot · material · research_position · research_target ·
diligence_preparation
```

（指纹只用于证明 plan **没有写入**；builder 不得为做指纹而依赖 Knowledge/Pool/Evaluation 仓储。）

---

## 6. 文件级实施计划

| 文件 | 计划改动 |
|---|---|
| `packages/research/src/domain/research-plan.ts`（新） | `ResearchPlanView` 类型 + 纯派生（`TargetsForGap` 交集、`associationStatus`、排序 helper）—— 无 IO |
| `packages/research/src/application/research-plan-service.ts`（新） | `ResearchPlanService.build(industryId): ResearchPlanView`（唯一投影源；只读 repo/services） |
| `packages/research/src/domain/index.ts` + `src/index.ts` | 导出（`export *` 自动；确认即可） |
| `src/cli/research-commands.ts` | `RESEARCH_SUBCOMMANDS` 加 `"plan"` + switch 分支 + `runPlan`（human/json） |
| `src/cli/research-format.ts` | `formatPlanHuman(view, names)`（唯一 formatter） |
| `src/agent/research-tools.ts` | `research_plan_show`（第 19 工具，只读）+ `ResearchToolDeps` 注入 `plans: ResearchPlanService` |
| `src/agent/tiancha-agent-host.ts` | system prompt 工具清单同步一行 |
| 测试（新） | `packages/research/src/phase-c2-step2c.test.ts`、`src/cli/phase-c2-step2c-cli.test.ts`、`src/agent/phase-c2-step2c-exposure.test.ts` |
| 需核对/同步的既有测试 | `host.test.ts`（工具清单是否精确断言）、`phase-b-b5-*`（已核对为包含式 ⇒ 兼容） |

**不做**：新表 / 新列 / migration / `research plan` 落库 / Agent 写工具 / 任何 2-A·2-B 重做。

---

## 7. 交付（沿用 Step 2-A / 2-B 的取证标准）

commit 前给出：① 修改文件清单 ② 每文件职责 ③ builder 的输入源与 grep 审计结果 ④ CLI/Agent 同源证明 ⑤ T-C2-26…41 结果 ⑥ 24 表指纹 ⑦ 真实库 backup→rehearsal→restore ⑧ 两处 tsc ⑨ 全量 ⑩ smoke ⑪ `git diff --stat` ⑫ `git status` ⑬ 越界自检 ⑭ 明确声明（未 push、未进下一步）。
**一次只做 2-C**；commit 需单独授权；push 仍作为**阶段发布边界**统一处理。

---

## 8. Gate 裁决记录（Step 2-C Contract Gate；已定）

| # | 问题 | **裁决** |
|---|---|---|
| Q1 | plan 的 human 输出结构（§2 草案：当前状态 → Gap → Position → Target → Preparation → NextAction） | **PASS** —— 采用草案（它的价值是"把已有系统输出串成研究者真正能读的状态"，非装饰性） |
| Q2 | `--json` / Agent 的输出形状 | **PASS** —— 单一 `ResearchPlanView`，避免双口径 |
| Q3 | plan 是否需要 `--all` 之类开关 | **PASS** —— 不需要（plan 没有第二种研究口径） |
| Q4 | 是否展示 chain 的 `skipped` 空节点 | **PASS** —— 不展示（完整 chain 已有出口） |
| Q5 | Agent 工具是否接受 `target` 参数 | **PASS** —— 不接受（FINAL LOCK §9 Q5 = NO） |
| Q6 | `host.test.ts` 是否有工具**精确清单/数量**断言 | **PASS WITH DISCLOSURE** —— 若存在则随新增工具同步（属"出口清单变更"，非语义改变），并在实现报告披露 |

### 8.1 Gate 要求的两项修正（已落入本 proposal）

| 原 Gate 条件 | 落点 |
|---|---|
| **①** Target association 的 "Open Gap" → **"Active / currently-needing Gap"**，唯一口径 = `ActiveRequirementResolver`（`status ∈ { open, mitigating }`） | §1.2 表首行 + **§1.4 口径块** + §5.1 的 T-C2-27/28/39 |
| **②** 排序：**source order 为主**，ID 仅作 fallback / tie-breaker | **§1.5** |

### 8.2 实现阶段必须显式证明（Gate 要求 ③④）

```text
③ 唯一 build path：ResearchPlanService.build(industryId) 是唯一的 plan projection/build path；
   domain/research-plan.ts 只是它的纯函数组件（交集 / 三态 / 排序 helper），不存在第二套 View 拼装。
   证明方式：展示唯一的 build 调用链（CLI 与 Agent 各一处调用点）+ 源码结构证据。

④ DTO 边界：ResearchPlanView 是 read-model / projection DTO（≠ SoT / entity / aggregate / 持久化对象）。
   证明方式：列出 View 的完整字段清单，确认无 planId / createdAt / updatedAt / versionId / status /
   save() / upsert()；并给出 24 表指纹零变化的证据。
```

---

**PROPOSAL rev2 结束（Gate ①② 修订已落入；③④ 已写成"实现阶段必须显式证明"的义务）** —— 待 **Step 2-C Final Gate**。在收到最终 Gate 通过与明确授权前：**不写任何 Step 2-C 代码**、不改 FINAL LOCK、不 push、不进入后续阶段。
