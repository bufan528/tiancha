# Tiancha Code Design（v1）

> **2026-09-23 · 代码设计。** 上游：`06-...v3.1-final.md`（业务模型）+ `07-domain-model-design.md`（领域模型），均已确认。
> 本文把领域模型落到**现有代码库**：新增/修改的 interface、表、Service、Repository、CLI、工具、迁移与小步拆分。
> **本文仍是设计**：给出精确到可直接实现的定义，但**未修改仓库源码**。

---

## 0. 范围与顺序

本文**详细设计 Phase A**（单行业研究闭环：框架驱动 + Priority + Evaluation 四面），其余 Phase 只给**接口预留与落位**，不提前建空表。

```
Phase A 代码工作（本文详设）
  A0  总纲：分层、目录、命名、identity
  A1  Methodology 扩展 + E1（Requirement 承接方法论条件）
  A2  E2（幂等 identity）
  A3  Pool 重定义（Slot + Item）
  A4  Evaluation（四面结构 + 证据驱动评分）
  A5  Priority / Planning
  A6  Report/Dossier（投影）              ← 投影随 A 具备最小形态；Experience 属 Phase D，不在 Phase A
  A7  CLI / Agent 工具
（Phase B–E 仅预留）
```

---

## 1. 分层与目录约定

沿用既有分层，**不改依赖方向**（Research Core 永不 import coding-agent）：

```
packages/research/src/
  domain/        纯类型与纯函数（无 IO）
  ports/         接口（外部依赖抽象）
  storage/       SQLite 读写（Repository）
  application/   用例编排（Service）
  runtime/       运行时契约（冻结）
src/
  cli/tiancha.ts        Composition Root（唯一 import Pi）
  agent/research-tools.ts  研究工具
```

**新增文件落位**：

| 文件 | 内容 |
|---|---|
| `domain/information-pool.ts` | **重写**：PoolSlot / PoolItem |
| `domain/evaluation.ts` | 新增：InvestmentEvaluation / DimensionEvaluation / Coverage / Sufficiency |
| `domain/experience.ts` | **Phase D 预留**：ResearchExperience / ExperiencePattern |
| `domain/chain.ts` | 预留（Phase B）：ResearchChain / ResearchPosition |
| `domain/research-target.ts` | 预留（Phase B）：ResearchTarget |
| `domain/question-target-fit.ts` | 预留（Phase B） |
| `domain/diligence-preparation.ts` | 预留（Phase B） |
| `domain/research-material.ts` | 预留（Phase C）：Material / Fragment |
| `domain/discovery.ts` | 预留（Phase E）：DiscoveryCandidate |
| `domain/report.ts` | 新增（投影）：ReportSnapshot / IndustryDossier |
| `application/evaluation-service.ts` | 新增 |
| `application/priority-service.ts` | 新增（Priority + NextAction 生成） |
| `application/experience-service.ts` | **Phase D 预留** |
| `storage/*-repository.ts` | 按聚合增加 |
| `application/*.test.ts` / `*.test.ts` | 同目录测试 |

---

## 2. 命名与 identity 约定

**命名**：
- 表：`snake_case` 复数不用；沿用现有单数风格（`industry`、`knowledge_belief`）。
- 领域字段：`camelCase`；持久化列：`snake_case` + `_json` 后缀表示序列化数组/对象。
- id 前缀：`ind- / co- / q- / ir- / gap- / act- / slot- / item- / kn- / bel- / kcf- / ev- / cl- / mw- / mwc- / eval- / exp- / pat- / tgt- / fit- / dp- / mat- / frag-`。

**stable identity（幂等，见 §9）**：
| 实体 | id |
|---|---|
| ResearchQuestion | `q-<subjectId>-<dimensionKey>` |
| InformationRequirement | `ir-<subjectId>-<dimensionKey>` |
| PoolSlot | `slot-<subjectId>-<dimensionKey>` |
| ResearchGap | `gap-<requirementId>`（已有） |
| NextAction | `act-<gapId>`（已有） |
| Claim/Evidence/Fragment/Belief/Evaluation | 每次新行（random） |

---

## 3. 数据模型变更

### 3.1 扩展既有表（**全部走 PRAGMA 预检查**）

