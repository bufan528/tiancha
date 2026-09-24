# Tiancha · 天查 — 项目交接文档（HANDOFF）

> **2026-09-24 重写 · Phase B v1 Step B4 后更新** · HEAD `1592b9f` · 远端 `https://github.com/bufan528/tiancha`（main）
> 本文档已与真实代码状态**逐项核对**：`npx tsc --noEmit` exit 0 · `packages/research` typecheck exit 0 · **186 tests 全过** · `research smoke` PASS。
> 取代此前所有版本的 HANDOFF。README.md 已同步。

---

## 0. 怎么读这份文档

| 你的目的 | 直接看 |
|---|---|
| 弄清「天查到底要做什么」 | §1（含**用户的完整原始需求**） |
| 弄清「现在做到哪了」 | §2 真实状态、§9 实施进展 |
| 理解「为什么这样设计」 | §3 架构三层（业务 v3.1 → 领域模型 → 代码设计） |
| 改代码前防踩红线 | §8 不变量、§10 关键决策、§12 踩坑 |
| 找工作 | §4 目录、§6 命令面、§13 文档索引 |

---

## 1. 项目定位与完整需求

### 1.1 一句话

**天查是一个 local-first、长期记忆、自然语言为入口的一级市场投资研究 Agent**——不是通用聊天 Agent、不是 Pi 改版、不是 PDF/RAG/报告生成器。

**天查的本质定义（用户 5 次迭代后锁定）**：

> **天查 = 两个知识体系驱动的长期投资研究学习系统。**

判据只有一条：**用得越久，它研究一个行业的速度、深度、判断准确度是否在提升？**

### 1.2 用户的完整工作链路（原始需求 · 25 步）

用户（一级市场投资人）的真实工作流程，逐条记录：

**A. 发现与筛选**
1. 自动化搜集高价值行业研究报告、新闻、数据
2. 从资料中识别行业/赛道，建立标准化 Industry
3. 对行业补全多维度信息（必要时接入 Wind）
4. 按一套**经人工确认的投资研究方法论**，从多维度评估行业
5. 将有投资价值/值得继续研究的行业纳入**储备体系**

**B. 长期知识维护**
6. 为每个潜力行业**长期维护行业研究知识**
7. 持续接收新的行业报告、研究资料、调研资料
8. 比较新旧信息，发现新的事实/观点/修正/冲突/未知
9. 根据当前信息缺口决定下一步研究什么

**C. 调研准备（用户最关心的主线）**
10. 针对潜力行业设计**研究链条**：上游、下游、核心企业、客户、贸易商、咨询机构、专家
11. 从产业链各环节选择适合的**调研对象**
12. 判断某对象**为什么适合回答某些问题、为什么不适合回答另一些**
13. 最佳对象无法联系但问题重要时，允许**次优对象**，并显式标注"非最佳信息来源，需降低置信度并交叉验证"
14. 根据选定对象生成**针对性的调研准备材料**（目的 / 对象简介 / 行业提问 / 企业提问）

**D. 调研回填**
15. 调研结束后用户提供**碎片化材料**（如会议录音文字稿）
16. 从原始材料中提取 **Fragment → Evidence → Claim**
17. 新 Claim 与既有 Knowledge 比较
18. 判断 **SUPPORT / REVISE / CONFLICT / SUPERSEDE** 认知变化
19. 更新 **Information Pool**
20. 更新 **Research State**
21. 重新发现 **Research Gap**
22. 给出下一步研究建议

**E. 产出与学习**
23. 基于 Knowledge + Evidence + Claims + Conflict + State + Methodology 生成**高质量调研报告**
24. 报告重要判断必须能**追溯到 Evidence / 原始材料**
25. 长期研究经验可形成 **Methodology Candidate**，但任何方法论变化**必须经 Human Gate**

### 1.3 用户明确的"两个知识体系 + 两个 Loop"

**两个知识体系**（不是平行数据库，而是相互反馈）：

| 体系 | 回答 | 存什么 |
|---|---|---|
| **① 专业投资知识体系**<br>Investment Methodology | 「**应该怎么研究**一个行业、判断一个行业、判断一家企业？」 | 研究/拆解方法、产业链分析方法、不同行业类型该重点看什么、问题→信息映射、证据→判断映射、成功/失败经验、方法修正 |
| **② 行业研究知识体系**<br>Industry Research Knowledge | 「**这个具体行业**到底是什么情况？」 | 行业结构、产业链、上下游、客户、竞争、模式、技术、市场空间（含口径）、关键变量/企业、专家与咨询机构观点、政策、事件、历史变化、**相互矛盾的观点** |

**两个 Loop**（天查与普通 Research Agent 的根本区别）：

- **内环**（把行业研究得越来越透）：`Knowledge → Gap → Priority → Question → Strategy → Target → Research → Evidence → Knowledge`
- **外环**（把研究方法变得越来越好）：`Research → Research Experience → Experience Pattern → Methodology Candidate → Human Gate → Methodology → 下一轮`

### 1.4 四类知识（v3.1 锁定）

| # | 类型 | 回答 |
|---|---|---|
| ① | **投资方法论知识** | 「应该怎么研究？」（跨行业） |
| ② | **行业事实 / 信息** | 「这个行业现在发生了什么？」 |
| ③ | **行业认知** | 「据这些信息，我们怎么理解这个行业？」（只对本行业） |
| ④ | **研究经验** | 「我们从研究过程中发现，以后应该怎么研究？」（跨行业、可能改方法论） |

> **② 与 ④ 的分界是极易做错处**："这个行业的需求被高估了" 是 ③；"**用厂商披露客户数判断需求，在这类行业普遍无效**" 才是 ④。

### 1.5 术语澄清（用户反复强调，必须对齐）

| 口语 | 代码里的真实所指 |
|---|---|
| 「**信息池**」 | `information_pool_slot` + `information_pool_item`（**信息组织层**，item 必须指向 Claim） |
| 「**知识库**」 | `industry_knowledge` / `knowledge_belief`（**认知** + 演变历史） |
| 「**行业档案**」 | **不含独立存储**——它是"当前认知的视图/快照"，可重算 |
| 信息的**内容** | 唯一真相是 `Claim`（存 `artifacts.sqlite`），不是池子 |

