# Tiancha Phase C · Step C2 — Implementation Contract

> **Gap-driven Research Planning**
>
> **状态：Final Lock（已并入 Q1–Q6 裁决 + 4 项语义收紧 + 3 个微型锁；待你最后一次 diff 审计）。**
> 本次变更**只改文档**：未写 `src/`、未改数据库、未跑 migration。
> 基线：`origin/main = 1761a0f`（**Phase B v1 FINAL PASS** + **Phase C Contract rev1–4** + **C1 FINAL PASS**）。
> 上游：`docs/phaseC/implementation-contract.md`（其 §21 已改为指向本文件的索引）、`docs/phaseB/implementation-contract.md`（B1–B5 已实现）。
> 本版已落实：**Q1–Q6 六项裁决** + **4 项语义收紧**（语义链 / current vs historical preparation / 无 Target 是正常态 / conflict 测试改写）+ **3 个微型锁**（identity canonicalization / identity collision guard / **I-C2-12** 计数只认 `current`）。

---

## 0. C2 是什么（一句话）

> **C2 = Gap-driven Research Planning：把 C1 已冻结的 Gap 语义，向下驱动"研究什么 → 研究谁 → 问什么"。**

它对应使用者工作流的第 **9–14** 步：

```text
9  根据当前信息缺口决定下一步研究什么
10 针对行业设计研究链条（上游/下游/核心企业/客户/贸易商/咨询/专家）
11 从产业链各环节选择调研对象
12 判断某对象为什么适合/不适合回答某些问题
13 无最佳对象时允许次优（显式标注 + 降低置信度 + 交叉验证）
14 生成针对性调研准备（目的/对象简介/行业提问/企业提问）
```

> **C2 不重做 B1–B5**（第 10–14 步的实现已在 Phase B 完成）。
> C2 解决的是：**这条链目前不被"缺口的当前状态"驱动** —— 缺口收敛后，链条与提纲不收敛（§2）。

---

## 1. 语义链（唯一真相方向）★ 修订点 1

```text
                 ┌──────────────┐
                 │   Knowledge  │   ← C1 冻结，C2 只读
                 └──────┬───────┘
                        ↓
                 ┌──────────────┐
                 │     Pool     │
                 └──────┬───────┘
                        ↓
                 ┌──────────────┐
                 │     Gap      │   「为什么需要研究」（驱动源）
                 └──────┬───────┘
                        ↓
              current open / reopened / conflict gaps
                        ↓
                 ┌──────────────┐
                 │ Requirement  │   「需要补什么信息」（语义单位）
                 └──────┬───────┘
                        ↓
              ┌─────────────────────────┐
              │ Research Position/Chain │   「从产业链哪个位置获取」（模板实例）
              └───────────┬─────────────┘
                          ↓
                    Human-confirmed
                       Target            「由谁 / 什么对象来补」（人确认）
                          ↓
                    Question / Fit        「这个对象适不适合回答这个 Requirement」
                          ↓
                 Diligence Preparation    「问什么」（current projection）
```

**四个对象各自回答什么（必须锁死，不得互相替代）**

| 对象 | 回答 | 性质 |
|---|---|---|
| **Gap** | 「**为什么**需要研究」（缺口为何存在、何种类型：unknown / insufficient / conflict） | 当前信息状态 |
| **Requirement** | 「**需要补什么信息**」（维度 + 确认条件） | 语义单位（方法论派生） |
| **Position** | 「**从产业链哪个位置**获取这类信息」 | 模板实例（**非**客观链条） |
| **Target** | 「**由谁/什么对象**来补这个信息」 | **Human-confirmed subject** |
| **Question / Fit** | 「这个对象**适不适合**回答这个 Requirement」 | 规则判定（可重算） |
| **Preparation** | 「**当前**问什么（+ 历史问过什么）」 | 派生视图 + 追加式历史 |

**两条不同方向的关系（★ 修订点 1 的核心）**

```text
Gap → Requirement → Target            ← 驱动方向（C2 的唯一 SoT 方向）
Target → relatedRequirementRefs        ← 关联方向（输入标签，【不是】SoT）
```

