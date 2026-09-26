# Phase C5 · Research Recommendation & Human-Gated Planning — Implementation Contract

> **Status: rev4 — STATIC REVIEW PASS.** 本文件是 C5 的冻结设计输入，**不含任何代码**。
> 父基线：`7a71280`（C4 PUBLISHED / FROZEN）。
> 未经单独授权，**不得**开始 C5-A 实现。

---

## §0 修订历史（rev0 → rev4）

| 版本 | 变更 | 触发 |
|---|---|---|
| rev0 | 首版草案：Existing/New/Reuse/Extend/Forbidden/SoT/Write Authority/Human Gate/E2E Invariants/OUT 十项 | C5 Re-baseline |
| rev1 | 吸收 §16 六项裁定（Human Gate 方案 2、`CompanyIndustryRelation` OUT、独立 decision 表、P1 legacy 隔离、CLI 形态、Company 列策略）；新增 C5-R1…R5 | §16 裁定 |
| rev2 | ProposalKey/revision/proposalId 三层身份；Write Authority 三层；confirm 原子事务；confirm 幂等（基于代码事实）；`targetKinds[]` 多值；score/reason 锁定；全表动态指纹；`generate` 写入语义 | rev1 静态审查 |
| rev3 | Eligibility 双条件（含"已有 Target ⇒ 不产生 Proposal"）；`alreadyTargeted` 移出 identity；Decision 唯一性 + CAS；status/decision SoT 分离；`canonicalJson` 规范；"一 Company 一 Proposal"；`subjectKey := trim(canonicalName)` | rev2 静态审查 |
| rev4 | **CLOSURE RULE** + `revisionInput` 补 `company.targetKinds`/`position.label`；`subjectKey` 唯一规范化；confirm 事务顺序（**rollback CAS**）；Company Universe 的 **Industry scope**；`--gap` 与唯一性的作用域 | rev3 静态审查（4 MUST-FIX + 1 MUST-CLARIFY） |

---

## §1 基线与输入

| 项 | 值 |
|---|---|
| 父基线 | **`7a71280`**（C4 PUBLISHED / FROZEN） |
| 输入 1 | C2 已冻结：Chain / Position / Target / Diligence / Plan（`I-C2-17/22/24/25`） |
| 输入 2 | C4 已冻结：Knowledge → Report → Snapshot History |
| 输入 3 | C5 Re-baseline（既有能力逐项盘点） |

**铁律**：本契约**不修改**任何已冻结语义 —— §2.4 红线 / `ResearchTarget.createdBy` / `I-C2-*` / `I-C4-*`。

---

## §2 阶段目标与核心链

> **Planning 从「被动读取」变成「受控的研究决策入口」。**

```text
Persisted Knowledge / Research Gap
        ↓  ResearchPosition                      （已存在，C2）
        ↓  Recommendation Engine                 （C5 新增；pure / zero-write）
        ↓  TargetProposalDraft → TargetProposal  （C5 新增；独立对象）
        ↓  Human Decision  ──┬── rejected → ProposalDecision
        ↓                    └── confirmed → ProposalDecision → TargetService.add()
        ↓  ResearchTarget → Diligence → Material → Knowledge Evolution → Gap → 下一轮
```

**C2 已冻结的读侧（不重做）**：`ResearchPlanService.build()`（`research-plan-service.ts:56-189`，唯一 plan 构建路径，纯只读）。

---

## §3 Existing（既有能力盘点，逐项带证据）

| 能力 | 位置 | 状态 |
|---|---|---|
| `ResearchPosition`（`suggested_target_kinds_json` / `importance` / `satisfies_requirement_refs_json` / `why_important`） | `research-db.ts:322`、`domain/chain-template.ts:99-149` | ✅ 生产可用 |
| `ResearchTarget`（`selection_reason` / `research_purpose` / `related_*_refs` / `is_fallback`） | `research-db.ts:341`、`target-service.ts:37`、`research-repository.ts:648` | ✅ **唯一写入者 `TargetService`** |
| `DiligencePreparation`（`why_this_target` / `current_understanding_json` / `questions_json`） | `research-db.ts:365`、`diligence-preparation-service.ts:50` | ✅ |
| `ResearchNeedService`（active gaps + priority + `suggestedPositionRefs`） | `research-need-service.ts:17/50` | ✅ |
| `QuestionTargetFitService`（`fitAll` / `summarize`；kind 匹配 `includes()`） | `question-target-fit-service.ts:23`、`domain/question-target-fit.ts:100` | ✅ |
| `positionCoverage()` | `chain-projection-service.ts`、`domain/position-coverage.ts:14` | ✅ |
| `ResearchPlanService.build()` | `research-plan-service.ts:56-189`、`domain/research-plan.ts:10` | ✅ 只读 DTO，无身份 |
| `human_gate` 表 + `domain/human-gate.ts` + `runtime/human-gate.ts` | `research-db.ts:229`、`runtime/human-gate.ts:33/57` | ✅ 生产可用，**唯一使用者 `MethodologyService`，`task_id NOT NULL`** |
| `ResearchRepository.transaction<T>(fn)` | `research-repository.ts:38-39` | ✅ 已有生产用法（`methodology-service.ts:101/128`）+ 已有测试（`methodology-service.test.ts:138`） |
| `ActiveRequirementResolver`（active 判据唯一） | `domain/active-requirement.ts:20` | ✅ |
| `Company`（`primaryIndustryId?` / `chainPosition?`） | `domain/company.ts:5-14`、`research-db.ts:53-62`、`research-repository.ts:98/119` | ⚠️ 表可用，**零 service 调用方**；`chainPosition` 无取值域 |
| P1 legacy：`TargetCandidate` / `ScreeningRun` / `ScreeningRule` / `TargetDecision` / `CompanyIndustryRelation` | `domain/target-candidate.ts:1-43`（头注 "P1; Phase 1 = contract only"）、`domain/company-industry-relation.ts:12` | ❌ contract only，无表、无 service、零使用者 |
| CLI | `industry ingest` / `research material add` / `chain` / `target add\|list` / `diligence` / `plan` / `need` / `priority` / `report[-history]` / `pool` | ✅ |
| Agent 暴露面 | B5 / S7 governance | ✅ 只读 |

**`ResearchTarget` 的三条冻结事实（`domain/research-target.ts:4-9`、`target-service.ts:4-11`）**

1. `createdBy` **硬编码 `"user"`，不是参数** —— 任何调用者（含 Agent）无法伪造人工确认（T-B8）
2. **"deliberately NO `Position → ResearchTarget` path"** —— §2.4 红线
3. `targetRef = targetRefFor(industryId, subjectKey)` 确定性（T-B6）；`add()` 为 create-or-update（`INSERT OR REPLACE`），**保留 `status` / `createdAt`，但会覆盖 kind/reason/purpose/`updatedAt`**

---

## §4 New / Reuse / Extend / Forbidden

### §4.1 New

| 新增 | 形态 |
|---|---|
| `TargetProposalDraft` | 纯值对象（无持久化身份），Recommendation Engine 的输出 |
| `TargetProposal` domain + **`target_proposal` 表** | `status: "proposed" \| "confirmed" \| "rejected"` |
| **`target_proposal_decision` 表** | 独立 **append-only** 决策记录 |
| `TargetRecommendationService` | **pure / ZERO WRITE**，产出 `Draft[]` |
| `TargetProposalService` | 唯一 `target_proposal` 写者（INSERT / transition / READ）+ 唯一 decision 写者 |
| `ProposalDecisionService` | 决策编排者（**不直接写 proposal 表**） |
| `CompanyService` + `company add\|list\|get` | 最小人工录入入口 |
| CLI：`research proposal list\|generate\|get\|confirm\|reject` | §12 |
| `subjectKeyForCompany(company)` | 唯一规范化 primitive（§7.4） |

### §4.2 Reuse（不改语义）

`ResearchPosition` 全字段 · `positionCoverage()` · `ResearchNeedService`（verbatim）· `ActiveRequirementResolver` · `TargetService`（**仅作为 confirm 的下游**）· `DiligencePreparationService.prepare()` · `ResearchPlanService.build()` 只读框架 · `compareGaps`/`compareTargets` · `ResearchRepository.transaction()` · `runtime/human-gate.ts` 的 **token 原语**（hash / single-use / scope / expiry）。

### §4.3 Extend

`ResearchPlanView` 增加只读 `proposals` 段（**不新增 Plan 身份或生命周期**）· `Company` 增加最小显式字段 `targetKinds[]`（§5.1）· `company` 表对应加列 `target_kinds_json`。

### §4.4 Forbidden（红线）

**既有红线（rev0/rev1）**

1. 禁止任何 `Position → ResearchTarget` 代码路径（**§2.4 不改**）
2. 禁止修改 `ResearchTarget.createdBy` 语义（恒为 `"user"`，且不得成为参数）
3. 禁止因 `Proposal.status = "proposed"` 而 materialize 为 ResearchTarget —— **只有 Human confirm 可调 `TargetService.add()`**
4. 禁止混用或互相映射 `TargetProposal.status` 与 `TargetStatus`
5. 禁止 Plan / Report 反向修改 Proposal / Target
6. 禁止 C5 v1 接入 Web / Wind / 企查查 / 天眼查 / 任何外部企业发现
7. 禁止把 `research_target` 当作 Company Universe
8. 禁止改动 `I-C2-17/22/24/25`、`I-C4-*` 与 C4 冻结面
9. 禁止 LLM 参与推荐事实（LLM 仅可在未来润色 `selectionReason` 措辞）
10. 禁止为 Plan 引入生命周期状态

**C5-R1…R5**

11. **R1 Proposal 不是事实**：`TargetProposal ≠ ResearchTarget ≠ DiligencePreparation ≠ KnowledgeBelief ≠ 研究事实`；confirm 前它只是"待人工决策的建议"
12. **R2 Recommendation / Persistence 分离**：禁止把 DB write 藏在 Recommendation Engine 内部
13. **R3 Confirm 是唯一 materialization path**：C5 新增路径中 `TargetService.add()` **只能**由 `ProposalDecision = confirmed` 触发（可静态审计）
14. **R4 Decision 不允许反转历史**：`proposed → confirmed | rejected`；`confirmed ─X→ rejected`、`rejected ─X→ confirmed`；重推须有新 revision 依据
15. **R5 Company Universe 与 Target 永久解耦**：`Company → Proposal → Human → Target` 单向；禁止 `Target → Universe`、禁止 `Target ∪ Company → Universe`

