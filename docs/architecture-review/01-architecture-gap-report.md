# 01 · Architecture Gap Report（业务目标一致性审查）

> 基于 Phase 1 实际代码审查，2026-09-22
>
> 审查对象：`packages/research/src/`（63 个 TS 文件）、根 CLI `src/cli/tiancha.ts`、对照旧宿主 `src/` 与设计文档 `docs/phase0/04`、`docs/phase0/08`、`docs/SCORING_MODEL.md`、`config/scoring.json`。
>
> 审查立场：Tiancha 是一级市场投资研究的 **Research Operating System / 研究工作流 Agent**，闭环为「已知→未知→下一步研究→执行→更新认知→再决策」。本文只诊断、不实现。

---

## 0. 一句话结论

Phase 1 把**研究 Runtime 骨架**（Run/Round/Task/TaskGraph/TaskAttempt/Artifact Contract/Event Store/Child Session/HumanGate/迁移层）做得干净且方向正确；但**四个业务闭环所需的领域对象几乎全部缺位**——没有 `ResearchState`、没有 `Industry/CanonicalIndustry`、没有 `Company`、没有版本化 `EvaluationFramework`、没有 `DataProvider`、没有 `FragmentInput`、没有 `Question/Event/Source/Document/Diligence/Report`。更严重的是，仓库根 `src/` 还跑着一套**并行的旧宿主**（flat-JSON 档案 + `invest-extension` 的 offline-mock 硬编码回复 + `wind-bridge` 双层静默 mock），它目前才是 `tiancha` 默认命令真正加载的东西，存在把产品带向「PDF+RAG+自动报告聊天机器人」的现实风险。

---

## 1. 当前已正确支持的部分（Phase 1 基础设施，不应动）

| 能力 | 真实落点 | 评价 |
|---|---|---|
| Run/Round/Task 三层状态机分离 | `domain/run.ts`（6 态）、`domain/round.ts`（5 态，含 `rejected`）、`domain/task.ts`（6 态） | 与 04 §1.2 完全一致；终态集合用 `RUN_TERMINAL_STATUSES`/`TASK_TERMINAL_STATUSES` 常量集中表达 |
| 单轮严格 DAG、跨轮靠新建 Round | `domain/task-graph.ts`：`buildTaskGraph` + Kahn `validateDAG`，环/缺节点显式报错 | 纯函数、无 LLM、无副作用，可直接复用 |
| Task 不可变、重试走 TaskAttempt | `domain/task.ts`（一旦 running 不改变量）、`domain/task-attempt.ts`（1..N attempt，`outputs: ArtifactRef[]`） | 与 04 §1.1.1 一致 |
| Artifact Contract（产物只存引用） | `domain/artifact.ts`：`ArtifactKind = fact|claim|evidence|score|report|dossier`；`Task.outputs`/`TaskAttempt.outputs` 只持 `ArtifactRef` | 红线「Task 输出不绕过 Artifact」在新包内已守住 |
| 持久化 ArtifactStore | `storage/artifact-store.ts`：SQLite 表 `research_artifact(..., blob JSON)`，`put/get/listByRun/listByTask` | 跨进程可重开，locator 前缀 `sqlite:research_artifact` |
| Durable Event Store（区别于 transient EventBus） | `storage/research-event-store.ts`：SQLite 表 `research_event(...)`；`runtime/research-event-adapter.ts` 同时扇出到 Pi EventBus（UI）与 SQLite（历史） | 红线「EventBus 不当长期历史」已守住 |
| ResearchEvent 类型枚举 | `domain/research-event.ts`：11 个事件类型，含 `industry_discovered/score_changed/evidence_added/contradiction_detected/human_gate_created|decided/dossier_updated/round_created/task_attempt_started|finished/report_published` | 与 04 §11.1 一致 |
| HumanGate 安全原语 | `runtime/human-gate.ts`：`generateResumeToken`（32 字节 base64url）、`hashResumeToken`（SHA-256）、`consumeResumeToken`（scope 绑定 + 单次消费 + 过期 + `timingSafeEqual`） | 跨进程可恢复、防重放，与 04 §9 一致 |
| Child Session 是唯一 LLM 入口 | `ports/agent-session-factory.port.ts`：`AgentSessionFactoryPort.create`；`runtime/task-engine.ts` 只经 factory 开 session；`packages/research` 不 import `@earendil-works/pi-coding-agent` | 红线「不裸调 agentLoop / 不建第二套 Session」在新包内守住 |
| 资源注入走 Pi 真实 channel | `ports/research-context-provider.port.ts` + `ports/resource-loader-factory.port.ts`：把 `ResearchContext` 映射到 `systemPrompt/appendSystemPrompt/promptsOverride/agentsFilesOverride` | `domain/research-context.ts` 注释明确「不把 ResearchContext 当 raw session arg 传」 |
| 模型路由抽象 | `ports/model-resolver.port.ts` + `runtime/model-router.ts`：`ModelPolicy{tier,thinkingLevel}` → 具体 model id | 7 级 ThinkingLevel 在 `research-context.ts` 定义 |
| Composition Root 唯一接触 Pi | `src/cli/tiancha.ts`：全仓库唯一 import `pi-coding-agent` 的地方；品牌检测 `tiancha` vs `pi`；默认 `piMain(args)` 保留原 Pi 行为 | 迁移层 `migration/pi-to-tiancha.ts`（拷贝式、幂等、marker 文件）与 `migration/readonly-session-manager.ts`（写路径拒绝/分支重定向/compaction no-op）也符合 06/09 设计 |
| 迁移隔离 | `migration/readonly-session-manager.ts`：`appendMessage/branch` 抛 `ReadOnlySessionError` | T1/T3/T4 守卫齐全 |