**数据流**：`Claim（SoT）→ Belief（认知）→ Pool（覆盖度/组织）→ State（快照）→ Gap（缺口）`。

### 1.6 设计红线（用户"绝对禁止"清单）

1. 不推倒重做 Pi Runtime / Tiancha Runtime ✚ 不重实现 Agent Loop
2. Research Core 不得依赖 Pi Coding Agent
3. 不把 InformationPool 做成 Knowledge
4. 不把 Report 做成 Knowledge SoT
5. 不让 State 回写 Pool
6. 不让 Knowledge 静默覆盖历史 Claim
7. Conflict 必须保留（不选边）
8. 不让 Agent 自动修改 Methodology
9. 不因为"未来需要 Experience"就现在造空壳 Experience 表
10. 不把 **Investment Target** 和 **Research Target** 混为一谈
11. 不把"公司很优秀"和"公司适合回答某个问题"混为一谈
12. 不把"信息未知"和"行业表现差"混为一谈
13. **不用 LLM 随便生成 0–100 分作为投资判断**
14. 不重复创建同一行业的 ResearchQuestion / Requirement
15. 不为完成任务提前实现不成熟的 Report / Web / Wind

---

## 2. 当前真实状态（代码事实，非文档推测）

### 2.1 已实现并测试通过

| 能力 | 关键代码 | 证据 |
|---|---|---|
| Runtime 契约（Run/Round/TaskGraph/Attempt/Artifact/EventStore/ChildSession/HumanGate） | `runtime/*` | smoke PASS（child-session=real） |
| 2A 研究记忆底座（11 表 + Methodology v1 + Echo + 链路） | `storage/research-db.ts`、`application/opportunity-discovery-service.ts` | T1–T9 |
| 2B Agent 主入口（REPL / ask + 9 个研究工具 + 语义选择） | `src/agent/*` | `host.test.ts` |
| 2C Knowledge 投影（三表 + 四种 Evolution + 单向链路 + 已接线） | `application/knowledge-projection-service.ts` | `knowledge*.test.ts` |
| P0 沉淀/回填接线（Echo 不污染、`ingestClaims`、Gap→NextAction 幂等、溯源） | 同上 + `storage/` | `foundation.test.ts` |
| P1 方法论版本化 + Human Gate（candidate/token/CLI/提案工具） | `application/methodology-service.ts`、`src/cli/tiancha.ts` | `methodology-service.test.ts` |
| **S1** Methodology Extension + E1（weight/criticality + Requirement 承接方法论条件） | `domain/methodology.ts`、`domain/information-requirement.ts` | T-A1/T-A2 |
| **S2** 幂等 identity（确定性 key + match-or-create） | `domain/identity.ts`、`opportunity-discovery-service.ts` | T-A3–T-A8 |
| **S3** Pool 迁移 Entry → Slot + Item（identity 保持） | `domain/information-pool.ts`、`storage/research-db.ts` | S3-T1 等 5 个 |
| **S3-R1** PoolItem 历史保留 + relation + 迁移原子性 | `knowledge-projection-service.ts`、`research-repository.ts` | S3-R1 5 个 |
| **S4** EvaluationService 四面模型（policy 驱动 + critical 门控） | `application/evaluation-service.ts`、`domain/evaluation*.ts` | 7 个 |
| **S4.5** Research Signal Integrity（Gap 生命周期 + Pool `sufficient`/conflict 恢复 + `gap_type` + 共享 Sufficiency Policy + Evaluation 可达 + policy provenance） | `domain/sufficiency.ts`、`domain/policy-registry.ts`、`knowledge-projection-service.ts`、`evaluation-service.ts` | `s45-signal-integrity.test.ts` 等 11 个 |
| **S4.5-R1** Pool 的 sufficiency policy **改由 `InformationRequirement.sufficiencyPolicyRef` 经 PolicyRegistry 解析**（不再在 Pool 内硬编码版本；缺失/未知 ref **明确抛错**；migration 为老数据钉 `suf-v1`；无 requirement 的槽位永不到 `sufficient`） | `knowledge-projection-service.ts`、`storage/research-db.ts` | `s45-signal-integrity.test.ts`（R1）+ `knowledge-pool-reconcile.test.ts` |
| **S5** **PriorityService + ResearchPriority + NextAction**（六因子加权；`acquisitionValue`=缺口解决价值、`acquisitionCost`=获取难度先验，均由**现有信号**推导；NextAction 由 Priority/Gap 驱动） | `application/priority-service.ts`、`domain/priority*.ts` | `s5-priority.test.ts`（10 条红线） |
| **S6** **Report / IndustryDossier 只读投影**（`report_snapshot` 表 + append-only；sections 覆盖认知/事实/判断/冲突/缺口/变化/证据/评价/优先级/下一步） | `application/report-service.ts`、`domain/report.ts`、`storage/report-repository.ts` | `s6-report.test.ts`（T-A10） |
| **S6-R1** 投影**只读取**已持久化的 Priority（`PriorityService.currentPriorities()`，不调 `rank()`）；`rank()` 生产调用点仅剩 S5 写入路径 | `application/report-service.ts`、`application/priority-service.ts` | `s6-report.test.ts`（S6-R1 3 个） |
| **S7** **能力暴露**：CLI 4 命令（evaluate 可写 / pool·priority·report 只读；`--json`）+ Agent 4 只读工具（9→13）+ report 物化 Markdown | `src/cli/research-*.ts`、`src/cli/report-markdown.ts`、`src/agent/research-tools.ts` | `s7-exposure.test.ts`、`research-format.test.ts`、`s7-cli.test.ts` |
| **DATA-R1** **legacy `mw-v1` 数据修复迁移**（S1 之前 bootstrap 的冻结基线缺 `weight`/`criticality`；一次性补齐，不改身份/不新建版本） | `storage/research-db.ts`（`repairLegacyMethodologyV1`） | `data-r1-legacy-methodology.test.ts` |
| **C-MVP** **最小材料入口**：`Material`（**自带 subject provenance**）+ 规则解析（`[CLAIM]` 块，**无 LLM**）+ 复用既有 `ingestClaims` + content-hash 幂等 | `domain/material*.ts`、`application/material-ingest-service.ts`、`src/cli/research-commands.ts` | `c-mvp-material.test.ts`、`material-cli.test.ts` |
| **B1**（Phase B v1 第一步）**ChainTemplate + ResearchPosition + ResearchNeed**（模板实例带 `chainVersion`；I-B1 无空节点；Need 只读派生） | `domain/chain-template.ts`、`domain/research-position.ts`、`domain/research-need.ts`、`application/chain-projection-service.ts`、`application/research-need-service.ts` | `phase-b-step-b1.test.ts`（T-B1–T-B5） |
| **B2**（Phase B v1 第二步）**ResearchTarget = Human-confirmed subject**（`createdBy` 硬编码 `user`；**无 Position→Target 路径**；fallback 必须带 ref + limitations；`targetCaveats()` 供下游） | `domain/research-target.ts`、`application/target-service.ts`、`src/cli/research-commands.ts` | `phase-b-step-b2.test.ts`（T-B6–T-B10/T-B12）、`target-cli.test.ts`（T-B11） |
| **B3**（Phase B v1 第三步）**QuestionTargetFit = 规则判定**（纯函数 `evaluateFit()`：`targetKind × 服务问题 → strong/partial/weak/none`；weak/none + 重要问题 ⇒ `requiresFallback`；**只提出需求、不选对象**；不落表） | `domain/question-target-fit.ts`、`application/question-target-fit-service.ts` | `phase-b-step-b3.test.ts`（T-B13–T-B17） |
| **B4**（Phase B v1 第四步）**DiligencePreparation = 研究什么**（三类来源 `common`/`target_specific`/`fit_derived` **结构化可区分**；每条问题可溯源 `fromRequirementRef`/`fromFitRef`；按 target-specific 派生；无 LLM、非报告） | `domain/diligence-preparation.ts`、`application/diligence-preparation-service.ts` | `phase-b-step-b4.test.ts`（T-B18–T-B23） |