**Legacy 专项**

16. 禁止为复用 `selectionReason` 等字段而接入 P1 `TargetCandidate`；禁止把 `TargetCandidate` 表述为 `TargetProposal` 的旧名

**CLOSURE RULE（见 §7.5）**

17. 禁止任何影响 Proposal 持久化输出、却未被 `revisionInput` 覆盖的输入

---

## §5 SoT 矩阵与 Company kind

### §5.1 SoT（严格分层）

| 事实 | SoT |
|---|---|
| 候选企业事实 | `company`（人工录入） |
| **推荐建议** | **`target_proposal`** |
| **人的确认/拒绝决定** | **`target_proposal_decision`（append-only）** |
| 正式研究对象 | `research_target` |
| 调研准备 | `diligence_preparation` |
| 缺口 / active | `research_gap` + `ActiveRequirementResolver` |
| 认知 | `knowledge_belief` |
| 报告 | `report_snapshot` |

### §5.2 Company kind：多值（既有事实裁定）

`ResearchPosition.suggestedTargetKinds` 是**中文业务类型词表**（`domain/chain-template.ts:99-149`）：`["头部客户","标杆客户","大客户"]` / `["核心零部件供应商","关键材料供应商"]` / `["行业专家","技术专家","资深从业者"]` / `["同业公司","竞争厂商","新进入者"]` / `["咨询机构","行业研究机构","券商研究所"]` / `["渠道商","贸易商","经销商"]`。

`Company.chainPosition`（`domain/company.ts:10`，DB 列 `chain_position TEXT` nullable）**无取值域、零写入者**，**不可用作 kind**。

```text
company.target_kinds_json TEXT NOT NULL          // JSON 数组，例 ["标杆客户","大客户"]
匹配：intersection(company.targetKinds, position.suggestedTargetKinds).length > 0
```

`matchedTargetKinds` **持久化进 Proposal**（不留给下游重算）；`selectionReason` 主词取 **`position.suggestedTargetKinds` 数组顺序**下的第一个交集项（该顺序来自 chain template，稳定可复现）。

**禁止**用 `chain_position` 充当 kind；**禁止**字符串猜测或 LLM 映射。

---

## §6 Write Authority 矩阵

```text
Recommendation Engine ── pure / ZERO WRITE ──→ TargetProposalDraft[]
                                            （above: no DB mutation anywhere）
                                                     ↓
TargetProposalService ── persistence ──→ deterministic proposalId → insert-if-absent → target_proposal
```

| 对象 | 唯一写者 | 说明 |
|---|---|---|
| `target_proposal`（INSERT / **UPDATE status** / READ） | **`TargetProposalService`** | `transition()` 是唯一状态变更入口 |
| `target_proposal_decision`（append-only） | **`TargetProposalService`**（由 `ProposalDecisionService` 调用） | 表无 UPDATE / DELETE 路径 |
| `research_target` | **`TargetService`** | `createdBy` 硬编码 `"user"`，非参数 |
| `company` | `CompanyService` | — |
| **Recommendation Engine** | **无（零 mutation）** | — |
| Plan / Report | 无（只读投影） | — |
| Agent | 无 | — |

`ProposalDecisionService`：**编排者**（决定"人做了什么决定"），**自己不写 proposal 表**。

---

## §7 对象与身份模型

### §7.1 ProposalKey

```text
ProposalKey = (industryId, gapId, positionRef, companyId)
```

语义：**"针对这个 Gap，用这个 Position 推荐这个 Company"这一事实组合**。

### §7.2 recommendationRevision（确定性状态指纹，非计数器）

```text
revisionInput = {
  need.priorityScore, need.priorityPolicyVersionId,
  position.importance, position.suggestedTargetKinds, position.label,
  company.targetKinds,
  coveredRequirementRefs, unresolvedRequirementRefs,
  kindVocabularyVersion
}
recommendationRevision = stableHash(canonicalJson(revisionInput))
```

**`alreadyTargeted` 不在 `revisionInput` 内**：它是**候选资格/惩罚**信息（eligibility/penalty），**不是 identity input**。v1 中凡进入 Proposal 的候选恒有 `alreadyTargeted === false`（由 §10 Eligibility 保证）。

> 设计取舍：采用**状态指纹**而非 `revision++` 计数器 —— 计数器需要额外持久化状态，且无法在任意时刻重算出同一 id；指纹式满足"同输入永远同 id"。

| 场景 | 结果 |
|---|---|
| 同轮重复 generate（输入未变） | 同 revision ⇒ 同 proposalId ⇒ **exact no-op**（P11） |
| 研究状态实质变化 | 新 revision ⇒ 新 proposalId（R4 业务意图） |
| 仅"重推"（输入无变化） | **不产生新身份** |

### §7.3 proposalId

```text
proposalId = hash(ProposalKey, recommendationRevision)
```

### §7.4 `subjectKey` 的唯一规范化

```text
subjectKey(company) := trim(company.canonicalName)      // 唯一规范化定义
```

- 结果必须非空
- **Eligibility / Proposal 生成 / confirm 必须调用同一 primitive（`subjectKeyForCompany`）**，禁止各自 `.trim()`
- `targetRef` 仍由 `TargetService` 内部经 `targetRefFor(industryId, subjectKey)` 计算，C5 **不自行拼装**
- 因此 **`company.canonicalName` 变更会使新旧 identity 不同** ⇒ **C5 v1 不提供 Company rename**

### §7.5 CLOSURE RULE（元规则，可审计）

> **`TargetProposal` 持久化的每个字段，都必须是 `revisionInput` 的确定性函数；任何影响持久化输出、却未被 `revisionInput` 覆盖的输入，一律构成契约违规。**

**Proposal 持久化字段的完整清单**（CLOSURE RULE 的审计对象）：

| 字段 | 来源（均在 `revisionInput` 闭包内） |
|---|---|
| `proposal_ref` | `hash(ProposalKey, recommendationRevision)` |
| `industry_ref` / `gap_ref` / `position_ref` / `company_ref` | `ProposalKey` |
| `matched_target_kinds_json` | `company.targetKinds ∩ position.suggestedTargetKinds`（**不单独入 hash**，已被完整覆盖） |
| `position_importance` | `position.importance` |
| `covered_requirement_refs_json` / `unresolved_requirement_refs_json` | 派生自 `position.satisfies_requirement_refs ∩ need.requirementRefs` |
| `score` / `score_version` | `RECOMMENDATION_SCORE_V1`（§11.2） |
| `kind_vocabulary_version` | `revisionInput` |
| `recommendation_revision` | `stableHash(canonicalJson(revisionInput))` |
| `selection_reason` | 上述字段的 deterministic rendering（含 `position.label`） |
| `status` / `created_at` | **生命周期字段，豁免于 CLOSURE RULE** |

**明确不进入 Proposal**（读时派生，避免身份污染）：`dimension` / `dimensionLabel` / `position.kind` / `need.whyStudyNotJustFetch`。

### §7.6 `canonicalJson()` 规范（身份哈希的组成部分）

```text
object keys                → lexical sort（UTF-8 code point 序）
covered / unresolved refs  → lexical sort（两集合均排序）
array 顺序语义（显式声明）：
   position.suggestedTargetKinds → PRESERVE order（来自 chain template）
   company.targetKinds           → 排序后再入 hash（无顺序语义）
   matchedTargetKinds            → PRESERVE 其在 position.suggestedTargetKinds 中的相对顺序
numbers                    → 直接使用其「持久化字符串表示」（SQLite 原样读出，不重算/重格式化）
booleans                   → JSON true / false
null                       → 显式 null
strings                    → UTF-8 原样，不做 Unicode 规范化（不 NFC↔NFD 互转）
```

目的：杜绝 `{"a":1,"b":2}` 与 `{"b":2,"a":1}` 产生两个不同 `proposalId`。

---

## §8 Proposal 状态机与 confirm 事务

### §8.1 状态机

```text
                    ┌──────────────┐
                    │   proposed   │   ← 仅当 Company 在该 Industry 无正式 Target（§10）
                    └──────┬───────┘
              CAS transition（唯一入口）
                  ┌────────┴────────┐
                  ↓                 ↓
            ┌──────────┐      ┌───────────┐
            │ rejected │      │ confirmed │ ──(同事务)──→ TargetService.add()
            └──────────┘      └─────┬─────┘                      ↓
      confirmed ──X──→ rejected     │                     ResearchTarget
      rejected  ──X──→ confirmed    │
      proposed ──X──→ ResearchTarget（禁止跳过人）
      Position ──X──→ ResearchTarget（§2.4）
```

### §8.2 Decision 唯一性与并发

```text
语义：一个 Proposal ⟹ 至多一个终态 Decision（confirmed | rejected）

机制（两层保护）：
1) 表约束：target_proposal_decision 上 UNIQUE(proposal_ref)
   （v1 合法：R4 保证终态不可反转 ⇒ 一个 Proposal 不会有第二条 Decision）
2) 状态转换必须是 CAS，而不是 "SELECT → UPDATE" 两步：
   UPDATE target_proposal SET status = :next
    WHERE proposal_ref = :ref AND status = 'proposed'
   ⇒ changes === 1 才算成功；changes === 0 ⇒ 确定性冲突结果（already_decided）
```

并发结果（必须确定）：

```text
T1: confirm → CAS 成功 → 事务内 add Target → COMMIT
T2: confirm → CAS 失败（changes=0）→ already_decided
              ★ 绝不执行第二次 TargetService.add()、绝不写第二条 Decision
```

⇒ 不变量：**任意并发下，`research_target` 至多新增一行、`target_proposal_decision` 至多一行。**

### §8.3 confirm 事务顺序（**rollback CAS**）

```text
BEGIN
  1. 读取 Proposal
  2. CAS:  UPDATE target_proposal SET status='confirmed'
          WHERE proposal_ref=:ref AND status='proposed'
  3. changes === 0  → ROLLBACK → already_decided
  4. subjectKey := subjectKeyForCompany(company)      // §7.4
  5. targetRef  := targetRefFor(industryId, subjectKey)
  6. getTarget(targetRef) 已存在 → ROLLBACK → target_already_exists   ★
  7. appendDecision(confirmed)
  8. TargetService.add(...)
  9. COMMIT → confirmed
```

**三种结果互斥、无中间态**：

