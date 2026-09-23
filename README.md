# Tiancha · 天查

> 面向一级市场投资研究的个人 Research Operating System —— 不是通用聊天 Agent，不是 Pi 改版，不是 PDF/RAG/自动报告工具。它把「发现机会 → 研究认知 → 信息缺口 → 下一步研究 → 沉淀知识」做成可持续闭环的长期研究 Agent。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-339933.svg)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/Phase%202C%20knowledge%20projection%20-%20partial-blue.svg)](#开发路线)

Tiancha 把一级市场投资人「**找行业 → 建认知 → 补缺口 → 去调研 → 沉淀**」的日常工作流，原生内化进一个有长期记忆、自然语言为入口的研究 Agent。**Tiancha 本身就是一个完整的 Agent**，研究系统藏在 Agent 后面，用户不需要知道 ResearchState / Question / Pool / TaskGraph 这些内部模型。

核心飞轮：

```
发现机会 → 当前研究状态 → 信息缺口 → 研究问题 → 调研目标 → 尽调准备
→ 人工调研 → 碎片输入 → Evidence → Fact/Claim/Event → 知识与信息池更新
→ ResearchState 更新 → 新缺口 → 下一轮规划
```

---

## 快速开始

### 环境要求
- Node.js ≥ 22.19（开发环境 Node 22.23）

### 安装与自检

```powershell
git clone https://github.com/bufan528/tiancha.git
cd tiancha
npm install

# 运行时自检（无需任何 API Key）
node dist/cli/tiancha.js research smoke   # 预期 PASS (child-session=real)
```

### 主入口

```bash
# 直接进入天查 Agent 交互 REPL（产品主入口）
npm run tiancha

# 非交互单轮（与交互入口共享同一套 Agent 装配）
npm run tiancha -- ask "人形机器人现在研究到哪了？"
```

> **直接运行 `tiancha`（无参数）即进入天查 Agent**，提示符 `天查>`。这是产品唯一主入口，不会落到旧 host。

### 当前可用命令

| 命令 | 说明 |
| --- | --- |
| `tiancha` | 进入天查 Agent 交互 REPL（主入口） |
| `tiancha ask "<自然语言>"` | 非交互单轮问答（同一装配） |
| `tiancha industry ingest <file> --name <行业>` | 把行业材料纳入研究系统（2A） |
| `tiancha industry show <行业>` | 查看行业研究概况 |
| `tiancha state show <行业>` | 查看行业 ResearchState |
| `tiancha research smoke` | Phase 1 运行时自检 |
| `tiancha session readonly <path>` | 只读恢复历史会话 |
| `tiancha --version` / `--help` | 版本与帮助 |

---

## 当前能力与边界（重要，避免误用）

**已完成：**
- **Phase 2A 研究记忆底座**：Industry / Company / ResearchQuestion / InformationRequirement / ResearchGap / InformationPool / ResearchState / Evidence·Claim·Fact·Event / Methodology v1（12 维 Human-approved baseline），SQLite 持久化到 `~/.tiancha/db/`。
- **Phase 2B Agent 主入口**：无参数进入交互 Agent；注入 6 个研究工具，由主模型**语义选择调用**（无关键词分类器）；`ask` 为非交互辅助。
- **Phase 2C（部分）Knowledge Projection**：
  - `IndustryKnowledge / KnowledgeBelief / KnowledgeConflict` 领域对象与三表持久化；
  - Claim→Knowledge 投影，四种 Evolution：**SUPPORT / REVISE / CONFLICT / SUPERSEDE**，历史永不覆盖、Conflict 双方保留不选边；
  - 单向闭环 **Knowledge → InformationPool → ResearchState → ResearchGap**（State 不回写 Pool；Gap 以 InformationRequirement 为中心、幂等、subject 隔离）。

**能力边界：**
- 当前数据源是 **Echo 占位 Provider**，所有 Evidence 标记 `isRealExternalData=false` / `sourceType=echo_placeholder`。**不能据此做真实投资判断、不打分、不给"值得/不值得"结论**；真实 Wind/Web/上传文档数据源在后续 Phase 接入。
- **尚未完成（2C 剩余）**：Gap→NextAction 刷新、ingest 自动接线、Methodology Human Gate 运行时。
- **暂未实现**：ResearchTarget / ResearchChain / Diligence / Field Research Ingestion / Evidence-linked Report / Research Planning（Phase 2D、3–8）。

---

## 配置与数据

- 数据目录 `~/.tiancha/`：`agent/`（Pi 会话与扩展）、`db/`（研究库 `tiancha.sqlite` 与 `artifacts.sqlite`）。
- 项目 `.pi/` 为旧 host 资产，仅作 legacy 保留（t1：不改、不获新能力、非默认入口）；首次运行幂等迁移到 `~/.tiancha/`。
- 凭据与运行时文件（`.pi/auth.json`、`.pi/models-store.json`、`.tiancha/`、`*.sqlite`）已 gitignore，不入库。

---

## 架构

```
                 Composition Root (src/cli/tiancha.ts)   ← 唯一装配点，唯一 import coding-agent
                              │
   ┌──────────────────────────┴───────────────────────────┐
 TianchaAgentHost (交互 REPL / askOneShot，共享装配)   Pi Runtime（复用，不重写 Loop）
   └─ 6 个研究 customTools ──► Application Service ──► Domain / Repository
   └─ Research Core (packages/research) 仅依赖 Port，不 import coding-agent
```

依赖方向（dependency gate 强制）：`research-core` ← Composition Root 注入 Pi 实现；`packages/research` 全树无 `@earendil-works/pi-coding-agent` import。

---

## 开发

```powershell
npx tsc --noEmit                                  # 根类型检查
npm --prefix packages/research run typecheck      # 研究包类型检查
npm run build:cli                                 # esbuild 产出 dist/cli/tiancha.js
node --import tsx --test packages/research/src/*.test.ts
node --import tsx --test src/agent/*.test.ts
node dist/cli/tiancha.js research smoke
```

---

## 开发路线

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | 架构审计、Architecture Lock | ✅ |
| 1 | tiancha CLI、TianchaRuntime、Run/Round/TaskGraph、三契约、迁移层、Durable Event Store | ✅ |
| 2A | Research Memory Foundation + Industry Vertical Slice（11 张业务表、Methodology v1、Echo Provider、OpportunityDiscoveryService） | ✅ |
| 2B | 自然语言 Agent 主入口 + 语义工具路由 + 多轮连贯（REPL + ask 共享装配） | ✅ |
| 2C | Knowledge Projection：Claim→IndustryKnowledge、四种 Evolution、Knowledge→Pool→State→Gap 单向链路 | 🚧 部分完成（Domain/投影/Pool/State/Gap 已落地；NextAction 刷新、ingest 接线、Human Gate 运行时待做） |
| 2D | 重启恢复 / 持久化回归（kill→restart 数据仍在） | ⏳ |
| 3 | Industry Research Engine（信息需求、Gap 分析、冲突解决、动态 Profile、重评） | ⏳ |
| 4 | Research Target Recommendation（问题→信息需求→ResearchChain→候选→匹配→Fallback） | ⏳ |
| 5 | Diligence Preparation（"我准备调研 XX"→完整材料包） | ⏳ |
| 6 | Field Research Ingestion（会议稿→Fragment→Evidence→冲突→知识/状态更新） | ⏳ |
| 7 | Research Report（Evidence-linked、可溯源、记 Framework Version） | ⏳ |
| 8 | Research Planning（据 Gap/价值/难度/变化生成下一步计划） | ⏳ |

设计文档见 `docs/architecture-review/`（Gap Report / Blueprint v2 / v2.1 final-lock）。

---

## 免责声明

- 天查定位于投资研究的效率与质量工具，输出不构成任何投资建议或要约。
- 当前 Echo 占位数据**不进入真实证据判断**；遵循"无证据不下结论、数据源失败不编造、缺失数据不猜测"。
- 一级市场信息高度不确定，请结合独立判断与专业意见决策。

## 开源许可

主体代码基于 MIT License，Copyright (c) 2026 bufan528。
包含来自 [Pi](https://github.com/earendil-works/pi)（MIT）的源码快照，第三方许可见 `THIRD_PARTY_NOTICES.md`，Pi 原始许可证保留于 `vendor/pi/LICENSE`。
