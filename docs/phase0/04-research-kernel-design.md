# 04 · 研究内核设计（Research Kernel Design）

> 版本：P0v3（Architecture Lock）
> 上游 commit：`19451accdeec671c1f4da9eafac8fc270f510ef4`
> 设计目标：研究态与聊天态分离；任务=不可变执行单元、单轮=严格 DAG、Research Run 允许循环；证据可溯源、结论可证伪。本文只定接口/模型/机制，不写实现代码。评分口径对齐 `docs/SCORING_MODEL.md`（7 维、权重、锚点、入池阈值 65）。
> 配套：运行时机制见 `07-research-runtime-design.md`；数据实体明细见 `08-research-data-model.md`。

## 1. ResearchTask 接口与状态机

### 1.1 接口字段（草案）

```
ResearchTask {
  id: string                 // 不可变；运行期不重开旧 task（见 §2 Run/Round）
  type: TaskType            // plan / hypothesis / collect / extract_industry / resolve /
                            // enrich / evaluate / critic / dossier_update / report / human_gate
  status: TaskStatus         // 见 §1.2
  priority: number          // 调度优先级
  dependencies: string[]    // 前置 task id（同轮 DAG 内）
  inputs: TaskInputs        // 行业/公司/问题/已知 Fact/Claim 引用
  outputs: TaskOutputs       // 产出引用：Fact/Claim/Evidence/Score/Report
  agentRole: AgentRole       // planner / scout / resolver / analyst / critic / writer
  modelPolicy: ModelPolicy  // cheap/strong/thinking + ThinkingLevel(7 级)，见 02 ModelRouter
  humanGate: HumanGateKind  // none / before_reserve / before_major_conclusion
  retry: RetryPolicy
  budget: { maxTurns, maxCost }
  roundId: string           // 所属 Research Round（见 §2）
}
```

- **Task 是不可变执行单元**：一旦进入 `running`，其依赖/输入不再改；要改主意就新建 task。
- **每个 task 经 TianchaAgentSessionFactory 创建标准子会话**（P0-2），可指定 model/thinking/tools/skills/extensions/research context，天然继承 ModelRuntime/ScopedModel/ResourceLoader/Extensions/Tools/Session lifecycle/Settings/Telemetry/Skills/MCP，**不得绕过裸调 agentLoop**。

### 1.1.1 TaskAttempt（Task 与尝试解耦，P0-2）

**Task 不可变，但一个 Task 可有多次尝试（attempts，1—N）**。重试/恢复不重开 Task，而是追加一条 TaskAttempt。TaskAttempt 字段：

```
TaskAttempt {
  attemptId: string
  taskId: string
  startedAt / endedAt
  model: string
  thinkingLevel: ThinkingLevel
  toolCalls: ToolCallRecord[]
  tokenUsage: { input, output, ... }
  cost: number
  status: running | succeeded | failed | aborted
  error?: string
  outputs: ArtifactRef[]        // 见 §3 Artifact Contract
}
```

用途：**重试审计**（每次失败/中断的现场可追溯）、**成本统计**（按 attempt 汇总 token 与金额）、**模型效果对比**（同 Task 不同 model/thinkingLevel 的成功率与产出对比）、**Run 复盘**（按 TaskAttempt 重放整个 Run）。Task 本体记录「第几次 attempt 在跑」，不把单次运行结果写进 Task。

### 1.2 状态机（Task 层）

```
queued ──schedule──▶ running ──ok──▶ completed
   │                   │
   │                   ├──needs-input──▶ waiting ──resume──▶ running
   │                   ├──error(retryable)──▶ queued(backoff)
   │                   └──error(fatal)──▶ failed
   └──cancel──▶ cancelled
```

`completed / failed / cancelled` 为终态。**闭环不靠重开旧 task**：critic 发现证据不足 → 由 orchestrator 新建下一个 Round（见 §2），不回到旧 task。`human_gate` 类 task 进 `waiting`，由持久化 HumanGate（见 §9）恢复。

#### Run / Round / Task 三层状态（P1，分别定义）

三层状态各自独立枚举，不混用：

