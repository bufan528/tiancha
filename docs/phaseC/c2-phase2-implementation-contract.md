# Tiancha Phase C · Step C2 Phase 2 — Implementation Contract

> **状态：FINAL LOCK（rev4 定稿；第三轮 Final Contract Audit = PASS，0 阻塞项 / 0 必须修改项）—— 实现尚未授权**
> **基线：`57789e5`（C2 Contract Final Lock）+ `8029f52`（C2 Phase 1，FINAL PASS）**
> 本文件只定义边界、语义与验收标准；**不含任何实现**。
>
> **rev4 收口摘要**（对应第三轮 Final Audit：2 处硬伤 + 1 处格式歧义；**未新增功能、未新增测试编号**）
>
> | 级别 | 修订 | 落点 |
> |---|---|---|
> | 🔴 1 | **§4.3.1 措辞纠正**：互斥完备的是 `associationStatus` **三态**（不是"三个集合"）；`mapped` 的定义直接写出来；`Per-Gap Targets` 是**允许同一 Target 跨 Gap 重复出现**的派生集合族 | §4.3.1 / I-C2-26 |
> | 🔴 2 | **§4.3.2 排序纠正**：**既有稳定顺序优先**（`relatedRequirementIds` / `suggestedPositionRefs` **不按 ref 重排**）；ref asc 仅作"来源无稳定顺序"时的 fallback | §4.3.2 / I-C2-27 |
> | 🟡 3 | **CLI / Agent 一致性表述**：同一 `ResearchPlanView`（字段值 + 数组顺序一致）；**CLI human 只是该 View 的确定性格式化**，不另造数据（不要求 Agent 返回 CLI 文本） | §4.3.2 / T-C2-35 / I-C2-27 |
> | 附 | Step 2-C 静态结构审计 checklist（不新增测试编号） | §12 |
>
> **rev3 已完成的收口**（保留）：🔴 Gap→Position 唯一来源（§1.5 / I-C2-25）｜🔴 Target add 原子事务边界（§4.2 / I-C2-14 / T-C2-40）｜🔴 未匹配 Open Gap 的 Target 归属（§4.3.1 / I-C2-26 / T-C2-39）｜🔴 Plan 排序契约（§4.3.2 / I-C2-27 / T-C2-41）｜🟡 `whyStudyNotJustFetch` 仅透传（I-C2-24）｜🟡 fingerprint 具名化（§7.3）｜§12 实施三闭环。
> **rev2 已完成的 7 项修订**（保留）：Gap→Target 派生、共享 resolver、删除「未生成」、零 mutation、原子性、deterministic linkage 顺序、T-C2-39/40。

---

## 0. Baseline 与历史注记

| 项 | 值 |
|---|---|
| 契约基线 | `57789e5` — C2 Contract Final Lock |
| 实现基线 | `8029f52` — C2 Phase 1（DiligenceQuestion identity + lifecycle），代码级审计 + commit integrity 双重 PASS |
| 本阶段名称 | **C2 Phase 2 — Research Planning Closure** |
| 本阶段定位 | 把「当前研究状态 → 下一步研究计划」闭合成**人类可读、可追踪、可验证的只读 projection**；**不**扩展知识系统 |

### 0.1 历史注记（不改旧表，只加注记）

`docs/phaseC/c2-implementation-contract.md` §2「现状核查」表中的第 **4、5** 条：

- 4：`QuestionTargetFitService.fitAll()` 遍历全部 requirement；
- 5：`DiligencePreparationService.prepare()` 整行 upsert、重算覆盖历史问题。

它们描述的是 **pre-Phase-1** 的实现状态，已由 `8029f52` 解决（`fitAll` 已按 active 收敛；`prepare` 已按 identity 合并、历史永不删除）。**本节保留原表述、不改写旧表格**，仅在此加注记，保持历史可追踪。

---

## 1. 目标与语义链

### 1.1 一句话目标

> 系统已经拥有 `Gap → Priority → Requirement → Position → Target → Fit → Preparation → NextAction → State` 的全部零件，
> 但人类没有一个地方能看到「**所以我现在到底该研究什么**」。
> Phase 2 只做一件事：把它们投影成**一张确定性的研究计划**。

### 1.2 语义链（方向写死）

驱动方向（SoT 方向）：

```text
Gap ──(active 口径)──► Requirement ──► Position（能力覆盖）
 │
 └──► Priority ──► NextAction ──► ResearchState

Target ──relatedRequirementRefs──► Requirement
          （关联输入，不是 SoT 方向）

(上述全部) ──► ResearchPlanView ──► CLI `research plan` / Agent `research_plan_show`
```

### 1.3 四种 ref 集合的定义（写死，禁止混用）

| 名称 | 语义 | 谁定义 | 是否 SoT |
|---|---|---|---|
| `satisfiesRequirementRefs`（既有） | 该 Position **能力上**服务哪些 Requirement（模板维度 × 全部 Requirement） | `ChainProjectionService` | ✗ 派生 |
| `allRequirementRefs`（本阶段新增**别名**） | ≡ `satisfiesRequirementRefs`，**不是新列** | view | ✗ 派生 |
| `activeRequirementRefs`（本阶段新增） | `allRequirementRefs ∩ 当前仍需研究的 Requirement`（口径见 §4.1） | **共享 resolver** | ✗ 派生 |
| `relatedRequirementRefs`（既存列） | 人确认的 Target **为了哪些 Requirement** 而研究 | `--for-gap`（唯一入口） | ✓ Target 的属性（**不是** Gap 的引用） |

### 1.4 ★ Gap → Target 归属的确定性派生规则（rev2 新增，写死）

```text
TargetsForGap(G) = { T | T.relatedRequirementRefs ∩ G.relatedRequirementIds ≠ ∅ }
```

