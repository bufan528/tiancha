# 03 · 兼容边界契约（Compatibility Boundaries）

> 版本：P0v3（Architecture Lock），上游 commit `19451accdeec671c1f4da9eafac8fc270f510ef4`
> 目的：Tiancha Fork 后，下列 Pi 既有能力**不得被破坏**。逐项给出「契约 / 改造时如何保证不破坏 / 回归测试点」。研究域能力以**新增**方式叠加，不改这些既有契约的形状。

## 1. 模型与认证层

| 契约 | 关键文件 | 不破坏的保证 | 回归测试点 |
|---|---|---|---|
| **Provider** | `packages/ai/src/providers/*.ts`、`api/*` | 只新增 DataSource（Wind/Web/Report），**不改**任何 provider 文件；新增虚拟「研究数据源」不冒充 LLM provider | 既有 provider 单测（`packages/ai` vitest）全绿；三家以上 provider 能 completeSimple |
| **Auth（OAuth）** | `packages/ai/src/oauth.ts`、`bun-oauth.ts` | 不改 token 流程；研究任务的 Wind 凭证与 LLM 凭证**分仓隔离** | `pi auth` / `tiancha auth` 登录-刷新-失效链路 |
| **AuthStorage** | `coding-agent/src/core/auth-storage.ts`（`AuthStorage`/`ReadOnlyAuthStorage`） | 沿用既有读写接口；Tiancha 只新增自己的研究凭证存储文件，不改原 schema | 升级后旧版 token 仍能读；只读模式路径可用 |
| **ModelRegistry** | `coding-agent/src/core/model-registry.ts`、`model-resolver.ts`、`model-runtime.ts` | `ScopedModel` 解析语义不变；`ModelRouter` 调用既有解析器，不改返回形状 | `--model`、按角色/scope 选模型结果与上游一致 |
| **login 命令** | `coding-agent/src/cli/auth-command.ts`、`auth-check.ts` | 文案随品牌改名，流程与子命令名（`auth login/...`）保留 | 全新配置目录下首次登录引导正常 |
| **model 命令 / 列表** | `cli/list-models.ts`、`models-store.ts` | 列表数据源不变；仅品牌列名 | `tiancha models`（或原 list）输出非空、可切换 |
| **Thinking / reasoning** | `packages/agent/src/types.ts:308` `ThinkingLevel`、`agent-loop.ts` reasoning 透传 | 用**完整 7 级集合**：`off | minimal | low | medium | high | xhigh | max`，不截断 reasoning 预算；研究任务可按角色调高，但不改变各级语义 | reasoning 7 级开关均正常产出；`setThinkingLevel`/`cycleThinkingLevel` 一致 |
| **模型五层分层** | `ai` `getModel`（Built-in catalog）、`providers/data/*.json`（Generated metadata，需 `hydrate:model-data`）、`models.json`（User custom）、`models-store.json`（Persistent store，`modelsStorePath/modelsStore` 可覆盖）、`auth.json`（Auth store，`authPath/credentials` 可覆盖） | 五层**各司其职不混淆**：Tiancha 不改来源语义；凭证解析顺序（运行时覆盖→auth.json→env→fallback）不变；研究凭证与 LLM 凭证分仓 | 五层各加一条→可解析可用；`PI_OFFLINE` 禁网路径正常 |
| **Custom models（自定义模型）** | `models.json`；`modelRuntime.getModel("my-provider","my-model")` | 用户自定义模型配置继续生效；Tiancha 不改该 schema | 写入一条自定义模型后可用 |
| **models.json / catalog 元数据** | `ai/src/models.generated.ts`、`providers/data/*.json`（生成） | Fork 后 CI/首跑必须 `hydrate:model-data`；catalog 形状不变 | 缺失时给清晰错误而非崩溃 |

## 2. 会话层

| 契约 | 关键文件 | 不破坏的保证 | 回归测试点 |
|---|---|---|---|
| **Session Resume（恢复）** | `coding-agent/src/core/session-manager.ts`、`agent/src/harness/session/`、`session-backends/sqlite-node` | 会话存储格式不就地改字段；研究态另存独立库，聊天库保持兼容 | `tiancha --resume <id>` 恢复旧会话，消息/工具结果/系统 sections 完整 |
| **Session Tree（树/分支）** | `agent/src/harness/session/fork.ts`、`before_navigation` hook | 不改 fork/导航语义；研究子任务用独立 lane，不污染主对话树 | 分支、切换、树展示正常 |
| **Session Fork** | 同上 + `session_before_fork` 扩展事件 | fork 时不携带未保存研究态，或显式快照 | fork 后两侧互不串扰 |
| **Compaction（压缩）** | `agent/src/harness/compaction/compaction.ts`、`coding-agent/src/core/compaction/*` | 仅改摘要**提示词**（已落地），不改阈值算法 `shouldCompact/findCutPoint`；新增证据节为增量字段 | 长会话自动压缩后上下文可续；旧版 summary 仍可读 |

