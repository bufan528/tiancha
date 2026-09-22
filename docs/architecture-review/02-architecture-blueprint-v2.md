# 02 · Architecture Blueprint v2（天查 Research Intelligence Agent 目标架构）

> v2 · 对齐最终架构校准总指令 · 基于 Phase 1 实际代码 · 2026-09-22
>
> 本文件是 v1（`02-architecture-blueprint.md`）的升级。v1 定义了 Runtime 复用、基础 domain、application 分层。v2 按总指令补齐：**三资产知识系统、Information Pool、ResearchQuestion/Target/Chain、Diligence Preparation、Field Research 回流、Report=Snapshot、NL Intent Router、Local-first 目录、六式检索、legacy host 退出、Phase 2–8、7 个 E2E 验收**。反过度设计原则：每个模块必须回答「它是否推进 Research→Evidence→Knowledge→Gap→Target→Diligence→Field→Knowledge Update 飞轮」。

---

## 1. Product Architecture（分层总览）

```
┌──────────────────────────────────────────────────────────────────────┐
│ User：自然语言（直接说话）                                              │
├──────────────────────────────────────────────────────────────────────┤
│ Agent Interaction Layer（packages/research/src/interaction/，新增）   │
│  IntentRouter / ContextAssembler / NLResponder                        │
│  —— 对用户隐藏 Domain Model/State/Pool/Agent选择/TaskGraph             │
├──────────────────────────────────────────────────────────────────────┤
│ Application Services（application/，新增）                              │
│  OpportunityDiscovery / IndustryResearch / CompanyResearch /        │
│  ResearchPlanning / ResearchTargeting / DiligencePreparation /        │
│  FieldResearchIngestion / KnowledgeUpdate / Evaluation / Reserve /     │
│  ReportComposer / MethodologyGovernance                               │
├──────────────────────────────────────────────────────────────────────┤
│ Domain（既有冻结 + 新增）                                              │
│  Runtime 契约（Run/Round/Task/Attempt/Artifact/Event/HumanGate）     │
│  + ResearchState / Industry / Company / ResearchQuestion /            │
│    ResearchTarget / ResearchChain / InformationPool /                │
│    Knowledge{Methodology,Industry,Company} / FragmentInput /          │
│    DiligencePlan / ReportSnapshot / EvaluationFramework               │
├──────────────────────────────────────────────────────────────────────┤
│ Ports（既有 Pi 集成 + 新增业务端口）                                    │
│  AgentSessionFactory/ModelResolver/EventBus/ToolProvider/...（既有）   │
│  DataProvider / ResearchRepository / InformationPoolStore /          │
│  FragmentIngest / Retrieval / MethodologyReview（新增）               │
├──────────────────────────────────────────────────────────────────────┤
│ Runtime（既有，冻结）                                                  │
│  TianchaRuntime/TaskEngine/Orchestrator/ChildSession/HumanGate/      │
│  ModelRouter/ResearchEventAdapter                                     │
├──────────────────────────────────────────────────────────────────────┤
│ Storage（Local-first）                                                 │
│  ~/.tiancha/                                                          │
│    db/tiancha.sqlite（结构化实体/状态/事件/Claim/Evidence metadata）   │
│    knowledge/{methodology,industries,companies,sources}（文件）        │
│    index/{fulltext,vector}（检索索引）                                │
│    runs/（Run 工作目录、原始材料、报告、附件）                         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Domain Model（实体关系，文字版）

```
Project
  ├──< Industry ──< ResearchChain(节点: 上游/部件/整机/集成/渠道/客户/专家/...)
  │       │              │
  │       │              └──< ResearchTarget（≈节点上的具体对象；含 capability/fallback）
  │       ├──< Company ──┘
  │       ├──< ResearchQuestion ──< InformationRequirement
  │       ├──< InformationPool（已知/部分/未知/冲突）
  │       ├──< IndustryKnowledge（时间+来源+Evidence+Claim+冲突+版本）
  │       ├──< ResearchState（Known/Confirmed/Uncertain/Conflicting/Unknown/
  │       │                     KeyQuestions/Gaps/NextActions）
  │       ├──< EvaluationRun >── EvaluationResult（frameworkVersion 快照）
  │       └──< ReserveStatus(discovered/candidate/watch/reserve/parked/dropped)
  │
  └──< Methodology（Human-Gated + 版本化）
           └── version v1/v2/...（dimensions/anchors/infoRequirements/templates）