| 表 | 新增列 | 用途 |
|---|---|---|
| `information_requirement` | `confirmed_condition TEXT`、`uncertain_condition TEXT`、`unknown_condition TEXT`、`preferred_position_kinds_json TEXT` | E1：承接方法论条件 |
| `research_gap` | `gap_type TEXT` | unknown / conflict / insufficient |
| `industry` | `current_evaluation_id TEXT` | 指向最新评估 |
| `industry_knowledge` | （不变） | — |
| `knowledge_belief` | `statement TEXT` | 认知条目的一句话内容（可选，便于读） |
| `next_action` | （`params_json` 已可承载 `targetId`） | 无需改列 |

### 3.2 新增表

| 表 | 关键列 | Phase |
|---|---|---|
| `information_pool_slot` | slot_id, subject_kind, subject_id, dimension, status, coverage_judgement, created_at, updated_at | A3 |
| `information_pool_item` | item_id, slot_id, value_text, caliber, as_of, **claim_ref**, source_ref, relation, created_at | A3 |
| `investment_evaluation` | evaluation_id, subject_kind, subject_id, methodology_version_id, dimension_evaluations_json, coverage_json, overall_decision, created_at | A4 |
| `report_snapshot` | report_id, subject_kind, subject_id, methodology_version_id, generated_at, sections_json | A6 |
| `research_experience` | experience_id, kind, observation, scope_json, judgement, evidence_refs_json, industry_refs_json, status, pattern_id, created_at | **Phase D**（不提前建表） |
| `experience_pattern` | pattern_id, statement, scope_json, recurrence_count, member_experience_ids_json, first_seen_at, last_seen_at | **Phase D**（不提前建表） |

### 3.3 废弃 / 迁移

| 对象 | 处置 |
|---|---|
| `information_pool_entry` | **迁移到 slot+item**：老行 → 一个 `slot`（status 保留）+ 0 个 item；老列保留一段时间（只读）后删除 |
| `scoring/`（7 维 0–100） | **保留并升级为上层汇总层**：不作为研究维度，改作投资总分聚合（见 `07 §3.8a`）；`config/scoring.json` 保留 |
| `config/methodology-v1.json` | **改为真正被读取**（E1 时把 weight/criticality 落到这里并载入 DB） |

---

## 4. Domain 层设计（关键对象的精确要素）

### 4.1 MethodologyDimension（扩展）

```
key, name, description, whyNeeded, requiredInfo,
confirmedCondition, uncertainCondition, unknownCondition,
weight: number,              // 新增：该维度在评估中的权重（0..1，总和≈1）
criticality: "normal" | "critical",   // 新增：关键维度（证据不足可一票否决）
appliesTo?: string[]         // 预留：行业类型限定（空=适用全部）
```

### 4.2 InformationRequirement（扩展，E1）

```
requirementId, questionId, subjectKind, subjectId, dimension, description,
importance: number,          // 来自 MethodologyDimension（不再恒 5）
requiredEvidenceType,
confirmedCondition, uncertainCondition, unknownCondition,   // 新增
preferredPositionKinds: string[],                              // 新增（Phase B 用）
status, createdAt, updatedAt
```

### 4.3 InformationPool（重写为 Slot + Item）

```
InformationPoolSlot {
  slotId, subjectKind, subjectId, dimension,
  status: "unknown" | "partial" | "sufficient" | "conflicting",
  coverageJudgement: string,     // 依据 Requirement.confirmedCondition 的判定说明
  createdAt, updatedAt
}

InformationPoolItem {
  itemId, slotId,
  valueText: string,             // 具体信息（数值/陈述）
  caliber?: string,              // 口径
  asOf?: string,
  claimRef: string,              // 必需：指向 Claim（不复制内容）
  sourceRef?: string,
  relation: "consistent" | "caliber_differs" | "contradicts" | "complements",
  createdAt
}
```

> **I5 守护点**：`InformationPoolItem.claimRef` 为必填；Repository 层在写入时校验 claim 存在。

### 4.4 InvestmentEvaluation（新增）