- 这是 Plan 中**唯一允许**的 Gap → Target 归属方式；
- ★ **禁止创建任何新的 Gap → Target 关系**：不新增列 / 不新增表 / 不做缓存副本 / 不写回；
- ★ `T.relatedRequirementRefs = []` 的 Target ⇒ **不归属任何 Gap**，但仍在 Plan 的**行业级 Target** 区展示（见 §4.3.1）；
- ★ 一个 Target **可以**同时归属多个 Gap（当多个 Gap 的 `relatedRequirementIds` 都与它有交集）——这是**正确结果**，不得为了"唯一归属"去重或截断。

### 1.5 ★ Gap → Suggested Position 的派生规则（rev3 新增，唯一来源）

```text
Gap → SuggestedPositionRefs
   必须直接消费 ResearchNeedService.list() 已有的 suggestedPositionRefs
   Phase 2 不重新计算 Gap → Position 关系
   Coverage 只对"已经确定的 Position"计算：activeRequirementRefs / allRequirementRefs
   ★ 不得使用"行业全部 Position"作为 Gap 的 fallback
```

即唯一链路：

```text
ResearchNeedService.list()
        │
        ├── Gap（gapId / gapType / status）
        ├── Priority（score / policyVersionId）
        ├── whyStudyNotJustFetch（闭集枚举，透传）
        └── suggestedPositionRefs ──► Position Coverage（active / all，来自共享 resolver）
```

- 若实现中需要 `PositionsForGap(G)` 这样的名字，它只能是 `suggestedPositionRefs` 的**别名**，**不是**一次新的 `Requirement ∩ Position` 计算；
- ★ 与 I-C2-24 一致：`Gap → Position` 已有既有 projection（`ResearchNeedService`），**Plan 不得重算**。

---

## 2. 现状核查（Phase 1 之后的真实增量）

证据均为 `file:line`（基线 `8029f52`）。

| # | 现状 | Phase 2 |
|---|---|---|
| 1 | `ResearchPosition` 无 `allRequirementRefs` / `activeRequirementRefs`（全仓 grep 零命中）；`satisfiesRequirementRefs` 由 `chain-projection-service.ts:39-41` 生成（按模板维度取**全部** requirement，不读 Gap） | 改（view 层派生） |
| 2 | CLI `research chain` 只有 `服务问题数：N`（`research-format.ts:201`）；Agent `research_chain_show` 只有 `servesRequirementCount`（`research-tools.ts:485`） | 改（+ active） |
| 3 | `Target.relatedRequirementRefs` 列 / 持久化 / `add` 入参齐备（`research-target.ts:47`、`research-repository.ts:676/1072`、`target-service.ts:33/85`），但**无写者、无读者、无 CLI 参数**（grep `for-gap\|forGap` 零命中） | 改（唯一写入口） |
| 4 | `target list` 显示位置 + `FitSummary`（`research-format.ts` 的 `formatTargetWithFitHuman`），**不显示** requirement 关联 | 改（+ 关联展示） |
| 5 | 无 `research plan`：`RESEARCH_SUBCOMMANDS`（`research-commands.ts:14-22`）= evaluate / pool / priority / report / chain / need / diligence | 改（新只读出口） |
| 6 | 无 `research_plan_show`：Agent 工具 18 个（`research-tools.ts`） | 改（第 19 个，只读） |
| 7 | Plan 的原料**已全部存在**：`ResearchNeedService.list()`（`research-need-service.ts:19-55`，含 `suggestedPositionRefs`）/ `FitSummary`（`question-target-fit.ts`）/ `DiligencePreparationService.list()` + Phase 1 的 `currentPreparationView()` / `NextAction`（`next-action.ts`）+ `refreshNextActions`（`knowledge-projection-service.ts:712`）/ `ResearchState`（`research-state.ts`）+ `refreshState`（`:589`） | 只投影 |
| 8 | `GapStatus = "open" \| "mitigating" \| "resolved" \| "accepted"`（`research-gap.ts:17`）；**`reopened` 不是状态值**，而是 `refreshGaps` 把退化 slot 对应的 resolved gap 重新写回 `open`（`knowledge-projection-service.ts:680`，同一 `gapId`、`discoveredAt` 保留） | 措辞统一 |
| 9 | `Target.targetRef = tgt-<industryId>-<slug(subjectKey)>`（`research-target.ts`，`slugSubjectKey`）—— 既有 B2 identity | **冻结，不改** |
| 10 | 仓库另有 legacy `plans` 子系统：`src/invest-extension.ts`（Pi 扩展，含 LLM 路径）、`src/server.ts`（HTTP `/api/plans`）、`src/store.ts`（`plans.json`）；均在 `tsconfig.json` 的 include 内，**无测试引用**，与 research core 无代码引用 | **隔离** |
| 11 | **active 判定当前分散在两处**：`research-need-service.ts:27`（gap → requirement）与 `question-target-fit-service.ts:68-77`（Phase 1 的私有 `activeRequirements`） | **收敛为共享 resolver**（§4.1） |
| 12 | 真实库共 **24 张表**（`research-db.ts` 的 `CREATE TABLE` 清单，见 §7.3）；Knowledge 三表为 `industry_knowledge` / `knowledge_belief` / `knowledge_conflict`；**Priority 无独立表**（由 gap + methodology 派生） | fingerprint 具名化 |

---

## 3. 红线（Phase 2 一律不做）

1. **不新增表**：`ResearchPlanView` 是纯 read model（不做 `research_plan_snapshot`）。
2. **不改 C1 / 不改 Gap / Pool / Priority / State / Report 的既有规则**：Phase 2 只读它们。
3. **不给 Agent 写权限**：`--for-gap` 是 CLI 参数；Agent 侧新增能力全部只读。
4. **不引入 LLM / 外部数据 / web / 自动研究**。
5. ★ **legacy plans isolation**：

