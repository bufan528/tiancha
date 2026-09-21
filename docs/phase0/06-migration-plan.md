# 06 · 分阶段迁移与开发顺序（Migration Plan）

> 版本：P0v3（Architecture Lock）
> 上游 commit：`19451accdeec671c1f4da9eafac8fc270f510ef4`
> 原则：**每阶段都保持可启动、可回归**；先搭骨架与兼容，再叠研究能力。不写实现代码。

## 1. 阶段总览（采集提前 + 先 SessionFactory/TaskRuntime + 产物协议先行）

| Phase | 主题 | 产出物 | 验收标准 |
|---|---|---|---|
| **1** | tiancha CLI + Runtime + **AgentSessionFactory(Port)** + TaskEngine/TaskGraph + **TaskAttempt / Artifact Contract / Durable Research Event Store** + Context + **.pi→.tiancha 迁移层**（并做 Pi 回归） | 改名 `tiancha`（保留 `pi` 别名）；`packages/research` 骨架；**TianchaAgentSessionFactory = AgentSessionFactoryPort**（子任务经标准 `createAgentSessionServices`+`createAgentSessionFromServices` 建标准子会话，**禁裸调 agentLoop**）；ResearchContext/Task/Run-Round-DAG 类型与空实现；**TaskAttempt**（`{attemptId,taskId,startedAt,endedAt,model,thinkingLevel,toolCalls,tokenUsage,cost,status,error,outputs(ArtifactRef[])}`）；**Artifact Contract**（`ResearchArtifact`/`ArtifactRef`/`ArtifactSchema`/`ArtifactStore` put/get/list by run/task）；**Durable Research Event Store**（SQLite EventStore + `ResearchEventAdapter` 桥接 transient `EventBus`）；**Migration Layer**（09）；兼容回归套件 | `tiancha --version/--help` 正常；原 Pi 全部子命令跑通；`ai/agent/coding-agent` vitest 全绿；聊天 resume/fork/compaction 不破坏；**research 不 import coding-agent（dependency gate）**；旧 `.pi`（全局与项目级）可检测/迁移/旧会话只读（migration gate）；TaskAttempt/Artifact/EventStore 三契约有空实现且 Task→outputs 统一走 ArtifactRef |
| **2** | PDF/解析/行业识别 + **自动采集基础设施（提前）** | 文档解析 pipeline、行业抽取、**SourceRegistry / IngestionSchedule / Collector / DocumentIngestJob / Dedup(ContentHash) / ChangeDetection / ImportanceScorer / IndustryExtractor**；**采集状态模型**：`SourceEndpoint {endpointId,kind,config,enabled}`、`FetchCursor {endpointId,lastFetchedAt,etag,lastModified,contentHash}`、`FetchStatus(success|partial|failed)`、`ExtractionStatus(pending|done|failed)`、`ChangeSet {added,changed,removed}` | 喂入研报抽出行业名+关键指标并生成 DAG；解析/采集失败不编造；重复内容按 ContentHash 去重；**能回答"从哪开始搜（FetchCursor/ETag/LastModified）、搜到了什么（contentHash/FetchStatus）、哪些是新增、哪些是变化（ChangeSet.added/changed/removed、ExtractionStatus）"** |
| **3** | Wind 适配器（管线分层） | `DataSourceAdapter` 抽象 + Wind 后端（接 `tools/wind_query.py`）；**Raw Response→Normalized Observation→Fact→Evidence** 分层；timeout/retry/cache/限流/凭证隔离 | 同一查询走缓存；失败返回 error 而非幻觉；凭证与 LLM key 分仓；Wind 字段落 Fact 带口径/单位/币种/版本；抽取产物经 ArtifactStore 登记 |
| **4** | 评分 / Critic / Contradiction | 读 `config/scoring.json` 7 维打分（每维所需证据 + EvidenceCoverage/Confidence/Freshness）、Critic 强模型复核、矛盾引擎（**先 Metric Ontology 对齐再判** + Freshness 分级） | 打分可回溯到来源；Critic 能打回缺证据；对齐后仍冲突才判矛盾并并列保留；score 产物为 `kind=score` 的 ResearchArtifact |
| **5** | 公司档案 / 尽调 / **HumanGate 持久化** | DossierEngine 聚合更新、版本留痕、尽调清单；**HumanGate 实体（gateId/status/resumeToken，跨进程可恢复）** | 新证据到后档案更新且旧 Score 不覆盖；行业达入池条件→gate 落 pending→次日重开 tiancha 可恢复；dossier 产物经 ArtifactStore/list by run 可查 |
| **6** | 报告 / 自检 | Report 渲染、质量门交付前自检、**Research Priority 一等输出**、**Target Discovery/Screening** | `/report` 含引用与评分快照；缺来源/评分不自洽自动打回；Priority 与 Focus Targets 可查；report/dossier 产物落 `kind=report|dossier` |
| **7** | 规划 / 日报 / 告警 / **Scheduler 升级** | ResearchPlanner 拆图、`/plan /gaps /changes /brief /targets /compare`、定时与矛盾告警（Scheduler 从基础设施升级为完整调度；**只增 jobs/schedules/triggers/queue/collectors，不引入 TaskGraph/HumanGate/ModelRouter**） | `/plan` 可看/改图；`/gaps` 列待补；矛盾/过时按 Freshness 分级触发提醒；采集态续跑用 FetchCursor 增量拉取 |

