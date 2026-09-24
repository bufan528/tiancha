# Tiancha Phase B v1 — Implementation Contract

> **状态：待冻结（revision 1）。** 上游：`07-domain-model-design.md`（§3.2 B3 · §3.6 F1/F3/F4）+ `08-code-design.md`（分层/加列/identity 纪律）。
> 本文是**实现契约**，不是设计讨论：它把每个对象的**字段 / 来源 / 生命周期 / identity / 写入边界 / 规则 / 入口 / 验收测试**全部钉死，使实现者无法自行发明 Target/Chain/Strategy 体系。
> **本文未修改仓库源码。** 冻结后才进入编码。

---

## 0. 范围与红线

**Phase B v1 只做一条链（概念必须分开）：**

| 环节 | 回答 | 承载 |
|---|---|---|
| **Research Planning** | 「**为什么**要研究」 | `ResearchNeed`（**派生值对象**） |
| **Chain / Position** | 「从产业链**哪个位置**研究」 | `ChainTemplate`（版本化）+ `ResearchPosition`（**模板实例**） |
| **Target** | 「研究**谁**」 | `ResearchTarget`（**Human-confirmed subject**） |
| **Fit** | 「这个对象**适不适合**回答这个问题」 | `QuestionTargetFit` |
| **Outline** | 「研究**什么**」 | `DiligencePreparation` + `DiligenceQuestion` |

**红线（违反即不通过）：**

1. ❌ **不接 LLM**（延续 C-MVP）：所有内容由**规则 + 人输入**产生。
2. ❌ **不接外部数据源**、❌ **不做 Company Discovery**：系统**绝不**自行生成公司/专家名称。
3. ❌ 不建 Evidence 全链、❌ 不改 Priority / Evaluation 语义、❌ 不修改 S5 / S6 语义。
4. ✅ **`ResearchTarget` 的主体必须是 Human-confirmed subject**（架构红线，见 §2.4）。
5. ✅ `ResearchPosition` 是**当前方法论下的模板实例**，**不是**"这个行业客观上存在该节点"。
6. ✅ 一切版本化对象遵守既有纪律：**同 id 不同内容 ⇒ 抛错**（复用 `PolicyRegistry` 的模式）。

---

## 1. 链路与对象总览

```
Gap / Priority（S5 · READ ONLY，绝不回写）
        ↓
ResearchNeed          ← 派生 ValueObject（无表、不可改）
        ↓
ChainTemplate vN      ← 版本化模板（内置默认 + 人可覆盖）
        ↓
ResearchPosition      ← 模板实例（kind 级，不含主体名）
        ↓  “建议研究：<position.label> / 目标类型 <suggestedTargetKinds>”
   👤 Human 确认主体
        ↓
ResearchTarget        ← Human-confirmed subject
        ↓
QuestionTargetFit     ← 规则匹配（answerability）
        ↓
DiligencePreparation  ← 行业通用问题 + target-specific + fit-derived cautions
        ↓
（用户去调研 → Material → Claim → Knowledge → Pool → Gap → Priority  ⟲ 闭环）
```

---

## 2. 领域对象（逐字段）

### 2.1 `ResearchNeed`（**派生 ValueObject**，无表）

> **契约**：它是 `Gap + Requirement + Priority + Methodology` 的**只读投影**。**不得**独立持久化、**不得**被修改、**不得**反向写回 Gap/Priority/Requirement。

```
ResearchNeed {
  needId            : string   // = gapId（派生身份）
  gapId             : string
  requirementId     : string
  dimension         : string
  question          : string   // = requirement.description（既有字段，不新造文案）
  whyStudyNotJustFetch: string  // ★ 规则解释字段（见下），不是自由长文本
  suggestedPositionRefs: string[]  // 满足该 requirement 的 position（来自 §2.3）
  priorityScore     : number   // S5 只读
  priorityPolicyVersionId: string
}
```

**`whyStudyNotJustFetch` 的规则（唯一允许的取值形态）** —— 它解释"为什么这个缺口需要**调研**而不只是抓数据"，由**结构化信号**拼装，取值来自一个封闭枚举：

