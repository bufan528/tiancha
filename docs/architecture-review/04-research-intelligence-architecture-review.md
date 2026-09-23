# 04 · Tiancha Research Intelligence Architecture Review

> **2026-09-23 · 只读架构审查，本轮未改任何代码。**
> 依据：**实际代码**（非 README 推测）+ 既有设计基线（`docs/architecture-review/02-architecture-blueprint-v2.md`、`02-...v2.1-final-lock.md`、`03-rebaseline-...md`）。
> 基线校验：HEAD `062b3a8` · `npx tsc --noEmit` exit 0 · `packages/research` typecheck exit 0 · **64 tests 全过** · `research smoke` PASS · 工作区干净。
>
> **一句话结论：架构方向与业务目标一致，没有需要推翻的地方；缺口是把 blueprint v2 已设计但未实现的能力落到 Domain/Application/Tool，外加 6 处 v2 未明确的点需要现在补设计（ResearchChain / ResearchTarget 与 Investment 的区分 / QuestionTargetFit / Requirement 承接 Methodology 条件 / 幂等 identity / Evaluation「未知≠差」）。**

---

## 1. 当前架构真实状态

### 1.1 已真实实现（可用、有测试）

| 能力 | 代码 | 证据 |
|---|---|---|
| Runtime 契约（Run/Round/TaskGraph/TaskAttempt/Artifact/EventStore/ChildSession/HumanGate） | `runtime/*` | smoke PASS（child-session=real） |
| 2A 研究记忆底座（11 表 + Methodology v1 + Echo + OpportunityDiscoveryService） | `storage/research-db.ts`、`application/opportunity-discovery-service.ts` | T1/T2/T3/T4/T8/T9 |
| 2B Agent 主入口（REPL/ask + 9 个研究工具 + 语义路由） | `src/agent/*` | `host.test.ts` |
| 2C Knowledge 投影（三表 + 四种 Evolution + 单向链路 + **已接线**） | `application/knowledge-projection-service.ts` | `knowledge*.test.ts`（36+ 用例） |
| P0 沉淀/回填接线（Echo 不污染、`ingestClaims` 回填、Gap→NextAction 幂等、溯源） | 同上 + `storage/` | `foundation.test.ts` |
| P1 方法论版本化 + Human Gate（candidate/token/CLI/提案工具） | `application/methodology-service.ts`、`src/cli/tiancha.ts` | `methodology-service.test.ts`（11 用例） |

### 1.2 只有 Domain Contract（有类型，无实现/无闭环）

| 对象 | 文件 | 现状 |
|---|---|---|
| `TargetCandidate` / `ScreeningRun` / `ScreeningRule` / `TargetDecision` | `domain/target-candidate.ts` | 只有 interface，**零调用**；且只有「投资筛选」语义 |
| `Evidence` / `EvidenceAssertion` | `domain/evidence.ts` | 只有 interface，无表、无写入路径 |
| `Fact` | `domain/fact.ts` | 只有 interface，无表 |
| `Company` / `CompanyIndustryRelation` | `domain/company.ts`、`company-industry-relation.ts` | 有表 + CRUD，但 `upsertCompany` **零调用** |
| `DocumentFragment` | `domain/source.ts` | 只有 interface，无表 |
| `Run` / `Round` / `Task` | `domain/*` | 有类型，**未落库**（内存 Map） |

### 1.3 只有 Placeholder（骨架，返回空）

| 模块 | 文件 | 行为 |
|---|---|---|
| Evidence Engine | `evidence/evidence-engine.ts` | `query()` 返回 `[]` |
| Evidence Extractor | `evidence/evidence-extractor.ts` | `extract()` 返回 `{extracted: 0}` |
| Research Planner | `planning/research-planner.ts` | 只有 interface + `KNOWN_TASK_TYPES` 常量 |
| Dossier / Scoring / Scheduler / Agents | `dossier/index.ts`、`scoring/index.ts`、`scheduler/index.ts`、`agents/*.ts` | 200–800 字节骨架 |

### 1.4 有表但无业务闭环

- `company`、`company_industry_relation`（有表有 CRUD，**无人调用**）→ 调研链条无数据基础。
- `research_source` / `research_document`（ingest 写入，无查询/召回闭环）。
- `methodology` 的 12 维条件（`confirmedCondition/uncertainCondition/unknownCondition`）**未参与任何判定**（`InformationRequirement` 只承接了 `requiredInfo`）。

### 1.5 有逻辑但缺持久化 / 缺 Agent 暴露

- `Run/Round/Task` 内存化（`task-engine.ts` Map）→ 重启丢失（2D 待做）。
- `TianchaAgentHost` 用 `SessionManager.inMemory` → 对话历史不跨进程。
- `OpportunityDiscoveryService.ingestClaims`（调研回填 P0 能力）**服务层已就绪，但没有 Agent 工具/CLI 暴露** → 用户目前只能靠代码调用。

### 1.6 文档与代码不一致（以代码为准）

| 文档 | 不一致 |
|---|---|
| `README.md` | 「2C 部分完成 / 6 个工具 / 命令表缺 methodology」——**实际 2C 已接线、9 个工具、有 methodology CLI** |
| `docs/PROJECT_STATUS.md` | 已加「部分过时」提示，但正文多处仍按 2A 状态描述 |
| `docs/SCORING_MODEL.md` | **7 维 0–100 分模型与 Methodology 的 12 维是两套**，且与「禁止 LLM 打分」红线冲突（见 §3.2） |
| `docs/architecture-review/03-rebaseline-...md` | 15 条箭头判定表停在 2C 之前（#10/#11/#12/#15 已实现） |
| `docs/ARCHITECTURE.md` | 描述的是 legacy 工作台，首行仍写旧路径 `D:\diaoyan-agent` |

---

## 2. 当前已经正确的设计（不要动）

