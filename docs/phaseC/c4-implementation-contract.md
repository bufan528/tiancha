# Tiancha Phase C · Step C4 — Report Consumption & Presentation Completion Contract

> **状态：DRAFT rev2（已并入 `C4 Contract Gate` 的 5 项裁定 + 2 条新增红线/不变量；`Content Gate` PASS；等待 `C4 Contract Final Gate`）**
> 本文档 **docs-only**：不含任何代码改动、不含 migration、未 commit、未 push。
> 它把 Phase C 主契约 `docs/phaseC/implementation-contract.md` 的 **§23（C4 —— Report，重定义：消费既有状态）**
> 展开成可逐条 Gate 的工程契约；**不修改、不覆盖**主契约，也不修改 C1 / C2 / C3 已 FINAL LOCK 的契约。
> 上游依据：§23 原文、§25（实现顺序：C3 → **C4 Report（消费 + 展示完整化）** → 真实调研场景验收）、§26（Phase C 最终验收场景）。
> 边界裁定依据：`C4 Fact-Finding / Boundary Audit`（PASS）+ 用户对 R1 / R2 / A–E 的裁定 + `C4 Contract Gate`（有条件通过）的 5 项冻结裁定。

---

## 0. Baseline 与历史注记

### 0.1 代码基线

```text
code baseline : 72151b5（= origin/main）— C3 已 COMPLETE / PUBLISHED
prior stages  : C1 ✅ / C2 Phase 2 ✅（69d2b1d FINAL LOCK + 2-A/2-B/2-C）/ C3 ✅
C3 freeze     : Priority Policy / factors / acquisitionValue / NextAction 语义 / rank() 调用面
```

本契约的**每一条现状事实**都以 `72151b5` 为准并带 `file:line`。若实现阶段发现漂移，先报告、后实现。

### 0.2 §23 原文（C4 的目标）

> **C4 专门负责：使 Report 正确消费 Knowledge Evolution + downstream persisted state。**
>
> 重点增加：cognition changes（含 `candidate` 待确认、`revised` 历史标注）；revised beliefs；conflicts；
> superseded history；reopened gaps；research progression。
>
> 继续遵守 S6-R1：**Report 是读取/快照层，不成为上游业务状态的计算器**；
> 并且 C4 之后，Report 的"当前认知"必须与 §3.3 的 `current` 判据**完全一致**（C1 已做基础对齐，C4 负责展示层完整化）。

### 0.3 ★ C4 定位（一句话，钉死）

> **C4 扩展 Report 的消费面，但不扩展 Report 的业务决策权。**

```text
Knowledge Evolution → persisted state → Report → 展示
```

**必须继续挡住**：

```text
Knowledge Evolution → Report → 重新计算 / 修改状态 → Priority / Gap / Knowledge
```

### 0.4 ★ 实施拆分（`C4 Contract Gate` 裁定 4）

```text
C4 · Report Consumption & Presentation Completion
├── C4-A  Cognition / Conflict / State + R1
│        范围：Candidate / Confirmed(保持) / Revised / Superseded / Rejected /
│              Conflicting belief / Open·Resolved·Accepted Conflict /
│              ResearchState（只读透传）/ R1 methodology zero-write conformance
│        风险性质：Report 会不会**错误解释 cognition SoT**？
└── C4-B  Snapshot History / Presentation
         范围：report_snapshot history / 既有 repository 只读 API 接线 /
              CLI 只读历史出口 / Agent 只读出口（若确有必要）/ static boundary audit
         风险性质：Report history 会不会意外变成**新的写入/重建入口**？
```

```text
C4-A（SoT consumption correctness）→ 独立验收
C4-B（history/presentation correctness）→ 独立验收
        ↓
C4 Exit Gate
```

---

## 1. 语义链与 Report 的定性

### 1.1 语义链（方向写死，禁止反向）

```text
Claims → Knowledge Evolution（C1）
       → persisted state（Pool / Gap / NextAction / persisted Priority / Knowledge / Conflict / ResearchState / Evaluation）
       → ReportService.build()（只读装配）
       → ReportSections（结构化快照）
       → report_snapshot（append-only 投影）
       → CLI `research report` / Agent `research_report`
```

### 1.2 Report 是什么（写死）

```text
Report = read projection，NOT a source of truth
report_snapshot = append-only 投影表（重生成插入新行，旧行仍可读）
```

依据：`domain/report.ts:1-14`（I14：生成 Report **从不写 Claim / Belief / Pool / Evaluation / Gap / State** 行）、
`storage/report-repository.ts:4-5`（"a snapshot is never updated in place … Nothing here can mutate a SoT"）。

### 1.3 ★ C4 真正负责的段（写死）

```text
已有 persisted state（cognition lifecycle + conflict + state + history）
        ↓
只读装配进 ReportSections
        ↓
展示（CLI / Agent / 只读的 snapshot 历史查询）
```

**不负责**：上游任何计算（Priority / Gap / Pool / Knowledge / State 的生成与修改）。

---

## 2. 现状核查（基线 `72151b5` 的真实事实）

### 2.1 Report 的真实读取面（10 个入口，全部只读）

