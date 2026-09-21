# 01 · Pi 源码架构分析（Tiancha Phase 0）

> 版本：P0v3（Architecture Lock），上游 commit `19451accdeec671c1f4da9eafac8fc270f510ef4`（earendil-works/pi，MIT）
> 本文件仅基于实际读过的源码，给出关键文件路径与数据流，供 Tiancha 深度 Fork 定位用。不写实现代码。

## 目标架构总原则（最高层，P0-1，P0v3 锁定）

Tiancha 不是「Pi + 外挂 packages/research」，而是 **逻辑三层内生化**；Composition Root / Product Shell（品牌改名、CLI/SDK/Web 装配、Port 注入）是**横向装配层**，不与三层并列，以免造成"四层"歧义。

```
┌────────────────────────────────────────────────────────────┐
│  横向装配层：Composition Root / Product Shell                  │
│  （品牌改名、CLI/SDK/Web 装配、四个子 Port 的实现与注入；       │
│   只装配、不承载业务规则）                                     │
├────────────────────────────────────────────────────────────┤
│  ③ Tiancha Research Runtime（一级市场业务实现层）              │  ← packages/research
│     TaskEngine / TaskGraph / Orchestrator / Dossier /         │
│     Evidence / Scoring / HumanGate 持久化实体                  │
├────────────────────────────────────────────────────────────┤
│  ② Research-aware Agent Core（Kernel Contract/原语层）         │  ← packages/agent-core（增量，非重写 reducer）
│     只提供 8 项研究能力的接口/原语/生命周期 hook，              │
│     不含一级市场业务逻辑                                       │
├────────────────────────────────────────────────────────────┤
│  ① Pi Runtime（底座，原样复用，不重写）                        │  ← packages/ai / agent / coding-agent 原生
│     Provider / Auth / ModelRegistry / Session / Tools /        │
│     Skills / Extensions / MCP / RPC / SDK / TUI / CLI         │
└────────────────────────────────────────────────────────────┘
```

- **Pi Runtime（底座）原样复用**：provider/model/auth/session/hooks/tools/events/RPC/SDK/TUI/CLI 全保留，不重写。
- **Research-aware Agent Core = 8 项 Kernel Contract / 生命周期原语**：Agent Core 只定义研究能力的**接口/原语/hook**（"原生能力 = 接口/原语"），**不含一级市场业务逻辑**；下列 8 项的业务实现全部位于 `packages/research`，不写进 agent-core：
  1. **ResearchTaskLifecycle**：Run/Round/Task 任务生命周期事件/状态原语。
  2. **ChildSession**：子会话原语——经 `createAgentSessionServices` 的 `resourceLoaderOptions`（`DefaultResourceLoaderOptions`）注入的标准子会话创建通道。
  3. **ResearchContextProvider**：研究态注入原语（`transform_context` hook 契约）。
  4. **TaskModelPolicy**：任务级模型/thinking 策略原语（ScopedModel 覆盖契约）。
  5. **HumanGate primitive**：持久化人机门原语（挂起/恢复契约；resumeToken 高熵 ≥256bit、落库只存哈希、单次使用）。
  6. **Artifact contract**：结构化产物契约（任务 outputs 的 `ArtifactRef[]` 形状）。
  7. **Research Event contract**：研究事件契约（durable `ResearchEvent` 形状 + 与 transient Pi EventBus 的适配接口）。
  8. **Research-aware Compaction hook**：研究感知压缩 hook（压缩前保护证据/评分）。
- **Tiancha Research Runtime（`packages/research`）= 一级市场业务实现**：在 8 项原语之上实现 TaskEngine/TaskGraph/Orchestrator/Dossier/Evidence/Scoring/HumanGate 持久化实体，不侵入单对话 reducer。
- **不是重写 reducer**：单对话状态机保持自洽；研究并发用「多 Agent 实例/子会话」表达（详见 07）。

### P0v3 新增持久化实体位（目标态）

下列实体是 P0v3 Architecture Lock 新增的领域对象，跨文档定义逐字统一；本节仅标注其在三层中的落点：

