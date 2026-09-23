# Architecture Re-baseline：研究体系 ↔ 知识体系双向进化

> v3 审查 · 2026-09-22 · 本轮只读审查，未改任何代码/DB/Runtime/启动方式。
> 依据：Phase 2A/2B 实际代码（非 README 推测）。
>
> **v3.1 修订（2026-09-22）**：纯文档校准，未改代码。见文末「v3 → v3.1 修订 diff」。

## v3 → v3.1 修订 diff

| # | 主题 | v3 原表述 | v3.1 修订后 |
|---|---|---|---|
| 1 | State↔Pool | 「State↔Pool 双向更新」，#15 标"双向更新/部分" | 改为**可追溯的单向一致性**：Pool 可影响 State；Knowledge/Claim/Evidence 可改 Pool；**State 不反向写 Pool**；禁止 Pool→State→Pool 循环写入。#15 判定改为"单向一致性（Pool→State 可追溯，State 不回写 Pool）"。 |
| 2 | #9 Evidence→Claim | 「2C 做 Evidence→Claim 真实挂接」 | 2C **不**提前实现真实 Material→Evidence 抽取；只要求 **Knowledge→Claim→Evidence→Source/Document 追溯链在 Domain/Repository/Projection 层面可成立**（Evidence 可为 placeholder 引用）。Echo 保留。#9 仍"部分"，措辞改为"Echo 直产 Claim，追溯关系可成立但真实抽取未实现（后续 Phase）"。 |
| 3 | IndustryKnowledge 定义 | 「Claim 的可读投影/聚合」 | 改为**以 Evidence/Claim 为依据、带来源/时间/置信度/状态/历史关系/冲突关系/主题结构的长期 Research Cognition**。2C 用 Claim→Projection 作第一版实现，但 Claim≠Knowledge 简单列表；ProjectionService 不得是 CRUD/SELECT 聚合器。 |
| 4 | Research Experience 挂点 | 给 MethodologyVersion 加 `experienceRefs` + 预留空表 | **撤回**。改为正式锁定未来链路 `Research Event→Research Experience→Experience Pattern→Methodology Candidate→Human Review→Methodology Version`，且 **Experience 永不自动改 Methodology（永远 Human-Gated）**。本阶段不建字段、不建空表。 |
| 5 | Research Event（新增节） | 未提 | 新增 §4b：未来 Research Event 对象（记录一次真实研究行为），本阶段不实现；它分岔出 Evidence/Claim/Knowledge Evolution/Research Experience。 |
| 6 | 2C 边界 | 见 §7 | §7 末尾加「v3.1 后 2C 最终边界锁定」，明确做与不做清单。 |

## 0. 结论先行

当前（Phase 2A/2B）实现的是一条**单向、一次性的"建立研究骨架"流水线**：

```
Material → Source/Document → Industry → 12×(Question+Requirement) → Pool(unknown)
        → Echo Claims → Pool(partial) → Gaps → NextAction → ResearchState
```

它正确地把 Research State / Information Pool / Research Gap 做成了独立持久对象，并守住了"Pool≠Knowledge""旧 Claim 不覆盖"两条 invariant。但**还没有"知识体系"**：没有 IndustryKnowledge 实体、没有 Knowledge 投影、没有 Knowledge↔Research 双向关系、完全没有 Research Experience 概念。这与 v2.1 锁定一致——2C 本来就是要做 Knowledge Projection。本轮 re-baseline 的价值是：**把 2C 从"补一个 Knowledge 表"校准为"建立 Research↔Knowledge 双向进化的第一条正式投影链"**。

---

## 1. 当前架构实际状态（代码事实）