```
（gapType=unknown 且 维度 requiresFirstHand）  → "需要一手信息"
（gapType=conflict）                          → "需要独立第三方证据消解分歧"
（gapType=insufficient 且 维度 requiresFirstHand）→ "需要补充一手证据以满足确认条件"
（gapType=insufficient）                      → "需要补充可溯源证据"
（其他）                                      → "需要补充证据"
```
> 禁止在此字段写"行业分析长文"；它是**枚举 → 短语**的映射，便于测试与审计。

### 2.2 `ChainTemplate`（**版本化**）

```
ChainTemplate {
  templateId : string   // 稳定 id，如 "chain-template-general"
  version    : string   // 如 "v1"；同 (templateId,version) 内容不同 ⇒ register() 抛错
  appliesTo? : string[] // 预留：行业类型限定（空 = 通用）
  positions  : ChainTemplatePosition[]
}
ChainTemplatePosition {
  key                 : string       // 稳定 key，如 "downstream_head_customer"
  kind                : string       // 开放枚举：upstream/downstream/customer/supplier/
                                     //   channel/trader/consulting/expert/association/...
  label               : string       // 行业化命名，如 "下游头部客户"
  whyImportant        : string       // ★ 必填（禁止空节点，见 I-B1）
  dimensionKeys       : string[]     // 该位置主要服务哪些研究维度（映射到 Requirement.dimension）
  suggestedTargetKinds: string[]     // ★ “建议研究哪类对象”（类型级，不含主体名）
  suitableEvidenceKinds: string[]    // 该位置适合提供什么证据（供 fit/outline 使用）
  limitations         : string[]     // 该位置的固有局限（进入 fit，降级 answerability）
}
```

**v1 交付**：一个内置模板 `CHAIN_TEMPLATE_GENERAL_V1`（`templateId="chain-template-general"`, `version="v1"`），覆盖 07 的开放枚举；`config/chain-templates/*.json` **可选覆盖**（同 id+version 覆盖必须逐字段一致，否则按"新版本"处理）。
**注册纪律**：`ChainTemplateRegistry.register()` —— 同 `(templateId,version)` 内容不同 ⇒ **抛错**（与 `PolicyRegistry` 同构）。

### 2.3 `ResearchPosition`（**模板实例**，表 `research_position`）

```
ResearchPosition {
  positionRef            : string   // ★ 确定性：`pos-<industryId>-<templateId>-<positionKey>`
  industryId             : string
  chainTemplateId        : string   // ★ 溯源：来自哪个模板
  chainVersion           : string   // ★ 溯源：模板版本（模板升级不静默改历史语义）
  kind                   : string
  label                  : string
  whyImportant           : string
  answersQuestionRefs    : string[] // ★ 由 dimensionKeys × Requirement 映射得出
  satisfiesRequirementRefs: string[]// ★ 同上（I-B1 要求至少一个非空）
  suggestedTargetKinds   : string[] // “建议研究哪类对象”
  suitableEvidenceKinds  : string[]
  limitations            : string[]
  importance             : number   // 由所服务维度的 weight 汇总（派生，非拍脑袋）
  createdAt              : string
}
```

**生成**：`ChainProjectionService.project(industryId)` —— 幂等（stable id），只为**当前激活模板**生成/更新；模板换版本 ⇒ 生成新 `positionRef`（旧的保留，历史可溯）。

### 2.4 `ResearchTarget`（**Human-confirmed subject**，表 `research_target`）

> ★ **架构红线**：系统可以建议"研究哪类对象"，**绝不能**自己决定"就是这家公司"。
> 因此 `targetRef` 的**主体标识必须由人给出**（`subjectKey` 来自用户输入），`createdBy` 仅允许 `"user"`（v1）。