```
InvestmentEvaluation {
  evaluationId, subjectKind, subjectId,
  methodologyVersionId: string,          // 绑定方法论版本
  dimensionEvaluations: DimensionEvaluation[],
  coverage: { evaluated: number; insufficient: number; conflicting: number; notApplicable: number; total: number },
  overallDecision: "reserve" | "watch" | "park" | "insufficient_evidence",
  createdAt
}

DimensionEvaluation {
  dimension: string,
  status: "evaluated" | "insufficient_evidence" | "conflicting" | "not_applicable",
  score?: number,                        // 仅 status=evaluated 时存在
  scoreScale?: string,                   // 量纲引用（由 Methodology 定义）
  rationale: string,
  evidenceRefs: string[],
  sufficiency: { independentSources: number; firstHand: boolean },  // 证据充分度
  conflictingClaimRefs?: string[]
}
```

> **I10/I11 守护点**：`status !== "evaluated"` ⇒ `score` 必须为 undefined；`coverage` 与 `dimensionEvaluations` 必须一起产出。

### 4.5 ResearchExperience / ExperiencePattern（**Phase D 预留**；Phase A 不建、不写）

```
ResearchExperience {
  experienceId,
  kind: "prediction_miss" | "critical_omission" | "repeated_ineffective" | "caliber_trap" | "regime_change",
  observation: string,                   // 观察到的方法层问题
  scope: { industryType?: string; dimension?: string; targetKind?: string },
  judgement: "industry_specific" | "methodology_problem",   // 必填（I9）
  evidenceRefs: string[], industryRefs: string[],
  status: "recorded" | "part_of_pattern" | "promoted",
  patternId?: string, createdAt
}

ExperiencePattern {
  patternId, statement, scope, recurrenceCount, memberExperienceIds[],
  firstSeenAt, lastSeenAt
}
```

> **I9 守护点**：`judgement` 必填；`ExperiencePattern` 必须 `recurrenceCount >= N`（N 默认 3，来自配置）。

### 4.6 ReportSnapshot / IndustryDossier（投影）

```
ReportSnapshot { reportId, subjectKind, subjectId, methodologyVersionId, generatedAt, sections }
IndustryDossier { dossierId, industryId, knowledgeVersion, methodologyVersionId, generatedAt, sections }
```
`sections` 为结构化字段（当前认知 / 关键事实 / 主要判断 / 主要冲突 / 缺口 / 最近变化 / 最近证据 / 当前评价 / 优先级 / 下一步）。

> **I14 守护点**：这两个对象**只读生成**，任何写入都不影响 Claim/Belief/Pool/Evaluation。

---

## 5. Application 层设计

| Service | 方法（签名要点） | 职责 | 守护的不变量 |
|---|---|---|---|
| `OpportunityDiscoveryService`（改） | `ingestMaterial(input)` | 材料 → Industry → **幂等** Question/Requirement/Slot → Claim → 投影 | I6, I7, I13 |
| | `ingestClaims(input)`（已有） | 调研回填 | I2, I5 |
| `KnowledgeProjectionService`（已存在，扩） | `projectFromClaim / reconcilePool / refreshGaps / refreshState / refreshSubject` | 认知投影链 | I2, I3, I4 |
| `EvaluationService`（新） | `evaluate(subjectKind, subjectId, methodologyVersionId)` → InvestmentEvaluation | 维度评分（证据驱动，不足不出分） | I10, I11, I13 |
| `PriorityService`（新） | `rank(subjectId)` → 排序后的 (requirement, gap, priority) | Priority 计算 + 生成 NextAction | Rationale 可追溯 |
| `ExperienceService`（**Phase D**，薄） | `record(experience)`；`formPatterns()` | 记录经验与模式 | I9 |
| `MethodologyService`（已存在，扩） | `propose({ rationales, sourceExperienceIds, ... })` | 方法论提案（带经验来源） | I8 |

**`EvaluationService.evaluate` 的核心流程（伪逻辑）**：

```
for each dimension in activeMethodology.dimensions:
    req = requirement(subject, dimension)
    items = poolItems(slot(subject, dimension))
    if no items satisfying req.confirmedCondition:
        → status = insufficient_evidence, score = undefined
    else if open conflict on dimension:
        → status = conflicting, score = undefined
    else:
        → status = evaluated, score = scoringRule(dimension, items)   // 评分规则来自方法论
coverage = count by status
overallDecision = decisionRule(dimensionEvaluations, coverage)        // 规则来自方法论
```

**关键**：`scoringRule` / `decisionRule` / `criticality` 都是**方法论的属性**，Service 只做编排（v3.1 §7.3）。

---

## 6. Storage 层设计