```
Run   : planning | active | waiting_input | completed | failed | cancelled
Round : planned   | running | review       | completed | rejected
Task  : queued    | running | waiting     | completed | failed | cancelled
```

- **Run**：一次完整研究目标。`waiting_input` = 卡在 HumanGate 等人工决策；`completed/failed/cancelled` 为终态。
- **Round**：Run 内一轮 DAG。`review` = 本轮 DAG 跑完等 critic/人工评审；`rejected` = 评审打回。**Round rejected 不重开旧 task**——旧 Round 的所有 task 保持其终态，由 orchestrator **新建一个 Round**（见 §2）生成补缺口的新 DAG。
- **Task**：DAG 节点，见上方状态机；`waiting` = 等外部输入（HumanGate / 数据源返回）。

## 2. Research Run / Round / DAG（P0-4）

三层模型：

- **ResearchRun**：一次完整研究目标（如「评估行业 X 是否入池」），**允许循环**。
- **Round**：Run 内的一轮，**单轮 Graph 是严格 DAG**（无环）。
- **Task**：DAG 节点，不可变。

```
ResearchRun
 ├─ Round1 (DAG)
 │    PLANNING → HYPOTHESIS → COLLECTION(并行: Wind/Web/Reports/Company/Policy)
 │                            → INDUSTRY_EXTRACTION → RESOLUTION(对齐口径)
 │                            → ENRICHMENT → EVALUATION → CRITIC
 ├─ Round2 (DAG)   ← critic 在 Round1 打回「证据不足/矛盾」时新建
 │    仅生成补缺口的新 DAG（如补 TAM 源、补竞争 company set）
 └─ Round3 (DAG) …… 直到 critic 通过 / 预算耗尽
        └─ 所有 Round 完成后 → DOSSIER_UPDATE → REPORT → HUMAN_GATE
```

规则：
- 单轮内无环；跨轮靠 orchestrator 新建 Round 表达「打回—再采」。
- critic 打回**不重开旧 task**：生成新 Round、新 DAG，完成后把新 Fact/Claim/Evidence **合并**进研究库（版本留痕，不覆盖旧值）。
- **Round `rejected` 语义**（P1）：Round 进入 `review` 后，critic 或人工判定证据不足/矛盾未消解 → Round 置 `rejected`。旧 Round 内所有 task 维持其终态（completed/failed），**不复活、不修改**；orchestrator 依据打回原因**新建一个 Round**（状态 `planned`），仅生成补缺口的新 DAG。Round 终态为 `completed`（通过）或 `rejected`（被打回，由后续新 Round 接续）。
- 并行五路是**任务级并行**（各开标准子会话），不改 Pi 单 lane 的 tool 调度。
- `EVALUATION` 把 `config/scoring.json` 锚点文本拼进提示词（复用 `buildResearchLoopSection({scoringConfig})`）。
- `CRITIC` 用强模型 + 质量门（复用 `harness/research/quality-gate.ts` 的 `before_run_end` followUp 闭环）。

## 3. ResearchContext 数据模型（与聊天 Context 分离）

独立于 Pi 的 `AgentMessage`/会话 entry，存研究库（`packages/research/storage/`）。核心实体见 `08-research-data-model.md`；层级关系：

```
Document ─▶ DocumentVersion ─▶ DocumentFragment ─▶ Citation ─▶ Evidence ─▶ Claim ─▶ (聚合) Score/Report
                                                                │
Source ──────────────────────────────────────────────────────────┘
```

关键实体：

