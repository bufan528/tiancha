# 02 · Architecture Blueprint（Tiancha 研究操作系统蓝图）

> 基于 Phase 1 实际代码审查，2026-09-22
>
> 本蓝图承接 `01-architecture-gap-report.md`，定义 Phase 2 起的目标架构。原则：**复用 Phase 1 冻结 Runtime，补齐一级市场领域对象与应用层，把评价/数据/模板/分类全部从代码下沉为版本化配置**。本文只定结构与契约，不写实现代码。

---

## 0. 架构总览（分层）

```
┌─────────────────────────────────────────────────────────────────────┐
│ CLI / 未来 UI（src/cli/tiancha.ts；最终唯一入口）                    │
├─────────────────────────────────────────────────────────────────────┤
│ Application Layer（packages/research/src/application/，新增）        │
│  OpportunityDiscovery / IndustryResearch / CompanyResearch /        │
│  Diligence / Report / Planning / Evaluation / Reserve                │
├─────────────────────────────────────────────────────────────────────┤
│ Domain Layer（packages/research/src/domain/，既有冻结 + 新增）       │
│  Run/Round/Task/TaskGraph/TaskAttempt/Artifact/ResearchEvent/       │
│  HumanGate/Evidence/Claim/Fact/... +                                  │
│  ResearchState/Industry/Company/EvaluationFramework/Question/Event/ │
│  FragmentInput/NextAction/Reserve/Diligence/Report/Source/Document  │
├─────────────────────────────────────────────────────────────────────┤
│ Ports（既有 Pi 集成端口 + 新增业务端口）                              │
│  AgentSessionFactory/ModelResolver/EventBus/ToolProvider/... 既有    │
│  DataProvider/IndustryRepository/ResearchStateRepository/            │
│  EvaluationFramework/FragmentIngest（新增）                          │
├─────────────────────────────────────────────────────────────────────┤
│ Runtime（既有，冻结）                                                 │
│  TianchaRuntime/TaskEngine/Orchestrator/ChildSession/HumanGate/     │
│  ModelRouter/ResearchEventAdapter                                    │
├─────────────────────────────────────────────────────────────────────┤
│ Storage（既有 SQLite Artifact/Event + 新增业务表）                   │
│  ArtifactStore/ResearchEventStore（既有）                            │
│  Industry/Company/ResearchState/EvaluationRun/Question/Fragment/     │
│  NextAction/Event（新增 SQLite 表）                                   │
├─────────────────────────────────────────────────────────────────────┤
│ External：Pi Runtime（composition root 绑定）/ Data Providers / 用户  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Domain Model（实体关系）

### 1.1 关系总图（文字版）

```
Project (1) ──< (N) Industry
   │                  │
   │                  ├──< (N) CompanyIndustryRelation >── Company
   │                  │
   │                  ├──< (N) ResearchRound（行业维度）
   │                  ├──< (N) EvaluationRun >── EvaluationResult
   │                  ├──< (N) Question
   │                  ├──< (N) ResearchEvent（业务事件）
   │                  ├──< (N) InformationRequirement
   │                  └──> ReserveStatus（状态机）
   │
   ├──< (N) Company
   │        ├──< (N) ResearchRound（公司维度）
   │        ├──< (N) DiligencePlan >── FieldOutline >── InterviewNote
   │        ├──< (N) Question
   │        └──< (N) FragmentInput
   │
   └──< (N) ResearchRun（顶层研究目标）
            └──< (N) ResearchRound
                  └──< (N) Task
                        └──< (N) TaskAttempt
                              └──> ArtifactRef → ArtifactStore

Knowledge 层（跨行业/公司）：
  Source ──< Document ──< DocumentVersion ──< DocumentFragment ──< Citation
     │
     └──< Evidence ──(EvidenceAssertion: stance/strength/confidence)──> Claim
                                                                    │
  FragmentInput ──提取──▶ Evidence/Claim                            │
                                                                    ▼
  Fact ──支撑──▶ Claim                                      ResearchState
                              ▲                            （Known/Supported/Open/Gap/
                              │                            Conflicting/Stale/Progress/
  CompanyClaim ───────────────┘（企业证据可反改行业判断）   Priorities/NextActions）
                              │
  IndustryClaim ──生成──▶ Company Research Question