> `relatedRequirementRefs` 表达的是 **Target → Requirement** 的关联，
> **不是** `Target → Gap` 的引用，**也不得**被用来反推 / 改写 Gap
> （Gap 的唯一真相来自 Pool 状态，属 C1 冻结范围）。

**禁止的反向语义**：`Target → Gap 写回`、`Position → Gap`、`Preparation → Gap`、`Plan → 任何 SoT`。

---

## 2. 现状核查（C2 的真实增量）

| # | 现状（证据） | 问题 |
|---|---|---|
| 1 | `ResearchNeedService.list()`：只取 `gap.status === open \| mitigating` 的 gap | ✅ 已与 Gap 状态挂钩（C2 不改） |
| 2 | `ChainProjectionService.project()`：`ChainTemplate.dimensionKeys × 全部 Requirement` → `satisfiesRequirementRefs` | ❌ **不读 Gap**：位置服务"所有 requirement"，无论缺口是否已解决 |
| 3 | `TargetService.add()`：`relatedRequirementRefs` 默认 `[]`，CLI 无对应参数 | ❌ Target 与 Requirement/Gap **无关联** |
| 4 | `QuestionTargetFitService.fitAll()`：遍历**全部** `repo.listRequirements(industryId)` | ❌ 对已满足的维度也算 fit |
| 5 | `DiligencePreparationService.prepare()`：`common` 来自**全部 requirement**；同一 `dp-<targetRef>` **整行 upsert** | ❌ 缺口收敛后提纲不收敛；**重算会覆盖历史问题** |
| 6 | C1 之后 `gap` 首次具备真实生命周期（open / resolved / **reopened** / `gap_type`） | ✅ 这是"让 10–14 随认知演化"的**前提** |

> **C2 的核心增量（一句话）**：把"**当前开放的 Gap（含 reopened 与 conflict）所对应的 Requirement**"作为
> `Position 覆盖 → Target 关联 → Fit 范围 → Outline` 的**驱动输入**，并保证幂等、可溯源、可留史、不反向写。
>
> **C2 的可见承诺**：
> ① **缺口收敛 ⇒ 当前调研准备收敛**；
> ② **缺口重新打开 ⇒ 问题重新回到 current（同一 preparationRef，幂等）**；
> ③ **历史问题永不删除**（"第一次访谈问了什么"永远可查）。

---

## 3. 红线（C2 一律不做）

1. **不修改 C1 已冻结的 Knowledge 语义**（`Knowledge / Belief / Conflict / Evolution / Human Gate`）；C2 **只读** Knowledge。
2. **不改 Pool / Gap / Priority / State / Report 的既有规则**（含 Sufficiency Policy、`gap_type` 映射、Priority 因子与排序）。
3. **不重做 B1–B5**（Chain / Target / Fit / Outline 已实现）；C2 只做"接线 + 收敛 + 留史"。
4. **不引入 LLM / 外部数据 / Company Discovery**。
5. **不给 Agent 写权限**（Target 仍 CLI-only；Agent 新能力全部只读）。
6. **不新增表**（`research plan` 是纯 read model；见 §5）。
7. **不解决冲突、不选 winner**；conflict 只体现为"需要额外研究 / 交叉验证"。
8. ★ **不得把"推荐位置"伪装成"推荐企业"**（见 I-C2-8）。
9. **不碰** Phase B/C1 的 6 项独立遗留（uuid gap / 重复 market slot / relation-hint 类型 / CLI confirmation / `criticality` gate / `UNIQUE`）。

---

## 4. 改动草案

### 4.1 Position：**本体不收敛**，只派生 coverage（Q4）

- **`ResearchPosition` 本体不变**（`satisfiesRequirementRefs` 保持稳定、`positionRef` 绝不随 Gap 生命周期消失）。
- 新增**只读派生**（命名已裁决）：
  - `allRequirementRefs` ≡ 既有 `satisfiesRequirementRefs`（该位置**能力上**服务哪些 requirement，稳定）
  - `activeRequirementRefs` ≡ `allRequirementRefs ∩ 当前"仍需研究"的 requirement`

```text
active ≠ confirmed / sufficient
activeRequirementRefs = allRequirementRefs ∩ current research-needed requirements
```