| 实体 | 落点 | 关键形状 |
|---|---|---|
| **TaskAttempt** | ③ packages/research（TaskEngine），经 ① ChildSession 原语创建 | 一个不可变 Task 可有多次尝试。字段 `attemptId / taskId / startedAt / endedAt / model / thinkingLevel / toolCalls / tokenUsage / cost / status(running\|succeeded\|failed\|aborted) / error / outputs(ArtifactRef[])`。Task 1—N TaskAttempt |
| **EvidenceAssertion** | ③ packages/research（Evidence） | Evidence 与 Claim 的关系带立场。字段 `evidenceId / claimId / stance(support\|contradict\|contextualize\|weaken) / strength(0..1) / confidence(0..1)` |
| **Durable Research Event Store** | ③ packages/research（SQLite EventStore）；① Pi EventBus 仅承担 transient UI 事件 | 落 SQLite，字段 `eventId / runId? / roundId? / taskId? / industryId? / companyId? / type / payload(JSON) / occurredAt / source`。type 至少含：`industry_discovered、score_changed、evidence_added、contradiction_detected、human_gate_created、human_gate_decided、dossier_updated、round_created、task_attempt_started、task_attempt_finished`。Pi 的 EventBus（字符串通道 `emit(channel,data)` / `on(channel,handler):()=>void`）只跑 transient UI 事件，经 **ResearchEventAdapter** 转成 durable ResearchEvent |
| **Artifact Contract** | ② Kernel Contract（形状），③ packages/research（产出实现） | 任务 outputs 的 `ArtifactRef` 统一形状，供 Dossier / HumanGate / 报告引用 |

### 现状口径说明（P0v3 盲区核对后校正）

> **本仓库 `diaoyan-agent/src` 当前为 offline-mock 薄壳宿主**：`wind_query` 仅接受 `industry` 单参数、返回 5 个 mock 字段（`marketSize / cagr / listedCompanies / pe / leaders`），Node `execFile` 调 Python 子进程且双层静默 mock 降级；评分由 offline-mock 模板硬编码输出（七维子分 8/8/6/7/7/7/6，加权总分 **≈ 71 / 100、评级 B**），**无真实评分计算器、无 scores 历史追加**；Web 工作台 `server.ts` **无 `GET/PUT /api/scoring/config` 路由**；04 所述 `harness/research/*` 复用文件**不在本仓库 src**，属上游 Pi 包。
>
> 因此下文 §1–§6 是对**上游 Pi monorepo 源码**（目标基座）的分析；上列三层架构、8 项原语与新增实体位均为 **P0v3 目标态**，不是本仓库现状已具备的能力。目标态七维评分口径（与 `config/scoring.json` 逐字一致）：`market_growth 20% / policy_env 15% / competition 15% / tech_maturity 15% / commercialization 15% / exit_env 10% / risk_level 10%`，合计 **100%**；总分 = Σ(各维 0–10 子分 × 权重) × 10，归一到 **0–100**；入池阈值 **65**（A ≥ 80 / B 65–79 / C 50–64 / D < 50）。

> 下文 §1–§6 是对上游 Pi Runtime 源码（目标基座）的分析，作为上述三层的落点依据。

## 0. monorepo 总览

根 `package.json`：npm workspaces，`packages/*` 与 `packages/session-backends/*`。构建顺序（根 `build` / `build:offline`）：

```
chord → tui → telemetry → ai → durable → agent → session-backends/sqlite-node
      → protocol → client → server → coding-agent
```

- `chord`：最小响应式/事件基础库（被 runtime 用）。
- `tui`：终端渲染原语（`packages/tui/src/*.ts`：`terminal.ts`、`layout.ts`、`autocomplete.ts`、`keybindings.ts`、`theme/` 等），被 coding-agent 的 interactive 模式消费。
- `telemetry`：OpenTelemetry 封装。
- `ai`：LLM 统一抽象（见 §2）。
- `durable`：持久化/会话存储基础。
- `agent`：agent-core，运行时循环与 harness（见 §1）。
- `session-backends/sqlite-node`：会话 JSONL/SQLite 后端。
- `protocol`/`client`/`server`：RPC 协议与前后端（见 §4）。
- `coding-agent`：CLI + session + 扩展 + TUI 模式（见 §3）。