### 1.1 已有的一等对象（2A）
| 对象 | 文件 | 关键字段 |
|---|---|---|
| Industry | `domain/industry.ts:15-27` | identity/aliases/reserveStatus/currentStateId/currentEvaluationRunId；**无 knowledgeRef、无 researchHistory** |
| Company | `domain/company.ts` | identity/aliases/primaryIndustryId/chainPosition/currentStateId |
| ResearchQuestion | `domain/research-question.ts` | statement/subjectKind/status/priority/dependsOn/**answerClaimRef** |
| InformationRequirement | `domain/information-requirement.ts` | questionId/dimension/description/importance/requiredEvidenceType/status |
| ResearchGap | `domain/research-gap.ts:9-21` | description/importance/uncertainty/relatedRequirementIds/relatedQuestionIds/status |
| InformationPoolEntry | `domain/information-pool.ts:12-23` | topic/status(confirmed·partial·unknown·conflict)/relatedRequirementIds/evidenceRefs |
| ResearchState | `domain/research-state.ts:13-28` | known/confirmed/uncertain/conflicting/unknown(StateItemRef[])/keyQuestionIds/researchGapIds/nextActionIds/version |
| Claim | `domain/claim.ts:35-48` | statement/claimType/provenance/conflictOfInterest/factIds/evidenceIds/**subjectKind/subjectId/temporalRelation(current·old·superseded)** |
| MethodologyVersion | `domain/methodology.ts:19-26` | dimensions[12]/isHumanApprovedBaseline/activatedAt；**无 experienceRefs、无 Candidate/Review 状态机字段** |
| Source/Document/NextAction | `domain/source.ts` / `domain/next-action.ts` | 来源与可执行动作 |

### 1.2 持久化
- 业务表（`storage/research-db.ts:30-164`）：industry/company/research_question/information_requirement/research_gap/information_pool_entry/research_state/research_source/research_document/next_action/methodology（11 张）。
- **Claim 不落业务表**：Claim blob 经 `ArtifactStore.put({kind:"claim"})` 存进 `artifacts.sqlite`（见 `application/opportunity-discovery-service.ts`）。`research_question.answer_claim_ref`、pool.evidence_refs、state.known 都指向这些 Artifact。
- **无 knowledge 表、无 knowledge_claim 表、无 conflict 表、无 research_experience 表、无 target/chain/outline 表**。

### 1.3 应用层（唯一服务）
`application/opportunity-discovery-service.ts` 的 `ingestMaterial()`：
1. 建 Source/Document；2. match-or-create Industry；3. 对 12 维各建 Question+Requirement+Pool(unknown)；4. Echo Provider → 每维一条 Claim(Artifact)，把对应 Pool 标 partial；5. 仍 unknown 的维度建 Gap；6. 每个 Gap 建一个 NextAction；7. 刷新 ResearchState（known=claim refs、unknown=未覆盖 topic、gap/nextAction ids）。
`supersedeClaim()`：把旧 Claim 标 `temporalRelation=old`，另写一条新 current Claim（T9）。

### 1.4 关键事实
- 全仓 grep `knowledge|experience` 在 `packages/research/src` 仅命中 `information-pool.ts` 的 invariant 注释与 `foundation.test.ts` 的 T3——**没有任何 Knowledge/Experience 领域代码**。
- `agents/`（scout/analyst/critic/planner-agent/writer）为 Phase 1 占位，未被 2A/2B 接线。
- `evidence/evidence-engine.ts`、`evidence-extractor.ts` 为 Phase 1 占位，2A 的 Evidence 抽取实际是"Echo 直接产 Claim"，没有真实 Material→Evidence 抽取。

---

## 2. Research System 与 Knowledge System 的关系：当前是单向、未闭环

当前数据流只有"建骨架"一条向下箭头，**没有回流**：

```
Material → ... → State/Gap/NextAction   （终点，不会再影响下一次 Material 的理解）
```

缺的回流：
- 新 Claim 产生后，**没有"与已有 Knowledge 比较"步骤**（service 直接写 Claim、标 Pool partial；不读旧 Claim 做 diff/冲突判定）。
- ResearchState 的 known/conflicting 是"本轮 Echo 给了什么"，不是"长期认知沉淀了什么"。
- Industry 对象不持有 knowledgeRef，下次研究同一行业时不会加载任何历史认知。

**结论：尚未形成双向关系。缺的正是 2C 要建的 Knowledge Projection + 回流比较。**

---

## 3. 三类核心资产职责清晰度

| 资产 | 当前职责 | 评价 |
|---|---|---|
| Methodology（如何研究） | `methodology-v1` 12 维 Human-approved baseline，`domain/methodology.ts` | ✅ 边界清晰：v1 冻结、禁模型自改；但**无 Candidate→Review→Activate 的运行时状态**（v3.1：不再预留 experienceRefs，见 §4） |
| Industry/Company Knowledge（现在知道什么） | **尚不存在**。Claim 是散落的 Artifact，没有按 subject 形成"该行业的长期研究认知"，没有 confirmed/revised/conflicting 的认知层 | ❌ 缺——2C 核心。v3.1：Knowledge 不是 Claim 简单列表，是带来源/时间/置信度/状态/历史/冲突/主题的长期 Research Cognition（见 §7.1） |
| Information Pool / State（需要什么·已知多少） | PoolEntry(topic+status+evidenceRefs) + ResearchState(refs+ids) | ✅ invariant 清晰（T3），Pool 不是 Knowledge 子表；v3.1：Pool→State 单向可追溯一致，State 不回写 Pool（禁止循环写入） |

Pool 与 Knowledge **目前没有同质问题**——Pool 是覆盖率元数据，Claim 是 Artifact；真正缺的是"把 Claim 投影成 Knowledge"这一层，否则 Knowledge 缺位，Pool 成了唯一的"认知"，长期会退化成半张知识表。2C 必须补上这一层并守住 invariant。

---

## 4. Research Experience 与 Research Event（v3.1 修订）

**Research Experience 是未来长期进化体系的一等概念，但本阶段（含 2C）不实现、不留空壳。**

- **v3.1 撤回**此前"给 MethodologyVersion 加 experienceRefs 字段、预留 research_experience 空表"的建议——当前无真实 Research Event/Target/Outline/Execution，建了只是空壳。
- 正式锁定未来链路：

  ```
  Research Event → Research Experience → Experience Pattern
      → Methodology Candidate → Human Review → Methodology Version
  ```

- **铁律：Experience 不得自动修改 Methodology；Experience→Methodology Evolution 永远 Human-Gated**，与 Methodology Candidate 同一闸门，禁止模型自学改方法论。
- Experience 的"原料"（哪些对象答得好、哪些问题有效/无效、哪些常被拒答、哪些判断被验证或推翻）要等 Phase 3（Target/Outline）及以后真实研究行为产生后，再从 Research Event 派生。

### 4b. Research Event（未来对象，本阶段不实现）

未来存在 **Research Event**，用于记录一次真实研究行为：调研某企业、询问某问题、获得某信息、某问题回答有效/无效、某判断被验证/推翻、某调研对象产生高价值信息。

它分岔出四类下游产物：

```
Research Event ─┬─► Evidence
                ├─► Claim
                ├─► Knowledge Evolution（认知变化）
                └─► Research Experience（关于"如何研究"的经验）
```

Research Event 是未来连接"研究行为"与"研究经验"的基础。**本阶段（含 2C）不实现 Research Event**，仅锁定其未来定位，避免把经验学习提前塞进 2C。

---

## 5. 双向进化图（文字版，边标注当前状态）

```
 ┌─────────────────────────────────────────────────────────────┐
 │ Methodology v1（12 维，Human-approved）                        │
 │   ▲  边14 Experience→Methodology     [缺失/Phase 3+/Human Gate] │
 └───┼───────────────────────────────────────────┬─────────────┘
     │ 边1 Knowledge→State                        │ 边13 Outcome→Experience [缺失/Phase 3]
     │   [部分: state.known 引用本轮 claims]        │
     ▼                                          ▼
 ┌──────────────┐  边2 State→Gap  ┌──────────────┐  边5 Experience→Target [缺失/Phase3]
 │ ResearchState │ ─────────────▶ │ ResearchGap   │
 │ + Information │  边15 Pool→State │ (Requirement │  边3 Gap→Target [缺失/Phase 3]
 │  Pool         │ 单向可追溯一致 │  连接器)      │  边4 Knowledge→Target [缺失/Phase 3]
 └──────┬───────┘ (State 不回写Pool)└──────┬───────┘
        │ 边11 Knowledge→Pool             │ 边6 Target→Outline [缺失/Phase 3]
        │ [缺失: Pool 不读 Knowledge]      │ 边7 Experience→Outline [缺失/Phase 3]
        ▼
 ┌──────────────────────────────────────────────────────────┐
 │ Industry / Company Knowledge（长期认知）  ← 2C 要建        │
 │   ▲ 边10 Claim→Knowledge   [缺失]                         │
 │   │ 边12 New Evidence↔Existing Knowledge 比较 [缺失/仅 T9 同对象 supersede] │
 │   │ 边8 Material→Evidence  [占位: Echo 直产 Claim]           │
 │   └ 边9 Evidence→Claim     [部分: Claim 是 Artifact, evidenceIds 多空] │
 └──────────────────────────────────────────────────────────┘
```

---

## 6. 15 条箭头判定表

| # | 箭头 | 判定 | 代码依据 / 缺失说明 | 归属 |
|---|---|---|---|---|
| 1 | Knowledge→Research State | **部分** | State.known/confirmed 引用 Claim Artifact（`research-state.ts:17-21`），但"Knowledge"尚不存在，实际引用的是原始 Claim，未做知识投影 | 2C |
| 2 | Research State→Research Gap | **已实现** | service 把未覆盖维度建 Gap（`opportunity-discovery-service.ts` gaps 段）；State.researchGapIds 关联 | 2A ✅ |
| 3 | Research Gap→Research Target | **缺失** | 无 Target/Chain 概念；NextAction 只是 `kind=retrieve_data` | Phase 3 |
| 4 | Knowledge→Research Target | **缺失** | 无 Knowledge、无 Target | Phase 3 |
| 5 | Research Experience→Research Target | **缺失** | 无 Experience、无 Target | Phase 3 |
| 6 | Research Target→Research Outline | **缺失** | 无 Target/Outline | Phase 3 |
| 7 | Research Experience→Research Outline | **缺失** | — | Phase 3 |
| 8 | Research Material→Evidence | **占位** | Echo Provider 直接产 Claim，无真实抽取；`evidence/` 为 Phase 1 占位 | 后续 Material Processing |
| 9 | Evidence→Claim | **部分** | Claim 是 Artifact 且有 evidenceIds 字段；Echo 直产 Claim、evidenceIds=[]。v3.1：2C 只要求 Knowledge→Claim→Evidence→Source 追溯关系可成立（Evidence 可为占位引用），**不**提前实现真实 Material→Evidence 抽取 | 2C（仅追溯链） |
| 10 | Claim→Knowledge | **缺失** | 无 Knowledge 实体/投影/表 | **2C 核心** |
| 11 | Knowledge→Information Pool | **缺失** | Pool 只由 Requirement+Echo 写，不读 Knowledge；方向上 Knowledge/Claim/Evidence 可改 Pool（单向，不回写） | 2C |
| 12 | New Evidence↔Existing Knowledge 比较 | **部分** | 仅 `supersedeClaim()` 对**显式传入的 oldClaimId** 标 old；**不会自动扫同主题旧 Claim、不判 Conflict/Revision** | 2C |
| 13 | Research Outcome→Research Experience | **缺失** | 无 Experience 记录；未来由 Research Event 派生（§4b），本阶段不实现 | Phase 3+ |
| 14 | Research Experience→Methodology 演化 | **缺失** | methodology.ts 仅有版本，无 Candidate/Review 流；v3.1：不预留 experienceRefs，未来链路见 §4，**永远 Human-Gated** | 后续（Human Gate） |
| 15 | Research State ← Information Pool 单向一致性 | **部分（口径修订）** | v3.1：Pool→State 可追溯一致；Knowledge/Claim/Evidence 可改 Pool；**State 不反向写 Pool，禁止 Pool→State→Pool 循环**。当前仅 service 写 Pool 后刷 State | 2C |

小结：**已实现 1 条（#2）；部分 5 条（#1/#9/#11/#12/#15 + 边界 #8 占位）；缺失 9 条**。其中 2C 应收口 #1/#9(追溯链)/#10/#11/#12/#15(单向一致性) 六条。

---

## 7. Phase 2C 调整建议（经本次校准）

**不提前碰 Phase 3**（Gap→Chain→Target→Outline→Material）。2C 的唯一目标是**建立"研究结果→长期知识"第一条正式投影链**，并为 2D/3 留接口：

```
Evidence/Claim → IndustryKnowledge(投影) → ResearchState 对账
                 → Information Pool 对账 → Conflict 保留 → Knowledge Evolution(历史)
```

### 7.1 2C 应新增 Domain Object
- **IndustryKnowledge**（v3.1 重定义）：以 Evidence/Claim 为依据形成的**长期 Research Cognition**——具有来源、时间、置信度、状态、历史关系、冲突关系与主题结构。2C 以 **Claim→Knowledge Projection 作为第一版实现方式**，但必须明确：**Claim 是 Knowledge 的重要来源，Knowledge 不是简单 Claim 列表**。字段：knowledgeId/subjectKind/subjectId/beliefs[]（每条带 claimRef/sourceRef/confidence/state(confirmed·revised·conflicting·superseded)/updatedAt/历史关系）/version。
- **KnowledgeConflict**（知识资产，不强行二选一）：conflictId/claimARef/claimBRef/dimension/status(open·resolved·accepted)/relatedGapId。
- ~~给 MethodologyVersion 加 experienceRefs~~（v3.1 撤回，见 §4）。
- Industry 增加 `currentKnowledgeId?: string`。

### 7.2 应新增 Repository / 表
- `industry_knowledge`、`knowledge_belief`、`knowledge_conflict` 三张表（在 research-db 同库迁移）。
- `KnowledgeProjectionService`：v3.1 强调它**不得是简单 CRUD / SELECT 聚合器**。它要表达：多 Claim 综合认知、支持关系、修正关系、冲突关系、时间变化、不确定性、证据强度、来源、历史认知变化。2C 检测同主题新 Claim 与旧 belief 的关系：SUPPORT / REVISE / CONFLICT / SUPERSEDE。

### 7.3 2C 必须做（收口六条边）
- #10 Claim→Knowledge 投影（长期 Research Cognition，非列表）；#9 仅建立 **Knowledge→Claim→Evidence→Source/Document 追溯关系**（Evidence 可为占位引用，不做真实抽取）；#12 新 Claim 自动与同主题旧 belief 比较（不只靠手动 supersedeClaim）；#11/#15 Knowledge/Claim/Evidence 单向影响 Pool、Pool 单向影响 State（禁止循环）；Methodology Human Gate 占位（Candidate→Review→Activate 状态机，v1 仍冻结）。
- 分层保持：Evidence/Claim 是事实与主张层来源；Knowledge 是长期研究认知层。
- 测试：T5 Methodology Human Gate；T10 Conflict 双 Evidence 并存；新增 T13 新 Claim 自动触发 CONFLICT/REVISE 而非覆盖。

### 7.4 2C 明确不做
- 不做 Gap→Target/Chain/Outline（Phase 3）；不做真实 Material→Evidence LLM 抽取；不做 Experience→Methodology 演化（v3.1 不留 experienceRefs 空壳）；不做 Report。

### 7.5 对 2D 的衔接
- 2C 产生的 Knowledge/Conflict 表须与现有 State/Pool 同库，保证 2D kill→restart 时一起恢复。

### 7.6 v3.1 后 Phase 2C 最终边界锁定

**做（唯一目标链）：**
```
Claim → IndustryKnowledge（长期 Research Cognition）→ Knowledge Evolution（保留历史）
      → ResearchState / InformationPool 单向一致 → ResearchGap
Existing Knowledge + New Claim → SUPPORT / REVISE / CONFLICT / SUPERSEDE（保留历史，禁静默覆盖）
Knowledge→Claim→Evidence→Source/Document 追溯链可成立
```

**不做：** Material→Evidence extraction、ResearchTarget、ResearchChain、ResearchOutline、ResearchExperience 实现、Experience learning、Methodology evolution、Report generation、Web/Wind 接入、Session persistence。

---

## 8. 纪律确认
本轮仅新增本报告，未改任何代码/Domain/DB/Runtime/启动方式，未提交。等待授权后再进入 2C。