- ★ **C2 不重新定义"哪些 Gap 状态属于 active"**：C2 **只消费**既有 Gap lifecycle / Requirement 语义
  （现有实现口径：`gap.status ∈ { open, mitigating }` 视为仍需研究；具体口径以既有 Gap 语义为准）。
  **禁止**在 C2 里造第二套 Gap 状态机（I-C2-2 的直接推论）。
- `tiancha research chain <行业>` 增加一行：`服务缺口：active N / all M`。
- **不写回 Position**（派生只存在于 view）。

### 4.2 Target：`--for-gap` 建立 **Target → Requirement 关联**（Q3）

- CLI：`tiancha research target add ... [--for-gap <gapId>]...` ⇒ 把该 gap 的 `relatedRequirementIds` 写入既有的
  `relatedRequirementRefs`（**用现有列，无 schema 改动**）。
- 校验：gap 必须存在且属于该行业；**Gap 行零 mutation**（只读）。
- **可选**（不强制，保持 B2 的录入自由度）；`target list` 展示"用于补哪些 Requirement"。
- **语义澄清（写死）**：这是 Target → Requirement 的**关联输入**，不是 Target → Gap 的 SoT 引用。

### 4.3 Fit / Outline：**缺口驱动**（核心承诺）+ `--all` 硬约束（Q2）

- `QuestionTargetFitService.fitAll(targetRef)`：范围从"全部 requirement"改为"**`active` requirement**"。
- `DiligencePreparationService.prepare(targetRef)`：
  - `common` 问题**只覆盖 active requirement**；
  - `currentUnderstanding` 增一项"已收敛缺口数"（只读投影，不臆造）；
  - `risks` / `requestedMaterials` 仍为 `[]`（无真实来源不臆造 —— 维持 Phase B 债务）。
- `tiancha research diligence ... [--all]`：
  - **默认**：active 范围（生产路径）；
  - **`--all`**：显式审计模式（"该 Target 对全部 Requirement 的理论适配"）；
  - ★ **硬约束（I-C2-9）**：`--all` **不得**成为生产路径的隐式 fallback
    —— **active 为空时就是空/收敛态，绝不自动退回全量**。

### 4.4 current vs historical preparation（★ 修订点 2）

**问题**：现状 `diligence_preparation` 以 `preparation_ref = dp-<targetRef>` 为主键并**整行 upsert** ⇒ 重算会**覆盖**旧问题，历史调研准备丢失。

**C2 的冻结方案（不新增表）**：

```text
DiligencePreparation（一行，preparationRef = dp-<targetRef> 不变）
  ├── questions[]  = 【全部】问题（current + retired 都在里面，永不删除）
  └── 每条 DiligenceQuestion 增加：
        state        : "current" | "retired"     ← 新增字段（JSON 内）
        firstAskedAt : string                    ← 首次生成时间，重算不变
        retiredAt?   : string                    ← 退出 current 的时间
```

- **重算规则**：
  - 为每条 `active` requirement 生成/复用问题（按确定性 `questionRef`，见 §5）；
  - 已存在 ⇒ **保留**（不重复插入，`firstAskedAt` 不变）；
  - 不再属于 active ⇒ `state = "retired"` + `retiredAt`（**不删除**）；
  - `reopened` ⇒ 同一 `questionRef` 重新变回 `state = "current"`（**不新建行**）。
- **current projection** ≡ `questions.filter(q => q.state === "current")`（"当前还需要问什么"）。
- **historical** ≡ `questions.filter(q => q.state === "retired")`（"过去曾经问过什么"，永不丢失）。
- CLI/Agent 默认展示 current，并显示 `历史问题 N（已收敛）`。

### 4.5 新入口（只读）：`research plan`（Q5：不加表）

- `tiancha research plan <行业> [--json]`：把链路串成一张**"下一步研究计划"** read model：

```text
开放缺口：3（按 Priority 排序）
├─ [gap-…-market] 市场规模与口径（conflict）
│    └─ 建议研究位置：咨询/研究机构（在链：consulting_research）
│         ├─ 已确认对象：1（含 1 个备选 → 需降低置信度、交叉验证）
│         └─ 调研准备：dp-…（current 6 / 历史 2）
├─ [gap-…-demand] 需求真实性（insufficient）
│    └─ 建议研究位置：下游头部客户（customer）
│         └─ 已确认对象：0   ← ★ 无 Target 是正常状态（修订点 3）
│              └─ 下一步：请研究者选择并录入对象（tiancha research target add …）
└─ …
```