| 实体 | 关键字段 |
|---|---|
| **Project** | id、名称、目标、当前行业集 |
| **Industry** | id、名称、别名、评分、评级、入池状态、版本 |
| **Company** | id、所属行业、标签、轮次、关键指标 |
| **Fact** | id、标准化观察值（如 `CompanyX 2025 Revenue=12.8亿`）、单位、币种、时点、口径 |
| **Claim** | id、语义命题、**claimType**（descriptive/causal/forecast/interpretation/hypothesis）、**provenance**（official/management/analyst/expert/user/third_party）、证据引用 |
| **Hypothesis** | id、表述、验证状态（confirmed/refuted/open）、证据引用（独立实体，不再塞进 source_role） |
| **Evidence** | id、指向 Claim、Source、Quality 属性集（见 §4）、EvidenceLocator |
| **EvidenceAssertion** | evidenceId / claimId / stance（support/contradict/contextualize/weaken）/ strength(0..1) / confidence(0..1)；Evidence→Claim 的带立场断言 |
| **Source** | id、出处类型、发布方、发布日期、可信度 |
| **Document/Version/Fragment** | 原始文档、版本、片段定位 |
| **Citation** | 引用片段 + EvidenceLocator |
| **ResearchEvent** | eventId / runId? / roundId? / taskId? / industryId? / companyId? / type / payload(JSON) / occurredAt / source（持久事件，见 §11） |
| **Event** | id、行业/公司事件、日期、影响方向、关联 Claim |
| **Question** | id、待答问题（gaps）、来源 task |
| **Task** | 即 §1，落库可恢复 |
| **TaskAttempt** | attemptId / taskId / startedAt / endedAt / model / thinkingLevel / toolCalls / tokenUsage / cost / status / error / outputs(ArtifactRef[])（见 §1.1.1） |
| **CompanyIndustryRelation** | companyId / industryId / relationType（primary/subtrack/chain_segment/application_scenario/tech_route）/ confidence / startDate / endDate |
| **TargetCandidate** | companyId / industryId / screeningScore / selectionReason / evidenceIds / risks / whyNow / status |
| **ScreeningRun** | runId / industryId / ruleIds / startedAt / finishedAt / universeSize / candidateIds |
| **ScreeningRule** | ruleId / name / predicate / weight |
| **TargetDecision** | companyId / runId / decision（reserve/watch/reject）/ decidedBy / decidedAt / reason |
| **Score** | 维度子分×权重、EvidenceCoverage、Confidence、Freshness、理由、时间、版本 |
| **Report** | id、Markdown、引用列表、评分快照 |
| **ReportClaim** | id、reportId、claimId、证据链（→EvidenceAssertion→Evidence→Source）、是否无证据/弱证据标记；发布前 QA 门用，见 §10 |
| **Dossier** | **= Projection，非事实真源**：由 Fact/Claim/Evidence/Event 聚合出的可读视图；真源永远是底层实体 |
| **Diligence** | id、尽调清单、结论、风险项 |

#### Context Selection Policy（P1，按任务类型取数，不全量灌库）

注入 LLM 的不是全量研究库，而是**按任务类型定义的最小取数切片**（经 `transform_context` hook）。示例：

- 任务「为什么具身智能评分下降？」→ 过去 90 天相关 Event + 最近 2 次 Score + 下降维度 + 相关 Evidence + Contradictions + Open Questions。
- 任务「生成公司调研提纲」→ Company Dossier + Industry Dossier + Open Questions + Contradictions + 弱分维度 + 历史尽调。

每种 TaskType 对应一条取数策略（哪些实体、时间窗、条数上限、排序），策略显式配置而非临时拼装。

#### Artifact Contract（统一产物引用）

```
ResearchArtifact {
  artifactId / kind（fact|claim|evidence|score|report|dossier）
  / schemaVersion / ref(ArtifactRef{type, id 或 locator})
  / createdAt / taskId / attemptId
}
```

`Task.outputs` 与 `TaskAttempt.outputs` 均引用 `ArtifactRef`，保证产物可追溯到具体 Task 与 Attempt。

## 4. Fact → Claim → Evidence 体系（P0-6/P0-7/P1-1）

### 4.1 层级（P0-7）

- **Fact** = 标准化结构化观察值（如 `CompanyX 2025 Revenue=12.8亿`），是「值」。
- **Claim** = 有语义命题（如「CompanyX 营收高增长」），是「论断」。
- **关系**：`Fact → Claim → Evidence`（多条 Fact 支撑一条 Claim，每条 Claim 由多条 Evidence 佐证）。
- **FACT 不再作为 Claim 的 EvidenceType**：FACT 是实体层，不是证据类型。

### 4.2 Claim 分型（claimType + provenance，P1，废弃 source_role 混用）

Claim 不再用单一 `source_role` 把「说什么」和「谁说的」混在一起，拆成两个正交维度：