**结论**：Runtime 骨架（TianchaRuntime/TaskEngine/Orchestrator/ResearchEventAdapter/HumanGate/Stores/迁移层）是 Phase 1 的正确资产，Phase 2 不应重写。

---

## 2. 与一级市场工作流一致的部分

| 设计承诺 | 代码落点 | 一致性 |
|---|---|---|
| Claim 正交分型（说什么/谁说的） | `domain/claim.ts`：`ClaimType`（descriptive/causal/forecast/interpretation/hypothesis）+ `Provenance`（official/management/analyst/expert/user/third_party）+ 独立 `Hypothesis{status: confirmed/refuted/open}` | 完全落地 04 §4.2；`conflictOfInterest` 字段已预留（management 默认 true 的规则待实现） |
| Evidence→Claim 是带立场断言 | `domain/evidence.ts`：`EvidenceAssertion{stance: support/contradict/contextualize/weaken, strength, confidence}` | 与 04 §4.3 一致；Contradiction Engine 应查 `stance=contradict` 的契约已具备 |
| 多形态 EvidenceLocator | `domain/evidence.ts`：`pdf_page / web / wind_field / interview` 四种变体 | 与 08 §3 一致；`wind_field{dataset,field,query}` 结构已留位 |
| Fact 是标准化「值」 | `domain/fact.ts`：`{subject, metric, value, unit, currency, asOf, caliber}` | 与 04 §4.1「FACT 不是 EvidenceType」一致 |
| 公司↔行业关系多型 | `domain/company-industry-relation.ts`：`relationType = primary/subtrack/chain_segment/application_scenario/tech_route` + confidence + 起止时间 | 与 08 §1 一致 |
| 目标筛选实体 | `domain/target-candidate.ts`：`ScreeningRun/ScreeningRule{predicate,weight}/TargetCandidate/TargetDecision{reserve/watch/reject}` | 与 04 §8.2 / 08 §8b 一致；筛选规则可组合，未硬编码 |
| 采集游标/变更集契约 | `scheduler/index.ts`：`SourceEndpoint/FetchCursor(etag/lastModified/contentHash)/FetchStatus/ExtractionStatus/ChangeSet` | 与 08 §11 一致；仅契约、无实现 |
| Agent 角色服从 Runtime | `domain/task.ts`：`AgentRole = planner/scout/resolver/analyst/critic/writer`；`agents/` 下 5 个文件仅 `interface XAgent { readonly role }` + 常量 | 角色是能力枚举、不是独立聊天系统——方向正确 |
| Dossier 是 Projection 非 Source of Truth | `dossier/index.ts` 注释明示；`DossierEngine.build` 直接 `throw new Error("Phase 2 placeholder")` | 设计立场正确；当前还没人写 dossier，所以暂无违反 |

---

## 3. 不一致的部分（逐项，引用具体文件）

### 3.1 缺核心领域对象（对照「必须强化的设计点」）