1. **分层与依赖红线**：Composition Root 唯一 import Pi；Research Core 零 `coding-agent` import（实测成立）。
2. **五层真相分离**：`Claim/Evidence（SoT）/ Belief（认知）/ Pool（覆盖度）/ State（快照）`，互不越权。
3. **单向链路**：`Knowledge → Pool → State → Gap`，State 不回写 Pool（有 one-way 测试）。
4. **历史永不覆盖**：四种 Evolution + 全行保留。
5. **Conflict 不选边**：双方 `conflicting` + `open` conflict 行。
6. **占位数据不进 Knowledge**：`isRealExternalData` + `SKIPPED`（Invariant 5）。
7. **方法论 Human-Gated**：模型只能提案；**无 decide 工具**（有断言）。
8. **`InformationRequirement` 与 `ResearchGap` 是一等对象**（不是裸数组）——这是 v2.1 的关键修正，方向正确。
9. **`blueprint v2` 已设计好** ResearchChain / ResearchTarget / DiligencePackage / Fragment 5 分类 / Evaluation Framework / IntentRouter / Report=Snapshot / legacy 退出路线——**这些不需要重新设计，只需要实现**。

---

## 3. 当前错误 / 不足

### 3.1 结构性不足（必须补）

| # | 问题 | 影响 |
|---|---|---|
| E1 | `InformationRequirement.importance` 被 `ingestMaterial` 恒写 `5`，且未承接 Methodology 的 `confirmed/uncertain/unknown` 条件 | Gap 分级失效；「信息够不够」无判据；调研提纲无优先级依据 |
| E2 | `ingest` 非幂等：重复 ingest 同行业会**再建一套** Question/Requirement/Pool | 数据重复、Gap 翻倍 |
| E3 | `Evidence` 无 `fragmentId`，且无 Material/Fragment 实体 | 「Claim→Evidence→**原始录音片段**」链条断裂（用户 §13） |
| E4 | `TargetCandidate` 只有 investment 语义（`screeningScore`），无 chainPosition/relatedQuestions/accessibility | 「适合回答问题的企业」无法表达（用户 §7） |
| E5 | 无 `QuestionTargetFit` | 无法回答「为什么选这家 / 它能答什么 / 不能答什么」（用户 §9） |
| E6 | 无 `ResearchChain` 实体 | 无法回答「去产业链哪个位置找信息」（用户 §6） |
| E7 | `EvidenceEngine/Extractor/Planner` 是空壳 | 碎片→Evidence→Claim 无实现（用户 §13） |
| E8 | `company` / `industry_chain` 零使用 | 链条推荐无数据基础 |

### 3.2 设计冲突（必须裁决）

| # | 冲突 | 裁决建议 |
|---|---|---|
| C1 | `SCORING_MODEL.md` 的 **7 维 0–100 分** 与 Methodology 的 **12 维** 是两套；且用户明令**禁止 LLM 给 0–100 分** | **废弃 0–100 总分模型**（`config/scoring.json` 与 `scoring/index.ts` 的 `ENTER_POOL_THRESHOLD=65` 一起 DELETE LATER）。改为 §15 的 `DimensionEvaluation[]` + `ReserveDecision` |
| C2 | 「信息未知」被当作「行业差」 | 明确：**`insufficient_evidence` ≠ low score**。未满足 `confirmedCondition` 的维度**不出子分** |
| C3 | `ResearchTarget` 与 `InvestmentTarget` 概念混用 | 显式区分（见 §9），用**判別联合**在类型层强制 |
| C4 | `Dossier` 定位模糊（是否为 SoT） | 明确 **Dossier = 投影/快照**，永不落成 SoT 文本（用户 §15） |

### 3.3 未实现（属路线图，不是缺陷）

ResearchChain / ResearchTarget / DiligencePreparation / FieldResearchIngestion / Report / Evaluation / IntentRouter / Wind / Experience —— **全部是 Phase 计划内**，不是走样。

---

## 4. 业务需求 → 架构能力映射

| 用户需求（943 行指令） | 代码承载物 | 状态 |
|---|---|---|
| ① 自动搜集 + 赛道识别 | **无** | ❌ Phase H |
| ② Wind 补全维度 | `DataProviderPort` + Echo 占位 | 🟡 接口就绪 |
| ③ 多维评估 + 储备 | `industry.reserve_status`（在）+ `scoring/`（空壳，且模型冲突 C1） | ❌ Phase G |
| ④ 信息沉淀 / 动态档案 | 2C + P0（已接线） | ✅ |
| ⑤ 比较新旧信息（SUPPORT/REVISE/CONFLICT/SUPERSEDE） | `KnowledgeProjectionService` | ✅ |
| ⑥ 决定下一步研究什么 | `refreshGaps` + `refreshNextActions` | ✅（基础） |
| ⑦ 设计研究链条（上下游/客户/贸易商/咨询/专家） | **无** | ❌ Phase C |
| ⑧ 从链条选调研对象 | **无** | ❌ Phase C |
| ⑨ 判断对象能答/不能答什么 | **无** | ❌ Phase C（QuestionTargetFit） |
| ⑩ 非最佳对象 + 显式标注降置信 | **无** | ❌ Phase C/D |
| ⑪ 生成针对性调研准备材料 | **无** | ❌ Phase D |
| ⑫ 碎片 → Fragment → Evidence → Claim | 只有 `ingestClaims`（人工结构化入口） | 🟡 Phase E |
| ⑬ 新 Claim 与已有 Knowledge 比较 | ✅ | ✅ |
| ⑭ 更新 Pool / State / Gap | ✅ | ✅ |
| ⑮ Evidence-linked 调研报告 | **无** | ❌ Phase F |
| ⑯ 报告判断可追溯到 Evidence/原始材料 | 部分（belief 有 `claimRef/sourceRef`；无 fragment） | 🟡 Phase E/F |
| ⑰ 经验 → Methodology Candidate（Human Gate） | 有 Candidate + Human Gate；**无 Experience 来源** | 🟡 Phase J2 |
| ⑱ 用户只看到 NL | 9 个工具由模型语义选择；**无 IntentRouter** | 🟡 Phase C+ |

**结论**：⑫⑬⑭（知识沉淀与比较）已经打通；**⑦⑧⑨⑩⑪（调研策略与准备）是完全空白，而这正是用户表述中最关心的主线**。