- **claimType**（说什么 / 命题性质）：`descriptive`（描述性）/ `causal`（因果）/ `forecast`（预测）/ `interpretation`（解读）/ `hypothesis`（假设）。
- **provenance**（谁说的）：`official`（官方/监管披露）/ `management`（管理层口径，招股书/访谈，默认标利益相关）/ `analyst`（分析师）/ `expert`（专家）/ `user`（用户提供）/ `third_party`（第三方）。

**HYPOTHESIS 不再塞进 source_role**：`claimType=hypothesis` 的命题同时由独立 **Hypothesis** 实体承载其验证状态（confirmed/refuted/open），假设驱动采集。

| provenance | 默认倾向 |
|---|---|
| official | 需核对口径与时效 |
| management | 标注利益相关（conflict_of_interest 默认 true），不作直接评分唯一依据 |
| analyst / expert | 解读，不作直接评分依据 |
| user | 不自动当证据 |
| third_party | 按 SourceQuality 定级 |

### 4.3 EvidenceAssertion：Evidence→Claim 的带立场断言（P0-4）

Evidence 指向 Claim 不再是裸引用，而是一条**带立场的断言** EvidenceAssertion：

```
EvidenceAssertion {
  evidenceId / claimId
  stance: support | contradict | contextualize | weaken
  strength: 0..1      // 该证据对此 claim 的论证强度
  confidence: 0..1     // 系统综合 SourceQuality/Freshness 等得出的置信度
}
```

- `support` 支持；`contradict` 反驳；`contextualize` 提供背景/语境（不直接站队）；`weaken` 削弱（部分反例、口径存疑）。
- **Contradiction Engine 判矛盾时查 `stance=contradict`** 的 EvidenceAssertion（见 §5），不再裸扫 Evidence 与 Claim 的配对。

### 4.4 证据质量显式属性（P1-1，废弃「FACT 默认高置信」）

每条 Evidence 显式记录，**由系统综合计算 Confidence**，不靠分型默认：

- `SourceQuality`（来源等级）
- `EvidenceStrength`（证据强度）
- `VerificationStatus`（verified / partially / unverified / contradicted）
- `Confidence`（综合分）
- `provenance`（见 §4.2，替代原 source_role）
- `conflict_of_interest`（利益相关标记，如 provenance=management 默认 true）

### 4.5 Source / Document / EvidenceLocator（P0-6）

补 **Source** 实体及 `Document / DocumentVersion / DocumentFragment / Citation`。多形态 `EvidenceLocator`：

| locator | 字段 |
|---|---|
| `pdf_page` | `{page}` |
| `web` | `{url, paragraph}` |
| `wind_field` | `{dataset, field, query}` |
| `interview` | `{recordId, timestamp}` |

任一评分必须可回溯到 ≥1 条带 Source 的 Evidence；缺来源的断言在 Critic 阶段被打回。

## 5. Contradiction Engine（先对齐再判，P1-7）

1. **指标本体对齐（Metric Ontology / Measurement Schema）**：先按 `metric / unit / currency / geography / population / period / asOf / definition / nominal-real / gross-net` 归一化口径。**差异 ≠ 矛盾**：口径不同先对齐，对齐后仍冲突才算。
2. **判定**：先按 §4.3 的 EvidenceAssertion 立场索引定位 `stance=contradict` 的证据对，再对齐口径；对齐后数值差超阈值 / 方向相反 / 时点冲突 → 标 `CONTRADICTION`；并列保留双方，不自动取平均。
3. **升级**：新 `Question` 入 gaps → 触发下一 Round 补源；仍冲突则 REPORT 显式列出「分歧与来源」。
4. **Freshness 分级（P1-8）**：取消统一 stale 窗口，按数据类型分级——
   - 实时价格：小时级
   - 市场数据：日级
   - 宏观：月级
   - 治理事件：事件驱动
   - 行业报告：季-半年
5. **留痕**：每次冲突/解决写事件，不覆盖旧 Score。

## 6. Wind 作为 DataSourceAdapter 的抽象（P1-6）

Wind（及 Web/Reports/Company/Policy）统一成 `DataSourceAdapter`，**不是 LLM provider**。管线分层：