| 结果 | 条件 |
|---|---|
| `confirmed` + Target 落库 | status=`proposed` 且 Target 不存在 |
| `already_decided` | CAS 失败（并发或已终态） |
| `target_already_exists` | status=`proposed` 但 Target 已存在 ⇒ **ROLLBACK**；`proposal.status` 仍 `proposed`、`target_proposal_decision` 行数 0、**Target 未被 C5 修改** |

⇒ 第 6 步短路是必须的：`TargetService.add()` 并非"发现存在就什么都不做"，它会覆盖 kind/reason/purpose/`updatedAt`。
⇒ 依据：`ResearchRepository.transaction()` 已存在且已测。

### §8.4 confirm 幂等（基于代码事实，非假设）

```text
confirm(ref):
   p = getProposal(ref)
   if p.status === "confirmed" → EXACT NO-OP（返回既有决定性结果；不写 decision、不改状态、不调 add）
   if p.status === "rejected"  → 拒绝（终态不可反转，R4）
   else → §8.3 原子事务
```

| 代码事实 | 位置 | 对幂等的含义 |
|---|---|---|
| `targetRef = targetRefFor(industryId, subjectKey)` 确定性 | `target-service.ts:66`、`domain/research-target.ts:23-24` | 同 subject ⇒ 同 targetRef ⇒ **不可能产生第二行 Target** |
| `repo.upsertTarget()` = `INSERT OR REPLACE` | `research-repository.ts:651/654` | 存在性天然幂等 |
| `status = existing?.status ?? "proposed"`；`createdAt` 同理 | `target-service.ts:86/88` | 重复 add **不会重置**已确认对象的 lifecycle |
| ⚠️ `updatedAt` 与 kind/reason/purpose 会被覆盖 | `target-service.ts:89` | ⇒ **仍必须入口短路**，不可只靠 `add()` |

**强制不变量（可测）**：二次 confirm 后 `research_target` 行数不变、`target_proposal_decision` 行数不变、`target_ref` 不变、`proposal.status` 不变。

### §8.5 `proposal.status` 与 Decision history 的职责分离

```text
TargetProposalService  →  proposal.status  ← Proposal 的「当前状态」SoT（由 transition 写）
TargetProposalService  →  decision 表       ← 人的「决策历史」SoT（append-only，不可变）
```

**明确禁止**：`list decisions → 取 latest → 计算 proposal.status`。两者一致性由**同一事务**保证，**不靠反推**。

---

## §9 Human Gate 裁定：方案 2

> **采用独立 Research Proposal Decision；可复用 `runtime/human-gate.ts` 的 token 原语，但不得改变或扩展现有 `HumanGate` entity / `HumanGateKind` / task 语义。**

理由：现有 `HumanGate` 是 **Task Runtime** 语义（`task_id NOT NULL`；`kind = none | before_reserve | before_major_conclusion`）；C5 的确认是 **Research Planning Domain** 决策。若为复用而凭空创建 Task，即为"用技术设施污染领域语义"。⇒ **零影响既有 `MethodologyService`**。

---

## §10 Eligibility、Company Universe 与唯一性

### §10.1 Eligibility（候选资格）

```text
Eligible(industry, position, company) ⟺
      intersection(company.targetKinds, position.suggestedTargetKinds) ≠ ∅
  AND ResearchTarget(industryId, targetRefFor(industryId, subjectKeyForCompany(company))) 不存在
```

### §10.2 Company Universe 的 Industry scope

```text
CompanyUniverse(industryId) = { c ∈ company | c.primaryIndustryId === industryId }
```

- 依据：`Company.primaryIndustryId?: string`（`domain/company.ts:9`）、`primary_industry_id TEXT`（nullable，`research-db.ts:57`）、repository 已读写（`research-repository.ts:110/125`）
- `primaryIndustryId` 为 NULL ⇒ **不属于任何行业 ⇒ 不进入任何 Universe**
- **禁止** Engine 从全体 Company 仅凭 `targetKinds` 匹配
- **零新表**（不引入 `CompanyIndustryRelation`）

### §10.3 "一 Company 一 Proposal" 与唯一性作用域

```text
唯一性约束（持久化层强制，与 --gap 无关）：
  同一 (industryId, companyId) 至多存在一个「活跃」Proposal（status = 'proposed'）

生成规则：
  在通过 Eligibility 的 (gap, position) 组合中，只产生 一个 Proposal = score 最高者
  （tie-break：gapId ASC → positionRef ASC，全确定）
```

| 场景 | 行为 |
|---|---|
| `generate <industry>`（无 `--gap`） | 计算全部 eligible gap ⇒ 每 company 取 score 最高者 |
| `generate <industry> --gap G1` | `--gap` **仅是计算过滤器**，缩小本次范围 |
| `--gap G1` 之后 `--gap G2`，该公司已有 `proposed` | **不产生第二个 Proposal**（唯一性在持久化层，与计算范围无关） |
| 该公司已有 `confirmed` ⇒ 已有 Target | Eligibility 直接排除 |
| 该公司有 `rejected`，且研究状态**未变**（同 revision） | `insert-if-absent` ⇒ 不重推（与 R4 一致） |
| 该公司有 `rejected`，且研究状态**已变**（新 revision） | 允许**新** `proposalId`（唯一性已释放） |

⇒ 理由：`--gap` 只是过滤器，**不得改变唯一性语义**；否则 `--gap G1` 与 `--gap G2` 会各造一个 Proposal 去争同一个 Target。**此设计不需要任何额外状态。**

未来若需要"同一正式对象针对不同 Gap 的不同研究目的"，应新增 `ResearchTarget ↔ ResearchNeed` / Research Assignment 层 —— **C5 v1 不实现，也不偷偷解决**。

---

## §11 Recommendation Engine v1（确定性、可审计、零 LLM）

```text
输入（只读）：ResearchNeedService.list() · positionCoverage() · CompanyUniverse(industryId)
             · position.importance / suggestedTargetKinds / label
             · TargetService.list()（仅用于 eligibility 判定）
算法：
  for need in needs (sorted by compareGaps):
    for positionRef in need.suggestedPositionRefs (in order):
      for company in CompanyUniverse(industryId) where Eligible(...):
        covered    := position.satisfies_requirement_refs ∩ need.requirementRefs
        unresolved := 其中仍 active 的部分
        draft      := TargetProposalDraft{ proposalId = hash(ProposalKey, recommendationRevision), ... }
  每个 (industryId, companyId) 只保留 score 最高者
```

### §11.1 `selectionReason` 的 provenance（结构化优先）

Proposal 同时持久化结构化事实，`selectionReason` 只是它们的 deterministic rendering：

```text
matchedTargetKinds · positionImportance · coveredRequirementRefs · unresolvedRequirementRefs
· alreadyTargeted · scoreVersion · selectionReason
```

渲染模板（每分句 1:1 对应一个持久化字段）：

> 「该企业属于 Position「{label}」要求的 {matchedTargetKinds[0]} 类型；该 Position 对当前行业研究的重要度为 {positionImportance}；能够覆盖当前 Gap 对应的 {|coveredRequirementRefs|} 个 Information Requirements，其中 {|unresolvedRequirementRefs|} 个尚未解决。」

⇒ 未来 LLM 只能在 `selectionReason` 之上做**措辞润色**，不得改变任何结构化字段。

### §11.2 Score（固定 + 版本化）

```text
RECOMMENDATION_SCORE_V1  (version = "rec-v1"，整数权重，不可由实现者改动)
  score = 100 * importance
        +  10 * |coveredRequirementRefs|
        +  15 * |unresolvedRequirementRefs|
        -  25 * (alreadyTargeted ? 1 : 0)      ← v1 中该项恒 0（§10.1 Eligibility 保证）
排序：score DESC → tie-break: positionRef ASC → companyRef ASC（全确定，无随机）
```

> **语义澄清（必须写入实现）**：`unresolvedRequirementRefs` 的**正权重**代表**"研究价值 / 信息缺口价值"**（越未知越值得调研），**不是"当前完成度"**。实现者不得因"未解决项多"而改为扣分。

---

## §12 CLI 契约

```text
research proposal list [industry]
research proposal generate <industry> [--gap <gapRef>]
research proposal get <proposalRef>
research proposal confirm <proposalRef>
research proposal reject <proposalRef>
```

| 命令 | 语义 |
|---|---|
| `generate` | `CLI → Recommendation Engine(pure) → Draft[] → TargetProposalService → persist`；**受控人工作业入口，会持久化 Proposal** |
| `list` / `get` | 只读 |
| `confirm` | `ProposalDecisionService` → §8.3 原子事务 → `TargetService.add(createdBy="user")` |
| `reject` | `ProposalDecisionService` → `appendDecision(rejected)` + `transition(rejected)` |

> **★ 关键区分**：**`Recommendation Engine` 零写入 ≠ `research proposal generate` 零写入。**

- CLI 可行业级批量；**Proposal 身份始终是 Gap 级**（`ProposalKey` 含 `gapId`）
- `--gap` 只是计算过滤器（§10.3）
- **C5 v1 不允许任意扩展复杂筛选参数**
- 参数守卫沿用 C4-B 风格：仅接受白名单参数，其它 `--xxx` ⇒ usage error

---

## §13 Legacy 对齐裁决

| Legacy 对象 | 处置 |
|---|---|
| `TargetCandidate` / `ScreeningRun` / `ScreeningRule` / `TargetDecision` / `CompanyIndustryRelation` | **不删除、不建表、不接 service、不接 CLI、不迁数据、不做字段映射、不做状态映射**；在注释 / 架构文档标注 `P1 legacy · contract-only · superseded by C5 TargetProposal · not part of active runtime` |

- `TargetCandidate` 与 `TargetProposal` **不是同一个 domain object 的改名**（前者带 `screeningScore` / `evidenceIds` / `risks` / `whyNow` / `ScreeningRun` 的 Screening 设计，状态机为 `eligible|selected|rejected`）
- `CompanyIndustryRelation`：**C5 v1 OUT**，保留原样零引用

---

## §14 阶段拆分

| 阶段 | 交付 | 边界 |
|---|---|---|
| **C5-A** | `CompanyService`（含 `targetKinds`）+ `TargetProposal` + `TargetProposalService` + Recommendation Engine + `research proposal generate\|list\|get` | **不创建正式 Target**；❌ confirm ❌ reject ❌ Diligence |
| **C5-B** | `ProposalDecisionService` + `target_proposal_decision` + `research proposal confirm\|reject` + 接 `TargetService.add` | 锁 R1/R3/R4 + §8 |
| **C5-C** | `ResearchPlanService.build()` 只读扩展（Gap → Position → Proposal → Target → Diligence） | **不赋予 Plan 生命周期** |
| **C5-D** | 真实 E2E（临时 SQLite 库）：Company → Gap → Position → Proposal → **Reject** / 另一 Proposal → **Confirm** → Target → Diligence → Material → Knowledge Evolution → Gap → **下一轮 Proposal** | 隔离环境，不触碰生产库 |