```text
research plan  ≠  legacy `plans` subsystem
research plan  =  Research Core 只读 read model
               =  CLI + Agent
               =  deterministic
               =  no LLM
               =  no plans.json
               =  no src/server.ts
               =  no src/store.ts
               =  no src/invest-extension.ts
```

禁止任何「研究状态 → HTTP plans → plans.json」的旁路。

6. **不改 Target identity**：`slugSubjectKey` / `targetRef` 规则冻结（I-C2-15）。
7. **不改 Position 本体**：coverage 只存在于 view；不写回、不改 `positionRef`。
8. **`--for-gap` 不得修改 Gap**（零 mutation），也不得自动改 `Gap.status`。
9. **`reopened` 只是生命周期事件**，不得成为 `GapStatus` 的取值或新状态。
10. **不把 placeholder 包装成已实现**（`Company` 仍为 identity-only，见 §8）。
11. **不写「为测试而写死」的实现**：测试必须证明真实不变量（行为 / 全状态指纹），不是「测试全绿」本身。
12. ★ **Plan 路径零 mutation**：`research plan` / `research_plan_show` 及其 builder **不得**调用任何 `refresh*` / `sync*` / `upsert*` / `create*` / `resolve*` 等会改变持久化状态的路径；**不得**为了「显示最新」而触发状态重算。

```text
允许：read repository + read services + build view
禁止：show → refreshGaps()/refreshState()/refreshNextActions()/syncRequirementStatus() → read
```

若已有 `ResearchState` / `NextAction` 是 stale：**照实展示既有状态，不在展示路径修复状态**。

13. ★ **不得创建新的 Gap → Target 关系**：Target 归属只能是 §1.4 的 Requirement 交集派生（见 I-C2-23）。
14. ★ **（rev3）不得重算 Gap → Position**：只能消费 `ResearchNeedService.list().suggestedPositionRefs`；不得用行业全量 Position 兜底（见 I-C2-25）。

---

## 4. 改动草案

### 4.1 Coverage Closure（Position 只读派生 + 单一 active resolver）

- **`ResearchPosition` 本体不变**（不加列、不写回）。
- 新增**只读派生**（命名与 `c2-implementation-contract.md` §4.1 一致）：
  - `allRequirementRefs` ≡ `satisfiesRequirementRefs`（别名）；
  - `activeRequirementRefs` ≡ `allRequirementRefs ∩`（共享 resolver 给出的 active set）。
- ★ **单一共享 resolver（I-C2-13）**：Phase 2 必须把「当前哪些 Requirement 仍需研究」的判定**收敛为一个可复用的窄接口**：

```text
        Gap[]  +  Requirement[]
                 ↓
      ActiveRequirementResolver          ← 唯一实现（职责极窄）
                 ↓
        activeRequirementRefs
                 ↓
    ┌────────────┼────────────┬──────────────┐
    ▼            ▼            ▼              ▼
  Need          Fit        Coverage        Plan
```

  - 上述四处**必须共同调用该实现**；**不得**复制相同状态判断；
  - **职责边界（写死）**：resolver **只**回答「active requirement refs」；**不**负责 priority / position / target / fit / preparation / plan；
  - **禁止**造「万能 service」，也禁止在 resolver 里顺带做别的派生；
  - 放置位置与命名以定稿为准，但**单一实现**是硬约束；
  - C2 **不重新定义**「哪些 Gap 状态属于 active」——口径仍是既有 Gap 语义（`open | mitigating`）。
- 展示：
  - CLI `research chain <行业>`：在既有 `服务问题数：N` 之后增加 `服务缺口：active N / all M`（最终措辞以定稿为准）；
  - Agent `research_chain_show`：**保留** `servesRequirementCount`（= all；`phase-b-b5-exposure.test.ts:102` 已依赖它），**新增** `activeRequirementCount`。不得改变既有字段语义。
- **不写回 Position**：`research chain` 前后 `research_position` 行指纹一致。

### 4.2 Gap → Requirement → Target Linkage

- CLI：`tiancha research target add <行业> ... [--for-gap <gapId>]...`（可重复）。
- 行为：

```text
--for-gap <gapId>
    ↓ 读 Gap（只读）
    ↓ 取 gap.relatedRequirementIds（既有定义，不重新解析）
    ↓ 并集写入 Target.relatedRequirementRefs（去重；顺序见下）
```

- ★ **原子性：以一次 `target add` 为边界（rev3 强化）**：

```text
一次 CLI add（含全部 --for-gap）  ≡  一次逻辑 mutation：
    ① 全部 Gap 校验（存在 / 属于该行业）        ← 任何失败都在此终止
    ② 全部 Requirement ref 派生（并集 + 顺序）
    ③ 唯一一次 Target 持久化
Target 持久化失败 ⇒ 不得留下部分集合更新
    · 既有 Target：保持原值（不出现"只写了一半的集合"）
    · 新 Target：完全不产生
若底层仓储支持事务，应以事务保证；不得通过多次独立 upsert 模拟原子操作。
```

- **禁止半成功状态**（不允许"前两个写进去、第三个报错"）。
- 校验项：gap 必须存在；gap 必须属于该行业（`gap.subjectId === industryId`）；`--for-gap` 可重复。
- ★ **空 `relatedRequirementIds` 的 Gap**：**合法**。该参数不增加任何 ref，但 Target **仍正常创建** —— 因为 `--for-gap` 是"读取 Gap 的关联入口"，不是"重新验证 Gap"；不得因某个 Gap 的数据暂时为空而阻止 Target 建立。
- ★ **deterministic 顺序（写死）**：

```text
起点：Target 既有 relatedRequirementRefs（新增对象为 []）
按 CLI 参数出现顺序处理每个 <gapId>
每个 Gap 内按 gap.relatedRequirementIds 的原有顺序追加
首次出现优先；重复 ref 保留第一次出现的位置
```