```

### 1.2 新增实体契约（字段要点）

**`ResearchState`**（`domain/research-state.ts`，闭环 D 核心）

| 字段 | 类型 | 说明 |
|---|---|---|
| `stateId` | string | 主键 |
| `subjectKind` | `"industry" \| "company"` | 挂在哪个一级对象上 |
| `subjectId` | string | industryId 或 companyId |
| `runId?` | string | 可空；不绑 Run 时是跨 Run 的持久认知 |
| `knownFacts` | `FactRef[]` | 已确认事实（artifact 引用） |
| `supportedClaims` | `{ claimId, evidenceStrength, confidence }[]` | 证据充分的结论 |
| `openQuestions` | `QuestionRef[]` | 未答问题 |
| `evidenceGaps` | `{ dimension, needed, current }[]` | 哪些维度缺什么证据 |
| `conflictingClaims` | `{ claimAId, claimBId, stance }[]` | 矛盾结论 |
| `staleInformation` | `{ factId, asOf, freshnessRule }[]` | 过期信息 |
| `researchProgress` | `{ phase, percent, lastRoundId }` | 进展 |
| `currentPriorities` | `PriorityItem[]` | 当前优先（04 §8 五维加权） |
| `recommendedNextActions` | `NextActionRef[]` | 推荐下一步（可执行） |
| `updatedAt` / `version` | string / number | 乐观锁 |

> **ResearchState 不是 Dossier/Profile**：Dossier/Profile 是 State + 底层 Fact/Claim/Evidence 的**可读投影**；State 是当前认知的结构化聚合，是 Planner 的唯一输入。

**`Industry` / `CanonicalIndustry`**（`domain/industry.ts`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `industryId` | string | 规范 ID |
| `canonicalName` | string | 标准化名 |
| `aliases` | `string[]` | 别名/曾用名/同义名 |
| `classification` | `{ system, code, path }` | 所属行业分类体系（可配置，非写死） |
| `firstDiscoveredAt` / `lastEvaluatedAt` | string | 新旧行业识别 |
| `reserveStatus` | `ReserveStatus` | 见 §6 |
| `currentProfileRef` | ArtifactRef? | 指向 Profile 投影（只读） |
| `currentStateRef` | stateId | 指向 ResearchState |
| `evaluationRunRefs` | `runId[]` | 历史评价（不覆盖） |
| `informationRequirements` | `InformationRequirement[]` | 已知缺什么 |
| `nextActionRefs` | `NextActionRef[]` | 下一步 |

**`Company`**（`domain/company.ts`）：`companyId / canonicalName / aliases / primaryIndustryId / companyIndustryRelations / currentStateRef / evaluationRunRefs / diligencePlanRefs / reportRefs / status`。

**`EvaluationFramework` / `FrameworkVersion` / `Criterion` / `EvaluationRun` / `EvaluationResult`**（`domain/evaluation.ts`）

| 实体 | 关键字段 |
|---|---|
| `EvaluationFramework` | `frameworkId / name / description / versions[]` |
| `FrameworkVersion` | `versionId / frameworkId / versionTag / criteria[] / weights / gradeBands / enterPoolThreshold / anchors / createdAt / isActive` |
| `Criterion` | `key / name / weight / anchorText / evidenceCoverageRule / direction: positive|negative` |
| `EvaluationRun` | `runId / subjectKind / subjectId / frameworkVersionId / basedOnEvidence[] / basedOnClaims[] / startedAt / finishedAt / triggeredBy` |
| `EvaluationResult` | `resultId / evaluationRunId / dimensionSubscores[] / totalScore / grade / rationale / createdAt` |

> 历史 `EvaluationResult` 必须记录：用了哪个 `FrameworkVersion`、哪些 `Criteria`、什么 `weights`、基于哪些 `Evidence/Claim`、何时、何结果。**聚合数学形式（子分 0–10 × 权重 × 10）可固定；维度/权重/锚点/阈值全部版本化配置。**

**`Question`**（`domain/question.ts`）：`questionId / subjectKind / subjectId / statement / originTaskId / status: open|in_progress|answered / priority / dependsOn[] / answerClaimRef?`。

**`ResearchEvent`（业务事件，区别于 runtime 的 ResearchEvent）**（`domain/event.ts`）：`eventId / subjectKind / subjectId / occurredAt / direction: positive|negative|neutral / summary / linkedClaimRefs[] / source`。

**`FragmentInput`**（`domain/fragment-input.ts`）：`fragmentId / kind: note|interview|voice|chat|excel|pdf|image|handwriting|observation|management_statement|customer_feedback / sourceType: user_self|management|customer_expert|public|third_party|agent_inferred|user_judgment / capturedAt / rawLocator / extractedText? / tags[] / industryId? / companyId? / ingestedBy`。

**`NextAction`**（`domain/next-action.ts`）：`actionId / subjectKind / subjectId / kind: retrieve_data|read_material|research_company|interview|field_visit|wait_evidence|request_manual_input / params: Record<string, unknown> / dependsOn[] / priority / rationale / status / createdBy: planner|user / createdAt`。

**`ReserveStatus`**（`domain/reserve.ts`）：枚举 `discovered → candidate → watch → reserve → parked` + 退池 `dropped`；每次 transition 记录 `{ from, to, at, by, reason, gateId? }`。

**`Source / Document / DocumentVersion / DocumentFragment / Citation`**（`domain/source.ts`、`domain/document.ts`）：补齐 04 §3 承诺的溯源链；`Evidence.sourceId` 现在有实体可指。

**`Claim` 扩展**（不改冻结语义，新增字段）：`Claim.subjectKind: industry|company|cross`、`Claim.subjectId: string`。这样「Company Evidence→Industry Claim」（subjectKind=cross 或 company 证据挂到 industry claim）与「Industry Claim→Company Research Question」可建模。

---

## 2. Application Layer（新增 `packages/research/src/application/`）

每个 Service 只依赖 domain + ports，不直接 new SQLite；输入输出都是 domain 对象或 ArtifactRef。

| Service | 职责 | 输入 | 输出 | 依赖端口 |
|---|---|---|---|---|
| `OpportunityDiscoveryService` | 闭环 A：吃外部报告/材料，抽行业、标准化、入池候选 | `IngestRequest{fileRef/text, sourceType}` | `IndustryDiscovered{industryId, matched, newAliases}` | `FragmentIngestPort`、`IndustryRepositoryPort`、LLM Child Session |
| `IndustryResearchService` | 闭环 B：维护行业 State/Profile/Event 响应 | `industryId` | `IndustryView{state, profile, recentEvents}` | `ResearchStateRepositoryPort`、`ArtifactStore` |
| `CompanyResearchService` | 闭环 C：从 Industry 选公司、推进公司研究 | `industryId` / `companyId` | `CompanyView` | 同上 + `ScreeningRun` |
| `EvaluationService` | 加载激活版 Framework，跑/重跑评价，落 EvaluationRun/Result | `industryId` 或 `companyId` | `EvaluationResult` | `EvaluationFrameworkPort`、`ArtifactStore` |
| `ReserveService` | 推进 ReserveStatus，挂 HumanGate(before_reserve) | `industryId, transition, reason` | 新状态 + gateId? | `IndustryRepositoryPort`、runtime HumanGate |
| `DiligenceService` | 闭环 C：生成尽调计划/实地提纲，吸收访谈碎片 | `companyId, state` | `DiligencePlan` | `FragmentIngestPort`、LLM |
| `ReportService` | 闭环 C 末端：从 State + Evidence 投影报告，跑 QA 门 | `subjectKind, subjectId` | `ReportArtifact` + QA 结果 | `ArtifactStore` |
| `PlanningService` | 闭环 D：读 ResearchState → Gap → Question → Priority → NextAction | `subjectKind, subjectId` | `NextAction[]`（可执行） | `ResearchStateRepositoryPort` |

**边界规则**：Application 层不 import Pi、不直接 SQL；一切 IO 走 Port。LLM 推理仍由 runtime `TaskEngine` 经 `AgentSessionFactoryPort` 开 Child Session 执行，Application 只构造 `ResearchContext`。

---

## 3. Research Runtime（复用 Phase 1）

**不动**：`TianchaRuntime / TaskEngine / Orchestrator / ChildSession / HumanGate / ModelRouter / ResearchEventAdapter`。

**承载四个闭环的方式**：
- 闭环 A：`OpportunityDiscoveryService` 调 `Orchestrator.startRun({objective:"discover <industry>"})`，建一个 Round，DAG 节点是 `extract_industry → resolve(标准化) → enrich(补全) → evaluate → human_gate(before_reserve)`。
- 闭环 B：Scheduler 或 CLI 触发「新 Event 到达」→ `IndustryResearchService` 更新 ResearchState → 触发新 Round `evaluate → dossier_update`。
- 闭环 C：`CompanyResearchService` 建 Run，DAG 含 `screening → select → diligence_plan → field_outline → interview → extract_evidence → dossier_update → report → critic → human_gate(before_major_conclusion)`。
- 闭环 D：`PlanningService` 产出 `NextAction[]` → 翻译为新一轮 Task DAG（每个 NextAction 一个 Task，`type` 映射见 §11）。

**需要补的两件事（不重写 Runtime，加扩展点）**：
1. **Run/Round/Task 持久化**：当前在内存 Map。在 `storage/` 新增 `research-run-store.ts` / `research-round-store.ts` / `research-task-store.ts`，让 `Orchestrator`/`TaskEngine` 重启可恢复。domain 契约不变。
2. **DAG 执行驱动**：当前 `complete()` 由外部调用。在 `Orchestrator` 加一个 `runRoundUntilSettled(roundId)`：按 topo 序调用 `TaskEngine.start/complete`，遇 critic 打回自动 `finishRound(rejected)` 并建新 Round。这是编排逻辑，不改 Runtime 冻结语义。

---

## 4. Research Knowledge Model（组织方式）

```
Source（出处：publishType/publisher/publishDate/quality）
  └─< Document（原始文档）
       └─< DocumentVersion（版本）
            └─< DocumentFragment（片段）
                 └─< Citation（片段 + EvidenceLocator）
                      └─< Evidence ─(EvidenceAssertion)─▶ Claim