| # | 应有对象 | 代码现状 | 引用 |
|---|---|---|---|
| G1 | **ResearchState**（Known Facts/Supported Claims/Open Questions/Evidence Gaps/Conflicting Claims/Stale Information/Research Progress/Current Priorities/Recommended Next Actions） | **完全不存在**。`domain/` 下 14 个文件无 `research-state.ts`；`ResearchContext` 只是传给子会话的切片（`runId/objective/scope{openQuestions?:string[]}/systemPrompt`），不是持久化的研究认知状态 | `domain/research-context.ts:33-55` |
| G2 | **Industry / CanonicalIndustry**（identity、aliases、normalization、current profile、historical rounds、evaluation、information requirements、next actions、reserve 状态机） | **不存在**。`Industry` 仅作为标量 `industryId?/industryName?` 出现在 `ResearchRun`、`ResearchContextScope`、`ResearchTask.inputs` 上；没有别名表、没有标准化、没有新旧行业识别、没有入池状态机 | `domain/run.ts:31`、`domain/research-context.ts:48-55`、`domain/task.ts:56-62` |
| G3 | **Company**（一等研究对象） | **不存在**。只有 `companyId?/companyName?` 标量 + `CompanyIndustryRelation` 边表；没有 company 聚合根、没有公司研究状态、没有公司档案 | `domain/company-industry-relation.ts` |
| G4 | **EvaluationFramework / FrameworkVersion / Criteria / Weights / EvaluationRun / EvaluationResult**（可配置、版本化、历史留痕） | **不存在**。`scoring/index.ts` 只有 `DimensionSubscore{key,subscore,weight,evidenceCoverage,confidence,freshness}` + **硬编码常量 `ENTER_POOL_THRESHOLD = 65`**；`ScoringEngine.aggregate` 直接 `return 0`。`config/scoring.json` 是扁平 7 维配置，没有版本号、没有 Criteria 实体、没有「本次打分用了哪个 FrameworkVersion」的记录 | `scoring/index.ts:5-20`、`config/scoring.json` |
| G5 | **DataProvider / DataSource / DataConnector / DataRetrievalRequest** 端口 | **不存在**。`ports/` 下 7 个端口全是「如何跟 Pi 对话」（session/model/event/tool/resource/context/session），没有任何数据供给端口；`EvidenceLocator` 虽有 `wind_field` 变体，但没有对应的 Provider 抽象 | `ports/` 全目录 |
| G6 | **FragmentInput**（随手记/访谈/语音转写/聊天记录/Excel/PDF/图片/手写转录/零散观点/现场观察/管理层表述/客户反馈，且区分来源类型） | **不存在**。`scheduler/` 的 `SourceEndpoint/Collector` 是**自动采集端点**，不是人碎片输入；`domain/` 没有 `InboxItem/Fragment` 实体；来源类型（用户自调/管理层/客户专家/公开/第三方/Agent 推断/用户判断）只在 `Provenance` 枚举里有一半（official/management/analyst/expert/user/third_party），缺「Agent 推断」「用户个人判断」与「客户专家反馈」区分 | `scheduler/index.ts`、`domain/claim.ts:13-19` |
| G7 | **Question / Event / Source / Document / DocumentVersion / DocumentFragment / Citation / Diligence / Report / ReportClaim / Project / NextAction** | **全部不存在**。04 §3 与 08 §2 承诺的实体表里，`Question/Event/Source/Document/Citation/Diligence/Report/ReportClaim/Project` 在 `domain/` 下没有对应文件；`openQuestions` 只是 `ResearchContextScope` 上的 `string[]`，不是一等问题实体 | `domain/` 目录清单 |
| G8 | **跨层关系建模**（Company Evidence→Industry Claim；Industry Claim→Company Research Question） | **无法表达**。`Evidence.claimId` 是单值外键，`Claim` 上没有 `subjectKind: industry|company`、没有 `industryId/companyId` 归属；跨层「企业结果反改行业判断」与「行业判断生成公司问题」没有任何边模型 | `domain/evidence.ts:16-25`、`domain/claim.ts:30-38` |

### 3.2 运行时缺口（不是占位，是真没接）