> **Phase 1 为什么先立 TaskAttempt / Artifact Contract / Durable Research Event Store（Architectural Lock）**：Task 的 `outputs` 必须统一走产物协议，不能等 Phase 2 各 Agent 先各自返回 `{}`、事后再补 adapter。若 Phase 1 不立三契约，则 Phase 2 起 Scout/Extractor/Critic/Writer 会各自定义返回结构，到 Phase 4 评分、Phase 5 档案要按 run/task 回挂产物时被迫大面积改接口。故 Phase 1 先给三契约的**空实现 + 形状**（TaskAttempt 记一次运行的成本/状态/outputs；ArtifactStore 统一 put/get/list by run/task；EventStore 把研究事件从 transient UI 事件里 durably 落库），后续 Phase 只填实现不改形状。

> 每阶段结束跑一次 03 §6/§8 的冒烟矩阵与分层测试；任一阶段不达标不进入下一阶段。
> **Web（`apps/web`）降级**：Phase 1–4 唯一主路径是 `tiancha` CLI + Pi Runtime + Research Runtime；`apps/web` 仅保留 SDK/RPC 接口设计，不作为前期主开发对象（见 05 §5）。

## 2. 阶段进入/退出条件（含 dependency gate / migration gate）

- **进入 Phase 2**：Phase 1 兼容回归全绿 **且 dependency gate 通过**（research 不 import coding-agent，Port 方向正确；TaskAttempt/Artifact/EventStore 三契约形状冻结）。
- **进入 Phase 2（额外）**：**migration gate 通过**（旧 `.pi` 全局与项目级检测/分类迁移/旧会话只读恢复可用，见 09）。
- **进入 Phase 3**：Phase 2 行业识别有稳定输入格式；采集基础设施可跑；SourceEndpoint/FetchCursor/ChangeSet 状态可读写。
- **进入 Phase 4**：Phase 3 能稳定取到 Wind 数据并完成管线分层；Fact/Evidence 产物经 ArtifactStore 登记。
- **进入 Phase 5**：Phase 4 评分/矛盾可用；HumanGate 持久化可用。
- **进入 Phase 6**：Phase 5 档案结构稳定。
- **进入 Phase 7**：Phase 6 报告与自检闭环。

## 3. 「现有资产 → Tiancha monorepo」搬运映射表