## 1. agent-core（`packages/agent`）—— loop / state / tools

包名 `@earendil-works/pi-agent-core`，入口 `src/index.ts`（`export * from agent.ts / agent-loop.ts / harness/*`）。

### 1.1 运行循环（loop）
- `src/agent-loop.ts`：纯函数 agent 循环。`agentLoop(prompts, context, config, signal, streamFn)` 启动新提示；`agentLoopContinue(context, ...)` 用于重试/继续。核心假设：**全程用 `AgentMessage`，只在 LLM 调用边界 `convertToLlm` 转成 `Message[]`**。
- `src/agent.ts`：`Agent` 门面 + `createMutableAgentState`。`systemPrompt`/`tools` 经 `createInitialSystemMessage(prompt, tools.map(toToolDeclaration))` 注入为头部 system message。`AgentState` 暴露 `systemPrompt / model / thinkingLevel / tools / messages / isStreaming / pendingToolCalls / errorMessage`。

### 1.2 运行时状态机（runtime）
`src/harness/runtime/`：
- `reducer.ts`：纯函数状态归约。
- `lane.ts`：单条对话 lane 的 inbox/队列（`steer`/`followUp`/`nextRun`/`write`）、`selectAcceptedInbox`、`followUpMode`/`steeringMode`。
- `drive.ts` + `drive/`：一次 operation 的推进（`generation.ts`、`response.ts`、`retry.ts`、`tools.ts`、`terminal.ts`、`boundary.ts`、`checkpoint.ts`、`recovery.ts`）。
- 关键：`drive/boundary.ts` 的 `finishRunBoundary` 调用 `before_run_end` hook；若返回 `{ followUp }`，则把它作为新 user message 追加并**继续 operation**（见 §1.4，这是质量门闭环的钩子）。

### 1.3 tools
`src/harness/tools/`：`read.ts`、`write.ts`、`edit.ts`（+`edit-diff.ts`、`file-mutation-queue.ts`）、`bash.ts`、`image.ts`、`path-utils.ts`、`tool-context.ts`。工具类型在 `src/types.ts` 的 `AgentTool<TParameters, TDetails>`（含 `label`、`execute`、更新回调 `AgentToolUpdateCallback`）。

### 1.4 hooks / events（扩展点核心）
- `src/harness/hooks.ts`：`HookRegistry`，按 `HookName` 注册，串行聚合执行。
- `src/harness/agent-harness.ts`：`HookMap`（事件→入参/返回）与 `AgentHarnessOptions`。已读 `HookMap` 关键项：
  - `before_run` `{prompt, resources}` → `{messages?}`
  - `before_drive` / `before_run_end` → `{runId, messages}` → **`{followUp?: string}`**（run 结束前注入 follow-up 形成循环）
  - `transform_context` `{messages, systemPrompt}` → `{messages?, systemPrompt?}`
  - `before_request` `{model, step, attempt, streamOptions}` → `{streamOptions?}`
  - `before_payload` / `after_response` / `before_tool` / `after_tool`（可 `block`/`terminate`/改 `content`）
  - `before_compaction` `{reason, preparation, customInstructions}` → `{decline?, compaction?}`
  - `before_navigation`（分支摘要）
- `src/harness/events.ts`：被动事件总线 `HarnessEventBus`（`on(type, listener)`、`watch(...)`、handler 失败隔离）。
- `src/harness/context.ts`：`Context`（含 `abortSignal`、telemetry、`getTelemetryContext`）。

### 1.5 compaction / session
- `src/harness/compaction/compaction.ts`：阈值判定 `shouldCompact`、切点 `findCutPoint`、`prepareCompaction`、`compact/compactWithRequest`、摘要 prompt 常量 `SUMMARIZATION_SYSTEM_PROMPT / SUMMARIZATION_PROMPT / UPDATE_SUMMARIZATION_PROMPT / TURN_PREFIX_SUMMARIZATION_PROMPT`（`Key Evidence & Scoring` 投研化摘要节为 P0v3 目标态；本仓库当前薄壳未落地，见文首"现状口径说明"）。
- `src/harness/session/`：`session.ts`、`context.ts`、`fork.ts`、`jsonl/`（codec/io/repo/storage）、`testing/`。Entry 模型（`message`/`compaction`/`branch_summary`/`custom`）。
- 其他：`src/harness/system-prompt.ts`、`skills.ts`、`prompt-templates.ts`、`messages.ts`（`createCompactionSummaryMessage` 等）。