```
ResearchTarget {
  targetRef            : string   // ★ 确定性：`tgt-<industryId>-<slug(subjectKey)>`
  industryId           : string
  subjectKey           : string   // ★ 人提供的唯一主体标识（公司名/专家名/机构名，原样保留）
  targetKind           : string   // 来自 position.suggestedTargetKinds（开放枚举）
  positionRef          : string   // 落在哪个产业链位置（F1: positionRef）
  kindSubject          : object   // 类型特定画像（JSON 扩展，避免表爆炸）：{displayName, note?, ...}
  researchPurpose      : string   // ★ 必填（F1 不变量②）
  selectionReason      : string   // ★ 必填（F1 不变量②）
  expectedInformationValue: number // 0..1（人给或规则给；v1 允许人给，缺省按 kind 默认）
  accessibility        : "contactable" | "likely" | "unlikely" | "unknown"
  limitations          : string[]
  isFallback           : boolean
  fallbackForTargetRef : string | null   // isFallback=true ⇒ 必填（F1 不变量①）
  relatedQuestionRefs  : string[]
  relatedRequirementRefs: string[]
  status               : "proposed" | "selected" | "contacted" | "scheduled" | "visited" | "completed" | "dropped"
  createdBy            : "user"          // v1 只允许 user（见 §6 写入边界）
  createdAt            : string
  updatedAt            : string
}
```

### 2.5 `QuestionTargetFit`（**规则匹配**，表：**派生，不落表**）

> 依据你的裁决"**Fit 必须先于 Outline**"。它是 `Target × Question` 的**派生判定**（可重算），不单独持久化；其结果写入 `DiligenceQuestion.fromFitRef / isFallbackSource / caveat`。

```
QuestionTargetFit {
  fitRef         : string   // 确定性：`fit-<targetRef>-<questionRef>`
  questionRef    : string   // 指向 Requirement（Phase B 的"问题"= open Requirement）
  targetRef      : string
  canAnswer      : boolean  // answerability !== "none"
  answerability  : "strong" | "partial" | "weak" | "none"
  fitReason      : string   // ★ 必填（F3 不变量①）——规则短语，非自由长文
  evidenceBasisRefs: string[]
  confidence     : number
  limitations    : string[] // 复制 target.limitations 中与本问题维度相关者
  priority       : number   // = 该 Requirement 的 priority 分（S5 只读）
}
```

**`answerability` 规则（唯一算法）**：

```
base = match(position.suggestedTargetKinds, target.targetKind)      // 该位置是否本就建议此类对象
        && match(position.dimensionKeys, question.dimension)        // 该位置是否服务于该维度
     ⇒ strong  若两者皆中
     ⇒ partial 若仅其一
     ⇒ weak    若皆不中但 position 与该维度有关联（suitableEvidenceKinds 有交集）
     ⇒ none    否则
降级：若 target.limitations 或 position.limitations 命中该维度 ⇒ 至少降一级，并记 limitations
```

**不变量（F3 ②）**：`answerability ∈ {weak,none}` **且** 该问题 priority 高 ⇒ 该问题在 Outline 中**必须**走 fallback（`isFallbackSource=true` + `caveat` 非空）。若无可用 fallback target ⇒ **仍标记 caveat**（"无合适对象，需降低置信度并交叉验证"），**不得静默降级**。

### 2.6 `DiligencePreparation` + `DiligenceQuestion`（表 `diligence_preparation`）

```
DiligencePreparation {
  preparationRef        : string   // 确定性：`dp-<targetRef>`
  targetRef             : string
  industryRef           : string
  purpose               : string   // = target.researchPurpose
  targetBrief           : string   // ← 由 target.kindSubject + position.label 组装（target-specific）
  currentUnderstanding  : object   // ← Knowledge 投影（只读；来源：Belief/Conflict）
  whyThisTarget         : string   // ← 由 position.whyImportant + target.selectionReason 组装
  requestedData         : string[] // ← 由 question × position.suitableEvidenceKinds 派生
  requestedMaterials    : string[]
  cautions              : string[] // ★ fit-derived：answerability∈{weak,none} 的问题所带的 caveat
  risks                 : string[]
  limitations           : string[] // = target.limitations
  methodologyVersionRef : string
  questions             : DiligenceQuestion[]
  status                : "draft" | "ready" | "used"
  createdAt             : string
}

DiligenceQuestion {
  questionRef        : string   // 确定性：`dq-<preparationRef>-<n>`
  text               : string   // 由 requirement.description / position 组合（不新造行业长文）
  source             : "common" | "target_specific" | "fit_derived"   // ★ 三者的可测标记
  fromRequirementRef : string | null  // ★ 可溯源（F4 不变量①）
  fromFitRef         : string | null
  isFallbackSource   : boolean        // 见 §2.5
  caveat             : string | null  // isFallbackSource=true ⇒ 非空（F4 不变量②）
  expectedAnswerType : string
  priority           : number
}
```