---

## 5. 完整 Domain Model（目标）

> 标注：`[已实现]` `[已设计未实现]` `[本次新增设计]`

```
Project ─┬─< Industry ────┬─< ResearchChain ──< ChainNode                  [新增]
         │                │        │
         │                │        └──< ResearchTarget ──< QuestionTargetFit [新增]
         │                │                  ▲
         │                │                  │ (晋升)
         │                │             TargetCandidate(purpose=investment|research) [改造]
         │                │                  ▲
         │                │              ResearchQuestion ──< InformationRequirement
         │                │                                         │
         │                ├─< InformationPoolEntry ─────────────────┘
         │                ├─< IndustryKnowledge ──< KnowledgeBelief ──< KnowledgeConflict
         │                ├─< ResearchState ──< ResearchGap
         │                ├─< ResearchMaterial ──< MaterialFragment ──< Evidence ──< Claim
         │                ├─< IndustryDossier (投影)                     │
         │                └─< InvestmentEvaluation ──< DimensionEvaluation
         └─< Methodology ──< MethodologyVersion ──< MethodologyCandidate   [已实现]
```

---

## 6. 完整关系图（业务闭环，逐箭头落点）

```
为什么研究这个行业？          → Industry(investor 发起/材料发现)                    [已实现]
  ↓ 根据什么方法论研究？      → MethodologyVersion(active).dimensions              [已实现]
  ↓ 需要知道什么？            → 每 Dimension → ResearchQuestion → InformationRequirement [已实现]
  ↓ 现在缺什么？              → InformationPoolEntry.status + ResearchGap          [已实现]
  ↓ 为什么缺？                → Requirement.confirmedCondition 未满足              [需补 E1]
  ↓ 去产业链哪个位置找？      → ResearchChain.ChainNode                             [Phase C]
  ↓ 为什么选这个企业？        → TargetCandidate(purpose=research) + selectionReason  [Phase C]
  ↓ 它能回答什么？            → QuestionTargetFit.answerability = strong/partial     [Phase C]
  ↓ 它不能回答什么？          → QuestionTargetFit.limitations                        [Phase C]
  ↓ 为什么还要问它？          → QuestionTargetFit.priority + Question.importance    [Phase C]
  ↓ 调研后得到什么？          → ResearchMaterial → MaterialFragment                  [Phase E]
  ↓ 对应哪些 Evidence？       → Evidence(fragmentId)                                [Phase E]
  ↓ 哪些 Claim 被支持/修正？  → KnowledgeProjectionService(SUPPORT/REVISE)           [已实现]
  ↓ 哪些出现 Conflict？       → KnowledgeConflict(open, 双方保留)                   [已实现]
  ↓ Pool 哪些格子被填充？     → reconcilePool                                        [已实现]
  ↓ State 如何变化？          → refreshState                                         [已实现]
  ↓ 哪些 Gap 解决/新增？      → refreshGaps                                          [已实现]
  ↓ 下一步研究什么？          → refreshNextActions（+ ResearchTarget 推荐）          [已实现/Phase C]
  ↓ 是否改变投资判断？        → InvestmentEvaluation（不允许"未知=差"）              [Phase G]
```

**无法落地的箭头（必须补）**：`为什么缺 → 去产业链哪里找 → 选哪个对象 → 能答/不能答 → 为什么要问它` 这一段（5 个箭头）在代码里**完全不存在**，需要 Phase C。

---

## 7. ResearchChain 设计

### 7.1 定位
ResearchChain 是**「研究这个行业时，需要从哪些产业链/信息来源位置获得信息」的地图**，**不是公司列表**。

### 7.2 Domain

```ts
export type ChainPositionKind =
  | "upstream" | "component_supplier" | "core_manufacturer" | "integrator"
  | "downstream" | "channel" | "distributor" | "trader"
  | "customer" | "service_provider" | "consultant"
  | "industry_association" | "expert" | "competitor" | "regulator"
  | "custom";   // 行业特定扩展，避免为凑枚举硬编码

export interface ResearchChain {
  chainId: string; industryId: string;
  nodes: ChainNode[];
  version: number;          // 链条随认知演进，历史保留
  createdAt: string; updatedAt: string;
}

export interface ChainNode {
  nodeId: string; chainId: string;
  positionKind: ChainPositionKind;
  label: string;            // 行业特定命名，如「谐波减速器厂」「灵巧手集成商」
  whyImportant: string;     // ① 为什么这个位置对当前研究重要
  answersQuestionIds: string[];     // ② 能回答哪些 ResearchQuestion
  satisfiesRequirementIds: string[];// ③ 能满足哪些 InformationRequirement
  suitableEvidenceKinds: string[];  // ④ 适合提供哪类 Evidence（一手订单/产能/口碑…）
  limitations: string[];    // ⑤ 局限（只会说自己的好、不懂上游成本…）
  importance: number;
  dependsOnNodeIds: string[];       // 链条结构（非有向无环强制）
}
```

### 7.3 关键纪律
- 链条**由 Question/Requirement 驱动**（`answersQuestionIds`/`satisfiesRequirementIds` 是必填），不是「按行业龙头拍脑袋」。
- `positionKind` 是**开放集**（`custom` + `label`），避免为枚举而枚举。
- ResearchChain 属于 **Industry**，随认知演进版本化，不覆盖。

---

## 8. ResearchTarget 设计

### 8.1 定位
`ResearchTarget` = **已选定、准备去调研的具体对象实例**。它回答的是「**为什么去调研它**」，不是「它值不值得投资」。

### 8.2 Domain