| # | 缺口 | 证据 |
|---|---|---|
| R1 | **Run/Round/Task 状态在内存、不落库** | `runtime/task-engine.ts:28-30` 用 `Map<string, ResearchTask>()`、`Map<string, TaskAttempt>()`；`runtime/orchestrator.ts:19-20` 同样 `Map`。04 §3 说「Task 落库可恢复」，Phase 1 只把事件和 Artifact 落了 SQLite，Run/Round/Task 本体重启即丢 |
| R2 | **没有执行循环 / critic 打回新建 Round 的闭环** | `Orchestrator.startRound` 只 enqueue；`TaskEngine.start` 开了 child session 但 Phase 1 `noTools:true` 且不跑 LLM prompt；`complete()` 由外部调用。没有自动驱动 DAG 跑完、没有 critic 评审、没有「rejected→新建 Round 补缺口」的编排 | `runtime/orchestrator.ts:49-81`、`runtime/task-engine.ts:53-98` |
| R3 | **ResearchContextProvider 无实现** | 端口定义了，Composition Root `buildAgentSessionFactory` 直接内联 `resourceLoaderOptions = { noTools/noSkills/noExtensions/systemPrompt/appendSystemPrompt }`，没接 provider | `src/cli/tiancha.ts:67-73` |
| R4 | **TaskBudget 形同虚设** | `Orchestrator.startRun` 写死 `budget: { maxRounds: params.maxRounds ?? 5, maxCost: 0, maxTurns: 0 }`；`TaskAttempt.tokenUsage` 在 `start()` 里写死 `{ input: 0, output: 0 }`、`cost: 0` | `runtime/orchestrator.ts:40`、`runtime/task-engine.ts:65-67` |

### 3.3 与「可配置、不写死」红线的冲突

| # | 问题 | 位置 |
|---|---|---|
| H1 | **评分阈值硬编码常量** | `scoring/index.ts:14`：`export const ENTER_POOL_THRESHOLD = 65;`（虽 `config/scoring.json` 也有 `thresholds.enter_pool`，但代码里又写死一份，双源） |
| H2 | **旧宿主评分是硬编码模板** | `src/invest-extension.ts:120-148` `tplScore` 写死七维子分 `8/8/6/7/7/6 → 71/B`；`tplOutline/tplReport/tplPlanning/tplQA` 全是写死 Markdown |
| H3 | **行业抽取是子串匹配，不是标准化本体** | `src/invest-extension.ts:67-75` `extractIndustry`：先在 pool 名里 `text.includes(k)`，否则返回「该公司/该行业」占位。无别名归并、无同义标准化、无新旧行业识别 |
| H4 | **调研/报告模板写死** | 同上 `tplOutline`（七模块 28 问）、`tplReport` 全是硬编码 |
| H5 | **04 设计文档本身把权重写成「写死」** | `docs/phase0/04-research-kernel-design.md:310`「归一化（写死）」、`:314`「分档与入池阈值（写死）」。这与本次审查的新红线「评价体系可配置、版本化，禁止写死」**直接冲突**，需要在 Blueprint 里纠正为「聚合数学形式可固定、权重/维度/锚点/阈值全部版本化配置」 |

### 3.4 旧宿主并行系统（最现实的漂移风险）

| # | 问题 | 位置 |
|---|---|---|
| L1 | **存在第二套 Source of Truth** | `src/store.ts`：flat JSON 文件 `data/pool/industries.json`（seeded 人形机器人 A/84、固态电池 C/58）、`data/profiles.json`（markdown 全文 + history）、`data/materials.json`、`data/research.json`、`data/plans.json`。`profile_write` 工具直接 `writeProfile` + `upsertIndustry`——**这就是 Dossier/Profile 当事实源**，与新包 SQLite ArtifactStore 完全不通 | `src/store.ts:34-158`、`src/tools/profile_write.ts:19-29` |
| L2 | **存在第二个 LLM 聊天环** | `src/invest-extension.ts:370-387`：`registerProvider("offline-mock", { streamSimple: streamOfflineMock })`，自己做 intent 分类、自己 planToolCalls、自己吐 Markdown。它绕过 `AgentSessionFactoryPort`、绕过 Research Runtime——是红线「角色不做成独立聊天系统」的现实违反 | 同上 |
| L3 | **Wind 双层静默 mock** | `src/wind-bridge.ts:14-25`：Python 失败/无 stdout → 桥接层硬编码 5 个字段并标 `source:"mock-bridge"`；`tools/wind_query.py` 内 WindPy 不可用再内置 MOCK 数字。30s 超时、无 cache/限流/独立凭证仓。4.6 节要求「失败不编造、对无来源数字零容忍」尚未实现 | `src/wind-bridge.ts:9-34` |
| L4 | **keyword RAG 雏形** | `src/store.ts:161-178` `memorySearch`：对 pool 名 + material 正文做子串计数；`src/tools/material_ingest.ts`（未逐行读，但命名表明是材料入库）。这条路若继续长，就是「PDF 入库→关键词检索→模板报告」 | `src/store.ts:161` |
| L5 | **CLI 双轨且默认走旧轨** | `src/cli/tiancha.ts:260-261`：非 `research smoke`/`session readonly` 一律 `await piMain(args)`，即加载旧 invest-extension。`tiancha research smoke` 只验证骨架，不跑任何业务 | 同上 |