---

## §15 不变量（全部可测）

| # | 不变量 |
|---|---|
| P1 | Proposal 不制造 Knowledge |
| P2 | 只消费 persisted Knowledge / Gap |
| P3 | Proposal 不自动成为 Target |
| P4 | 用户未确认的 Proposal 不进入正式研究对象 |
| P5 | Diligence 可追溯到 Target |
| P6 | Target 可追溯到 Position |
| P7 | Proposal 可追溯到 Gap + Position + Company |
| P8 | Material 回流不覆盖 Plan 历史 |
| P9 | 重新生成 Plan / Proposal 幂等 |
| P10 | Report 不反向修改 Proposal |
| P11 | 同一 `(ProposalKey, recommendationRevision)` ⇒ 同 `proposalId`；同 revision 重复生成 = **exact no-op** |
| P12 | **Recommendation Engine 零写入**：执行前后「当前 schema 中所有持久化表」的内容指纹完全一致（**不写死表数**） |
| P13 | `confirm` 是产生 `research_target` 的唯一路径；`createdBy === "user"` |
| P14 | 两状态机隔离：`TargetProposal.status` 与 `TargetStatus` 不互相 materialize |
| P15 | Company Universe 只来自人工录入 + `primaryIndustryId` scope；`research_target` 不参与 Universe |
| R1 | confirm 前 Proposal 不出现在任何"已确认 / 研究事实"视图，也不产生 Diligence |
| R2 | 静态审计：Engine 源文件中无 DB 写调用 |
| R3 | 静态审计：C5 路径下 `TargetService.add(` 的唯一调用点 = proposal confirm 分支 |
| R4 | 终态决策不可反转；重推须有新 revision 依据 |
| R5 | Universe 计算不读 `research_target` |
| CLOSURE | 改变 `revisionInput` 的任一分量 ⇒ `proposalId` 必变；不变动任何分量 ⇒ `proposalId` 必不变 |
| 新 | 任意并发下 `research_target` 至多新增 1 行、`target_proposal_decision` 至多 1 行 |
| 新 | 二次 confirm：`research_target` 行数不变、decision 行数不变、`target_ref` 不变、`status` 不变 |

---

## §16 验收矩阵（骨架，每条须有"故意破坏 ⇒ 转红"证据）

| 用例 | 内容 |
|---|---|
| T-C5-1 | Draft → persist 幂等（同 revision 重复 generate ⇒ no-op） |
| T-C5-2 | Engine 零写入（全表动态指纹前后一致） |
| T-C5-3 | `selectionReason` 每分句可溯源到持久化字段 |
| T-C5-4 | confirm ⇒ Target 落库且 `createdBy === "user"` |
| T-C5-5 | reject ⇒ 无 Target + decision 入库 |
| T-C5-6 | R1：未确认 Proposal 不进"已确认"区、无 Diligence |
| T-C5-7 | R4：终态不可反转；新 revision 才产生新 id |
| T-C5-8 | R5 + §10.2：Universe 不读 target、且按 `primaryIndustryId` 限定 |
| T-C5-9 | §2.4 静态审计：`Position → ResearchTarget` 路径仍为零 |
| T-C5-10 | Agent 侧零写 |
| T-C5-11 | CLI 参数白名单（沿用 C4-B 风格） |
| T-C5-12 | `target_already_exists` ⇒ ROLLBACK，三处状态均未变 |
| T-C5-13 | 并发双 confirm ⇒ 恰一个成功；`target_proposal_decision` ≤ 1 行 |
| T-C5-14 | CLOSURE：逐分量扰动 ⇒ `proposalId` 必变 |
| T-C5-15 | §10.3 唯一性：`--gap G1` 后再 `--gap G2`（同 company）⇒ 不产生第二个活跃 Proposal |
| T-C5-16 | 全链 E2E（C5-D） |

---

## §17 OUT（C5 v1 明确不做）

外部企业发现（Web / Wind / 企查查 / 天眼查）· LLM 参与推荐决策 · Plan 生命周期 · Report 扩张为 Plan 容器 · Agent 写权限 · 自动选择唯一 Target · Company 数据平台化 · `CompanyIndustryRelation` / P1 Screening 系列 · 同一 Target 的多 Need 研究目的（`ResearchTarget ↔ ResearchNeed` / Research Assignment）· Company rename · 修改 §2.4 / `createdBy` / C2·C4 冻结面。

---

## §18 裁定记录（已关闭）

| # | 议题 | 裁定 |
|---|---|---|
| 1 | Human Gate 1 vs 2 | **方案 2：Research Proposal Decision**（仅复用 token 原语） |
| 2 | `CompanyIndustryRelation` | **C5 v1 OUT**，保留原样零引用 |
| 3 | Proposal 审计 | **独立 append-only `target_proposal_decision`** |
| 4 | P1 遗留 | **保留原样 + legacy/superseded 标记 + 零生产引用 + 禁止字段复用** |
| 5 | Proposal CLI | **`research proposal`**；行业批量入口、Proposal Gap 级建模 |
| 6 | Company 列 | `chain_position` 与 kind **不兼容**（代码事实）⇒ **新增 `company.target_kinds_json`** |
| 7 | `recommendationRevision` 实现 | **状态指纹**（非计数器） |
| 8 | "一 Company 一 Proposal" | **接受**（v1 收紧） |
| 9 | `subjectKey` 映射 | **`trim(company.canonicalName)`**，唯一 primitive |
| 10 | `--gap` 作用域 | 唯一性为**全 Industry 级**，`--gap` 仅计算过滤器 |

---

**End of contract（rev4）.** 任何实现必须逐条对齐本文件；若需偏离，须先修订本契约。

---

# §19 rev5 — C5-B Implementation Contract（Proposal Decision / Human Gate）

> 状态：**rev5.1 — APPROVED / READY TO FREEZE.**
> 父基线：**C5-A 已发布基线**（`a1bba24` 契约 / `f4e48b2` 生产 / `e921147` 测试，均在 `origin/main`）。
> **未经单独授权，不得开始 C5-B 实现。**

## §19.0 修订历史

| 版本 | 变更 |
|---|---|
| rev5 | 首版 C5-B 契约：Decision 对象 / decision 表 / partial unique index / 两类并发 / CAS / 事务 |
| **rev5.1** | 修 4 处：① **废止 `INSERT OR REPLACE`**（BLOCKER）② `operator` 在 confirm/reject **均 required** ③ **同一事务上下文**不变量 ④ 并发验收强化 + `INSERT OR REPLACE` **防回归静态断言** |

## §19.1 C5-A 已发布基线**不可回改**

```text
f4e48b2（生产）/ e921147（测试）已 push 到 origin/main
⇒ 禁止 amend / rebase / squash / 追加 "C5-A fix" commit / 重写历史
```

**唯一例外**：C5-B **允许**修改 `application/target-proposal-service.ts` 与 `storage/research-repository.ts` 的 **Proposal 创建 primitive**，定性为「**C5-B 为建立数据库并发不变量而对 persistence primitive 的安全升级**」，**不是**修补 C5-A 缺陷。硬边界见 §19.8。

## §19.2 C5-B 新增对象

| 新增 | 定义 |
|---|---|
| `ProposalDecisionKind` | `"confirmed" \| "rejected"` |
| `ProposalDecision` | `{ proposalRef, kind, operator, comment?, decidedAt }` |
| **`target_proposal_decision` 表** | append-only；**`proposal_ref TEXT PRIMARY KEY`**（**不引入 `decisionRef`**；`Proposal 1 : Decision 0..1`）；**无 UPDATE / DELETE 路径** |
| `ProposalDecisionService` | **编排者**：`confirm(ref, operator, comment?)` / `reject(ref, operator, comment?)`；**自己不写 `target_proposal`** |
| `TargetProposalService.transition(ref, next, ctx)` | **唯一** `target_proposal` 状态写者；**CAS 实现** |
| CLI | `research proposal confirm\|reject <proposalRef> --operator <name> [--comment <text>] [--json]` |

## §19.3 partial unique index（数据库不变量）

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_active_subject
  ON target_proposal(industry_ref, company_ref)
  WHERE status = 'proposed';
```

**不变量**：同一 `(industry_ref, company_ref)` **至多一个** `status='proposed'`。
与 §10.3 **不冲突**：`confirmed` / `rejected` 不在索引谓词内 ⇒ "`rejected` 后新 revision 可重推" 继续成立。

## §19.4 两类并发必须**分开设计**

| 场景 | 正确机制 |
|---|---|
| 两个生成器同时为同一 Company 建 Proposal | **partial unique index + 确定性冲突恢复**（§19.5） |
| 两个操作者同时 confirm 同一 Proposal | **CAS**（`UPDATE … WHERE status='proposed'`） |
| confirm 与 reject 竞争 | 一个成功，另一个 **`already_decided`** |
| confirm 与 Target 创建竞争 | **同一事务**（§19.6） |
| Target 已存在 | **ROLLBACK**，Proposal 不变（`target_already_exists`） |

## §19.5 生成竞争的确定性处理（**废止 `INSERT OR REPLACE`**）

**为什么必须废止（SQLite 语义）**：
```text
INSERT OR REPLACE 命中约束 ⇒ 不抛错 ⇒ DELETE 冲突行 + INSERT 当前行
  ⇒ 与 partial unique index 组合后，竞争会「静默覆盖赢家」
  ⇒ 直接破坏 §10.3「竞争 ⇒ skippedActiveExists」的语义
```

**契约条款**：

```text
① 禁止在任何 Proposal 创建路径使用 INSERT OR REPLACE。
② Repository primitive 升级：
     upsertTargetProposal(...)  ⇒  重命名为 insertTargetProposal(...)
       SQL: INSERT OR REPLACE INTO target_proposal …   ⇒   INSERT INTO target_proposal …
     唯一调用点是 TargetProposalService.persistDrafts（C5-B 一并更新）。
   ★ 这是 §19.1 允许的安全升级：proposalRef / score / selectionReason / revisionInput /
     Engine 输出全部不变；串行 persistDrafts 的业务结果不变（3 层提前跳过逻辑完全保留）。
   ★ 状态变更（transition）不走该 primitive，而走独立的 CAS UPDATE（§19.6）。
