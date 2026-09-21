# 07 · Research Runtime 设计（Research Runtime Design）

> 版本：P0v3（Architecture Lock），上游 commit `19451accdeec671c1f4da9eafac8fc270f510ef4`
> 上游 commit：`19451accdeec671c1f4da9eafac8fc270f510ef4`
> 本文承接 01 三层定位（Pi Runtime + Research-aware Agent Core + Tiancha Research Runtime），把 P0-1~P0-4 落成运行时机制。不写实现代码。
> P0v3 修订核心：把子会话 API 改为与 `vendor/pi/packages/coding-agent` 源码逐字一致的真实形状（依据《pi-api-verification.md》核对报告），不再把 `skills / extensions / researchContext` 当作 `createAgentSessionFromServices` 的直接参数。

## 1. 分层与依赖方向（P0-3）

```
pi-ai  ↓  agent-core  ↓  research-core  ↓  coding-agent（Composition Root）
```

- `research-core`（`packages/research`）**绝不 import coding-agent**。
- 它只定义 Port 抽象；coding-agent 在启动时注入 Pi 原生实现。

## 2. Port 抽象（research 定义）

P0v3 把原来的 `AgentSessionFactoryPort` 细化为四个子 Port，分别对应真实源码中「模型解析 / 工具族 / 资源组装 / 研究语境注入」四条独立通道：

```
ModelResolverPort
  resolve(role, modelPolicy) → { model, thinkingLevel }
  // 背后复用 coding-agent 的 model-resolver.ts / ScopedModel；
  // thinkingLevel 对应 Pi 的 ThinkingLevel（7 级）。

ToolProviderPort
  resolve(role, task) → { tools?, excludeTools?, noTools?, customTools? }
  // 映射到 createAgentSessionFromServicesOptions 的真实字段：
  // tools?: string[] / excludeTools? / noTools? / customTools?: ToolDefinition[]。

ResourceLoaderFactoryPort
  build(task) → DefaultResourceLoaderOptions（资源相关字段子集）
  // 把 skills / extensions / prompt 映射成 DefaultResourceLoaderOptions 的真实字段：
  //   skillsOverride / additionalSkillPaths / noSkills
  //   extensionFactories / additionalExtensionPaths / extensionsOverride / noExtensions
  //   systemPrompt / appendSystemPrompt / additionalPromptTemplatePaths
  // 注意：源码中没有叫 prompt / resources / extensions 的构造字段；
  // 运行期追加资源走实例方法 ResourceLoader.extendResources(paths)。

ResearchContextProviderPort
  build(task) → { systemPrompt?, appendSystemPrompt?, promptsOverride?, agentsFilesOverride? }
  // 把研究切片（industry / evidence / dossier 上下文）映射到
  // AGENTS.md 与提示模板通道：systemPrompt / appendSystemPrompt /
  // promptsOverride / agentsFilesOverride。
  // 在组装 DefaultResourceLoaderOptions 时与 ResourceLoaderFactoryPort 的产物合并。
```

- 四个 Port 都只产出「数据 / 选项」，不直接 new Pi 对象；真正的 Pi 实例化发生在 §3 的工厂调用链里。
- `ResourceLoaderFactoryPort` 背后复用 `DefaultResourceLoader`（`skillsOverride` / `promptsOverride` / `systemPrompt` / `appendSystemPrompt` 等真实字段，见核对报告 §2.1）。

## 3. TianchaAgentSessionFactory（P0-2）

**ResearchTaskEngine 禁止裸调 agentLoop**。每个研究子任务 = 一次经本工厂创建的**标准 Pi/Tiancha AgentSession**。

### 3.1 真实调用链（与源码逐字对齐）

`ResearchChildSessionOptions` 不是直接传给会话工厂的散参，而是先组装成 `DefaultResourceLoaderOptions`，再走「建服务 → 装配会话」两步：

```
ResearchChildSessionOptions
  └─> 组装 DefaultResourceLoaderOptions
        （ResourceLoaderFactoryPort + ResearchContextProviderPort 合并产物）
        skillsOverride / additionalSkillPaths / extensionFactories /
        additionalExtensionPaths / extensionsOverride /
        systemPrompt / appendSystemPrompt / additionalPromptTemplatePaths
        └─> createAgentSessionServices({
              cwd, agentDir,
              resourceLoaderOptions,          // Omit<DefaultResourceLoaderOptions, "cwd"|"agentDir"|"settingsManager">
              resourceLoaderReloadOptions
            })                              // 内部 new DefaultResourceLoader(...) + await reload()
              └─> createAgentSessionFromServices({
                    services, sessionManager, sessionStartEvent,
                    model, thinkingLevel, scopedModels,
                    tools, excludeTools, noTools, customTools
                  })                        // 内部 createAgentSession({...})
```

### 3.2 真实参数字段（核对报告 §1.1，逐字）

`CreateAgentSessionFromServicesOptions` 真实字段只有：

```ts
export interface CreateAgentSessionFromServicesOptions {
	services: AgentSessionServices;
	sessionManager: SessionManager;
	sessionStartEvent?: SessionStartEvent;
	model?: Model<any>;
	thinkingLevel?: ThinkingLevel;
	scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
	tools?: string[];
	excludeTools?: CreateAgentSessionOptions["excludeTools"];
	noTools?: CreateAgentSessionOptions["noTools"];
	customTools?: ToolDefinition[];
}
```

**`skills`、`extensions`、`researchContext` 都不是该接口的直接参数**（核对报告 §1.3 已逐字判定）。资源注入的唯一通道是 `createAgentSessionServices` 的 `resourceLoaderOptions`，其类型为 `Omit<DefaultResourceLoaderOptions, "cwd" | "agentDir" | "settingsManager">`（这三个由该函数内部填）。

