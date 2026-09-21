# 02 · 内核定制落点（Core Modification Points）

> 版本：P0v3（Architecture Lock），上游 commit `19451accdeec671c1f4da9eafac8fc270f510ef4`
> 目标：把 Tiancha 的 11 个内核组件逐一映射到 Pi 源码层，标明「改哪个文件 / 用 hook·扩展点还是直接改源码」。原则：**能用 hook/扩展点就不改 runtime；必须改内核的，集中、增量、可追溯**（与 `docs/CORE_CUSTOMIZATION.md` 分工一致）。
> 本文不写实现代码，只定落点与机制。

## 0. 分层约定与依赖方向（P0-3，消除 package cycle）

**固定依赖方向（单向，禁止反向）：**

```
pi-ai  ↓  agent-core  ↓  research-core  ↓  coding-agent（Composition Root）
```

- **research-core（`packages/research`）绝不 import coding-agent**。它只定义 **Port 抽象**，由 coding-agent 在 Composition Root 注入 Pi 原生实现。
- research 内 Port：`AgentSessionFactoryPort` 在 P0v3 细化为**四个子 Port**——
  - `ModelResolverPort`：按任务角色解析 model/thinking（对应 ScopedModel）。
  - `ToolProviderPort`：提供/裁剪 tools 与 customTools。
  - `ResourceLoaderFactoryPort`：组装 `DefaultResourceLoaderOptions`（真实字段：`skillsOverride / additionalSkillPaths / additionalExtensionPaths / extensionFactories / extensionsOverride / systemPrompt / appendSystemPrompt / additionalPromptTemplatePaths / promptsOverride / agentsFilesOverride`），经 `createAgentSessionServices` 的 `resourceLoaderOptions` 通道注入。
  - `ResearchContextProviderPort`：把研究态映射到 `systemPrompt / appendSystemPrompt / additionalPromptTemplatePaths / promptsOverride / agentsFilesOverride` 通道。
- coding-agent（产品外壳）在 Composition Root 用 `createAgentSessionServices`/`createAgentSessionFromServices` 的 Pi 原生实现去满足这四个子 Port（见 07）。

| 层 | 源码位置 | Tiancha 是否改 |
|---|---|---|
| L1 LLM 抽象 | `packages/ai`（providers/models/oauth） | 仅加 DataSource 适配，不改既有 provider |
| L2 agent 运行时 | `packages/agent`（loop/runtime/hooks/compaction） | **Research-aware 增量（只加 Kernel Contract 接口与生命周期 hook，不加一级市场业务逻辑）**：8 项原语契约（见 §1.5） |
| L3 研究编排 | **`packages/research`**（research-core，只依赖 L1/L2 + Port） | 全新，承载一级市场业务实现：编排/任务图/证据/评分/报告 |
| L4 产品外壳 | `packages/coding-agent`（cli/session/extensions/system-prompt/Composition Root） | 品牌改名 + 子命令 + **实现并注入四个子 Port** |

> 现状口径（P0v3 盲区核对后校正）：本仓库 `diaoyan-agent/src` 当前为 offline-mock 薄壳；上列 L2/L3 落点为 **P0v3 目标态**。04 所述 `packages/agent/src/harness/research/{research-prompt,quality-gate,index}.ts` 与 `compaction.ts` 投研化提示词**不在本仓库 src**，属上游 Pi 包，需按本设计接入；本仓库现状评分由 offline-mock 模板硬编码（≈71/B），无真实评分计算。

## 1. 组件落点表