> 按职责拆；无对应业务代码的模块新建。逐文件迁移时保留 git 历史（`git mv`）。现有 `src\`、`.pi\`、`tools\`、`config\` 全部是 Tiancha 自己的组成，并入对应包，不存在外部/第二方遗留。
> **现状定位**：当前 `src/` 为 offline-mock 薄壳（硬编码分流/硬编码分数/双层 mock 降级，真实实体与引擎不存在），故下表标注"新建"的行均为 greenfield 落位，而非改造现状。

| 现有资产（按职责归类） | 目标落点 | 阶段 |
|---|---|---|
| 行业识别 / 赛道扫描逻辑 | `packages/research/src/planning/`（确定性 planner：research-planner/task-graph-builder）+ `agents/`（LLM collector agent） | 2 |
| PDF / 研报解析、文本抽取 | `packages/research/src/data/parsers/`（解析 pipeline） | 2 |
| 指标抽取、口径对齐 | `packages/research/src/evidence/`（evidence-extractor 抽取+分型）+ `domain/`（Fact/Claim/EvidenceAssertion） | 2–4 |
| **TaskAttempt 状态与成本记录**（新建） | `runtime/task-engine/`（结构）+ `storage/`（持久化） | **1** |
| **Artifact Contract：ResearchArtifact/ArtifactRef/ArtifactSchema**（新建） | `domain/`（实体） | **1** |
| **ArtifactStore：put/get/list by run/task**（新建） | `storage/artifact-store/` | **1** |
| **Durable Research Event Store（SQLite EventStore + ResearchEventAdapter）**（新建） | `storage/event-store/` + `runtime/research-event-adapter/`（桥接 transient EventBus） | **1** |
| Wind 查询封装（`tools/wind_query.py` 调用层） | `packages/research/src/data/adapters/wind/` | 3 |
| 其他数据源（web/reports/company/policy）适配 | `packages/research/src/data/adapters/` | 3–7 |
| **采集状态模型（SourceEndpoint/FetchCursor/FetchStatus/ExtractionStatus/ChangeSet）**（新建） | `scheduler/collectors/` | **2** |
| 评分计算、权重/锚点应用 | `packages/research/src/scoring/`（读 `config/scoring.json`） | 4 |
| Critic / 复核逻辑 | `agents/`（critic）+ `evidence/` | 4 |
| 矛盾检测、过时判定 | `evidence/contradiction`（行为层） | 4 |
| 公司/行业档案读写、版本 | `dossier/` + `storage/` | 5 |
| 尽调清单与结论 | `diligence/` | 5 |
| 报告生成、Markdown 渲染 | `reports/` | 6 |
| 交付前自检/质量门调用 | `agents/`（接 `agent-core` 的 `quality-gate.ts`） | 6 |
| 任务调度编排/并行 | `runtime/orchestrator/`、`runtime/task-graph/`、`runtime/task-engine/`（运行时，非 scheduler） | 1+ |
| **子会话工厂（Port）** | `runtime/child-session/`（research 定义 `AgentSessionFactoryPort`；coding-agent 注入 Pi 原生实现） | 1 |
| 模型按任务路由 | `runtime/model-router.ts`（复用 `model-resolver`；**归 runtime，不归 scheduler**） | 1 |
| 人机确认（入储备库/重大结论） | `runtime/human-gate.ts`（持久化实体；**归 runtime，不归 scheduler**） | 5+ |
| 自动采集基础设施 | `scheduler/`（SourceRegistry/Collector/Dedup/ChangeDetection + SourceEndpoint/FetchCursor/ChangeSet，提前到 Phase 2；Scheduler 完整升级在 Phase 7） | 2+ |
| ResearchMemory 组合（Evidence + Dossier + Event + ResearchHistory + Retrieval Index） | `retrieval/` + `storage/`（组合体，非单一 Memory 类） | 5–7 |
| 定时/日报/告警 | `scheduler/`（jobs/schedules/triggers）+ `reports/` | 7 |
| 研究库 schema/迁移 | `storage/` + 根 `migrations/`、`schemas/` | 1 起持续 |
| **Web 工作台 UI + `src/server.ts`** | **`apps/web/`**（同一 runtime 的 Web 视图层，经 SDK/RPC 驱动，不另起内核/存储；见 05 §5） | 1+ |
| **`.pi/` 扩展/skills（全局 `~/.pi/agent` 与项目级 `<cwd>/.pi`）** | 根 `extensions/`、`skills/`（全局映射 `~/.tiancha/agent`；项目级映射 `<cwd>/.tiancha`，见 09） | 1+ |
| **`config/`（scoring.json 等）** | 根 `config/` + `packages/research/src/scoring/` 读取 | 1 |

## 4. 不在本期范围（明确边界）

- 重写 agent 运行时 / reducer——不做（用多标准子会话 + hook）。
- 改既有 LLM provider——不做（数据源走 DataSourceAdapter）。
- research 直接 import coding-agent——不做（dependency gate，走 Port）。
- 让 `scheduler/` 承担 TaskGraph / HumanGate / ModelRouter——不做（这三者归 `runtime/`，scheduler 只管调度与采集）。
- Web 工作台（`apps/web`）Phase 1–4 不作主开发对象；仅做视图层接口设计，不复制内核逻辑、不复制存储；研究能力一律复用 `packages/research`。

## 5. 交付纪律

- 每阶段：先写/跑兼容回归，再叠研究代码；文档（本文系列）随实现同步回填。
- Phase 1 三契约（TaskAttempt/Artifact/EventStore）形状一旦冻结，后续 Phase 只填实现、不改形状；确需改形状须回改 05/06 并升版本。
- 任何破坏 03 兼容契约的改动必须先评估再动；发现工具链问题如实记录，不伪造通过。
