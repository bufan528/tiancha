# 05 · 目录落地方案（File Change Plan）

> 版本：P0v3（Architecture Lock）
> 上游 commit：`19451accdeec671c1f4da9eafac8fc270f510ef4`
> 目标：把 `vendor\pi` 提升为 Tiancha monorepo 的一等 packages，新增 `packages/research`，并把现有宿主业务归并进来。本文只定目录与落点，不写实现代码。

## 1. 目标 monorepo 结构（根即 tiancha 根）

```
tiancha/                         # = D:\diaoyan-agent 根
├─ package.json                  # workspaces: packages/* （升级后）
├─ packages/
│  ├─ ai/                        # 原 vendor/pi/packages/ai
│  ├─ tui/                       # 原 vendor/pi/packages/tui
│  ├─ telemetry/                 # 原 vendor/pi/packages/telemetry
│  ├─ chord/                     # 原 vendor/pi/packages/chord
│  ├─ durable/                   # 原 vendor/pi/packages/durable
│  ├─ agent-core/                # 原 vendor/pi/packages/agent（包名已叫 pi-agent-core）
│  ├─ session-backends/          # 原 vendor/pi/packages/session-backends/*
│  ├─ protocol/  client/  server/ # 原 vendor/pi/packages/*
│  ├─ coding-agent/              # 原 vendor/pi/packages/coding-agent（改名 tiancha CLI/TUI，产品唯一入口）
│  └─ research/                  # ★ 新增研究内核（见 §2）
├─ apps/
│  └─ web/                       # Web 工作台（原宿主 src/ 的 Web 视图，见 §5）：同一 runtime 的 HTTP/SSE 视图层
├─ prompts/                      # 研究提示词（七步循环、critic、报告模板）
├─ skills/                       # 研究 skills（scan/industry/company/diligence…）
├─ extensions/                   # 内置研究扩展（注册 slash command、注入 section）
├─ schemas/                      # ResearchContext/Evidence/Score JSON schema
├─ migrations/                   # 研究库 schema 迁移
├─ tests/                        # 兼容回归（见 03 §6）+ 研究单测
├─ evals/                        # 研究任务评测集
└─ config/
   └─ scoring.json               # 原宿主 config/scoring.json（7 维权重/锚点/阈值）
```

> 迁移期可先保留 `vendor/pi/` 为子树，按 Phase 1–7 逐步 `git mv` 提升；提升后根 `package.json` workspaces 指向新路径，构建顺序沿用上游（见 01 §0）。

## 2. 新增 `packages/research` 内部结构（P0v3 定稿：目录边界 + 产物协议落位）

目录边界统一规范（逐字采用，Architectural Lock）：

- **`domain/` = 实体与 value object**：`evidence.ts`/`claim.ts`/`fact.ts`/`question.ts`/`score.ts`/`event.ts` 等纯数据结构与不变量；只放数据，不写行为。
- **`evidence/` = 证据行为层**：`evidence-engine`/`evidence-extractor`/`provenance`/`contradiction`；对 `domain/` 里的 Evidence/Claim/Fact 实体做抽取、溯源、矛盾判定。**domain 放实体、evidence 放行为，二者不混。**
- **`runtime/` = 执行运行时（不含调度）**：`task-engine`、`task-graph`、`orchestrator`、`child-session`、`human-gate`、`model-router`。
- **`scheduler/` = 调度与采集基础设施**：`jobs`、`schedules`、`triggers`、`queue`、`collectors`。**不含 TaskGraph / HumanGate / ModelRouter**——调度只负责"何时触发、拉什么、去重与变更检测"，任务图编排、人门禁、模型路由一律归 `runtime/`。
- **`agents/` = LLM agent**：`planner-agent.ts` 等由模型驱动的角色装配（Scout/Resolver/Analyst/Critic/Writer/Planner agent）。
- **`planning/` = 确定性规划引擎**：`research-planner`/`task-graph-builder`；纯函数式、可单测、不靠 LLM。**Agent ≠ Planner Engine**：`agents/` 里的 planner-agent 是 LLM 角色，`planning/` 里的 research-planner 是确定性图构建器，二者协作但分属不同目录。
- **检索/记忆统一用 `retrieval/`，持久化用 `storage/`**：`ResearchMemory` **不是单个 Memory 类**，它是 **Evidence + Dossier + Event + ResearchHistory + Retrieval Index 的组合体**，由 `retrieval/` 与 `storage/` 拼装而成，不新增一个大一统 `Memory.ts`。