Evidence 链（SoT）：
  Source ─< Document ─< DocumentVersion ─< DocumentFragment ─< Citation
     └──< Evidence ─(EvidenceAssertion: stance/strength/confidence)──> Claim
  FragmentInput ─提取──> Fragment ─分类(NEW/CONFIRM/UPDATE/CONFLICT/SUPERSEDE)──> Evidence/Claim
  Fact ─支撑──> Claim
  Claim ─subjectKind(subjectId)─┬─> IndustryKnowledge（subject=industry）
                                 └─> CompanyKnowledge（subject=company）
  跨层：Company Evidence ─可反改─> Industry Claim
        Industry Claim ─生成─> Company ResearchQuestion

派生（非 SoT）：
  IndustryProfile / CompanyProfile / ReportSnapshot
    = ResearchState + Knowledge + Pool + Evidence 的投影/快照
```

---

## 3. Application Services（落位 `application/`）

| Service | 输入 | 输出 | 职责要点 |
|---|---|---|---|
| `OpportunityDiscoveryService` | IngestRequest（文件/文本） | IndustryDiscovered | 闭环 A：抽行业→标准化→建/匹配 CanonicalIndustry |
| `IndustryResearchService` | industryId | IndustryView | 读 State/Knowledge/Pool/Profile |
| `ResearchPlanningService` | subjectKind, subjectId | NextAction[]（可执行） | 闭环 D：State→Gap→Question→Priority→NextAction |
| `ResearchTargetingService` | ResearchQuestion | TargetRecommendation{primary,fallback[]} | 问题驱动选谁能答，含 capability/rationale/limitations |
| `DiligencePreparationService` | companyId + researchQuestion | DiligencePackage | 闭环 C：个性化材料包（非通用模板） |
| `FieldResearchIngestionService` | FragmentInput | IngestResult{added,confirmed,updated,conflicted} | 闭环：Fragment→Evidence→Claim→Pool/Knowledge/State 回灌 |
| `KnowledgeUpdateService` | subjectKind, subjectId, evidenceBatch | UpdateResult | 合并新 Evidence，分类新旧关系，禁止覆盖 |
| `EvaluationService` | subjectId | EvaluationResult | FrameworkVersion 驱动 |
| `ReserveService` | industryId, transition | 新状态+gateId? | 状态机 |
| `ReportComposerService` | subjectKind, subjectId | ReportSnapshot | State+Evidence→ReportPlan→Report→Critic→Evidence Verification→Final |
| `MethodologyGovernanceService` | candidate/activate | MethodologyVersion | Human-Gated 流水线 |
| `IntentRouterService` | 用户 NL 文本 | ServiceCall（隐藏内部） | 见 §18 |

---

## 4. Runtime（复用 Phase 1，不改冻结契约）

- 完全复用 `TianchaRuntime/TaskEngine/Orchestrator/ChildSession/HumanGate/ModelRouter/ResearchEventAdapter`。
- 扩展点（不改语义，加实现）：
  1. Run/Round/Task 落库（`storage/research-run-store.ts` 等）。
  2. `Orchestrator.runRoundUntilSettled(roundId)`：topo 序驱动 DAG；critic rejected → `finishRound(rejected)` → 新建 Round，不重跑旧 Task。
  3. 所有业务 Service 通过 `Orchestrator.startRun/startRound` 建任务；LLM 仍经 `AgentSessionFactoryPort` 开标准 Child Session。
- **红线**：Research Core 不 import `coding-agent`；`TianchaAgentSessionFactory` 由 composition root 注入；ResearchContext 经 context/resource loading 传递，不给 `createAgentSessionFromServices` 加不存在的参数。

---

## 5. Knowledge System（三资产，分别给落点与存储）

| 资产 | 含义 | 存储 | 文件落点 |
|---|---|---|---|
| **Methodology**（如何研究） | 行业拆解法、评价维度、公司研究框架、信息需求定义、调研对象选择、问题设计、Evidence 评价、Gap 判断 | SQLite 表 `methodology` + `methodology_version`；激活版本号 | `~/.tiancha/knowledge/methodology/`（Markdown 原文） |
| **Industry/Company Knowledge**（已知什么） | 行业：市场/增长/产品/技术/上中下游/客户/竞争/政策/模式/商业化/风险/趋势；公司：基本信息/业务/产品/客户/财务/技术/模式/竞争位置/管理层/产业链位置/研究记录 | SQLite 表 `knowledge_industry` / `knowledge_company`（每节点带 `asOf/sourceId/claimIds/confidence/status: active|disputed|superseded`）；原始材料在文件 | `~/.tiancha/knowledge/industries/<id>/`、`companies/<id>/` |
| **Information Pool**（需要什么/已有/缺失） | 如"市场空间已知、客户需求部分已知、真实订单未知、价格不充分、盈利能力冲突" | SQLite 表 `information_pool_entry(subject_kind,subject_id,topic,status: known|partial|unknown|conflict,evidenceRefs[],updatedAt)` | 无独立文件（派生视图） |

**飞轮**：Methodology→Framework→InformationRequirements→InformationPool→Research→Evidence→IndustryKnowledge→GapAnalysis→Target→Diligence→Field→Evidence→Pool 更新→Knowledge 更新→State 更新→Next Research。

**Methodology 治理**（总指令 §1）：`Research Material → Methodology Candidate → Agent 解释 → Human Review → Methodology Version → Activate`。复用 `runtime/human-gate.ts` 的 resumeToken 原语。**禁止模型看几篇报告就改方法论。**

---

## 6. ResearchState（独立持久化对象）

字段（持久化到 `research_state` 表）：

| 字段 | 说明 |
|---|---|
| `subjectKind / subjectId` | 挂行业或公司 |
| `known` | 已确认事实引用 |
| `confirmed` | 证据充分的 Claim |
| `uncertain` | 证据不足、待验证 |
| `conflicting` | 矛盾 Claim 对 |
| `unknown` | 明确未知项 |
| `keyQuestions` | 最重要未答问题 |
| `researchGaps` | 缺口（关联 InformationPool） |
| `nextActions` | 推荐下一步（可执行） |
| `version / updatedAt` | 乐观锁 + 时间 |

能回答：研究什么、已知什么、验证了什么、哪些不确定/冲突/未知、最重要问题、Gap、下一步做什么及为什么。**进程重启不丢**。

与 Profile/Report 关系：Profile/Report 是 State+Knowledge+Pool+Evidence 的**投影/快照**，不是 SoT。

---

## 7. ResearchQuestion（一等公民）

`research_question(questionId, subjectKind, subjectId, statement, origin, status, priority, dependsOn, answerClaimRef)`。

示例：「机器人未来三年真实需求增长来自哪里」「客户为何买/不买」「产业链利润如何分配」「科大讯飞相关业务真实商业化进度」。

链路：Question → InformationRequirement → Evidence → Claim → ResearchTarget → DiligenceQuestion。

---

## 8. ResearchTarget ≠ Company（问题驱动）

`research_target(targetId, entityId, entityKind, chainPosition, capabilities[], knowledgeDomains[], likelyAnswerableQuestionIds[], limitations[], availability, researchValue, rationale, isFallback, fallbackFor?)`。

链路：ResearchQuestion → 所需信息 → 谁最有能力回答 → ResearchChain → Candidate → Capability 匹配 → Recommendation。

**Fallback 必须显式**：最佳目标 A 不可联系 → 推荐 B，标注 `isFallback=true`、`canAnswer=[q1,q2]`、`cannotFullyVerify=[q3]`，**不得伪装成最佳**。

---

## 9. ResearchChain（正式 Domain Object）

`research_chain(chainId, industryId, nodes[])`；节点类型：`upstream / component_supplier / manufacturer / integrator / distributor / customer / expert / consultant / service_provider / other`。节点间带依赖边。对象推荐由 Question 驱动，不是"行业龙头推荐"。

---

## 10. Diligence Preparation（一等能力）

`DiligencePreparationService` 输出 `DiligencePackage`：

- 调研目的、当前行业/公司认知、为何选该对象、对象简介与产业链位置
- 能/不能回答什么、研究缺口、核心验证问题
- 行业层面问题、公司层面问题、个性化问题、可能追问
- 需获取数据、需索取材料、注意事项、风险局限

**输入必须结合**：当前 ResearchState + ResearchQuestion + InformationGap + TargetCapability。**禁止通用模板式提纲**（旧 `tplOutline` 即反面教材）。

---

## 11. Field Research / FragmentInput（核心 E2E）

**Ingestion 流水线**：

```
FragmentInput（录音转写/纪要/Word/PDF/聊天/笔记/零散文字/Excel/图片）
  → Fragment（切片、定位）
  → Evidence Extraction（LLM Child Session）
  → Fact/Claim/Event 候选
  → Entity Resolution（归一到已有 Industry/Company）
  → Existing Claim Matching
  → Classification：
       NEW        （新信息，无对应旧 Claim）
       CONFIRM    （与已有 Claim 一致，补证据）
       UPDATE     （修正旧 Claim，保留旧版本）
       CONFLICT   （与已有 Claim 矛盾，并列保留，不覆盖）
       SUPERSEDE  （新 Claim 取代旧 Claim，旧标 superseded 但保留）
  → Evidence / Claim（带 stance、provenance、asOf、sourceType）
  → InformationPool 更新
  → Industry/Company Knowledge 更新
  → ResearchState 更新
  → 重算 Gap → 新 Question → 推荐下一步
  → 必要时向用户追问（"订单增长待验证，是否有具体增幅/其他材料？"）