Fact（标准化值）──支撑──▶ Claim

FragmentInput（人碎片）──EvidenceExtractor──▶ Evidence + Claim + Fact
```

- **Fact vs Claim** 严格分层（沿用 `domain/fact.ts`、`domain/claim.ts`）。
- **Evidence→Claim 带立场**（沿用 `EvidenceAssertion.stance`）。
- **Contradiction**：查 `stance=contradict` 的 EvidenceAssertion，先按 Metric Ontology 对齐口径再判冲突；冲突并列保留，不自动平均。
- **Freshness 分级**（04 §5.4）：实时价格小时级/市场日级/宏观月级/治理事件驱动/行业报告季-半年；`staleInformation` 由规则判定。
- **所有外部数据最终尽量转为 Evidence**：DataProvider 出来的 Raw Observation → Normalized Observation → Fact → Evidence（挂 Source）。

---

## 5. Research State（独立对象）

**字段**：见 §1.2。

**与 Dossier/Profile 的投影关系**：

```
ResearchState（事实聚合，可写）
   │
   ├──▶ IndustryProfile（只读投影：State + 最新 Fact/Claim/Event 拼成的可读视图）
   ├──▶ CompanyProfile（同上）
   └──▶ Dossier（旧词，等价于 Profile；dossier/ 只读，不写）