### 2.2 只有 Domain Contract（有类型、无实现/无闭环）

`TargetCandidate` / `ScreeningRun` / `ScreeningRule` / `TargetDecision`（`domain/target-candidate.ts`，**零调用**）；`Evidence` / `EvidenceAssertion`（无表无写入）；`Fact`；`Company` / `CompanyIndustryRelation`（有表**零调用**）；`DocumentFragment`；`Run`/`Round`/`Task`（未落库）。

### 2.3 只有 Placeholder

`evidence/evidence-engine.ts`（返回 `[]`）、`evidence/evidence-extractor.ts`（返回 `0`）、`planning/research-planner.ts`（只 interface）、`dossier/`、`scoring/`、`scheduler/`、`agents/*`（5 个骨架）。

### 2.4 未实现（属路线图，不是缺陷）

**调研准备（链条/对象/适配/提纲）**、**完整 Field Research（Fragment / Evidence 全链）**、**自动发现行业 + Wind**、**Research Experience** —— 见 §9。

> **（C-MVP 已补上"入口"）** 现在有了最小材料入口：`tiancha research material add <行业> <文件>` 与 Agent 工具 `research_material_add`——真实材料经**规则解析**（`[CLAIM]` 块，**无 LLM**）产生 Claim，再走**既有** `ingestClaims`。仍未具备的是**真实数据源**（Phase E）与**完整** Material → Fragment → Evidence 链。

### 2.5 验证基线

```
npx tsc --noEmit                             → exit 0
npm --prefix packages/research run typecheck → exit 0
node --import tsx --test packages/research/src/*.test.ts src/agent/*.test.ts src/cli/*.test.ts → 186 tests / 186 pass / 0 fail
node --import tsx src/cli/tiancha.ts research smoke → PASS (child-session=real)
```

---

## 3. 架构设计（三层文档体系）

### 3.1 分层与依赖红线（实测）

```
Composition Root: src/cli/tiancha.ts   ← 唯一装配点，唯一 import @earendil-works/pi-coding-agent
        │
TianchaAgentHost (src/agent/tiancha-agent-host.ts)
   ├─ 交互 REPL / askOneShot（共享同一装配）
   ├─ 天查系统提示 + 9 个研究 customTools（src/agent/research-tools.ts）
   └─ 经 TianchaAgentSessionFactory → Pi Runtime（复用，不重写 Loop/Session）
        └─ Research Core (packages/research)：仅依赖 Port，绝不 import coding-agent
```

依赖方向：`pi-ai ← agent-core(coding-agent) ← research-core ← composition-root`。
**实测**：`packages/research/src` 全树 `@earendil|coding-agent|pi-coding` 命中均为**注释**，真实 import = 0。

### 3.2 业务与智能模型（`06-...v3.1-final.md`）

十四节完整模型。要点：

- **四类知识**（§1.4）+ **两个 Loop**（§1.3）；
- **Information Pool = 信息组织层，不是第二套 SoT**（item 必须指向 Claim）；
- **Research Priority 在内环**（Gap → Priority → Question），综合：对投资判断的重要程度 × 当前不确定程度 × 获取价值/成本；
- **Investment Evaluation 四面**：Quality / Coverage / Sufficiency / Critical；**总分算法不在此拍死，由 Methodology 定义**；
- **Report = Projection**（横向能力，非末端 Phase）；**自动发现行业 = 入口能力**（业务不可后置，工程可后置）；
- **Experience 是方法论与行业知识之间的缓冲层**（回答"是行业特殊，还是方法有问题"），**防过拟合**：单例只记经验，模式才改方法，且必须 Human Gate。

### 3.3 领域模型（`07-domain-model-design.md`）

**10 个限界上下文**：Methodology / Industry / Inquiry / Information / Knowledge / Evidence / Strategy / Evaluation / Experience / Discovery（+ Reporting 横向投影）。

**关键聚合**：`MethodologyVersion`(+Dimension) · `MethodologyCandidate` · `HumanGate` · `Industry` · `Company` · `ResearchChain`(+Position)† · `ResearchQuestion`(+Requirement) · `ResearchGap` · `NextAction` · `InformationPool`(Slot+Item) · `ResearchState` · `IndustryKnowledge`(Belief/Conflict) · `Source`/`Material`/`Fragment`† · `Evidence`/`Claim`(SoT) · `InvestmentEvaluation` · `ResearchTarget`† · `TargetCandidate` · `QuestionTargetFit`† · `DiligencePreparation`† · `ResearchExperience`†/`ExperiencePattern`† · `DiscoveryCandidate`† · `ReportSnapshot`/`IndustryDossier`（投影）
（† = 尚未落地，属 Phase B–E）