**组装规则（`DiligencePreparationService.prepare(targetRef)`，纯规则）**：

1. **common（行业通用）**：对每个 **open Requirement**（按 S5 priority 降序）产出一问，`source="common"`，`fromRequirementRef` 必填。
2. **target_specific**：对 `answerability ≥ partial` 的问题，按其 `position.suitableEvidenceKinds` / `targetKind` 追加**该对象特有的问法**，`source="target_specific"`，`fromFitRef` 必填。
3. **fit_derived cautions**：对 `answerability ∈ {weak,none}` 的问题，产出 caveat 条目并进 `cautions`，`source="fit_derived"`，`isFallbackSource=true`，`caveat` 非空。

> ★ **验收据此改写（采纳你的收紧）**：不测"两个 target 的 Markdown 文本不同"，而测
> **`source` 三类可区分**、且 `targetBrief / whyThisTarget / cautions / requestedData` 等**结构化字段确实来自各自 target / position / fit**（见 T-B8）。

---

## 3. 数据模型（3 张表）

```sql
CREATE TABLE IF NOT EXISTS research_position (
  position_ref TEXT PRIMARY KEY,
  industry_id TEXT NOT NULL,
  chain_template_id TEXT NOT NULL,
  chain_version TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  why_important TEXT NOT NULL,
  answers_question_refs_json TEXT NOT NULL,
  satisfies_requirement_refs_json TEXT NOT NULL,
  suggested_target_kinds_json TEXT NOT NULL,
  suitable_evidence_kinds_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  importance REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_position_industry ON research_position(industry_id);

CREATE TABLE IF NOT EXISTS research_target (
  target_ref TEXT PRIMARY KEY,
  industry_id TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  position_ref TEXT NOT NULL,
  kind_subject_json TEXT NOT NULL,
  research_purpose TEXT NOT NULL,
  selection_reason TEXT NOT NULL,
  expected_information_value REAL NOT NULL,
  accessibility TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  is_fallback INTEGER NOT NULL,
  fallback_for_target_ref TEXT,
  related_question_refs_json TEXT NOT NULL,
  related_requirement_refs_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_target_industry ON research_target(industry_id);

CREATE TABLE IF NOT EXISTS diligence_preparation (
  preparation_ref TEXT PRIMARY KEY,
  target_ref TEXT NOT NULL,
  industry_ref TEXT NOT NULL,
  purpose TEXT NOT NULL,
  target_brief TEXT NOT NULL,
  current_understanding_json TEXT NOT NULL,
  why_this_target TEXT NOT NULL,
  requested_data_json TEXT NOT NULL,
  requested_materials_json TEXT NOT NULL,
  cautions_json TEXT NOT NULL,
  risks_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  methodology_version_ref TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dp_target ON diligence_preparation(target_ref);
```

**加列纪律**：这三张是**新表**（`CREATE TABLE IF NOT EXISTS`）；不修改任何既有表。
**JSON 纪律（C4）**：`*_json` 只承载**值对象/快照**（questions、limitations…），**不得**把核心实体藏进 JSON。

---

## 4. Identity（全部确定性，无时间戳/UUID）

| 对象 | identity |
|---|---|
| ResearchNeed | `= gapId`（派生） |
| ResearchPosition | `pos-<industryId>-<templateId>-<positionKey>` |
| ResearchTarget | `tgt-<industryId>-<slug(subjectKey)>` |
| QuestionTargetFit | `fit-<targetRef>-<questionRef>`（派生） |
| DiligencePreparation | `dp-<targetRef>` |
| DiligenceQuestion | `dq-<preparationRef>-<n>` |

