# Tiancha · 天查 — 项目交接文档（HANDOFF）

> **2026-09-23 重写** · HEAD `181299b` · 远端 `https://github.com/bufan528/tiancha`（main，已同步）
> 本文档已与真实代码状态**逐项核对**（`npx tsc --noEmit` exit 0 · `packages/research` typecheck exit 0 · **64 tests 全过** · `research smoke` PASS）。
> 旧版 HANDOFF 已过时（写的是 `5375000`、2C 未接线、方法论纯静态），本版取代它。

---

## 0. 怎么读这份文档

| 你的目的 | 直接看 |
|---|---|
| 搞清楚「要做成什么」 | §1 定位原则、§2 需求对照 |
| 想知道「现在做到哪了 / 哪些是空的」 | §2 缺口表、§9 Phase 进度、§11 技术债 |
| 上手开发 | §4 目录、§5 命令、§12 规范、§14 接手第一步 |
| 改数据模型 | §7 数据模型 |
| 防止踩红线 | §3 依赖红线、§10 八条 Invariant |

---

## 1. 项目定位、产品愿景与设计原则

Tiancha 是 **local-first、长期记忆、自然语言为入口的一级市场 Research Intelligence Agent**。

它**不是**通用聊天 Agent、不是 Pi 改版、不是 PDF/RAG/自动报告工具。用户在和「天查」这一个研究伙伴对话，研究系统（ResearchState / Pool / Gap / TaskGraph / Agent 名）全部藏在后面。

### 1.1 核心飞轮

```
发现机会 → 当前研究状态 → Research Gap → Research Question → Research Target
→ Diligence 准备 → 人工调研 → 碎片输入 → Evidence/Claim/Event
→ Knowledge / Information Pool 更新 → ResearchState 更新 → 新 Gap → 下一轮
```

### 1.2 设计原则（不可违背）

- **自然语言优先**：不向普通用户暴露 ResearchState / Pool / TaskGraph / Agent 名 / service 名。
- **local-first**：结构化实体、状态、事件、Claim/Evidence metadata 存 SQLite；原始材料/报告/录音/Artifact 存文件系统。
- **evidence-first**：Evidence/Claim/Fact/Event 是 Source of Truth；Report/Profile/Dossier 是 Snapshot（可重算）。
- **单向链路**：`Knowledge → InformationPool → ResearchState → Gap`；**State 永不回写 Pool**，禁止 Pool→State→Pool 循环。
- **历史永不覆盖**：新旧 Evidence/Claim/Belief 并存并比较（SUPPORT/REVISE/CONFLICT/SUPERSEDE）。
- **Conflict 不选边**：冲突双方全保留，状态 = open，不自动判对错。
- **Methodology Human Gate**：方法论只能「提案 → 人批准 → 激活新版本」，模型**永不**自动改方法论。

---

## 2. 需求 ↔ 架构对照（本次第一手复核）

> 本节是「需求与架构是否有出入」的结论。判断原则：把用户的**业务链路**逐条映射到**代码里的承载物**，标注真实状态。

### 2.1 业务六步链路