**14 条全局不变量（I1–I14）+ B1/2/3、C5** 见 §8。

### 3.4 代码设计（`08-code-design.md`）

Phase A 详细设计 + S1–S7 小步拆分。**注**：S1–S4.5 已实现，S5 处 HOLD；08 里对该进度的描述需按 §9 阅读。

---

## 4. 目录结构（现状）

```
src/
  cli/tiancha.ts                Composition Root；无参数进 Agent REPL + ask/industry/state/methodology/research/session
  cli/research-commands.ts      **S7** composition seam（evaluate/pool/priority/report 的注入式 handler）
  cli/research-format.ts        **S7** 纯 formatter（human + `--json`；`insufficient_evidence` → 证据不足）
  cli/report-markdown.ts        **S7** Markdown 物化（纯函数）
  agent/tiancha-agent-host.ts   TianchaAgentHost（startInteractive / askOneShot）
  agent/research-tools.ts       **13** 个研究工具（主模型语义选择，无关键词分类器）
  agent/host.test.ts · s7-exposure.test.ts · cli/s7-cli.test.ts · cli/research-format.test.ts
  # legacy（Pi 工作台 v2.0，见 §11）：server.ts / store.ts / invest-extension.ts / wind-bridge.ts / agent-factory.ts / tools/*
web/  data/  tools/wind_query.py   （旧 Web + JSON 仓储 + Wind 桥，legacy）

packages/research/src/
  domain/          46 个领域文件（… / research-target.ts / question-target-fit.ts / diligence-preparation.ts）
  ports/           Port 抽象（AgentSessionFactory/EventBus/Session/DataProvider/ModelResolver…）
  storage/         research-db.ts（20 表 + PRAGMA 迁移）、research-repository.ts、knowledge-repository.ts、
                   report-repository.ts（S6 只读投影）、artifact-store.ts、research-event-store.ts
  application/     report-service.ts(S6) · priority-service.ts(S5) · evaluation-service.ts(S4) ·
                   material-ingest-service.ts(C-MVP) · chain-projection-service.ts(B1) ·
                   research-need-service.ts(B1) · target-service.ts(B2) ·
                   question-target-fit-service.ts(B3) · diligence-preparation-service.ts(B4) ·
                   knowledge-projection-service.ts(2C) ·
                   methodology-service.ts(P1) · opportunity-discovery-service.ts(2A + 回填)
  providers/       echo-data-provider.ts（占位）
  runtime/         tiancha-runtime / task-engine / orchestrator / child-session / human-gate / model-router / event-adapter
  migration/       pi-to-tiancha、readonly-session-manager
  methodology/     methodology-v1.ts（12 维 baseline）
  agents/ planning/ scheduler/ evidence/ dossier/ scoring/   ← 空壳（Phase B+）
  *.test.ts        20 个测试文件（研究包）＋ `src/agent`、`src/cli` 各 2 个（共 144 用例）

config/methodology-v1.json     12 维 Human-approved baseline（mirror；含 weight/criticality）
config/scoring.json            旧评分模型配置（legacy，**不接线**）
docs/                          见 §13
vendor/pi/                     Pi 源码快照（MIT，1827 文件）
samples/                       示例材料
```

---

## 5. 环境、安装、构建、运行、验证

- **Node ≥ 22.19**（本机 v24.13.0）；依赖 `@earendil-works/pi-coding-agent ^0.86.1`、`pi-ai ^0.86.1`、`typebox ^1.3.27`。

```powershell
npm install
npx tsc --noEmit
npm --prefix packages/research run typecheck
npm run build:cli
node --import tsx --test packages/research/src/*.test.ts src/agent/*.test.ts
node --import tsx src/cli/tiancha.ts research smoke
```

- 配置目录 `~/.tiancha/`：`agent/`（Pi 会话/扩展）、`db/tiancha.sqlite`（研究库）、`db/artifacts.sqlite`（Claim/Evidence blob）。
- **PowerShell 注意**：SQLite 的 ExperimentalWarning 写 stderr 会让 PS 报 `NativeCommandError`，**不是失败**。

---

## 6. CLI 命令与研究工具

### CLI（`tiancha`）
| 命令 | 说明 |
|---|---|
| `tiancha`（无参数） | 天查 Agent 交互 REPL（**产品主入口**） |
| `tiancha ask "<NL>"` | 非交互单轮（同一装配） |
| `tiancha industry ingest <file> --name <行业>` | 行业材料入库（**幂等**：同行业不重复建骨架） |
| `tiancha industry show <行业>` / `state show <行业>` | 行业概况 / ResearchState |
| `tiancha methodology show\|list\|propose\|decide` | 方法论查看 / 提案 / **人工审批**（approve 才激活新版本） |
| `tiancha research smoke` | 运行时自检 |
| `tiancha research evaluate <行业>` | **（S7）**产出并落库一次投资评估（覆盖度 + 各维度状态 + 决策）——**唯一可写的 research 命令** |
| `tiancha research pool <行业>` | **（S7）**查看信息池槽位与条目（只读） |
| `tiancha research priority <行业>` | **（S7）**查看研究优先级（读取已持久化结果，只读） |
| `tiancha research report <行业>` | **（S7）**生成只读投影：append 快照 + 物化 Markdown 到 `~/.tiancha/reports/` |
| `tiancha research material add <行业> <文件>` | **（C-MVP）**把真实研究材料加入行业：规则解析 `[CLAIM]` 块 → Claim → 既有 `ingestClaims`；打印 before/after 变化 |
| `tiancha research target add <行业> --kind <k> --name <主体> --position <posRef> --purpose <…> --reason <…> [--fallback-for <ref>] [--limitation <…>]…` | **（B2）**人确认一个具体研究对象——**产品内唯一的 target 写入路径**（`createdBy` 恒为 user） |
| `tiancha research target list <行业>` | **（B2）**列出已确认的研究对象（含备选标记） |
| `tiancha session readonly <path>` | 只读恢复会话 |

> 以上 4 条 research 命令均支持 `--json`（**输出格式切换**：与文本渲染消费同一个 service 结果）。