```

- Profile/Dossier **永不落盘为事实源**；每次查看时从 State + ArtifactStore 实时投影（或缓存为 Artifact，标注 `projectionOf: stateId`）。
- `DossierEngine.build` 当前 throw Phase 2 placeholder；Phase 2 实现时改为读 ResearchState 投影，**禁止写回**。

---

## 6. 闭环 A · 行业机会发现（Opportunity Discovery）

```
External Info（报告/碎片）
  → FragmentIngest（识别 kind/sourceType/capturedAt）
  → Document/Fragment/Citation 落库
  → LLM extract_industry（Child Session，非子串匹配；输出候选行业名 + 证据片段）
  → Normalization：在可配置 Industry Ontology 里匹配 canonicalName + aliases
  → 新行业？建 Industry；老行业？更新 firstDiscovered/lastEvaluated
  → 生成 InformationRequirements（基于 FrameworkVersion 的 evidenceCoverageRule 反推缺什么）
  → 调 DataProviderPort.retrieve(need) 补全（失败显式报错，不静默 mock）
  → EvidenceExtractor → Fact/Evidence/Claim（带 stance/provenance）
  → 更新 ResearchState
  → EvaluationService 跑 EvaluationRun → EvaluationResult
  → ReserveService 推进：discovered → candidate →（达 enterPoolThreshold）→ watch → HumanGate(before_reserve) → reserve