新增产物协议与状态模型落位（P0v3 Architectural Lock，逐字采用）：

- **TaskAttempt**：`{ attemptId, taskId, startedAt, endedAt, model, thinkingLevel, toolCalls, tokenUsage, cost, status(running|succeeded|failed|aborted), error, outputs(ArtifactRef[]) }`。落位 `runtime/task-engine/`（结构与状态机定义）+ `storage/`（尝试记录持久化）。
- **Durable Research Event**：研究事件落 SQLite `EventStore`；Pi `EventBus`（`emit`/`on` 字符串通道）只管 transient UI；经 `ResearchEventAdapter` 桥接二者。落位 `storage/event-store/`（持久化）+ `runtime/research-event-adapter/`（桥接）。
- **Artifact Contract**：`ResearchArtifact { artifactId, kind(fact|claim|evidence|score|report|dossier), schemaVersion, ref(ArtifactRef{type,id 或 locator}), createdAt, taskId, attemptId }`；配套 `ArtifactRef` / `ArtifactSchema` / `ArtifactStore`（put/get/list by run/task）。落位 `domain/`（ResearchArtifact/ArtifactRef/ArtifactSchema 实体）+ `storage/artifact-store/`（ArtifactStore）。
- **自动采集状态模型**：`SourceEndpoint { endpointId, kind, config, enabled }`；`FetchCursor { endpointId, lastFetchedAt, etag, lastModified, contentHash }`；`FetchStatus(success|partial|failed)`；`ExtractionStatus(pending|done|failed)`；`ChangeSet { added, changed, removed }`。落位 `scheduler/collectors/`。
- **新增领域实体**：`EvidenceAssertion`、`CompanyIndustryRelation`、`TargetCandidate` 落 `domain/`。

```
packages/research/src/
├─ domain/        # 实体与 value object：Industry/Company/Fact/Claim/Evidence/Question/Score/Event/
│                # ResearchArtifact/ArtifactRef/ArtifactSchema、EvidenceAssertion/CompanyIndustryRelation/TargetCandidate
├─ application/   # ResearchService/IndustryResearchService/CompanyResearchService/
│                # DiligenceService/ReportService/PlanningService（应用服务，CLI 与 slash 共用）
├─ runtime/      # 执行运行时（不含调度）：ResearchRuntime/
│                # task-engine(TaskAttempt)/task-graph/orchestrator/child-session/human-gate/
│                # model-router/TianchaAgentSessionFactory + research-event-adapter
├─ agents/        # LLM agent 角色装配：planner-agent.ts / Scout/Resolver/Analyst/Critic/Writer/Planner(agent)
├─ tasks/         # TaskType/状态机/Run-Round-DAG 定义（与 runtime/task-engine 协作）
├─ evidence/      # 证据行为层：evidence-engine/evidence-extractor/provenance/contradiction
├─ dossier/       # DossierEngine：档案聚合/更新/留痕
├─ scoring/       # 读 config/scoring.json、7 维打分、EvidenceCoverage/Confidence/Freshness
├─ data/          # DataSourceAdapter（wind/web/reports/company/policy）+ 管线分层
├─ retrieval/     # 检索池 / Retrieval Index（ResearchMemory 组合件之一）
├─ diligence/     # 尽调清单与结论
├─ reports/       # Report 渲染（Markdown + 引用 + 评分快照）
├─ planning/      # 确定性规划引擎：research-planner / task-graph-builder（非 LLM）
├─ storage/       # 研究库（与聊天会话库物理隔离）：event-store(SQLite)/artifact-store/ + migrations
└─ scheduler/     # 调度与采集（不含 TaskGraph/HumanGate/ModelRouter）：jobs/schedules/triggers/queue/
                  # collectors(SourceEndpoint/FetchCursor/FetchStatus/ExtractionStatus/ChangeSet)
```