| # | 读入口 | 位置 | 说明 |
|---|---|---|---|
| 1 | `MethodologyService(repo).getActive()` | `report-service.ts:82` | ⚠️ **隐藏写入**（见 §5 R1） |
| 2 | `KnowledgeRepository.findKnowledgeBySubject` | `:84` | |
| 3 | `KnowledgeRepository.listBeliefs`（含**全部历史**） | `:85` | |
| 4 | `KnowledgeRepository.listCurrentBeliefs` | `:86-88` | = `filter(isCurrentBelief)` |
| 5 | `ResearchRepository.listPoolSlots` + `listPoolItems` | `:103-111` | |
| 6 | `KnowledgeRepository.listOpenConflicts` | `:115-117` | ⚠️ **只取 open** |
| 7 | `ResearchRepository.listRequirements` / `listGaps` | `:127-138` | gaps 只取 `open\|mitigating` |
| 8 | `ResearchRepository.getLatestEvaluation` | `:164` | |
| 9 | **`PriorityService.currentPriorities()`** | `:182-183` | ✅ 只读面；注释 `:178-181` 明写禁止 `rank()` |
| 10 | `ResearchRepository.listNextActions`（filter `open`） | `:192-201` | |

**写入面（唯一）**：`ReportRepository.saveProjection()`（`report-service.ts:51` / `:70`）⇒ 只写 `report_snapshot`。

### 2.2 `ReportSections` 现状（10 个 section）

`domain/report.ts:96-108`：

```text
currentKnowledge: KnowledgeLine[]      当前认知（= 仅 current beliefs）
keyFacts: FactLine[]                   关键事实（PoolItems）
mainJudgments: KnowledgeLine[]         主要判断（= 仅 confirmed）
conflicts: ConflictLine[]              主要冲突（= 仅 open）
gaps: GapLine[]                        缺口（= 仅 active）
recentChanges: ChangeLine[]            最近变化（= belief historicalRelations 前 10）
recentEvidence: string[]               最近证据（claim refs）
evaluation: EvaluationSummary | null   当前评价
priority: PriorityLine[]               优先级（只读面）
nextActions: NextActionLine[]          下一步（open actions）
```

**★ 两个"类型已具备、装配面不完整"的事实（决定 C4 实施面很小）**：

```text
KnowledgeLine.state  : string   已存在（domain/report.ts:19-25）⇒ 扩展非 current belief 不需要新类型
ConflictLine.status  : string   已存在（domain/report.ts:28-34）⇒ resolved/accepted 展示不需要新类型
```

**`KnowledgeLine` 的现有字段（C4 只允许透传这些，不得新造）**：

```text
beliefId, dimension, state, claimRef, sourceRef?

注意：
  - 字段名是 `claimRef`，**不是** `claimId`（两者不可混用）；
  - `historicalRelations` / `createdAt` / `updatedAt` **不在** `KnowledgeLine` 中
    ⇒ C4 不得为了"更完整"临时塞入（见 §12.3 待确认点 1）。
```

### 2.3 cognition 的真实 SoT（实测，非按名称推断）

| 概念 | SoT | 位置 |
|---|---|---|
| current / confirmed | `KnowledgeBelief.state === "confirmed"`（**唯一**判据） | `domain/knowledge-belief.ts:26-36`；`industry-knowledge.ts:10-11` |
| **candidate** | `state === "candidate"` | `knowledge-belief.ts:13-14` |
| **revised** | `state === "revised"` + `historicalRelations[{relation:"REVISE", otherBeliefId, at}]` | `:19-20, 49-55, 71` |
| **superseded**（belief 层） | `state === "superseded"` | `:23-24` |
| **superseded**（claim 层） | `Claim.temporalRelation === "superseded"` | `domain/claim.ts:26, 46` |
| **rejected** | `state === "rejected"` | `:17-18` |
| conflicting（belief 侧，维度级） | `state === "conflicting"` | `:21-22`；取用 `knowledge-repository.ts:128` |
| conflict（对象侧） | `knowledge_conflict` → `KnowledgeConflict` | `domain/knowledge-conflict.ts:13-24` |
| 历史是否保留 | ✅ 行永不删除，只翻转 `state` | `knowledge-belief.ts:9` |

**`KnowledgeConflict` 的关键语义（C4 必须继承）**：`resolveConflict()` 只 `open → resolved`，**从不恢复 current 认知**；**never pick a side**（`domain/knowledge-conflict.ts:4-10`，C-FIX-10）。

> **★ 状态语义 vs 关系语义必须分开**：`KnowledgeLine.state === "revised"` 只能表达
> "该 belief 当前处于 revised 状态"；**不构成**"Report 已展示完整修订关系链（谁修订谁 / 何时）"。
> 关系链的载体是 `historicalRelations`，它**不在** `KnowledgeLine` 中（见 §12.3 待确认点 1）。

### 2.4 缺 SoT 的三项（实测）

| 缺什么 | 事实 | C4 处理 |
|---|---|---|
| Gap 生命周期历史（created → resolved → reopened） | `ResearchGap` 只有 `status` / `discoveredAt` / `updatedAt`（`domain/research-gap.ts:22-37`），无 status 历史 | ❌ **C4 OUT / External Dependency** |
| NextAction 取消历史（open → cancelled → open） | 同行覆盖，只保留当前 `status` | ❌ 同上 |
| research progression 指标（完成度 / 质量 / 百分比） | **无任何 SoT** | ❌ 同上 + **禁止 Report 自算** |

### 2.5 既有测试覆盖 vs 空白

| 已有覆盖 | 位置 |
|---|---|
| Report 是投影：I14 / 重读 / append-only | `s6-report.test.ts:76, 89-92, 167, 176-187` |
| **Report 不重算 Priority**（篡改 + 极端 policy 注入） | `s6-report.test.ts:197-237` |
| Agent `research_report` 只追加投影、不碰 SoT | `s7-exposure.test.ts:162-172` |
| CLI report 出口 | `research-commands.ts:176-183` |