- ★ **唯一写入口（I-C2-14）**：Phase 2 中 `relatedRequirementRefs` 只能由 `--for-gap` 写入；不得由 plan / need / chain / fit / preparation 等任何路径写入。
- **Gap 零 mutation**：操作前后 `research_gap` 指纹（status / gapType / updatedAt）一致。
- 语义（写死）：这是 **Target → Requirement 的关联输入**，不是 Target → Gap 的 SoT 引用 —— **不存 `gapId`**，也不因 Gap 生命周期变化而失效。
- 不传 `--for-gap` ⇒ `relatedRequirementRefs` 保持既有值（新对象为 `[]`），**不强制**。
- 展示（`target list`）：增加「用于补哪些 Requirement」，形式为 **维度摘要 + ref**：

```text
用于补充 Requirement：
  • 客户验证（ir-xxxx）
  • 价格机制（ir-yyyy）
```

  ★ 摘要必须由 Requirement 的**既有字段确定性派生**；**不得** LLM 改写、不得臆造、不得润色领域语义。

### 4.3 Research Plan（read model）

- 新增**纯派生**投影（application 层一个 builder / service；命名以定稿为准，候选 `ResearchPlanService`）。
- **必须包含的语义格**（字段名以定稿为准）：

| 语义格 | 只读来源（**不得重算**） |
|---|---|
| 行业标识（ref / name） | `Industry` |
| Current State（version / known / confirmed / uncertain / conflicting / unknown / keyQuestion 计数） | `ResearchState`（`repo.getStateBySubject`，**不调用 `refreshState()`**） |
| Open Gaps（`gapType` / `status` / Priority 分数 + 策略版本） | `ResearchNeedService.list()`（= gap(open\|mitigating) + Priority 结果） |
| 每个 Gap「为什么需要调研而不是抓数据」 | `whyStudyNotJustFetch` —— ★ **仅透传**：不解释、不重新判断、不根据 `gapType` / `priority` / requirement 自行推导 |
| Suggested Positions（含覆盖 `active N / all M`） | ★ 直接消费 `ResearchNeedService.list().suggestedPositionRefs`（§1.5）；Position 的 active/all 由共享 resolver 计算；**不得**重算 Gap→Position，**不得**用行业全量 Position 兜底 |
| **Per-Gap Targets**（由 Requirement 交集派生） | §1.4 派生规则（**不新增 Gap→Target 关系**） |
| 行业级 Targets（三分见 §4.3.1） | `TargetService.list(industryId)` + §1.4 交集判定 |
| Fit warnings（强 / 部分 / 弱 / 无 + 需备选对象） | `QuestionTargetFitService.summarize()`（`FitSummary`） |
| Preparation status（`current` / 历史问题计数） | `DiligencePreparationService.list()` + Phase 1 的 `currentPreparationView()`（**不得自行判断 `state`**） |
| Next Actions（kind / priority / rationale / gapId） | `repo.listNextActions()`（**不调用 `refreshNextActions()`**） |
| 无 Target 的正常态提示 | 派生文案（见 I-C2-19） |

- ★ **只消费既有 service / projection，不得重算既有派生（I-C2-17 / I-C2-24）**：
  - Priority：**直接消费 `ResearchNeedService.list()` 的结果**；**不得**在 plan 里再调用 `PriorityService`；
  - `active`：直接消费共享 resolver（§4.1）；
  - `Gap → Position`：直接消费 `suggestedPositionRefs`（§1.5）；
  - `whyStudyNotJustFetch`：**仅透传**；
  - fit / preparation / nextAction / state：一律消费既有 service 或 repository 行。
- ★ **无「未生成」状态（I-C2-19）**：

```text
industry exists
      ↓
plan always renderable      （0 Gap / 0 Target / 0 Preparation 都是正常输出）
      ↓
只有 industry not found 才是错误
```

  - CLI 与 Agent **都直接返回当前 projection**；
  - **不得**出现「plan 尚未生成，请先执行 CLI」之类的提示。
- **出口（两个出口读同一 builder）**：
  - CLI：`tiancha research plan <行业> [--json]`；
  - Agent：`research_plan_show({ name })` —— **只读**、**无「未生成」分支**。
- ★ **纯投影（I-C2-17）+ 零 mutation（I-C2-22）**：调用前后**全库指纹**完全一致（清单见 §7.3）。
- **无 identity / 不落表**。
- ★ **无 Target 是正常态（I-C2-19）**：必须呈现 `已确认对象：0` + 「下一步：请研究者选择并录入对象（`tiancha research target add …`）」，不得视为异常、不得隐藏该位置。
- **不选 winner、不生成公司 / 专家 / 机构名（I-C2-21）**。

### 4.3.1 ★ Target 在 Plan 中的归属与展示集合（rev4 纠正措辞）

★ **互斥且完备的是 `associationStatus` 三态**（每个 Target 恰好一个状态），**不是**"三个集合"：

```text
associationStatus（三态互斥且完备）

mapped
  = 存在至少一个 Open Gap G，使得
      T.relatedRequirementRefs ∩ G.relatedRequirementIds ≠ ∅

unlinked
  = T.relatedRequirementRefs = []

non_currently_mapped
  = T.relatedRequirementRefs ≠ []
    且与当前所有 Open Gap 的 relatedRequirementIds 均无交集
    （典型成因：它关联的 Requirement 对应的 Gap 已 resolved）
```

由三态派生的两个展示层：

```text
Per-Gap Targets(G)
  = { T | T.relatedRequirementRefs ∩ G.relatedRequirementIds ≠ ∅ }
  ★ mapped Target 可以在多个 Per-Gap Targets(G) 中重复出现 ——
    这不是重复数据，而是"不同 Gap 下的合法派生归属"（T-C2-39②）

Industry-level Targets
  = { T | associationStatus ∈ { unlinked, non_currently_mapped } }
      ├── A. Unlinked             （refs 为空）
      └── B. Non-currently-mapped （refs 非空，但当前无 Open Gap 匹配）
```