| # | 需求 | 代码承载物 | 真实状态 | 出入 |
|---|---|---|---|---|
| ① | 自动化信息搜集，识别赛道、提取行业名称 | **无**（行业名靠 `tiancha industry ingest` 手动喂） | ❌ 未实现 | 飞轮第一环是手动的，产品目前是「演示级」而非「能跑」 |
| ② | 借助 Wind 等数据源补全行业各维度信息 | `ports/data-provider.port.ts`（接口就绪）+ `providers/echo-data-provider.ts`（占位） | 🟡 接口在，实现是占位 | Wind 未接；`src/wind-bridge.ts` 是 legacy mock，非当前路径 |
| ③ | 多维标准打分，有价值纳入储备体系 | `industry.reserve_status` 字段（在，未写业务逻辑）+ `config/scoring.json`（legacy） | ❌ 打分模型未实现 | `scoring/` 是空壳 |
| ④ | 信息沉淀机制，形成随新信息动态调整的行业档案 | `IndustryKnowledge / KnowledgeBelief / KnowledgeConflict` + 四种 Evolution + `reconcilePool/refreshGaps/refreshState` | ✅ **已实现并接线** | 无（见 §2.3 的「档案」定位澄清） |
| ⑤a | 调研准备：推荐调研链条（上游/下游/贸易商/咨询机构）+ 企业（龙头）+ 针对性提纲 | `industry_chain` 维度（12 维之一）+ `company` 表（**零调用**）+ `TargetCandidate`（占位） | ❌ 未实现 | **用户最关心的主线，目前只有「回填」这一半** |
| ⑤b | 调研回填：碎片信息 → 深度报告 → 回填信息池 | `OpportunityDiscoveryService.ingestClaims`（碎片 → Claim → 投影 → 刷新）+ `research_source`（溯源） | 🟡 回填已实现；**报告生成未实现** | `evidence/evidence-extractor.ts` 是空壳；无「录音稿→报告」链路 |
| ⑥ | 基于信息池对重点标的形成研究规划建议 | `next_action` 表 + `refreshNextActions`（Gap→NextAction 幂等） | 🟡 Gap→NextAction 已实现；**研究规划未实现** | `planning/` 是空壳 |

### 2.2 两大知识体系（用户明确点名的项目灵魂）

| 体系 | 用户表述 | 代码承载物 | 状态 |
|---|---|---|---|
| ① **专业投资知识体系**（怎么筛选好行业） | 「要能通过我提供的资料，逐步提升行业投资能力」 | `methodology` + `methodology_candidate` + `human_gate` 表 + `MethodologyService` + `config/methodology-v1.json`（12 维 Human-approved baseline） | ✅ **已实现**（版本化 + Human-in-the-loop，模型只能提案） |
| ② **行业研究知识体系**（怎么把一个行业研究明白） | 「每个潜力行业各维护一套知识库，越沉淀越懂这个行业」 | `industry_knowledge / knowledge_belief / knowledge_conflict` + 四种 Evolution + 全历史保留 | ✅ **已实现并接线**（ingest 与回填都会沉淀） |

### 2.3 术语澄清（容易误读，务必对齐）

用户口语里的三个词，在代码里跨了不同层次，**不是同一个东西**：

| 口语 | 代码里的真实所指 | 说明 |
|---|---|---|
| 「信息池」 | `information_pool_entry`（**覆盖度状态**：维度框好没有、填了没有）+ `Claim/Evidence`（**信息内容**） | 池子是「框架 + 覆盖状态」，**不是**信息本身 |
| 「知识库」 | `industry_knowledge / knowledge_belief`（**认知**：对某维度的判断 + 演变历史） | 是「理解」，不是「资料堆」 |
| 「行业档案」 | **不含独立存储** —— 它是「当前认知的视图/快照」，随时可重算 | 见 §13 决策 |

**信息内容的 Source of Truth 是 `Claim`（存 `artifacts.sqlite`）**，不是池子。

### 2.4 一条容易误解的「方向」

用户表述：「信息池提供基础信息，知识库基于这些基础信息不断完善对行业的理解。」
代码里存在箭头：`Knowledge → InformationPool`。

**这两者不矛盾，是不同层次的两件事**：

```
Claim/Evidence（信息内容，SoT）
      │ projectFromClaim
      ▼
KnowledgeBelief（认知 + 演变历史）   ←── 用户说的「知识库」
      │ reconcilePool
      ▼
InformationPool（覆盖度状态）        ←── 用户说的「信息池」的「框架/进度」面
      │ refreshState
      ▼
ResearchState（快照） → ResearchGap（缺口） → NextAction（下一步）
```

- 「信息 → 理解」是 `Claim → Belief`（认知形成）；
- 「有了确信的认知 → 更新覆盖度」是 `Knowledge → Pool`（`reconcilePool`：某维度有 `confirmed` belief，池子才从 `unknown` → `partial`）。