**★ 空白（§8 验证矩阵的核心）**：

```text
- 没有任何测试覆盖：non-current beliefs（candidate/revised/conflicting/superseded/rejected）在 Report 中的呈现
- 没有任何测试覆盖：resolved/accepted conflict 的只读呈现
- 没有任何测试覆盖：ResearchState 在 Report 中的呈现（且当前 Report 根本不读 state）
- 没有任何测试覆盖：snapshot 历史查询出口（生产 0 使用者）
- 没有任何测试锁定：Report 生成不写 methodology（R1）
```

---

## 3. C4 消费面契约（canonical sections）

### 3.1 语义冻结（现存 10 个 section 的语义**不得改变**）

```text
currentKnowledge  ≡ 仅 state === "confirmed"（唯一 current 判据，C-FIX-12）
mainJudgments     ≡ 仅 confirmed（保留）
conflicts         ≡ 仅 open（**保留其"主要冲突"语义**，不混入已解决）
gaps              ≡ 仅 open | mitigating
priority          ≡ 必须来自 currentPriorities()（只读面）
nextActions       ≡ 仅 open actions
```

> **红线 3.1**：`candidate` / `revised` / `conflicting` / `superseded` / `rejected` **永远不得**出现在
> `currentKnowledge` 或 `mainJudgments` 中。它们只能出现在 §3.2 的 section。

### 3.2 ★ 新增 section（rev2 冻结：含 `rejected`）

| 新增 section | 类型 | SoT（唯一来源） | 排序（确定性） | 风险 |
|---|---|---|---|---|
| `pendingCandidates` | `KnowledgeLine[]` | `listBeliefs().filter(state==="candidate")` | `dimension asc → beliefId asc` | 🚫 不得计入 current / 不得影响 Pool 与 Gap |
| `revisedBeliefs` | `KnowledgeLine[]` | `filter(state==="revised")` | 同上 | 🚫 不得由 Report 推断"为何 revised" |
| `supersededBeliefs` | `KnowledgeLine[]` | `filter(state==="superseded")` | 同上 | 🚫 不新建演化链规则 |
| **`rejectedBeliefs`** | `KnowledgeLine[]` | `filter(state==="rejected")` | 同上 | 🚫 不得由 Report 解释"为何被拒" |
| `conflictingBeliefs` | `KnowledgeLine[]` | `filter(state==="conflicting")` | 同上 | 🚫 不得选边 / 恢复 current |
| `conflictHistory` | `ConflictLine[]` | `knowledge_conflict` 中 `status ∈ {resolved, accepted}`（**新增只读入口**，§4.2） | `dimension asc → conflictId asc` | 🚫 不得自动 resolve / 选 winner |
| `state` | `ReportStateLine \| null` | `repo.getStateBySubject(subjectKind, subjectId)`（§4.3 白名单） | —（单对象） | 🚫 **不得**包装成 progress / quality / 百分比 |

**★ rev2 冻结的展示原则（`C4 Contract Gate` 裁定 1 + 2）**：

```text
(a) rejected 与 candidate / revised / superseded / conflicting **同等展示**。
    该词组的准确含义 = **同等合法性 / 同等可观察性**：
    它们都是可被 Report 观察到的合法状态，不得出现"能说 revised 却不能说 rejected"的语义断裂。
    **不要求** UI 字段、排序或篇幅完全对称。
(b) 全部新增 belief section **只透传 `KnowledgeLine` 的既有字段**
    （beliefId / dimension / state / claimRef / sourceRef），**C4 不新造字段**；
    也**不得**为了让 Report"看起来更完整"而扩展 `KnowledgeLine`（若确需，另立类型变更裁定）。
(c) 新增 section **不得**引入任何 cognition 派生计数
    （禁止 `candidateCount` / `revisedCount` / `supersededCount` / `rejectedCount` / `conflictCount` 之类聚合字段）。
(d) `state` section 是 **SoT projection / read-through**，**不是 state aggregation service**。
    （此句保留为正式 Contract language。）
```

> **红线 3.2**：任何"计数/比例/汇总"型 cognition 字段都不得在 C4 新增；需要时属未来 UI 层便利字段，且必须有独立裁定。

### 3.3 ★ snapshot 历史（rev2：增加只读 CLI 出口，且不递归）

```text
report_snapshot history  ≠  ReportSections 的成员
                          （放进 sections 会造成"快照里含快照历史"的递归与膨胀）
```

**契约锁定**：snapshot 历史以**独立的只读查询面**暴露：

```text
数据面（已存在，生产 0 使用者）：
    ReportRepository.listProjections() / getLatestProjection() / getProjection() / count()
    （storage/report-repository.ts:36-72）

出口（rev2 新增，纯只读）：
    tiancha research report-history <行业> [--json]
        → 返回该 subject 的历史投影**元数据**列表：
          { reportId | dossierId, reportKind, generatedAt, methodologyVersionId, knowledgeVersion? }
        → 该列表**只能**来自已持久化的 report_snapshot 行；
          **不得**为了产生列表而重新 build Report。
```

**★ 该出口的硬约束（`C4 Contract Gate` 裁定 3）**：

```text
MUST     : 只消费 persisted report_snapshot 行（只读）
MUST NOT : 调用 ReportService.build() / generateReport() / generateDossier()
MUST NOT : 提供 --rebuild / --refresh / --regenerate / --compare-and-update 之类参数
MUST NOT : 修改任何上游 SoT（含 report_snapshot 本身）
```