---

## 4. 可能导致「做成通用 Deep Research Agent」的具体风险点

1. **没有一级市场专属对象，泛化即必然**：当前 domain 里只有通用 Task/Artifact/Event/Evidence/Claim，没有 `Industry/Company/ResearchState/Reserve` 这些把系统钉在一级市场上的对象。Phase 2 若先做「PDF→Evidence→Report」，就会自然滑向通用 DR。
2. **offline-mock 已经是一个通用聊天 Agent 的雏形**：`classifyIntent` 只有 score/outline/report/planning/qa 五类，`tplReport` 输出的是通用「行业调研报告」Markdown，不区分行业机会发现 vs 公司尽调 vs 研究规划。
3. **`ResearchPlanner.plan(objective: string): ResearchTask[]` 过于通用**（`planning/research-planner.ts:6-8`）：输入只是一句目标，输出是一堆 Task，没有 `Gap→Question→Priority→NextAction(可执行)` 的闭环结构，容易被做成「LLM 自由列任务」。
4. **`EvidenceLocator` 的 `wind_field` 变体把 Wind 写进了领域模型**：虽然只在 locator 里，但端口层没有 DataProvider 抽象，未来很容易直接 `if (source === 'wind')` 写死。
5. **scoring 没有版本化**：一旦今天把 7 维写进代码，明天想加第 8 维或改权重就只能改代码，历史分也无法回答「这次评分用的是哪版框架」。
6. **没有 FragmentInput 一等入口**：碎片输入会被临时塞进某个 Task 的 `inputs.question` 字符串里，丢失来源类型与时间戳，最后变成 RAG 语料。
7. **agents/ 空目录诱惑**：6 个角色（planner/scout/resolver/analyst/critic/writer）已经在枚举里，很容易「为了看起来智能」先把每个角色塞一个 system prompt 跑起来，而不是先把 Research State 和 Vertical Slice 跑通。

---

## 5. 缺少的核心领域对象清单（核对代码后确认）

| 应新增 | 为什么必须有 | 落位建议 |
|---|---|---|
| `ResearchState` | 闭环 D 的核心；Planner 必须能读它来决定下一步 | `domain/research-state.ts` |
| `Industry` / `CanonicalIndustry`（含 aliases、normalizedName、reserveStatus、currentProfileRef、evaluationRefs、informationRequirements、nextActions） | 闭环 A/B 的一等对象 | `domain/industry.ts` |
| `Company`（含 identity、aliases、profile、researchRounds、claims、evidence、questions） | 闭环 C 的一等对象 | `domain/company.ts` |
| `EvaluationFramework` / `FrameworkVersion` / `Criterion` / `EvaluationRun` / `EvaluationResult`（含 snapshot：哪版框架、哪些 criteria、什么权重、基于哪些 evidence、何时、何结果） | 设计点 3 | `domain/evaluation.ts` |
| `DataProvider` / `DataSource` / `DataRetrievalRequest` / `DataObservation`（Raw→Normalized Observation→Fact→Evidence） | 设计点 4 | `ports/data-provider.port.ts` + `domain/data-observation.ts` |
| `FragmentInput`（含 kind、sourceType、capturedAt、rawRef、extractedText、tags） | 设计点 5 | `domain/fragment-input.ts` |
| `Question`（含 subjectId、subjectKind、statement、status、priority、originTaskId） | 闭环 D 的 Gap 表达 | `domain/question.ts` |
| `ResearchEvent`（业务事件，区别于 runtime 的 ResearchEvent） | 闭环 B「新 Event→Profile 更新→重评」 | `domain/event.ts` |
| `Source` / `Document` / `DocumentVersion` / `DocumentFragment` / `Citation` | 04 §3 承诺；Evidence 溯源链 | `domain/source.ts`、`domain/document.ts` |
| `NextAction`（kind: retrieve_data / read_material / research_company / interview / field_visit / wait_evidence / etc.，可执行、带参数、带依赖） | 闭环 D 要求「Planner 输出可执行下一步」 | `domain/next-action.ts` |
| `ReserveStatus` 状态机（discovered→candidate→watch→reserve→parked/dropped，带 transition 与 HumanGate 挂钩） | 闭环 A 末端 | `domain/reserve.ts` |
| `DiligencePlan` / `FieldOutline` / `Report` / `ReportClaim` | 闭环 C 末端 | `domain/diligence.ts`、`domain/report.ts`（Phase 2 可选） |
| `IndustryClaim` vs `CompanyClaim` 的归属维度（或 Claim.subjectKind/subjectId） | 闭环 A/C 跨层 | 扩 `domain/claim.ts`（新增字段，不改冻结语义） |