### 2.5 结论

**架构与需求没有方向性冲突。** 现有缺口**全部是「尚未实现的 Phase」**（①③⑤a⑤b 报告生成⑥ 规划），不是设计走样；已实现的 ④ 与两大知识体系与需求高度吻合。

真正需要钉住的只有两点（都属「表述/边界」而非 bug）：
1. **术语层次**（§2.3）必须在文档与对话里统一，否则会出现「以为池子存信息」的误用；
2. **飞轮第一环（①）缺失**导致系统目前所有入口都是「人先给行业名」，这是与「工作流自动化」诉求差得最远的一环。

---

## 3. 整体架构与依赖红线

```
Composition Root: src/cli/tiancha.ts   ← 唯一装配点，唯一 import @earendil-works/pi-coding-agent
        │
TianchaAgentHost (src/agent/tiancha-agent-host.ts)
   ├─ 交互 REPL / askOneShot（共享同一套 Agent 装配）
   ├─ 天查系统提示 + 9 个研究 customTools（src/agent/research-tools.ts）
   └─ 经 TianchaAgentSessionFactory → Pi Runtime（复用，不重写 Loop/Session）
        └─ Research Core (packages/research) 仅依赖 Port，绝不 import coding-agent
```

依赖方向（gate 强制）：`pi-ai ← agent-core(coding-agent) ← research-core ← composition-root`。

**实测**：`packages/research/src` 全树 `@earendil|coding-agent|pi-coding` 命中均为**注释**，真实 import = 0。

---

## 4. 目录结构

```
src/
  cli/tiancha.ts                Composition Root；无参数进 Agent REPL，另含 ask/industry/state/methodology/session/research 子命令
  agent/tiancha-agent-host.ts   TianchaAgentHost（startInteractive / askOneShot）
  agent/research-tools.ts       9 个研究工具（语义工具选择，无关键词分类器）
  agent/host.test.ts            T6/T7 + 方法论工具安全断言

  # ---- legacy（Pi 工作台 v2.0，见 §11，不可再作为默认入口）----
  server.ts / store.ts / invest-extension.ts / wind-bridge.ts / agent-factory.ts
  tools/  （material_ingest / memory_search / pool_list / profile_read / profile_write / wind_query）
web/  data/  tools/wind_query.py  （旧 Web 界面 + JSON 仓储 + Wind 桥，legacy）

packages/research/src/
  domain/           领域对象（Industry/Company/Question/Requirement/Gap/Pool/State/Claim/Evidence/Fact/
                    Methodology/MethodologyCandidate/IndustryKnowledge/KnowledgeBelief/KnowledgeConflict/HumanGate…）
  ports/            Port 抽象（AgentSessionFactory/EventBus/Session/DataProvider/ModelResolver…）
  storage/          research-db.ts（建表 + PRAGMA 迁移）、research-repository.ts、knowledge-repository.ts、
                    artifact-store.ts、research-event-store.ts
  application/      methodology-service.ts（P1）、knowledge-projection-service.ts（2C）、
                    opportunity-discovery-service.ts（2A + 回填）
  providers/        echo-data-provider.ts（占位）
  runtime/          tiancha-runtime / task-engine / orchestrator / child-session / human-gate / model-router / event-adapter
  migration/        pi-to-tiancha、readonly-session-manager
  methodology/      methodology-v1.ts（12 维 baseline 常量）
  agents/ planning/ scheduler/ evidence/ dossier/ scoring/   ← 空壳占位（Phase 3+）
  *.test.ts         13 个测试文件（64 个用例）

config/methodology-v1.json      12 维 Human-approved baseline（**镜像文件，运行时不读**，见 §11）
config/scoring.json             旧评分模型配置（legacy）
docs/phase0/                    P0 设计（01–09）
docs/architecture-review/       Gap Report / Blueprint v1/v2/v2.1-final-lock / rebaseline v3.1
docs/phase2c/implementation-design.md
docs/PROJECT_STATUS.md          旧状态报告（部分已过时，见 §11）
docs/HANDOFF.md                 本文件
vendor/pi/                      Pi 源码快照（MIT，1827 文件）
samples/                        示例材料
```