### 研究工具（14 个，主模型语义选择）
`research_industry_ingest / research_industry_show / research_state_show / research_question_list / research_gap_list / research_next_action_list`（2A/2B）
`+ research_methodology_show / research_methodology_list / research_methodology_propose`（P1）
`+ research_pool_show / research_evaluate / research_priority / research_report`（**S7，只读**）
`+ research_material_add`（**C-MVP，写一份 Material**——Agent 唯一可写的东西）

> **没有** `research_methodology_decide` —— 模型只能**提案**，激活必须人通过 CLI（Invariant 6）。`host.test.ts` 有硬断言。
> **（S7/C-MVP）Agent 权限边界**：`research_evaluate` 读**已落库**的评估、**绝不**触发计算；`research_report` 只 append 投影；`research_material_add` 只写用户提供的材料（**不评估、不改 Priority**）。

---

## 7. 数据模型（24 张表，同库 `~/.tiancha/db/tiancha.sqlite`）

**2A（11）**：industry · company · research_question · information_requirement · research_gap · information_pool_entry(legacy) · research_state · research_source · research_document · next_action · methodology

**2C（3）**：industry_knowledge · knowledge_belief · knowledge_conflict

**P1（2）**：methodology_candidate · human_gate

**S3（2，Pool 新模型）**：information_pool_slot · information_pool_item

**S4（1）**：investment_evaluation

**S6（1，只读投影）**：report_snapshot（append-only；`report_kind` 区分 report/dossier）

**C-MVP（1）**：material（**自带 `subject_kind`/`subject_id`**；`content_hash` 为幂等键；`claim_refs_json` 双向可追溯）

**B1（1）**：research_position（**模板实例**：`chain_template_id` + `chain_version` 参与身份，I-B7）

**B2（1）**：research_target（**Human-confirmed subject**：`subject_key` 由人提供；`created_by` 恒 `user`）

**B4（1）**：diligence_preparation（三类来源 `common`/`target_specific`/`fit_derived` 存于 `questions_json`；`dp-<targetRef>` 幂等）

**加列（PRAGMA 预检查）**：`industry.current_knowledge_id`、`methodology.dimensions_json`、`information_requirement.{confirmed,uncertain,unknown}_condition` + `preferred_position_kinds_json` + `sufficiency_policy_ref`（S4.5）、`research_gap.gap_type`（S4.5）、`investment_evaluation.{evaluation,aggregation}_policy_version_id`（S4.5）

**Claim / Evidence blob** 存 `artifacts.sqlite`。

### 关键 identity（S2 锁定，确定性、无时间戳/UUID/顺序）
```
Question    : q-<subjectId>-<dimensionKey>
Requirement : ir-<subjectId>-<dimensionKey>
PoolSlot    : slot-<subjectId>-<dimensionKey>   （迁移自 pe-<subjectId>-<dimensionKey>，同一后缀）
Gap         : gap-<requirementId>
NextAction  : act-<gapId>
PoolItem    : item-<slotId>-<normalizedClaimRef>
```

---

## 8. 不变量（I1–I16 + B1/B2/B3/C5）

| # | 不变量 |
|---|---|
| I1 | Claim/Evidence 是唯一 SoT；Pool/Knowledge/State/Dossier/Report 都不得成为事实来源 |
| I2 | 认知类对象历史不覆盖（Belief/Claim/Evaluation/MethodologyVersion） |
| I3 | Conflict 双方并列保留，永不静默选边 |
| I4 | State 永不回写 Pool |
| I5 | **PoolItem 必须指向 Claim**；无来源的"信息"不得入库 |
| I6 | Requirement 的 importance + 条件**来自当前激活方法论**（不硬编码） |
| I7 | Requirement/Question/PoolSlot 在 subject+dimension 上**唯一**（幂等） |
| I8 | Methodology 变更必须经 HumanGate；Experience **永不**直接改方法论 |
| I9 | Experience 必须带 judgement（行业特殊 vs 方法问题）；**单例不构成 Pattern** |
| I10 | 未满足 confirmedCondition ⇒ DimensionEvaluation `insufficient_evidence` **且无 score** |
| I11 | Evaluation 必须同时给出 Quality / Coverage / Sufficiency / Critical |
| I12 | `ResearchTarget.isFallback=true` ⇒ caveat 必填；DiligenceQuestion 必须可溯源 |
| I13 | 占位数据（isRealExternalData=false）不得进入 Knowledge/Evaluation |
| I14 | Report/Dossier 是投影，重算不产生新真相 |
| I15 | **Evidence / Claim（含 Fact）/ Belief 三层语义不得混用**；PoolItem 只是组织引用，不是第四种事实 |
| I16 | **Decision 的决策状态（reserve/watch/park/pending）与 Evaluation 的知识状态（insufficient_evidence）不得混用同一枚举** |

**B1/B2/B3/C5（语义锁定）**：
- **B1 三层语义**：`Evidence（原始证据）→ Claim/Fact（原子事实）→ Belief（认知）`；Fact 是"结构化数值型的 Claim"，**同层**。
- **B2 Evaluation 四层**：`Evidence Assessment → Dimension Evaluation → Investment Aggregation → Decision`（禁止揉成巨型 Service）。
- **B3 Methodology 三类职责**（同一聚合内语义分层）：`Research Framework` / `Evaluation Policy` / `Aggregation Policy`；**改研究重点不得误伤评分算法**。
- **C5**：`insufficient_evidence` 是评价状态；证据不足 ⇒ `decisionStatus = pending`。

---

## 9. 实施进展与未来方向

### 9.1 已完成

| 阶段 | 内容 |
|---|---|
| 0–1 | 架构审计/Lock · Runtime 契约 |
| 2A/2B/2C | 研究记忆底座 · Agent 主入口 · Knowledge 投影（**已接线**） |
| P0 | 知识沉淀/回填接线（Echo 不污染、`ingestClaims`、Gap→NextAction 幂等、溯源） |
| P1 | 方法论版本化 + Human Gate（CLI + 提案工具） |

### 9.2 Phase A（单行业研究闭环）—— 代码实现进度

