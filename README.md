# Tiancha · 天查

> 面向一级市场投资研究的个人 Research Operating System —— 不是通用聊天 Agent，不是 Pi 改版，不是 PDF/RAG/自动报告工具。
> **天查 = 两个知识体系驱动的长期投资研究学习系统**：用得越久，研究一个行业的速度、深度、判断准确度是否在提升。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-339933.svg)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/Phase%20A%20S4%20evaluation%20-%20done-green.svg)](#开发路线)
[![Tests](https://img.shields.io/badge/tests-88%20passing-brightgreen.svg)](#开发)

Tiancha 把一级市场投资人「**找行业 → 建认知 → 补缺口 → 去调研 → 沉淀**」的日常工作流，原生内化进一个有长期记忆、自然语言为入口的研究 Agent。**Tiancha 本身就是一个完整的 Agent**，研究系统藏在 Agent 后面，用户不需要知道 ResearchState / Question / Pool / TaskGraph 这些内部模型。

**两个反馈回路**（与普通 Research Agent 的根本区别）：

```
内环（把行业研究得越来越透）
  Knowledge → Gap → Priority → Question → Strategy → Target → Research → Evidence → Knowledge

外环（把研究方法变得越来越好）
  Research → Research Experience → Experience Pattern → Methodology Candidate
           → Human Gate → Methodology → 下一轮
```

**两个知识体系**：① 专业投资知识（应该怎么研究）② 行业研究知识（这个行业是什么情况）—— 它们相互反馈，不是两个平行数据库。

---

## 快速开始

### 环境要求
- Node.js ≥ 22.19（开发环境 Node 24.13）

### 安装与自检

```powershell
git clone https://github.com/bufan528/tiancha.git
cd tiancha
npm install

# 运行时自检（无需任何 API Key）
npx tsc --noEmit                                  # 预期 exit 0
npm --prefix packages/research run typecheck      # 预期 exit 0
node --import tsx src/cli/tiancha.ts research smoke   # 预期 PASS (child-session=real)
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
| `tiancha industry ingest <file> --name <行业>` | 把行业材料纳入研究系统（**幂等**：同行业不重复建骨架） |
| `tiancha industry show <行业>` | 查看行业研究概况（questions / requirements / pool slots / gaps / nextActions） |
| `tiancha state show <行业>` | 查看行业 ResearchState |
| `tiancha methodology show` | 查看**当前已激活**的研究方法论版本与维度 |
| `tiancha methodology list` | 方法论版本历史 + 待审批提案 |
| `tiancha methodology propose <file.json> --rationale <文本>` | 提出方法论修订提案（**不生效**），输出一次性审批凭据 |
| `tiancha methodology decide <candidateId> (--approve\|--reject) --operator <名>` | **人工**审批；approve 才激活新版本 |
| `tiancha research smoke` | 运行时自检 |
| `tiancha session readonly <path>` | 只读恢复历史会话 |

**研究工具（9 个）**：主模型按语义自行选择调用（**无关键词分类器**）——
`research_industry_ingest / research_industry_show / research_state_show / research_question_list / research_gap_list / research_next_action_list / research_methodology_show / research_methodology_list / research_methodology_propose`。
> **没有** `research_methodology_decide`：模型只能提案，激活必须由人通过 CLI 完成。

---

## 当前能力与边界（重要，避免误用）

**已完成：**
- **Phase 0/1**：架构审计与 Lock；Runtime 契约（Run / Round / TaskGraph / TaskAttempt / Artifact / EventStore / Child Session / HumanGate）。
- **Phase 2A 研究记忆底座**：Industry / Company / ResearchQuestion / InformationRequirement / ResearchGap / InformationPool / ResearchState / Source / Claim / NextAction + Methodology v1（12 维 Human-approved baseline），SQLite 持久化到 `~/.tiancha/db/`。
- **Phase 2B Agent 主入口**：无参数进入交互 Agent；注入研究工具，由主模型**语义选择**；`ask` 为非交互辅助。
- **Phase 2C Knowledge 投影（已接线）**：`IndustryKnowledge / KnowledgeBelief / KnowledgeConflict` 三表；四种 Evolution **SUPPORT / REVISE / CONFLICT / SUPERSEDE**（历史永不覆盖、Conflict 不选边）；单向链路 `Knowledge → Pool → State → Gap`（State 不回写 Pool）。
- **P0 知识沉淀/回填接线**：Echo 占位数据**不再污染**认知；真实数据沉淀；`ingestClaims` 调研回填入口；Gap→NextAction 幂等；belief 可回溯 Source。
- **P1 方法论版本化 + Human Gate**：`MethodologyCandidate` + 一次性审批凭据 + CLI + 天查提案工具（模型不能激活）；ingest 由**已激活版本**驱动。
- **Phase A（单行业研究闭环）S1–S4**：
  - `S1` Methodology 扩展（维度 weight / criticality）+ Requirement 承接方法论条件（importance **不再硬编码**）；
  - `S2` **确定性 identity + match-or-create**（重复 ingest 不重复建骨架）；
  - `S3` Information Pool 从单层 Entry 迁移为 **Slot + Item**（identity 保持，`pe-X → slot-X`）；
  - `S4` **EvaluationService 四面模型**：Evidence Assessment → Dimension Evaluation → Investment Aggregation（12→7）→ Decision；规则全部走可注入 Policy；**证据不足 ⇒ 不出分且决策 = `pending`**；critical 维度可阻止"储备"结论。

**能力边界：**
- 当前数据源是 **Echo 占位 Provider**，所有 Evidence 标记 `isRealExternalData=false` / `sourceType=echo_placeholder`。**不能据此做真实投资判断、不给"值得/不值得"结论**；真实 Wind/Web/上传文档在 Phase E 接入。
- 默认评分规则是**证据强度分**（确定性、可解释），**不是投资锚点评分**；真实锚点评分属 Methodology 的 Evaluation Policy。
- **尚未实现**：调研策略（ResearchChain / ResearchTarget / QuestionTargetFit / Diligence Preparation）、Field Research（Material→Fragment→Evidence→Claim）、报告生成、Priority、自动发现行业 —— 见「开发路线」。

---

## 配置与数据

- 数据目录 `~/.tiancha/`：`agent/`（Pi 会话与扩展）、`db/tiancha.sqlite`（研究库）、`db/artifacts.sqlite`（Claim/Evidence blob）。
- 项目 `.pi/` 与 `web/`、`data/`、`src/store.ts` 等为**旧工作台资产**，仅作 legacy 保留（非默认入口）。
- 凭据与运行时文件（`.pi/auth.json`、`.pi/models-store.json`、`.tiancha/`、`*.sqlite`、`dist`、`node_modules`）已 gitignore。

---

## 架构

```
                 Composition Root (src/cli/tiancha.ts)   ← 唯一装配点，唯一 import coding-agent
                              │
   ┌──────────────────────────┴───────────────────────────┐
 TianchaAgentHost (交互 REPL / askOneShot，共享装配)   Pi Runtime（复用，不重写 Loop/Session）
   └─ 9 个研究 customTools ──► Application Service ──► Domain / Repository
   └─ Research Core (packages/research) 仅依赖 Port，不 import coding-agent
```

依赖方向（dependency gate 强制）：`pi-ai ← agent-core(coding-agent) ← research-core ← composition-root`。
**实测**：`packages/research/src` 全树无 `@earendil-works/pi-coding-agent` 真实 import。

**Application Services**：`OpportunityDiscoveryService`（2A + 回填）· `KnowledgeProjectionService`（2C）· `MethodologyService`（P1）· `EvaluationService`（S4）。

---

## 开发

```powershell
npx tsc --noEmit                                  # 根类型检查
npm --prefix packages/research run typecheck      # 研究包类型检查
npm run build:cli                                 # esbuild 产出 dist/cli/tiancha.js
node --import tsx --test packages/research/src/*.test.ts src/agent/*.test.ts   # 88 tests
node --import tsx src/cli/tiancha.ts research smoke
```

> PowerShell 下 SQLite 的 `ExperimentalWarning` 写在 stderr，会显示 `NativeCommandError` —— **不是失败**。

---

## 开发路线

**Phase A — 单行业研究闭环**（框架驱动）

| 步 | 内容 | 状态 |
|---|---|---|
| S1 | Methodology 扩展（weight/criticality）+ E1（Requirement 承接方法论条件） | ✅ |
| S2 | 幂等 identity（确定性 key + match-or-create） | ✅ |
| S3 | Pool 迁移 Entry → Slot + Item（identity-preserving） | ✅ |
| S3-R1 | PoolItem 历史保留 + relation + 迁移原子性 | ✅ |
| S4 | EvaluationService 四面模型（policy 驱动 + critical 门控） | ✅ |
| S5 | PriorityService + NextAction 扩展 | ⏳ 下一步 |
| S6 | Report / Dossier 投影（最小形态） | ⏳ |
| S7 | CLI + Agent 工具（pool / evaluate / priority / report） | ⏳ |

**后续 Phase**（按业务闭环排）

| Phase | 内容 |
|---|---|
| B | 研究策略闭环：ResearchChain / Position / ResearchTarget / QuestionTargetFit / DiligencePreparation |
| C | 调研回填闭环：Material → Fragment → Evidence → Claim → Pool/Knowledge/Evaluation 更新 |
| D | 双体系协同闭环（外环）：Research Experience → Pattern → Methodology Candidate → Human Gate |
| E | 自动化与规模化：自动搜集 + 赛道识别 + Wind 接入（**入口能力**） |
| （横向） | Report（投影）与 Research Planning / Priority 属内环，不占 Phase |

---

## 文档

| 文档 | 内容 |
|---|---|
| **`docs/HANDOFF.md`** | **总入口**：完整需求、真实状态、架构、路线、踩坑（与代码同步） |
| `docs/architecture-review/06-...v3.1-final.md` | 业务与知识模型（最终锁定）：四类知识 / 两个 Loop / 四面 Evaluation |
| `docs/architecture-review/07-domain-model-design.md` | 领域模型：10 上下文 / 聚合 / 14 不变量 / identity / 评分口径 |
| `docs/architecture-review/08-code-design.md` | 代码设计：Phase A 详细 + S1–S7 拆分 |
| `docs/architecture-review/01/02/03-*` | 早期 Gap Report / Blueprint v2 / v2.1-final-lock（历史，部分过时） |

---

## 免责声明

- 天查定位于投资研究的效率与质量工具，输出不构成任何投资建议或要约。
- 当前 Echo 占位数据**不进入真实证据判断**；遵循"无证据不下结论、数据源失败不编造、缺失数据不猜测"。
- 一级市场信息高度不确定，请结合独立判断与专业意见决策。

## 开源许可

主体代码基于 MIT License，Copyright (c) 2026 bufan528。
包含来自 [Pi](https://github.com/earendil-works/pi)（MIT）的源码快照，第三方许可见 `THIRD_PARTY_NOTICES.md`，Pi 原始许可证保留于 `vendor/pi/LICENSE`。