```

**纪律**：
- **绝对禁止覆盖旧信息**：旧"预计收入约 100 亿"与新"实际订单或低于预期"分别存，建 Conflict/Update/Supersede/Temporal 关系。
- **Agent 主动提验证问题，不编造**：无数字 → 记"待验证" → 问用户。
- **碎片回来必须重进 Research Loop**（核心 E2E，重点测试）。

---

## 12. Evidence/Claim 与 Report

- **SoT**：Evidence/Claim/Fact/Event。
- **Report = Snapshot**：`State+Evidence+Claims+Knowledge+Pool → ReportPlan → Report → Critic → Evidence Verification → Final Report`。
- Report 必须 Evidence-linked：每个事实 Claim 可下钻到 EvidenceAssertion→Evidence→Source。标不确定性/冲突/证据不足、记录 FrameworkVersion 与研究时间。
- **禁止** LLM→Prompt→一篇看似合理的报告。

---

## 13. Evaluation Framework（版本化）

- `EvaluationFramework → FrameworkVersion → Criteria/Weights/Thresholds/ScoringRules`。
- v1/v2 可并存；历史 EvaluationResult 记录当时 frameworkVersionId。
- **处置 `scoring/index.ts:14` `ENTER_POOL_THRESHOLD=65`**：**DELETE LATER**，迁移到 `config/evaluation/<frameworkId>/v1.json` 并落 `framework_version` 表；代码只保留聚合数学（子分 0–10 × 权重 × 10）。

---

## 14. DataProvider 抽象

`ports/data-provider.port.ts`：`DataRetrievalRequest{purpose,subject,metrics,asOf,freshnessClass}` → `DataObservation{provider,rawRef,normalized,fetchedAt,cacheKey}`。

实现注册表（`config/data-providers.json`）：`WindProvider`（后端保留 `tools/wind_query.py`，消除双层静默 mock）、`WebProvider`、`LocalDocumentProvider`、未来 MCP/第三方。Domain/Application 只依赖 Port。**Phase 2 只实现内存/Echo Provider，不强行接 Wind。**

---

## 15. Storage（Local-first）

**目录**（`~/.tiancha/`）：

```
~/.tiancha/
  db/tiancha.sqlite
  knowledge/
    methodology/
    industries/<industryId>/
    companies/<companyId>/
    sources/            # 原始材料
  index/
    fulltext/
    vector/
  runs/<runId>/         # 工作目录、报告、附件