| 步 | 内容 | 状态 |
|---|---|---|
| **S1** | Methodology 扩展（weight/criticality）+ E1（Requirement 承接方法论条件，importance 不再硬编码） | ✅ |
| **S2** | 幂等 identity（确定性 key + match-or-create） | ✅ |
| **S3** | Pool 迁移 Entry → Slot + Item（**S3-T1 Identity Preservation**） | ✅ |
| **S3-R1** | PoolItem 历史保留 + relation + 迁移原子性 | ✅ |
| **S4** | EvaluationService **四面模型**（policy 驱动 + critical 门控 + `insufficient_evidence→pending`） | ✅ |
| **S4.5** | **Research Signal Integrity**：Gap 生命周期（open/resolved/reopened + `gap_type`）、Pool `sufficient` 可达与 conflict 恢复、共享 Sufficiency Policy、Evaluation 业务可达、Policy provenance（三 version ref + 不可变） | ✅ |
| **S4.5-R1** | Pool 的 sufficiency policy 由 `Requirement.sufficiencyPolicyRef` 解析（消除 Pool/Evaluation 漂移）；无静默回退 | ✅ |
| **S5** | **PriorityService + ResearchPriority + NextAction**（六因子加权、`acquisition` 由现有信号推导、NextAction 由 Priority/Gap 驱动） | ✅ |
| **S6** | **Report / IndustryDossier 只读投影**（append-only 快照；不改任何 SoT；含优先级只读呈现） | ✅ |
| **S6-R1** | 投影**读取**已持久化 Priority（不重算）；`rank()` 仅剩 S5 写入路径调用 | ✅ |
| **S7** | **Capability Exposure**：CLI 4 命令 + Agent 4 只读工具 + report 物化 Markdown（`~/.tiancha/reports/`） | ✅ |
| **DATA-R1** | **legacy `mw-v1` 修复迁移**（补齐冻结基线自身的 `weight`/`criticality`；真实库已复验） | ✅ |
| **C-MVP** | **最小材料入口**（`research material add` / `research_material_add`；规则解析 + 复用 `ingestClaims` + 幂等） | ✅ |
| **B1** | Phase B v1 第一步：`ChainTemplate` + `ResearchPosition`（模板实例）+ `ResearchNeed`（只读派生） | ✅ |
| **B2** | Phase B v1 第二步：`ResearchTarget` = Human-confirmed subject（`--name` 由人给；无 Position→Target 路径） | ✅ |
| **B3** | Phase B v1 第三步：`QuestionTargetFit` = 规则判定（weak/none + 重要问题 ⇒ 提出备选需求，不选对象） | ✅ |
| **B4** | Phase B v1 第四步：`DiligencePreparation` = 研究什么（三类来源可区分 + 每问可溯源；无 LLM/非报告） | ✅ |

### 9.3 后续 Phase（用户建议，按**业务闭环**排，非模块依赖）

| Phase | 内容 | 说明 |
|---|---|---|
| **A** | 单行业研究闭环 | S1–S7（进行中） |
| **B** | Research Planning / 调研准备链 | `ResearchNeed → ResearchPosition → ResearchTarget → QuestionTargetFit → DiligencePreparation`；**v1 实现契约已出**（`docs/phaseB/implementation-contract.md`，待冻结） |
| **C** | 调研回填闭环 | Material → Fragment → Evidence → Claim → Pool/Knowledge/Evaluation 更新 |
| **D** | 双体系协同闭环（外环） | Research Experience → Pattern → Methodology Candidate → Human Gate |
| **E** | 自动化与规模化 | 自动搜集 + 赛道识别 + Wind 接入（**入口能力**） |
| F（横向） | Report（投影） | 任何阶段可生成；不占 Phase |
| （横向） | Research Planning / Priority | 属**内环**，不占 Phase |

### 9.4 已知缺口（Phase B–E 前须处理）

- **`exit_env` 无 12 维来源**：Aggregation Policy 里 `sources: []` → v1 输出 `null`。建议通过方法论演进补 `exit_environment` 维度（外环首次演练）。
- **`firstHand` 恒 false**：Evidence 层未落地（Phase C），sufficiency 的"一手"规则暂不生效。
- **`caliber_differs` / `complements` 未启用**：Belief 不带 caliber（Phase C/E）。
- **Migration 假设 legacy `evidence_refs` = Claim refs**（**S3-NOTE**）。
- **`poolItemId` 编码可能非 injective**（不同 claimRef 归一成同一 id，**S3-FOLLOWUP**）。
- ~~（全链路验收）缺少「真实材料 → Claim」入口~~ **已由 C-MVP 解决**：`tiancha research material add` / `research_material_add` 让真实材料进入**既有** `ingestClaims`。**仍未解决**：真实数据源仍是 Echo 占位（**Phase E**）；完整的 `Material → Fragment → Evidence → Claim` 链未建（**Phase C 完整版**）。
- **S2-NOTE：stable identity ≠ immutable content** —— 方法论版本变化后，已存在的 Requirement 哪些字段应重投影，需在后续生命周期设计中明确。
- **S4-FOLLOWUP（independentSources 口径）**：`sufficiencyFacts` 目前用 `sourceRef ?? claimRef` 计独立来源。Evidence 层（Phase C）落地后必须改为经 `Claim → Evidence → Source` 解析，否则"一份研报抽出 10 个 Claim"会被误算成 10 个独立来源。
- **S4.5-NOTE（Policy 仍是代码常量）**：`eval-v1` / `agg-v1` / `suf-v1` 已版本化且不可变，但**仍定义在代码中**（未落 DB）；"改评分口径 = 改方法论版本"要等 Policy 可配置化。

---

## 10. 关键决策记录

