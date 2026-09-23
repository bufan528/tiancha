# Phase 2C Implementation Design · Knowledge Projection & Research–Knowledge Coevolution

> 设计稿（未编码）· 2026-09-22
> 权威依据：`docs/architecture-review/02-architecture-blueprint-v2.1-final-lock.md`、`docs/architecture-review/03-rebaseline-research-knowledge-coevolution.md`（v3.1，6 项修订）。
> 本轮只做设计，不编码、不改现有代码、不提交。

---

## 1. 目标与范围

**唯一目标**：建立第一版 `IndustryKnowledge` = 以 Evidence/Claim 为依据的长期 Research Cognition（不是 Claim 列表、不是 SELECT 聚合）。

**链路升级**（在 2A 链路上追加，不替换）：

```
Material → Source/Document → Industry → Question → Requirement → Pool(unknown)
        → Echo Claim(Artifact)
        → IndustryKnowledge(Projection) → Knowledge Evolution(历史保留)
        → Pool 单向对账 → State 单向刷新 → Gap → NextAction
```

**Scope Fence（明确不做）**：ResearchTarget / ResearchChain / ResearchOutline / Diligence / Field Research / ResearchEvent 实现 / ResearchExperience 实现与学习 / Methodology 自动演化 / Report 生成 / Web·Wind 接入 / 真实 Material→Evidence 抽取 / Session 持久化。

---

## 2. 当前架构现状摘要（基于真实代码）

- **Claim**（`packages/research/src/domain/claim.ts:35-48`）：`claimId/statement/claimType/provenance/conflictOfInterest/factIds/evidenceIds`，2A 已加 `subjectKind/subjectId/temporalRelation(current|old|superseded)`。**Claim 不落业务表**，blob 经 `ArtifactStore.put({kind:"claim"})` 存 `artifacts.sqlite`。
- **Evidence**（`domain/evidence.ts:16-25`）：`evidenceId/claimId/sourceId/locator/verificationStatus/confidence/provenance`；**未建表、未被 2A 填充**——Echo 路径 Claim.evidenceIds=[]。这是追溯链上当前的 placeholder 环。
- **Pool**（`domain/information-pool.ts:12-23`）：`entryId/subjectKind/subjectId/topic/status(confirmed|partial|unknown|conflict)/relatedRequirementIds/evidenceRefs`。
- **State**（`domain/research-state.ts:13-28`）：`known/confirmed/uncertain/conflicting/unknown: StateItemRef[]` + `keyQuestionIds/researchGapIds/nextActionIds/version`。
- **Methodology**（`domain/methodology.ts:19-26`）：`versionId/versionTag/dimensions/isHumanApprovedBaseline/activatedAt`；DB 表（`research-db.ts:152-158`）仅存 5 列，**无 Candidate/Review 状态机**。
- **Application**（`application/opportunity-discovery-service.ts`）：`ingestMaterial()` 建 Source/Doc→Industry→12×(Question+Requirement+Pool unknown)→Echo 12 Claim→Pool partial→Gaps(unknown)→NextAction→State 刷新；`supersedeClaim()` 仅对手动传入的 oldClaimId 标 `old`。
- **缺口**：无 IndustryKnowledge 实体/表；新 Claim 不与同主题旧 belief 比较；无 Conflict 持久化；Methodology 无运行时 Human Gate；State.known 直接引用原始 Claim 而非知识层。

---

## 3. Domain 设计

### 3.1 IndustryKnowledge（aggregate，长期 Research Cognition）
```
IndustryKnowledge {
  knowledgeId: string
  subjectKind: "industry" | "company" | "general"
  subjectId: string
  beliefs: KnowledgeBelief[]      // 当前认知视图（可重算）
  version: number
  createdAt, updatedAt: string
}
```
- **Claim ≠ Knowledge，Knowledge ≠ Claim[]**：Knowledge 是对一组 Claim 经关系分析后的综合认知；`beliefs` 是当前投影，历史 belief 永不删。
- `Industry` 增加 `currentKnowledgeId?: string`（`domain/industry.ts:15-27` 增字段，不改其余）。