- ★ **禁止**：
  - 隐藏 B 类 Target（用户已确认的对象不得因为 Gap 收敛而从计划中"消失"）；
  - 把 B 类强行塞进某个 Gap；
  - 把 B 类当作 A 类（`unlinked` 与 `non_currently_mapped` 语义不同，不得合并）；
  - 为了"唯一归属"对 `mapped` Target 去重或截断（跨 Gap 重复是**合法**的）。
- ★ **这只是 Plan View 的派生展示**：不是新业务对象、不落库、不新增字段、不新增 Gap→Target 关系。
- 理由（写进契约）：这直接对应长期知识演化 —— "对象还在，只是当前没有未解决的缺口要问它"是**正常状态**。

### 4.3.2 ★ deterministic ordering（rev4 纠正歧义）

`ResearchPlanView` 的**每个集合**都必须有确定顺序。规则是 **"既有稳定顺序优先；来源没有稳定顺序时才用 ref asc 兜底"**：

```text
Gaps        : priority desc  → gapId asc
Requirements: ★ 保留 gap.relatedRequirementIds 的原有顺序 —— 不按 requirementId 重排
Positions   : ★ 保留 suggestedPositionRefs 的原有顺序 —— 不按 positionRef 重排
Targets     : targetRef asc                       （Per-Gap 与行业级同规则）
NextActions : priority desc  → actionId asc
Preparation : preparationRef asc

仅当某来源本身没有稳定顺序时，才使用 requirementId / positionRef / targetRef asc
作为 deterministic fallback。
```

- "既有稳定顺序"指 `gap.relatedRequirementIds`（Gap 自身保存的数组顺序）、`suggestedPositionRefs`（`ResearchNeedService` 产出的数组顺序）等 —— **不得无意义重排**；
- 同分（如两个 Gap priority 相同、两个 NextAction 同分）不得依赖插入顺序或 Map 迭代顺序 ⇒ 必须有 tie-breaker（上表的 `gapId asc` / `actionId asc` / `targetRef asc`）；
- ★ **一致性口径（rev4 纠正）**：CLI `--json` 与 Agent 返回的是**同一个 `ResearchPlanView`** —— **字段值与数组顺序一致**；**CLI human output 只是该 View 的确定性格式化**（不另造数据、不做语义重排）。**不要求** Agent 返回 CLI 的纯文本。

### 4.4 与 Phase 1 的接口

- plan 复用 Phase 1 的 `currentQuestions()` / `currentPreparationView()`；**禁止**在任何 plan 路径自行写 `q.state === "current"` 判断，或把 `questions.length` 当 current 计数（I-C2-12 继续生效）。
- `--all` 语义不变（plan 使用**默认 active 口径**；`--all` 仍是 `diligence` 的显式审计模式）。

---

## 5. Identity / 幂等

| 对象 | identity | Phase 2 是否改 |
|---|---|---|
| Position | `pos-<industryId>-<templateId>-<chainVersion>-<positionKey>`（既有） | **不改**（本体不收敛） |
| Target | `tgt-<industryId>-<slug(subjectKey)>`（既有，`slugSubjectKey`） | **不改**（见 I-C2-15） |
| `Target.relatedRequirementRefs` | 无独立 identity（集合属性） | 新增**唯一写入口**；集合幂等；**顺序 deterministic**（§4.2） |
| `ActiveRequirementResolver` | **无 identity**（纯派生，不落库） | 新增（唯一 active 口径） |
| `TargetsForGap(G)` / `PositionsForGap(G)` | **无 identity**（纯派生视图，不落库） | 新增（§1.4 / §1.5） |
| `ResearchPlanView` | **无 identity**（纯派生，不落库） | — |
| `associationStatus` | **无 identity**（view 字段，不落库） | 新增（§4.3.1） |
| `DiligenceQuestion` | `dq-<preparationRef>-<source>-<canonicalRef>`（Phase 1 冻结） | **不改**（plan 只读） |

幂等声明：
- `--for-gap` 为集合语义 + deterministic 顺序 ⇒ 重复执行产出**完全相同**的 `relatedRequirementRefs`；
- `research plan` 无副作用 ⇒ 重复执行产出**完全相同**的 view（含数组顺序；除既有时间戳字段外）。

---

## 6. 不变量（I-C2-13 … I-C2-27）