> **红线 3.3a**：**Snapshot History CLI MUST consume persisted `report_snapshot` rows only;
> it MUST NOT invoke Report generation or mutate any upstream SoT.**
>
> **红线 3.3b**：Report 的自身历史 snapshot **绝不反向成为上游业务状态的 SoT**
> —— 只能被读取与展示，不能被写入、不能被当作 Gap / Priority / Knowledge 的来源。

---

## 4. SoT 绑定表

### 4.1 belief 层（cognition lifecycle）

| 展示目标 | 读取路径 | 禁止 |
|---|---|---|
| candidate | `listBeliefs()` → `state === "candidate"` | 计入 current；写入 belief |
| revised | `listBeliefs()` → `state === "revised"` | Report 自造"修订原因/新旧对比"（关系链见 §2.3 注） |
| superseded | `listBeliefs()` → `state === "superseded"` | 自造演化链 |
| rejected | `listBeliefs()` → `state === "rejected"` | 自造"拒绝原因" |
| conflicting | `listBeliefs()` → `state === "conflicting"` | 选边 / 恢复 current |
| （current） | **必须** `listCurrentBeliefs()`（`knowledge-belief.ts:29-36` 的唯一判据） | 自行重写 `state === "confirmed"` |

> **红线 4.1**：`current` 的判定**只有** `listCurrentBeliefs()` 一处；C4 不得在 Report 内复制该谓词。

### 4.2 conflict 层（D2 —— C4-A 的唯一必要新只读入口）

**现状缺口**：`KnowledgeRepository` 只有 `listOpenConflicts()`（`knowledge-repository.ts:201`），
而 `resolveConflict()`（`:186`）已经会把行写成 `resolved` / `accepted` ⇒ **数据存在、读取入口缺失**。

**C4-A 允许的最小补齐（只读）**：

```text
新增只读方法：listConflictsByStatus(status)（或等价的 listResolvedConflicts()）
        ↓
读既有 knowledge_conflict 行（不新建表、不新建投影）
```

**锁定**：
- 只读既有行 ✓；**不新建 Conflict 表 / 不新建投影** ✓；
- `resolveConflict` 的语义**不变**（仍只 `open → resolved`，仍**不恢复 current**，仍**不选 winner**）；
- Report 仅展示 `{ conflictId, dimension, claimARef, claimBRef, status }`（`ConflictLine` 既有形态 ✓）。

### 4.3 `ResearchState` 在 Report 中的允许展示面（rev2：全字段只读透传 + 派生禁区）

```text
允许（全部是既有只读字段，domain/research-state.ts:13-28）：
    version
    known / confirmed / uncertain / conflicting / unknown   （StateItemRef[]：ref [+ confidence]）
    keyQuestionIds / researchGapIds / nextActionIds         （id 列表）
    createdAt / updatedAt
```

**★ rev2 明确的派生禁区（`C4 Contract Gate`）**：

```text
禁止（无 SoT，且属"Report 成为计算器"）：
    progressPercent / completionRate / researchProgress / stagePercent
    researchQuality / researchMaturity / qualityScore
    nextBestAction / 任何"下一步最优"派生
    version 派生的一切比例（如 version / something）
```

> **红线 4.3a**：`ResearchState.version ≠ 研究进度百分比`。允许展示"state 的第 N 版"这类**事实**；
> **禁止**任何形式的 `progress = f(...)`。
>
> **红线 4.3b**：`state` section 的输出必须与 `getStateBySubject()` 的持久化行**逐字段一致**
> （read-through；篡改法可证）。

---

## 5. R1 —— Report 生成路径的隐藏写入（最小 conformance fix）

### 5.1 现状语义锁定（先锁定，再修复；**不得重新设计**）

```text
MethodologyService.getActive(baseline = METHODOLOGY_V1):
    return repo.getActiveMethodology() ?? this.bootstrap(baseline);      methodology-service.ts:82-84
MethodologyService.bootstrap(baseline):
    if (repo.getMethodology(baseline.versionId)) return existing;
    repo.upsertMethodology(baseline);            ← 写库          methodology-service.ts:74-79
```

Report 侧要求（`report-service.ts:79, 204`）：

```text
build() 只需要 methodologyVersionId（写入 snapshot 的 methodology_version_id 列）
无 active 行时的"合法语义" = 视为冻结基线 METHODOLOGY_V1（这正是 getActive 现有返回值）
```

### 5.2 ★ 允许的最小修复（rev2：锁**语义**，不锁代码形态）

> **当不存在 active methodology 时，Report 必须使用现有合法的 `METHODOLOGY_V1` fallback；
> 该 fallback 不得通过 bootstrap/upsert 持久化；Report build 对 methodology SoT 必须保持零写入。**

满足该语义的任何等价实现都合法（例如 `repo.getActiveMethodology() ?? METHODOLOGY_V1`）。**必须同时满足**：

1. `methodologyVersionId` 的**取值不变**（无行时仍为 `getActive()` 的既有返回）；
2. **零写入**（不 `bootstrap()`、不 `upsertMethodology()`）；
3. 有 active 行时行为与现在**完全一致**。

> **红线 5.2**：**禁止**在 C4 重新设计 methodology fallback 语义、禁止改 `getActive()` / `bootstrap()` 本身、
> 禁止改 `MethodologyService` 的其它行为（C4 只调整 **Report 的取用方式**）。

### 5.3 影响面

`I14` / `domain/report.ts:4-6` 声称"生成 Report 从不写任何上游行" —— R1 修复后该声明**首次真正成立**，
因此修复本身属于 **contract-conformance fix（不是语义扩张）**，与 C3-A 对 Plan 的同类修复一致。

---

## 6. 阶段边界