```ts
export type TargetAccessibility = "contactable" | "likely" | "unlikely" | "unknown";
export type ResearchTargetStatus =
  | "proposed" | "selected" | "contacted" | "scheduled"
  | "visited" | "completed" | "dropped";

export interface ResearchTarget {
  targetId: string; industryId: string; companyId: string;
  chainNodeId: string;                 // 它落在链条哪个位置
  researchPurpose: string;             // 为什么调研它（明确是"回答问题"，非"投资"）
  selectionReason: string;             // 为什么选它
  expectedInformationValue: string;    // 预期能获得什么
  accessibility: TargetAccessibility;
  priority: number;
  risks: string[];
  limitations: string[];
  relatedQuestionIds: string[];
  relatedRequirementIds: string[];
  fallbackTargetIds: string[];         // 次优对象（显式）
  isFallback: boolean;
  fallbackForTargetId?: string;
  status: ResearchTargetStatus;
  createdAt: string; updatedAt: string;
}
```

### 8.3 硬约束
- `isFallback=true` 时**必须**有 `fallbackForTargetId`，且 `limitations` 非空 —— 对应「非最佳来源需标注」的纪律。
- `researchPurpose` 必填，禁止空泛（如「了解公司」不合格）。

---

## 9. TargetCandidate 设计（Investment 与 Research 的区分）

### 9.1 结论：**不拆成两个类型，但用判別联合在类型层强制区分 purpose**

**理由**：
- 两者**数据高度重叠**（company + industry + reason + status + evidence），拆两个类型会导致 Company 被双引用、Repository/SQL 重复。
- 但**评估标准完全不同**（投资价值 vs 回答问题能力），必须显式区分，否则就是用户最担心的「把公司优秀当成适合答题」。
- TypeScript 的 **discriminated union** 能同时满足「统一」与「强制区分」。

### 9.2 Domain

```ts
interface TargetCandidateBase {
  candidateId: string; industryId: string; companyId: string;
  status: "eligible" | "selected" | "rejected";
  selectionReason: string;
  evidenceIds: string[];
  createdAt: string; updatedAt: string;
}

export interface InvestmentTargetCandidate extends TargetCandidateBase {
  purpose: "investment";
  screeningScore: number;      // 投资筛选分（**不是**投资结论）
  whyNow?: string;
  risks: string[];
}

export interface ResearchTargetCandidate extends TargetCandidateBase {
  purpose: "research";
  chainNodeId: string;
  relatedQuestionIds: string[];   // 它能回答的问题
  accessibility: TargetAccessibility;
  expectedInformationValue: string;
  limitations: string[];
}

export type TargetCandidate = InvestmentTargetCandidate | ResearchTargetCandidate;
```

### 9.3 关键纪律
- 现有 `domain/target-candidate.ts` 的 `TargetCandidate`（`screeningScore` 语义）**保留**为 `InvestmentTargetCandidate`（KEEP，不是删除）。
- `ResearchTargetCandidate` 是新增；它是 `ResearchTarget` 的**候选池**，经 QuestionTargetFit 评估后晋升为 `ResearchTarget`。
- **禁止**用 `screeningScore` 排序 research candidate。

---

## 10. QuestionTargetFit 设计

### 10.1 定位
`QuestionTargetFit` 是 **ResearchQuestion × Target 的适配关系**（N×N 独立表），回答「**它能答什么、答得多好、为什么**」。

### 10.2 Domain

```ts
export type Answerability = "strong" | "partial" | "weak" | "none";

export interface QuestionTargetFit {
  fitId: string;
  questionId: string;
  targetId: string;                 // 指向 ResearchTarget（或 candidate）
  canAnswer: boolean;
  answerability: Answerability;
  fitReason: string;                // 为什么它适合答这个（如「处于下游核心客户位置」）
  evidenceBasis: string[];          // 判断依据（链位置/经营情况/既往材料）
  confidence: number;               // 0..1
  limitations: string[];            // 它答不了的部分
  priority: number;                 // 结合 question.importance 计算
  createdAt: string; updatedAt: string;
}
```

### 10.3 Fallback 场景（用户 §9 明确指出这是**正常情况**，不是异常）

```
最佳 Target 无法联系（accessibility=unlikely）
  → 选 fallback Target（answerability 较低）
  → 但 Question.importance = critical
  → 仍进入调研提纲（fit.priority 高）
  → 报告中显式标记："该信息来源非最佳来源，需要进一步交叉验证"
```

**实现要点**：
- Fallback 决策**必须落库**（不是 prompt 里临时决定）：`ResearchTarget.isFallback = true` + `QuestionTargetFit.answerability = weak` + `Fit.limitations` 非空。
- `DiligencePreparation` 生成时，把 `isFallback` 的问题**显式标注 caveat**（见 §11）。
- **禁止**把 fallback 伪装成 best（与 v2 §8 一致）。

---

## 11. DiligencePreparation 设计

### 11.1 定位
针对**已选定的 ResearchTarget**生成个性化调研材料包。**禁止通用模板**（v2 §10 已明令，旧 `tplOutline` 是反面教材）。

### 11.2 Domain

```ts
export interface DiligencePreparation {
  preparationId: string;
  targetId: string; industryId: string;
  purpose: string;                  // 调研目的
  currentUnderstanding: string;     // 当前行业/公司认知（从 Knowledge 投影，非自由文本）
  whyThisTarget: string;            // 为何选该对象
  targetBrief: string;              // 对象简介 + 产业链位置
  questions: DiligenceQuestion[];
  requestedData: string[];          // 需获取数据
  requestedMaterials: string[];     // 需索取材料
  cautions: string[];               // 注意事项
  risks: string[]; limitations: string[];
  methodologyVersionId: string;
  status: "draft" | "ready" | "used";
  createdAt: string;
}

export interface DiligenceQuestion {
  questionId: string;
  text: string;
  /** 溯源：来自哪个 Requirement + 哪条 Fit（可空=通用追问） */
  fromRequirementId?: string;
  fromFitId?: string;
  /** 该问题是否为"退而求其次"的来源 */
  isFallbackSource: boolean;
  caveat?: string;                  // 如"非最佳来源，需交叉验证"
  expectedAnswerType: "fact" | "opinion" | "data" | "confirmation";
  priority: number;
}
```

### 11.3 硬约束
- **每条提纲问题必须带 provenance**（`fromRequirementId` / `fromFitId`）—— 否则无法解释「为什么问这个」。
- `currentUnderstanding` **必须来自 Knowledge 投影**，不是 LLM 自由生成。
- 输入结合：`ResearchState + ResearchQuestion + InformationGap + QuestionTargetFit`。

