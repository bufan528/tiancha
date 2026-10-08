# Phase C6 H-2 Read-only Preflight Findings

```text
Document kind     : READ-ONLY AUDIT RECORD
Implementation    : NONE
Contract          : NONE (this is NOT an implementation contract)
Authorization     : NONE (this document authorizes no change)
Nature            : Evidence + Findings + Disposition, recorded for future reference
```

---

## §0 Baseline

```text
HEAD          = origin/main = ls-remote = 9538e9501460fcba1c1bdddef781ea29acb0a7f9
ahead/behind  = 0 / 0
worktree      = M README.md · M package.json · ?? .acl-recovery-notes.txt · ?? docs/audit-2026/
                (all colleague artifacts; untouched by this audit)
Method        = read-only static audit (+ existing test suite as cross-check)
Code changes  = 0 (no production, no test, no contract file was modified)
```

Scope: verify that Tiancha's Knowledge / Requirement / Evidence / Pool semantic boundaries, and
version provenance, do not suffer cross-layer drift, implicit fallback, legacy-SoT reads, or
untraceable origin.

四条主线：**A** Current / Knowledge · **B** Requirement · **C** Evidence / Claim / Pool / Knowledge ·
**D** Version Provenance。

---

## §1 R1 — Current SoT Map

| 业务概念 | SoT | accessor | 生产 caller | 风险 |
|---|---|---|---|---|
| Current Belief | `CURRENT_BELIEF_STATE = "confirmed"`（`domain/knowledge-belief.ts:27`） | **`KnowledgeRepository.listCurrentBeliefs()`**（`storage/knowledge-repository.ts:102-103`） | `diligence-preparation-service.ts:192` · `evaluation-service.ts:174` · `knowledge-projection-service.ts:347/430` · `report-service.ts:97` · `knowledge-repository.ts:52`(内部) | 🟢 |
| Current predicate | `isCurrentBelief(state) = state === CURRENT_BELIEF_STATE`（`knowledge-belief.ts:34`） | 同左 | `knowledge-projection-service.ts:190`（`filter(isCurrentBelief)`） | 🟢 |
| Current Knowledge projection | `IndustryKnowledge.version`（同 `knowledgeId`） | `getKnowledge` / `findKnowledgeBySubject`（`knowledge-repository.ts:43-54`） | `research-commands.ts`（H-1 路径） | 🟢 |
| Current 指针列 | `industry.currentStateId` / `currentEvaluationRunId` / `currentKnowledgeId`（`domain/industry.ts:21-23`） | — | **仅写入**：`research-repository.ts:89/90/91/135`（upsert `?? null`）；**生产读取 = 0** | 🟢 |
| Claim temporal | `ClaimTemporalRelation = "current" \| "old" \| "superseded"`（`domain/claim.ts`） | — | `supersedeClaim`（不可达 · 见 H2-01） | 🟡 |

```text
★ 正面结论：`listCurrentBeliefs()` 的全部调用点都经唯一 accessor；
  唯一 predicate `isCurrentBelief()` 是 `state === "confirmed"` 的唯一定义；
  没有任何模块自写 `state === "confirmed"` ⇒ H-1 的 INV-1 在 Current 层同样成立。
★ 三个 legacy `current*` 指针列无生产消费者 ⇒ 不构成第二 SoT。
```

---

## §2 R2 — Requirement SoT Map

| 项 | owner | accessor | lifecycle | 风险 |
|---|---|---|---|---|
| Requirement | `research-repository` | **`repo.listRequirements(subjectId)`**（唯一入口） | `status: open \| partially_met \| met \| blocked`（`syncRequirementStatus`，`knowledge-projection-service.ts:846-854`） | 🟢 |
| 「还需研究哪个 requirement」 | `domain/active-requirement.ts` | `activeRequirements(gaps, requirements)` | **Gap-level**：`active ≡ gap.status ∈ { open, mitigating }`（`isActiveGapStatus`） | 🟢 |

```text
listRequirements 调用点（全部同一入口）：
  chain-projection-service.ts:33/104 · diligence-preparation-service.ts:61 ·
  evaluation-service.ts:84 · knowledge-projection-service.ts:506/657 · priority-service.ts:54 ·
  report-service.ts:162 · research-need-service.ts:22 · question-target-fit-service.ts:56/59

★ `domain/active-requirement.ts` 头注自证纪律：「THE single source of the "which requirements
  still need research?" predicate」+「There is exactly ONE place in the codebase that may compare
  gap statuses」+ 无 state / 无 repository / 无副作用（thin namespace）
  ⇒ 它不是第二套 Requirement SoT，而是 Gap→Requirement 的活跃判定。
⚠️ 观察：Requirement 只有 status（open/partially_met/met/blocked），无 disabled/superseded
  ⇒ 见 H2-02（design boundary，非缺陷）。
```

