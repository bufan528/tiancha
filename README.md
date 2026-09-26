# Tiancha · 天查

> 面向一级市场投资研究的个人 Research Operating System —— 不是通用聊天 Agent，不是 Pi 改版，不是 PDF/RAG/自动报告工具。
> **天查 = 两个知识体系驱动的长期投资研究学习系统**：用得越久，研究一个行业的速度、深度、判断准确度是否在提升。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-339933.svg)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/Phase%20C%20C5--D%20done-green.svg)](#开发路线)
[![Tests](https://img.shields.io/badge/tests-396%20passing-brightgreen.svg)](#开发)

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
| `tiancha research evaluate <行业>` | 产出并落库一次投资评估（**唯一可写的 research 命令**） |
| `tiancha research pool <行业>` | 查看信息池槽位与条目（只读） |
| `tiancha research priority <行业>` | 查看研究优先级（只读） |
| `tiancha research report <行业>` | 生成只读投影 + 物化 Markdown 到 `~/.tiancha/reports/` |
| `tiancha research material add <行业> <文件>` | **把真实研究材料加入行业**：规则解析 `[CLAIM]` 块 → Claim → 既有 `ingestClaims`，并打印 before/after 变化 |
| `tiancha research chain <行业>` | 展示调研链条（模板实例）与"建议研究哪类对象"——**同时幂等生成**该行业的 `ResearchPosition`（B1 投影在生产中的唯一入口） |
| `tiancha research need <行业>` | 展示派生的研究需求（含"为什么需要调研而不只是抓数据"的规则解释），只读 |
| `tiancha research diligence <行业> --target <ref>` | 生成并展示调研准备（提纲 + cautions；省略 `--target` 时只读列出现有准备） |
| `tiancha research plan <行业>` | **只读研究计划**（C2 Step 2-C）：按 Gap/Position 组织，含 `positions[].proposals`（研究建议 + 人工决策 + 确认后的研究对象）与 `orphanProposals`（悬空建议）|
| `tiancha research report-history <行业>` | **只读** report-snapshot 历史（C4-B） |
| `tiancha research company add <行业> --name <企业名> --kinds <类型1,类型2>` | 登记一名**候选企业**（C5-A，幂等）|
| `tiancha research company list\|get <行业\|companyId>` | 只读查看候选企业 |
| `tiancha research proposal generate <行业> [--gap <gapRef>]` | **生成研究建议**（C5-A，只读推导 + 落 `target_proposal`；不创建研究对象）|
| `tiancha research proposal list\|get <行业\|proposalRef>` | 只读查看研究建议及其状态 |
| `tiancha research confirm\|reject <proposalRef> --operator <名> [--comment <文本>]` | **人工决定**（C5-B）：`confirm` 是产出 `research_target` 的**唯一**路径（Agent 无此权限）|
| `tiancha research target add <行业> --kind <k> --name <主体> --position <posRef> --purpose <…> --reason <…>` | 人确认一个具体研究对象（**唯一的 target 写入路径**） |
| `tiancha research target list <行业>` | 列出已确认的研究对象及其只读适配概况（强/部分/弱/无 + 需备选对象数） |
| `tiancha session readonly <path>` | 只读恢复历史会话 |

> 上述 `research` 命令均支持 `--json`（输出格式切换，与文本渲染同一结果）。

**研究工具（19 个）**：主模型按语义自行选择调用（**无关键词分类器**）——
`research_industry_ingest / research_industry_show / research_state_show / research_question_list / research_gap_list / research_next_action_list / research_methodology_show / research_methodology_list / research_methodology_propose / research_pool_show / research_evaluate / research_priority / research_report / research_material_add / research_chain_show / research_need_list / research_target_list / research_diligence_show / research_plan_show`。
> **没有** `research_methodology_decide`：模型只能提案，激活必须由人通过 CLI 完成。
> **Agent 权限边界**：`research_evaluate` 读已落库的评估、绝不触发重算；`research_report` 只追加投影；`research_material_add` 只写用户提供的材料（不评估、不改优先级）；B5 的 4 个工具（链/需求/对象/准备）**只读已生成的产物**，未生成时提示由研究者执行 CLI —— Agent **不投影链条、不录入对象、不生成提纲**。

---

## 当前能力与边界（重要，避免误用）

**已完成：**
- **Phase 0/1**：架构审计与 Lock；Runtime 契约（Run / Round / TaskGraph / TaskAttempt / Artifact / EventStore / Child Session / HumanGate）。
- **Phase 2A 研究记忆底座**：Industry / Company / ResearchQuestion / InformationRequirement / ResearchGap / InformationPool / ResearchState / Source / Claim / NextAction + Methodology v1（12 维 Human-approved baseline），SQLite 持久化到 `~/.tiancha/db/`。
- **Phase 2B Agent 主入口**：无参数进入交互 Agent；注入研究工具，由主模型**语义选择**；`ask` 为非交互辅助。
- **Phase 2C Knowledge 投影（已接线）**：`IndustryKnowledge / KnowledgeBelief / KnowledgeConflict` 三表；四种 Evolution **SUPPORT / REVISE / CONFLICT / SUPERSEDE**（历史永不覆盖、Conflict 不选边）；单向链路 `Knowledge → Pool → State → Gap`（State 不回写 Pool）。
- **P0 知识沉淀/回填接线**：Echo 占位数据**不再污染**认知；真实数据沉淀；`ingestClaims` 调研回填入口；Gap→NextAction 幂等；belief 可回溯 Source。
- **P1 方法论版本化 + Human Gate**：`MethodologyCandidate` + 一次性审批凭据 + CLI + 天查提案工具（模型不能激活）；ingest 由**已激活版本**驱动。
- **Phase A（单行业研究闭环）S1–S4.5**：
  - `S1` Methodology 扩展（维度 weight / criticality）+ Requirement 承接方法论条件（importance **不再硬编码**）；
  - `S2` **确定性 identity + match-or-create**（重复 ingest 不重复建骨架）；
  - `S3` Information Pool 从单层 Entry 迁移为 **Slot + Item**（identity 保持，`pe-X → slot-X`）；
  - `S4` **EvaluationService 四面模型**：Evidence Assessment → Dimension Evaluation → Investment Aggregation（12→7）→ Decision；规则全部走可注入 Policy；**证据不足 ⇒ 不出分且决策 = `pending`**；critical 维度可阻止"储备"结论；
  - `S4.5` **Research Signal Integrity**：Gap 生命周期恢复（open → resolved → 可重新 open，带 `gap_type`）；Pool `sufficient` **真实可达**、`conflicting` 不再粘滞；**Pool 与 Evaluation 共用同一 Sufficiency Policy**；Gap 的产生改由 Pool 状态驱动（删除恒真的 `importance >= 2`）；Evaluation 在真实业务链上可达；Evaluation **版本化 provenance**（`methodology` + `evaluation` + `aggregation` 三个 version ref，policy 版本不可变）；
  - `S4.5-R1` Pool 的 sufficiency policy **由 `Requirement.sufficiencyPolicyRef` 经 registry 解析**（不再硬编码版本；缺失/未知 ref 直接报错），从根上消除 Pool 与 Evaluation 的语义漂移；
  - `S5` **PriorityService + ResearchPriority + NextAction**：`ResearchPriority` 是**值对象**（可审计：raw / normalized / weight / contribution + policyVersionId）；六因子加权（**不是** importance 排序）；`acquisitionValue`（缺口解决价值）与 `acquisitionCost`（信息获取难度先验）**只由现有信号推导**，不伪造 Target/成本；`Priority` 决定"先做谁"、`Gap 状态`决定"做什么"；
  - `S6` **Report / IndustryDossier 只读投影**：从当前 Knowledge / Pool / Gap / State / Evaluation / Priority **冻结**一份结构化快照（认知·事实·判断·冲突·缺口·变化·证据·评价·优先级·下一步），**append-only**、**不写任何 SoT**（I14）、条目只引用不复制；优先级**只呈现不重算**；
  - `S6-R1` 投影读取的是 S5 **已持久化**的 Priority（`currentPriorities()`），**不调用** `rank()` 重算——保证报告反映"快照时"的状态，而不是"生成时的规则"；
  - `S7` **Capability Exposure**：CLI 暴露 `research evaluate / pool / priority / report`（`--json` 可选）；其中**只有 `evaluate` 可写**（人主动落库一次评估），其余只读；`report` 除追加只读快照外还物化 Markdown 到 `~/.tiancha/reports/`。Agent 侧新增 4 个工具（S7 后共 13 个），**全部只读** —— Agent 不改变研究状态；
  - `DATA-R1` **legacy `mw-v1` 数据修复**：把 S1 之前 bootstrap 的冻结基线补齐 `weight`/`criticality`（只补**冻结基线自身的值**，不改 `versionId`/`tag`/`activatedAt`、不新建版本、不走 Human Gate）；
  - `C-MVP` **最小材料入口**：`tiancha research material add <行业> <文件>` 与 Agent 工具 `research_material_add` —— 真实材料经**规则解析**（`[CLAIM]` 块，**无 LLM**）产生 Claim，再走**既有** `ingestClaims`。`Material` **自带 subject provenance**；同一内容（同 subject + hash）**只入库一次**；不引入 Fragment/Evidence/Target/Chain/LLM，不改 Priority/Evaluation 语义。
- **Phase B v1（调研准备链）B1–B5 已完成**（契约：`docs/phaseB/implementation-contract.md`）：
  - `B1` **ChainTemplate + ResearchPosition + ResearchNeed**：链条是**模板实例**（带 `chainVersion`，模板升级产生新 ref、旧行保留），不是"该行业客观上存在这些节点"；`ResearchNeed` 是**只读派生**（永不成为 SoT）；
  - `B2` **ResearchTarget = Human-confirmed subject**：`subjectKey` 必须由人给出，`createdBy` 恒为 `user`，**不存在** Position → Target 的自动路径；备选对象必须带 ref + limitations；
  - `B3` **QuestionTargetFit = 规则判定**：纯函数 `evaluateFit()`（`targetKind × 服务该问题 → strong/partial/weak/none`）；`weak/none` + 重要问题 ⇒ 提出"需要备选对象"这一需求（**只提需求、不选对象**），不落表；
  - `B4` **DiligencePreparation = 研究什么**：三类来源 `common` / `target_specific` / `fit_derived` **结构化可区分**，每条问题可溯源（I-B5）；无 LLM、非报告；
  - `B5` **能力暴露**：CLI `research chain / need / diligence` + `target list` 带只读适配概况；Agent 只读工具（14 → 18）——**只读已生成的产物**，未生成时提示由研究者执行 CLI（与 `research_evaluate` 同一套治理）。`research chain` 是 B1 投影在生产中的唯一入口。
- **Phase C（调研回填闭环）C1–C5 已完成并发布**（契约：`docs/phaseC/implementation-contract.md` + `phaseC/c2-*` / `c3-*` / `c4-*` / `c5-implementation-contract.md`）：
  - `C1` **Knowledge Projection 语义对齐**：CURRENT 投影版本唯一派生（`confirm` 移动版本、`reject` 不动）；
  - `C2` **Gap-driven Research Planning**（含 Phase 2 Step 2-B Target 关联闭环、Step 2-C `research plan` 只读研究计划）；
  - `C3` **Priority / NextAction 验证**：只验证**既有 persisted** 结果被正确驱动，**不重算**；
  - `C4` **Report / IndustryDossier 只读投影**（C4-A）与 **report-snapshot history**（C4-B，`research report-history`）；
  - `C5-A` **研究建议**：`research company add/list/get` + `research proposal generate/list/get`（`proposalRef` 确定性 + 同 `(gap, position, subject)` 仅一条 active）；
  - `C5-B` **人工决定**：`research confirm|reject <proposalRef> --operator <名>` —— **`confirm` 是产出 `research_target` 的唯一路径**，**Agent 无该写权限**；
  - `C5-C` **Plan 只读消费 Proposal/Decision**：`research plan` 展示 `positions[].proposals` + `orphanProposals`（悬空建议）；Agent 新增 `research_plan_show`（18 → 19，仍**只读**）；
  - `C5-D` **Diligence Preparation 边界冻结 + `ResearchPlan → Preparation` 只读摘要投影**：**已实现并发布**（`dc64c33` 实现 + `aa4dc95` 测试；无新表、无 migration）；`research plan` 的 proposal 行显示 `· 调研准备 <status>（N 问）`，无准备时**整段省略**（`--json` 为显式 `null`）。

**能力边界：**
- 当前数据源是 **Echo 占位 Provider**，所有 Evidence 标记 `isRealExternalData=false` / `sourceType=echo_placeholder`。**不能据此做真实投资判断、不给"值得/不值得"结论**；真实 Wind/Web/上传文档在 Phase E 接入。
- 默认评分规则是**证据强度分**（确定性、可解释），**不是投资锚点评分**；真实锚点评分属 Methodology 的 Evaluation Policy。
- **尚未实现**：Field Research 全链（Material→Fragment→Evidence→Claim）、真实数据源与自动发现行业、Research Experience（外环）、提纲中的 `requestedMaterials`/`risks`（无真实来源时不臆造）—— 见「开发路线」。
- **C5-D / C-MVP-R1 状态说明**：两者**均已实现、已测试、已发布** —— C5-D（`dc64c33` + `aa4dc95`，闭环见 `docs/phaseC/c5-implementation-contract.md` §21.11）；**C-MVP-R1**（材料导入可靠性：状态机 + 续跑 + 跨进程原子认领 + 块级账本 + 五态返回，`e0fe004` … `709447e`，闭环、5 处实现细化与 1 项明确缺口见 `docs/phaseC/implementation-contract.md` §29.12）。材料导入是**五态**（`created` / `duplicate` / `resumed` / `failed` / `in_progress`，**没有布尔**），未完成的材料在 CLI（`research material list`）与 Agent（`research_material_list`）侧都**显式标注进度与错误**。**尚未授权**的是 **C6 / Phase C 完整版（Material → Fragment → Evidence）** 与 Phase D / E。

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
   └─ 19 个研究 customTools ──► Application Service ──► Domain / Repository
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
node --import tsx --test packages/research/src/*.test.ts src/agent/*.test.ts src/cli/*.test.ts   # 396 tests
node --import tsx src/cli/tiancha.ts research smoke
```

> PowerShell 下 SQLite 的 `ExperimentalWarning` 写在 stderr，会显示 `NativeCommandError` —— **不是失败**。
> ~~已知 flaky~~ **`C1-29` 已修**：断言改为单调性（不再比较同毫秒的 wall-clock 字符串），见 `docs/phaseC/implementation-contract.md` §29.12.4。

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
| S4.5 | Research Signal Integrity（Gap 生命周期 + Pool sufficient/conflict 恢复 + 共享 sufficiency + policy provenance） | ✅ |
| S4.5-R1 | Pool 的 sufficiency policy 由 Requirement 解析（消除 Pool/Evaluation 漂移） | ✅ |
| S5 | PriorityService + ResearchPriority + NextAction（六因子加权 + 可追溯） | ✅ |
| S6 | Report / IndustryDossier 只读投影（append-only，不改 SoT） | ✅ |
| S6-R1 | 投影读取已持久化 Priority（不重算 `rank()`） | ✅ |
| S7 | Capability Exposure：CLI 4 命令（`--json`）+ Agent 4 只读工具 + report 物化 Markdown | ✅ |
| DATA-R1 | legacy `mw-v1` 数据修复迁移（补齐冻结基线自身的 weight/criticality） | ✅ |
| C-MVP | 最小材料入口（Material + 规则解析 + 复用 ingestClaims + 幂等） | ✅ |
| Phase B v1 | 调研准备链 `ResearchNeed → Position → Target → Fit → Diligence`（契约：`docs/phaseB/implementation-contract.md`；**Step B1–B5 全部完成**） | ✅ |

> **Phase B v1 分步**：B1 `ChainTemplate/Position/Need` ✅ → B2 `ResearchTarget` ✅ → B3 `QuestionTargetFit` ✅ → B4 `DiligencePreparation` ✅ → B5 CLI/Agent 暴露 ✅。

**后续 Phase**（按业务闭环排）

| Phase | 内容 |
|---|---|
| B | 调研准备链（B1–B5 ✅）—— 无剩余 Step |
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