## 2. pi-ai（`packages/ai`）—— provider / model / auth

包名 `@earendil-works/pi-ai`，入口 `src/index.ts`。导出 `Message / AssistantMessage / contentText / Model / Models / Transport / SystemMessage / ToolResultMessage / toToolDeclaration / retryAssistantCall / uuidv7` 等。

### 2.1 provider 适配
`src/providers/`：每家 provider 一个文件 + `.lazy.ts`（按需加载）：
- `anthropic-messages(.lazy).ts`、`openai-responses(.lazy).ts`、`openai-completions(.lazy).ts`、`openai-codex-responses(.lazy).ts`、`google-generative-ai(.lazy).ts`、`google-vertex(.lazy).ts`、`azure-openai-responses(.lazy).ts`、`bedrock-converse-stream(.lazy).ts`、`mistral-conversations(.lazy).ts`、`cloudflare(.ts)`、`pi-messages(.lazy).ts`。
- 共享：`transform-messages.ts`、`simple-options.ts`、`openai-prompt-cache.ts`、`constrained-sampling.ts`、`lazy.ts`。
- 统一接口抽象在 `src/api/`（`anthropic-messages.ts` 等 API 形状）与 `src/types.ts`。

### 2.2 model registry / catalog
- `src/models.ts`、`src/models-store.ts`、`src/models.generated.ts`（生成，含 1400+ 模型；由 `scripts/generate-models.ts` 从 models.dev/OpenRouter 等拉取，产物 `src/providers/data/*.json`，**需 `npm run hydrate:model-data` 生成，不入 git**）。
- `src/model-catalog.ts`、`src/image-models.ts`、`src/images/`。

### 2.3 auth / credentials
- `src/oauth.ts`、`src/bun-oauth.ts`：OAuth token 流程。
- `src/env-api-keys.ts`：从环境变量读 API key。
- `src/session-resources.ts`、`src/bedrock-provider.ts`。
- 凭证**持久化**不在 pi-ai，而在 coding-agent（见 §3.4 `auth-storage.ts`）。

## 3. coding-agent（`packages/coding-agent`）—— cli / session / skills / extensions / compaction

包名 `@earendil-works/pi-coding-agent`，bin `pi` → `dist/bundle/cli.js`。

### 3.1 CLI 入口与命令分发
- `src/main.ts`：入口，解析参数 → 组装 `createAgentSession()` 选项。
- `src/cli/args.ts`：`parseArgs / printHelp`，识别 `--help/-h`、`--version/-v`、`auth <command>`、包管理子命令（install/remove/uninstall/update/list/config）。品牌字符串集中在 `src/config.ts` 的 **`APP_NAME`**（Tiancha 改名的核心点）与 `VERSION`。
- `src/package-manager-cli.ts`：插件/扩展包管理 CLI。
- `src/rpc-entry.ts`：RPC 模式入口（配合 server）。

### 3.2 session / agent 运行
- `src/core/agent-session.ts`（已读）：`_baseSystemPromptOptions`、`_rebuildSystemPrompt`、`buildSystemPromptSections` 集成、`before_agent_start` 钩子接入、`getSystemPrompt()`。
- `src/core/agent-session-runtime.ts`、`agent-session-services.ts`：runtime/service 组装。
- `src/core/session-manager.ts`：会话列表/选择/恢复（`assertValidSessionId`）。
- `src/core/model-runtime.ts`、`model-registry.ts`、`model-resolver.ts`、`models-store.ts`：模型选择/解析/运行。
- `src/core/system-prompt.ts`（已读）：`buildSystemPromptSections` 产出带标签 sections（`preamble/tools/rules/docs/addendum/project_context/skills/cwd/<custom>`），`diffSystemPromptSections` 做增量打补丁。**研究骨架应作为新 section（如 `research_loop`）注入，而非改 preamble。**

