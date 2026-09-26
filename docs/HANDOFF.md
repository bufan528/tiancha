# Tiancha · 天查 — 项目交接文档（HANDOFF）

> **Phase C · C5-D 已实现并发布（`aa4dc95`）** · **代码 HEAD `aa4dc95`**（= `origin/main`，ahead/behind = 0/0） · 远端 `https://github.com/bufan528/tiancha`（main）
> 本文档已与真实代码状态**逐项核对（2026-09-26）**：`npx tsc --noEmit` exit 0 · `packages/research` typecheck exit 0 · **383 tests**（1 个 pre-existing flaky：`C1-29`，见 §2.5） · `research smoke` PASS · 表 **26 张**。
> 取代此前所有版本的 HANDOFF。README.md 已同步。**C6 / Phase C 完整版仍未授权**（本文件 §0.1 已同步实现与授权状态）。

---

## 0. 接手必读（**新窗口从这里开始**）

### 0.1 当前状态（一句话）

| 项 | 值 |
|---|---|
| 当前阶段 | **Phase C · C1→C5-D 全部 FINAL LOCK 且已实现发布**；**C6 / Phase C 完整版未授权** |
| 已发布范围 | C1（Knowledge Projection 语义对齐）· C2（Gap-driven Research Planning，含 Phase 2 Step 2-B/2-C）· C3（Priority/NextAction 验证）· C4（Report/Dossier 只读投影）· C5-A（推荐：Company/Proposal）· C5-B（人工决定：`confirm`/`reject` 是 `research_target` 唯一写路径）· C5-C（Plan 只读消费 Proposal/Decision）· **C5-D（Preparation 边界冻结 + Plan 只读摘要投影）—— 已实现并发布（`dc64c33` + `aa4dc95`）** |
| 验收状态 | C1–C5-D **已实现、已发布**；C5-D 于 **2026-09-26** 独立复核：root `tsc` 1 处类型错误（测试文件）已修、全量测试 383/383、契约逐条对照无偏离 —— 见 **`docs/phaseC/c5-implementation-contract.md` §21.11** |
| HEAD / 远端 | **`aa4dc95`**（`test: add Phase C5-D preparation projection coverage`）＝ `origin/main`（**ahead/behind = 0/0**，worktree CLEAN） |
| 验证基线 | root `tsc` 0 · research typecheck 0 · **383 tests**（2026-09-26 四次运行：3 次全绿 / 1 次 flaky `C1-29`，见 §2.5）· `research smoke` PASS |
| 真实库 | `~/.tiancha/db/tiancha.sqlite`：**代码 schema 26 张表**，但**该库文件实际只有 24 张**（C5-A/B 的 `target_proposal` / `target_proposal_decision` 尚未建立 ⇒ 该库最后一次被打开早于 C5-A）；数据：`industry` 1（`人形机器人`）· `material` 0 · `industry_knowledge`/`knowledge_belief` 0 · `research_target`/`diligence_preparation`/`company` 0 |
| 下一步 | **C-MVP-R1 契约已全部 LOCKED**（`docs/phaseC/implementation-contract.md` **§29** rev4：`D-R1-3 = B` 块级账本 · `D-R1-5 = 5a` 部分可见 + 显式标注 · **rev4 修正并发认领**）；**实现未授权（需显式授权）** |
| 之后 | C6：Material → Claim → Knowledge Evolution（未授权）；Phase C 完整版（Fragment / Evidence 链）需另立契约 |

### 0.2 协作模式（★ 必须遵守 —— 本项目最主要的隐性契约）

项目由「实现者」与「独立验收者」**分步闸门**推进，规则已被反复确认：

1. **一次只做一个 Step**（如 B4），**不碰**后面的 Step；越界即被打回。
2. 交付 = **commit + push 到 `origin/main`**，然后给出：实际 diff 摘要、测试结果、
   **真实代码路径的运行证据**、以及**越界自检**。
3. 验收者**按 commit 独立复核代码**（不看交付说明），给出 `PASS` / `修改后 ACCEPTED` / `BLOCKED`；
   **被指出问题就只修那一个问题，不要顺手扩大范围**。
4. **测试必须证明真实不变量**，不是"测试全绿"本身。宁可断言行为 / 全状态指纹，也不要断言文案。
5. 每步收口跑：`tsc`（两处）+ 全量测试 + `smoke`；**改文档与改代码分开提交**（`docs:` 前缀）。
6. **禁止提前实现后续 Phase**；**禁止引入 LLM**（理由见 §10 关键决策）。

### 0.3 怎么读这份文档

| 你的目的 | 直接看 |
|---|---|
| 弄清「天查到底要做什么」 | §1（含**用户的完整原始需求**） |
| 弄清「现在做到哪了」 | §2 真实状态、§9 实施进展 |
| **Phase C 实现契约（当前主线）** | **`docs/phaseC/implementation-contract.md`**（总契约）+ `phaseC/c2-*` / `c3-*` / `c4-*` / **`phaseC/c5-implementation-contract.md`（§21 = C5-D）** |
| Phase B v1 实现契约（字段 / identity / 不变量 / 验收） | `docs/phaseB/implementation-contract.md`（其 §12 是实现进度表） |
| 理解「为什么这样设计」 | §3 架构三层（业务 v3.1 → 领域模型 → 代码设计） |
| 改代码前防踩红线 | §8 不变量、§10 关键决策、§12 踩坑 |
| 找工作 | §4 目录、§6 命令面、§13 文档索引 |