```

---

## 7. 闭环 B · 行业持续跟踪

```
CanonicalIndustry
  → ResearchState（跨 Run 持久）
  → 新 FragmentInput / DataProvider 新数据 / ResearchEvent（业务事件）
  → EvidenceExtractor 增量入库
  → ResearchState 更新（knownFacts/supportedClaims/conflicting/stale）
  → 若关键 Claim 变化或 stale → 触发新一轮 EvaluationRun
  → 若 EvaluationResult 变化 → ReserveService 重判（watch↔reserve↔parked）
  → PlanningService 产出 NextAction
```

**行业是长期对象**：Dossier 是投影，不是 Source of Truth。新 Evidence 来 → 更新 State → 投影自动变。

---

## 8. 行业 Evaluation（可配置、版本化）

```
config/evaluation/<frameworkId>/v1.json（或 DB 表）
  → EvaluationFrameworkService.loadActive() → FrameworkVersion
  → LLM Child Session 提 DimensionSubscoreProposal（每维子分+理由+引用 Evidence）
  → 确定性聚合：
       ① 校验 evidenceCoverageRule（缺证据该维不打分）
       ② 子分 0–10 × weight × 10 聚合 → totalScore 0–100
       ③ 按 gradeBands 分档 A/B/C/D
       ④ 与 enterPoolThreshold 比较 → 是否触发 HumanGate
  → 落 EvaluationRun + EvaluationResult（含 frameworkVersionId 快照）
  → 写 score_changed 事件
```

- **不硬编码**：维度/权重/锚点/阈值/gradeBands 全部在 `FrameworkVersion`；代码只保留聚合数学。
- **历史可追溯**：任意 EvaluationResult 可回答「用哪版框架、哪些 criteria、什么权重、基于哪些 evidence、何时、何结果」。
- **配置即版本**：改配置 = 新建 FrameworkVersion，旧 EvaluationResult 不受影响；可选「用新版本重跑历史行业」。

---

## 9. Industry Reserve（状态机）

```
discovered ──(识别到行业)──▶ candidate
candidate ──(补全信息)──▶ watch
watch ──(EvaluationResult ≥ enterPoolThreshold + HumanGate approved)──▶ reserve
reserve ──(长期无新证据/评分跌破阈值/重大风险)──▶ parked
任意态 ──(人工/drop)──▶ dropped
```

- 每次 transition 落 `reserve_transition` 记录（from/to/at/by/reason/gateId?）。
- 进 reserve 前必须挂 `HumanGate(type=before_reserve)`（沿用 `domain/human-gate.ts` + `runtime/human-gate.ts`）。
- 阈值来自 `FrameworkVersion.enterPoolThreshold`，不写死。

---

## 10. 闭环 C · 重点企业深度调研

```
Industry
  → ScreeningRun（按 ScreeningRule 可组合）
  → TargetCandidate（screeningScore/whyNow/risks）
  → TargetDecision(reserve/watch/reject)（人工或自动，留痕）
  → 选公司 → Company 聚合根
  → ResearchState（公司维度）
  → Information Gaps
  → DiligencePlan（含 FieldOutline）
  → 用户调研 / 实地 / 访谈 → FragmentInput
  → EvidenceExtractor → Evidence/Assertion/Claim/Fact/Event
  → Company Profile（投影）
  → Company Report（含 ReportClaim 证据链 QA）
  → 成果沉淀回 ResearchKnowledge；必要时反改 Industry Claim（跨层）
