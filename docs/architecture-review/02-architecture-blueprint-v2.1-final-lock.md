# 02 · Architecture Blueprint v2.1（Final Lock）

> v2.1 · 架构锁定修订 · 基于 v2（`02-architecture-blueprint-v2.md`）· 2026-09-22
>
> v2 已获用户批准为架构基线。本文件不推翻 v2、不重设计，只做 8 项锁定修订 + Phase 2 任务分解 + 测试映射。v2 保留不动。

## v2 → v2.1 修订 diff 清单

| # | 修订 | v2 状态 | v2.1 锁定 |
|---|---|---|---|
| 1 | 新增 `InformationRequirement` 一等 Domain Object | 仅在流程里出现 | 独立实体，字段 `requirementId/questionId/subjectKind/subjectId/dimension/description/importance/requiredEvidenceType/status/createdAt/updatedAt`；链路 Question→Requirement→InformationPool |
| 2 | 新增 `ResearchGap` 一等 Domain Object | `researchGaps: string[]` 裸数组 | 独立实体，字段 `gapId/subjectKind/subjectId/description/importance/uncertainty/relatedRequirementIds[]/relatedQuestionIds[]/status/discoveredAt/updatedAt`；Gap 驱动后续链路 |
| 3 | Methodology v1 真实内容 | 空结构 | 12 维度 Human-approved baseline（Market/MarketGrowth/Demand/Supply/Competition/Technology/IndustryChain/BusinessModel/Profitability/Policy/Risk/KeyValidation），每维含 requiredInfo/whyNeeded/可支持判断的信息/confirmed/uncertain/unknown 条件；v1 禁止模型自动改，变更走 Material→Candidate→Review→Version→Activate |
| 4 | InformationPool vs Knowledge 不变量 | 未写 invariant | 写进 contract+测试：Pool=「需要什么/掌握多少」，Knowledge=「基于 Evidence/Claims 形成的认知」；不得两张同质表（T3） |
| 5 | Echo/LocalFile Provider 性质 | 未标注 | 测试/占位数据源，**禁止用它制造真实投资判断**；Evidence 必标 `sourceType=echo_placeholder`、`isRealExternalData=false`（T8） |
| 6 | IntentRouter 红线 | 未写 | 严禁关键词/`text.includes` 匹配；必须语义路由（LLM classification / structured extraction / rules+semantic fallback / confidence / context-aware），支持自然语言变体（实现在 2B，2A 只定契约） |
| 7 | NL Agent Entry 从 Phase 2 存在 | 等 Phase 8 | 最小链路 NL→IntentRouter→Service→State→NLResponder→NL；用户看不到 State JSON/TaskGraph/Agent 名（实现在 2B，2A 备好 Service+State） |
| 8 | Phase 2 不偷跑后续 | 未明确 | ResearchTarget/ResearchChain/Diligence/Field Research/Report 只留契约/占位，不提前实现；7 E2E 是最终验收，非 Phase 2 全做 |

---

## Phase 2 分解（2A–2D）

### 2A Research Memory Foundation（本次实现）
- Domain + SQLite：Industry/Company Identity、ResearchQuestion、InformationRequirement、ResearchGap、InformationPool、ResearchState、Evidence(扩展)、Claim(扩展 subjectKind/subjectId/temporalRelation)、Fact、Source、Document、NextAction。
- Methodology v1（12 维，`config/methodology-v1.json`，Human-approved baseline）。
- Echo/LocalFile Provider（占位，`isRealExternalData=false`）。
- Application：`OpportunityDiscoveryService`（ingest material→extract industry→create Question/Requirement/Pool/Gap/State/NextAction）。
- 跑通链路（CLI/test 驱动，非 NL）：Material→Industry→Question→Requirement→Pool→Evidence→Claim→Gap→State→NextAction。
- CLI：`tiancha industry ingest <file>`、`tiancha industry show <name>`、`tiancha state show <industry>`。
- 测试：T1/T2/T3/T4/T8/T9/T12。

### 2B Agent Entry（暂不做，只列任务）
- IntentRouter（语义路由，T6）、ContextAssembler、NLResponder、`tiancha ask "<NL>"`（T7）。
- 验收：「机器人值得研究吗」获 NL 回答，用户看不到内部模型。

### 2C Knowledge Projection（暂不做）
- Evidence→Claim→IndustryKnowledge（provenance/source/time/confidence/conflict/historical）；Knowledge≠Pool（T3 invariant 已立）；T10 Conflict 保留两个 Evidence；T5 Methodology Human Gate 完整实现。

### 2D Persistence/Recovery/Regression（暂不做）
- kill→restart，Industry/Evidence/Claim/Pool/Knowledge/State/NextAction 都在、原始材料可访问、Evidence/Claim 可追溯、State 可恢复（T11）；Phase1 tests/smoke/build/runtime regression（T12）。

### 12 测试归属

| 测试 | 内容 | 阶段 |
|---|---|---|
| T1 | InformationRequirement 生命周期 | 2A |
| T2 | ResearchGap 生命周期 | 2A |
| T3 | Pool vs Knowledge 分离 invariant | 2A（invariant）/2C（实现） |
| T4 | Methodology v1 可加载 | 2A |
| T5 | Methodology Human Gate 完整 | 2C |
| T6 | IntentRouter 语义路由 | 2B |
| T7 | `tiancha ask "<NL>"` NL 入口 | 2B |
| T8 | Echo Provider 不被误标真实数据 | 2A |
| T9 | 旧 Claim 不被新 Evidence 覆盖 | 2A |
| T10 | Conflict 保留两个 Evidence | 2C |
| T11 | 重启恢复 | 2D |
| T12 | Phase 1 regression gate（全阶段） | 全阶段 |

---

## Phase 2 core E2E 修正定义（2A 阶段可跑子集）

完整 7 E2E 属产品最终验收。2A 只跑「Memory Foundation」子集：

```
Research Material(文本)
  → Industry 识别/匹配（2A：确定性名匹配，非 LLM、非子串黑名单）
  → 基于 Methodology v1 生成 ResearchQuestion + InformationRequirement
  → InformationPool 初始化（全部 unknown/partial）
  → Echo Provider 产 Evidence（标 echo_placeholder）
  → 生成 Claim（subjectKind=industry, temporalRelation=current）
  → 发现 ResearchGap（未被 Evidence 覆盖的 Requirement）
  → 更新 ResearchState
  → 产出 NextAction
```

每步断言持久化到 SQLite。2A 不做 NL、不做真实投资判断、不做评分。