---

## 12. Material / Fragment / Evidence / Claim 链

### 12.1 定位
Field Research 的原始材料必须能**逐层追溯到片段**，而不是「LLM 读完直接产结论」。

### 12.2 Domain（新增 Material/Fragment；Evidence 加 `fragmentId`）

```ts
export type MaterialKind =
  | "meeting_transcript" | "interview_notes" | "expert_call"
  | "research_report" | "news" | "filing" | "chat" | "note" | "other";

export interface ResearchMaterial {
  materialId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  kind: MaterialKind;
  sourceId: string;              // ResearchSource
  rawLocator: string;            // 文件系统路径 / inline
  receivedAt: string;
  /** 若来自某次调研，关联 ResearchTarget */
  targetId?: string;
}

export interface MaterialFragment {
  fragmentId: string;
  materialId: string;
  sequence: number;              // 顺序
  speaker?: string;              // 说话人
  timestamp?: string;            // 录音时间点
  text: string;
  context?: string;              // 上下文（前后片段摘要）
  createdAt: string;
}
```

`Evidence` **新增 `fragmentId?: string`**（现有 `evidenceId/claimId/sourceId/locator/stance/strength/confidence/verificationStatus` 保留）。

### 12.3 追溯链（必须成立）

```
Claim ──> Evidence ──> MaterialFragment ──> ResearchMaterial ──> ResearchSource
  │                                              │
  └─ belief.claimRef                             └─ targetId ──> ResearchTarget（哪次调研来的）
```

### 12.4 Evolution 与 5 分类的关系
用户 §16 的 `NEW/CONFIRM/UPDATE/CONFLICT/SUPERSEDE` 与已实现的四种 Evolution 是**同一件事的两套命名**，映射如下（**不新增第二套机制**）：

| v2 命名 | 现有 Evolution | 语义 |
|---|---|---|
| NEW | `NEW`（无 anchor） | 新信息，无对应旧 belief |
| CONFIRM | `SUPPORT` | 与旧一致，补证据 |
| UPDATE | `REVISE` | 修正旧 claim（旧标 `revised`） |
| CONFLICT | `CONFLICT` | 矛盾并列保留 |
| SUPERSEDE | `SUPERSEDE` | 取代（旧标 `superseded`） |

**结论：复用现有四种 Evolution，只需在文档/工具层把 5 分类对齐命名，不新建第二套分类器。**

---

## 13. InformationPool 与 Knowledge 边界

| 维度 | InformationPool | Knowledge |
|---|---|---|
| 回答 | 「需要知道什么？掌握多少？证据在哪？有没有冲突？」 | 「基于现有 Evidence/Claim，我们当前的认知是什么？」 |
| 单位 | `InformationPoolEntry(topic, status: unknown\|partial\|confirmed\|conflict, evidenceRefs)` | `KnowledgeBelief(dimension, claimRef, sourceRef, confidence, state, historicalRelations)` |
| 是否含判断 | **否**（只含覆盖度状态） | **是**（认知 + 演变历史） |
| 是否 SoT | 否（覆盖率元数据） | 否（SoT 是 Claim/Evidence） |
| 不变量 | 不得与 Knowledge 同质（T3 已有测试） | 不得是 Claim 的简单数组 |

**关系**：`Claim → Belief（认知形成）→ reconcilePool（覆盖度更新）→ State（快照）→ Gap`。
**新增（Phase C）**：`Requirement.confirmedCondition` 决定 Pool 的 `confirmed` 是否可达成 —— 让「掌握多少」有**判据**，而不是只看有没有 belief。

---

## 14. Methodology → Requirement → Evidence → Evaluation 链

### 14.1 现状缺口（E1）
`MethodologyDimension` **已有** `requiredInfo / confirmedCondition / uncertainCondition / unknownCondition`，但 `InformationRequirement` 只承接了 `requiredInfo`（存成 `requiredEvidenceType`），且 `importance` 恒 5。

### 14.2 设计：Requirement 继承 Dimension 的条件

```ts
export interface InformationRequirement {
  requirementId: string;
  questionId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  dimension: string;               // MethodologyDimension.key
  description: string;
  importance: number;              // 来自 Dimension（不再恒 5）
  requiredEvidenceType: string;
  // ↓ 新增：从 Dimension 继承，用于判定"信息够不够"
  confirmedCondition: string;
  uncertainCondition: string;
  unknownCondition: string;
  preferredSourceKinds: ChainPositionKind[];  // 优先去哪类位置找（Phase C 填充）
  status: RequirementStatus;
  createdAt: string; updatedAt: string;
}
```

### 14.3 链

```
MethodologyDimension
  → ResearchQuestion（每维一问）
  → InformationRequirement（继承 confirmed/uncertain/unknown 条件 + importance）
  → InformationPool（覆盖度：unknown/partial/confirmed/conflict，按上面条件判定）
  → Evidence/Claim（支撑）
  → KnowledgeBelief
  → DimensionEvaluation（§15）
```

---

## 15. Investment Evaluation 设计（「未知 ≠ 差」）

### 15.1 核心裁决
**废弃 0–100 总分模型**（冲突 C1/C2）。改为**维度级评估 + 证据充分性标记**。

### 15.2 Domain

```ts
export type DimensionEvalStatus =
  | "evaluated"           // 证据满足 confirmedCondition → 允许出子分
  | "insufficient_evidence" // 未满足 → **不出子分**（≠ 低分）
  | "conflicting"         // 存在 open conflict → 不出子分，列冲突双方
  | "not_applicable";     // 该维度对本行业不适用（需 human 确认）

export interface DimensionEvaluation {
  dimensionKey: string;
  status: DimensionEvalStatus;
  subscore?: number;              // 仅 status="evaluated" 时存在
  rationale: string;
  evidenceRefs: string[];         // 支撑的 Evidence/Claim
  conflictingClaimRefs?: string[]; // status="conflicting" 时
}

export type ReserveDecision =
  | "reserve"               // 纳入储备
  | "watch"                 // 观察
  | "park"                  // 暂缓
  | "insufficient_evidence"; // 证据不足，暂不判断（≠ reject）

export interface InvestmentEvaluation {
  evaluationId: string;
  subjectKind: "industry" | "company";
  subjectId: string;
  methodologyVersionId: string;   // 评估绑定方法论版本
  dimensionEvaluations: DimensionEvaluation[];
  overall: {
    decision: ReserveDecision;
    /** 明确区分"评估覆盖度"与"质量" */
    evaluatedDimensionCount: number;
    totalDimensionCount: number;
    rationale: string;
  };
  createdAt: string;
}
```