### 6.1 `ResearchPlanView` 不作为 C4 强依赖（D3 裁定，**维持不变**）

```text
允许：C4 与 C2 语义一致（同样的 Gap / Requirement / NextAction / Priority / ResearchState 来源）
禁止：C4 Report 依赖 C2 ResearchPlanView 实例（会造成 projection → projection 阶段耦合）
```

**理由（Gate 原文）**：两者应是**并列消费者**——`Report → underlying SoT` 与 `SoT → ResearchPlanView`；
若 C2 改 Projection DTO，不应反向影响 Report。

### 6.2 C / D1 正式进入 OUT / External Dependency（★ 不是 TODO）

```text
C4 External Dependency（需另立阶段与新 SoT，C4 不补）：
  1. Gap 生命周期历史（created → resolved → reopened）
  2. NextAction 取消历史（open → cancelled → open）
  3. research progression 指标（完成度 / 质量 / 百分比）

C4 OUT：
  D1 新 SoT / 新表 / migration（含为上述三项建事件表或 history 表）
```

---

## 7. 红线（C4 一律不做）

1. **Report 不得调用 `rank()`**（继续只允许既有写入路径调用；C3 `I-C3-8` 继续有效）。
2. **Report 不得重新计算 Priority**（必须 `currentPriorities()`）。
3. **Report 不得计算 research progress / quality / next-best-action**（S6-R1）。
4. **Report 不得写 Gap / NextAction / Knowledge / Belief / Pool / Requirement / ResearchState / Evaluation**。
5. **`candidate` 不得进入 `currentKnowledge` / `mainJudgments`**；`current` 唯一判据仍是 `confirmed`。
6. **不得自动 resolve conflict / 选 winner**；`resolveConflict` 语义不变。
7. **不得改 Priority Policy / factors / acquisitionValue / NextAction 语义**（C3 冻结）。
8. **不得接入 legacy**：`src/server.ts` / `src/store.ts` / `src/invest-extension.ts` / `data/plans.json`、
   以及 `planning/` `evidence/` `agents/` `dossier/` `scheduler/` 一律不接入。
9. **不得因为"缺字段"而自行推导**（缺 SoT ⇒ 进 OUT / External Dependency，见 §6.2）。
10. **不得新增表 / migration**；不得新建 Conflict 投影表（§4.2）。
11. **不得把 Report 自身历史 snapshot 当作上游 SoT**（§3.3b）。
12. **不得修改 C1 / C2 / C3 已 FINAL LOCK 的契约**。
13. **不得新增 Report 的业务决策权**（C4 只扩消费面，不扩决策权）。
14. **不得删改 `KnowledgeBelief` / `KnowledgeConflict` / `Claim` 行**（历史只增不改）。
15. **不得引入 LLM / Web / 外部数据**。
16. ★ **不得引入任何 cognition 派生计数/比例/汇总字段**（`*Count` / `*Rate` / `*Percent` 等，§3.2 红线）。
17. ★ **ResearchState 派生指标一律禁止**：`progressPercent` / `completionRate` / `researchQuality` /
    `researchMaturity` / `nextBestAction` 及其任何等价物（§4.3 红线）。
18. ★ **Snapshot History CLI 不得触发 Report 生成**：只消费 persisted `report_snapshot` 行，
    不得调用 `build()` / `generateReport()` / `generateDossier()`，不得提供 `--rebuild` / `--refresh` /
    `--regenerate` / `--compare-and-update`（§3.3a）。
19. ★ **不得扩展 `KnowledgeLine` 类型来"顺手补字段"**（如 `historicalRelations` / `createdAt` / `updatedAt`）；
    若确需，属**独立类型变更**并须单独裁定（§2.2 / §12.3）。

---

## 8. 验证矩阵（T-C4-1 … T-C4-18，每条附**破坏点**）

> C4 与 C3 的一个关键区别：**C4 会有真实生产代码变化**，因此不能只做 happy path =
> pass，必须证明 **正确实现 → PASS**、**故意破坏（删保护 / 改 SoT 来源 / 加派生计算 / 触发 build）→ TEST RED**。

### 8.1 cognition 展示（§3.2）— C4-A

| # | 验证内容 | 破坏点（应转红） |
|---|---|---|
| T-C4-1 | `pendingCandidates` 只含 `state==="candidate"`，且**不出现在** `currentKnowledge` / `mainJudgments` | 把 candidate 并入 `currentKnowledge` ⇒ 红 |
| T-C4-2 | `revisedBeliefs` 只含 `revised`，字段与 SoT **逐字一致**（透传既有 5 字段） | 在 Report 里改写字段/自造内容 ⇒ 红 |
| T-C4-3 | `supersededBeliefs` / `rejectedBeliefs` / `conflictingBeliefs` 各自只含对应 state | 放宽 state 过滤 ⇒ 红 |
| T-C4-4 | **全部 5 个非 current state 逐一断言**：永不进入 `currentKnowledge` / `mainJudgments` | 同 T-C4-1 |
| T-C4-5 | 新增 section 排序确定性（`dimension asc → beliefId asc`），重复生成结果一致 | 改成插入序 ⇒ 红 |
| T-C4-6 | **不得出现任何 cognition 派生计数**（运行时断言 sections 中无 `*Count`/`*Rate` 字段 + 静态断言） | 加一个 `candidateCount` ⇒ 红 |

### 8.2 conflict 展示（§4.2）— C4-A