```

---

## 11. Diligence（尽调计划/提纲/碎片输入）

- **DiligencePlan**：`planId / companyId / goal / questions[] / fieldOutline[] / interviews[] / status`。
- **FieldOutline**：每条 `{question, hypothesisToTest, expectedEvidence, intervieweeType}`——模板从可配置 `config/diligence-templates/` 加载，**不写死在代码里**。
- **FragmentInput 一等入口**：`tiancha fragment add <file>` 或粘贴文本；必须选/推断 `kind` 与 `sourceType`（user_self/management/customer_expert/public/third_party/agent_inferred/user_judgment）。
- `provenance=management` 默认 `conflictOfInterest=true`；`user` 来源不自动当证据。

---

## 12. 闭环 D · Research Planning（Next Action 可执行）

**Planner 输入**：`ResearchState` + 目标。
**Planner 输出**：`NextAction[]`，每个必须能回答：
- 已知什么 / 哪些结论证据充分 / 哪些是推测 / 哪些过期 / 哪些冲突 / 哪些关键问题未答 / 哪些优先 / 下一步该查资料·取数·研究公司·访谈·实地 / 为什么。

`NextAction.kind` 枚举（可扩展配置）：
`retrieve_data | read_material | research_company | interview | field_visit | wait_evidence | request_manual_input | reevaluate | escalate_gap`。

每个 `NextAction` 翻译为一个 `Task`：

| NextAction.kind | TaskType | AgentRole |
|---|---|---|
| retrieve_data | `collect` | scout |
| read_material | `extract_industry` / `collect` | scout |
| research_company | `hypothesis` / `enrich` | analyst |
| interview / field_visit | `collect`（人输入后转 `extract`） | analyst |
| reevaluate | `evaluate` | analyst + critic |
| escalate_gap | new Round | planner |

**Planner 不只是文本建议**：输出是结构化 `NextAction[]`，由 builder 直接翻译成 Task DAG。

---

## 13. Data Provider（抽象层 + 未来接入点）

**新增 `ports/data-provider.port.ts`**：

```
DataRetrievalRequest {
  purpose: string          // 如 "tam" / "cagr" / "peers"
  subjectKind: industry|company
  subjectId: string
  metrics: string[]
  asOf?: string
  freshnessClass?: string  // 见 §4 分级
}

DataObservation {
  provider: string
  rawRef: ArtifactRef      // 原始响应存 Artifact
  normalized: NormalizedObservation  // 字段/单位/币种/时点归一
  fetchedAt: string
  cacheKey: string
}