## 3. 工具与调用层

| 契约 | 关键文件 | 不破坏的保证 | 回归测试点 |
|---|---|---|---|
| **read / write / edit** | `agent/src/harness/tools/{read,write,edit,edit-diff,file-mutation-queue}.ts` | 不改实现；研究工具（Wind/检索）是**新** `AgentTool`，注册不替换既有 | read/write/edit 行为与上游一致；diff 正确 |
| **bash / powershell** | `tools/bash.ts`、`coding-agent bash-executor.ts` | 不改；Windows PowerShell 路径保持 | 一条 bash 命令往返正常 |
| **ToolCalling（并行/串行）** | `agent-loop.ts`、`runtime/lane.ts` `toolExecution`、`AgentTool` | 既有并行 tool calling 不降级；研究并行在**任务层**而非改 tool 调度 | 一批多 tool call 全部执行并回传 |
| **MCP** | 既有 MCP 集成点（coding-agent 扩展/工具加载） | 不改动协议；研究工具以原生 `AgentTool` 注册 | 既有 MCP server 仍挂载可用 |

## 4. 扩展与提示层

| 契约 | 关键文件 | 不破坏的保证 | 回归测试点 |
|---|---|---|---|
| **Skills** | `agent/src/harness/skills.ts`、`coding-agent/src/core/skills.ts` | `.pi/skills`→`.tiancha/skills` 发现机制不变；研究 skills 新增 | 既有 skill 被识别并注入系统提示 |
| **Extensions** | `coding-agent/src/core/extensions/{runner,loader,jiti-loader,...}.ts` | 扩展事件全集不变；研究能力以**一个内置扩展 + 新包**提供 | 样例扩展（examples/extensions）能加载、`customTool`/command 生效 |
| **PromptTemplates** | `agent/src/harness/prompt-templates.ts`、`coding-agent/src/core/prompt-templates.ts` | 模板注册/渲染形状不变；研究骨架作为新 section/模板 | 既有模板渲染一致 |
| **Themes** | `coding-agent/src/modes/interactive/theme/`、`packages/tui` | 不改主题 schema；品牌色仅默认值 | 主题切换、渲染不崩 |
| **System Prompt sections** | `coding-agent/src/core/system-prompt.ts` | `buildSystemPromptSections` 的标签机制不变；研究 section **追加**不改既有 `preamble/tools/rules/docs` | `diffSystemPromptSections` 只增量更新新 section |

## 5. 通道/外壳层

| 契约 | 关键文件 | 不破坏的保证 | 回归测试点 |
|---|---|---|---|
| **RPC** | `packages/protocol`、`client`、`server`、`coding-agent/src/rpc-entry.ts`、`modes/rpc/` | 协议消息不改形状；研究事件以**新事件类型**追加 | RPC 会话收发、流式、中断正常 |
| **SDK / 子会话工厂** | `coding-agent/src/core/sdk.ts`（`createAgentSession`）、`agent-session-services.ts`（`createAgentSessionServices`/`createAgentSessionFromServices`）、`agent-session-runtime.ts` | `CreateAgentSessionOptions` 向后兼容；研究子任务经 `TianchaAgentSessionFactory` 走标准 `createAgentSessionServices`+`createAgentSessionFromServices`，**不裸调 agentLoop**；注入项（modelRuntime/model/thinkingLevel/scopedModels/tools/customTools/resourceLoader/sessionManager）语义不变（子会话资源注入真实形状见 §5.5） | 既有 SDK examples 不报错；子会话可继承 ModelRuntime/Extensions/Skills/MCP |
| **TUI** | `packages/tui/src/*`、`modes/interactive/*` | 不改渲染原语；研究视图复用既有组件 | 交互屏渲染、滚动、keybindings 正常 |
| **CLI** | `coding-agent/src/main.ts`、`cli/args.ts`、`package.json bin` | **保留全部原 Pi 子命令**（help/version/auth/install/list/config/--resume 等），新增研究子命令**追加**；bin 同时提供 `pi` 别名 | `tiancha --version`、`tiancha --help`、原命令逐条跑通 |

## 5.5 研究域新增实体与资源注入契约（P0v3 Architecture Lock，叠加不破坏）

下列为 P0v3 新增契约：全部以**新增/叠加**方式存在，不改动 §1–§5 既有契约形状。