---

## 5. 环境、安装、构建、运行、验证

- **Node ≥ 22.19**（本机实测 v24.13.0）。
- 依赖：`@earendil-works/pi-coding-agent ^0.86.1`、`@earendil-works/pi-ai ^0.86.1`、`typebox ^1.3.27`；dev：`tsx`、`esbuild`、`typescript`。

```powershell
npm install
npx tsc --noEmit                                  # 根类型检查
npm --prefix packages/research run typecheck      # 研究包类型检查
npm run build:cli                                 # esbuild → dist/cli/tiancha.js
node --import tsx --test packages/research/src/*.test.ts src/agent/*.test.ts
node --import tsx src/cli/tiancha.ts research smoke   # 预期 PASS (child-session=real)
```

- `npm run tiancha` = `node --import tsx src/cli/tiancha.ts`。
- 配置目录 `~/.tiancha/`：`agent/`（Pi 会话/扩展）、`db/tiancha.sqlite`（研究库）、`db/artifacts.sqlite`（Claim/Evidence blob）。
- 凭据 `.pi/auth.json`、`.pi/models-store.json`、`.tiancha/`、`*.sqlite`、`dist`、`node_modules` 均 gitignore。
- **PowerShell 提示**：esbuild/smoke 会写 stderr（含 SQLite ExperimentalWarning），PowerShell 报 `NativeCommandError` 属**正常现象**，不是失败。

---

## 6. CLI 命令与研究工具

### 6.1 CLI（`tiancha`）

| 命令 | 说明 |
|---|---|
| `tiancha`（无参数） | 天查 Agent 交互 REPL（**产品主入口**） |
| `tiancha ask "<NL>"` | 非交互单轮（与 REPL 共享同一装配） |
| `tiancha industry ingest <file> --name <行业>` | 行业材料入库 |
| `tiancha industry show <行业>` / `state show <行业>` | 查看行业概况 / ResearchState |
| `tiancha methodology show` | 查看**当前已激活**的方法论版本与维度 |
| `tiancha methodology list` | 方法论版本历史 + 待审批提案 |
| `tiancha methodology propose <file.json> --rationale <文本> [--by agent\|user]` | 提出方法论修订提案（**不生效**），输出一次性审批 token |
| `tiancha methodology decide <candidateId> (--approve\|--reject) --operator <名> [--comment <文本>] [--token <token>]` | **人工**审批；approve 才激活新版本 |
| `tiancha research smoke` | 运行时自检 |
| `tiancha session readonly <path>` | 只读恢复会话 |

### 6.2 研究 customTools（9 个，主模型语义选择）

`research_industry_ingest / research_industry_show / research_state_show / research_question_list / research_gap_list / research_next_action_list`（2A/2B）
`+ research_methodology_show / research_methodology_list / research_methodology_propose`（P1）

> **重要**：**没有** `research_methodology_decide`。模型只能**提案**，激活必须由人通过 CLI 完成（Invariant 6）。审批 token 从不暴露给模型。`host.test.ts` 有硬断言钉住这条。

---

## 7. 数据模型

### 7.1 SQLite 表（同库 `~/.tiancha/db/tiancha.sqlite`，共 16 张）

**2A 业务表（11）**：`industry`、`company`、`research_question`、`information_requirement`、`research_gap`、`information_pool_entry`、`research_state`、`research_source`、`research_document`、`next_action`、`methodology`。

**2C 知识表（3）**：`industry_knowledge`、`knowledge_belief`、`knowledge_conflict`。

**P1 演进表（2）**：`methodology_candidate`、`human_gate`。