| Repository | 方法 |
|---|---|
| `ResearchRepository`（已有，扩） | 增加 `information_pool_slot` / `information_pool_item` CRUD；`upsertRequirement` 写新列 |
| `KnowledgeRepository`（已有） | 不变（belief 可选加 statement） |
| `EvaluationRepository`（新） | `upsertEvaluation / getLatestEvaluation(subject)` |
| `ExperienceRepository`（**Phase D**） | `upsertExperience / listExperiences / upsertPattern / listPatterns` |
| `ReportRepository`（新，只读投影） | `saveSnapshot / getLatestSnapshot` |

**写入纪律**：
- 所有 `_json` 列用 `JSON.stringify/parse`；
- 加列走 PRAGMA 预检查；
- **Slot/Item 写入时校验 claimRef 存在**（I5）。

---

## 7. 不变量守护点（谁守哪条）

| 不变量 | 守护位置 | 测试断言示例 |
|---|---|---|
| I5 PoolItem→Claim | `information_pool_item` 写入前后校验 | 写入不存在 claim 必须抛错 |
| I6 Requirement 条件来自方法论 | `ingestMaterial` 从 active methodology 取 | 改激活版本 → 新 Requirement importance 跟随变化 |
| I7 幂等 | stable id + match-or-create | 同材料 ingest 2 次 → 数量不变 |
| I9 Experience judgement / Pattern 阈值 | `ExperienceService` | judgement 缺失抛错；<N 条不成 Pattern |
| I10 不足无分 | `EvaluationService` | 证据不足维度 score === undefined |
| I11 四面并存 | `InvestmentEvaluation` 结构 | 缺 coverage 或 sufficiency 即构造失败 |
| I13 占位不入认知/评估 | 已有 `SKIPPED` + Evaluation 过滤 | 占位 claim 不产生 belief、不参与评分 |
| I14 投影不写真相 | Report/Dossier 只读 | 生成报告后 Claim/Belief 数量不变 |

---

## 8. CLI / Agent 工具设计（Phase A）

### CLI 新增
```
tiancha research evaluate <行业>          # 产出 InvestmentEvaluation（Quality + Coverage）
tiancha research pool <行业>              # 展示信息槽位（Slot + Item，含口径）
tiancha research priority <行业>          # 展示优先级排序（下一步最值得研究什么）
tiancha research report <行业>            # 生成投影报告（只读）
tiancha research experience list          # 研究经验与模式（**Phase D**）
```

### Agent 工具新增
| 工具 | 说明 |
|---|---|
| `research_pool_show` | "现在知道什么" —— 槽位与条目（含口径差异） |
| `research_evaluate` | "值不值得研究" —— 评分 + **覆盖度** + 明确"证据不足"维度 |
| `research_priority` | "下一步最该研究什么" |
| `research_report` | 生成可读报告（投影） |

**UX 纪律**：模型输出必须是"**我认为… + 主要不确定性 + 建议下一步**"，不得输出 JSON；`insufficient_evidence` 必须说成"证据不足"，不得说成"不看好"。

---

## 9. 迁移与幂等改造（E1/E2 具体步骤）

### E1：Requirement 承接方法论条件
1. `MethodologyDimension` 加 `weight` / `criticality`；`methodology-v1.ts` 给 12 维填默认值；
2. `research-db.ts` PRAGMA 加 4 列；
3. `InformationRequirement` 加 4 字段；
4. `ingestMaterial` 从 `activeMethodology.dimensions` 取 `importance/conditions`；
5. 测试：断言 importance 不再恒 5、条件随方法论版本变化。

### E2：幂等 identity
1. Question/Requirement/Slot 改 stable id（§2）；
2. `ingestMaterial` 改为 **match-or-create**：
   ```
   match Industry(canonicalName)
     → for each dimension: match Question/Requirement/Slot (stable id)
         → 已存在则复用（不新建）
     → 新材料只产 Claim/Evidence
     → 投影链刷新
   ```
3. 测试：同材料 2 次 → `count(question|requirement|slot)` 不变；`count(claim)` 增加。

### Pool 迁移
`information_pool_entry` → `information_pool_slot`（同 id 语义），`evidence_refs_json` → 生成 `information_pool_item`（**仅当能解析到 claim**；否则留空并在 judgement 标注"历史数据无来源"）。