```
Raw Provider Response → Normalized Observation → Fact → Evidence
```

- **Raw Provider Response**：Wind 原始返回。
- **Normalized Observation**：标准化（字段/时间序列/口径/单位/币种/数据版本）。
- **Fact**：落为结构化观察值。
- **Evidence**：挂 Source + Quality 属性 + `wind_field` locator。

```
DataSourceAdapter {
  name: "wind" | "web" | "reports" | "company" | "policy"
  query(req) → EvidenceResult
  timeout / retry(backoff) / cache(键=规范化查询) / rateLimit(令牌桶)
  credentials: 独立凭证仓（与 LLM auth 隔离）
}
```

### 6.1 现状 vs 目标态（P0v3 按实际代码降调）

**现状（已核对 `tools/wind_query.py` / `src/wind-bridge.ts`）**：

- 入参仅 `industry` 一个字符串参数；Node 经 `execFile` 调 Python 子进程，**30s 超时**，出参为 stdout 一行 JSON。
- 返回仅 5 个字段：`marketSize / cagr / listedCompanies / pe / leaders`。
- **双层静默 mock**：① Python 进程失败/无 stdout → 桥接层返回 `source:"mock-bridge"` 并硬编码上述 5 个字段；② Python 内 WindPy 不可用 → 脚本内置 `MOCK` 数字。
- 即便真实 WindPy 连通，当前仅返回「演示骨架」（`source:"wind"` + note），**不返回任何真实数字**。
- 现状**没有** cache / 限流 / 独立凭证仓（仅读 env）/ Normalized Observation 层 / `wind_field{dataset,field,query}` locator 结构。

**目标态（P0v3 要落地，非现状）**：上文 `DataSourceAdapter` 的 cache / rateLimit / 独立凭证仓 / Normalized Observation 层 / `wind_field{dataset,field,query}` locator 均为**目标设计**，当前代码尚未实现，列为待落地缺口。

### 6.2 硬要求与 mock 治理（目标态）

- **失败不编造、对无来源数字零容忍**（目标态硬要求）：查询失败/超限时返回 `{error}`，task 走 retry 或 `failed`，严禁模型补全缺失数据；Critic 对「无来源数字」零容忍。
- **现状双层静默 mock 是待消除的缺口**：它与上述硬要求直接冲突，P0v3 须消除静默注入。
- **mock 数据治理规则（过渡态硬约束）**：在真实数据源未接通前，所有 mock / 兜底返回**必须打标 `source=mock`**，且 **mock 数据不得进入正式评分证据链**——即不得作为任何维度打分的 Evidence，不得进入 EvidenceAssertion / 评分聚合 / ReportClaim 证据链。凭证隔离、缓存、限流、可替换（宿主 `tools/wind_query.py` 作为后端，见 05）。

## 7. 评分系统化（P1-2）

每维定义**所需证据**，维度输出 = 子分 + EvidenceCoverage + Confidence + Freshness，再聚合 Investment Score。

### 7.1 七维权重与聚合（写实，对齐 `config/scoring.json`）

| 维度（key） | 名称 | 权重 | 所需证据（示例） |
|---|---|---|---|
| `market_growth` | 市场空间与增速 | **20%** | TAM source ≥1 条 + CAGR source ≥1 条 |
| `policy_env` | 政策与监管环境 | **15%** | 政策原文 + 时效 |
| `competition` | 竞争格局与壁垒 | **15%** | company set + share + concentration |
| `tech_maturity` | 技术成熟度与趋势 | **15%** | 技术里程碑 + 验证证据 |
| `commercialization` | 商业化与产业链 | **15%** | customer / revenue / orders / retention |
| `exit_env` | 退出与资本环境 | **10%** | 可比交易/退出案例 |
| `risk_level` | 风险因素（逆向） | **10%** | 风险事件 + 来源 |

权重合计 = 20+15+15+15+15+10+10 = **100%**。

**归一化（写死）**：每维子分 0–10，`维度贡献 = 子分 × 权重`；`Investment Score = round(Σ 维度贡献 × 10)`，区间 **0–100**。即「子分 0–10 × 权重 × 10」归一到 0–100。

**分档与入池阈值（写死）**：