```

**SQLite 表（既有 + 新增）**：

既有 KEEP：`research_artifact`、`research_event`。

新增：
- 实体：`industry`、`company`、`company_industry_relation`、`research_chain_node`、`research_target`
- 认知：`research_state`、`information_pool_entry`、`knowledge_industry`、`knowledge_company`
- 方法论：`methodology`、`methodology_version`、`methodology_candidate`
- 评价：`evaluation_framework`、`evaluation_framework_version`、`evaluation_run`、`evaluation_result`
- 研究问题/动作：`research_question`、`next_action`
- 碎片/证据：`fragment_input`、`fragment`、`source`、`document`、`document_version`、`document_fragment`、`citation`、`evidence_assertion`（索引）
- 尽调/报告：`diligence_plan`、`field_outline`、`report_snapshot`、`report_claim`
- 储备：`reserve_transition`
- Runtime 落库：`research_run`、`research_round`、`research_task`

**文件系统**：原始材料、录音转写、附件、Report Markdown、Methodology 原文。Artifact blob 仍可走 `research_artifact.blob`（小对象），大文件走文件系统 + locator。

---

## 16. Retrieval（六式）

`ports/retrieval.port.ts` 统一入口：
1. **structured**：SQL 按字段/关系过滤。
2. **full-text**：SQLite FTS5 或 `index/fulltext/`。
3. **vector**：`index/vector/`，语义召回。
4. **hybrid**：structured + fulltext + vector 融合排序。
5. **metadata filtering**：subject/source/asOf/confidence。
6. **temporal filtering**：按 asOf/updatedAt 窗口；entity-aware retrieval（沿 Industry→Company→Claim→Evidence→Source 路径召回）。

**不要把 SQLite 或向量库任一当成全部知识。**

---

## 17. Event Store

沿用 Phase 1 `ResearchEventStore`（SQLite，长期可审计）。Pi EventBus 仅 transient/UI/telemetry。业务事件（行业发现/评分变化/证据新增/矛盾/储备变化/方法论激活）都落 durable。

---

## 18. Agent Interaction Layer（NL 优先，不暴露内部模型）

落位 `packages/research/src/interaction/`：

- `IntentRouter`：把 NL 映射到 ServiceCall，例：
  - "机器人值得研究吗" → `OpportunityDiscovery + IndustryResearch`
  - "下一步调研谁" → `ResearchPlanning + ResearchTargeting`
  - "我约到科大讯飞，帮我准备" → `DiligencePreparation(companyId=科大讯飞)`
  - "这是会议文字稿，你分析" → `FieldResearchIngestion`
  - "下一步研究什么" → `ResearchPlanning`
- `ContextAssembler`：结合 Session + ResearchState + Knowledge + Pool，让"机器人怎么样→那下一步呢→有没有值得调研的公司→我联系到其中一家→这是会议记录"连贯，不要求用户重复。
- `NLResponder`：把 Service 结果翻成自然语言；**不输出** State JSON / Task Graph / Agent 名。
- 用户纠正："这判断不对" → 找对应 Claim 标 `disputed/corrected`，不静默删；方法论层面 → `MethodologyCandidate` 等确认。

**五层分离**：Conversation Context ⊥ Research State ⊥ Knowledge ⊥ Information Pool ⊥ Evidence。Chat History ≠ Knowledge Base。

---

## 19. Migration（legacy host 退出路线）

| 阶段 | 动作 |
|---|---|
| t1（Phase 2 并行） | 新系统写 SQLite；旧 `data/*.json` 只读；`invest-extension` 标 legacy demo；新 CLI 子命令并行 |
| t2（Phase 3 末） | `tiancha industry/company/fragment/...` 接管；旧 `src/tools/*` 不再注册 |
| t3（Phase 6 末） | 删除 `src/store.ts`、`invest-extension.ts`、旧 tools；`wind-bridge` 转为 `WindProvider` 实现（消除静默 mock） |
| t4（Phase 8） | `tiancha` 默认 Research 模式；`src/cli/tiancha.ts:260` 的默认 `piMain` 改为进 Research REPL；Pi 仅 runtime/migration/compatibility |

---

## 20. Testing

- **KEEP**：现有 9 个测试（EventStore close/reopen、DAG）。
- **NEW 单元**：ResearchState 合并、Evidence Classification（5 类）、InformationPool 更新、FrameworkVersion 聚合、NextAction 翻译。
- **NEW 集成**：Fragment→Evidence→Claim→Pool→Knowledge→State 全链路。
- **NEW E2E**：7 个场景（§22）。
- **NEW 重启恢复**：kill 进程→重开→Industry/Knowledge/Pool/Evidence/Claims/State/原始材料都在。

---

## 21. Phase Plan（Phase 2–8）

| Phase | 名称 | 交付物 | 验收 |
|---|---|---|---|
| **2** | Knowledge Foundation + Industry Vertical Slice | Industry/ResearchState/InformationPool/KnowledgeIndustry/Framework v1/EchoDataProvider/IntentRouter 最小版 + SQLite 落盘 + 重启恢复 | 一份报告→Industry→State→Pool→Evidence→Claim→Knowledge→NextAction；kill 重启仍在 |
| **3** | Industry Research Engine | Framework/InformationRequirements/Gap Analysis/KnowledgeUpdate/ConflictResolution/Dynamic Profile/Evaluation Re-run | 新 Evidence 来→State 更新→重评 |
| **4** | Research Target Recommendation | ResearchChain/Target/Capability/Matching/Fallback | Question→候选 Target+理由+限制+fallback |
| **5** | Diligence Preparation | DiligencePackage 生成 | "帮我准备科大讯飞"→完整材料包，非通用模板 |
| **6** | Field Research Ingestion | Fragment 流水线 + 5 分类 + 回灌 Loop | 会议稿→Evidence→Claim→Pool/Knowledge/State 更新→NextAction（重点测试期） |
| **7** | Research Report | ReportComposer + Evidence QA | Report 每 Claim 可溯源，标不确定/冲突/缺证据 |
| **8** | Research Planning | PlanningService 闭环 | 据 Gap/重要性/价值/难度/变化/状态→下一步计划 |

---

## 22. 七个核心 E2E 验收场景

| # | 用户输入 | Agent 行为 | 系统状态变化 | 验收标准 |
|---|---|---|---|---|
| 1 | "机器人值得研究吗" | 意图路由→Industry 抽取/标准化→Information Requirements→Echo Provider 补全→Evidence/Claim→State | 建/匹配 Industry；State 有 known/gap/nextAction | 用户听到 NL 判断 + 推荐下一步；不暴露内部 JSON |
| 2 | "下一步调研谁" | 读 State/Gap→ResearchChain→候选 Target→Capability 匹配 | 产 TargetRecommendation(primary+fallback) | 推荐含"为什么/能答什么/不能答什么"；fallback 显式标注 |
| 3 | "我准备调研科大讯飞，帮我准备" | 结合 State+Question+Gap+TargetCapability→DiligencePackage | 无（只读投影） | 材料包个性化（引用当前认知与缺口），非七模块通用模板 |
| 4 | "这是昨天会议文字稿，你分析" | Fragment→Evidence 提取→Claim 匹配→5 分类→更新 Pool/Knowledge/State→新 Gap→NextAction | Pool/Knowledge/State 更新；旧 Claim 不被覆盖 | 系统回答"哪些被验证/改变/新增/冲突"+ 下一步 |
| 5 | "客户订单明显增加"（无数字） | 记"订单增长：待验证"，主动追问 | uncertain 增一项 | Agent 不编数字；问用户要增幅/材料 |
| 6 | 用户发来第二份材料（对同一 Claim） | 两份 Evidence 的 stance 被比对 | conflict/support 并列保留 | 系统列出双方来源与时间，不取平均 |
| 7 | State 更新后 | PlanningService 自动产 NextAction | nextActions 更新 | 含 kind/params/why；可直接翻译为 Task DAG |

---

## 23. 最小可运行 Vertical Slice（Phase 2 范围）

**In scope**：
- Domain：`research-state.ts / industry.ts / information-pool.ts / knowledge-industry.ts / methodology.ts / research-question.ts / next-action.ts / fragment-input.ts / evaluation.ts / source-document.ts`。
- Port：`data-provider.port.ts`（Echo/LocalFile 实现）、`research-repository.port.ts`、`retrieval.port.ts`（先 structured+fulltext）。
- Application：`OpportunityDiscoveryService / IndustryResearchService / ResearchPlanningService(只产 NextAction) / EvaluationService / KnowledgeUpdateService(简化版)`。
- Interaction：`intent-router.ts` 最小版（覆盖场景 1/4）。
- Storage：`industry / research_state / information_pool_entry / knowledge_industry / evaluation_framework* / research_question / next_action / fragment_input / source / document*` 表；`~/.tiancha/` 目录。
- CLI：`tiancha industry ingest/list/show/score/reserve`、`tiancha fragment add`、`tiancha ask "<自然语言>"`。
- 把 `config/scoring.json` 导入为 `FrameworkVersion v1`。
- Run/Round/Task 落库 + 重启恢复测试。

**Out of scope**：ResearchChain/Target/Diligence/Report/真实 Wind/Web/Scheduler/Web UI；删 legacy host。

---

## 24. 新增对象/服务/端口/表/测试清单（汇总）

**新增 Domain Object**：ResearchState、Industry、Company、InformationPool、KnowledgeIndustry、KnowledgeCompany、Methodology(Version/Candidate)、ResearchQuestion、ResearchTarget、ResearchChain、FragmentInput、EvidenceClassification、DiligencePlan、FieldOutline、ReportSnapshot、EvaluationFramework/Version/Run/Result、Source/Document/DocumentVersion/DocumentFragment/Citation、NextAction、ReserveTransition。

**新增 Application Service**：见 §3 表（12 个）。

**新增 Port**：DataProviderPort、ResearchRepositoryPort、InformationPoolStore、FragmentIngestPort、RetrievalPort、MethodologyReviewPort。

**新增 SQLite 表**：见 §15（~25 张）。

**新增测试**：见 §20（单元/集成/E2E/重启恢复）。

---

## 25. 反过度设计自检

| 模块 | 是否推进飞轮 | 决定 |
|---|---|---|
| ResearchState | 是（闭环枢纽） | 做 |
| 三资产 Knowledge | 是 | 做 |
| InformationPool | 是（Gap 的载体） | 做 |
| ResearchQuestion/Target/Chain | 是（闭环 C 核心） | Phase 4 做 |
| Diligence Preparation | 是（闭环 C） | Phase 5 做 |
| Fragment 流水线 | 是（闭环 Field） | Phase 6 做 |
| ReportComposer | 是（交付，但非 SoT） | Phase 7 做 |
| 向量检索 | 是（召回质量） | 先 structured+fulltext，vector 可后补 |
| 多 Provider | 是但不急 | 先 Port + Echo |
| Web UI | 否（不推进研究闭环） | 最后 |