- ★ **无 Target 必须能自然呈现**（`已确认对象：0` + 明确的"下一步"提示），**不得**视为异常或隐藏该位置。
- **纯派生 read model**：不落表、不写任何 SoT（前后指纹一致）。
- Agent 侧新增 **只读** 工具 `research_plan_show`（与 B5 四工具同治理：未生成时提示由研究者执行 CLI）。

---

## 5. Identity / 幂等（含对 B4 的一处修订）

| 对象 | identity | C2 是否改 |
|---|---|---|
| Gap / Requirement / Position / Target | `gap-*` / `ir-*` / `pos-*` / `tgt-*`（既有，确定性） | 不改 |
| **DiligencePreparation** | `dp-<targetRef>`（既有） | 不改（**同一行承载 current + history**） |
| **DiligenceQuestion** | ★ **修订**：B4 的 `dq-<preparationRef>-<n>`（序号）→ **确定性** `dq-<preparationRef>-<source>-<canonical ref>`（`source` 与 `canonical ref` 共同参与 identity，见下） | **改**（理由见下） |
| `research plan` | 无 identity（纯派生视图，不落库） | — |

**为什么必须改 question identity**：C2 要求"重算时**复用**既有问题、只退役不删除"。
序号式 `…-<n>` 在追加/退役后**无法稳定指向同一问题**（序号会漂移），会让 `retired → current` 的复活变得不可判定。
确定性 key 使 `(preparationRef, source, 来源 ref)` 恒等 ⇒ 复活即"同一条重新 current"。

**★ canonicalization 与 collision 规则（微型锁 1 / 2）**

```text
questionRef    = dq-<preparationRef>-<source>-<canonical ref>
canonical ref  = fromRequirementRef ?? fromFitRef        ← 稳定 ref 参与 identity（无损、原样）

若 fromRequirementRef 与 fromFitRef 同时存在：
    canonical ref 必须取 fromRequirementRef；source 保留既有枚举以表达来源语义
仅当 fromRequirementRef 缺失时：
    才允许使用 fromFitRef
（禁止实现者自行写成 fromFitRef ?? fromRequirementRef —— 那会造成 identity 漂移）
```

- **真正的 identity 必须由稳定 ref 决定；`canonical ref` 本身就是 identity 的稳定来源。**
  任何 display text / description / 自然语言 slug 都**不得**参与 identity。
  展示文本或它的 slug（`"Market Size"` / `"market size"` / `"市场规模"` / `"市场规模与口径"`）的变化
  **不得**产生新的 `questionRef`。
- 若为了可读性在 `questionRef` 里附带可读片段，**必须是无损 / 单射**的（例如原样 ref 或附短 hash）；
  **禁止**有损 slug（`[^A-Za-z0-9]+ → _` 这类映射会把 `ir-a-b` 与 `ir_a_b` 压成同一个 id）。
- 两个**不同** requirement 即使可读文本完全相同，也必须得到**不同**的 `questionRef`（T-C2-25）。
- `source` 取既有封闭枚举（`common` / `target_specific` / `fit_derived`），本身即稳定标识；
  三种来源在各自 (preparationRef, requirementRef) 下至多一条 ⇒ `(source, canonical key)` 唯一。

**兼容性**：
- 生产库基线**尚无** `diligence_preparation` 表/行（C1 的真实库核查已确认），因此**无需数据迁移**；
- 若未来遇到历史 `…-<n>` 行：**只退休、不重写 id**（与 C1 对 `beliefId` 的处理一致：历史 id 不批量改写）。

---

## 6. 不变量（I-C2-1 … I-C2-11）