| # | 不变量 |
|---|---|
| **I-C2-13** | ★ `active`（「当前仍需研究」）只有**一处共享实现**（窄职责 resolver）；need / fit / coverage / plan 共用它；**禁止复制**同一状态判断；禁止自造第二套 Gap 状态机；resolver 不得膨胀为万能 service |
| **I-C2-14** | ★ `--for-gap` 是 `relatedRequirementRefs` 的**唯一写入口**；**Gap 零 mutation**；不存 `gapId`；**一次 `target add` = 一次逻辑 mutation**（全部校验 → 全部派生 → 唯一一次持久化；持久化失败不留部分集合更新；不得用多次独立 upsert 模拟原子） |
| **I-C2-15** | ★ Target identity 冻结：`slugSubjectKey` / `targetRef` 规则不得修改（B2 红线） |
| **I-C2-16** | ★ **Position 本体不收敛**：`positionRef` / `satisfiesRequirementRefs` 不随 Gap 生命周期变化；coverage 只在 view |
| **I-C2-17** | ★ **Plan 是纯 projection**：调用前后**全库指纹**一致；CLI 与 Agent **读取同一个 builder**；只消费既有 service / projection，**不重算**既有派生 |
| **I-C2-18** | ★ Plan **不引入** LLM / 外部数据 / 新表 / HTTP / legacy `plans` 子系统 |
| **I-C2-19** | ★ **无 Target / 无 Preparation / 无 Gap 都是正常态**：必须自然呈现 + 明确「下一步」；★ **`ResearchPlanView` 不存在「未生成」状态 —— 只要 Industry 存在即可确定性投影**（只有 industry not found 才是错误） |
| **I-C2-20** | ★ **`reopened` 只是生命周期事件**：`GapStatus` 仍只有 `open \| mitigating \| resolved \| accepted` |
| **I-C2-21** | ★ Plan **不生成**公司 / 专家 / 机构名，也不把「推荐位置」伪装成「推荐企业」（I-C2-8 的延伸） |
| **I-C2-22** | ★ **Plan 路径零 mutation**：不得调用任何 `refresh*` / `sync*` / `upsert*` / `create*` / `resolve*`；不得为展示而触发状态重算；stale 照实展示 |
| **I-C2-23** | ★ **Target 归属只由 Requirement 交集派生**（§1.4）；**不得创建新的 Gap → Target 关系**；一个 Target 可归属多个 Gap |
| **I-C2-24** | ★ **Plan 不重算既有派生**：priority（消费 `ResearchNeedService.list()`）、active（消费 resolver）、**Gap→Position（消费 `suggestedPositionRefs`）**、fit、preparation current/history、nextAction、state 一律消费既有结果；**`whyStudyNotJustFetch` 仅透传**（不解释 / 不重判 / 不推导） |
| **I-C2-25** | ★（rev3）**Gap → Position 的唯一来源**是 `ResearchNeedService.list().suggestedPositionRefs`；Phase 2 不重算该关系；**不得**用行业全量 Position 作为 Gap 的 fallback |
| **I-C2-26** | ★（rev4 纠正）**互斥完备的是 `associationStatus` 三态**（`mapped` / `unlinked` / `non_currently_mapped`，定义见 §4.3.1）；`Per-Gap Targets` 是**允许同一 Target 跨 Gap 重复出现**的派生集合族（不得为"唯一归属"去重或截断）；`Industry-level Targets = { unlinked ∪ non_currently_mapped }`；B 类不得被隐藏、不得被强塞进某个 Gap、不得与 A 类混淆 |
| **I-C2-27** | ★（rev4 纠正）**排序契约**：`ResearchPlanView` 每个集合都有确定顺序（§4.3.2）；**既有稳定顺序优先**（`relatedRequirementIds` / `suggestedPositionRefs` 不按 ref 重排），ref asc 仅作无稳定顺序时的 fallback；同分必须有 tie-breaker；**CLI `--json` 与 Agent 返回同一 View**（字段值与数组顺序一致），CLI human 只是该 View 的确定性格式化 |

（`I-C2-1 … I-C2-12` 由 `docs/phaseC/c2-implementation-contract.md` §6 定义，本阶段全部继续生效。）

---

## 7. 验收测试

### 7.1 先执行既有（Phase 1 未执行的对应项）

`T-C2-4`（`--for-gap` 建立关联）、`T-C2-5`（Gap 零 mutation）、`T-C2-6`（plan 纯只读 → **升级为全库指纹**，见 §7.3）、`T-C2-9`（无 Target 正常态）、`T-C2-10`（`positionRef` 稳定）、`T-C2-13`（Agent 工具只读）、`T-C2-15`（不生成公司名）。

### 7.2 新增（编号延续 `T-C2-26 …`）

| # | 场景 | 必须证明 |
|---|---|---|
| T-C2-26 | normal | **逐格**来源正确：Industry / State / Gap / Priority / Requirement / Position / Target / Fit / Preparation / NextAction 分别由 §4.3 指定来源产出；且 `active ≤ all`。**并断言没有重算**：Priority 与 `ResearchNeedService.list()` 同值、active 与 resolver 一致、`suggestedPositionRefs` 逐字相同、fit / preparation / nextAction 与既有 service 输出一致 |
| T-C2-27 | zero-gap | 全部 gap resolved ⇒ plan 显示「无开放缺口」；**不得 fallback 到行业全量 Position**；Position 覆盖显示 `active 0 / all M`；**已确认 Target 仍出现在行业级区**（见 T-C2-39） |
| T-C2-28 | multiple-gap | 每个 Gap 的 Requirement / Suggested Position（来自 `suggestedPositionRefs`）/ Per-Gap Target 集合**分别派生**，禁止跨 Gap 串线；未关联 Requirement 的 Target 不得被强行归属 |
| T-C2-29 | reopened / re-degraded | gap resolved → slot 退化 ⇒ 同一 `gapId` 回到 `open`；plan 的 active 覆盖随之恢复；`positionRef` 与 Target identity **不变** |
| T-C2-30 | no-target | Position 下 `已确认对象：0` + 明确「下一步」（T-C2-9 在投影层加强） |
| T-C2-31 | fallback-target | `isFallback=true` 的 Target 在 plan 中带「备选 / 降置信度、交叉验证」标记 |
| T-C2-32 | no-preparation | Target 存在但无 preparation ⇒ plan 显示「暂无调研准备 + 生成命令」，不报错 |
| T-C2-33 | CLI | `research plan <行业> [--json]` 输出稳定（含数组顺序）；**未知行业**报错且写零行（**唯一的错误态**） |
| T-C2-34 | Agent | `research_plan_show` **直接返回 projection**：0 Gap / 0 Target / 0 Preparation 时**正常返回**，**不得**出现「plan 未生成 / 请先执行 CLI」；调用前后**全库指纹一致**；不新增任何写能力 |
| T-C2-35 | projection consistency | **CLI `--json` 与 Agent 来自同一 builder / 同一 `ResearchPlanView`**：字段值与数组顺序一致；**CLI human 是该 View 的确定性格式化**（不另造数据、不做语义重排）—— **不要求** Agent 输出 CLI 文本 |
| T-C2-36 | coverage consistency | `research chain` / `research_chain_show` 的 active / all 与 need / fit 的 active 口径**完全一致**（I-C2-13 的可验证形式） |
| T-C2-37 | linkage idempotence + order | 同一 `--for-gap` 重复执行 ⇒ `relatedRequirementRefs` **完全相同**；多参数顺序遵循 §4.2；Gap 行指纹不变 |
| T-C2-38 | legacy isolation | grep 断言：plan 路径不引用 `plans.json` / `server.ts` / `store.ts` / `invest-extension.ts`；无 LLM / HTTP |
| T-C2-39 | gap-target derivation（rev3 扩充） | ① `Gap A → R1`、`Gap B → R2`、`Target X → [R1]`、`Y → [R2]`、`Z → []` ⇒ Gap A 只带 X、Gap B 只带 Y；X 不在 Gap B、Y 不在 Gap A；Z 出现在行业级（`unlinked`）。② `T2 → [R1, R2]` ⇒ 两个 Gap 都带 T2（允许重复归属）。③ ★ **`T3 → [R5]`，而 R5 的 Gap 已 resolved** ⇒ T3 出现在行业级并标记 `non_currently_mapped`，**不被隐藏、不被归属任何 Gap** |
| T-C2-40 | atomic validation（rev3 扩充） | ① `--for-gap A --for-gap B --for-gap C`（C 不存在或属于其他行业）⇒ **整个 add 原子失败**：Target 未创建 / 未更新，`relatedRequirementRefs` 保持既有值。② ★ **持久化阶段失败**（可注入/桩化失败）⇒ 同样不留部分集合更新：既有 Target 保持原值、新 Target 不产生；**校验发生在任何持久化之前** |
| **T-C2-41** | **ordering determinism（rev3 新增）** | 构造同分场景（两个 Gap 同 priority、两个 NextAction 同 priority、两个 Target 同行业）⇒ 顺序由 §4.3.2 的 tie-breaker 决定（`gapId asc` / `actionId asc` / `targetRef asc`），**且重复调用结果逐字相同**；CLI 与 Agent 输出数组顺序一致 |