DataProviderPort {
  listCapabilities(): string[]
  retrieve(req: DataRetrievalRequest): Promise<DataObservation>
}
```

**Provider 注册表**（可配置）：`config/data-providers.json`，未来可接：
- Wind（保留 `src/wind-bridge.ts` + `tools/wind_query.py` 作为后端，但消除双层静默 mock）
- Web 搜索 / 公司官网 / 新闻 / 券商报告
- 用户上传（走 FragmentIngestPort）
- 企业数据库 / 其他 MCP / 第三方 API

**失败纪律**：查询失败/超时返回 `{error}`，Task 走 retry 或 failed，**严禁模型补全**；mock 数据必须标 `source=mock` 且不得进入评分证据链。

---

## 14. Agent Roles（服从 Runtime）

角色清单（沿用 `domain/task.ts` 的 `AgentRole` 枚举）：

| 角色 | 职责 | 注入的 ResearchContext |
|---|---|---|
| `planner` | LLM 规划：读 State 产 NextAction | 完整 State + Priorities |
| `scout` | 行业/材料/数据采集 | 行业切片 + openQuestions |
| `resolver` | 同义归并/口径对齐 | 候选名 + 别名表 |
| `analyst` | 行业/公司分析、提评分子分建议 | 相关 Evidence + Claims |
| `critic` | 质量门：证据覆盖、矛盾、弱证据 | 本轮产出 + Coverage 规则 |
| `writer` | 报告撰写（闭环 C 末端） | State + Evidence 链 |

**服从 Runtime 的链路**：
```
Planner Service → ResearchRun/Round/Task
  → TaskEngine.start(taskId)
    → AgentSessionFactoryPort.create(ChildSessionOptions{role, researchContext, resourceLoaderOptions})
      → 标准 Pi Child Session
    → 产出只经 ArtifactStore.put