加列均走 **PRAGMA table_info 预检查**（`industry.current_knowledge_id`、`methodology.dimensions_json`），try/catch 仅并发兜底。
Claim/Evidence blob 存 `artifacts.sqlite`。

### 7.2 四类长期资产

1. **Investment Methodology**（如何研究）：`methodology` + `methodology_candidate`；12 维 Human-approved baseline；**版本化、Human-gated**。
2. **Industry/Company Knowledge**（知道什么）：`industry_knowledge / knowledge_belief / knowledge_conflict`。
3. **Information Pool / State**（需要什么·已知多少）：`information_pool_entry` + `research_state`。
4. **Research Experience**（未来一等概念，本阶段不实现）：未来由 Research Event 派生。

### 7.3 追溯链与四种 Evolution

**追溯链**：`IndustryKnowledge → Belief(claimRef/sourceRef/evidenceRef) → Claim(Artifact) → Evidence → Source → Document`。

**四种 Evolution**（`knowledge-projection-service.ts`，保守判定）：
- **SUPPORT**（同 subject + 同 dimension 且无 hint → 安全默认）
- **REVISE**（显式 hint → 旧 `revised`，新 `confirmed`）
- **CONFLICT**（显式 hint → 双方 `conflicting` + 一条 `open` conflict 行，**不选边**）
- **SUPERSEDE**（显式 hint → 旧 `superseded`，新 `confirmed`）

**跨 dimension 永不自动判定**；无 Metric Ontology，不做数值区间/口径/时间窗的自动冲突推断。占位数据（`isRealExternalData=false`）**永不进入 Knowledge**（投影返回 `SKIPPED`）。

### 7.4 代码级链路（ingest / 回填）

```
材料或调研碎片 → Claim(isRealExternalData) → projectFromClaim → KnowledgeBelief
→ reconcilePool → refreshGaps → refreshNextActions → refreshState → ResearchState
```

`OpportunityDiscoveryService.ingestClaims({subjectKind, subjectId, claims[], sourceType?, sourceTitle?})` 即「调研回填」入口：每条 claim 落盘 + 投影，`relationHint` 驱动 Evolution，最后跑完整刷新。

---

## 8. 数据源与模型系统

- **EchoDataProvider**（`providers/echo-data-provider.ts`）：确定性占位，强制 `isRealExternalData=false` / `sourceType=echo_placeholder`，禁止据此做真实投资判断。
- **DataProvider Port**：未来接 Wind/Web/公司官网/上传/MCP。旧 `src/wind-bridge.ts` 为 mock/legacy。
- **模型系统**：复用 Pi 的 Provider/Auth/ModelRegistry/Model Policy/Router，经 composition root 注入；研究包不直接依赖。无 key 时语义路由未端到端验收（技术债）。

---

## 9. Phase 进度与路线图

| Phase | 状态 | 说明 |
|---|---|---|
| 0 架构审计/Lock | ✅ | Gap Report / Blueprint v2.1-final-lock / rebaseline v3.1 |
| 1 Runtime 契约 | ✅ | Run/Round/TaskGraph/TaskAttempt/Artifact/EventStore/Child Session |
| 2A 研究记忆底座 | ✅ | 11 表 + Methodology v1 + Echo + OpportunityDiscoveryService |
| 2B Agent 主入口 | ✅ | TianchaAgentHost + 研究工具 + 语义路由 |
| 2C Knowledge 投影 | ✅ **已接线** | 三表 + 四种 Evolution + 单向链路；**ingest 与回填均已接线** |
| **P0 知识沉淀/回填接线** | ✅ | Echo 占位不再污染；真实数据沉淀；Gap→NextAction 幂等；回填入口；溯源修复 |
| **P1 方法论版本化演进** | ✅ | candidate + Human Gate token + CLI + 天查提案工具（模型不能激活） |
| 2D 重启恢复/持久化回归 | ⏳ | Session 仍 `inMemory`，不跨进程 |
| 3 Industry Research Engine | ⏳ | 含**自动搜集 + 赛道识别**（飞轮第一环）、打分模型 |
| 4 Research Target / Chain / Recommendation | ⏳ | 调研链条推荐依赖 `industry_chain` + `company`（未用） |
| 5 Diligence Preparation | ⏳ | 针对性调研提纲 |
| 6 Field Research Ingestion | ⏳ | 碎片 → Claim 的结构化抽取（现仅有人工结构化入口） |
| 7 Evidence-linked Report | ⏳ | 调研报告生成 |
| 8 Research Planning | ⏳ | 研究规划建议 |