| # | 验证内容 | 破坏点 |
|---|---|---|
| T-C4-7 | `conflicts`（open）语义不变；`conflictHistory` 只含 `resolved` / `accepted` | 把 resolved 混入 `conflicts` ⇒ 红 |
| T-C4-8 | 新只读入口读的是**既有行**（篡改一行的 `status` 后 Report 跟随） | 让 Report 自己造 conflict ⇒ 红 |
| T-C4-9 | Report **不调用** `resolveConflict`（生成前后 `knowledge_conflict` 行 byte-identical） | 加一次 resolve ⇒ 红 |

### 8.3 ResearchState 展示（§4.3）— C4-A

| # | 验证内容 | 破坏点 |
|---|---|---|
| T-C4-10 | `state` section 每字段与 `getStateBySubject()` **逐字段一致**（篡改法） | Report 自行重算 ⇒ 红 |
| T-C4-11 | 无 persisted state ⇒ `state === null`（**不伪造**） | 伪造空 state ⇒ 红 |
| T-C4-12a | **不存在任何 progress / quality / maturity / nextBest 字段**（静态 + 运行时双重断言） | 加 `progressPercent` ⇒ 红 |

### 8.4 零写入与 S6-R1（§5, §7）— 归属 C4-A（T-C4-12…15）/ 归属 C4-B（T-C4-16…17）

| # | 验证内容 | 证据强度 | 破坏点 |
|---|---|---|---|
| T-C4-12 | **R1（Layer 1+2）**：`methodology` 表存在时，Report 生成不写 `methodology`（`total_changes()` + 行指纹） | Layer 1 + 2 | 恢复 `getActive()` ⇒ 红 |
| T-C4-13 | ★ **R1（Layer 3，强制）**：**真实 SQLite + `methodology` 0 行**场景下生成 Report ⇒ 该表仍 0 行；且 `上游 SoT changes = 0 / report_snapshot changes = 1` | **Layer 3（必做）** | 恢复 `getActive()` ⇒ 红 |
| T-C4-14 | **生成 Report 的上游零写入**：除 `report_snapshot` 外全部 24 表 byte-identical（含 `methodology`） | Layer 2 + 3 | 任一上游被写 ⇒ 红 |
| T-C4-15 | **Report 不调用 `rank()`**：静态生产调用点审计（`rank()` 唯一调用者仍是 `knowledge-projection-service.ts`） | Layer 1 | 在 Report 里调 `rank()` ⇒ 红 |
| T-C4-16（C4-B） | **snapshot 历史出口只读**：查询前后 24 表指纹不变；且**未调用** `build()`（计数断言 + `report_snapshot` 行数不变） | Layer 1 + 2 | 让查询触发 build ⇒ 红 |
| T-C4-17（C4-B） | **flag 守卫**：`report-history` 不接受 `--rebuild` / `--refresh` / `--regenerate`（未知参数 ⇒ usage 错误） | Layer 2 | 接受并执行 ⇒ 红 |

### 8.5 与 `current` 判据的一致性（§23 原文要求）— C4-A

| # | 验证内容 | 破坏点 |
|---|---|---|
| T-C4-18 | Report 的"当前认知"与 `listCurrentBeliefs()` **完全一致**（数量 + 逐条 `beliefId/state/claimRef`） | 在 Report 内重写 current 谓词且判据不同 ⇒ 红 |

---

## 9. 不变量（I-C4-x）

```text
I-C4-1  Report 是 read projection；report_snapshot 是 append-only 投影，不是 SoT。
I-C4-2  current 的唯一判据 = KnowledgeBelief.state === "confirmed"（且只经 listCurrentBeliefs()）。
I-C4-3  非 current belief（candidate/revised/superseded/rejected/conflicting）只能出现在 §3.2 的 section，
        永不进入 currentKnowledge / mainJudgments；且 rejected 与其它非 current 状态**同等合法、同等可观察**
        （不是要求 UI 对称）。
I-C4-4  Priority 只经 currentPriorities() 读取；rank() 的生产调用者仍唯一（写入路径）。
I-C4-5  Report 生成不写任何上游表（含 methodology，R1 修复后成立）。
I-C4-6  Report 不计算 progress / quality / maturity / next-best-action；不产出任何 cognition 派生计数。
I-C4-7  Report 的自身 snapshot 历史只读、且不作为任何上游状态的来源。
I-C4-8  C4 不新增 domain 类型（复用 KnowledgeLine / ConflictLine）、不新增表、不新增 migration；
        也不得为"顺手补字段"扩展 KnowledgeLine。
I-C4-9  缺 SoT 的三项（gap 历史 / action 取消历史 / progression）= External Dependency，非 C4 TODO。
I-C4-10 C4 与 C2 语义一致，但不依赖 ResearchPlanView 实例（两者是并列消费者）。
I-C4-11 C3 冻结的 Priority / NextAction 语义在 C4 中保持冻结。
I-C4-12 state section = 全字段 read-through（透传既有字段），不是 aggregation service。
I-C4-13 Snapshot history 出口只消费 persisted report_snapshot 行，绝不触发 Report 生成或任何上游写入。
I-C4-14 R1：无 active methodology 时使用 METHODOLOGY_V1 fallback 且**不持久化**（零写入）。
I-C4-15 state === "revised"/"superseded" 只表达**状态**；修订/替代**关系链**不在 KnowledgeLine 中，
        C4 不得声称已展示该关系链。
```

---

## 10. 门禁与证据强度

```text
npx tsc --noEmit                            → 0
npm --prefix packages/research run typecheck → 0
全量测试（packages/research + src/agent + src/cli）
真实 child-session smoke：tiancha research smoke → PASS (child-session=real)
真实库演练 + byte-identical 恢复（含 journal_mode 与 -wal/-shm 检查）
越界自检（黑名单零触碰）
```