### 15.3 硬约束
- **未满足 `confirmedCondition` 的维度 → `insufficient_evidence`，不出子分**（「技术壁垒信息不足」≠「技术壁垒差」）。
- `overall.decision` **不等于**打分的分档；它是**决策**，且 `insufficient_evidence` 是一等状态。
- 评估结果**绑定 `methodologyVersionId`**（历史评估可比对，方法论演进后旧评估不失效）。
- **禁止** LLM 自由生成 0–100 分（用户 §11 + 禁止 14）。

---

## 16. Industry Dossier 设计

### 16.1 定位
**Dossier = 投影**（非 SoT，非「不断追加文本的报告」）。

### 16.2 Domain

```ts
export interface IndustryDossier {
  dossierId: string;
  industryId: string;
  knowledgeVersion: number;       // 生成时的 Knowledge 版本（可追溯）
  methodologyVersionId: string;
  generatedAt: string;
  sections: {
    currentCognition: string;      // 当前行业认知（来自 Belief 投影）
    keyFacts: string[];            // 当前关键事实（Claim 引用）
    keyJudgements: string[];       // 主要判断
    conflicts: string[];           // 主要冲突（双方并列）
    gaps: string[];                // 信息缺口
    recentChanges: string[];       // 最近发生的变化（Evolution 历史）
    recentEvidence: string[];      // 最近新增证据
    evaluation?: string;           // 当前投资评价（DimensionEvaluation 投影）
    researchPriority: string[];    // 当前研究优先级
    nextSteps: string[];           // 下一步建议
  };
}
```

### 16.3 纪律
- **每次生成都是快照**，可重算；不追加、不覆盖历史（历史版本可作为文件保存）。
- 系统内查询**永不把 Dossier 当真相**；查询走 Knowledge/Pool/State。
- 可物化为 Markdown 文件供人阅读（那是**导出产物**）。

---

## 17. Research Planning 设计

### 17.1 定位
从 `Gap + Requirement.importance + 最近变化 + Target 可得性` → **排序的下一步建议**。

### 17.2 现状
`next_action` 表 + `refreshNextActions`（Gap→NextAction 幂等）**已实现**；`NextActionKind` 枚举已含 `research_company / interview / field_visit / request_manual_input / reevaluate` 等。

### 17.3 设计（Phase C 扩展）
- `NextAction` 的 `params` 从 `{gapId}` 扩展到可含 `{targetId}`（去调研哪个对象）。
- 排序依据：`Gap.importance × uncertainty`（已有）+ `Requirement.importance`（E1 修复后有意义）+ 变化新鲜度。
- **不新增表**，扩展现有 `next_action`。

---

## 18. Research Experience 长期演化设计

### 18.1 定位（继承 v3.1 锁定，不推翻）

```
Research Event → Research Experience → Experience Pattern
    → Methodology Candidate → Human Review → Methodology Version
```

### 18.2 本阶段纪律（用户 §16 + v3.1）
- **不建 `research_experience` 空表**（没有真实 Research Event 之前建了就是空壳）。
- **Experience 永不自动改 Methodology**：永远 `Experience → Candidate → Human Gate → New Methodology`。
- **P1 已实现这条链的后半段**（Candidate + Human Gate + 激活）；缺的只是**前半段（Event→Experience→Pattern）**，等 Phase C–E 产生真实研究行为后再建。

### 18.3 未来 Experience 的"原料"（明确来源，避免空想）
- 哪些 Target 的 `QuestionTargetFit.answerability` 判断**准/不准**；
- 哪些 Question 在调研中**被有效回答/被拒答**；
- 哪些 `DimensionEvaluation` 的判断**被后续 Evidence 验证/推翻**；
- 哪些 Gap **长期无法填补**（说明方法论可能需要调整）。

---

## 19. Agent Tool / UX 设计

### 19.1 现状
9 个工具由主模型语义选择（无关键词分类器）✅；但**没有 IntentRouter service**，也没有「调研准备/回填」的工具暴露。

### 19.2 目标工具面（按 Phase 递增）

| 工具 | Phase | 说明 |
|---|---|---|
| `research_diligence_prep` | D | 「我约到 X，帮我准备」→ DiligencePreparation（**必须在输出中标注 fallback 来源**） |
| `research_ingest_material` | E | 「这是会议文字稿」→ Material→Fragment→Evidence→Claim→回写 |
| `research_chain_show` | C | 「这个行业该找谁问」→ ResearchChain |
| `research_target_list` | C | 「下一步调研谁」→ TargetCandidate(research) + Fit + fallback |
| `research_evaluation_show` | G | 「这个行业值不值得投」→ DimensionEvaluation（**明确 insufficient_evidence**） |

### 19.3 UX 纪律
- 用户不接触 ResearchState/Gap/Pool/TaskGraph/Artifact JSON。
- 回复形态：「目前我认为值得继续研究，主要有三个原因…… 最大的不确定性有四个…… 建议下一步重点验证……」。
- 模型**绝不能**把 fallback 说成最佳、把 `insufficient_evidence` 说成「差」。

---

## 20. Repository / SQLite 持久化建议

### 20.1 新增表（按 Phase）