③ 冲突识别必须**双重校验**，不得只依赖脆弱的错误字符串匹配：
     SQLite UNIQUE error
        ↓ 确认属于 target_proposal
        ↓ 确认对应 active-subject 唯一约束（驱动能提供 constraint/index 信息则直接利用）
        ↓ 重读 (industry_ref, company_ref) 的 active proposal
        ↓ 存在 ⇒ skippedActiveExists += 1（确定性业务结果，不抛错）
   ★ 其它任何 SQLite 错误（普通 UNIQUE / NOT NULL / FK / 其它）**必须原样抛出**，不得被吞。
④ 既有顺序不变：getTargetProposal(ref) 命中 ⇒ skippedSameRef；
   listTargetProposals(industry,"proposed").some(companyRef) ⇒ skippedActiveExists；随后才 INSERT。
   ⇒ 纯 INSERT 的附带收益：createdAt 不再可能被 REPLACE 覆盖。
⑤ PersistProposalsResult 字段集合不变（复用 skippedActiveExists）。
```

## §19.6 Decision CAS 与**同一事务上下文**

```text
reject()（rev4 §8.3 只写了 confirm，本版补齐）：
  BEGIN
    1. 读 Proposal
    2. CAS: UPDATE target_proposal SET status='rejected' WHERE proposal_ref=? AND status='proposed'
    3. changes === 0 → ROLLBACK → already_decided
    4. appendDecision(rejected, operator, comment?)
    5. COMMIT → rejected

confirm()：rev4 §8.3 的 9 步（subjectKeyForCompany → targetRefFor → getTarget 存在则
  ROLLBACK / target_already_exists → appendDecision(confirmed) → TargetService.add() → COMMIT）不变。

★ 同一事务上下文不变量：
   CAS / decision INSERT / Target INSERT 必须全部经由
   **同一个 ResearchRepository 实例 = 同一个 DatabaseSync 连接**。
   实现约束：
     - ProposalDecisionService 构造时接收 DatabaseSync；
     - 事务内只用一个 repo 实例贯穿：repo.transaction(() => { … })；
     - TargetService 必须用同一个 db 构造（new TargetService(this.db)）；
     - 禁止在事务中 new 第二个 DatabaseSync / 第二个 repo；
     - 禁止嵌套 repo.transaction()（BEGIN 会失败）。

★ 核心不变量（任一失败 ⇒ ROLLBACK）：
     Proposal = proposed（保持原状） · Decision = 0 行 · Target = 未被 C5 修改

★ 幂等（两个 verb 都适用）：入口先读 ⇒ confirmed / rejected ⇒ exact no-op 或确定性终结结果；
  终态不可反转（R4）。
```

## §19.7 `operator` 契约（confirm / reject **均 required**）

```text
research proposal confirm <proposalRef> --operator <name> [--comment <text>] [--json]
research proposal reject  <proposalRef> --operator <name> [--comment <text>] [--json]

operator:
  - required（缺失 ⇒ usage error，退出码 1）
  - trim 后不得为空（空 / 纯空白 ⇒ usage error）
  - 不得默认 "user"；不得由系统自动填充
  - 白名单：confirm / reject ⇒ allowed = ["--operator", "--comment", "--json"]