---

## §3 R3 — Knowledge Write Path

| 写入口 | 调用者 | 位置 |
|---|---|---|
| `updateBeliefState` | `knowledge-projection-service.ts` | `:282`(revise/supersede) · `:297`(conflicting) · `:407` · `:412`(confirmed) · `:446`(rejected) |
| `insertBelief` | `knowledge-projection-service.ts` | `:341` |
| `upsertKnowledge` | `knowledge-projection-service.ts` | `:344` · `:427` |
| `appendBeliefRelation` | `knowledge-projection-service.ts` | `:408` |

```text
★ 9/9 写入点全部集中在 knowledge-projection-service.ts ⇒ 第二条 Knowledge 写入路径 = 0。
```

---

## §4 R4 — Knowledge Read Path

| 读取入口 | current? | 重新推导? | 风险 |
|---|---|---|---|
| `listCurrentBeliefs(knowledgeId)` | ✅ 经唯一 predicate | 否 | 🟢 |
| `getKnowledge` / `findKnowledgeBySubject` | header + `beliefs` 由 `listCurrentBeliefs` 回填（`knowledge-repository.ts:52`） | 否 | 🟢 |
| `listBeliefsByDimension`（`:124`） | ✅ `.filter(isCurrentBelief)` | 否 | 🟢 |

---

## §5 R5 — Pool Read Path

| 调用者 | 用途 | 是否可能绕过 current semantics | 风险 |
|---|---|---|---|
| `evaluation-service.ts`（H-1 后） | sufficiency 输入 | ❌ 已按 `listCurrentBeliefs` 的 `claimRef` 过滤 | 🟢 |
| `knowledge-projection-service.ts:556` | Pool → Knowledge 投影 | ❌ 用 `confirmedClaimRefs` 过滤 | 🟢 |
| `PoolItem.valueText` | 写入 `research-repository.ts:458/482` | **生产读取 = 0** ⇒ PoolItem 不成为「自带事实」的第二 SoT | 🟢 |

```text
★ 事实来源链仍然是：Source → Document → Version → Fragment → Citation → Evidence
  （`domain/source.ts` 头注）；Evidence→Claim 是 stance-bearing assertion（`domain/evidence.ts` 头注）。
★ 边界成立：Pool ≠ Knowledge · Claim ≠ Knowledge · Knowledge = confirmed current cognition。
```

---

## §6 R6 — Claim State Matrix

| Claim / Belief state | 进 Pool | 进 Knowledge | 进 Evaluation 输入 | 进 Report |
|---|---|---|---|---|
| candidate | ✅ | ❌ | ❌（H-1 后按 claimRef 过滤） | ❌ |
| confirmed | ✅ | ✅（唯一写入者） | ✅ | ✅ |
| rejected | — | ❌ | ❌ | ❌ |
| revised | — | ❌ | ❌ | ❌ |
| conflicting | — | ❌（仅标记） | ❌ | ❌ |
| superseded | — | ❌ | ❌ | ❌ |

```text
★ 投影准入闸门：`knowledge-projection-service.ts:176`
  `if (!claim.isRealExternalData) return skip("", "PLACEHOLDER_DATA");`
★ 与 H-1 测试 Case A/B/C（revised / superseded / conflicting 不计入）一致。
```

---

## §7 R7 — Policy Provenance

| 对象 | eval policy | sufficiency policy | methodology | 持久化 |
|---|---|---|---|---|
| `InvestmentEvaluation` | `evaluationPolicyVersionId` | **`sufficiencyPolicyRef` + `sufficiencyPolicyVersionId`**（H-1） | `methodologyVersionId` | ✅（json 往返） |
| aggregation | `aggregationPolicyVersionId` | — | — | ✅ |
| `Report` | `policyVersionId` | — | `methodologyVersionId` · `materialVersionId` · `normalizationVersion` | ✅ |

```text
★ H-1 建立的「业务结果 + 产生结果的 policy identity」模式在当前代码中命名不混用：
  evaluationPolicy* / aggregationPolicy* / sufficiencyPolicy* / methodology* / material* / normalization*
```

---

## §8 R8 — Version Ownership

| version 字段 | owner 对象 | SoT | immutable? | fallback? |
|---|---|---|---|---|
| `knowledgeId` + `version` | `IndustryKnowledge` | 同 id 新 version（旧 belief 不覆写） | ✅ | ❌ |
| `runId` / `activeAttemptId` | `ResearchTask` | task | — | ❌ |
| `attemptId` | `TaskAttempt` | attempt | — | ❌ |
| `schemaVersion` / `attemptId` / `runId` / `version` | `Artifact` | artifact | ✅ | ❌ |
| `sufficiencyPolicyVersionId` | `InvestmentEvaluation` | PolicyRegistry `versionId` | ✅ | **无**（ref 缺失/未知 ⇒ THROW · H1-INV-6） |