**按因果依赖推荐的下一步优先级**（与业务链路对齐，而非按功能排）：
**P2 自动搜集 + 赛道识别**（飞轮起点，目前最缺） → **调研准备链**（用户最关心的主线） → 打分模型 + Wind 真源 → 报告生成 + 规划。

---

## 10. 八条 Invariant 与落地证据

| # | Invariant | 落地证据 | 状态 |
|---|---|---|---|
| 1 | Pool ≠ Knowledge | `foundation.test.ts` T3 + 两套表物理分离 | ✅ 有测试 |
| 2 | Evolution 永不静默删历史 | `knowledge.test.ts`、`knowledge-projection.test.ts`（revised/superseded 行保留） | ✅ 有测试 |
| 3 | Conflict 永不静默选边 | 投影 CONFLICT 测试 + reconcile「both beliefs retained」+ gap「no auto-resolution」 | ✅ 有测试 |
| 4 | State 永不回写 Pool | `refreshState` / `refreshGaps` 的 one-way 测试 | ✅ 有测试 |
| 5 | Echo 占位永不变成真实外部证据 | `projectFromClaim` 占位 `SKIPPED` + T3「echo never promotes pool/state」 | ✅ 有测试 |
| 6 | Methodology 无 Human Gate 不能 Activate | `decide` 强制 `operator`；**无 decide 工具**（host.test 断言）；无 operator 抛错测试 | ✅ 有测试 |
| 7 | Knowledge 可回溯 Claim/Evidence/Source/Doc | belief `claimRef/sourceRef` + 回填测试断言「sourceRef resolves to a research_source row」 | ✅ 部分（Evidence 仍占位） |
| 8 | Phase1/2A/2B 行为不变 | foundation/storage/task-graph/event-adapter/migration/readonly 全绿 + smoke + host.test | ✅ |

---

## 11. 已知技术债与边界

**行为已修正（注意旧文档过时）**：
- 接线后 **Echo 不再假装填满 12 维**：`tiancha industry ingest` 的输出从 `gaps=0/nextActions=0` 变为 `gaps=12/nextActions=12`。`docs/PROJECT_STATUS.md` 中「Echo 覆盖全部 12 维 → 首次 gaps=0」的记录**已过时**。

**遗留债务**：

| 债务 | 影响 | 归属 |
|---|---|---|
| **飞轮第一环缺失**（无自动搜集/赛道识别） | 所有入口需人先给行业名 | Phase 3 |
| `company` 表零调用、`industry_chain` 维度未被利用 | 调研链条推荐无数据基础 | Phase 4 |
| Gap 的「低重要性」分支不可达（`ingestMaterial` 恒 `importance=5`，阈值 `>=2`） | 缺口分级失效 | Phase 3 |
| `ingest` 非幂等（重复 ingest 同行业会再建一套 Question/Requirement/Pool） | 重复数据 | 2D/3 |
| Agent Session 用 `SessionManager.inMemory` | 对话历史不跨进程 | 2D |
| 回复非流式（`agent_end` 一次性取文本） | 体验 | 2B 后续 |
| `config/methodology-v1.json` 与 `methodology-v1.ts` 手工镜像、**运行时不读** | 改 json 不生效 | P1 后续 |
| `nextVersionTag()` 用版本计数、`getActive()` lazy-bootstrap 有写副作用、`isHumanApprovedBaseline` 命名漂移 | 低危 | 顺手清 |
| `evidence/`、`dossier/`、`scoring/`、`planning/`、`agents/`、`scheduler/` 为空壳 | 相关能力未实现 | Phase 3+ |
| 无模型 key 时语义路由未端到端验收 | T6/T7 为契约级 | 有模型环境后补 |