| 组件 | 目标职责 | 落在哪一层/文件 | 机制 |
|---|---|---|---|
| **TianchaRuntime** | 独立产品运行时：装配 ResearchContext、启动 orchestrator、暴露 CLI/SDK | L3 新建 `packages/research/src/runtime/tiancha-runtime.ts` + coding-agent Composition Root 注入 Port | 新增装配层，**不改** agent loop |
| **ResearchContext** | 与聊天 Context 分离的研究态数据（Project/Industry/Company/Fact/Claim…） | L3 `packages/research/src/domain/`（见 04/08 数据模型）；经 `transform_context` hook 注入 LLM | 数据模型新建；注入走 agent-core `transform_context` hook |
| **ResearchTaskEngine** | 单任务执行：经 **TianchaAgentSessionFactory** 建标准子会话、模型策略、产物收集 | L3 `packages/research/src/runtime/task-engine/`；**禁止裸调 agentLoop** | 复用标准 AgentSession（见 P0-2） |
| **ResearchTaskGraph** | 任务 DAG：依赖、并行、状态机；Run→Round→DAG | L3 `packages/research/src/runtime/task-graph/` | 全新；不进 runtime reducer |
| **ResearchOrchestrator** | 调度图、并行执行 Wind/Web/Reports/Company/Policy、限流 | L3 `packages/research/src/runtime/orchestrator/` | 全新；对每个 task 开**标准子会话** |
| **TianchaAgentSessionFactory**（P0-2 关键） | 封装 `createAgentSessionServices`+`createAgentSessionFromServices`；每研究子任务=标准子会话。**真实 API 形状见 §1.6**：model/thinking/tools 直传，skills/extensions/研究语境经 `resourceLoaderOptions` 注入，不裸调 agentLoop | L3 定义四个子 Port；coding-agent Composition Root 给 Pi 原生实现 | Port + 注入（见 07） |
| **ResearchMemory** | 长程记忆：档案更新、冲突/过时、跨会话检索池 | L3 `packages/research/src/retrieval/` + `storage/`；写入侧 `after_tool`/`message_end` hook，读侧 `before_run`/`transform_context` hook | hook 接入 + 新存储，不改 session 格式 |
| **EvidenceEngine** | Fact→Claim→Evidence→Source→Document→Citation 严格分型、抽取、置信度 | L3 `packages/research/src/evidence/`；抽取结果经 `after_tool` hook 落库 | 新建 + hook 捕获 |
| **DossierEngine** | 行业/公司档案聚合、更新、评分回填、版本留痕 | L3 `packages/research/src/dossier/` | 全新；orchestrator 在 task `completed` 后调用 |
| **ResearchPlanner** | 把用户问题/行业拆成任务图（plan→hypothesis→collect…） | L3 `packages/research/src/planning/`；提示词骨架复用已落地 `research-prompt.ts` 七步循环 | 新模块 + 复用既有骨架常量 |
| **ModelRouter** | 按任务角色/成本路由模型（采集用便宜模型、critic 用强模型） | L3 `packages/research/src/routing/`；coding-agent `model-resolver.ts` 已有 `ScopedModel` | **复用** `model-resolver.ts`，不改其逻辑 |
| **HumanGate** | 入储备库/重大结论/改档案前暂停并持久化等确认 | L3 `packages/research/src/runtime/human-gate/`；**持久化实体**（gateId/状态/resumeToken），非仅 followUp | 新建持久化门（见 04/08） |

### 1.5 Research-aware Agent Core：8 项 Kernel Contract / 生命周期原语（P0-1，增量非重写）

下表 8 项为 **Kernel Contract / 生命周期原语**：**L2（agent-core）只落接口与 hook，不含一级市场业务逻辑**；"原生"指接口/原语原生，其业务实现（TaskEngine/Dossier/Evidence/Scoring/HumanGate 持久化等）全部在 L3 `packages/research`：

| # | 原语 | L2 契约落点 | L3 业务实现（packages/research） |
|---|---|---|---|
| 1 | ResearchTaskLifecycle | `harness/research/` 生命周期事件/状态契约 | TaskEngine / TaskGraph |
| 2 | ChildSession | `core/sdk.ts` 子会话工厂（经 `resourceLoaderOptions` 注入，见 §1.6） | TianchaAgentSessionFactory |
| 3 | ResearchContextProvider | `harness/hooks.ts` `transform_context` | ResearchContext 注入 |
| 4 | TaskModelPolicy | `model-runtime.ts` ScopedModel 覆盖契约 | ModelRouter / routing |
| 5 | HumanGate primitive | `harness/research/human-gate` 挂起/恢复契约 | HumanGate 持久化实体（resumeToken 高熵 ≥256bit、落库只存哈希、单次使用） |
| 6 | Artifact contract | `harness/research/artifact-contract` | 任务 `outputs(ArtifactRef[])` 产出 |
| 7 | Research Event contract | `events.ts` transient EventBus + durable 适配接口 | SQLite EventStore + ResearchEventAdapter |
| 8 | Research-aware Compaction hook | `compaction.ts` 保护证据/评分 hook | Dossier 证据保护 |

### 1.6 Child Session / ResourceLoader / ModelRouter 真实 API 映射（P0v3 按核对报告锁定）

按 `vendor/pi/packages/coding-agent` 源码核对，子会话与资源注入的真实形状如下（**不得**把 skills/extensions/researchContext 当作 `createAgentSessionFromServices` 的直接参数）：

- **`createAgentSessionFromServices` 真实参数只有**：`services / sessionManager / sessionStartEvent / model / thinkingLevel / scopedModels / tools / excludeTools / noTools / customTools`。
- **`skills / extensions / researchContext` 都不是它的直接参数**；真实注入通道是 `createAgentSessionServices` 的 `resourceLoaderOptions`（即 `DefaultResourceLoaderOptions`，内部 `new DefaultResourceLoader(...)` + `await reload()`）。真实字段名：
  - skills：`skillsOverride / additionalSkillPaths`；
  - extensions：`additionalExtensionPaths / extensionFactories / extensionsOverride`；
  - 研究语境：`systemPrompt / appendSystemPrompt / additionalPromptTemplatePaths / promptsOverride / agentsFilesOverride`。