---

## §9 R9 — Forbidden / Legacy Sources

| 旧字段 | deprecated? | 生产 references | 合法性 |
|---|---|---|---|
| `Industry.currentKnowledgeId` | **YES**（`domain/industry-knowledge.ts:15` 头注 · contract §2.4 / P4） | 仅写入（`research-repository.ts:91`）；读取 **0**（H-1 后 `src/cli/research-commands.ts:239` 是禁令注释） | 🟢 合法（零读取） |
| `industry.currentStateId` / `currentEvaluationRunId` | 未声明 deprecated | 仅写入（`:89` / `:90` / `:135`） | 🟡 无消费者（登记） |
| `@earendil-works/pi-coding-agent` in `packages/research` | 红线 EP-15 / IP-3 | 本轮未新增 | 🟢 |

---

## §10 R10 — Findings

### H2-01 · 🟡 AMBIGUOUS / NOT REACHABLE

```text
Severity    : Low（当前不可达）
Evidence    : packages/research/src/application/opportunity-discovery-service.ts:381-433
              · supersedeClaim() 构造 newClaim: provenance:"user" · factIds:[] · evidenceIds:[]
                · temporalRelation:"current" · ★ isRealExternalData: true（硬编码）
              · 头注自称「T9: apply new evidence about an existing claim topic WITHOUT overwriting」
                但函数签名不接收任何 evidence
Reachability: 生产调用者 = 0 · 测试调用者 = 0（仅定义 @ :381）
              ⇒ 当前不存在合法生产调用路径
Contract ref: domain/claim.ts:18（provenance 含 "user"）·
              knowledge-projection-service.ts:176（PLACEHOLDER_DATA 闸门）
Current     : 方法存在但未接线（dead code / unwired API）
Expected    : 若将来接线，无 evidence 的 user 声明应显式标注，而非 isRealExternalData = true
Disposition : 🟡 REGISTERED / NOT REACHABLE —— 不开 remediation（避免为死代码提前扩大 Slice）
              ★ 同时作为 R6-ERR「存在性 ≠ 可用性 ≠ 合法性」的真实案例
```

### H2-02 · 🟡 AMBIGUOUS / DESIGN BOUNDARY

```text
Severity    : Low-Info
Evidence    : 全仓 RequirementStatus = open | partially_met | met | blocked（无 disabled / superseded）
Current     : 「失效 Requirement」这一业务概念在当前模型中不存在 ⇒ 调用方无从发明过滤规则
Expected    : 若未来需要失效语义，应显式建模，而非由调用方自行过滤
Disposition : 🟡 REGISTERED / DESIGN BOUNDARY —— 非缺陷，不开 remediation
              ★ 无 disabled ≠ 缺陷；无 disabled + 未来需要失效语义 ⇒ 需要正式建模
```

### H2-03 · 📋 INFO / LEGACY

```text
Evidence    : industry.currentStateId / currentEvaluationRunId / currentKnowledgeId
              仅写入（research-repository.ts:89/90/91/135）；生产读取 = 0
Current     : 不存在第二 SoT
Disposition : 📋 REGISTERED / LEGACY HYGIENE —— 不是 H-2 semantic defect；
              不因「代码看起来更干净」而删除
              ★ 作为 R6-ERR「有 writer ≠ 有 SoT」的真实案例
```

### H2-04 · 📋 INFO / SEMANTIC BOUNDARY

```text
Evidence    : ClaimTemporalRelation = current | old | superseded         (domain/claim.ts)
              KnowledgeBeliefState  = candidate | confirmed | rejected |
                                      revised | conflicting | superseded (domain/knowledge-belief.ts)
Current     : 两者都含 "superseded"，但不同 domain / 不同 owner / 不同 lifecycle，
              且全仓未混用 ⇒ 非漂移
Disposition : 📋 REGISTERED / SEMANTIC BOUNDARY —— 无需修改
              ★ 作为 R6-ERR「名称相似 ≠ 语义相同」的真实案例
```

---

## §11 Final Decision

```text
H-2 Read-only Preflight

Baseline                    🟢 PASS
A Current / Knowledge       🟢 PASS
B Requirement               🟢 PASS
C Evidence / Claim / Pool   🟢 PASS
D Version Provenance        🟢 PASS

Critical findings           0
Major findings              0
Remediation required        0

H2-01                       🟡 REGISTERED / NOT REACHABLE
H2-02                       🟡 REGISTERED / DESIGN BOUNDARY
H2-03                       📋 REGISTERED / LEGACY
H2-04                       📋 REGISTERED / SEMANTIC BOUNDARY

Overall                     🟢 FINAL PASS
Disposition                 🟢 NO-FIX
Status                      🟢 CLOSED
```