- A ≥ 80（核心储备）；B 65–79（重点关注）；C 50–64（观察）；D < 50（暂缓）。
- **入池阈值 = 65**（`config/scoring.json` 的 `thresholds.enter_pool`，可调）。

### 7.2 EvidenceCoverage 规则（每维打分前置门）

每维打分前须满足该维证据覆盖规则，否则该维**不得打分**（按证据缺失处理，进入 Critic 打回）。示例：

- 市场空间维度：需 **TAM ≥ 1 条 Evidence + CAGR ≥ 1 条 Evidence + SourceQuality 达标 + Freshness 达标**，四者齐备才允许出子分。
- 竞争维度：需 company set + share + concentration 三类证据齐备。
- 政策维度：需政策原文（非转述）+ 时效未过期。

> 缺口提示：上表中竞争 share/concentration、商业化 revenue/orders/retention、政策原文、退出案例，**当前 `wind_query.py` 均不提供**（仅 5 个 mock 字段），须由 Web/Reports/Company/Policy adapter 补齐或列为 P1 缺口。

### 7.3 评分流程（LLM 提案 + 确定性引擎聚合）

```
LLM 提 Dimension Subscore Proposal（每维子分 + 理由 + 引用 Evidence）
   → 确定性 Scoring Engine 校验证据覆盖（EvidenceCoverage 规则，§7.2）
   → 不达标：该维打回，触发补源（新建 Round）
   → 达标：按 §7.1 权重聚合 → Investment Score + 分档 + 入池判定
   → 写 Score 留痕（每维子分数组追加，不覆盖旧值）
```

LLM 只提提案，**聚合与阈值判定由确定性引擎完成**，保证同配置可复算。

### 7.4 现状标注（P0v3）

当前 `src` 链路的评分是 **offline-mock 模板评分**：`invest-extension.ts` 正则分流后硬编码七维子分（8/8/6/7/7/6），输出「加权总分 ≈ 71 / 100，评级 B」，**无真实评分计算**；`profile_write` 也不追加每维 scores 子分数组历史。上述 §7.1–7.3 为 P0v3 目标态，属待落地。

## 8. Research Priority 与 Target Discovery（P1-3/P1-4）

### 8.1 Research Priority（一等输出，与 Attractiveness/EvidenceConfidence 并列）

**禁止连乘**（任一维为 0 则全归零）。改为**加权求和归一化**（归一化方式写死）：

```
Priority = round(100 × Σ wᵢ · xᵢ)
```

- `xᵢ ∈ [0,1]`，五维：`attractiveness / informationGap / recentChange / potentialInformationGain / urgency`。
- 权重 `wᵢ` 在 **config（如 `config/priority.json`）显式定义**，且 `Σ wᵢ = 1`。
- 备选形式：`base × multiplier`（基线 × 乘数），但 P0v3 默认采用上述加权求和归一化。
- 输出 `Priority ∈ [0,100]`，用于排序「下一步先研究谁/什么」。

### 8.2 Target Discovery / Screening Engine

```
Industry → Company Universe → ScreeningRun → Target Candidates
        → Evidence → Research Priority → Focus Targets → TargetDecision
```

落库实体（P1）：

- **ScreeningRun**：`runId / industryId / ruleIds / startedAt / finishedAt / universeSize / candidateIds` —— 一次筛选运行。
- **ScreeningRule**：`ruleId / name / predicate / weight` —— 可组合的筛选规则。
- **TargetCandidate**：`companyId / industryId / screeningScore / selectionReason / evidenceIds / risks / whyNow / status`。
- **TargetDecision**：`companyId / runId / decision（reserve/watch/reject）/ decidedBy / decidedAt / reason` —— 人工/自动决策留痕。

## 9. HumanGate 持久化（P0-5）

实体：

```
HumanGate {
  gateId / taskId / type / status
  requestedAt / decidedAt
  decision / operator / comment / resumeToken
}
status: pending / approved / rejected / expired / cancelled
```

**resumeToken 安全机制（P1）**：