---

## 6. 需调整的模块边界

| 现状 | 问题 | 建议 |
|---|---|---|
| **没有 application/ 层** | `runtime/orchestrator.ts` 只管理 Run/Round 生命周期；「读一份行业报告→抽行业→标准化→打分」这种业务用例无处安放 | 新增 `packages/research/src/application/`，放 `IndustryResearchService`、`CompanyResearchService`、`DiligenceService`、`ReportService`、`PlanningService`、`OpportunityDiscoveryService`。runtime 仍是基础设施，application 编排业务流 |
| `agents/` vs `planning/` | 注释边界已对（`planning/research-planner.ts` 写明 deterministic、非 LLM；`agents/planner-agent.ts` 写明 LLM 角色），但两边都没实现 | 保持边界：deterministic 的 TaskGraph 构造留在 `planning/`；LLM 推理仍走 `AgentSessionFactoryPort`，agent 角色只是注入不同 `ResearchContext`/`ResourceLoaderOptions`，不自带 loop |
| `evidence/` 行为与 domain 实体 | domain 已有 `Evidence/EvidenceAssertion` 接口；`evidence/evidence-engine.ts` 是行为占位但不接 ArtifactStore | 让 `EvidenceEngine` 依赖 `ArtifactStore`（或新增 `EvidenceRepository` port），实现「按 claimId + stance 查证据」；`EvidenceExtractor` 负责把 Raw Observation→Evidence |
| `scoring/` 命名与归属 | 里面是单条分数记录 + 硬编码阈值，没有「框架」概念 | 演进为 `evaluation/`：`EvaluationFrameworkService` 读版本化配置；`EvaluationResult` 是 Artifact（kind=score）；硬编码 `ENTER_POOL_THRESHOLD` 删除，改由 FrameworkVersion 持有 |
| `dossier/` 定位 | 当前是空壳 + throw；旧 `src/store.ts` 的 profiles.json 才是真正的「写死的 dossier」 | dossier 只允许**读**（从 Artifact/State 投影），不允许写；旧 profiles.json 迁移或隔离 |
| `storage/` 只有两张表 | `research_artifact`、`research_event` 之外，缺 Industry/Company/ResearchState/EvaluationRun/Question/Fragment/Event 的表 | 新增 `storage/industry-repository.ts` 等 SQLite 实现；或在 artifact 表里加 `subject_kind/subject_id` 索引（推荐前者，便于查询） |
| `ports/` 缺业务端口 | 现有端口全围绕 Pi 集成 | 新增 `DataProviderPort`、`IndustryRepositoryPort`、`ResearchStateRepositoryPort`、`EvaluationFrameworkPort`、`FragmentIngestPort`；Composition Root 负责绑定 |

---

## 7. 哪些现有代码不动（Phase 1 基础设施，冻结）

- `packages/research/src/domain/` 现有 14 个文件的**冻结契约**（run/round/task/task-graph/task-attempt/artifact/research-event/human-gate/evidence/claim/fact/company-industry-relation/target-candidate/research-context）——**新增字段允许，不改语义**。
- `packages/research/src/ports/` 7 个端口。
- `packages/research/src/storage/artifact-store.ts`、`storage/research-event-store.ts`。
- `packages/research/src/runtime/` 全部 7 个文件（tiancha-runtime/task-engine/orchestrator/child-session/human-gate/model-router/research-event-adapter）。
- `packages/research/src/migration/` 全部 3 个文件。
- `packages/research/src/index.ts` barrel（只追加导出，不删）。
- `src/cli/tiancha.ts` 的品牌检测、迁移调用、`research smoke`、`session readonly` 子命令。

