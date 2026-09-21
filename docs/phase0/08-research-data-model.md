# 08 · Research Data Model 设计（Research Data Model）

> 版本：P0v3（Architecture Lock）
> 上游 commit：`19451accdeec671c1f4da9eafac8fc270f510ef4`
> 本文把 04 的数据模型落成实体级设计，覆盖 P0-5/P0-6/P0-7 与 P1-1/P1-2/P1-3/P1-8。不写实现代码。

## 1. 层级关系（P0-7）

```
Document ─▶ DocumentVersion ─▶ DocumentFragment ─▶ Citation ─▶ Evidence ─▶ Claim ─▶ (聚合) Score/Report
Source ──────────────────────────────────────────────────────┘
Fact ───▶ Claim（多条 Fact 支撑一条 Claim）

ResearchRun ─▶ ResearchRound ─▶ Task ─▶ TaskAttempt(1..N) ─▶ ResearchArtifact(outputs: ArtifactRef)
Evidence ─(EvidenceAssertion: stance/strength/confidence)─▶ Claim
Report ─▶ ReportClaim ─▶ EvidenceAssertion ─▶ Evidence ─▶ Source
Company ◀─(CompanyIndustryRelation: relationType)─▶ Industry
Industry ─▶ ScreeningRun ─▶ ScreeningRule / TargetCandidate ─▶ TargetDecision
SourceEndpoint ─▶ FetchCursor / FetchStatus / ExtractionStatus / ChangeSet

ResearchEvent（durable, SQLite EventStore）横贯 run/round/task/industry/company
Dossier = Fact/Claim/Evidence/Event 的聚合 Projection（非事实真源）
```

- **Fact** = 标准化结构化观察值（如 `CompanyX 2025 Revenue=12.8亿`）。
- **Claim** = 有语义命题，带 `claimType` + `provenance`（见 §4）。
- **FACT 不再作为 Claim 的 EvidenceType**（它是实体层）。

## 2. 核心实体

| 实体 | 关键字段 |
|---|---|
| Project | id、名称、目标、当前行业集 |
| ResearchRun | runId、状态（planning/active/waiting_input/completed/failed/cancelled）、目标、预算 |
| ResearchRound | roundId、runId、状态（planned/running/review/completed/rejected）、DAG 引用 |
| Industry | id、名称、别名、评分、评级、入池状态、版本 |
| Company | id、所属行业、标签、轮次、关键指标 |
| CompanyIndustryRelation | companyId / industryId / relationType（primary/subtrack/chain_segment/application_scenario/tech_route）/ confidence / startDate / endDate |
| Fact | id、值、单位、币种、时点、口径 |
| Claim | id、语义命题、**claimType**（descriptive/causal/forecast/interpretation/hypothesis）、**provenance**（official/management/analyst/expert/user/third_party）、Fact 引用、Evidence 引用 |
| Hypothesis | id、表述、验证状态（confirmed/refuted/open）、证据引用（独立实体，不塞进 source_role） |
| Evidence | id、Claim 引用、Source、Quality 属性集、EvidenceLocator |
| EvidenceAssertion | evidenceId / claimId / stance（support/contradict/contextualize/weaken）/ strength(0..1) / confidence(0..1) |
| Source | id、出处类型、发布方、发布日期、SourceQuality |
| Document / Version / Fragment | 原始文档、版本、片段 |
| Citation | 片段 + EvidenceLocator |
| Task | id、type、状态（queued/running/waiting/completed/failed/cancelled）、dependencies、inputs、outputs、modelPolicy、roundId |
| TaskAttempt | attemptId / taskId / startedAt / endedAt / model / thinkingLevel / toolCalls / tokenUsage / cost / status(running/succeeded/failed/aborted) / error / outputs(ArtifactRef[]) |
| ResearchArtifact | artifactId / kind(fact/claim/evidence/score/report/dossier) / schemaVersion / ref(ArtifactRef{type,id或locator}) / createdAt / taskId / attemptId |
| ResearchEvent | eventId / runId? / roundId? / taskId? / industryId? / companyId? / type / payload(JSON) / occurredAt / source（落 SQLite EventStore，见 §10） |
| Score | 维度子分、EvidenceCoverage、Confidence、Freshness、理由、版本 |
| Report | id、Markdown、引用列表、评分快照 |
| ReportClaim | id / reportId / claimId / 证据链（→EvidenceAssertion→Evidence→Source）/ 无证据标记 / 弱证据标记 |
| Dossier | = Projection（Fact/Claim/Evidence/Event 聚合的可读视图，非事实真源） |
| Question / Diligence | 见 04 §3 |
| ScreeningRun | runId / industryId / ruleIds / startedAt / finishedAt / universeSize / candidateIds |
| ScreeningRule | ruleId / name / predicate / weight |
| TargetCandidate | companyId / industryId / screeningScore / selectionReason / evidenceIds / risks / whyNow / status |
| TargetDecision | companyId / runId / decision(reserve/watch/reject) / decidedBy / decidedAt / reason |
| SourceEndpoint | endpointId / kind / config / enabled |
| FetchCursor | endpointId / lastFetchedAt / etag / lastModified / contentHash |
| ChangeSet | added / changed / removed |

> 状态枚举：FetchStatus = success/partial/failed；ExtractionStatus = pending/done/failed。见 §11。

## 3. EvidenceLocator（P0-6）

| locator | 字段 |
|---|---|
| `pdf_page` | `{page}` |
| `web` | `{url, paragraph}` |
| `wind_field` | `{dataset, field, query}` |
| `interview` | `{recordId, timestamp}` |