### 3.3 researchContext 的落点

研究语境**不**作为会话参数直传，而是由 `ResearchContextProviderPort` 在组装 `resourceLoaderOptions` 时，映射到：

- `systemPrompt?: string` / `appendSystemPrompt?: string[]` —— 研究切片主提示与追加提示；
- `promptsOverride?` —— 提示模板覆盖；
- `agentsFilesOverride?` —— AGENTS.md 通道（`{ path, content }` 数组）。

### 3.4 天然继承

经 `resourceLoader` 与 `services` 注入后，每个研究子会话仍然**天然继承**：ModelRuntime / ScopedModel / ResourceLoader / Extensions / Tools / Session lifecycle / Settings / Telemetry / Skills / MCP。

> 子会话即「Child Agent / Child Session」原生能力（02 §1.5 #2）。

## 4. Composition Root（coding-agent 侧）

coding-agent 启动时：

1. 建 `ModelRuntime`（authPath/modelsPath 指向 `.tiancha/agent`，见 09）。
2. 用 `createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager })` 管理主运行时。
3. 把 Pi 原生实现包成 §2 的四个子 Port，注入 `TianchaRuntime`。

主运行时的 newSession/switchSession/fork/importFromJsonl 由 `AgentSessionRuntime` 接管（已核对 sdk.md）。符号对齐真实源码：子会话服务经 `createAgentSessionServices` 创建、会话经 `createAgentSessionFromServices` 装配、运行时经 `createAgentSessionRuntime` 管理；持久会话句柄经 `SessionManager.open(...)` 取得（新建用 `SessionManager.create`、无持久化用 `SessionManager.inMemory()`）。

## 5. Run / Round / DAG（P0-4）

- **ResearchRun**：一次研究目标，允许循环。
- **Round**：单轮，严格 DAG。
- **Task**：不可变执行单元，每个 task = 一次标准子会话。

```
ResearchRun
 ├─ Round1 (DAG)  ...
 ├─ Round2 (DAG)  ← critic 打回时新建，不重开旧 task
 └─ Round3 (DAG)
        └─ 合并所有 Round 结果 → dossier/report
```

### 5.1 三层状态机

- **Run**：`planning | active | waiting_input | completed | failed | cancelled`。
- **Round**：`planned | running | review | completed | rejected`。
- **Task**：`queued | running | waiting | completed | failed | cancelled`。

### 5.2 Task 不可变 + 多次 TaskAttempt

Task 本身不可变（其 DAG 拓扑、目标、绑定的模型策略固定）；但一个 Task 可因重试 / critic 打回 / 人类补输入而产生多次 **TaskAttempt**，每次 attempt 是一次真实子会话执行：

```
TaskAttempt = {
  attemptId, taskId,
  startedAt, finishedAt,
  model, thinkingLevel,
  toolCalls, tokenUsage, cost,
  status, error?,
  outputs          // evidence / score / 中间产物引用
}
```

critic 打回时新建 Round / 新建 TaskAttempt，不重写已落库的历史 attempt（可复盘、可审计）。

## 6. 事件与质量门（双层事件模型）

P0v3 把原来「子会话事件经 events.ts 事件总线聚合」的单层写法拆成双层，避免把持久研究事件错压进 Pi 的 transient 总线。

### 6.1 双层职责

- **Pi EventBus（真实形状）**：只承担 **transient UI 事件**。逐字接口（核对报告 §4）：

  ```ts
  export interface EventBus {
  	emit(channel: string, data: unknown): void;
  	on(channel: string, handler: (data: unknown) => void): () => void;
  }
  ```

  channel 是普通字符串、data 是 `unknown`、无具名事件枚举；`on` 返回退订函数。**没有 `HarnessEventBus` 这个名字**，真实符号是 `EventBus` / `EventBusController` / `createEventBus()`；注入点为 `DefaultResourceLoaderOptions.eventBus?: EventBus`。

- **研究类事件 → ResearchEventAdapter → SQLite ResearchEventStore（持久层）**：以下事件不经 Pi EventBus，而是经 `ResearchEventAdapter` 写入 SQLite 的 `ResearchEventStore`（持久、可跨进程恢复、可复盘）：

  `industry_discovered / score_changed / evidence_added / contradiction_detected / human_gate_created / human_gate_decided / dossier_updated / round_created / task_attempt_*`。

  即：Pi EventBus 管「此刻 UI 要闪什么」，ResearchEventStore 管「这次 Run 到底发生了什么」。

### 6.2 质量门与压缩

- 交付前自检：`before_run_end` 返回 `followUp`（`drive/boundary.ts` 已支持），复用 `quality-gate.ts`。
- 压缩：Research-aware Compaction（`compaction.ts` 已落地）。

### 6.3 HumanGate 与会话只读加载

- **resumeToken 安全机制**：人类决策门（human gate）的恢复令牌 `resumeToken` 采用高熵随机（≥256 bit）；落库只存哈希、不存明文；带 `expiresAt`；scope 绑定为 `projectId / runId / gateId`；单次使用（用后即焚）。
- **旧 Pi session 只读加载**：加载历史会话用于复盘 / 人类复核时，经 `ReadOnlySessionManager` / `SessionMode = read-only`（与 09 对齐）。注意 `SessionManager.open(path, sessionDir?, cwdOverride?)` 本身**不强制只读**（核对报告 §4：它同时具备 append / branch / label 等写操作）——只读策略由天查侧在 Composition Root 封装层强制，而非依赖 `open()` 本身。