### 7.3 门禁

- 两处 `tsc`（root + research）exit 0；
- 全量测试（Phase 1 的 231 + 本阶段新增）全绿，且 C1 的 23 条保持全绿；
- `research smoke` PASS（child-session=real）；
- **全库指纹（T-C2-6 / T-C2-34 共用，rev3 具名化）**：`research plan` / `research_plan_show` 调用前后，以下**全部 24 张表**的行指纹必须完全一致（`ResearchDb` 的 `CREATE TABLE` 清单，基线 `8029f52`）：

```text
industry · company · research_question · information_requirement · research_gap ·
information_pool_entry · information_pool_slot · information_pool_item · research_state ·
research_source · research_document · next_action · methodology · methodology_candidate ·
human_gate · industry_knowledge · knowledge_belief · knowledge_conflict ·
investment_evaluation · report_snapshot · material · research_position · research_target ·
diligence_preparation
```

  - 分组对应：Industry=`industry`｜Company=`company`｜ResearchQuestion=`research_question`｜InformationRequirement=`information_requirement`｜ResearchPosition=`research_position`｜ResearchGap=`research_gap`｜Target=`research_target`｜Pool=`information_pool_item`+`information_pool_slot`（+`information_pool_entry`）｜Knowledge=`industry_knowledge`+`knowledge_belief`+`knowledge_conflict`｜Evaluation=`investment_evaluation`｜ResearchState=`research_state`｜NextAction=`next_action`｜Preparation=`diligence_preparation`；
  - ★ **Priority 无独立表**（由 `research_gap` + `methodology` 派生）⇒ 其稳定性由这两张表覆盖；
  - ★ **fingerprint 只用于证明「Plan 调用没有写入」，不代表 Plan 需要读取它们**：Plan Builder **不得**为了做指纹而依赖 Knowledge / Pool / Evaluation 等仓储（不得扩大耦合）。

- 真实库演练（备份 → 演练 → 恢复），给出前后指纹与 CLI 输出证据。

---

## 8. 明确不做（OUT）

```text
Company domain 完整化（Company service / CLI / 创建 / chainPosition 写入）
Chain domain 完整化（ChainNode / Supplier / Customer / Trader / ConsultingInstitution）
Target recommendation（系统推荐具体公司 / 专家 / 机构）
LLM extraction / LLM planning / LLM 生成调研方案 / LLM 改写 Requirement 摘要
Web search / 外部数据源接入
Research Experience domain
ResearchReport generation 深化（report 保持既有只读投影）
Evidence / Fragment / Knowledge extraction
KnowledgeConflict 解决 UI / 自动选 winner
Research execution / automatic research（自动去搜、自动联系、自动分析访谈录音）
新表 / 迁移
legacy `plans` 子系统的删除或标记（只隔离，不触碰 —— 见 §9 Q7）
```

**特别声明**：C2 的 "plan" 是**系统当前状态的确定性研究计划视图**，不是「LLM 自由发挥生成的一份调研方案」。不得因为出现 "plan" 这个词就引入 LLM planning。

---

## 9. Open Questions —— 已裁决