```

**禁止**：角色自带 loop、角色直连 DB、角色绕过 Artifact 输出。

---

## 15. Storage（持久化落位）

**复用 Phase 1（不动）**：
- `research_artifact` 表（ArtifactStore）
- `research_event` 表（ResearchEventStore）

**新增 SQLite 表（`storage/` 新增文件）**：

| 表 | 字段要点 | 对应实体 |
|---|---|---|
| `industry` | `industry_id PK / canonical_name / aliases_json / classification_json / reserve_status / first_discovered_at / last_evaluated_at / current_state_id / version` | Industry |
| `company` | `company_id PK / canonical_name / aliases_json / primary_industry_id / current_state_id / status` | Company |
| `company_industry_relation` | （沿用 domain 契约） | CompanyIndustryRelation |
| `research_state` | `state_id PK / subject_kind / subject_id / known_facts_json / supported_claims_json / open_questions_json / evidence_gaps_json / conflicting_json / stale_json / progress_json / priorities_json / next_actions_json / version / updated_at` | ResearchState |
| `evaluation_framework` / `evaluation_framework_version` / `evaluation_run` / `evaluation_result` | 见 §8 | Evaluation* |
| `question` | `question_id PK / subject_kind / subject_id / statement / status / priority / origin_task_id / answer_claim_ref` | Question |
| `research_business_event` | `event_id PK / subject_kind / subject_id / occurred_at / direction / summary / linked_claims_json` | 业务 Event |
| `fragment_input` | `fragment_id PK / kind / source_type / captured_at / raw_locator / extracted_text / tags_json / industry_id / company_id` | FragmentInput |
| `next_action` | `action_id PK / subject_kind / subject_id / kind / params_json / depends_on_json / priority / status / created_by` | NextAction |
| `reserve_transition` | `transition_id PK / industry_id / from_status / to_status / at / by / reason / gate_id` | Reserve 状态机 |
| `source` / `document` / `document_version` / `document_fragment` / `citation` | 溯源链 | Source/Document* |
| `research_run` / `research_round` / `research_task` | Run/Round/Task 落库（补 R1） | 既有 domain 实体 |

> Fact/Claim/Evidence 仍以 Artifact（kind=fact/claim/evidence）存 blob；但在 `research_state` 里持引用。如需跨 Claim 查 stance，加索引表 `evidence_assertion(evidence_id, claim_id, stance)`。

---

## 16. Scheduler（只放周期/触发）

`scheduler/index.ts` 现有契约（SourceEndpoint/FetchCursor/ChangeSet/Collector）保留。**不放 TaskGraph、不放 HumanGate、不放 ModelRouter**。

职责：
- 周期触发：每天/每周对 reserve 行业做 freshness 检查 → 发现 stale → 通知 `IndustryResearchService`。
- 事件触发：FragmentInput 到达 → 触发 `OpportunityDiscoveryService`。
- 增量采集：按 `FetchCursor` 拉新数据 → 产出 `ChangeSet` → 喂给 `DataProviderPort` / `EvidenceExtractor`。

---

## 17. CLI / 未来 UI（`tiancha` 为最终唯一入口）

**当前**（`src/cli/tiancha.ts`）：`research smoke`、`session readonly`、默认 delegate 到 Pi。双 CLI 是过渡。

**Phase 2 子命令规划**：

```
tiancha industry ingest <file>            # 闭环 A 入口
tiancha industry list [--status reserve|watch|candidate]
tiancha industry show <id>                # 投影 Profile + State
tiancha industry score <id>                # 跑 EvaluationRun
tiancha industry reserve <id>              # 推 reserve（挂 HumanGate）
tiancha industry drop <id>
tiancha company list <industryId>
tiancha company show <id>
tiancha planning next <subjectKind> <id>   # 产 NextAction
tiancha fragment add <file|->              # 碎片输入
tiancha run resume <runId>                # 跨进程恢复
```

**过渡策略**：
- `pi` 命令继续保留（双 CLI 过渡）；
- 旧 `invest-extension` offline-mock 在 Vertical Slice 跑通前继续作为 demo，但**不经 Research Runtime**；
- 跑通后，`tiancha` 默认进入 Research 模式，不再无差别 `piMain(args)`；
- Web UI（仓库根 `web/`）后续再做，消费同一套 Application 服务。

---

## 18. Phase 2 Vertical Slice 修订范围（in scope / out of scope）

**In scope（第一个 Vertical Slice，闭环 A 第一段）**：
1. 新 domain：`research-state/industry/evaluation/fragment-input/question/next-action/reserve`。
2. 新 port：`data-provider.port.ts` + 内存实现（`EchoDataProvider`）。
3. 新 application：`OpportunityDiscoveryService`、`EvaluationService`、`ReserveService`、`PlanningService`（只产 NextAction，不跑完整闭环 D）。
4. 新 storage：`industry/research_state/evaluation_*/question/next_action/fragment_input/reserve_transition` 表。
5. `config/scoring.json` 导入为 `FrameworkVersion v1` 并落库。
6. CLI：`tiancha industry ingest/list/show/score/reserve`、`tiancha fragment add`。
7. 把 Run/Round/Task 落库（补 R1）。

**Out of scope**：
- Company 深度调研、Diligence、Report（闭环 C）。
- 闭环 D 的完整 Planner 自动循环（先只产 NextAction，不自动跑新一轮）。
- 真实 Wind/Web 接入（先端口 + 内存实现）。
- Scheduler 自动采集。
- Web UI。
- 删旧 `src/store.ts` / `invest-extension.ts`（只隔离，不删）。

---

## 19. 与红线的对应

| 红线 | 蓝图如何保证 |
|---|---|
| 不重写 Pi Loop | §3 复用 Runtime；LLM 只经 Child Session |
| 不建第二套 Session | §14 角色不自带 loop；旧 offline-mock 标注 legacy |
| Research Core 不依赖 coding-agent | Application/Domain 只依赖 Port；composition root 唯一绑定 |
| 不裸调 agentLoop | §14 链路 |
| Task 输出不绕过 Artifact | 沿用 `outputs: ArtifactRef[]` |
| EventBus 不当长期历史 | 沿用 ResearchEventAdapter 双写 |
| Dossier 非 Source of Truth | §5 Profile 只读投影 |
| 评分规则不硬编码 | §8 FrameworkVersion 版本化 |
| Wind 非唯一数据源 | §13 DataProvider 注册表 |
| 行业分类不写死 | Industry.classification 来自可配置 Ontology |
| 公司筛选不写死 | ScreeningRule.predicate 开放 |
| 调研模板不写死 | §11 模板从 config 加载 |
| 角色不做成独立聊天系统 | §14 |
| 不为看起来智能堆 Agent | agents/ 继续空，按 Vertical Slice 按需启用 |
| 不破坏 Phase 1 Runtime | §3 不动 |
| 不做成 PDF+RAG+自动报告 | FragmentInput→Evidence→State→Evaluation→Reserve 闭环，非 RAG 问答 |
| 双 CLI 非最终形态 | §17 过渡策略 |