| # | 不变量 |
|---|---|
| **I-C2-1** | C2 **只读** Knowledge / Belief / Conflict；任何 C2 路径都不得写 Knowledge（指纹可证） |
| **I-C2-2** | C2 不得改 Pool / Gap / Priority / State 的规则与状态（`--for-gap` 只读 gap） |
| **I-C2-3** | 每条 `DiligenceQuestion` 仍必须可溯源（`fromRequirementRef` 或 `fromFitRef` 非空，I-B5 保持） |
| **I-C2-4** | **缺口收敛 ⇒ current outline 收敛**：已 resolved 的 requirement 的 `common` 问题必须变为 `retired`，不得出现在 current |
| **I-C2-5** | **reopened ⇒ 问题复活**：同一 `questionRef` 从 `retired` 回到 `current`（**不新建问题**） |
| **I-C2-6** | ★ **current / historical 分离，历史永不删除**：`questions[]` 只追加与退役，**永不删除**；`firstAskedAt` 不变 |
| **I-C2-7** | `ResearchNeed` 仍只读派生（I-B6）；Target 仍必须人确认（B2 红线），`--for-gap` 只是关联输入 |
| **I-C2-8** | ★ **不得把"推荐位置"伪装成"推荐企业"**：系统只输出"位置 + 建议对象**类型**"与"已确认对象数"；**绝不**生成公司/专家/机构名 |
| **I-C2-9** | ★ `--all` 仅显式审计模式；**active 为空时不得隐式 fallback 到全量** |
| **I-C2-10** | ★ `research plan` 前后，Knowledge / Pool / Gap / Priority / Evaluation / State 指纹完全一致（纯派生） |
| **I-C2-11** | ★ **Position 本体不收敛**：`positionRef` 与 `satisfiesRequirementRefs` 不随 Gap 生命周期变化；收敛只发生在派生视图 |
| **I-C2-12** | ★ **`current` 一律只认 `state === "current"`**：**current outline / preparation 输出 / `research plan` / current fit coverage / 待研究问题列表 / 任何 summary、统计与计数** —— 全部**只允许**由 `questions.filter(q => q.state === "current")` 派生；**`retired` 永远不得参与**上述任何当前输出与计数（`questions.length` **不得**当作 current 计数） |

---

## 7. 验收测试（T-C2-1 … T-C2-25）

**核心语义**

| # | 断言 |
|---|---|
| **T-C2-1** | requirement 对应 gap 从 `open → resolved` 后，重新 `diligence` ⇒ 该 requirement 的 `common` 问题变为 **`retired`**（不出现在 current） |
| **T-C2-2** | gap `reopened` ⇒ 该问题**回到 current**，`questionRef` 不变、`firstAskedAt` 不变、**不新建问题** |
| **T-C2-3** | ★ conflict requirement ⇒ outline **明确标识**"该 Requirement 当前存在 unresolved conflict，需要额外研究 / 交叉验证"；**不得**自动关闭 conflict、**不得**选 winner、**不得**把"更换对象"写死为唯一动作 |
| **T-C2-4** | `target add --for-gap <gapId>` 正确建立 **Target → Requirement** 关联（写入 `relatedRequirementRefs`） |
| **T-C2-5** | 同上操作前后，**Gap 行零 mutation**（状态/类型/时间戳指纹一致） |
| **T-C2-6** | `research plan` 为纯只读：全 SoT 指纹不变 |
| **T-C2-7** | ★ **多 Gap → 多 Requirement 正确过滤**：R1(open) / R2(resolved) / R3(conflict) ⇒ current outline 恰含 R1、R3（**不是** `if (gapExists)` 式的假实现） |
| **T-C2-8** | ★ **混合场景**（open + resolved + reopened + conflict 同维度族）下 current/retired 划分正确 |
| **T-C2-9** | ★ **无 Target 是正常态**：`Position → 0 confirmed target` 必须出现在 `research plan`，并给出"下一步：请研究者选择对象" |
| **T-C2-10** | ★ `positionRef` 在 Gap 生命周期变化（含 resolved/reopened）后**保持稳定** |
| **T-C2-11** | `preparationRef` 稳定（`dp-<targetRef>`），但 **current question projection 收敛** |
| **T-C2-12** | ★ **历史问题不被删除**：`questions[]` 中 retired 项仍在，`firstAskedAt` 保持首次值 |
| **T-C2-24** | ★ **identity stability（微型锁 1）**：① 同一问题在 `current → retired → current` 全过程中 `questionRef` **恒等**，且 `firstAskedAt` **完全不变**；② **`fromRequirementRef` / `fromFitRef` 不变、而 display text / description / 可读文本发生变化时，`questionRef` 仍必须恒等** |
| **T-C2-25** | ★ **identity collision guard（微型锁 2）**：两个**不同** requirement（甚至可读文本相同 / slug 相同）必须得到**不同** `questionRef` —— 证明唯一性由**稳定 ref** 决定，而非自然语言 slug |