## 3. 现有资产归并映射（全部是 Tiancha 自己的组成部分）

> `D:\diaoyan-agent` 内只有一个产品 Tiancha：`src\`（server.ts + Web 工作台）、`.pi\`、`tools\`、`config\` 都是 Tiancha 的组成，最终全部并入本 monorepo 对应包，不存在外部/第二方遗留。

> **现状定位（据盲区核对报告）**：当前 `src/` 实为 **offline-mock 薄壳**——真正决定调用顺序的是 offline-mock 正则分流模板（`classifyIntent` + 硬编码 `planToolCalls("score")`），评分是模板硬编码的固定分数（如 71/B），`memory_search` 为无 embedding 的字符串包含匹配，Wind 桥接为双层静默 mock 降级；`domain/evidence/dossier/scoring` 等真实实体与引擎、DataSourceAdapter、HumanGate、ResearchTask 状态机/DAG **代码中均不存在**。因此 §2 目录树中的 `domain/`、`runtime/`、`evidence/`、`storage/event-store|artifact-store`、`scheduler/collectors` 状态模型等均为**新增落位（greenfield 骨架），而非对现状 src 的改造**；现状 src 仅按职责归并其薄壳代码到 `apps/web/` 与对应适配器壳，真实能力在 Phase 1–7 新建。

| 现有路径 | 归并到 | 说明 |
|---|---|---|
| `config/scoring.json` | `config/scoring.json`（根）+ `packages/research/src/scoring/` 读取 | 7 维权重/锚点/阈值；`EVALUATION` 任务注入其文本 |
| `tools/wind_query.py` | `packages/research/src/data/adapters/wind/`（后端进程） | 作为 Wind DataSourceAdapter 的执行后端；统一 timeout/retry/cache/限流/凭证隔离（04 §6） |
| `src/`（业务/内核逻辑） | 薄壳代码按职责拆入 `packages/research/src/{data,agents,scoring,…}` 对应壳位，通用内核能力进 `agent-core` | 现状为 offline-mock 薄壳，真实实体/引擎为新增落位（见上"现状定位"）；逐文件映射见 06 |
| `src/server.ts` + Web 工作台 UI | `apps/web/`（见 §5） | Web 视图层，不另起内核/存储，见 §5 |
| `.pi/`（扩展/skills） | `extensions/`、`skills/`（根）；产品配置目录改 `.tiancha/`（全局与项目级分别迁移，见 09） | 扩展事件机制不变（03） |
| `docs/CORE_CUSTOMIZATION.md` | 保留为 Fork 定制台账 | 本轮已登记 compaction/research 模块 |
| `docs/SCORING_MODEL.md` | 保留为评分基准 | 与 scoring.json 对齐 |

## 4. CLI 改名 `tiancha`（保留全部原 Pi 命令）

落点（见 01 §3.1、02 §2）：
- `packages/coding-agent/src/config.ts`：`APP_NAME` `pi`→`tiancha`；配置目录 `.pi`→`.tiancha`。
- `packages/coding-agent/package.json`：bin `pi`→`tiancha`，**同时保留 `pi` 别名**做兼容。
- `packages/coding-agent/src/cli/args.ts`：`printHelp` 品牌文案；**原有命令全部保留**（`--help/--version/-v`、`auth <cmd>`、`install/remove/uninstall/update/list/config`、`--resume`、包管理等）。
- 新研究子命令在 `cli/args.ts` **追加分发**，落到 `packages/research` 的对应入口。

## 5. Web 工作台（apps/web）接线：同一内核的视图层

Web 工作台**不是**外部遗留、也不另起一套内核/存储；它是**同一个 TianchaRuntime 内核的 Web 视图**。

- **落点**：`apps/web/`（由现有 `src/server.ts` + Web UI 归并而来）。它只是 HTTP/SSE 服务 + 前端页面，**不**包含研究编排逻辑。
- **驱动方式**：通过 Pi 既有的 **RPC/SDK**（`packages/protocol`、`client`、`server`、coding-agent `rpc-entry.ts`/`sdk.ts`）由 `TianchaRuntime` 驱动。Web 发起一个研究请求 = 经 SDK/RPC 调用 `packages/research` 的同一入口；CLI/TUI 与 Web 走**同一条代码路径**。
- **共享约束**：
  - **不另起存储**：Web 与 CLI/TUI 读写同一个研究库（`packages/research/src/storage/`）与同一份聊天会话库。
  - **不另起内核**：任务图、证据、评分、质量门全部来自 `packages/research`；Web 只订阅 runtime 事件（`events.ts` 事件总线；持久化研究事件经 `ResearchEventAdapter` 落 `storage/event-store/`）渲染进度/结果。
  - HTTP/SSE 只是**视图层传输**，可随时关掉，产品功能完全由 CLI/TUI 承载。
- **降级策略（P1-15）**：Phase 1–4 的**唯一主路径 = `tiancha` CLI + Pi Runtime + Research Runtime**。`apps/web` 此阶段**只保留接口设计**（SDK/RPC 契约、事件类型），**不作为前期主开发对象**；Web 实现排到 CLI/TUI 主路径跑通之后。
- **兼容**：RPC 协议消息形状不改，研究进度用**新事件类型**追加（对齐 03 RPC 契约）。

## 6. CLI 子命令与 TUI slash command 分离（P1-10）

两个入口、同一 Application Service：

- **`packages/coding-agent/src/cli/commands/`**：CLI 顶层子命令（`tiancha scan/industry/company/...`）。
- **`packages/coding-agent/src/interactive/slash-commands/`**：TUI 内 slash command（`/scan /industry ...`，经内置扩展注册）。
- **二者都调用 `packages/research/application/` 下同一组 Application Service**，不各自实现逻辑。

| 子命令 | 职责 | Application Service |
|---|---|---|
| `/scan` | 扫描新行业/赛道，产出初筛 | `PlanningService` + agents/Scout |
| `/industry` | 单行业深度研究（七步循环） | `IndustryResearchService`→TaskGraph |
| `/company` | 公司档案/关键指标 | `CompanyResearchService` + agents/Analyst |
| `/diligence` | 尽调清单与结论 | `DiligenceService` |
| `/notes` | 笔记/观察入库（USER_OBSERVATION） | application + `evidence/` + `storage/` |
| `/report` | 生成行业/公司报告 | `ReportService` |
| `/changes` | 档案/评分变更留痕 | dossier 版本 |
| `/why` | 解释某评分/结论依据 | scoring + evidence 溯源 |
| `/gaps` | 列出待补证据/未答问题 | PlanningService（Question） |
| `/plan` | 查看/编辑任务图 | runtime/TaskGraph |
| `/brief` | 一页纸摘要 | ReportService |
| `/targets` | 储备库/关注池列表（入池阈值 65） | dossier + Target Discovery |
| `/compare` | 多行业/多公司横向对比 | ReportService |

## 7. 风险与顺序

- 提升 packages 路径会改根 workspaces 与所有内部 `@earendil-works/*` 依赖；**先在 vendor/pi 内完成 Phase 1 回归，再整体提升路径**，避免一次性大爆炸。
- 模型数据 `providers/data/*.json` 为生成产物，提升后 CI/首跑仍需 `hydrate:model-data`。
- 聊天会话库与研究库**物理隔离**，保证 03 的 resume/fork 兼容；Web 视图层（`apps/web`）只经 SDK/RPC 访问同一 runtime，不直连两套存储。
- **薄壳风险**：现状 src 为 offline-mock 薄壳，§2 所列实体/引擎/状态模型均为新增。迁移期须防止把薄壳的硬编码行为（硬编码分数、静默 mock 数字）误当成"已实现能力"带入正式评分证据；mock 数据必须打标 `source` 且不得进入正式证据链（见盲区核对与 04 §6 修正）。
