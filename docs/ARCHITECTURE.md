# 投研工作台架构（Pi 底座版，v2.0 唯一基准）

工程根目录 `D:\diaoyan-agent`，Node/TypeScript 本地工程，以 `@earendil-works/pi-coding-agent`（Pi）为 agent 底座。本文件取代旧版 Python/FastAPI 约定。

## 1. 技术栈与运行环境

- Node v22.23.2 / npm 10.9.8（本机已确认）
- 本地依赖（项目内 `npm install`，勿用全局包）：`@earendil-works/pi-coding-agent`、`typebox`；开发依赖 `tsx`
- 运行：`npm run dev` = `tsx watch src/server.ts`，监听 `127.0.0.1:8787`
- HTTP 层：Node 内置 `http`（不引 Express）；前端对话流式用 SSE（`/api/chat/stream`）
- 数据存储：`data\` 下 JSON 文件仓库（零原生依赖，规避 Windows 编译工具链）：`data\pool\industries.json`、`profiles.json`、`materials.json`、`research.json`、`plans.json`、`inbox\`
- Wind 桥接：`tools\wind_query.py` 独立 Python CLI（入参 JSON 字符串，出参 JSON），Node 侧用 child_process 调用；Python 路径走 `.env` 的 `WIND_PYTHON`（建议配 Wind 终端自带 Python）；WindPy 不可用时脚本内置 mock 数据，永不崩溃

## 2. 目录结构（冻结）

```
D:\diaoyan-agent\
├── package.json / tsconfig.json / .env.example
├── .pi\
│   ├── settings.json
│   └── extensions\invest\index.ts     # 注册 doubao provider + offline-mock provider + 全部 customTools
├── .pi\skills\
│   ├── industry-scoring\SKILL.md       # 行业评分工作流（七维、锚点、入池规则）
│   ├── research-outline\SKILL.md       # 实地调研提纲生成
│   ├── research-report\SKILL.md       # 调研报告撰写（含自检环节）
│   └── research-planning\SKILL.md     # 研究规划建议
├── src\
│   ├── server.ts                      # HTTP + SSE + 静态托管
│   ├── agent-factory.ts               # createAgentSession 装配（工具/技能/system prompt/模型选择）
│   ├── tools\*.ts                      # wind-query / memory-search / profile-read / profile-write / material-ingest / pool-list
│   ├── store.ts                       # JSON 仓库读写
│   └── wind-bridge.ts                 # 调用 wind_query.py
├── tools\wind_query.py
├── web\ (index.html=对话工作台, pool/industry/materials/research/planning.html, app.js, style.css)
├── data\ (pool/*.json, inbox, archive)
├── samples\sample_report.docx
└── docs\ (ARCHITECTURE.md, SCORING_MODEL.md)
```

## 3. Agent 装配（agent-factory.ts 基准代码骨架）

```ts
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create({ modelsPath: "./.pi/models.json", authPath: "./.pi/auth.json" });
const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  additionalExtensionPaths: ["./.pi/extensions/invest/index.ts"],
  systemPromptOverride: () => INVEST_SYSTEM_PROMPT,  // 一级市场投研助手人设+六环节+质量要求
});
await loader.reload();
const { session } = await createAgentSession({
  cwd: process.cwd(),
  model: chosenModel,            // 有 DOUBAO_API_KEY → doubao/豆包模型；否则 offline-mock
  modelRuntime,
  tools: ["powershell", ...customToolNames],   // Windows 用 powershell，禁用 bash
  customTools,
  resourceLoader: loader,
  sessionManager: SessionManager.create("./data/sessions"),
  settingsManager: SettingsManager.inMemory({ compaction: { enabled: true } }),
});
```

事件转发给前端（SSE）：`message_update.text_delta`（流式文本）、`tool_execution_start/end`（工具调用轨迹面板）、`turn_end`、`agent_settled`。

## 4. Provider 注册（.pi/extensions/invest/index.ts）

```ts
pi.registerProvider("doubao", {
  name: "豆包",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: "$DOUBAO_API_KEY",
  api: "openai-completions",
  models: [{ id: process.env.DOUBAO_MODEL ?? "doubao-seed-1-6-250615", name: "豆包", reasoning: false, input: ["text"],
    cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow: 256000, maxTokens: 8192 }],
});
pi.registerProvider("offline-mock", { /* 见 §5 */ });
```

## 5. offline-mock provider（无 key 也能完整演示）

通过 `streamSimple` 注册一个本地 provider：不发网络请求，按用户消息关键词确定性产出：
- 触发工具调用序列（toolcall_start/end + arguments JSON）：如消息含"研报/行业/评分"→ 依次调用 memory-search、wind-query、profile-write；含"提纲/报告/规划"→ 对应工具
- 最后产出一段结构化中文文本回复（Markdown，带来源标注）
目的：验收演示零依赖可跑；README 说明填入 DOUBAO_API_KEY 即切换真实模型。

## 6. CustomTools 清单（defineTool + TypeBox）

| 工具名 | 参数 | 作用 |
|---|---|---|
| `wind_query` | industry(string) | child_process 调 wind_query.py，返回市场规模/增速/上市公司数/PE/头部玩家 |
| `memory_search` | query(string), limit?(number) | 对 data/pool/*.json 与 materials 做关键词/语义检索（无 embedding 配置时关键词打分） |
| `profile_read` | industry(string) | 读行业档案 markdown |
| `profile_write` | industry(string), profile_md(string) | 更新档案并写变更历史 |
| `material_ingest` | source_type, content(text), title? | 录入资料（粘贴文本/URL 抓取结果），切块入材料库 |
| `pool_list` | status? | 列出储备库行业（评分/评级/状态） |

## 7. Web API（src/server.ts）

- `GET /` → web/index.html；静态托管 web/
- `POST /api/chat` {message, session_id?} → 建立 SSE：依次推送 `{type:"text", delta}`、`{type:"tool", name, args, status}`、`{type:"done", reply, session_id}`
- `GET /api/pool`、`/api/industry/:name`、`/api/materials`、`/api/research`、`/api/plans` → 直接读 JSON 仓库供可视化页
- `POST /api/upload`（multipart 存 data/inbox，触发 material_ingest 链路）

## 8. 质量要求（写进 system prompt 与各 SKILL.md）

- 输出结构化、结论标注信息来源（研报标题/Wind 字段）
- 报告/规划类交付物末尾必须有"自检"小节（事实一致性、逻辑完整性、依据充分性）
- 评分严格按 docs/SCORING_MODEL.md 的七维权重与锚点

## 9. 交付前自测（开发方必须实际执行）

1. `npm install`、`npm run dev` 启动成功
2. 无 DOUBAO_API_KEY 下：`curl -N POST /api/chat` 发"帮我分析刚录入的人形机器人研报并打分"，SSE 流中能看到至少 2 次 tool 事件 + 最终中文回复
3. `GET /api/pool` 返回 JSON（种子数据 ≥1 个行业）
4. 前端各页面 HTTP 200