- **ModelRouter**：复用 `coding-agent/src/core/model-resolver.ts` 的 `ScopedModel`，不改其逻辑；任务级模型/thinking 经 `model / thinkingLevel / scopedModels` 直传子会话。
- 推荐调用链：组装 `DefaultResourceLoaderOptions` → `createAgentSessionServices({ cwd, agentDir, resourceLoaderOptions, resourceLoaderReloadOptions })` → `createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, thinkingLevel, scopedModels, tools, excludeTools, noTools, customTools })`。

## 2. 必须「直接改内核」的少量点（最小集）

1. **品牌/命令**（L3，`packages/coding-agent/src/`）
   - `config.ts`：`APP_NAME` `pi`→`tiancha`、`getAgentDir`/配置目录 `.pi`→`.tiancha`。
   - `cli/args.ts`：`printHelp` 文案；新增研究子命令分发（`/scan /industry /company …` 见 05）。
   - `package.json` bin `pi`→`tiancha`（保留 `pi` 别名做兼容）。
   - 风险低，纯字符串/路由。

2. **投研化压缩 hook**（L2，P0v3 目标态）
   - `packages/agent/src/harness/compaction/compaction.ts`：保留证据/评分的提示词节（hook 契约，业务规则在 L3）。

3. **研究扩展模块**（L2，P0v3 目标态）
   - `packages/agent/src/harness/research/`：8 项 Kernel Contract 接口 + 生命周期 hook。
   - **L2 改动边界（硬约束）**：只加 Kernel Contract 接口与生命周期 hook，**不加任何一级市场业务逻辑**（评分/证据/档案/门规则一律在 L3 `packages/research`）。04 所述 `harness/research/*` 复用文件不在本仓库 src，属上游 Pi 包，按本设计接入。

## 3. 用「hook / 扩展点」而不改 runtime 的点

| 需求 | 用哪个既有 hook/扩展点（文件） | 不碰 |
|---|---|---|
| 注入 ResearchContext 到 LLM | `transform_context`（`harness/hooks.ts`） | reducer |
| 交付前事实核查/自检 | `before_run_end` 返回 `followUp`（`drive/boundary.ts` 已支持）；复用 `quality-gate.ts` | boundary 逻辑 |
| 捕获工具结果落 Evidence | `after_tool`（`harness/hooks.ts`） | tools 实现 |
| 注入记忆/检索池 | `before_run`（`harness/hooks.ts`） | session 写入 |
| 压缩前保护证据 | `before_compaction`（可 `decline`/替换 summary） | compaction 算法 |
| 产品子命令/slash command | coding-agent 扩展 `runner.ts` 的 command 注册 + `cli/args.ts` 顶层分发 | agent loop |
| 系统提示词加研究 section | `buildSystemPromptSections` 的 `sections`（`system-prompt.ts`） | preamble |
| 模型按任务路由 | `model-resolver.ts` / `ScopedModel`（`model-runtime.ts`） | provider |
| 工具结果/流式事件给 TUI/RPC | `events.ts` 事件总线 | TUI 渲染 |

## 4. 不建议动的地方（红线）

- `packages/agent/src/harness/runtime/reducer.ts`、`lane.ts`、`drive/*`：状态机已自洽，研究并发**用多 Agent 实例/标准子会话（Child Session）**表达，不在单 lane 里塞任务图。
- `packages/ai/src/providers/*`：每家 provider 适配已复杂，新数据源（Wind/网页/报告）做成 **DataSource 适配层（L4）**，不要伪装成 LLM provider。
- `packages/tui`、`protocol/client/server`：除非要改渲染/协议，否则零改动；研究 UI 走 TUI 既有组件 + 扩展事件。
- Web 工作台（现有 `src/server.ts` + Web UI）：归并为 `apps/web/`，是**同一 TianchaRuntime 的 Web 视图层**，经 Pi 既有 RPC/SDK 驱动，不另起内核/存储（见 05 §5）；它不改内核契约，只消费 runtime 事件。

## 5. 结论

Tiancha 内核 ≈ **1 个新包 `packages/research`（承载一级市场业务实现：TaskEngine/TaskGraph/Dossier/Evidence/Scoring/HumanGate 持久化等）+ L2 仅新增 8 项 Kernel Contract 接口与生命周期 hook（不含业务逻辑）+ 1 次产品外壳品牌/命令改名**。8 项能力的"原生"指接口/原语原生，业务实现全部在 `packages/research`，不写进 agent-core。所有并发/记忆/质量门/人机协同都建立在既有 hook（`transform_context`/`before_run_end`/`after_tool`/`before_compaction`/`before_run`）之上，**不重写 agent 运行时**。