**三层证据（沿用 C3）**：

```text
Layer 1  静态结构证据（生产调用点审计 / 黑名单 grep / 类型与不变量检查）
Layer 2  自动化测试证据（§8 矩阵，证明真实不变量与 red→green）
Layer 3  真实 SQLite / child-session 行为证据
```

**★ rev2 的强制要求**：`T-C4-13`（R1 的**无-methodology 真实 SQLite** 场景）**必须包含 Layer 3**，
且结果判据为：

```text
上游 SoT changes        = 0
report_snapshot changes = 1        ← C4 唯一允许的写入
```

测试结论必须**如实记录既有 flaky**（`C1-29`），不得为"全绿"而修。

---

## 11. 明确不做（OUT）

```text
新表 / 迁移 / 事件表 / history 表（含为 gap 历史、action 取消历史、progression 建表）
Report 自算 progress / quality / maturity / next-best-action；任何 cognition 派生计数
Report 重算 Priority / 调用 rank()
Report 修改任何上游状态（Gap / NextAction / Knowledge / Belief / Pool / Requirement / State / Evaluation / Conflict）
自动 resolve conflict / 选 winner / 恢复 current
candidate 进入 current
改变 C3 已冻结的 Priority Policy / factors / acquisitionValue / NextAction 语义
扩展 KnowledgeLine 类型（historicalRelations / createdAt / updatedAt 等）作为 C4 的"顺手补字段"
接入 C2 ResearchPlanView 作为强依赖
report-history 的 --rebuild / --refresh / --regenerate / --compare-and-update
legacy（server/store/invest-extension/plans.json）与 planning/evidence/agents/dossier/scheduler 接入
Evidence / Fragment / Knowledge extraction（新增）
Company / Chain domain 完整化；Target recommendation；LLM；Web / 外部数据
Research execution / field research
C1-29 flaky 修复（独立事项，不夹带）
```

---

## 12. 裁决记录

### 12.1 第一轮（Fact-Finding 后的 A–E / R1 / R2 裁定）

| # | 裁定 | 落地位置 |
|---|---|---|
| R1 | 🟢 纳入，**仅作为 contract-conformance fix** | §5 |
| R2 | 🟢 纳入，作为**只读消费** | §4.3 |
| A | 🟢 全部进入 C4 候选消费面 | §3.2 / §4 |
| B | 🟢 作为 C4 主体 | §3.2 / §3.3 / §4.1 / §4.2 |
| C | 🔴 **C4 OUT / External Dependency**（非 TODO） | §6.2 / §11 |
| D1 | 🔴 C4 OUT（新 SoT） | §6.2 |
| D2 | 🟢 纳入（resolved/accepted conflict 只读入口） | §4.2 |
| D3 | 🟡 不作强依赖 | §6.1 |
| E | 🔴 全部转为 Red Lines | §7 |

### 12.2 第二轮（`C4 Contract Gate` 有条件通过后的冻结裁定）

| # | 裁定 | 落地位置 |
|---|---|---|
| 1 | **`rejected` 纳入 canonical sections（正式冻结，不再待裁定）** | §3.2（`rejectedBeliefs`）+ §3.2(a) + I-C4-3 |
| 2 | **state 采用既有字段的全量只读透传，不新增 cognition 派生计数** | §3.2(b)(c)(d) + §4.3 + 红线 16 + I-C4-12 |
| 3 | **snapshot history 增加纯只读 CLI 查询出口**（`research report-history <行业> [--json]`） | §3.3 + 红线 18 + T-C4-16/17 + I-C4-13 |
| 4 | **拆成 C4-A / C4-B**（各自范围与风险性质） | §0.4 |
| 5 | **R1 的 T-C4-12/13 强制 Layer 3（真实 SQLite 无 methodology 行）** | §8.4（T-C4-13）+ §10 |
| + | **ResearchState 派生指标禁区**（progress/quality/maturity/nextBest） | §4.3 红线 4.3a + 红线 17 |
| + | **snapshot history CLI 不得触发 Report 生成** | §3.3a + 红线 18 + I-C4-13 |
| + | **"同等展示" = 同等合法性 / 同等可观察性（不要求 UI 对称）** | §3.2(a) + I-C4-3 |
| + | **不得为"顺手补字段"扩展 `KnowledgeLine`** | §2.2 + 红线 19 + I-C4-8 + I-C4-15 |
| + | **状态语义 ≠ 关系语义**（`state="revised"` 不等于展示了修订关系链） | §2.3 注 + I-C4-15 |

### 12.3 ★ 已裁定事项（原为"Final Gate 前仍需裁定的 3 项"，已于 `C4 Contract Final Gate` 裁定）

> 本节保留三项**原问题原文**作为历史痕迹，并在每项下给出**最终裁定**。
> 这次回写是 **docs-only 最小改动**：**不重新打开 Final Gate**、**不改变 C4 实施边界**、
> **不修改契约其它任何内容**。