| 契约 | 关键文件/形状 | 不破坏的保证 | 回归测试点 |
|---|---|---|---|
| **Child Session（资源经 ResourceLoader 注入）** | 真实通道 = `createAgentSessionServices({ resourceLoaderOptions: DefaultResourceLoaderOptions })` → 内部 `new DefaultResourceLoader(...)` + `reload()` → 再 `createAgentSessionFromServices`。`createAgentSessionFromServices` 真实参数仅 `services / sessionManager / sessionStartEvent / model / thinkingLevel / scopedModels / tools / excludeTools / noTools / customTools`；`skills / extensions / researchContext` **不是其直接参数**。真实字段：`skillsOverride / additionalSkillPaths / additionalExtensionPaths / extensionFactories / extensionsOverride / systemPrompt / appendSystemPrompt / additionalPromptTemplatePaths / promptsOverride / agentsFilesOverride` | 子会话复用标准 SDK 链路，不裸调 `agentLoop`；资源注入走官方 `resourceLoaderOptions`，不改 SDK 既有 options | 子会话可指定 model/thinking/tools，并经 resourceLoaderOptions 注入 skills/extensions/研究语境；既有 SDK examples 不报错 |
| **TaskAttempt** | 一个不可变 Task 可有多次尝试。字段 `attemptId / taskId / startedAt / endedAt / model / thinkingLevel / toolCalls / tokenUsage / cost / status(running\|succeeded\|failed\|aborted) / error / outputs(ArtifactRef[])`；Task 1—N TaskAttempt | 新增持久化实体表，与聊天会话库物理隔离；不改 Session 存储格式 | 重试同一 Task 产生新 attemptId，旧 attempt 不可变留痕 |
| **Durable Research Event Store（与 Pi EventBus 并存/adapter）** | Pi `EventBus` 真实形状为 `emit(channel: string, data: unknown)` / `on(channel, handler): () => void`（字符串通道、无 `HarnessEventBus` 这个名字），仅承担 **transient UI 事件**；durable 研究事件落 SQLite EventStore（字段 `eventId / runId? / roundId? / taskId? / industryId? / companyId? / type / payload(JSON) / occurredAt / source`），经 **ResearchEventAdapter** 把 transient 事件转成 durable ResearchEvent | 两套并存：Pi EventBus 形状不改；durable 落库为新增层 | transient UI 事件与 durable 研究事件互不串；adapter 转换可逆、可回放 |
| **项目级资源发现（user scope / project scope）** | 现状：`~/.pi/agent/skills` = 全局 **user scope**；`<cwd>/.pi/skills` = 项目 **project scope**。迁移后对应 `~/.tiancha/agent/skills` 与 `<cwd>/.tiancha/skills`；extensions / prompt 同构 | 发现目录语义不变，仅随品牌目录迁移；project scope 不污染全局 | 两个目录下的 skill 均被发现且 scope 标注正确；迁移后路径映射正确 |

## 6. 回归测试策略（Phase 1 必做）

1. **上游套件**：`packages/ai`、`packages/agent`、`packages/coding-agent` 的 `vitest --run` 在 Fork 后必须全绿（本轮已保证 `tsgo` 类型检查与 bundle 构建通过）。
2. **冒烟矩阵**（每次改名/加 section 后）：
   - 登录→选模型→一句话往返；
   - `read/write/edit/bash` 各一次；
   - 长会话触发 compaction 后可续；
   - `--resume` 恢复、fork、切分支；
   - 一个样例扩展加载 + 一个样例 skill；
   - RPC 模式起停；
   - TUI 交互屏不崩。
3. **兼容断言**：聊天会话目录与研究数据目录**物理隔离**；旧 Pi 会话在 Tiancha 可只读恢复。
4. **不破坏清单**：以上 §1–§5 与 §5.5 每行对应一个最小用例，进 `packages/research/tests/compat/`。

## 7. .pi → .tiancha 迁移层契约（P1-11）

| 项 | 契约 | 不破坏的保证 | 回归测试点 |
|---|---|---|---|
| **启动检测** | 首次启动检测旧 `~/.pi/agent` 是否存在 | 不静默迁移；提示用户确认 | 有旧目录→弹确认；无旧目录→直启 |
| **分类迁移** | 区分 model config / auth / session / settings / skills / extensions | 逐类处理；auth 复制而非移动；session 标记只读 | 六类分别迁移后可用 |
| **marker** | 迁移完成写 marker，不重复迁移 | 已迁移→不再弹 | 二次启动不重复提示 |
| **旧会话只读** | 旧 Pi session 只读恢复 | 不写旧目录；恢复只读视图 | 旧会话可读不可改 |
| **模型五层** | 迁移时区分 catalog / models.json / models-store / auth | 不混淆来源 | 迁移后五层各自可解析 |

> 详细设计见 `09-migration-layer-design.md`。

## 8. 测试分层契约（P1-14）

| 层 | 依赖 | 用途 |
|---|---|---|
| **Unit / Contract** | mock provider（`SessionManager.inMemory()`、`InMemoryCredentialStore`） | CI 不依赖真实 API；契约测 Port 注入 |
| **Integration** | 真实 provider（沙箱 key） | 端到端会话/工具/RPC |
| **Nightly** | 真实 API（计费额度） | 长会话/compaction/fork/模型路由回归 |