**legacy 资产（保持现状，仅标注身份）**：`src/store.ts`、`invest-extension.ts`、`wind-bridge.ts`、`server.ts`、`agent-factory.ts`、`src/tools/*`、`web/`、`data/`、`tools/wind_query.py`、`.pi/skills/**`、`config/scoring.json`。
**它们不是产品入口**：`tiancha` 无参数必须进天查 Agent，绝不能 fall through 到旧 host；`data/` 的 JSON 仓储与 SQLite 研究库**不是同一套真相**。

---

## 12. 开发规范

- **小步闸门式**：每步 build + typecheck + 全量测试 + smoke 全绿才进下一步；单一目的 commit、可回滚。
- **Scope Fence**：不重写 Pi Loop；不建第二套 Session；Research Core 不 import coding-agent；不裸调 agentLoop；Task 输出不绕过 Artifact；Dossier 非 SoT；**模型永不激活方法论**。
- **加列纪律**：改表加列务必走 `PRAGMA table_info` 预检查，别裸 `ALTER`。
- **术语纪律**：区分「信息内容（Claim）/ 覆盖度（Pool）/ 认知（Belief）/ 快照（State、档案）」（见 §2.3）。

---

## 13. 关键决策记录

- **v3.1 边界**：Pool→State 单向；2C 不做真实 Material→Evidence 抽取；IndustryKnowledge 是长期 Cognition 而非 Claim 列表。
- **Knowledge header = 当前投影**（version 递增，无快照表）；历史由 Belief + Relation + Conflict 保留。
- **Claim 无 dimension 字段** → `projectFromClaim` 显式传 dimension。
- **占位数据不进 Knowledge**：`Claim.isRealExternalData=false` → 投影 `SKIPPED`（Invariant 5）。
- **方法论演进 = 版本化 + Human-in-the-loop**：模型提案（candidate），人批准后激活新版本，旧版本永不删除；审批凭据 `resumeToken` 一次性、限域、过期、只存哈希。
- **「行业档案」= 视图，不是真相**：真相只有 `Claim/Evidence（SoT）→ Belief（认知）→ Pool（覆盖度）`；档案/报告可物化为文件，但系统内查询永不把它当真相，避免出现「两套真相」（这正是「沉淀转化难」的病根）。
- **天查不给 decide 工具**：模型只能提案，防止「自己批准自己」。

---

## 14. 接手第一步与踩坑

**第一步（推荐）**：

```powershell
npm install
npx tsc --noEmit
npm --prefix packages/research run typecheck
node --import tsx --test packages/research/src/*.test.ts src/agent/*.test.ts   # 预期 64 pass
node --import tsx src/cli/tiancha.ts research smoke                            # 预期 PASS (child-session=real)
```

**下一步功能**：Phase 3 的**自动搜集 + 赛道识别**（飞轮第一环），或 Phase 4/5 的**调研准备链**。

**踩坑清单**：
1. 仓库改名/复制后 `node_modules/@tiancha/research` 的 junction 可能指向旧路径 → 根 `tsc` 报 `Cannot find module '@tiancha/research'`；重跑 `npm install` 或重建 junction 即可。
2. PowerShell 下 stderr 的 `NativeCommandError` 是 esbuild/Smoke 写 stderr 的正常现象，不是失败。
3. `git push` 已配置好（origin `https://github.com/bufan528/tiancha.git`），直接 `git push origin main`。
4. 改 `industry` / `methodology` 表加列务必走 PRAGMA 预检查。
5. 任何把占位数据（Echo）当真实证据的改动，都会被 Invariant 5 的测试挡住 —— 这是**有意的**。
6. 不要给天查加「激活方法论」的工具或路径。