```text
1) 原问题：KnowledgeLine 是否扩展？
   Gate 第 2 条同时点名 `historicalRelations` / `createdAt` / `updatedAt`，
   但又限定"以现有 KnowledgeLine 字段为准、不要新造字段"。本 rev2 取后者：
       透传字段 = beliefId / dimension / state / claimRef / sourceRef
   若 Final Gate 要求把 `historicalRelations`（或时间戳）也透传给 belief 型 section，
   则属 **KnowledgeLine 类型变更**（需单独批准，且会扩大 C4-A 的改动面）。
   注意：`claimRef` ≠ `claimId`，二者不可混用。

   ★ 最终裁定：**不扩展 `KnowledgeLine`。**
     C4 只透传既有 5 个字段（beliefId / dimension / state / claimRef / sourceRef）；
     `historicalRelations` / `createdAt` / `updatedAt` 一律不得加入。
     未来若确需，必须另立类型变更决策，不得偷偷塞进 C4-A。

2) 原问题：Agent 是否也需要 history 出口？
   Gate 原文为"若确有必要"。本 rev2 只承诺 **CLI** 只读出口
   （`research report-history <行业> [--json]`）；Agent 侧是否新增只读工具待裁定。

   ★ 最终裁定：**C4 不新增 Agent history 出口。**
     Snapshot history 只作为 **CLI** 只读面（属 C4-B）；CLI 已满足当前审计与人工检查需要。
     未来若业务确有需要，再单独新增只读工具，不提前锁进 C4。

3) 原问题：新增 CLI 子命令的接线点是否按此锁定？
   `src/cli/research-commands.ts` 的 `ResearchSubcommand` union（:82-90）与
   `RESEARCH_SUBCOMMANDS` 数组必须同步（与 C2 Step 2-C 新增 `plan` 时同构）；
   若只改 handler 而漏改 union/注册面，CLI 将无法到达该子命令。

   ★ 最终裁定：**锁定三者闭环** —— `ResearchSubcommand` union + `RESEARCH_SUBCOMMANDS` + handler。
     只新增 handler 不算完成；C4-B 实现必须三者同时接通。
```

> 本次回写**不改变** Gate 通过时的任何边界、红线、验证矩阵或不变量。

---

## 13. 与既有契约的关系

### 13.1 层级

```text
docs/phaseC/implementation-contract.md          （Phase C 主契约，§23 = C4 原则）
        │
        ├── c2-implementation-contract.md                  （C2 语义链）
        ├── c2-phase2-implementation-contract.md           （C2 Phase 2 FINAL LOCK）
        ├── c3-implementation-contract.md                  （C3 验证契约，已实现并发布）
        └── c4-implementation-contract.md                  ← 本文档（C4 展开，rev2）
```

### 13.2 与 C3 的关系

C3 冻结的 Priority / NextAction 边界在 C4 **继续有效**：Report 仍必须经 `currentPriorities()` 读取，
`rank()` 的生产调用者仍唯一。C4 **不重新打开**任何 C3 已锁定的语义。

### 13.3 与 C2 的关系

C4 与 C2 **语义一致**（同样的 SoT 来源），但**不依赖** `ResearchPlanView` 实例（§6.1）—— 两者是并列消费者。

---

## 14. 定稿确认

- 本契约**不修改**任何既有 FINAL LOCK 文档；
- 本契约**不含代码**；实现必须在通过 `C4 Contract Final Gate` 后**单独授权**；
- 实施按 §0.4 的 `C4-A` / `C4-B` 两步推进，每步独立验收；
- 每步交付遵循既有纪律：实现 → diff 摘要 → 测试（证明真实不变量 + red→green）→ 两处 tsc + 全量 + smoke → 真实运行证据 → 越界自检 → 独立审计 → **commit 与 push 各自单独授权**。

---

## 15. 附：基线事实索引（供逐条核验，基线 `72151b5`）

```text
packages/research/src/domain/report.ts:1-14             Report 是投影 / I14 红线
packages/research/src/domain/report.ts:19-25            KnowledgeLine（已含 state；字段清单）
packages/research/src/domain/report.ts:28-34            ConflictLine（已含 status）
packages/research/src/domain/report.ts:96-108           ReportSections（10 section）
packages/research/src/domain/knowledge-belief.ts:12-36  KnowledgeBeliefState + isCurrentBelief
packages/research/src/domain/knowledge-belief.ts:49-55  KnowledgeRelation（SUPPORT/REVISE/CONFLICT/SUPERSEDE）
packages/research/src/domain/knowledge-belief.ts:9      行永不删除，只翻转 state
packages/research/src/domain/knowledge-conflict.ts:4-24 never pick a side / 状态 / 字段
packages/research/src/domain/research-state.ts:13-28    ResearchState 字段
packages/research/src/domain/research-gap.ts:22-37      ResearchGap（无 status 历史）
packages/research/src/domain/claim.ts:26,46             Claim.temporalRelation
packages/research/src/application/report-service.ts:2-9 读/写面声明
packages/research/src/application/report-service.ts:76-218 build() 的 10 个读入口与 10 个 section
packages/research/src/application/report-service.ts:82  ⚠️ getActive() 隐藏写入（R1）
packages/research/src/application/report-service.ts:178-189 Priority 只读面 + 禁止重算注释
packages/research/src/application/methodology-service.ts:74-84  bootstrap() / getActive()
packages/research/src/storage/report-repository.ts:4-5,16-34,36-72  append-only + 历史读取能力
packages/research/src/storage/knowledge-repository.ts:87-128      beliefs 读取（含 state 过滤）
packages/research/src/storage/knowledge-repository.ts:186,201     resolveConflict / listOpenConflicts（缺 resolved 读取）
packages/research/src/s6-report.test.ts:197-237         Report 不重算（篡改 + 注入先例）
src/cli/research-commands.ts:82-90                      ResearchSubcommand union + RESEARCH_SUBCOMMANDS（新子命令接线点）
src/cli/research-commands.ts:176-183                    CLI report 出口
src/agent/research-tools.ts:371-381                     Agent research_report
```

（以上行号对应基线 `72151b5`；若实现阶段发现漂移，先报告。）