- **「行业档案」= 视图，不是真相**（真相只有 Claim → Belief → Pool）。
- **Information Pool = 信息组织层**（Slot + Item，item 必须指向 Claim），**不是第二套 SoT**。
- **方法论演进 = 版本化 + Human-in-the-loop**（模型只能提案；`resumeToken` 一次性、限域、过期、只存哈希）。
- **天查不给 decide 工具**（防止模型自己批准自己）。
- **四类知识 + 两个 Loop**；**Experience 是缓冲层**（防过拟合）。
- **评分口径 = 两层映射**：底层 12 维（研究维度）× 上层 7 维（投资汇总）；12→7 贡献矩阵写进 Aggregation Policy **并版本化**；`exit_env` 暂无来源 → null。
- **Evaluation 四面 + 规则全部走可注入 Policy**（`EVALUATION_POLICY_V1` / `AGGREGATION_POLICY_V1`），Service 不硬编码公式。
- **占位数据不进 Knowledge/Evaluation**（`isRealExternalData` + `SKIPPED`）。
- **Pool 迁移在 DB 初始化时幂等执行**（不做长期 dual-read）；legacy `information_pool_entry` 保留为迁移源/回滚。
- **（S4.5）Gap 由 Pool 状态驱动，不由 importance 阈值**：删除 `importance >= 2`（该判断在 12 维权重区间下恒真）；`importance`/`criticality` 仅作 S5 Priority 的**输入属性**。
- **（S4.5）`sufficient` 由共享 Sufficiency Policy 判定**：Information（Pool/Gap）与 Evaluation 使用**同一套** policy 语义，但 Pool **不调** EvaluationService（保持上下文边界）。
- **（S4.5-R1）Pool 的 policy 由 Requirement 解析，不硬编码**：`reconcilePool` 读 `requirement.sufficiencyPolicyRef` → `PolicyRegistry`；**缺失/未知 ref 抛错**（不静默回退，否则 provenance 失真）；migration 为老数据钉 `suf-v1`；无 requirement 的槽位永不到 `sufficient`。
- **（S5）Priority 是"下一步最值得做什么"，不是 importance 排序**：六因子（importance/criticality/uncertainty/coverageGap/acquisitionValue/acquisitionCost）按 `PRIORITY_POLICY_V1` 加权；`importance` **不是**主序。
- **（S5）`acquisitionValue` = 缺口解决价值；`acquisitionCost` = 信息获取难度先验**：二者**只能**由已存在的 Requirement/Gap/Pool/Methodology 信号推导；**不伪造** Target/Chain/公司/时间/货币成本（属 Phase B）。
- **（S5）NextAction：Priority 决定"先做谁"，Gap 状态决定"做什么"**：`kind` 由 `gapType` 决定（unknown→retrieve_data、insufficient/conflict→request_manual_input）；**不按成本档位绑定 kind**。
- **（S5）`NextAction.priority` = 0..100 优先分（越大越先做）**，`listNextActions` 改为 `priority DESC, action_id ASC`（确定性）。
- **（S6）Report / Dossier 只是投影**：只读现有 Knowledge/Pool/Gap/State/Evaluation/Priority 并**冻结快照**；**不写任何 SoT**（I14，测试用"全状态指纹前后一致"证明）；条目只**引用**（claimRef/beliefId/gapId）不复制；**不**引入 Evidence/Target/Chain/Strategy/LLM 抽取。
- **（S6-R1）Priority 在投影里是"读取"而非"重算"**：S5 已把 priority（含因子明细 + policy 版本）持久化在 `NextAction.params`；`PriorityService.currentPriorities()` 是**只读面**，`ReportService` 只调它——**绝不**调 `rank()`/`computeFor()`。否则报告会反映"生成时的当前规则"而非"快照时的状态"。
- **（S7）CLI 可写 / Agent 只读**：只有人执行 `tiancha research evaluate` 会 append `investment_evaluation`；Agent 的 `research_evaluate` **只读最近一次**，无评估时明确提示跑 CLI。这是"模型不能 activate methodology"同一套治理思想。
- **（S7）`--json` 是输出格式切换**：一个 service 结果 → human / json 两个 renderer，**不是两套业务逻辑**。
- **（S7）Report 物化**：`report_snapshot` 是正式快照，Markdown 只是其**表现层**；文件名 `<sanitized industry>__<dossierId>.md`，**id 取自快照本身**（1:1 可追溯），目录固定 `~/.tiancha/reports/`，不做 `--out`。
- **（DATA-R1）"方法论数据修复" ≠ "方法论变更"**：把历史库中**残缺的 v1 恢复成已批准的 v1**（补入值逐项来自冻结的 `METHODOLOGY_V1`），`versionId`/`versionTag`/`activatedAt` 不变、不新建版本/candidate/gate，因此**不走 Human Gate**；且只对"明显是旧版形态"的行生效（12 个 key 一致、`weight`/`criticality` 全缺），绝不静默覆盖手工修改过的行。
- **（C-MVP）材料是「规则解析」，不是「模型抽取」**：只有显式 `[CLAIM]` 块产生 Claim；散文不产生任何 Claim；格式错误的块**报告但不臆测**。
- **（C-MVP）材料从第一天自带 subject provenance**：`materialId` + `subjectKind` + `subjectId` + 来源元数据 + `contentHash` + `claim_refs`（双向可追溯），避免把现有 `research_source` 的 provenance 债务复制一遍。
- **（C-MVP）幂等靠 content hash**：同一 subject 下同一内容只入库一次；重复添加是 no-op（不重复产生 Claim/Belief/PoolItem），**不调用** `ingestClaims`。
- **（C-MVP）不碰既有语义**：材料入口**只**调用既有 `ingestClaims`，不复制写入逻辑；**不改** Priority / Evaluation 语义，不引入 Fragment/Evidence/Target/Chain/Strategy/Experience/Wind/LLM。
- **（S4.5）Policy provenance 不可伪造**：一次 Evaluation 记录 methodology + evaluation + aggregation 三个 version ref；`PolicyRegistry` 拒绝用不同内容重注册同一 versionId。
- **（S4.5）S5 之前不写 Priority**：S4.5 只恢复到 Evaluation 为止；PriorityService / ResearchPriority / 优先级排序算法属 S5。

---

## 11. 已知技术债与边界