| 表 | 关键列 | Phase |
|---|---|---|
| `research_chain` | chain_id, industry_id, version, created_at, updated_at | C |
| `chain_node` | node_id, chain_id, position_kind, label, why_important, answers_question_ids_json, satisfies_requirement_ids_json, suitable_evidence_kinds_json, limitations_json, importance, depends_on_json | C |
| `target_candidate` | candidate_id, industry_id, company_id, **purpose**, screening_score?, chain_node_id?, related_question_ids_json?, accessibility?, selection_reason, evidence_ids_json, status | C |
| `research_target` | target_id, industry_id, company_id, chain_node_id, research_purpose, selection_reason, expected_information_value, accessibility, priority, risks_json, limitations_json, related_question_ids_json, related_requirement_ids_json, fallback_target_ids_json, is_fallback, fallback_for_target_id, status | C |
| `question_target_fit` | fit_id, question_id, target_id, can_answer, answerability, fit_reason, evidence_basis_json, confidence, limitations_json, priority | C |
| `diligence_preparation` | preparation_id, target_id, industry_id, purpose, current_understanding, why_this_target, target_brief, questions_json, requested_data_json, requested_materials_json, cautions_json, methodology_version_id, status | D |
| `research_material` | material_id, subject_kind, subject_id, kind, source_id, raw_locator, received_at, target_id | E |
| `material_fragment` | fragment_id, material_id, sequence, speaker, timestamp, text, context | E |
| `evidence` | evidence_id, claim_id, **fragment_id**, source_id, locator_json, stance, strength, confidence, verification_status | E |
| `industry_dossier` | dossier_id, industry_id, knowledge_version, methodology_version_id, generated_at, sections_json | F |
| `investment_evaluation` | evaluation_id, subject_kind, subject_id, methodology_version_id, dimension_evaluations_json, overall_json, created_at | G |

### 20.2 扩展现有表（不新建）
- `information_requirement` 加列：`confirmed_condition / uncertain_condition / unknown_condition / preferred_source_kinds_json`（PRAGMA 预检查）。
- `company` / `company_industry_relation`：**已有表，接上调用**（Phase C）。

### 20.3 加列纪律
沿用既有约定：`PRAGMA table_info` 预检查，try/catch 仅并发兜底。

---

## 21. 幂等性与数据一致性

### 21.1 稳定 identity（natural key）—— 修复 E2

| 实体 | 现状 | 建议 natural key | 稳定 id |
|---|---|---|---|
| Industry | `canonicalName` 匹配已实现 ✅ | (canonicalName) 唯一 | 保持现有 |
| ResearchQuestion | **每次 randomUUID** ❌ | (subjectKind, subjectId, dimensionKey) | `q-<subjectId>-<dimKey>` |
| InformationRequirement | **每次 randomUUID** ❌ | (questionId) 或 (subjectId, dimension) | `ir-<subjectId>-<dim>` |
| InformationPoolEntry | **每次 randomUUID** ❌ | (subjectId, topic) | `pe-<subjectId>-<topic>` |
| ResearchGap | `gap-<requirementId>` ✅（已稳定） | (requirementId) | 保持 |
| NextAction | `act-<gapId>` ✅（已稳定） | (gapId) | 保持 |
| KnowledgeBelief | 新行 + Evolution ✅（设计即如此） | 每次新行（正确） | 保持 |
| Claim | 每次 randomUUID ✅（新信息应新行） | 每次新行（正确） | 保持 |

### 21.2 重复 ingest 的正确行为（修复 E2）

```
同一行业再收到新材料：
  match 已有 Industry（canonicalName）
  → match 已有 Question/Requirement（natural key，复用，不新建）
  → 新材料只产生新的 Claim / Evidence
  → 与已有 Knowledge 比较（Evolution）
  → 更新 Pool / State / Gap
```

**验收**：同一材料 ingest 两次，Question/Requirement/Pool 数量**不翻倍**。

### 21.3 一致性不变量（已有 + 新增）
- 已有：Pool≠Knowledge、State 不回写 Pool、Evolution 不删历史、Conflict 不选边、占位不进 Knowledge、方法论文本 Human-Gated。
- 新增：`QuestionTargetFit` 与 `ResearchTarget` 必须同 subject 同 industry；`DiligenceQuestion.fromRequirementId` 必须存在于该 subject 的 Requirement。

---

## 22. Restart / Recovery

| 项 | 现状 | 建议 |
|---|---|---|
| 业务数据（Industry/Question/Requirement/Pool/State/Gap/Knowledge/Conflict） | ✅ SQLite 已持久化 | 保持 |
| Claim/Evidence blob | ✅ `artifacts.sqlite` | Evidence 落业务表（Phase E） |
| Run/Round/Task | ❌ 内存 Map | 补 `research_run/round/task` 表（2D） |
| Agent 会话 | ❌ `SessionManager.inMemory` | 用 Pi 的持久 Session（2D） |
| 原始材料 | 部分（`raw_text_locator`） | 文件系统 `~/.tiancha/knowledge/sources/`（Phase E） |

**2D 验收**：kill 进程 → 重启 → Industry/Knowledge/Pool/Evidence/Claims/State/原始材料全部可访问，`Evidence→Fragment→Material` 可追溯。

---

## 23. 测试矩阵

| 层 | 已覆盖 | 待补 |
|---|---|---|
| Domain/Storage | T1/T2/T3/T4/T8/T9（foundation）、CRUD、DAG、迁移、只读 | — |
| 2C 知识 | 投影/Reconcile/State/Gap（36+ 用例） | — |
| P1 方法论 | 版本化 + Gate token（11 用例） | — |
| 幂等 | Gap/NextAction 幂等 ✅ | **ingest 幂等（E2）** |
| 调研策略 | — | Chain 建模、TargetCandidate purpose 区分、**Fit fallback 场景**、Target 晋升 |
| 调研准备 | — | 提纲 provenance、fallback caveat 标注、非模板化断言 |
| Field Research | 回填（`ingestClaims`） | **Material→Fragment→Evidence→Claim 追溯链**、5 分类映射 |
| 评估 | — | **「信息不足 ≠ 差」断言**（`insufficient_evidence` 不出子分） |
| Dossier | — | 投影可重算、非追加 |
| E2E | smoke | v2 §22 的 7 个场景（重点 2/3/4/5/6） |
| 重启恢复 | — | 2D kill→restart |

