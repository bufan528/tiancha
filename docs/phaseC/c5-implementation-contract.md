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