### 3.2 KnowledgeBelief
```
KnowledgeBelief {
  beliefId, knowledgeId
  claimRef, sourceRef, evidenceRef      // 三段追溯
  dimension, topic
  confidence: number                    // 0..1
  state: "confirmed" | "revised" | "conflicting" | "superseded"
  historicalRelations: { relation: "SUPPORT"|"REVISE"|"CONFLICT"|"SUPERSEDE",
                         otherBeliefId: string, at: string }[]
  createdAt, updatedAt
}
```

### 3.3 KnowledgeConflict（知识资产，不强行二选一）
```
KnowledgeConflict {
  conflictId, claimARef, claimBRef
  dimension
  status: "open" | "resolved" | "accepted"
  relatedGapId?: string
  createdAt, resolvedAt?
}
```
- `resolved` 只改状态，**不删除任一 Claim/Belief**。

### 3.4 与现有 Domain 的关系
- `Claim` **不改字段**（已足够）。
- `ResearchState` **不改结构**（仍是认知状态摘要）。
- `Industry` 仅加 `currentKnowledgeId`。
- `Evidence`/`Fact` 不改。

---

## 4. 四种 Evolution 正式定义

| Evolution | 定义 | 触发条件（保守、可测） | 持久化结果 |
|---|---|---|---|
| SUPPORT | 新 Claim 与既有 belief 同 subject+同 dimension、方向一致、不互斥 | 同 subject+dimension，且无时间互斥信号 | 新 belief state=confirmed，historicalRelations +=SUPPORT→旧 |
| REVISE | 新 Claim 修正既有 belief 的量化/定性判断（非对立） | 同 subject+dimension，同向但数值/程度不同 | 旧 belief→revised，新 belief→current；history 保留 |
| CONFLICT | 新 Claim 与既有 belief 互斥/方向相反 | 同 subject+dimension 且明确互斥（v1 用显式 stance=contradict 或互斥标签） | 双方 belief=conflicting，写 KnowledgeConflict(open) |
| SUPERSEDE | 新 Claim 明确取代旧 Claim（口径/版本更新） | 显式 supersedes 声明（沿用 supersedeClaim 语义） | 旧→superseded，新→current |

**铁律**：old+new+relationship 始终并存；current projection 可重算，historical 必存；禁止静默覆盖。

---

## 5. New Claim 自动比较流程

```
输入：新 Claim(subjectKind, subjectId, dimension, claimRef)
  1. 在该 subject 的 KnowledgeBelief 中找同 dimension 且未 superseded 的 beliefs
  2. 规则判定（v1 保守）：
     - 无同维度 belief            → 新建 belief=confirmed（无关系可判）
     - 方向一致/同向              → SUPPORT
     - 同向但程度/数值修正        → REVISE
     - stance=contradict 或互斥  → CONFLICT（写 conflict 记录）
     - 显式 supersedes            → SUPERSEDE
     - 无法确定                   → 不强行判 CONFLICT；belief=uncertain，可产待验证 Gap
  3. 输出：Evolution 类型 + 持久化操作集合
```
替代仅手动 `supersedeClaim`。v1 规则：同 subject+同 dimension 为必要条件；跨维度不自动判。

---

## 6. KnowledgeProjectionService（核心）

**职责**：Claim → 找相关 Knowledge → 关系分析 → Knowledge Evolution → 持久化 → Pool 对账 → State 刷新 → Gap 更新。**不是 SELECT claims → INSERT knowledge 的 CRUD 聚合器**；第一版规则驱动、保守、可解释、可测。

方法签名（设计）：
```
class KnowledgeProjectionService {
  projectFromClaim(input: {
    claim: Claim; subjectKind; subjectId; dimension; evidenceRef?; sourceRef?;
  }): Promise<{ knowledgeId: string; evolution: "SUPPORT"|"REVISE"|"CONFLICT"|"SUPERSEDE"|"NEW"; beliefId: string }>

  reconcilePool(industryId): void     // Knowledge→Pool 单向
  refreshState(industryId): void       // Pool→State 单向
}
```