```text
AMBIGUOUS ≠ FAILED.
本记录不产生：Implementation · Contract · Authorization · Migration · Schema change。
```

---

## §12 Explicitly NOT done by this slice

```text
❌ 未改生产代码            ❌ 未改测试            ❌ 未新增 Contract
❌ 未改 HANDOFF / README   ❌ 未处理 colleague artifacts
❌ 未删除 legacy 字段      ❌ 未修 supersedeClaim ❌ 未给 Requirement 增加状态
❌ 未实施 R6-ERR
```

---

## §13 R6-ERR cross-reference（不在本记录范围内）

```text
R6-ERR（Readiness Preflight 的 SoT Legality Check）
  Status          : 🟡 START DESIGN / READ-ONLY METHODOLOGY REVIEW
  Proposed items  : L1 Presence · L2 Ownership · L3 Contract Permission ·
                    L4 Deprecation · L5 Competing SoT · L6 Slice Dependency Legality
                    （L7 Reachability 待 review 阶段讨论，不预先定稿）
  Implementation  : NOT AUTHORIZED
  Methodology mutation : NOT AUTHORIZED
  Real cases from H-1 / H-2 : currentKnowledgeId（字段存在 ≠ 合法 SoT）·
                               H2-01（存在 ≠ 可用 ≠ 合法）·
                               H2-03（有 writer ≠ 有 SoT）·
                               H2-04（名称相似 ≠ 语义相同）
  Flow            : Experience → Proposal → Review → Human Gate → Methodology v1
```

---

## §14 Erratum（append-only · 不修改 §10 原文）

```text
Erratum ID  : E-1
Raised at   : R6-ERR SoT Legality Check Proposal Review（只读）
Affects     : §10 R10 — H2-01 的 Reachability 行
Nature      : 客观事实错误（取证方法缺陷所致）· 非 Git/内容缺陷
Rule        : append-only —— §10 原文保持不变，本 §14 为唯一更正来源
```

### E-1 原记录（§10 · H2-01）

```text
Reachability: 生产调用者 = 0 · 测试调用者 = 0（仅定义 @ :381）
              ⇒ 当前不存在合法生产调用路径
```

### E-1 更正

```text
❌ 原记录「测试调用者 = 0」错误
✅ 实测：supersedeClaim 全仓共 2 处命中（递归正确取证）
     [PROD] packages/research/src/application/opportunity-discovery-service.ts:381   （定义）
     [test] packages/research/src/foundation.test.ts:169                            （调用）
   foundation.test.ts:162  describe("T9 old claim never overwritten")
   foundation.test.ts:163  test("supersede retains old claim (temporalRelation=old) and adds new current")
   foundation.test.ts:180  assert.equal((oldAfter!.blob as Claim).temporalRelation, "old")
   foundation.test.ts:181  assert.equal((newAfter!.blob as Claim).temporalRelation, "current")
```

### E-1 根因（取证方法缺陷，非项目缺陷）

```text
当时的命令：Select-String -Path 'packages/research/src/**/*.ts','src/**/*.ts'
PowerShell 的 `**` 只展开一层 ⇒ 实际匹配 packages/research/src/<dir>/*.ts
⇒ 位于 packages/research/src/ 直下的 foundation.test.ts（0 层）被遗漏
⇒ 得出「测试调用者 = 0」的错误结论
```

### E-1 仍然成立的断言

```text
✅ 生产调用者 = 0 —— 不变（opportunity-discovery-service.ts:381 仅为定义）
⇒ H2-01 的最终 Disposition 【不变】：🟡 REGISTERED / NOT REACHABLE
⇒ 不开 remediation（结论未变）
```

### E-1 修正后的语义描述

```text
原描述：dead code / unwired API
更正为：contract-covered（T9）+ test-covered + production-unwired
  即：存在已冻结的契约行为（T9：旧 claim 保留为 temporalRelation="old"、新 claim 为 "current"）
      且被测试守护，但尚无生产接线。
```

### E-1 方法论含义（纳入 R6-ERR Case 5）

```text
★ 本勘误同时构成 R6-ERR 的第 5 个真实案例，证明：
    「测试覆盖 ≠ 生产接线」以及「合法 SoT 与运行可达性正交」
  Semantic Authority  ⟂  Runtime Reachability
  ⇒ 二者独立判定 + 联合报告；不得由 Reachability 反推 SoT Legality。
```

### E-1 勘误范围

```text
✅ 本 §14 为唯一更正来源（append-only）
❌ 未修改 §10 原文
❌ 未 amend c950cd4 · 未 rebase · 未 force
❌ 未修改任何生产代码 / 测试 / 契约
```