**越界 / 权限**

| # | 断言 |
|---|---|
| **T-C2-13** | Agent 的 `research_plan_show`（及其它 C2 工具）全部**只读**（前后 SoT 指纹不变） |
| **T-C2-14** | Agent **不可创建 / 修改 Target**（无写工具；沿用 B2/Q1 治理） |
| **T-C2-15** | **不自动生成 Company / Person / Institution 名**（I-C2-8；grep + 行为断言：输出中只有类型级建议） |
| **T-C2-16** | **不修改 Knowledge**（belief/conflict 行数、state 指纹不变） |
| **T-C2-17** | **不修改 Pool / Gap / Priority / State 规则**（既有 s45/s5/s6 用例全绿且语义未变） |
| **T-C2-18** | **不新增表**（`ResearchDb` 表清单不变） |
| **T-C2-19** | **不引入 LLM / 外部数据源**（grep 断言） |

**门禁 / 回归**

| # | 断言 |
|---|---|
| **T-C2-20** | 既有 **223** 用例全绿 |
| **T-C2-21** | **C1 的 29 条**用例全绿（语义不变；如需改动**只允许加严**） |
| **T-C2-22** | 两处 `tsc`（root + research）exit 0 |
| **T-C2-23** | `research smoke` PASS（child-session=real） |

---

## 8. 明确不做（沿用 Phase C §19）

LLM / 外部数据 / Company Discovery / Evidence 与 Fragment 全链 / Experience / 自动选择或生成对象 / Priority 与 Evaluation 语义变更 / Report 变更 / 新增表 / Agent 写权限 / Phase B·C1 的 6 项独立遗留。

---

## 9. 裁决落实记录（Q1–Q6 + 4 项收紧）

| 来源 | 内容 | 落实位置 |
|---|---|---|
| **Q1** | C2 = `Gap → Target / Chain / Outline`（选 A）；§21 的"传播验证"并入 C1 回归 | 本文全文；`docs/phaseC/implementation-contract.md` §21 改为索引 |
| **Q2** | 默认只处理开放 Gap；`--all` 仅显式审计，**不得隐式 fallback** | §4.3 + **I-C2-9** |
| **Q3** | `--for-gap` 可选；建立 **Target → Requirement** 关联（非 Gap SoT） | §1 两条方向 + §4.2 + I-C2-7 |
| **Q4** | Position 本体不收敛，只派生 coverage | §4.1 + **I-C2-11** + T-C2-10 |
| **Q5** | 不加 `research_plan_snapshot`；`plan` 纯 read model | §4.5 + **I-C2-10** + T-C2-6 |
| **Q6** | 新建本文件；Phase C §21 只做索引指向 | 本文件 + §21 修改 |
| **收紧 1** | 语义链必须是 `Gap → Requirement → Position → Target → Question → Preparation` | **§1**（含图与四对象定义） |
| **收紧 2** | 区分 current / historical preparation；**不得删除历史问题** | **§4.4** + **I-C2-6** + T-C2-11 / T-C2-12 |
| **收紧 3** | **无 Target 是正常状态**，必须能在 plan 中呈现 | **§4.5** + T-C2-9 |
| **收紧 4** | confused-conflict 测试改为"需要额外研究 / 交叉验证"，不写死"更换对象" | **T-C2-3** |
| （新增） | **不得把"推荐位置"伪装成"推荐企业"** | **I-C2-8** + T-C2-15 |
| （新增） | 测试矩阵扩到 **T-C2-1 … T-C2-25** | **§7** |
| （本轮微型锁 1/2） | identity 必须由**稳定 ref** 决定（无损/单射），slug 仅可读、不参与唯一性；不同 ref 即使文本相同也不得碰撞 | **§5** + **T-C2-24 / T-C2-25** |
| （本轮微型锁 3） | **I-C2-12**：current outline / plan 的计数与输出只认 `state === "current"`；`retired` 不参与任何当前计数 | **§6** |
| （本轮） | `activeRequirementRefs` 语义锁定（`active ≠ confirmed/sufficient`；**不重定义** Gap 状态规则） | **§4.1** |