---

## 24. Phase Roadmap（重新审查后）

**对用户 A–J 建议的裁决**：方向正确，但需 3 处调整。

| Phase | 内容 | 状态 | 我的调整 |
|---|---|---|---|
| **A** Research Memory Foundation | 2A 全部 | ✅ 已完成 | — |
| **B** Knowledge Projection / Evolution | 2C + P0（接线） | ✅ 已完成 | — |
| **C** Research Strategy | ResearchChain + TargetCandidate(purpose) + ResearchTarget + QuestionTargetFit + **Requirement 条件继承（E1）+ ingest 幂等（E2）** | ⏳ **下一个** | **把 E1/E2 并入 C 的前置步骤**（否则 C 建立在恒 importance 的沙地上） |
| **D** Diligence Preparation | DiligencePackage | ⏳ | — |
| **E** Field Research Ingestion | Material/Fragment/Evidence/Claim + 回写 | ⏳ | 复用现有 `ingestClaims`，补 Fragment 层 |
| **F** Evidence-linked Report | Report 投影 | ⏳ | — |
| **G** Investment Evaluation | DimensionEvaluation + ReserveDecision | ⏳ | **废弃 0–100 分模型**（裁决 C1） |
| **H** Automated Discovery / Wind | 搜集 + 赛道识别 + Wind | ⏳ | **可提前**（取决于是否优先解决入口自动化） |
| **I** Research Experience | Event→Experience→Pattern | ⏳ | **不建空表**（等 C–E 产生真实研究行为） |
| **J** Methodology Evolution + Human Gate | — | 🟡 **后半段已完成（P1）** | **拆成 J1（治理机制，已完成）+ J2（Experience→Candidate，依赖 I）** |

**推荐执行序**：`C（含 E1/E2）→ D → E → F → G → H → I → J2`
**理由**：用户的真实痛点是「选调研对象 → 准备 → 调研 → 回填」这条主线（C/D/E），它同时是产生 Evidence 的唯一来源；没有它，G（评估）无证据可评、F（报告）无内容可写。H（自动搜集）可以先做以解决入口，但不阻塞主线。

---

## 25. 每个 Phase 的进入条件与验收条件

| Phase | 进入条件 | 完成验收 |
|---|---|---|
| **C** | B 完成；E1（Requirement 承接条件+importance）与 E2（幂等）已修 | ①同一材料 ingest 两次不产生重复 Question/Requirement/Pool；②`Question→ChainNode→ResearchTargetCandidate→Fit→ResearchTarget` 全链落库；③fallback 场景（最佳不可得 + critical 问题）**端到端可复现**并显式标记 |
| **D** | C 完成 | 「我约到 X，帮我准备」→ DiligencePreparation，**每条提纲问题可溯源到 Requirement/Fit**；fallback 问题带 caveat；**断言非模板**（两条不同 Target 的提纲必须不同） |
| **E** | D 完成 | 会议稿 → Material → Fragment → Evidence → Claim → Evolution → Pool/State/Gap **全链落库**；**Claim→Evidence→Fragment→Material 可追溯**；旧 Claim 不被覆盖 |
| **F** | E 完成 | Report 由 Knowledge/Evidence/Claim/Conflict/State/Methodology 生成；**每条判断可下钻到 Evidence**；标不确定/冲突/缺证据；**Report 不改 SoT**（重算不产生新真相） |
| **G** | C+E 完成（有证据可评） | 未满足 `confirmedCondition` 的维度返回 `insufficient_evidence` 且**无子分**；`overall.decision` 可为 `insufficient_evidence`；评估绑定 `methodologyVersionId`；**无任何 0–100 自由打分** |
| **H** | — | 输入 URL/文件 → 结构化行业名（canonical）+ 摘要；Wind Provider 失败**显式报错不静默 mock**；真数据 `isRealExternalData=true` 且能沉淀 |
| **I** | C–E 有真实研究行为数据 | Experience 从 Research Event 派生；**只产 Pattern，不直接改 Methodology** |
| **J2** | I 完成 | Experience Pattern → Methodology Candidate → **Human Gate** → 新版本；**无人工批准不得激活** |

---

## 26. 当前代码与架构文档不一致之处

| 文档 | 不一致 | 处置 |
|---|---|---|
| `README.md` | 2C 标「部分完成」（实为已接线）；工具数 6（实为 9）；命令表缺 `methodology` | 更新（Phase C 前） |
| `docs/PROJECT_STATUS.md` | 已有「部分过时」横幅，正文仍按 2A 描述 | 归档或重写 |
| `docs/SCORING_MODEL.md` | 7 维 0–100 分与 Methodology 12 维**两套**，且违反「禁止 LLM 打分」 | **标记废弃**，改由 §15 Evaluation Framework 取代 |
| `docs/architecture-review/03-rebaseline-...md` | 15 箭头表停在 2C 前（#10/#11/#12/#15 已实现） | 用本文件 §6 的关系图取代 |
| `docs/ARCHITECTURE.md` | 描述 legacy 工作台；首行旧路径 `D:\diaoyan-agent` | 标为 legacy 文档 |
| `docs/HANDOFF.md` | 已于本会话重写并与代码对齐 ✅ | — |

---

## 附：本轮审查的绝对纪律确认

- ✅ 未改任何代码（本轮只新增本文件）。
- ✅ 未推翻 Pi Runtime / Tiancha Runtime；未重实现 Agent Loop。
- ✅ Research Core 仍不依赖 Pi Coding Agent（实测 dependency gate = 0 真实 import）。
- ✅ 未把 InformationPool 做成 Knowledge；未把 Report 做成 SoT；未让 State 回写 Pool。
- ✅ 未让 Agent 自动改 Methodology；未建 Experience 空表。
- ✅ 明确区分 Investment Target 与 Research Target；明确区分「未知」与「差」。
- ✅ 结论以**实际代码**为准，未据 README 推断。

**下一步：等待批准后进入 Phase C 实现（含 E1/E2 前置修复）。**