**调用时机**：① 每条新 Claim 产生后（2A service 内接入）；② 显式 `tiancha knowledge project <industry>`；③ ingest 完成后批量投影。

**与 OpportunityDiscoveryService 关系**：2C 后 `ingestMaterial()` 在 Echo 产 Claim 后调用 `projectFromClaim`，再走 reconcilePool/refreshState；不改动 2A 已生成 Question/Requirement/Pool 的骨架逻辑。

---

## 7. Pool/State 一致性边界（v3.1 单向）

- **严格单向**：Knowledge/Claim/Evidence →（明确语义）→ Pool →（单向刷新）→ State；**State 永不回写 Pool**，禁止 Pool→State→Pool 循环。
- Knowledge→Pool 语义：某 InformationRequirement 得到足够 belief 支持 → 更新对应 `PoolEntry.status`（unknown→partial/confirmed）与 `evidenceRefs`；**不是把 Knowledge 复制成 Pool**。
- `ResearchState` 保持现状字段，仅作认知摘要；`ResearchState ≠ IndustryKnowledge`。

---

## 8. Evidence Traceability

- 不实现真实 Material→Evidence 抽取；Echo placeholder 保留，继续标 `sourceType="echo_placeholder"`、`isRealExternalData=false`。
- 追溯链须成立：`IndustryKnowledge → Belief(claimRef, sourceRef, evidenceRef) → Claim(Artifact) → Evidence(placeholder ref) → Source → Document`。
- placeholder 环：当前 `Claim.evidenceIds=[]`、Evidence 未建表；2C 在 belief 上挂 `evidenceRef/sourceRef`，指向已有 `research_source`/`research_document` 行，使链条**可在 Domain/Repository 层成立**，即使 Evidence 内容为占位。

---

## 9. Methodology Human Gate（T5）

状态机：`MethodologyCandidate → Review(open) → HumanApproved | Rejected → Version → Activate`。
- 未 HumanApproved **不能 Activate**；v1 仍为 Human-approved baseline、禁模型自改；不做 Experience→Methodology 演化。
- 设计：`MethodologyCandidate` 领域对象（candidateId/parentVersionId/proposedChanges/status/reviewedAt），`approveCandidate(id)` 仅当 status=HumanApproved 才生成新 MethodologyVersion 并 Activate。

---

## 10. DB 迁移方案（同库，`storage/research-db.ts`）

新增三表（与现有 11 表同库，`CREATE TABLE IF NOT EXISTS`，幂等升级）：
```sql
CREATE TABLE IF NOT EXISTS industry_knowledge (
  knowledge_id TEXT PRIMARY KEY, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL,
  version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge_belief (
  belief_id TEXT PRIMARY KEY, knowledge_id TEXT NOT NULL, claim_ref TEXT NOT NULL,
  source_ref TEXT, evidence_ref TEXT, dimension TEXT NOT NULL, topic TEXT,
  confidence REAL NOT NULL, state TEXT NOT NULL,
  historical_relations_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge_conflict (
  conflict_id TEXT PRIMARY KEY, claim_a_ref TEXT NOT NULL, claim_b_ref TEXT NOT NULL,
  dimension TEXT NOT NULL, status TEXT NOT NULL, related_gap_id TEXT,
  created_at TEXT NOT NULL, resolved_at TEXT);
-- industry 加列（安全 ALTER，存在则跳过）
ALTER TABLE industry ADD COLUMN current_knowledge_id TEXT;
```
索引：`knowledge_belief(knowledge_id)`、`knowledge_belief(subject via knowledge)`、`knowledge_conflict(status)`。
迁移安全：`CREATE TABLE IF NOT EXISTS` + ALTER 用 try/catch（SQLite 列已存在会报错，需吞掉或查 pragma）；不破坏 Phase1/2A/2B 数据；新装直接建表。

---

## 11. 测试设计