---

## 10. 对既有契约的修订（必须在冻结时确认）

| 位置 | 原 | C2 修订 | 理由 |
|---|---|---|---|
| `docs/phaseB/implementation-contract.md` §4 | `DiligenceQuestion` identity = `dq-<preparationRef>-<n>` | 改为**确定性** `dq-<preparationRef>-<source>-<canonical ref>` | 序号无法在"追加 + 退役 + 复活"下稳定指向同一问题（§5） |
| `docs/phaseC/implementation-contract.md` §21 | C2 = 「Gap Lifecycle（验证 + 补齐）」 | 改为**索引**：C2 = Gap-driven Research Planning，详见本文件 | Q1 裁决 A |

> 这两处都只动"分工与 identity"，**不动 C1 已冻结的 Knowledge 语义**。

---

## 11. 反向对照：原始 25 步工作流

| 工作流步骤 | 现状 | C2 |
|---|---|---|
| 1–5 发现 / 筛选 / 补全 / 评估 / 储备 | 2A–2C + S1–S7 | 否 |
| 6–9 知识维护 / 比较 / 发现缺口 / 决定下一步 | **C1 已冻结** | **是（第 9 步：缺口驱动的下一步）** |
| **10 设计研究链条** | B1 | ✅ 只加 `active/all` coverage 派生 |
| **11 选择调研对象** | B2（人确认） | ✅ `--for-gap` 关联（可选） |
| **12 判断适合 / 不适合** | B3 | ✅ 范围收敛到 active requirement |
| **13 次优对象 + 降级标注** | B2/B3 | ✅ 收敛后保持，不弱化 |
| **14 生成调研准备** | B4 | ✅ **核心**：缺口驱动 + 收敛 + 留史 + 幂等 |
| 15–22 调研回填 | C-MVP + C1 部分 | ❌ C3/C4 |
| 23–25 报告 / 溯源 / Methodology Candidate | S6 / S7 / P1 | ❌ 不在 C2 |

---

## 12. 定稿确认（本轮）

| # | 项 | 状态 |
|---|---|---|
| 1 | B4 `DiligenceQuestion` identity 修订 + Phase C §21 改索引 | ✅ **已批准** —— 本 commit 记录；`docs/phaseB/implementation-contract.md` 对应行加"**已被 C2 修订**"注记（不在本 commit 改 B4 的实现） |
| 2 | `allRequirementRefs` / `activeRequirementRefs` | ✅ **已批准**（§4.1，含 `active ≠ confirmed/sufficient` 与"不重定义 Gap 状态规则"） |
| 3 | `DiligenceQuestion.state = "current" \| "retired"` | ✅ **已批准**（§4.4；生命周期历史由 `firstAskedAt` / `retiredAt` 承载） |
| 4 | 测试门槛 **T-C2-1 … T-C2-25** | ✅ **已批准**（新增 T-C2-24 identity stability / T-C2-25 collision guard） |
| 5 | **I-C2-12**（current 计数只认 `current`） | ✅ **已批准**（§6） |
| 6 | identity canonicalization / collision 规则 | ✅ **已批准**（§5，微型锁 1/2） |

**下一步（等你最后一次 diff 审计）**

- 本 commit 仅为 `docs:`：`docs/phaseC/c2-implementation-contract.md`（新建）+ `docs/phaseC/implementation-contract.md`（§21 索引 + §28.9）+ `docs/phaseB/implementation-contract.md`（2 行注记）。
- **不含**任何 `src/`、数据库、migration 改动；**C2 implementation 仍未授权**。
- 你审计通过后，C2 的实现范围 = 本文件 §4（改动草案）+ §6（I-C2-1…12）+ §7（T-C2-1…25），**不得扩张**。