## 4. 证据质量属性与 Claim 分型（P1-1）

每条 Evidence 显式记录（系统综合计算 Confidence）：

- `SourceQuality` / `EvidenceStrength` / `VerificationStatus`（verified/partially/unverified/contradicted）/ `Confidence`
- **Claim 分型**（替代原 source_role 混用）：
  - `claimType`：descriptive / causal / forecast / interpretation / hypothesis
  - `provenance`：official / management / analyst / expert / user / third_party
- `conflict_of_interest`（provenance=management 默认 true）
- **Hypothesis 保持独立实体**：`claimType=hypothesis` 的命题由 Hypothesis 实体承载验证状态，不塞进 source_role。

## 4b. EvidenceAssertion（P0-4）

Evidence→Claim 为带立场断言：

```
EvidenceAssertion {
  evidenceId / claimId
  stance: support | contradict | contextualize | weaken
  strength: 0..1
  confidence: 0..1
}
```

Contradiction Engine 判矛盾时查 `stance=contradict`。

## 5. Metric Ontology / Measurement Schema（P1-7）

矛盾判定前先对齐：

```
metric / unit / currency / geography / population / period / asOf /
definition / nominal-real / gross-net
```

差异 ≠ 矛盾；对齐后仍冲突才判。

## 6. Freshness 分级（P1-8）

| 数据类型 | 时效 |
|---|---|
| 实时价格 | 小时 |
| 市场数据 | 日 |
| 宏观 | 月 |
| 治理事件 | 事件驱动 |
| 行业报告 | 季-半年 |

## 7. 评分（P1-2）

七维与权重（合计 100%）：`market_growth 20% / policy_env 15% / competition 15% / tech_maturity 15% / commercialization 15% / exit_env 10% / risk_level 10%`。

- 归一化（写死）：每维子分 0–10，`Investment Score = round(Σ(子分 × 权重) × 10)`，区间 0–100。
- 分档：A≥80 / B 65–79 / C 50–64 / D<50；**入池阈值 65**（`config/scoring.json` 的 `thresholds.enter_pool`）。
- 每维打分前置 EvidenceCoverage 规则（如市场空间需 TAM≥1 + CAGR≥1 + SourceQuality 达标 + Freshness 达标），不达标不打分。
- 流程：LLM 提 Dimension Subscore Proposal → 确定性 Scoring Engine 校验证据覆盖并聚合；Score 留痕追加，不覆盖旧值。

## 8. Research Priority（P1-3）

禁止连乘（任一维为 0 全归零）。改为加权求和归一化（归一化方式写死）：

```
Priority = round(100 × Σ wᵢ · xᵢ)
```

- `xᵢ ∈ [0,1]`：attractiveness / informationGap / recentChange / potentialInformationGain / urgency。
- 权重 `wᵢ` 在 config（如 `config/priority.json`）显式定义，`Σ wᵢ = 1`；输出 `Priority ∈ [0,100]`。
- 备选形式：`base × multiplier`。

## 8b. Target Screening 实体（P1）

```
ScreeningRun      { runId / industryId / ruleIds / startedAt / finishedAt / universeSize / candidateIds }
ScreeningRule     { ruleId / name / predicate / weight }
TargetCandidate   { companyId / industryId / screeningScore / selectionReason / evidenceIds / risks / whyNow / status }
TargetDecision    { companyId / runId / decision(reserve|watch|reject) / decidedBy / decidedAt / reason }
```

## 9. HumanGate 实体（P0-5）

```
HumanGate { gateId / taskId / type / status / requestedAt / decidedAt /
            decision / operator / comment / resumeToken }
status: pending / approved / rejected / expired / cancelled
```

跨进程可恢复（行业达入池→pending→次日重开可决定）。

**resumeToken 安全字段（P1）**：

- 高熵随机（≥256 bit）；
- 落库只存**哈希**（不存明文）；
- `expiresAt` 过期时间；
- `scope`：`projectId / runId / gateId`；
- **单次使用（single-use）**，成功 resume 后失效。

## 10. Durable Research Event Store（P0-3）

```
ResearchEvent {
  eventId / runId? / roundId? / taskId? / industryId? / companyId?
  type / payload(JSON) / occurredAt / source
}
```

`type` 枚举：`industry_discovered / score_changed / evidence_added / contradiction_detected / human_gate_created / human_gate_decided / dossier_updated / round_created / task_attempt_started / task_attempt_finished / report_published`。

- 落 **SQLite EventStore**（durable）。
- **Pi EventBus**（`emit(channel,data)/on(channel,handler)`，字符串通道）仅承载 transient UI 事件；**ResearchEventAdapter** 把研究事件转 durable 落库。
- 命名：源码无 `HarnessEventBus`，统一称 Pi EventBus。

## 11. 自动采集状态模型（P1）

```
SourceEndpoint  { endpointId / kind / config / enabled }
FetchCursor     { endpointId / lastFetchedAt / etag / lastModified / contentHash }
FetchStatus     = success | partial | failed
ExtractionStatus = pending | done | failed
ChangeSet       { added / changed / removed }
```

- `FetchCursor` 的 etag/lastModified/contentHash 用于增量拉取与去重。
- 抓取与抽取两段独立标状态；每次抓取产出 ChangeSet 驱动 Fact/Evidence 增量入库。

## 12. Report 证据链与发布前 QA（P1）

```
ReportClaim → EvidenceAssertion → Evidence → Source
```

Report 发布前 QA 统计无证据 Claim 数与弱证据 Claim 数；无证据 > 0 或弱证据 > N（阈值可配）则禁止发布，退回补证据。