| 债务 | 影响 | 归属 |
|---|---|---|
| **飞轮第一环缺失**（无自动搜集/赛道识别） | 所有入口需人先给行业名 | Phase E |
| **调研准备链完全缺失**（链条/对象/适配/提纲） | 用户最关心的主线 | Phase B |
| **Field Research 缺失**（Material/Fragment/Evidence） | 碎片无法进入研究系统 | Phase C |
| `company` 表零调用、`industry_chain` 维度未被利用 | 调研链条推荐无数据基础 | Phase B |
| `ingest` 幂等已修（S2）；**但 Claim/Source 每次新增**（设计如此） | — | — |
| Agent Session 用 `SessionManager.inMemory` | 对话历史不跨进程 | Phase A 后续 (2D) |
| 回复非流式 | 体验 | 后续 |
| `config/methodology-v1.json` 与 `methodology-v1.ts` **手工镜像** | 改 json 不生效 | 后续 |
| 默认 scoring rule 是"证据强度分"，**不是投资锚点评分** | 真实评分需替换 rule | 方法论演进 |
| **Policy（eval / agg / suf / prio）仍定义在代码中**（已版本化 + 不可变，但未落 DB） | "改口径 = 改方法论版本"尚未完全成立 | 后续 |
| **S5：`acquisitionCost` 是获取难度先验**（按 gapType + 是否需要一手），非真实外部成本 | 真实成本需 Target/Chain（Phase B）接入后重估 | Phase B |
| **S6：`MethodologyService.getActive()` 有 lazy-bootstrap 写副作用**（ReportService 读方法论时会触发首启写） | 未 bootstrap 的库上生成投影会写 methodology；已 bootstrap 后无影响 | 顺手清 |
| ~~**S7：真实库里 S1 之前的 `methodology.dimensions_json` 没有 `weight`/`criticality`**~~ **已由 DATA-R1 修复**：`repairLegacyMethodologyV1()` 一次性迁移；真实库复验 `withWeight=12 withCriticality=12`，`risk`/`key_validation` 恢复 `critical` | 迁移只补齐冻结基线自身的值，不新建版本、不改 `activatedAt` | ✅ 已修 |
| **DATA-R1 未覆盖**：旧库中 **已存在** 的 `information_requirement.importance`（S1 之前恒 5）不会被重算 | 只影响历史 requirement 的分级；新建的已按 weight 派生 | 见 §9.4 S2-NOTE |
| **`research_source` / `artifacts.sqlite` 缺 subject provenance**（source 表无 subject 外键，artifact 按 run/task 归属） | 未来做「删除行业 / 清理测试数据 / subject archive」时，**无法可靠判定**某条 Claim/Source 属于哪个 Industry；Phase A 全链路验收已暴露此点 | Phase C（Evidence 层落地时必须解决） |
| `nextVersionTag()` 用计数、`getActive()` lazy-bootstrap 有写副作用、`isHumanApprovedBaseline` 命名漂移 | 低危 | 顺手清 |
| `evidence/`、`dossier/`、`scoring/`、`planning/`、`agents/`、`scheduler/` 空壳 | 相关能力未实现 | Phase B+ |
| 无模型 key 时语义路由未端到端验收 | 契约级测试 | 有模型环境后补 |

**legacy 资产（保持现状，仅标注）**：`src/store.ts`、`invest-extension.ts`、`wind-bridge.ts`、`server.ts`、`agent-factory.ts`、`src/tools/*`、`web/`、`data/`、`tools/wind_query.py`、`.pi/skills/**`、`config/scoring.json`。
**它们不是产品入口**；`data/` 的 JSON 仓储与 SQLite 研究库**不是同一套真相**。

---

## 12. 接手第一步与踩坑

**第一步**：
```powershell
npm install
npx tsc --noEmit && npm --prefix packages/research run typecheck
node --import tsx --test packages/research/src/*.test.ts src/agent/*.test.ts src/cli/*.test.ts   # 预期 186 pass
node --import tsx src/cli/tiancha.ts research smoke                            # 预期 PASS
```

**下一步功能**：**S5（PriorityService + NextAction）**——**当前 HOLD**，待 S4.5 独立验收通过后重新授权；随后 S6/S7；再进 Phase B（调研策略）。

**踩坑**：
1. 改名/复制仓库后 `node_modules/@tiancha/research` 的 junction 可能指向旧路径 → 根 tsc 报 `Cannot find module '@tiancha/research'`；重跑 `npm install`。
2. PowerShell 的 `NativeCommandError`（esbuild/SQLite 写 stderr）**不是失败**。
3. `git push` 已配置（origin `https://github.com/bufan528/tiancha.git`），直接 `git push origin main`。
4. 加列必经 `PRAGMA table_info` 预检查。
5. **任何把占位数据（Echo）当真实证据的改动都会被 Invariant 13 的测试挡住**——这是有意的。
6. **不要给天查加"激活方法论"的工具或路径**。
7. 迁移（S3）在 `ResearchDb` 构造时**原子执行**；构造失败会关闭连接并抛错（有意设计，测试有覆盖）。

---

## 13. 文档索引（按权威性排序）

| 文档 | 作用 |
|---|---|
| **`docs/HANDOFF.md`** | 本文件——总入口，与代码同步 |
| `docs/architecture-review/06-business-intelligence-architecture-v3.1-final.md` | **业务与知识模型（最终锁定）**：四类知识 / 两个 Loop / 四面 Evaluation / Report=Projection |
| `docs/architecture-review/07-domain-model-design.md` | **领域模型**：10 上下文 / 聚合 / 14 不变量 / identity / 生命周期 / §3.8a 评分口径 |
| `docs/architecture-review/08-code-design.md` | **代码设计**：Phase A 详细 + S1–S7 拆分 + 表/接口/工具 |
| `docs/phaseB/implementation-contract.md` | **Phase B v1 实现契约（未实现）**：Need → Position → Target → Fit → Diligence 的字段/identity/不变量/写入边界/T-B 验收 |
| `docs/architecture-review/05-business-intelligence-architecture-v3.md` | v3（v3.1 的前身，保留历史） |
| `docs/architecture-review/04-research-intelligence-architecture-review.md` | 实现状态盘点 + 需求映射（部分设计已被 06 取代） |
| `docs/architecture-review/01/02/03-*` | 早期 Gap Report / Blueprint v2 / v2.1-final-lock / rebaseline v3.1（**历史，部分过时**） |
| `docs/phase0/*`、`docs/phase2c/implementation-design.md` | Phase 0/2C 设计（历史） |
| `docs/SCORING_MODEL.md` | 旧 7 维 0–100 模型（**已被两层映射取代，仅作锚点参考**） |
| `docs/PROJECT_STATUS.md` | 旧状态报告（**已过时**） |
| `docs/ARCHITECTURE.md`、`docs/CORE_CUSTOMIZATION.md` | **legacy 工作台文档**，非当前架构 |

**待更新**：`README.md`（仍写 Phase 2C / 6 个工具），建议按本文件 §2/§6/§9 对齐。