```

## §19.8 C5-A 行为必须**完全不变**的清单

```text
① Engine 输出（drafts / proposalRef / score / selectionReason）逐字不变
② proposalRef 公式与 revisionInput 9 项不变
③ CLI `company add|list|get`、`proposal generate|list|get` 的输出与退出码不变
④ `--gap` 仍只是计算过滤器
⑤ persistDrafts 的串行行为不变（C5-A 既有 28 + 9 测试继续全绿）
⑥ per-verb 白名单不变（不得新增 --status）
```

## §19.9 C5-B 明确**禁止**

```text
❌ amend / rebase / squash C5-A 提交
❌ 改变 C5-A 推荐计算语义（Engine / revisionInput / score / reason）
❌ Agent 侧获得任何写权限（confirm/reject 只走 CLI 人工路径）
❌ 生成后自动 confirm / 自动 materialize Target
❌ 跳过 Human Decision 直接建 ResearchTarget（§2.4 / R3）
❌ decision 表的 UPDATE / DELETE；`list decisions → 反推 proposal.status`
❌ 让 UNIQUE 冲突或其它 SQLite 异常冒泡为未处理错误（吞错仅限 §19.5③ 的特定冲突）
❌ 在同一事务内嵌套调用另一个事务；跨连接拼装"同一事务"
❌ 改动 Plan / Diligence / Report / C2·C4 冻结面
❌ CLI 暴露 `--status`
```

## §19.10 预计文件清单

**新增** ① `application/proposal-decision-service.ts` ② `phase-c5-b.test.ts` ③ `src/cli/phase-c5-b-cli.test.ts`
**修改** ④ `domain/target-proposal.ts`（+Decision 类型） ⑤ `domain/index.ts` ⑥ 包 `index.ts` ⑦ `storage/research-db.ts`（+decision 表 + partial index） ⑧ `storage/research-repository.ts`（+decision CRUD、+CAS transition、`upsertTargetProposal`→`insertTargetProposal`） ⑨ `application/target-proposal-service.ts`（+`transition()`、+冲突恢复） ⑩ `src/cli/research-commands.ts`（+confirm/reject verb + 白名单） ⑪ `src/cli/research-format.ts`（+decision 渲染）

## §19.11 不变量与验收

| 用例 | 内容 |
|---|---|
| T-C5-B-1 | confirm ⇒ Target 落库且 `createdBy === "user"`；Proposal 变 `confirmed` |
| T-C5-B-2 | reject ⇒ 无 Target、decision 入库、Proposal `rejected` |
| T-C5-B-3 | 二次 confirm / confirm 后 reject / reject 后 confirm ⇒ **确定性终结结果**（R4） |
| T-C5-B-4 | `target_already_exists` ⇒ **ROLLBACK**：Proposal 仍 `proposed`、decision 0 行、Target 未被 C5 修改 |
| **T-C5-B-5** | 并发双 confirm：① 恰一个 `confirmed` ② 另一个 `already_decided` ③ `status=confirmed` ④ decision **exactly 1** ⑤ `research_target` 至多新增 1 ⑥ **两个调用均无未处理异常** ⑦ 三者状态一致 |
| T-C5-B-6 | partial index 不变量：同 `(industry, company)` 至多一个 `proposed` |
| **T-C5-B-7** | generate 竞争：① 最终 active Proposal exactly 1 ② **先持久化者未被覆盖**（逐字段比对） ③ 后者得 `skippedActiveExists` ④ 不产生第二行 active ⑤ 非 unique 异常继续抛出 ⑥ **静态断言：Repository 源码不存在 `INSERT OR REPLACE INTO target_proposal`** |
| T-C5-B-8 | C5-A 回归：既有 28 + 9 测试全绿；Engine 输出逐字不变 |
| T-C5-B-9 | R1：未确认 Proposal 不进任何"研究事实"视图，也不产生 Diligence |
| T-C5-B-10 | 静态审计：`TargetService.add(` 在 C5 代码中的唯一调用点 = confirm 分支 |
| T-C5-B-11 | `--operator` 缺失 / 空白 ⇒ usage error；confirm 与 reject 对称 |

## §19.12 裁定记录（已关闭）

| # | 议题 | 裁定 |
|---|---|---|
| 1 | C5-A 历史提交 | **不可回改**（不 amend / 不追加 fix / 不重写） |
| 2 | C5-B 可否改 `target-proposal-service.ts` | **可以**（persistence primitive 安全升级，不得改推荐计算语义） |
| 3 | partial unique index | **必须加入** |
| 4 | 唯一冲突处理 | **确定性业务结果**（不冒异常） |
| 5 | `INSERT OR REPLACE` | **C5-B 废止**（会导致静默覆盖赢家） |
| 6 | `operator` | **confirm / reject 均 required**，trim 非空，不默认 |
| 7 | `decisionRef` | **不需要**（`proposal_ref` 作 PRIMARY KEY） |
| 8 | 事务边界 | CAS / Decision / Target **同一 Repository / 同一连接 / 同一事务上下文** |
| 9 | status 与 decision SoT | `proposal.status` = 当前状态 SoT；decision 表 = append-only 审计；**禁止反推** |
| 10 | 冲突识别 | **双重校验**（constraint 信息 + 冲突对象重读）；其它错误必须抛出 |

**End of contract（rev5.1）.**

---

# §20 rev6.1 — C5-C Implementation Contract（Research Plan 只读消费 Proposal）

> 状态：**rev6.1 — CONTRACT LOCK PASS.** 父基线：`4c5db64`（C5-B 已发布）。
> **C5-C Implementation / Commit / Push 均未授权。**

## §20.0 修订历史

| 版本 | 变更 |
|---|---|
| rev1–rev5.1 | C5-A / C5-B（已发布：`a1bba24` / `05f1800` / `f4e48b2` / `e921147` / `dd07538` / `4c5db64`） |
| rev6 | 首版 C5-C：`ResearchPlanService.build()` 只读消费 Proposal + Decision；D1–D4 |
| **rev6.1** | 融入 C-FIX-C-1…4 + SoT-first 措辞修正 + D5 裁定（`companyName` KEEP） |

## §20.1 C5-C 定位

> **Plan 是 Proposal/Decision 的消费者，不是第二套 Recommendation / Decision Engine。**

```text
C5-A            C5-B                        C5-C
推荐计算   →   Human Gate 决策/物化   →   Plan 只读编排视图
（已冻结）      （已冻结）                    （本阶段）
```

## §20.2 目标链（全链只读）

```text
Gap → Position → TargetProposal（C5-C 新增）→ 已确认 Target → Diligence
                      └ Decision（C5-C 新增，只读）
```

## §20.3 D1–D5 裁定（LOCKED）

| # | 裁定 |
|---|---|
| **D1** | **两层**：可归属的 Proposal 挂 `gap.positions[].proposals[]`；其余进 `ResearchPlanView.orphanProposals[]` ⇒ **never hidden** |
| **D2** | `proposed / confirmed / rejected` **三态全部展示**，必须显式 `status` |
| **D3** | 只读展示 `decision`（`kind` / `operator` / `comment?` / `decidedAt`）；**无 Decision ⇒ `null`，不得伪造** |
| **D4** | Proposal 时间 = **`proposedAt`**；Decision 时间 = **`decidedAt`**；**Plan DTO 禁止字段名 `createdAt` / `updatedAt`** |
| **D5** | **保留 `companyName`**（`CompanyService.list()` 只读展示字段） |

### §20.3.1 `attachable` — 精确定义（C-FIX-C-1，硬红线）

```text
Attachable(proposal) ⟺
      ∃ gap ∈ view.gaps                      （仅限 build() 已发出的 gap）
            proposal.gapRef === gap.gapId
        AND
      ∃ position ∈ gap.positions             （仅限该 gap 内已发出的 position）
            proposal.positionRef === position.positionRef

Otherwise ⇒ view.orphanProposals[]
```

**判定只使用「已被 `build()` 发出的」gap / position** —— 不是另行从 DB 查出的 gap/position；两个条件**必须同时成立**。
⇒ **禁止**「gap 存在就算归属」。四种情况**一律** orphan：

```text
① Gap 未发出（closed / 不再 active）
② Position 未发出（不在当前 projection）
③ Position 存在但不在该 gap 内（跨 gap）
④ gapRef / positionRef 无法解析
```

**never hidden**：Proposal 是**已持久化的研究推荐记录**，不得因上述任一原因从 Plan 消失。

## §20.4 字段级冻结（C5-C）

```ts
/** C5-C: the plan's read-only view of ONE decision record. Never inferred — always persisted. */
export interface ResearchPlanDecision {
  kind: "confirmed" | "rejected";
  operator: string;
  comment?: string;
  decidedAt: string;
}

/** C5-C: the plan's read-only view of ONE proposal. NOT a Proposal SoT, no identity of its own. */
export interface ResearchPlanProposal {
  proposalRef: string;
  industryRef: string;
  gapRef: string;
  positionRef: string;
  companyRef: string;
  /** D5: Company Universe 的展示字段（CompanyService.list，只读）。不是 Proposal 的新 SoT，
   *  不得用于重算 eligibility / score / selectionReason / proposalRef 或任何 Proposal 持久化语义。 */
  companyName: string;
  matchedTargetKinds: string[];
  positionImportance: number;
  coveredRequirementRefs: string[];
  unresolvedRequirementRefs: string[];
  score: number;
  scoreVersion: string;
  kindVocabularyVersion: string;
  recommendationRevision: string;
  selectionReason: string;
  status: "proposed" | "confirmed" | "rejected";
  /** ★ named `proposedAt` on purpose — the DTO must never carry `createdAt` / `updatedAt`. */
  proposedAt: string;
  /** ★ `proposed ⇒ null`. Never synthesize a decision from `status`. */
  decision: ResearchPlanDecision | null;
  /** ★ Only when the persisted ResearchTarget actually EXISTS; otherwise null. */
  targetRef: string | null;
}

export interface ResearchPlanPosition {
  …（C2 既有字段不变）
  proposals: ResearchPlanProposal[];        // ← C5-C 新增
}

export interface ResearchPlanView {
  …（C2 既有 6 个字段不变）
  orphanProposals: ResearchPlanProposal[];  // ← C5-C 新增（never hidden）
}
```

**确定性顺序（C-FIX-C-4，冻结为实现契约）**：

```text
proposals[] 与 orphanProposals[] 的排序：
    score DESC → proposalRef ASC

★ 只读取已持久化的 score / proposalRef，不重算、不新增排序语义
★ 不得依赖数据库当前返回顺序（它不构成业务语义）
```

配套：`domain/research-plan.ts` 新增纯函数 `compareProposals`（与既有 `compareGaps` / `compareTargets` / `compareNextActions` 同形）。

**保持不动**：`ResearchPlanState` / `ResearchPlanFit` / `ResearchPlanPreparation` / `ResearchPlanTarget` / `ResearchPlanGap` / `ResearchPlanNextAction` 全部原样。

## §20.5 两条硬红线

### 红线 1：`confirmed ≠ Target`（C-FIX-C-2 + SoT-first 措辞）

```text
Proposal.status = "confirmed"
   ⇒ 该 Proposal 已通过 C5-B 的 confirm transition（持久化事实）
   ⇒ ★ 不据此推断 Target 当前存在

Target existence 必须独立只读验证：
    targetRef := targetRefFor(proposal.industryRef, subjectKeyForCompany(company))
    TargetService.get(targetRef) 存在  ⇒ 输出该 targetRef
    TargetService.get(targetRef) 不存在 ⇒ targetRef = null

★ 禁止把「可推导的 identity」展示成「已有 Target」：
    能算出一个 targetRef  ≠  该 Target 存在
★ 禁止 Plan 创建 / 补建 / 修复 ResearchTarget
★ 只看当前持久化事实，不依赖 materialisation 的历史叙事（SoT-first）
```

### 红线 2：复用查询，绝不自建 Proposal 查询/解释层

```text
ResearchPlanService
   ├── TargetProposalService.list(industryRef)           ← 唯一 Proposal 读取入口
   ├── ResearchRepository.getTargetProposalDecision(ref) ← 唯一 Decision 读取入口
   ├── TargetService.get / list                          ← 既有的只读入口
   └── CompanyService.list                               ← 既有的只读入口（companyName）
```

**禁止**在 `research-plan-service.ts` 内出现 `FROM target_proposal` / `FROM target_proposal_decision` 或任何自拼的 Proposal SQL。

## §20.6 CLI（语义不变，只增展示）

```text
research plan <行业>
research plan <行业> --json
```

- **不新增** flag、**不改**既有 flag 语义、**不改**退出码；
- `--json` 结构**新增** `orphanProposals` 与 `positions[].proposals`（向后兼容的字段新增）；
- human 渲染新增提案段（`status` 显式；`decision` 缺失时显示「尚无决策」，**不伪造**）。

## §20.7 `build()` call-chain（文档冻结）

```text
ResearchPlanService.build(industryId)   ← one read-only build path（仍是唯一）
  ├── repo.getIndustry / getStateBySubject / listNextActions / getActiveMethodology
  ├── ResearchNeedService.list
  ├── ChainProjectionService.positionCoverage / listProjectedPositions
  ├── TargetService.list / get
  ├── QuestionTargetFitService.summarize
  ├── DiligencePreparationService.list
  ├── TargetProposalService.list                    ← C5-C 新增（只读）
  ├── ResearchRepository.getTargetProposalDecision ← C5-C 新增（只读）
  └── CompanyService.list                           ← C5-C 新增（只读，companyName）
```

> **one build path remains one read-only build path.**

## §20.8 明确禁止项（20 条，原文冻结）

```text
✗ 不创建 Plan 表                          ✗ 不创建 Plan ID
✗ 不增加 Plan createdAt / updatedAt        ✗ 不增加 Plan status / version
✗ 不增加 Plan save / upsert                ✗ 不写 target_proposal
✗ 不写 target_proposal_decision            ✗ 不调用 ProposalDecisionService.confirm()
✗ 不调用 ProposalDecisionService.reject()  ✗ 不调用 TargetService.add()
✗ 不创建 ResearchTarget                    ✗ 不修改 ResearchGap
✗ 不修改 Knowledge                         ✗ 不修改 ResearchState
✗ 不重新计算 Gap → Position                ✗ 不重新计算 Position → Proposal eligibility
✗ 不重新计算 Proposal score                ✗ 不改变 C5-A/B Proposal / Decision / Human Gate 语义
✗ Plan DTO 中不得出现字段名 createdAt / updatedAt（任何位置，不只行首）
✗ 不得在 Plan 内自建 Proposal / Decision 查询（必须复用 Service / Repository 入口）
```

## §20.9 T-C5-C 验收矩阵

| # | 用例 | 覆盖 |
|---|---|---|
| T-C5-C-1 | 可归属 Proposal 出现在对应 `gap.positions[].proposals[]` | D1 / §20.3.1 |
| **T-C5-C-2a** | Gap 不再被发出（closed / 不再 active）⇒ proposal ∈ `orphanProposals[]` | D1 never hidden |
| **T-C5-C-2b** | Gap 仍发出，但该 Position 不再出现在 projection ⇒ ∈ `orphanProposals[]` | D1 never hidden |
| **T-C5-C-2c** | `gapRef` / `positionRef` 无法解析 ⇒ ∈ `orphanProposals[]` | D1 never hidden |
| **T-C5-C-2d** | `proposals[]` 与 `orphanProposals[]` 均满足 `score DESC → proposalRef ASC` | C-FIX-C-4 |
| T-C5-C-3 | 三态全部展示且 `status` 显式 | D2 |
| T-C5-C-4 | `proposed ⇒ decision === null`（**不伪造**） | D3 |
| T-C5-C-5 | `confirmed` / `rejected` ⇒ decision 逐字段等于持久化记录（含 `kind`） | D3 |
| T-C5-C-6 | **Confirmed ≠ Target**：`confirmed` 但 Target 不存在 ⇒ `targetRef === null`，且**不创建** Target | §20.5 红线 1 |
| T-C5-C-7 | `build()` 零写：**全表动态指纹**前后一致（含连续两次 build） | §20.8 / I-C2-22 |
| T-C5-C-8 | 幂等：两次 `build()` **deepEqual**（数组顺序亦确定） | I-C2-17 |
| T-C5-C-9 | **静态**：`research-plan-service.ts` 不含 `FROM target_proposal`，且含 `TargetProposalService` | §20.5 红线 2 |
| T-C5-C-10 | **静态**：Plan DTO 声明中不含字段名 `createdAt` / `updatedAt`（**全局正则**） | D4 |
| T-C5-C-11 | C2 回归：既有 Plan 测试全绿 + `T-C3-22b` 表集合不变 | 冻结面 |
| T-C5-C-12 | CLI：`research plan` 与 `--json` 展示提案段；无决策时显示「尚无决策」 | §20.6 |

## §20.10 与 C2 / C4 / C5-A / C5-B 冻结面的冲突检查

| 冻结面 | 影响 | 判定 |
|---|---|---|
| `I-C2-17` 幂等 | 新增字段来自**持久化常量**（`proposedAt`/`decidedAt` 存于 DB，非新生成）；顺序由 `compareProposals` 确定 | ✅ 不冲突 |
| `I-C2-22` 零写 | 全部新增来源**只读**；不调 `refresh*`/`sync*`/`upsert*` | ✅ 不冲突 |
| `I-C2-24/25` 不重算 | 不重算 Gap→Position / eligibility / score；`gapRef`/`positionRef` 直接比对 | ✅ 不冲突 |
| C2 `§1.1` DTO 无身份/生命周期 | 不新增 `planId`/`status`/`version`/`save`/`upsert` | ✅ 不冲突 |
| C2 **字段禁列**（`phase-c2-step2c.test.ts:525`） | 用 `proposedAt`/`decidedAt` ⇒ 不触发 | ✅ 通过 |
| `T-C3-22b` 表集合不变 | 不建表 | ✅ 不冲突 |
| C5-B `§19.9` 禁止项 | Plan 不调 `confirm/reject` / `TargetService.add()`；不写两张 proposal 表 | ✅ 不冲突 |
| `§2.4` Position→Target 红线 | Plan 不新增该路径（只**读**已有 targetRef） | ✅ 不冲突 |
| C4 Report 冻结面 | 不触碰 | ✅ 不冲突 |

**结论：无冲突、无 BLOCKER；C5-C 是纯增量只读扩展。**

## §20.11 D5 裁定 — `companyName` KEEP

```text
companyName 是 Company Universe 的「展示字段」：
  - 来源：CompanyService.list(industryRef)（只读）
  - ★ 不得用于重新计算 eligibility / score / selectionReason / proposalRef
    或任何其它 Proposal 持久化语义
  - ★ 不是 Proposal 的新 SoT
```

**End of §20（rev6.1）.**

---

# §21 rev2 — C5-D Implementation Contract（Diligence Preparation Boundary Freeze + ResearchPlan 只读衔接）

> 状态：**rev2 — CONTRACT DRAFT（Final Lock 审查通过；补 4 处措辞闭合后待 LOCK）.** 父基线：`8b822f4`（C5-C 已发布）。
> **C5-D Implementation / Commit / Push 均未授权。**
> 来源：Scope Audit v2 = 🟢 PASS；Scope Review 定案 4 项 + rev1 纳入 4 处必改 + 2 处建议改；
> Final Lock Review（六层）通过并追加 rev2 = MUST FIX-1/2 + SHOULD FIX-1/2。

> **编号约定（SHOULD FIX-2）**：本 §21 的修订号为 **rev2**；`c5-implementation-contract.md` 的**文档全局** contract revision 为 **rev8**
> （rev1 落盘时全局为 rev7，本次 §21 内修订递增全局号）。
> **Section revision ≠ document revision** —— 审计 Git diff 时请以此区分。

## §21.0 修订历史

| 版本 | 变更 |
|---|---|
| （Draft） | 首版 §21：D1–D4 + R1–R10 + T-D-1…T-D-10 |
| rev1 | ① `preparationRef` 改为「复用既有 SoT」而非 C5-D 自定义 ID；② SQL 禁令改为「不得建立独立 Preparation SQL/SoT」；③ **T-D-4 前置明确为 Target 已存在 + Preparation 不存在**，并新增**状态表**；④ 新增 **T-D-11**（confirmed 但 Target 不存在不得伪造 Preparation）；⑤ **T-D-9 行为化**（spy/content fingerprint，静态仅辅助）；⑥ formatter 只消费 Plan projection，不得二次查库 |
| **rev2** | Final Lock 审查修订：**MUST FIX-1**（Target 存在但 Preparation 不存在 ⇒ `null` 语义闭合）/ **MUST FIX-2**（正式映射链 + 禁令）/ **SHOULD FIX-1**（Plan 不得自行构造 `preparationRef`）/ **SHOULD FIX-2**（编号约定）。**不改变 scope、不新增能力/表/CLI** |

## §21.1 C5-D 定位

```
C5-A  推荐谁                              （已发布 f4e48b2 / e921147）
C5-B  人工决定                            （已发布 dd07538 / 4c5db64）
C5-C  Plan 展示 Proposal / Target         （已发布 50075f2 / 735be57 / 8b822f4）
C5-D  Target → DiligencePreparation 衔接  （本 §21）
C6    Research Material → Claim → Knowledge Evolution（未授权）
```

**定位声明（原文锁定）**：C5-D **不是新领域能力建设**。`DiligencePreparation` 的表 / 领域对象 / Service / CLI **均已存在且基本正确**（Scope Audit v2 已证明）。C5-D = **边界冻结** + **唯一一项**新的只读生产能力。

```
新增生产能力：1     （ResearchPlanProposal.preparation 摘要投影）
新增数据库：  0     · 新增 migration：0
新增 CLI：    0     · 新增 Knowledge subject：0
新增 Target 决策能力：0 · 新增 Material / Claim / LLM / Report：0
```

## §21.2 D1 — Target Gate 语义冻结（LOCKED）

**规则**：Preparation 的**进入资格由 `ResearchTarget` 的存在性决定，而非由 `TargetStatus` 决定。**

```
prepare(targetRef)
  → repo.getTarget(targetRef)
      ├─ 不存在 ⇒ throw new Error("unknown target '<ref>'")   ★ 确定性错误，不是降级
      └─ 存在   ⇒ 生成 / 重新生成 preparation
```

推论（原文冻结）：

- `proposed` / `rejected` Proposal **不产生 `ResearchTarget`** ⇒ **无 `targetRef` 可传** ⇒ **结构上无法进入 `prepare()`** ⇒ **C5-B 人工决策门不可能被绕过**。
- `ResearchTarget.createdBy` **硬编码 `"user"`**（T-B8）⇒ 所有 Target 均经人确认。
- **`dropped` Target 仍可有 Preparation**：C5-D **不改变**既有历史研究语义，**不把 `dropped` 解释为「Target 从数据库中消失」**。
- **不要求改动 `prepare()`**（现状已满足）⇒ 仅**冻结语义** + 补断言。

## §21.3 D2 — 三个访问层次必须分开（LOCKED）

```
DiligencePreparationService.prepare()   =  MATERIALIZATION / WRITE PATH
DiligencePreparationService.get()       =  READ PATH
DiligencePreparationService.list()      =  READ PATH
ResearchPlanService.build()             =  READ-ONLY PROJECTION
```

**措辞禁令（原文冻结）**：**禁止**写「DiligencePreparation 是只读的」。
准确表述：**Preparation 的读取是只读的；`prepare()` 是其自身持久化的 materialization / write path。**

**唯一写权**：`prepare()` **只能**写 `diligence_preparation`（现状 `:175 repo.upsertPreparation()`），**不得**借此写 `research_target` / `target_proposal` / `target_proposal_decision` / Knowledge / Gap / Question / Requirement。

## §21.4 D3 — `currentUnderstanding` 语义冻结（LOCKED）

**原文锁定**：

> `DiligencePreparation.currentUnderstanding` 当前代表 **Industry-level Knowledge projection**，**不代表** company-level Knowledge subject。

```
Target（某家公司） → Preparation → currentUnderstanding → Industry Knowledge（subjectKind = "industry"）
```

- 证据：`diligence-preparation-service.ts:191 findKnowledgeBySubject("industry", industryId)`。
- **不得**新建 company-level Knowledge subject（会让 SoT 分叉；留给 C6+ 评估）。
- **字段名保持 `currentUnderstanding` 不变**（**不**重命名为 `industryUnderstanding`）⇒ 仅由本契约注释解释语义；**无 migration / 无 compatibility 成本**。
- `beliefs[].claimRef` 必须**真实来自 `knowledge_belief`**（R8）；subject 缺失 ⇒ `beliefs: []` + `version: 0`（**诚实降级，禁止编造**）。

## §21.5 D4 — `ResearchPlan → Preparation` 摘要投影（C5-D 唯一新增能力）

### DTO（**只此三个字段**，原文冻结）

```ts
preparation:
  | {
      preparationRef: string;      // ★ 取自 DiligencePreparationService.get() 的返回值
      status: PreparationStatus;   // "draft" | "ready" | "used"
      questionCount: number;       // ★ 仅计 state === "current" 的 question
    }
  | null;
```

**`preparationRef`（rev1 变更 ①）**：

```
必须直接取自 DiligencePreparationService.get(...) 返回的 preparation.preparationRef。
当前既有实现中其值为 dp-<targetRef>；
C5-D 不重新定义、生成或重构该标识规则。

★ **`ResearchPlanService` 不得自行构造 `preparationRef`**（SHOULD FIX-1）：
即使当前实现可由 `targetRef` 推导出 `dp-<targetRef>`，
该推导也**不得成为 Plan 的 SoT**，`preparationRef` 一律以既有 Preparation SoT 的返回值为准。
```

**`questionCount` 定义**：`preparation.questions.filter(q => q.state === "current").length`（**不含 `retired`**）。

**挂载位置（原文冻结）**：`positions[].proposals[].preparation` —— C5-C 提案链上的**唯一**位置。

- **`industryTargets[]` 不改动**（C2 冻结面；避免出现第二个 Preparation 展示出口）。
- **明确不加入**：`purpose` / `targetBrief` / `currentUnderstanding` / `questions[]` / `requestedMaterials[]` / `requestedData[]` / `risks[]` / `cautions[]`。Plan 是 overview；完整 Preparation 由 `research diligence <行业> --target <targetRef>` 负责。

### SoT-first（rev1 变更 ②）

```
ResearchPlanService 不得直接查询 diligence_preparation 表；
不得在 ResearchPlanService 中新增针对 Preparation 的 SQL / Repository 读取路径。
必须复用既有 DiligencePreparationService.get() 作为 Preparation SoT。
```

### 实现方式（rev1 变更 ③）

```
ResearchPlanService 必须通过既有 DiligencePreparationService.get() 所定义的读取语义
获得 Preparation SoT。实现可以复用已有 service / repository 读取能力
（逐个 get 或批量读取后映射均属实现细节），
但不得在 ResearchPlanService 内建立独立的 Preparation SQL / SoT。

不得调用 prepare()。
不得因为 Preparation 不存在而创建 Preparation。
```

### 不存在时的语义（rev2 · MUST FIX-1）

当 **`ResearchTarget` 存在但对应 `DiligencePreparation` 不存在**时：

- `Plan.preparation` **必须为 `null`**；
- **不得**将「Preparation 不存在」视为异常（不作为 error、不抛错、不降级为其它值）；
- **不得**调用 `prepare()` 补建；
- **不得**构造 fake preparation（含任何占位对象）；

C5-D **不改变** `DiligencePreparationService.get()` 的既有异常/空值契约
（现状 `get()` 返回 `DiligencePreparation | undefined`；Plan 侧只负责把「不存在」投影为 `null`，
判空必须宽松（`== null`）以同时覆盖 `undefined` 与 `null`）。
本条对应 **T-D-4**。

### 映射链（rev2 · MUST FIX-2）

已确认 Proposal 的 `preparation` **只能**沿下面这条链获得：

```
Proposal.status === "confirmed"
  → 读取该 Proposal 已验证存在的 targetRef      （复用 C5-C 已建立的 targetSvc.get() 存在性校验）
  → TargetService.get(targetRef) 确认 Target 存在
      ├─ 否 → preparation = null                 （禁止继续推导，见 T-D-11）
      └─ 是 → 查询该 Target 对应的 Preparation SoT
                  ├─ 否 → preparation = null      （见 MUST FIX-1）
                  └─ 是 → { preparationRef, status, questionCount }
```

**禁令**：

- **不得**仅依据 `proposal.status === "confirmed"` 推导 Preparation 是否存在；
- **不得**依据 `companyRef` / `companyName` / `proposalRef` / `selectionReason` / `positionRef`
  或任何其它字段**猜测、模糊匹配或反推** Preparation；
- **不得**绕过 `TargetService.get(targetRef)` 这一步直接查询 Preparation。

> 注：该映射链在 C5-C 中**已经存在**（`research-plan-service.ts` 内 `targetSvc.get(candidateRef)`）；
> 本修订只是把它**显式写进契约**，实现时**复用**即可，**无新实现**。

### 状态表（rev1 变更 ④ — **T-D-4 必须使用第 3 行**）

| Proposal | Target | Preparation | `Plan.preparation` |
|---|---|---|---|
| proposed | 无 | 无 | `null`（语义：尚无 Target） |
| rejected | 无 | 无 | `null`（语义：尚无 Target） |
| **confirmed** | **有** | **无** | **`null`（语义：Target 已存在，Preparation 尚未物化）** |
| confirmed | 有（`dropped` 亦同） | 有 | `{preparationRef, status, questionCount}` |
| confirmed | **不存在** | 有/无 | `null`（**禁止由 `status` 推导**，见 T-D-11） |

**`null` 是合法且重要的状态**；表示「Target 已存在，但目前没有已物化的 Preparation」。

### formatter 约束（rev1 变更 ⑥）

```
human formatter 只能消费 Plan 已经给出的 projection，
不得自行重新读取 Preparation（禁止 formatter 二次查库）。
human 侧：有 Preparation ⇒ 行尾附 `· 调研准备 <status>（N 问）`；
          无（null）⇒ 整段省略，不输出「调研准备：无」。
```

## §21.6 R1–R10 Red Lines（全部可测）

```
R1   Plan 不得创建 ResearchTarget
R2   Plan 不得 Confirm / Reject TargetProposal
R3   Plan 不得修改 Knowledge
R4   Plan 不得修改 ResearchGap
R5   Plan 不得修改 ResearchQuestion
R6   Plan 不得修改 InformationRequirement
R7   Preparation 不得凭空创造 Company facts
       —— 属既有 Preparation provenance / factuality 边界的回归约束；
          C5-D 不新增 Company factual enrichment 能力。
R8   currentUnderstanding 中的每个 belief 必须保留 claimRef provenance
R9   不存在 ResearchTarget 的 Proposal 不得生成正式 Preparation
R10  ★ ResearchPlan.build() 不得触发 prepare() 或任何写操作
         —— 特别禁止 `if (!preparation) preparationService.prepare(targetRef);`
```

## §21.7 OUT — 明确禁止实现（原文冻结）

```
❌ 新建 ResearchPreparation 实体 / research_preparation 表 / target_research_preparation / research_outline / company_knowledge
❌ migration（New tables = 0，Migration = 0）
❌ 重命名 / 删除 DiligencePreparation；重命名 currentUnderstanding
❌ 重做 QuestionSource / TargetRecommendation / TargetProposal / Human Decision
❌ 把 prepare() 改成纯函数
❌ 扩展 Company 为「大而全企业档案」
❌ company-level Knowledge subject
❌ LLM / Report / Material ingestion / Claim extraction / Knowledge write-back
❌ 新 CLI verb（保持 `research plan` + `research diligence` 两个出口）
```

**表集合不变**（继续使用既有 `research_target` / `diligence_preparation` / `diligence_question` / `knowledge_belief` / `research_gap` / `information_requirement` / `research_question`）⇒ `phase-c3-b.test.ts` 的 `TABLES_24` 与 C5-C `T-C5-C-11` **必须保持通过**。

## §21.8 验收矩阵（T-D-1 … T-D-11 + 回归保留）

| Test | 目的 | 断言要点 |
|---|---|---|
| **T-D-1** | unknown Target → 确定性 throw | `assert.throws(() => prepare("tgt-nope"), /unknown target/)` |
| **T-D-2** | `dropped` Target → preparation 仍可 materialize | 先置 status=`dropped`，再 `prepare()` 成功 |
| **T-D-3** | `dropped` Target 状态不被改变 | `prepare()` 前后 `getTarget(ref).status === "dropped"` |
| **T-D-4** | Plan 无 Preparation → `null`（★ 前置必须完整） | 构造 **confirmed + Target 存在 + Preparation 不存在** ⇒ `plan.preparation === null`；**禁用**「proposed + targetRef null」代替 |
| **T-D-5** | Plan 有 Preparation → 三字段准确映射 | `preparationRef` / `status` / `questionCount` 与 SoT 一致；去掉 `current` 过滤须转红 |
| **T-D-6** | Plan summary 与 `get()` 一致 | `deepEqual(plan.preparation, expectedFromGet)` |
| **T-D-7** | Plan build **内容指纹** zero-write | `dbFingerprint` 用 `JSON.stringify(rows)`；两次 `build()` 前后一致 |
| **T-D-8** | 两次 `build()` `deepEqual` | 含 `preparation` 字段与数组顺序 |
| **T-D-9** | Plan 无写入 / 决策 / Target 创建路径（★ **行为与边界证明**） | 证明 `build()`：不调 Preparation write path；不调 confirm/reject；不调 Target creation；不执行 Knowledge / Gap / Question / Requirement 写入；不执行 Proposal / Decision 写入。**优先**行为测试 / DI spy / call counter / SQLite content fingerprint；静态检查仅辅助，**不得**把生产代码字面量硬编码进被扫描文件（自命中禁令） |
| **T-D-10** | `belief.claimRef` 真实存在于 Knowledge SoT | 断言 `claimRef` ∈ `knowledge_belief` 现有行 |
| **T-D-11** | confirmed 但 Target 不存在 ⇒ 不得伪造 Preparation（★ 新增） | 构造 `status=confirmed` 且 `ResearchTarget` 不存在 ⇒ `plan.preparation === null`；未调 `prepare()`；未创建 Target；Proposal / Decision / Knowledge / Gap 不变。**禁令**：不得由 `proposal.status === "confirmed"` 推导 Preparation 存在 |

**mutation（每条须有「故意破坏 ⇒ 转红」证据）**：

```
· build() 内自动 prepare() / 构造 fake preparation ⇒ T-D-7 + T-D-9 + T-D-11 必须转红
· 由 proposal.status === "confirmed" 直接推导 preparation ⇒ T-D-11 必须转红
· 去掉 state === "current" 过滤（retired 也计数）      ⇒ T-D-5 必须转红
· 把 null 改为构造 fake preparation                     ⇒ T-D-4 必须转红
```

**回归保留**：`phase-c2-diligence.test.ts`（A–I-C2-9）、`phase-b-step-b4.test.ts`（T-B20）、`phase-b-b5-cli.test.ts`（T-B27）、`phase-b-b5-exposure.test.ts`（T-B28-4）、C5-C 的 zero-write / idempotency / 表集合。

## §21.9 与既有冻结面的冲突检查

| 冻结面 | 约束 | C5-D 影响 |
|---|---|---|
| C2 `phase-c2-step2c.test.ts:525` | Plan DTO 禁列 `planId`/`createdAt`/`updatedAt`/`versionId`/`save(`/`upsert(` | ✅ 只**新增**只读字段 `preparation`，不触碰禁列 |
| C2 `phase-c3-b.test.ts:322 T-C3-22b` | `build()` 前后表集合不变 | ✅ **无新表** |
| C2 `:432` | 两次 `build()` `deepEqual` | ✅ 保持（T-D-8） |
| C5-A 冻结 | `rank()` 调用面 / Priority Policy 不变 | ✅ 不涉及 |
| C5-B 冻结 | `confirm` 是产生 `research_target` 的唯一路径 | ✅ **加强**（R9 / R10） |
| C5-C 冻结 | Plan 零写（内容指纹） | ✅ 扩展到 `preparation`（T-D-7） |
| C4 Report 冻结面 | 不触碰 | ✅ 不冲突 |
| `§2.4` Position→Target 红线 | Plan 不新增该路径（只**读**已有 targetRef） | ✅ 不冲突 |
| **formatter 语义** | human 只消费 Plan projection（rev1 变更 ⑥） | ✅ 新增约束 |

**结论：无冲突、无 BLOCKER；C5-D 是纯增量只读扩展 + 既有能力边界冻结。**

## §21.10 预计文件清单（**待 Implementation Authorization 时确认**）

| 文件 | 性质 | 预估 |
|---|---|---|
| `packages/research/src/domain/research-plan.ts` | 生产（**扩展只读 DTO**） | 新增 Preparation 摘要类型 + 在 `ResearchPlanProposal` 加 `preparation` |
| `packages/research/src/application/research-plan-service.ts` | 生产（**只读**） | 复用 `DiligencePreparationService.get()`；不新增 Preparation SQL |
| `src/cli/research-format.ts` | 生产（展示） | human 行尾附 `· 调研准备 <status>（N 问）` / `null` 时省略 |
| `src/cli/tiancha.ts` | 生产（组合根） | 如需，注入 `DiligencePreparationService` 依赖 |
| `packages/research/src/phase-c5-d.test.ts` | 测试（新） | T-D-1 … T-D-11 |
| `src/cli/phase-c5-d-cli.test.ts` | 测试（新） | Plan 展示（human / `--json`）一致 |

**测试契约提示**：断言模式**不得**把被扫描的代码字面写进被扫描文件（自命中禁令，C5-A / C5-C 均已踩坑）。

**End of contract（rev8）.**