---

## 8. 哪些应重构/演进（不是重写）

1. **`scoring/` → `evaluation/`**：删 `ENTER_POOL_THRESHOLD` 硬编码；引入 `FrameworkVersion`；`ScoringEngine` 改为读配置 + 校验 EvidenceCoverage + 聚合。
2. **`evidence/` 接线**：`EvidenceEngine` 接 `ArtifactStore`，实现 stance 查询与 Contradiction 检测；`EvidenceExtractor` 接 `DataProviderPort` 的 Normalized Observation。
3. **`planning/` 升级**：`ResearchPlanner` 输入从 `objective: string` 改为「ResearchState + Gap 列表」，输出 `NextAction[]`（可执行），再由 builder 翻译成 Task DAG。
4. **`dossier/` 收敛为只读投影**：明确禁止 write；从 ResearchState + Artifact 投影出 Profile。
5. **Run/Round/Task 落库**：当前在内存 Map，Phase 2 需要持久化（否则跨进程 resume 不成立）。建议在 `storage/` 新增 `research-run-store.ts` 等，不动 domain 契约。
6. **旧宿主 `src/` 隔离**：
   - `invest-extension.ts` 的 offline-mock provider：在 Phase 2 Vertical Slice 跑通前**不要删**，但要标注「legacy demo，不经 Research Runtime」；跑通后用 `tiancha` 子命令替代。
   - `src/store.ts` 的 flat-JSON：新数据一律写 SQLite；旧 `data/pool/*.json` 仅作种子导入源，不再作为运行时读写目标。
   - `wind-bridge.ts`：作为第一个 `DataProvider` 实现的后端（保留 `tools/wind_query.py`），但消除双层静默 mock，失败必须显式报错。

---

## 9. Phase 2 应优先做什么（Vertical Slice 范围）

按用户重定向，Phase 2 不是「PDF→Evidence→Industry Dossier」，而是**行业机会发现闭环 A 的第一段 Vertical Slice**：

```
一份行业报告（本地文件/用户粘贴）
  → 识别行业名（LLM Child Session，非子串匹配）
  → 标准化 / 别名归并 → 建立或匹配 CanonicalIndustry
  → 生成行业信息需求清单（Information Requirements）
  → 从一个最小 DataProvider（先内置本地样本/空实现，不接 Wind）补全
  → Evidence / Claim（带 stance、provenance）
  → Industry ResearchState（Known/Open/Gap/Conflicting/Stale/NextActions）
  → Industry Profile（只读投影）
  → EvaluationFramework v1（从 config/scoring.json 导入为 v1 版本对象）
  → EvaluationRun → EvaluationResult（含 frameworkVersion 快照）
  → ReserveStatus 状态机推进（discovered → candidate → watch）
  → HumanGate(before_reserve) 落库
```

**范围内（in scope）：**
- 新 domain：`research-state.ts`、`industry.ts`、`evaluation.ts`、`fragment-input.ts`、`question.ts`、`next-action.ts`、`reserve.ts`。
- 新 port：`data-provider.port.ts`（先给一个 `EchoDataProvider`/`LocalFileDataProvider` 内存实现）。
- 新 application：`OpportunityDiscoveryService`、`IndustryResearchService`、`EvaluationService`。
- 新 storage：`industry-repository.ts`、`research-state-repository.ts`、`evaluation-run-store.ts`（SQLite 新表）。
- 新 CLI 子命令：`tiancha industry ingest <file>`、`tiancha industry list`、`tiancha industry show <id>`、`tiancha industry score <id>`、`tiancha industry reserve <id>`。
- 把 `config/scoring.json` 加载为 `FrameworkVersion v1` 并落库，作为版本化起点。

---

## 10. Phase 2 明确不做什么