### 0.4 最近提交（新窗口快速定位）

| commit | 含义 |
|---|---|
| `aa4dc95` | **C5-D 测试**（`phase-c5-d.test.ts` T-D-1…T-D-11 + `phase-c5-d-cli.test.ts` T-D-12/13）—— **当前 HEAD = `origin/main`** |
| `dc64c33` | **C5-D 实现**：`ResearchPlanProposal.preparation` 只读摘要投影（3 文件，+49/−2） |
| `5a1d698` | **C5-D 文档同步**（HANDOFF + README；当时记录的"实现未授权"在当时为真） |
| `7672a49` / `8591975` | **C5-D 契约 rev2（Final Lock，文档 rev8）/ rev1**（仅 docs；实现与验收闭环见 `c5-implementation-contract.md` §21.11） |
| `8b822f4` / `735be57` / `50075f2` | **C5-C** 验证强化测试 / 基线测试 / Plan 只读消费 Proposal 投影 |
| `afd4a64` | **C5-C** 契约 rev6.1（追加 §20） |
| `4c5db64` / `dd07538` / `05f1800` | **C5-B** 测试 / 人工决定（`confirm`·`reject` 为 `research_target` 唯一写路径）/ 契约 rev5.1 |
| `e921147` / `f4e48b2` / `a1bba24` | **C5-A** 测试 / 推荐（Company·Proposal）/ 契约 rev4 |
| `b86c7be` | **C4** 契约 §8.4 所有权澄清（C4-A Report / C4-B `report-history`） |
| `72151b5` | **C3** Priority/NextAction 验证测试 |
| `ee16851` / `6bfd702` / `69d2b1d` | **C2** Phase 2 Step 2-C / Step 2-B / Phase 2 契约 FINAL LOCK |
| `57789e5` / `6f2e291` | **C2** 契约 Final Lock / **Phase C 总契约 v1** |
| `6eb9ea2` + 文档提交 | **B5** 调研准备链能力暴露（CLI `chain/need/diligence` + Agent 只读工具）+ 文档同步 |
| `1592b9f` / `bd0948e` / `cd20cf6` | **B4** DiligencePreparation + 文档同步 + handover refresh |
| `e64ddd4` / `6c12ac2` | **B3** QuestionTargetFit + 文档同步 |
| `253decb` / `9232668` | **B2** ResearchTarget + 文档同步 |
| `eb30a1f` / `f5d065a` | **B1** ChainTemplate + ResearchPosition + ResearchNeed + 文档同步 |
| `7d8d240` | **Phase B v1 实现契约**（纯设计文档，未改代码） |
| `79a470a` / `f4b1589` | **C-MVP** 材料入口 + 文档同步（C-MVP FINAL BASELINE） |
| `4c6cdb8` / `684da69` | **DATA-R1** legacy `mw-v1` 修复 + 文档同步 |
| `05212ea` | 记录 Phase A 全链路验收发现（含 provenance 债务） |
| `b78c42b` / `3a89738` | **S7** 能力暴露（CLI 4 命令 + Agent 4 只读工具）+ 文档同步 |

> 每个功能 commit 之后都紧跟一个 `docs:` commit（文档与代码分开提交，见 §0.2 第 5 条）。

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
| **B5**（Phase B v1 第五步 = 收尾）**能力暴露**：CLI `research chain / need / diligence`（`chain` 是 `ChainProjectionService.project()` 在**生产中唯一的入口**，幂等，只写 `research_position`）+ `target list` 附**只读**适配概况 + Agent 4 个**只读**工具（14 → 18：`research_chain_show / research_need_list / research_target_list / research_diligence_show`） | `src/cli/research-commands.ts`、`src/cli/research-format.ts`、`src/agent/research-tools.ts`、`domain/question-target-fit.ts`（`FitSummary`/`summarizeFits`） | `phase-b-b5-cli.test.ts`（T-B24–T-B27/T-B29）、`phase-b-b5-exposure.test.ts`（T-B28/T-B29） |

### 2.2 只有 Domain Contract（有类型、无实现/无闭环）

`TargetCandidate` / `ScreeningRun` / `ScreeningRule` / `TargetDecision`（`domain/target-candidate.ts`，**零调用**）；`Evidence` / `EvidenceAssertion`（无表无写入）；`Fact`；`Company` / `CompanyIndustryRelation`（有表**零调用**）；`DocumentFragment`；`Run`/`Round`/`Task`（未落库）。

### 2.3 只有 Placeholder

`evidence/evidence-engine.ts`（返回 `[]`）、`evidence/evidence-extractor.ts`（返回 `0`）、`planning/research-planner.ts`（只 interface）、`dossier/`、`scoring/`、`scheduler/`、`agents/*`（5 个骨架）。

### 2.4 未实现（属路线图，不是缺陷）