---

## 10. 测试矩阵（Phase A）

| # | 测试 | 断言 |
|---|---|---|
| T-A1 | Methodology 扩展 | weight/criticality 落库并在激活版本中生效 |
| T-A2 | E1 | Requirement.importance 来自方法论；改版本后跟随变化 |
| T-A3 | E2 幂等 | 同材料 ingest×2 → 骨架数量不变，Claim 增加 |
| T-A4 | Pool Slot/Item | Item 必须带 claimRef；多口径并列保留；status 判定按 confirmedCondition |
| T-A5 | Evaluation 不足无分 | 未满足条件的维度 `score === undefined` 且 status=insufficient_evidence |
| T-A6 | Evaluation 四面 | 缺任一维度（coverage/sufficiency）构造失败 |
| T-A7 | Critical 维度 | critical 维度证据不足 ⇒ overallDecision 不得为 reserve |
| T-A8 | Priority | 排序输入可追溯（importance × uncertainty × 可得性） |
| T-A9 | Experience（**Phase D**） | judgement 必填；<N 条不成 Pattern |
| T-A10 | 投影 | 生成 report/dossier 后 Claim/Belief/Pool 数量不变 |
| T-A11 | 占位防护 | 占位 claim 不进 belief、不参与评分 |
| T-A12 | 回归 | 既有全量用例全绿 + smoke PASS |
| T-A13 | 两层映射 | 7 维汇总分由 12 维按贡献权重聚合得出；改方法论版本后映射随之变化；`exit_env` 在 v1 为 `insufficient_evidence` 时不参与总分 |

---

## 11. 实施拆分（小步闸门）

> 每步：`typecheck（两处）+ 全量测试 + smoke` 全绿才进下一步；单一目的 commit。

| 步 | 内容 | 出口条件 |
|---|---|---|
| **S1** | Methodology 扩展（weight/criticality）+ E1（Requirement 条件与 importance） | T-A1, T-A2 绿 |
| **S2** | E2 幂等 identity + match-or-create | T-A3 绿 |
| **S3** | ⚠️ **破坏性变更**：Pool 重定义（Slot + Item + 状态词映射 + 老数据迁移 + 双读）——**必须在 S2 之后**（详见 `07 §3.5` 破坏性变更声明） | T-A4, T-A11 绿 |
| **S4** | EvaluationService（四面 + 证据驱动 + critical） | T-A5, T-A6, T-A7 绿 |
| **S5** | PriorityService + NextAction 扩展 | T-A8 绿 |
| **S6** | Report/Dossier 投影（投影能力随 A 具备最小形态；**Experience 属 Phase D**） | T-A10 绿 |
| **S7** | CLI + Agent 工具 | 手工验证 + T-A12 绿 |

---

## 12. 兼容与回归

- **Phase 1/2A/2B/2C/P0/P1 行为必须保持**（Invariant 8）：S1–S7 每一步都要跑**既有全量用例**；
- `information_pool_entry` 迁移期**双读**（新 Slot 优先，老 entry 兜底），迁移完成后删列；
- `scoring/` 与 `config/scoring.json`：7 维是**上层汇总层的目标形态（不是 legacy、不废弃）**，在 **S4 EvaluationService 落地时接线**（由 12 维按贡献矩阵聚合）；在此之前**暂不接线**。**「legacy」一词只用于旧 host 资产，不得用于此处**；
- Composition Root 与 Agent Host 的装配方式不变（新 Service 由 host 构造注入）。

---

## 13. 待你确认的点（Phase A 代码设计）

| # | 问题 | 建议 |
|---|---|---|
| C1 | 评分量纲与规则 | **已裁决（07 §3.8a）**：两层映射——底层 12 维研究维度 → 上层 7 维投资汇总；量纲、锚点、12→7 贡献权重全部写进方法论配置并版本化，代码只做数学聚合 |
| C2 | 哪几维是 `critical` | 建议 **`risk` + `key_validation`**（可在方法论中调整） |
| C3 | PoolSlot 是否允许子槽位 | **Phase A 先单层**（=维度），Phase B 再支持子槽位 |
| C4 | 老 `information_pool_entry` | 迁移期只读 + 双读，**S3 完成后删除**（且 S3 必须在 S2 之后） |

**确认后即可从 S1 开始写代码。**