### 3.3 skills / prompt-templates
- `src/core/skills.ts`：发现/格式化 skills（`formatSkillsForPrompt`）。
- `src/core/prompt-templates.ts`：提示词模板注册。
- skills/模板物理目录由 `config.ts` 的 `getDocsPath/getExamplesPath/getReadmePath` 与 `.pi/` 配置目录决定。

### 3.4 extensions（宿主扩展点，最重要）
- `src/core/extensions/runner.ts`（已读头部）：扩展生命周期与事件派发。事件包括 `before_agent_start`、`before_provider_request`、`before_provider_headers`、`context_event`、`tool_call_event`、`message_end`、`session_before_compact/fork/tree`、`project_trust`、`resources_discover`、`input_event`、`cache_warming_decision` 等。
- 加载：`loader.ts`、`jiti-loader.ts`、`jiti-static-loader.ts`、`virtual-modules.ts`（`.ts/.mjs` 扩展即时加载）、`wrapper.ts`、`types.ts`。
- 约定：扩展放 `.pi/extensions/`、skills 放 `.pi/skills/`；可用 `customTool`、`systemPromptOverride`/section 注入、注册 slash command。

### 3.5 compaction（coding-agent 侧）
- `src/core/compaction/compaction.ts`：coding-agent 自己的 compaction 编排（薄封装 agent-core 的 `prepareCompaction/compact`，加 session 侧 customInstructions）。
- 相关：`session-manager.ts`、`agent-session.ts` 触发压缩。

## 4. TUI / RPC / SDK

- **TUI**：`packages/tui` 渲染原语；coding-agent `src/modes/interactive/`（`theme/`、keybindings、交互屏）。`src/modes/rpc/` 为 RPC 模式。
- **RPC**：`packages/protocol`（消息协议）、`packages/client`、`packages/server`；coding-agent `src/rpc-entry.ts` 作为 RPC 进程入口，`src/modes/rpc/` 消费。
- **SDK**：`src/core/sdk.ts` 暴露 `CreateAgentSessionOptions` 等；`src/main.ts` 明确「CLI 只做参数解析，SDK 做重活」。
- **config/settings**：`src/config.ts`（`APP_NAME`/`VERSION`/`getAgentDir`/`ENV_SESSION_DIR`）、`src/core/settings-manager.ts`、`src/core/pi-manifest.ts`、`src/core/project-trust.ts`（项目信任）、`src/core/trust-manager.ts`。

## 5. 关键数据流（一次对话）

```
CLI(main.ts) --parseArgs--> agent-session-services/runtime
  --> buildSystemPromptSections (system-prompt.ts) --sections-->
  Agent(agent.ts) 头部 system message
  --> agentLoop(agent-loop.ts)
      每轮: before_request/transform_context hooks(pi-agent-core)
           -> pi-ai provider(providers/*.ts) -> Model 流式
           -> after_response hook -> tool calls -> before_tool/after_tool
           -> before_compaction(阈值) -> compaction.ts 摘要
           -> before_run_end hook(可 followUp 续轮)
  事件经 HarnessEventBus/events.ts -> TUI 渲染 / RPC 透传
  session 写 session-backends(sqlite/jsonl)
扩展(extensions/runner.ts) 在各生命周期事件介入：customTool、prompt section、slash command
```

## 6. 对 Tiancha 的含义（结论）

1. **研究内核不要塞进 coding-agent 的对话循环**：agent-core 的 loop/state 是单对话单任务；多任务并行研究应建在其上的**任务图编排层**（见 02/04），而不是改 reducer。
2. **hook 已足够**：`before_run_end`(followUp 循环)、`transform_context`(注入 ResearchContext)、`before_compaction`(保证据)、`after_tool`(捕获 Wind/工具结果) 覆盖大多数定制，无需改 runtime。
3. **品牌改名集中**：`config.ts` 的 `APP_NAME` + bin 名 + 帮助文案；其余靠配置目录 `.pi`→`.tiancha` 区分。
4. **模型数据为生成产物**：`src/providers/data/*.json` 需 hydrate，Fork 后 CI/首跑必须处理。