**完整 Field Research（Fragment / Evidence 全链）**、**自动发现行业 + Wind**、**Research Experience** —— 见 §9。

> **Phase B v1 已全部落地（B1–B5）**：链条 / 对象 / 适配 / 提纲 **已能由人通过 CLI 走通**（`research chain → target add → diligence`），Agent 侧只读展示这四类产物。
>
> **（C-MVP 已补上"入口"）** 现在有了最小材料入口：`tiancha research material add <行业> <文件>` 与 Agent 工具 `research_material_add`——真实材料经**规则解析**（`[CLAIM]` 块，**无 LLM**）产生 Claim，再走**既有** `ingestClaims`。仍未具备的是**真实数据源**（Phase E）与**完整** Material → Fragment → Evidence 链。

### 2.5 验证基线

```
npx tsc --noEmit                             → exit 0
npm --prefix packages/research run typecheck → exit 0
node --import tsx --test packages/research/src/*.test.ts src/agent/*.test.ts src/cli/*.test.ts → 383 tests / 383 pass / 0 fail
node --import tsx src/cli/tiancha.ts research smoke → PASS (child-session=real)
```

> **flaky（已知、非回归）**：`C1-29`（"confirming moves the CURRENT projection version; rejecting does not"）
> 用两个 `new Date().toISOString()` 断言**互不相等**，同一毫秒内会偶发失败。
> 2026-09-26 四次全量运行：**3 次 383/383 pass，1 次 382/383（仅 `C1-29` 失败）**；重跑即绿。
> 它**不是** C5-D 或本轮改动引入的。修法（另立小步）：改用单调计数 / 注入时钟，而不是比较 wall-clock 字符串。

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

**关键聚合**：`MethodologyVersion`(+Dimension) · `MethodologyCandidate` · `HumanGate` · `Industry` · `Company` · `ResearchChain`(+Position) · `ResearchQuestion`(+Requirement) · `ResearchGap` · `NextAction` · `InformationPool`(Slot+Item) · `ResearchState` · `IndustryKnowledge`(Belief/Conflict) · `Source`/`Material`/`Fragment`† · `Evidence`/`Claim`(SoT) · `InvestmentEvaluation` · `ResearchTarget` · `TargetCandidate` · `QuestionTargetFit` · `DiligencePreparation` · `ResearchExperience`†/`ExperiencePattern`† · `DiscoveryCandidate`† · `ReportSnapshot`/`IndustryDossier`（投影）
（† = 尚未落地，属 Phase C–E。**Phase B v1 的 `ResearchChain/Position`、`ResearchTarget`、`QuestionTargetFit`、`DiligencePreparation` 已落地**）

**14 条全局不变量（I1–I14）+ B1/2/3、C5** 见 §8。

### 3.4 代码设计（`08-code-design.md`）

Phase A 详细设计 + S1–S7 小步拆分。**注**：`S1–S7` 与 `Phase B v1 的 B1–B5` **均已实现**；该文档里对进度的描述**以本文 §9 为准**。

---

## 4. 目录结构（现状）