> `slug()` 对 `subjectKey` 做规范化（去空白/大小写归一/非法字符替换），**不得**使用随机值或时间戳。

---

## 5. 不变量（I-B1 … I-B6）

| # | 不变量 | 守护 |
|---|---|---|
| **I-B1** | `ResearchPosition` **禁止空节点**：`whyImportant` 非空 **且** `answersQuestionRefs`/`satisfiesRequirementRefs` 至少一个非空 | `ChainProjectionService` |
| **I-B2** | `ResearchTarget`：`researchPurpose` + `selectionReason` 必填 | `TargetService` |
| **I-B3** | `isFallback=true` ⇒ `fallbackForTargetRef` 非空 **且** `limitations` 非空 | `TargetService` |
| **I-B4** | `QuestionTargetFit`：`fitReason` 必填；`answerability∈{weak,none}` 且问题 priority 高 ⇒ 必须走 fallback + `caveat` 非空（**不得静默降级**） | `DiligencePreparationService` |
| **I-B5** | 每条 `DiligenceQuestion` 必须可溯源（`fromRequirementRef` 或 `fromFitRef` 非空） | `DiligencePreparationService` |
| **I-B6** | `ResearchNeed` **只读**：任何代码路径不得写入/回写 Gap/Priority/Requirement | 架构 + 测试 |
| **I-B7** | **模板实例非真相**：`ResearchPosition` 必带 `chainTemplateId`+`chainVersion`；模板版本变化 ⇒ 新 `positionRef`，旧行保留 | `ChainProjectionService` |

---

## 6. 写入边界（谁能写什么）

| 对象 | 写入者 | 说明 |
|---|---|---|
| `ResearchNeed` | **无人** | 派生只读 |
| `ResearchPosition` | `ChainProjectionService`（系统） | 模板投影，幂等 |
| `ResearchTarget` | **仅 CLI（人）**：`tiancha research target add` | ★ 架构红线：主体必须由人确认。**v1 不提供 Agent 写 target 的工具** |
| `QuestionTargetFit` | 派生（无写入） | 可重算 |
| `DiligencePreparation` | 系统（由 target 触发，`DiligencePreparationService.prepare`） | 只读上游 |

**禁止**：任何对象回写 Gap / Priority / Requirement / Pool / Knowledge / Evaluation / State（I-B6 及既有 I4）。

---

## 7. Service 设计（Application 层）

| Service | 方法 | 职责 |
|---|---|---|
| `ChainProjectionService` | `project(industryId)` | 由注册模板生成/更新 `ResearchPosition`（幂等、I-B1） |
| `ResearchNeedService` | `list(industryId)` | 派生 `ResearchNeed[]`（只读 Gap/Requirement/Priority/Methodology） |
| `TargetService` | `add(input, createdBy="user")` / `list(industryId)` / `get(ref)` | 人的确认入口（I-B2/I-B3） |
| `QuestionTargetFitService` | `fit(targetRef, questionRef)` / `fitAll(targetRef)` | 规则匹配（I-B4） |
| `DiligencePreparationService` | `prepare(targetRef)` | 组装提纲（三类 source、I-B4/I-B5） |

依赖方向不变：`Research Core` 只依赖 Port，**绝不** import coding-agent。

---

## 8. CLI / Agent 入口

**CLI（v1）**
| 命令 | 说明 |
|---|---|
| `tiancha research chain <行业>` | 展示 `ResearchPosition`（模板实例）与"建议研究哪类对象" |
| `tiancha research need <行业>` | 展示派生的 `ResearchNeed`（含 `whyStudyNotJustFetch`） |
| `tiancha research target add <行业> --kind <k> --name <主体> --position <posRef> --purpose <...> --reason <...> [--fallback-for <ref>] [--limitation <...>]` | **人**录入具体研究对象（唯一 target 写入路径） |
| `tiancha research target list <行业>` | 列出已确认的对象及其 fit 概况 |
| `tiancha research diligence <行业> --target <ref>` | 生成调研准备（提纲 + cautions），可选 `--json` |