| 测试 | 断言要点 |
|---|---|
| T3 Pool≠Knowledge（已有） | 2C 后 Pool 仍是覆盖率、belief 是认知，二者不同表不同语义 |
| T5 Human Gate | 未 approve 的 candidate 不能 Activate；approve 后产生新 Version |
| T9 旧 Claim 不被覆盖（已有） | supersede 后旧 claim 仍在且 state=old |
| T10 Conflict 双保留 | CONFLICT 后 claimA/claimB/belief 双方均在，conflict=open |
| T13 新 Claim 自动 Evolution | 同维度新 claim 触发 SUPPORT/REVISE/CONFLICT/SUPERSEDE 之一，而非覆盖 |
| 新: persistence | 三表 CRUD 往返；history 不丢 |
| 新: migration | 旧库加列/建表幂等；新装初始化 |
| 新: Pool/State direction | Knowledge→Pool→State；State 不回写 Pool |
| 新: traceability | belief 可沿 claimRef→sourceRef→document 追到 |
| 新: regression | 17 个旧测试全绿 |

---

## 12. 实施 Step（设计通过后执行，本轮不编码）

1. Domain + schema + repository（三表 + Industry 加列）
2. KnowledgeProjectionService
3. Pool/State reconciliation
4. Methodology Human Gate
5. Tests（T5/T10/T13 + 新增）
6. E2E（ingest→投影→Evolution→Pool/State→Gap）
7. Independent audit
每步 build + unit + regression 全绿才进下一步；小步独立 commit。

---

## 13. 八条 Invariant（验收核心）

1. Pool ≠ Knowledge
2. Evolution 永不静默删历史
3. Conflict 永不静默选边
4. State 永不回写 Pool
5. Echo 占位永不变成真实外部证据
6. Methodology 无 Human Gate 不能 Activate
7. Knowledge 可回溯 Claim/Evidence/Source/Document
8. Phase1/2A/2B 行为保持不变

---

## 14. CLI 影响（保持极薄）

- 新增 `tiancha knowledge show <industry>`（读：当前 beliefs/conflicts）、`tiancha knowledge project <industry>`（显式触发投影）。
- 现有 `industry show`、`state show` 可选追加一行 knowledge 摘要（不改命令形态）。
- CLI 仍不判断意图、不直写 SQL、不自生成回答。

---

## 编码前 Implementation Clarification（2026-09-22，已拍板）

| # | 决策 | 结论 |
|---|---|---|
| 1 | CONFLICT 判定 | **v1 仅认显式互斥**：只在 `stance=contradict` 或明确互斥标签时判 CONFLICT；**不做数值区间重叠自动判 Conflict**（无 Metric Ontology/单位/口径/时间范围统一，数值比较会把"口径不同"误判成冲突）。原则：宁可暂不判，也不误判。 |
| 2 | 比较范围 | 严格 **same subject + same dimension**；跨 dimension（Market↔Demand↔Competition）不自动判 Evolution，属更高层综合推理，留后续。 |
| 3 | SQLite ALTER | **强制走 PRAGMA table_info(industry) 预检查**：查 `current_knowledge_id` 是否存在→存在不 ALTER、不存在才 `ALTER TABLE ADD COLUMN`；try/catch 仅异常兜底，禁止把吞 "duplicate column" 当正常幂等路径。三表仍 `CREATE TABLE IF NOT EXISTS`。 |
| 4 | Belief.state 语义 | state 枚举保持 `confirmed\|revised\|conflicting\|superseded`，**不引入 `current`**。"是否当前认知"由 `Knowledge.beliefs[]` 当前投影表达（可重算），state 与 current projection 分离。 |

**§4 措辞修正**：REVISE→旧 belief.state=revised、新=confirmed；SUPPORT→新=confirmed；SUPERSEDE→旧=superseded、新=confirmed；CONFLICT→双方=conflicting。`Knowledge.beliefs[]` 只保留当前投影，历史 belief 行永不删。

**§10 迁移修正**：industry 加列改为 PRAGMA 预检查实现，不再写裸 `ALTER TABLE` 进 `exec`。

---

## 待评审决策项（已全部拍板，见「编码前 Implementation Clarification」）
