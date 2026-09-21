# Tiancha · 天查

> 面向一级市场投资研究的专业 AI Agent —— 一个会自己找行业、取数据、做评分、建档案、写尽调报告并规划下一步研究的"数字研究员"。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-339933.svg)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/Phase%201-skeleton%20complete-blue.svg)](#开发路线)

Tiancha（天查）把一级市场投资人"**找行业 → 深调研**"的完整日常工作流，原生内化进一个可接入大模型、可自主规划与调用工具、拥有长期记忆的真正 Agent。它不是聊天机器人，也不是写死流程的脚本，更不是某个 Agent 的插件——**Tiancha 本身就是一个完整的 Agent**。

---

## 它能为你做什么

当你像和一位优秀研究员协作一样说话时，Tiancha 会自动理解当前研究阶段、调度数据源与专业角色、维护研究状态：

```
最近有哪些行业值得关注？
深入研究具身智能。
帮我看看这个行业有哪些重点公司。
我下周要去调研 XXX。
这是我今天的调研笔记。
把今天的信息更新到这个行业。
为什么这个行业评分发生变化？
下一步最应该研究什么？
```

完整工作流原生闭环：

```
信息搜集 → 高价值研报发现 → 行业/赛道识别 → 行业标准化
   → Wind 等数据源补全 → 多维度投资评估 → 行业储备体系
   → 动态行业档案 → 重点标的筛选 → 公司研究 → 实地调研规划
   → 碎片化调研信息处理 → 调研报告 → 研究成果沉淀
   → 信息缺口发现 → 下一阶段研究规划 → 持续循环
```

---

## 核心特性

- **唯一入口 `tiancha`**：所有能力从一个 CLI 进入，无需在"通用模式 / 研究模式"之间切换。说"写个 Python 程序"它正常完成，说"研究机器人行业"它自动进入研究工作流。
- **Research-aware Agent Core**：内核原生理解研究任务——任务生命周期、子会话、研究上下文、任务级模型策略、人工确认门、结构化产物、持久研究事件、研究态压缩。
- **Evidence-first（最高优先级）**：每个关键结论都可沿 `Claim → Evidence → Source → Date → Locator` 溯源；严格区分事实、来源断言、分析师解读、假设、管理层口径与用户观察，**绝不把未验证内容当成事实**。
- **矛盾引擎**：自动发现"公司说法 vs Wind 数据""报告观点 vs 实际数据""历史判断 vs 新证据""来源 vs 来源"，判定前先对齐指标口径（单位/币种/地域/期间/口径）。
- **长期研究记忆**：行业/公司档案随新证据动态更新，事实、评分、档案、研究结论全部**版本化、不覆盖历史**，可回答"为什么之前的判断发生了变化"。
- **数据源适配器**：Wind、Web、报告、公司数据、政策统一为 `DataSourceAdapter`，具备超时、重试、缓存、限流与凭证隔离；**数据源不可用时绝不编造数据**。
- **完整保留通用 Agent 能力**：统一多模型 Provider、模型注册与认证（OAuth / API Key）、模型选择、Session（恢复 / 树 / Fork / 压缩）、工具、Skills、Extensions、MCP、RPC/SDK、TUI。

---

## 架构总览

Tiancha 在逻辑上分为三层，由横向的 Composition Root 装配：

```
                         Tiancha
                            │
                  Composition Root (CLI)
                            │
          ┌─────────────────┴─────────────────┐
        Pi Runtime                  Tiancha Research Runtime
  (基础设施，完整保留)              (一级市场研究能力)
          │                                 │
   Provider / Auth                Run / Round / Task DAG
   Model Registry                 Research Agents (角色)
   Session / Tools                Evidence Engine
   Skills / Extensions            Dossier Engine
   MCP / RPC / SDK / TUI          Scoring / Priority
                                  Diligence / Reports / Planning
          └─────────────────┬─────────────────┘
                            │
                     Research Memory
            (Fact · Claim · Evidence · Event · Dossier)
```

- **Pi Runtime**：提供 Agent 基础设施，Tiancha 不重写其 Agent Loop / Reducer。
- **Research-aware Agent Core**：以 Kernel Contract / 生命周期原语的形式，让内核原生理解研究任务。
- **Tiancha Research Runtime**：一级市场研究能力的业务实现，位于 `packages/research`，仅依赖抽象 Port，由 CLI 在启动时注入 Pi 的真实实现。

依赖方向（由 dependency gate 强制）：

```
pi-ai  →  agent-core  →  research-core  →  coding-agent / Composition Root
```

---

## 快速开始

### 环境要求

- **Node.js ≥ 22.19**（开发环境为 Node 22.23 / npm 10.9）
- **Python（可选）**：仅 Wind 桥接使用，缺失时自动降级
- **Wind 终端（可选）**：本机安装 Wind 并可通过 WindPy 取数

### 安装

```powershell
git clone https://github.com/bufan528/tiancha.git
cd tiancha
npm install
```

### 自检（无需任何 API Key）

```powershell
npx tiancha research smoke
```

预期输出 `PASS (child-session=real)`：依次验证 Runtime 装配、研究 Run/Round 创建、标准子会话打开、产物存储往返、研究事件持久化到 SQLite。

### 配置

复制 `.env.example` 为 `.env`：

```bash
DOUBAO_API_KEY=sk-...                 # 火山方舟（豆包，OpenAI 兼容）；留空走 offline-mock
DOUBAO_MODEL=doubao-seed-1-6-250615   # 可选，指定模型
WIND_PYTHON=C:\Wind\...\python.exe    # 可选，Wind 终端自带 Python
PORT=8787
```

- 填入 `DOUBAO_API_KEY` → 自动切换到真实大模型。
- 不填任何 Key → 使用内置 `offline-mock`，零外部依赖即可完整演示对话与工具调用。

### Web 工作台（演示）

```powershell
npm run dev
# 打开 http://127.0.0.1:8787
```

在对话框输入 `帮我分析刚录入的人形机器人研报并打分`，可观察工具调用轨迹（`memory_search → wind_query → profile_read`）与流式七维评分、来源标注和自检小节。

---

## CLI 使用

唯一入口为 `tiancha`（同时保留 `pi` 兼容别名）。

### 当前可用（Phase 1）

| 命令 | 作用 |
|---|---|
| `tiancha` | 进入交互式 Agent（完整通用能力） |
| `tiancha research smoke` | 研究骨架自检 |
| `tiancha session readonly <path>` | 以只读方式恢复历史会话 |
| `tiancha --version` | 版本信息 |

### 研究快捷命令（随 Phase 2+ 落地，自然语言同样可触发）

| 命令 | 等价于 |
|---|---|
| `tiancha industry 具身智能` | 深入研究该行业 |
| `tiancha company XXX` | 调查 XXX 公司 |
| `tiancha diligence XXX` | 为 XXX 生成实地调研计划 |
| `tiancha changes 具身智能` | 该行业最近发生了什么变化 |
| `tiancha why 具身智能` | 为什么当前是这个研究判断 |
| `tiancha plan` | 基于全部研究资产生成下一阶段计划 |

> 这些命令并非必须使用——直接用自然语言即可触发对应工作流。

---

## 项目结构

```
tiancha/
├─ packages/
│  └─ research/                 # @tiancha/research 研究内核
│     ├─ domain/                # 实体与值对象（Task / Attempt / Artifact / Claim…）
│     ├─ application/           # 应用服务（CLI / slash / SDK 统一入口）
│     ├─ runtime/               # TaskEngine / Orchestrator / ChildSession / HumanGate…
│     ├─ ports/                 # 抽象 Port（零 Pi 依赖）
│     ├─ storage/               # ArtifactStore + SQLite ResearchEventStore
│     ├─ migration/             # .pi → .tiancha 迁移 + 只读会话
│     ├─ agents/                # 研究角色（Scout / Analyst / Critic…）
│     └─ evidence/ dossier/ scoring/ data/ retrieval/
│        diligence/ reports/ planning/ scheduler/
├─ src/
│  ├─ cli/tiancha.ts            # Composition Root（全仓库唯一装配点）
│  └─ …                         # Web 工作台与工具
├─ vendor/pi/                   # Pi 底座源码快照（MIT，见 THIRD_PARTY_NOTICES）
├─ config/scoring.json          # 评分维度 / 权重 / 阈值
├─ tools/wind_query.py          # Wind 桥接 CLI
├─ docs/                        # 架构与评分模型文档
└─ tests/
```

### 评分模型（可配置）

七维加权体系，子分 0–10、归一化到 0–100，入池阈值 **65**：

| 维度 | 权重 |
|---|---|
| 市场空间与增长 | 20% |
| 政策环境 | 15% |
| 竞争格局 | 15% |
| 技术成熟度 | 15% |
| 商业化 | 15% |
| 退出环境 | 10% |
| 风险（逆向） | 10% |

评级 **A ≥ 80 / B 65–79 / C 50–64 / D < 50**。评分必须可解释、可追溯、可版本化；维度输出附带证据覆盖度、证据置信度与时效。详见 [`docs/SCORING_MODEL.md`](docs/SCORING_MODEL.md)。

---

## 开发路线

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | Pi 源码研究、架构与兼容边界设计（Architecture Lock） | ✅ |
| 1 | tiancha CLI、TianchaRuntime、ResearchContext、Run/Round/TaskGraph、三契约、迁移层 | ✅ |
| 2 | PDF/报告解析、行业提取、行业标准化、Evidence、Industry Dossier | ⏳ |
| 3 | Wind 数据适配器、数据补全、事件、时间线 | ⏳ |
| 4 | 投资评分、研究优先级、证据置信度、Critic、矛盾引擎 | ⏳ |
| 5 | 公司档案、标的筛选、尽调、现场笔记 | ⏳ |
| 6 | 报告、事实核查、证据附录、研究记忆 | ⏳ |
| 7 | 研究规划、每日简报、变化检测、调度、提醒 | ⏳ |

---

## 测试

```powershell
# 研究内核单元 / 契约测试（使用内置 Mock，不依赖外部 API）
node --import tsx --test packages/research/src/*.test.ts
```

测试分层：**单元 / 契约测试** 使用 Mock Provider（CI 不依赖真实 API），**集成测试** 与 **夜间测试** 才接入真实模型，避免网络、额度与服务波动导致基础回归不稳定。

---

## 免责声明

- Tiancha 定位于**投资研究的效率与质量工具**，输出不构成任何投资建议或要约。
- 系统遵循"无证据不下结论、数据源失败不编造、缺失数据不猜测"的原则；当前 Wind 桥接在未连接 Wind 终端时返回的演示数据带有 `source=mock` 标记，**不会进入正式评分证据链**。
- 一级市场信息存在高度不确定性，请结合独立判断与专业意见决策。

---

## 开源许可

Tiancha 主体代码基于 [MIT License](LICENSE)，Copyright (c) 2026 bufan528。

Tiancha 包含来自 [Pi](https://github.com/earendil-works/pi)（MIT，Copyright (c) 2025 Mario Zechner）的源码，完整第三方许可与归属见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)，Pi 原始许可证保留于 `vendor/pi/LICENSE`。