**Agent 工具（v1，全部只读）**：`research_chain_show` / `research_need_list` / `research_target_list` / `research_diligence_show`。
> **不给模型写 target 的工具**（架构红线）。是否在后续版本开放"把用户口述的对象录成 target"，留待你裁决（§11 Q1）。

---

## 9. 验收测试 T-B1 … T-B12

| # | 测试 | 断言 |
|---|---|---|
| **T-B1** | ChainTemplate 版本化 | 同 `(templateId,version)` 不同内容 ⇒ `register()` 抛错；新版本 ⇒ 允许 |
| **T-B2** | Position 投影 + I-B1 | 对某行业生成 N 个 position；每个 `whyImportant` 非空且至少关联一个 Question/Requirement；重复投影幂等（id 稳定） |
| **T-B3** | 模板版本变化 | 换 `chainVersion` ⇒ 新 `positionRef`，旧 position 行保留（I-B7） |
| **T-B4** | ResearchNeed 派生 + 只读 | 内容来自 Gap/Requirement/Priority（字段逐项可对）；**调用前后 Gap/Requirement/Priority/State 无任何变化**（I-B6） |
| **T-B5** | `whyStudyNotJustFetch` 来自枚举 | 不同 `gapType`/`requiresFirstHand` 组合 ⇒ 命中预定义短语之一（不是任意长文本） |
| **T-B6** | Target 必填与 fallback | 缺 `researchPurpose`/`selectionReason` ⇒ 抛错；`isFallback=true` 缺 `fallbackForTargetRef`/`limitations` ⇒ 抛错（I-B2/I-B3） |
| **T-B7** | **Target 主体必须人给** | 不存在任何"系统自行产生 `subjectKey`"的代码路径；`createdBy` 只能为 `user`；同一 `subjectKey` 幂等（同 ref，不重复） |
| **T-B8** | **Fit + Outline 的 target-specific derivation**（采纳你的收紧） | 两个 `targetKind` 相同但 `limitations`/`currentUnderstanding` 不同的 target：`questions` 的 `source` 三类均出现；`targetBrief/whyThisTarget/cautions/requestedData` 各自来自**本 target/position/fit**；`answerability∈{weak,none}` 的问题 `caveat` 非空 |
| **T-B9** | weak/none ⇒ fallback 不静默降级 | 高 priority 问题 `answerability=weak` ⇒ 该问题 `isFallbackSource=true` 且 `caveat` 非空；无 fallback 也**必须**标 caveat（I-B4） |
| **T-B10** | DiligenceQuestion 可溯源 | 每条问题 `fromRequirementRef` 或 `fromFitRef` 非空（I-B5） |
| **T-B11** | 只读边界 | `prepare()`/`add()`/`project()` 前后，Gap/Priority/Pool/Knowledge/Evaluation/State 指纹不变 |
| **T-B12** | 回归 + 越界 | 既有 154 用例全绿 + smoke PASS；**grep 断言**无 `openai|anthropic|generateText|llm(` 等模型调用；无 `Company Discovery`/外部数据源；无 Evidence 新模型 |

---

## 10. 明确不做

LLM / 外部数据源 / Company Discovery / Evidence 全链 / Priority·Evaluation 改造 / S5·S6 语义修改 / Target 的 Agent 写入口 / 跨行业的 `ResearchChain` 共享。

---

## 11. 待你裁决（编码前）

| # | 问题 | 我的建议 |
|---|---|---|
| **Q1** | Agent 是否可获得**写 target** 的能力（把用户口述的对象录成 target）？ | v1 **不给**（保持"Human-confirmed"为硬边界）；等真实使用后再评估 |
| **Q2** | `config/chain-templates/*.json` 的覆盖机制 v1 是否要做？ | 做**最小**：仅支持覆盖 `(templateId,version)` 且必须逐字段一致；否则报错要求新版本 |
| **Q3** | `expectedInformationValue` 缺省来源 | v1：人可给；缺省时按 `position.importance` 派生（不拍脑袋） |