- **高熵随机**：≥ 256 bit 随机生成。
- **落库只存哈希**：数据库存 token 的哈希，不存明文；恢复时比对哈希。
- **expiresAt**：带过期时间，过期后状态转 `expired`。
- **scope**：绑定作用域 `projectId / runId / gateId`，跨域不可用。
- **单次使用（single-use）**：成功 resume 后即失效，不可重放。

场景：行业达入池条件 → gate 落库 `pending` → 用户次日重开 `tiancha` 可恢复决定。**不能只靠 `before_run_end`+`followUp`**（那是进程内续轮，跨进程不可恢复）。

## 10. Report 证据链与发布前 QA（P1）

Report 中每个事实性 Claim 都必须可沿证据链下钻到原始来源：

```
ReportClaim → EvidenceAssertion → Evidence → Source
```

- **ReportClaim**：`id / reportId / claimId`，记录该事实性 Claim 在 Report 中的位置，并挂证据链引用。
- **发布前 QA 门**：Report 发布前，QA 统计两类 Claim 数——
  - **无证据 Claim**：找不到任何 EvidenceAssertion 的 Claim；
  - **弱证据 Claim**：`stance≠support` 或 `confidence` 低于阈值的 Claim。
- **硬阈值（示例，可配）**：无证据 Claim 数 > 0，或弱证据 Claim 数 > N → **禁止发布**，退回补证据（新建 Round）。QA 门不通过则 Report 不可对外发布。

## 11. Durable Research Event Store（P0-3）

研究过程是**持久事件流**，落 SQLite **EventStore**，区别于 Pi 的 transient UI 事件。

### 11.1 ResearchEvent 实体

```
ResearchEvent {
  eventId / runId? / roundId? / taskId? / industryId? / companyId?
  type / payload(JSON) / occurredAt / source
}
```

`type` 枚举：

```
industry_discovered / score_changed / evidence_added / contradiction_detected
human_gate_created / human_gate_decided / dossier_updated / round_created
task_attempt_started / task_attempt_finished / report_published
```

### 11.2 与 Pi EventBus 的分工

- **Pi EventBus**（源码真实接口 `EventBus`：`emit(channel, data) / on(channel, handler)`，字符串通道）只承载 **transient UI 事件**（界面刷新、进度提示等），进程结束即丢。
- **ResearchEventAdapter**：把研究领域事件**转 durable**——研究内核产生的关键事件经 adapter 写入 SQLite EventStore（ResearchEvent），同时转发到 Pi EventBus 供 UI 实时订阅。
- **命名澄清**：源码中**不存在 `HarnessEventBus` 这个名字**，本文统一称 **Pi EventBus**。

## 12. 自动采集状态模型（P1，Collector）

对每个数据源（SourceEndpoint）的自动采集定义状态机，记录游标与变更：

```
SourceEndpoint { endpointId / kind / config / enabled }

FetchCursor { endpointId / lastFetchedAt / etag / lastModified / contentHash }

FetchStatus     = success | partial | failed
ExtractionStatus = pending | done | failed

ChangeSet { added / changed / removed }
```

- **SourceEndpoint**：采集端点配置（kind = wind/web/rss/api…），enabled 控制是否启用。
- **FetchCursor**：`etag / lastModified / contentHash` 用于增量拉取与去重；`lastFetchedAt` 记录上次成功抓取时间。
- **FetchStatus / ExtractionStatus**：抓取与抽取两段各自独立标状态（partial/failed 可重试）。
- **ChangeSet**：每次抓取产出 `added / changed / removed` 三类差异，驱动 Fact/Evidence 增量入库。

## 13. 与既有能力的衔接

- 七步循环提示词：复用 `harness/research/research-prompt.ts` 的 `DEFAULT_RESEARCH_LOOP_PROMPT`。
- 交付前自检：复用 `quality-gate.ts`（`before_run_end`+`followUp`）。
- 压缩保证据：复用 `compaction.ts` 已落地的 `Key Evidence & Scoring` 节。
- 模型路由：复用 `model-resolver.ts` 的 `ScopedModel`。

> 现状标注：上述 `harness/research/*` 属上游 `earendil-works/pi` monorepo 包，**当前 diaoyan-agent 仓库 src/ 尚未接入**（仅薄壳宿主）；本节为「上游已具备、本仓库待接入」的复用目标。