- 不做 Company 深度调研、尽调计划、实地提纲、用户调研（闭环 C 留到 Vertical Slice 跑通之后）。
- 不做 Report 撰写 / ReportClaim QA 门（闭环 C/D 末端）。
- 不接 Wind/Web/新闻/券商报告等真实外部 Provider（先定义端口 + 内存实现）。
- 不做 Scheduler 自动采集（`scheduler/` 保持契约）。
- 不做 Web UI（仓库根 `web/` 不在本次范围）。
- 不重写 Pi Loop、不改 Runtime 冻结契约、不删迁移层。
- 不为「看起来智能」新增 Agent 角色实现——`agents/` 继续空着，LLM 调用仍走 `AgentSessionFactoryPort` + 不同 `ResearchContext`。
- 不把旧 `src/store.ts` 立刻删掉；只保证新数据不写回 flat-JSON。
- 不把 `dossier/` 做成可写存储。

---

## 11. 红线核对小结

| 红线 | 现状 |
|---|---|
| 不重写 Pi Loop | ✅ 新包未碰 |
| 不建第二套 Session | ⚠️ 新包合规；旧 `invest-extension.ts` 是第二个聊天环，待隔离 |
| Research Core 不依赖 coding-agent | ✅ `packages/research` 无 import |
| 不裸调 agentLoop | ✅ 只经 `AgentSessionFactoryPort` |
| Task 输出不绕过 Artifact | ✅ `outputs: ArtifactRef[]` |
| EventBus 不当长期历史 | ✅ 已扇出到 SQLite |
| Dossier 非 Source of Truth | ⚠️ 新包立场正确；旧 `src/store.ts` profiles.json 仍是事实源 |
| 评分规则不硬编码 | ❌ `scoring/index.ts:14` 硬编码阈值；旧模板硬编码分数 |
| Wind 非唯一数据源 | ⚠️ locator 预留多形态，但唯一 concrete 仍是 wind mock |
| 行业分类不写死 Prompt | ⚠️ 当前是子串匹配，需替换为可配置本体 |
| 公司筛选不写死 | ✅ `ScreeningRule.predicate` 开放字符串 |
| 调研模板不写死 | ❌ 旧 `tplOutline/tplReport` 全硬编码 |
| 角色不做成独立聊天系统 | ⚠️ 新包空；旧 extension 违反 |
| 不为「看起来智能」堆 Agent | ✅ `agents/` 空 |
| 不破坏 Phase 1 Runtime | ✅ 本次审查不改 |
| 不做成「PDF+RAG+自动报告」 | ⚠️ 旧 `memory_search` + `material_ingest` 有此倾向 |
| 双 CLI 非最终形态 | ⚠️ 当前 `tiancha` 默认 delegate 到 pi，属过渡 |

---

## 12. 关键发现摘要（≤10 条）

1. **Runtime 骨架可用**：Run/Round/Task/DAG/TaskAttempt/Artifact/EventStore/HumanGate/Child Session/迁移层全部到位且方向正确，Phase 2 不应重写。
2. **ResearchState 完全缺位**：这是四个闭环的枢纽，`domain/` 下没有任何对应文件，Planner 无法回答「已知/未知/下一步」。
3. **Industry/Company 不是聚合根**：只有标量 id 散落在 Run/Task/Context 上，没有别名、标准化、评价、储备状态机。
4. **评价体系未版本化**：`scoring/index.ts` 硬编码 `ENTER_POOL_THRESHOLD=65`，`config/scoring.json` 扁平无版本；与「可配置、版本化、禁止写死」红线冲突。
5. **没有 DataProvider 端口**：`ports/` 全是 Pi 集成端口，Wind 直接写在 `EvidenceLocator.wind_field` 里，且 concrete 实现是双层静默 mock。
6. **FragmentInput 一等入口缺失**：人碎片输入无处安放，未来会沦为 RAG 语料。
7. **跨层 Claim 归属缺失**：`Claim` 无 `subjectKind/subjectId`，无法表达「企业证据反改行业判断」与「行业判断生成公司问题」。
8. **Run/Round/Task 在内存 Map**：04 承诺的「落库可恢复」未实现，跨进程 resume 不成立。
9. **存在并行旧宿主**：`src/store.ts` flat-JSON + `invest-extension.ts` offline-mock 硬编码回复 + `wind-bridge.ts` 双层 mock，才是 `tiancha` 默认加载的东西，是「做成通用 DR / 自动报告」的现实风险源。
10. **application/ 层缺失**：runtime 只管生命周期，业务用例（行业报告→标准化→评价→储备）没有编排层；`ResearchPlanner.plan(objective)` 过于通用，需要升级为「读 State→产 NextAction」。