```
src/
  cli/tiancha.ts                Composition Root；无参数进 Agent REPL + ask/industry/state/methodology/research/session
  cli/research-commands.ts      **S7/B2/B5** composition seam（evaluate/pool/priority/report 与 chain/need/diligence/target 的注入式 handler）
  cli/research-format.ts        **S7/B5** 纯 formatter（human + `--json`；`insufficient_evidence` → 证据不足）
  cli/report-markdown.ts        **S7** Markdown 物化（纯函数）
  agent/tiancha-agent-host.ts   TianchaAgentHost（startInteractive / askOneShot）
  agent/research-tools.ts       **19** 个研究工具（主模型语义选择，无关键词分类器）
  agent/host.test.ts · s7-exposure.test.ts · phase-b-b5-exposure.test.ts
  cli/s7-cli.test.ts · research-format.test.ts · target-cli.test.ts · material-cli.test.ts · phase-b-b5-cli.test.ts
  # legacy（Pi 工作台 v2.0，见 §11）：server.ts / store.ts / invest-extension.ts / wind-bridge.ts / agent-factory.ts / tools/*
web/  data/  tools/wind_query.py   （旧 Web + JSON 仓储 + Wind 桥，legacy）

packages/research/src/
  domain/          49 个领域文件（… / research-target.ts / question-target-fit.ts / diligence-preparation.ts / research-plan.ts）
  ports/           Port 抽象（AgentSessionFactory/EventBus/Session/DataProvider/ModelResolver…）
  storage/         research-db.ts（**26 表** + PRAGMA 迁移）、research-repository.ts、knowledge-repository.ts、
                   report-repository.ts（S6 只读投影）、artifact-store.ts、research-event-store.ts
  application/     report-service.ts(S6) · priority-service.ts(S5) · evaluation-service.ts(S4) ·
                   material-ingest-service.ts(C-MVP) · chain-projection-service.ts(B1) ·
                   research-need-service.ts(B1) · target-service.ts(B2) ·
                   question-target-fit-service.ts(B3) · diligence-preparation-service.ts(B4) ·
                   knowledge-projection-service.ts(2C) ·
                   methodology-service.ts(P1) · opportunity-discovery-service.ts(2A + 回填) ·
                   company-service.ts(C5-A) · target-recommendation-service.ts(C5-A) ·
                   target-proposal-service.ts(C5-A) · proposal-decision-service.ts(C5-B) ·
                   research-plan-service.ts(C5-C/D)
  providers/       echo-data-provider.ts（占位）
  runtime/         tiancha-runtime / task-engine / orchestrator / child-session / human-gate / model-router / event-adapter
  migration/       pi-to-tiancha、readonly-session-manager
  methodology/     methodology-v1.ts（12 维 baseline）
  agents/ planning/ scheduler/ evidence/ dossier/ scoring/   ← 空壳（Phase B+）
  *.test.ts        **36 个测试文件**（研究包，含 `phase-b-step-b1..b4.test.ts`、`phase-c5-*.test.ts`）
                   ＋ `src/agent`（6 个）、`src/cli`（15 个）的测试
                   —— 合计 **57 个测试文件 / 383 用例**（2026-09-26 实测）

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
| `tiancha research target list <行业>` | **（B2/B5）**列出已确认的研究对象（含备选标记）及其**只读适配概况**（强/部分/弱/无 + 需备选对象数） |
| `tiancha research chain <行业>` | **（B5）**展示调研链条（模板实例：位置 / 为什么重要 / 建议研究哪类对象 / 服务问题数）——**同时幂等生成** `ResearchPosition`（B1 投影在**生产中唯一的入口**，只写该表） |
| `tiancha research need <行业>` | **（B5）**展示派生的研究需求（问题原文 + `whyStudyNotJustFetch` 规则解释 + 可服务的位置），**只读** |
| `tiancha research diligence <行业> --target <ref>` | **（B5）**生成并展示调研准备（提纲 + cautions + 三类 source）；省略 `--target` 时**只读**列出现有准备 |
| `tiancha research company add\|list\|get` | **（C5-A）**公司候选池（`subjectKey` 由人给出；`chainPosition` 无写者） |
| `tiancha research proposal generate\|list\|get <行业>` | **（C5-A）**生成 / 查看调研对象建议（`proposalRef` 确定性；同 `(gap, position, subject)` 仅一条 active） |
| `tiancha research confirm\|reject <proposalRef> --operator <名>` | **（C5-B）**人工决定 —— **`confirm` 是产出 `research_target` 的唯一路径**（Agent 无此权限） |
| `tiancha research plan <行业>` | **（C5-C / C5-D）**只读研究计划：`positions[].proposals` + `orphanProposals` + `preparation` 摘要（`--json` 可） |
| `tiancha research report-history <行业>` | **（C4-B）**只读 report 快照历史 |
| `tiancha session readonly <path>` | 只读恢复会话 |

> 以上 research 命令均支持 `--json`（**输出格式切换**：与文本渲染消费同一个 service 结果）。

### 研究工具（19 个，主模型语义选择）
`research_industry_ingest / research_industry_show / research_state_show / research_question_list / research_gap_list / research_next_action_list`（2A/2B）
`+ research_methodology_show / research_methodology_list / research_methodology_propose`（P1）
`+ research_pool_show / research_evaluate / research_priority / research_report`（**S7，只读**）
`+ research_material_add`（**C-MVP，写一份 Material**——Agent 唯一可写的东西）
`+ research_chain_show / research_need_list / research_target_list / research_diligence_show`（**B5，只读**）
`+ research_plan_show`（**C5-C，只读**：Plan 展示 Proposal / Decision；C5-D 后含 `preparation` 摘要）

> **没有** `research_methodology_decide` —— 模型只能**提案**，激活必须人通过 CLI（Invariant 6）。`host.test.ts` 有硬断言。
> **（S7/C-MVP）Agent 权限边界**：`research_evaluate` 读**已落库**的评估、**绝不**触发计算；`research_report` 只 append 投影；`research_material_add` 只写用户提供的材料（**不评估、不改 Priority**）。
> **（B5）Agent 权限边界**：4 个 B5 工具**只读已生成的产物**；未生成时提示**由研究者执行 CLI**（与 `research_evaluate` 同一套治理）。Agent **不投影链条**（未注入 `ChainProjectionService`）、**不录入对象**（无 target 写工具）、**不生成提纲**。

---

## 7. 数据模型（26 张表，同库 `~/.tiancha/db/tiancha.sqlite`）

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

**C5-A（1）**：target_proposal（**推荐**：`proposalRef` 确定性；同 `(gap, position, subject)` 仅有 active 行 —— `idx_proposal_active_subject` UNIQUE；`companyName` 仅为展示字段，不是 SoT）

**C5-B（1）**：target_proposal_decision（**人工决定**：`confirm` / `reject` + `operator` + `comment`；`confirm` 同时建 `research_target`）

**（B5 / C5-C / C5-D 均不新增任何表）**：B5 只暴露 B1–B4 已存在的产物；C5-C 是 `ResearchPlan` 的**只读投影**（新增 `orphanProposals` / `positions[].proposals` 字段）；**C5-D 同样只读**（`New tables = 0, Migration = 0`）。`ResearchNeed` / `QuestionTargetFit` 仍是**派生值对象**，不落表。

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
- **B5（暴露层不新增不变量）**：B5 只是把 B1–B4 的产物暴露给 CLI / Agent，**不新增不变量 / 不新增表**；其边界由测试守护 —— T-B24（`chain` 幂等、只写 `research_position`）/ T-B25（`need` 只读）/ T-B26（`target list` 只读 + fit 仅为聚合）/ T-B27（`diligence` 只写自己那一行，拒绝未知/跨行业对象）/ T-B28（Agent 4 工具只读、未生成时提示由人执行 CLI）/ T-B29（无 LLM / 无外部源 / 无 Evidence 新模型）。

---

## 9. 实施进展与未来方向

### 9.1 已完成

| 阶段 | 内容 |
|---|---|
| 0–1 | 架构审计/Lock · Runtime 契约 |
| 2A/2B/2C | 研究记忆底座 · Agent 主入口 · Knowledge 投影（**已接线**） |
| P0 | 知识沉淀/回填接线（Echo 不污染、`ingestClaims`、Gap→NextAction 幂等、溯源） |
| P1 | 方法论版本化 + Human Gate（CLI + 提案工具） |
| **DATA-R1** | legacy `mw-v1` 数据修复迁移（补齐冻结基线自身的 `weight`/`criticality`；真实库已复验） |
| **C-MVP** | 最小材料入口（`Material` 自带 subject provenance + 规则解析 + 复用 `ingestClaims` + 幂等） |
| **Phase B v1 · B1–B5** | `ChainTemplate`/`Position`/`Need` · `ResearchTarget` · `QuestionTargetFit` · `DiligencePreparation` · CLI/Agent 暴露 |
| **Phase C · C1–C5-D** | Knowledge Projection 语义对齐 · Gap-driven Research Planning（含 Phase 2 Step 2-B/2-C）· Priority/NextAction 验证 · Report/Dossier 只读投影 · **C5-A 推荐 → C5-B 人工决定 → C5-C Plan 只读消费 → C5-D Preparation 边界冻结 + 只读摘要（已实现并发布 `dc64c33` + `aa4dc95`）** |

### 9.2 代码实现进度（S1–S7 / DATA-R1 / C-MVP / Phase B v1）

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
| **B5** | Phase B v1 收尾：**能力暴露** —— CLI `chain/need/diligence`（`chain` 是投影在生产中唯一入口）+ `target list` 附只读适配概况 + Agent 只读工具（14 → 18） | ✅ |
| **C1** | **Knowledge Projection 语义对齐**（CURRENT 投影版本唯一派生；`confirm` 移动版本、`reject` 不动） | ✅ |
| **C2** | **Gap-driven Research Planning**：契约 Final Lock（`57789e5`/`69d2b1d`）→ Step 2-B Target 关联闭环（`6bfd702`）→ Step 2-C `research plan` 只读研究计划（`ee16851`）；Plan DTO 有**字段禁列**（`planId`/`createdAt`/`updatedAt`/`versionId`/`save(`/`upsert(`） | ✅ |
| **C3** | **Priority / NextAction 验证**：验证 Knowledge 引起的变化正确驱动**既有 persisted** Priority/NextAction（不重算、Report 不重算） | ✅ |
| **C4** | **Report / IndustryDossier 只读投影**（C4-A）与 **report-snapshot history**（C4-B，`research report-history`）；契约 §8.4 明确两者所有权 | ✅ |
| **C5-A** | **Research Recommendation**：`Company`（`research company add/list/get`）+ `TargetProposal`（`research proposal generate/list/get`）；`proposalRef` 确定性、同 `(gap, position, subject)` 仅一条 active（UNIQUE） | ✅ |
| **C5-B** | **Human-Gated Decision**：`research confirm\|reject <proposalRef> --operator <name>`；**`confirm` 是产出 `research_target` 的唯一路径**；Agent **不获得**该写权限 | ✅ |
| **C5-C** | **Plan 只读消费 Proposal/Decision**：`research plan` 展示 `positions[].proposals`（含 decision 与 `targetRef` 校验）+ `orphanProposals`；`--json` 向后兼容；零写用**内容指纹**证明 | ✅ |
| **C5-D** | **Diligence Preparation 边界冻结 + `ResearchPlan → Preparation` 只读摘要投影**（`{preparationRef, status, questionCount} \| null`）：契约 LOCK（`7672a49`）→ **已实现（`dc64c33`）+ 测试（`aa4dc95`）+ 独立复验收口（§21.11）**；`New tables = 0, Migration = 0` | ✅ |
| **C-MVP-R1** | **Material 导入可靠性**（状态机 + 续跑 + 查重语义 + 返回枚举 + 跨库恢复 + 并发认领 + 块级账本）：**仅契约**（总契约 **§29** rev4，DESIGN ONLY）—— **全部 LOCKED**，**实现未授权** | 📝 契约 LOCKED |

### 9.3 后续 Phase（用户建议，按**业务闭环**排，非模块依赖）

| Phase | 内容 | 说明 |
|---|---|---|
| **A** | 单行业研究闭环 | **S1–S7 已完成**（含 DATA-R1 legacy 修复、C-MVP 材料入口） |
| **B** | Research Planning / 调研准备链 | **B1–B5 已全部实现**（`docs/phaseB/implementation-contract.md` §12：无剩余 Step） |
| **C** | 调研回填闭环 | **进行中**：C1–C5-D **全部已实现并发布**；C-MVP-R1（材料导入可靠性）契约已落、**实现未授权**；C6（Material → Claim → Knowledge Evolution）未授权 |
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
- **B5-NOTE（需求的可服务位置依赖链）**：`research need` 的 `suggestedPositionRefs` 来自**已投影**的 `ResearchPosition`；未投影时为空并在输出中明确提示（先跑 `research chain`）——这是显式边界，不是缺陷。

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
- **（B1）链条是「模板实例」，不是「这个行业客观上存在这些节点」**：`ResearchPosition` 由 `ChainTemplate`（`CHAIN_TEMPLATE_GENERAL_V1`：6 个位置覆盖 12 维）投影而来并带 `chainVersion`；`ResearchNeed` 是**只读派生**（**永不成为 SoT**，只能读、不能改 Gap/Requirement/Priority）；投影**幂等**；同 `templateId + version` 若内容冲突则**抛错**，禁止静默覆盖。
- **（B2）Target 必须是「Human-confirmed subject」**：`subjectKey` 由人提供，`createdBy` 硬编码 `user`；**不存在** "Position → Target" 的自动路径（系统**绝不**自行生成公司/专家名称）；备选对象必须带 ref + limitations，并由 `targetCaveats()` 统一暴露给下游（B3/B4 读它，不各自判断 `isFallback`）。
- **（B3）Fit 是规则判定，只解释、不选人**：`evaluateFit()` 是纯函数（`targetKind` × 是否服务该问题 → `strong/partial/weak/none`）；`weak|none` **且** 重要问题（`importance ≥ 4`）⇒ `requiresFallback`——**只提出"需要备选对象"这一需求**，B3 **不找、不建、不选**另一个 target（架构红线）；Fit **不落表**（派生 + 稳定 `fitRef`），`fitReason` 必填且取自**封闭短语**，降级只依据 `target.isFallback` 这一**明确信号**（不做自由文本匹配）。
- **（B4）DiligencePreparation 是「研究什么」，不是报告**：三类来源**结构化可区分**（`common` / `target_specific` / `fit_derived`，是字段而非文风）；**每条问题必须可溯源**（`fromRequirementRef` 或 `fromFitRef`，I-B5）；`fit_derived` 把低适配度**明说**为 caveat（**不静默丢问题**）；**无 LLM、非报告生成器**；只写自己那一行（`dp-<targetRef>` 幂等）。
- **（B3/B4 细节）Fit 的决策不吃 `canAnswer`**：`canAnswer(weak) === true` 是**派生展示**（"能提供一定信息"≠"足以回答"）；B4 的判定只用 `answerability` / `confidence` / `limitations` / `requiresFallback`（B3 验收者提示）。
- **（S4.5）Policy provenance 不可伪造**：一次 Evaluation 记录 methodology + evaluation + aggregation 三个 version ref；`PolicyRegistry` 拒绝用不同内容重注册同一 versionId。
- **（S4.5）S5 之前不写 Priority**：S4.5 只恢复到 Evaluation 为止；PriorityService / ResearchPriority / 优先级排序算法属 S5。
- **（B5）B1 投影的「生产入口」就是人执行的 CLI `research chain`**：此前 `ChainProjectionService.project()` **只在测试里被调用**——B1 在生产不可达，`target add --position <ref>` 也无从取得 `positionRef`。B5 明确："人执行 CLI → 幂等投影（只写 `research_position`）"是唯一入口；让**派生规划**由明确触发者产生（与 S6/S7 同构）。
- **（B5）Agent 只读「已生成」的规划产物**：4 个 B5 工具**不注入投影服务、无 target 写工具、不生成提纲**；未生成时**点名由研究者执行 CLI**（与 `research_evaluate` 同一治理）。理由：链条/对象/提纲是**规划产物**，生成时机由人掌握，模型只解释现状。
- **（B5）适配概况是只读聚合，不是新判断**：`FitSummary` / `summarizeFits()` 只对 B3 已产出的 `QuestionTargetFit[]` 计数，CLI 与 Agent **共用**同一函数（避免两处各算一遍、口径漂移）。
- **（B5）"没有已落库优先级"不渲染成 0 分**：`need`/`diligence` 输出里，优先分为 0 且无 policy 版本时显示"暂无已落库优先级"，避免把"没有数据"读成"最不重要"。
- **（B5 验收裁决，2026-09-25）Agent 不获得「链条投影 / 对象录入」的受控写权限**：v1 维持只读（未注入投影服务、无 target 写工具）；UX 上 positions=0 时只提示 `tiancha research chain <行业>` —— **刻意接受**。Phase C 不得顺带放开；未来若需要须**单独授权 + 单独改契约**（契约 §11 Q1）。
- **（LLM 边界，2026-09-26 独立决策记录）「禁止引入 LLM」的范围，在此写定**：§0.2 第 6 条与 §1.6 红线 13 此前只有结论、理由散落在 S6 与 C-MVP 决策中，本条把它写成**一条可引用的决策**：
  1. **禁止**：用 LLM 直接产生 `Claim` / `Fact` / `Knowledge` / `PoolItem` / `Evaluation`，或用 LLM 生成 0–100 分的投资判断 —— `Claim` 是唯一 SoT，模型输出**绝不**自动升级为"已确认认知"；
  2. **禁止**：用 LLM 替代 C-MVP 的**规则解析**（`[CLAIM]` 块）—— 该语义已冻结，不得改写；
  3. **允许但需另立契约 + 单独授权**：模型**起草"候选"**（Draft Claim / 候选观点 / 报告草稿），条件是**每条候选必须带来源定位**（页码 / 段落 / 录音时间戳）且**必须经人工确认**才进入既有 Claim → Knowledge 投影；自动生成的报告只是**产物**，不是新的事实来源；
  4. 该"候选层"属 **C6 / Phase C 完整版**契约内容，**在裁决前不动 C-MVP 语义**；`model_version` 一类预留字段**不代表**已引入模型（见 `phaseC/implementation-contract.md` §29.2）。

---

## 11. 已知技术债与边界

| 债务 | 影响 | 归属 |
|---|---|---|
| **飞轮第一环缺失**（无自动搜集/赛道识别） | 所有入口需人先给行业名 | Phase E |
| ~~**调研准备链完全缺失**（链条/对象/适配/提纲）~~ **已由 Phase B v1 的 B1–B5 全部实现**：链条+位置+需求（B1）· 对象（B2）· 适配（B3）· 提纲（B4）· CLI/Agent 暴露（B5） | **无剩余 Step** | ✅ Phase B 收尾 |
| **Agent 受控写权限**（`project chain` / `record target`）：**已裁决 —— v1 不给**；Agent 只读已生成的规划产物，未生成时提示由研究者执行 CLI | Agent 不能自行制造研究计划事实（Human Gate 保持） | **已裁决**（非债务） |
| **B4：`requestedMaterials` / `risks` 恒为 `[]`** —— 无真实来源时**不臆造** | 提纲中"要哪些材料 / 风险提示"暂时为空 | Phase C（真实材料链落地后填） |
| **Field Research 缺失**（Material/Fragment/Evidence） | 碎片无法进入研究系统 | Phase C |
| `company` 表零调用（链条位置是**模板实例**，未与真实公司数据关联） | 无"这家公司属于哪个位置"的数据基础 | Phase C/E |
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
node --import tsx --test packages/research/src/*.test.ts src/agent/*.test.ts src/cli/*.test.ts   # 预期 383 pass
node --import tsx src/cli/tiancha.ts research smoke                            # 预期 PASS
```

**下一步功能**：**Phase C** —— 调研回填闭环（Material → Fragment → Evidence → Claim → Pool/Knowledge/Evaluation 更新），待用户授权。
> Phase B v1 的 **B1–B5 已全部完成**（契约 §12 无剩余 Step）；B5 仅暴露既有能力，未新增表/未改语义。

> **历史提醒（避免误判）**：`S1–S7`、`DATA-R1`、`C-MVP`、`Phase B v1 的 B1–B5` **均已完成**。
> 若你看到旧版文档写着「S5 HOLD」「Phase B 待冻结」「B5 待授权」，那是**过时**信息。

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
| `docs/phaseB/implementation-contract.md` | **Phase B v1 实现契约（B1–B5 已全部实现，见其 §12）**：Need → Position → Target → Fit → Diligence 的字段/identity/不变量/写入边界/T-B 验收 |
| `docs/phaseC/implementation-contract.md` | **Phase C 总契约**（C1 语义 / SoT 边界 / 演化 / Human Gate / 幂等 / 不变量 / 验收场景）+ **§29 = C-MVP-R1（材料导入可靠性，DESIGN ONLY，全部 LOCKED、实现未授权）** |
| `docs/phaseC/c5-implementation-contract.md` | **C5-A → C5-D 单文件谱系契约**（§19 C5-B · §20 C5-C · §21 C5-D；**§21.11 = 实现与验收闭环**） |
| `docs/architecture-review/05-business-intelligence-architecture-v3.md` | v3（v3.1 的前身，保留历史） |
| `docs/architecture-review/04-research-intelligence-architecture-review.md` | 实现状态盘点 + 需求映射（部分设计已被 06 取代） |
| `docs/architecture-review/01/02/03-*` | 早期 Gap Report / Blueprint v2 / v2.1-final-lock / rebaseline v3.1（**历史，部分过时**） |
| `docs/phase0/*`、`docs/phase2c/implementation-design.md` | Phase 0/2C 设计（历史） |
| `docs/SCORING_MODEL.md` | 旧 7 维 0–100 模型（**已被两层映射取代，仅作锚点参考**） |
| `docs/PROJECT_STATUS.md` | 旧状态报告（**已过时**） |
| `docs/ARCHITECTURE.md`、`docs/CORE_CUSTOMIZATION.md` | **legacy 工作台文档**，非当前架构 |

**待更新**：~~`README.md`（仍写 Phase 2C / 6 个工具）~~ **已随每次 Step 同步**（B5 更新 `chain/need/diligence`；C5-C 后 Agent 工具共 **19** 个）。

---

## 14. 当前能力矩阵（2026-09-26 核对）

**四态定义**：**设计** = 有契约 / 设计文档；**实现** = 生产代码有真实路径；**测试** = 有自动化测试覆盖；**真实路径** = 在**真实数据路径**上验证过（非 Echo 占位、非测试 fixture）。

| 能力 | 设计 | 实现 | 测试 | 真实路径 | 证据 / 备注 |
|---|:--:|:--:|:--:|---|---|
| Runtime 契约（Run/Round/TaskGraph/Attempt/Artifact/EventStore/ChildSession/HumanGate） | ✅ | ✅ | ✅ | ⚠️ 仅 smoke | `research smoke` PASS；**smoke 不打开研究库** |
| 2A 研究记忆底座（11 表 + Methodology v1 + 链路） | ✅ | ✅ | ✅ | ⚠️ 真实库有骨架 | 真实库：`industry` 1 · Question/Requirement/Slot 各 24 · PoolItem 12 · Gap 12 · NextAction 12 |
| 2B Agent 主入口（REPL / `ask` / 研究工具） | ✅ | ✅ | ✅ | ❌ | 无模型凭据 ⇒ 语义路由仅契约级 |
| 2C Knowledge 投影（SUPPORT / REVISE / CONFLICT / SUPERSEDE） | ✅ | ✅ | ✅ | ❌ | **真实库 `knowledge_belief` = 0 行** |
| P1 方法论版本化 + Human Gate | ✅ | ✅ | ✅ | ❌ | 真实库无 candidate / gate 记录 |
| S1–S2 幂等 identity | ✅ | ✅ | ✅ | ✅ | 真实库骨架已按确定性 key 建立 |
| S3 / S3-R1 Pool Slot + Item | ✅ | ✅ | ✅ | ⚠️ | 真实库 PoolItem 12 行 |
| S4 / S4.5 / S4.5-R1 Evaluation 四面 + policy provenance | ✅ | ✅ | ✅ | ❌ | **真实库 `investment_evaluation` = 0** |
| S5 Priority + NextAction | ✅ | ✅ | ✅ | ⚠️ | NextAction 12 行（Echo 来源） |
| S6 / S6-R1 Report 只读投影 | ✅ | ✅ | ✅ | ❌ | 真实库 `report_snapshot` = 0 |
| S7 能力暴露（CLI 4 + Agent 4 只读） | ✅ | ✅ | ✅ | ❌ | — |
| DATA-R1 legacy 方法论修复 | ✅ | ✅ | ✅ | ✅ | 真实库已复验（`withWeight`/`withCriticality` = 12） |
| C-MVP 材料入口（规则解析，无 LLM） | ✅ | ✅ | ✅ | ❌ | **真实库 `material` = 0 行** ⇒ 从未在真实库用过 |
| Phase B v1（B1–B5 链条 / 对象 / 适配 / 提纲） | ✅ | ✅ | ✅ | ❌ | 真实库 `research_position` / `research_target` / `diligence_preparation` = 0 |
| C1–C4（Knowledge 语义 / Planning / Priority 验证 / Report） | ✅ | ✅ | ✅ | ❌ | — |
| C5-A / C5-B（推荐 / 人工决定） | ✅ | ✅ | ✅ | ❌ | **真实库尚无 `target_proposal*` 两张表** |
| C5-C / C5-D（Plan 只读消费 / Preparation 摘要） | ✅ | ✅ | ✅ | ❌ | — |
| **C-MVP-R1**（材料导入可靠性） | 📝 契约 rev4（§29，**全部 LOCKED**） | ❌ | ❌ | ❌ | **实现未授权**（`D-R1-3 = B` · `D-R1-5 = 5a` · rev4 并发认领修正） |
| C6 / Phase C 完整版（Material → Fragment → Evidence → Claim） | ⛔ 未授权 | ❌ | ❌ | ❌ | `DocumentFragment` 仅类型；`evidence/evidence-engine.ts` 返回 `[]` |
| Phase D（外环：Experience → Pattern → 方法论候选） | ⛔ 未授权 | ❌ | ❌ | ❌ | 红线 9：不预造空壳表 |
| Phase E（Wind / 自动发现行业） | ⛔ 未授权 | ❌ | ❌ | ❌ | `echo-data-provider.ts` 仍是占位（`isRealExternalData=false`） |

> **读法**：**"实现 + 测试" 与 "真实路径" 是两件事**。当前绝大多数能力是 *设计 ✅ / 实现 ✅ / 测试 ✅ / 真实路径 ❌*——
> 因为唯一数据源仍是 Echo 占位（I13 禁止占位数据进 Knowledge / Evaluation），且真实库自 C5-A 之后未被打开过。
> **不要把"有模型、有命令、测试全绿"当成"业务能力已在真实数据上完成"。**