| # | 问题 | 裁决 |
|---|---|---|
| Q1 | plan 是否包含 `NextAction` / `ResearchState` | **YES** —— Plan **展示** State 与 NextAction；**不重新生成它们**（I-C2-24） |
| Q2 | `target list` 的 requirement 关联展示形式 | **YES** —— 维度摘要 + ref；摘要**必须由 Requirement 既有字段确定性派生**，禁止 LLM 改写 |
| Q3 | `--for-gap` 是否同时接线 `relatedQuestionRefs` | **NO** —— Phase 2 只建立 `Gap → Requirement → Target`；Requirement ↔ Question 关系属 DiligenceQuestion 体系 |
| Q4 | `research_chain_show` 新增字段 vs 改名字段 | **YES（新增）** —— 保留 `servesRequirementCount`（= all），新增 `activeRequirementCount`（= active） |
| Q5 | `research plan` 是否需要 `--target <targetRef>` 过滤 | **NO** —— plan 是行业级全局研究计划；Target 细节由 `diligence` / `target list` 承载 |
| Q6 | 测试编号延续 vs 新前缀 | **YES（延续）** —— 继续 `T-C2-26 …`（本版到 `T-C2-41`） |
| Q7 | legacy `plans` 子系统是否删除 / 标记 deprecated | **NO** —— 只隔离、不触碰；清理是独立工作 |

---

## 10. 与既有契约的关系

| 既有文件 | 本阶段的关系 |
|---|---|
| `docs/phaseC/c2-implementation-contract.md` | 本文件是其 §4.1 / §4.2 / §4.5 的实现契约细化；**不改该文件**（仅在定稿时按需加一行索引） |
| `docs/phaseC/implementation-contract.md` | §21 已是索引；Phase 2 收口时如范围变化再更新索引 |
| `docs/phaseB/implementation-contract.md` | 不涉及（B2 identity 冻结，见 I-C2-15） |

---

## 11. 定稿确认

- [x] rev2 的 7 项修订保留
- [x] rev3 的 🔴×4（§1.5 / §4.2 事务边界 / §4.3.1 三分 / §4.3.2 排序）+ 🟡×2（§4.3 透传 / §7.3 具名指纹）已落点
- [x] **rev4 的 2 处硬伤 + 1 处格式歧义已纠正**（§4.3.1 三态互斥措辞 / §4.3.2 既有稳定顺序优先 / §4.3.2 一致性口径；I-C2-26 / I-C2-27 / T-C2-35 同步）
- [x] 不变量确认：`I-C2-13 … I-C2-27`
- [x] Q1–Q7 已裁决（§9）
- [x] 实施三闭环已确定（§12，含 Step 2-C 静态结构审计 checklist）
- [x] **未新增功能、未新增测试编号**（rev4 仅为文字收口）
- [x] 边界确认：本轮 **Final Contract Audit = PASS**（0 阻塞项 / 0 必须修改项）
- [x] 未实现声明：本文件写完前不写任何代码、不改任何既有契约文件（保持）
- [x] **实现阶段验收点**（记录用，**不新增任何规则**；Step 2-B / 2-C 独立复验时卡死）：
  - missing `ResearchState`：合法 Industry 但无持久化 State ⇒ **正常渲染**（state 明确表现为 unavailable / absent）；**不报 industry error、不 refresh、不伪造 0**（"没有 State" ≠ "State 的值为 0"）
  - Existing Target：`target add --for-gap` 只允许改变 `relatedRequirementRefs`；其余字段（`subjectKey` / `isFallback` / `fallbackForTargetRef` / `createdAt` …）必须保持原值
  - Empty Requirement Gap：`relatedRequirementIds = []` + `--for-gap` ⇒ 不增加任何 ref、Target 仍正常创建；随后 Plan 中 `associationStatus = unlinked`（**不是** `non_currently_mapped`）
  - static dependency audit 的执行范围：按 §12 Step 2-C checklist 逐条执行

---

## 12. 实施三闭环（rev3 新增，正式确定）

一次只授权一个闭环；每步含 **实现 → 测试 → 独立复验**。

### Step 2-A — Coverage Closure

```text
ActiveRequirementResolver
        ↓
Need / Fit / Position Coverage / Plan consumption interface
```

交付：`allRequirementRefs`、`activeRequirementRefs`、`research chain` 的 `active/all`、`research_chain_show` 的 `active/all`。
测试：`T-C2-26`、`T-C2-27`、`T-C2-29`、`T-C2-36` + Phase 1 回归。
实施审计重点：`grep -n 'open\|mitigating'` —— `gap.status === "open" || gap.status === "mitigating"` 只能出现在 resolver 内部，不得散落四处。

### Step 2-B — Target Linkage Closure

```text
--for-gap → Gap → relatedRequirementIds → Target.relatedRequirementRefs
+ target list 展示
```

测试：`T-C2-4`、`T-C2-5`、`T-C2-37`、`T-C2-39`、`T-C2-40`。
实施审计重点（矩阵）：**新 Target / 已有 Target / 多个 Gap / 空 Requirement 的 Gap / 非法 Gap / 跨行业 Gap / 重复参数 / 持久化失败**。

### Step 2-C — Research Plan Closure

```text
ResearchPlanBuilder ──┬── CLI `research plan`
                      └── Agent `research_plan_show`
```

测试：`T-C2-26 … T-C2-41` 全量 + full regression + child-session smoke + **全库指纹** + 真实库 backup/restore 演练。
实施审计重点：CLI 与 Agent **绝不能各自组一份**（必须同一个 builder）；Plan 路径零 mutation；无「未生成」分支。

独立复验的**静态结构审计 checklist**（不新增测试编号）：

```text
ResearchPlanBuilder：
  □ 不 import / 不 instantiate PriorityService        （priority 只来自 ResearchNeedService.list()）
  □ 不自实现 active predicate                          （只消费 ActiveRequirementResolver）
  □ 不自行计算 Gap → Position                          （只消费 suggestedPositionRefs）
  □ 不调用任何 refresh* / sync* / upsert* / create*     （零 mutation）
  □ 不做任何 LLM 调用 / 无外部依赖
```

---

**FINAL LOCK（rev4）** —— 本契约定稿冻结。后续流程：`commit docs only` → 不 push → 授权 Step 2-A → 再按 §12 一次只做一个闭环（实现 → 测试 → 独立复验）。
