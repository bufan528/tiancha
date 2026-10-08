# Phase C6 H-4 Read-only Lifecycle / State Semantics Findings

```text
Document kind     : READ-ONLY AUDIT RECORD
Scope             : Lifecycle / State Semantics（状态是什么、谁能改变它、如何合法变化）
Nature            : Read-only architecture review —— 只回答「当前状态语义架构是否自洽」
Implementation    : NONE
Contract          : NONE
Authorization     : NONE
Remediation       : NONE
Baseline          : HEAD = origin/main = ls-remote = 24f86c300f094c6b5da6dee154fe7d48a6ed59b1
```

---

## §1 Scope / Boundary Review

```text
唯一要答的问题 : 当前【状态语义架构】是否自洽？
不是           : 把所有 enum / status 搜一遍
链位           : H-2（谁是事实来源）→ H-3（谁有权读写）→ H-4（状态是什么、如何合法变化）
```

### §1.1 Owner 的三分（★ 文字精化 ①）

```text
Owner 不是一个概念，必须拆成三层：
  ① Semantic Authority            谁定义该状态的业务语义
  ② Transition Authority          谁拥有合法状态转换入口
  ③ Persistence / Projection Writer 谁负责持久化 / 投影写入

要求（不是「三者必须唯一且相同」）：
  ★ 同一语义状态【不得存在竞争性的 Semantic Authority / Transition Authority】
```

### §1.2 两条正交关系（★ 文字精化 ②③）

```text
★ Transition Legality  ≠  Runtime Reachability
   合法转换路径存在，不代表当前生产代码一定已经能到达该状态。

★ Semantic Authority   ⟂  Runtime Reachability
   一个状态可以语义上定义完整，但当前完全没有生产入口。
   ⇒ 这正好解释 H4-01（TaskStatus.cancelled）
```

### §1.3 6 个核心 Gate

```text
H4-01  Semantic Owner      每个核心状态机是否存在唯一语义 owner？
H4-02  State Meaning       每个状态是否代表一个事实，而非仅存在于 enum？
H4-03  Legal Transition    合法转换是否明确（From → To → Entry Point → Owner）？
H4-04  No Re-interpretation 同一状态是否被多个模块重新定义？
H4-05  Cross-layer Vocabulary 跨层同名 / 异名同义状态是否被混用？
H4-06  Historical vs Current 历史状态与当前状态是否严格分离？
```

---

## §2 R1 State Inventory + R2 Semantic Classification

```text
R1 实测（domain / src 全层，40+ 状态类型）：
  Lifecycle State : TaskStatus · TaskAttemptStatus · ResearchRunStatus · ResearchRoundStatus ·
                    MaterialIngestStatus · ExtractionStatus · RequirementStatus · GapStatus ·
                    QuestionStatus · NextActionStatus · TargetStatus · PreparationStatus ·
                    HumanGateStatus · MethodologyCandidateStatus · KnowledgeConflictStatus ·
                    DimensionEvalStatus · VerificationStatus · ReservationStatus · ReserveStatus ·
                    TargetProposalStatus · CandidateReviewStatus · CandidateProjectionStatus ·
                    MaterialBlockState · ReportStateLine
  Temporal Relation : ClaimTemporalRelation（current | old | superseded）
  Current Predicate : KnowledgeBeliefState.confirmed（唯一 current）
  Projection Flag   : DiligenceQuestionState（current | retired）· TargetAssociationStatus
  Kind（★ 不得误判为 lifecycle）:
                    ArtifactKind · CandidateContentKind · NextActionKind · ReportKind · MaterialKind ·
                    HumanGateKind · RelationType · KnowledgeRelationType · CandidateRelation ·
                    PoolItemRelation · ParsedRelationHint · ClaimSubjectKind · KnowledgeSubjectKind ·
                    TargetDecisionKind · ProposalDecisionKind
  Version / Stage   : MaterialIngestStage（received | parsed | projecting | migration）

★ R2 分类目的：防止把 `kind = execution` 之类的 Kind 误当成 lifecycle state。
```

---

## §3 R3 Transition Ownership

### 🟢 正面基准 ① — TaskEngine.setStatus（显式 terminal guard）

```text
task-engine.ts:142-146
  private setStatus(task: ResearchTask, status: TaskStatus): void {
    if (isTaskTerminal(task.status) && task.status !== status) {
      throw new Error(`cannot transition terminal task ${task.taskId} (${task.status})`);
    }
    this.set(task, { status, updatedAt: new Date().toISOString() });
  }

⇒ Task 的全部转换【唯一经过 setStatus】⇒ Transition Authority = TaskEngine，唯一 ✓
⇒ terminal 保护显式存在（含 throw）✓
⇒ TaskEngine 公开 lifecycle 入口：start(:53) · complete(:100) · fail(:113)（+ enqueue/get/list/listAttempts）
```

### 🟢 正面基准 ② — isEvolvableBeliefState + evolution-target（显式 legal predecessor）

```text
knowledge-belief.ts:45-46
  export function isEvolvableBeliefState(state): boolean {
    return state === "confirmed" || state === "conflicting";
  }
knowledge-belief.ts:41-43（逐字理由）
  「Dimension-level CONFLICT moves EVERY confirmed belief of that dimension to `conflicting`;
    if only `confirmed` were evolvable, "explicit evolution is the legal way out of an open conflict"
    would be algorithmically unreachable.」
evolution-target.ts:40
  「evolution target … is not in an evolvable state (only "confirmed" or "conflicting" may be
    superseded/revised)」

⇒ REVISE / SUPERSEDE 的合法前置【显式定义 + 逐字理由 + 强制执行点】✓✓
```

---

## §4 R4 Transition Legality

```text
KnowledgeBelief 的 5 个转换入口（全部在 KPS，唯一 Transition Authority）：
  KPS:282  updateBeliefState(anchor.beliefId, targetState)      ← REVISE / SUPERSEDE（经 isEvolvable 校验）
  KPS:297  updateBeliefState(belief.beliefId, "conflicting")     ← dimension-level CONFLICT
  KPS:407  updateBeliefState(target.beliefId, targetState)
  KPS:412  updateBeliefState(beliefId, "confirmed")
  KPS:446  updateBeliefState(beliefId, "rejected")

KnowledgeBeliefState 的逐字语义（knowledge-belief.ts:12-24 —— ★ 全仓唯一的完整注释状态机）：
  candidate   「Phase C: awaits an explicit human confirmation. NEVER current.」
  confirmed   「The ONLY current state.」
  rejected    「explicitly rejected by a human. Neither current nor historical fact.」
  revised     「Kept as history; no longer current.」
  （conflicting / superseded 同族）
  ⇒ 可作为其它状态机的语义注释基准
```

---

## §5 R5 Cross-layer Vocabulary

### §5.1 同名 ≠ 同义，且每层均有独立语义声明 🟢

```text
"confirmed" × 6 —— 各层语义均已在代码中声明：
  ① KnowledgeBeliefState  : 「The ONLY current state」knowledge-belief.ts:16
  ② CandidateReviewStatus : 「a REVIEW state, never "objective truth"」claim-candidate.ts:24 ·
                            「content_kind 与 reviewStatus 正交（I-C6-3）」research-db.ts:412
  ③ PoolStatus            : 「Legacy pool status → slot status: confirmed→sufficient」information-pool.ts:72
  ④ HypothesisStatus      : Hypothesis 层（claim.ts:21）
  ⑤ TargetProposalStatus  : 「the proposal's OWN state machine」research-db.ts:572
  ⑥ ProposalDecisionKind  : 决策结果
  ⇒ 结论：非语义漂移，而是【已分层的同名状态】✓

"open" × 6（Hypothesis / Requirement / KnowledgeConflict / NextAction / Gap / Question）
  · Gap 侧唯一 predicate = isActiveGapStatus（active-requirement.ts:34）✓
  · 其它各自独立 ⇒ 未发现跨层复用同一 predicate ✓

"completed" × 5（Task / Run / Round / Extraction / MaterialIngest）
  · round.ts:20「Round terminal statuses. Mirrors RUN_TERMINAL_STATUSES / TASK_TERMINAL_STATUSES」
  ⇒ 显式声明对称 ✓
```

---

## §6 R6 Historical vs Current Separation

```text
🟢 分离成立：
  · ClaimTemporalRelation（current | old | superseded）= Claim artifact 层的【时间关系】
  · KnowledgeBeliefState（… | revised | conflicting | superseded）= belief 的【lifecycle】
  · knowledge-repository.ts:133「Flip a belief's state (e.g. confirmed→revised/superseded/conflicting)」
  · 两个独立写入者：supersedeClaim（temporalRelation）vs KPS.updateBeliefState（lifecycle）
  ⇒ 「Historical relation ≠ lifecycle state」成立 ✓（H2-04 的深化）
```

---

## §7 Findings

### H4-01 · 🟡 REGISTERED / DECLARED-BUT-UNWIRED · NO-FIX — `TaskStatus.cancelled`

```text
Evidence    : task.ts:36 定义 · :41 TASK_TERMINAL_STATUSES 收录该状态
              生产赋值点 = 0（全仓 runtime/ 与 src/）
              TaskEngine 无 cancel 方法（0 处命中）
              测试引用该状态：phase-c7-round-execution-driver.test.ts:104/176 ·
                             phase-c7-round-lifecycle.test.ts:105
              ★ 但 orchestrator.ts:29 / :183 注释【预期该状态存在】：
                  「It NEVER implies waiting / failed / blocked / cancelled (D-RED-4)」
                  「A failed / cancelled dependency makes the task [not ready]」
Semantics   : ★ 语义【不 ambiguous】—— `cancelled` 的含义明确（terminal；表示任务被取消）
              真正未知的是【runtime reachability】，而非该状态的语义
Impact      : 该状态当前不可达；不影响运行（属 declared-but-unwired）
Disposition : 🟡 REGISTERED / DECLARED-BUT-UNWIRED · NO-FIX
★ 与 H2-01 / H3-03 同族：declared-but-unwired
★ 正交性：Transition Legality ≠ Runtime Reachability（见 §1.2）
```

### H4-02 · 📋 REGISTERED / LEGACY · NO-FIX — `PoolStatus`

```text
Evidence    : information-pool.ts:55 PoolStatus = confirmed | partial | unknown | conflict
              :62 InformationPoolEntry.status · :73 migrateLegacyPoolStatus()
              生产消费者 = 0（KPS:665 消费的是 `PoolSlotStatus`，非 `PoolStatus`）
Disposition : 📋 REGISTERED / LEGACY（与 H3-02 同形）
```

### H4-03 · 🟡 REGISTERED / WATCH · NO-FIX — PoolSlotStatus → GapStatus / RequirementStatus 映射链

```text
Evidence    : KPS:665  const poolStatus: PoolSlotStatus = slot?.status ?? "unknown"
              KPS:668  uncertaintyFor(poolStatus)
              KPS:669  gapTypeFor(poolStatus)
              KPS:676  syncRequirementStatus(repo, req, "met", now)                    （slot sufficient）
              KPS:696  syncRequirementStatus(repo, req, poolStatus === "unknown" ? "open" : "partially_met", now)
              research-gap.ts:8-10 逐字映射注释：
                 unknown → (no information at all) · partial → insufficient · conflicting → conflict
              active-requirement.ts:34 isActiveGapStatus（唯一 Gap active predicate）

判定        : 三类状态（PoolSlotStatus → GapStatus/gapType → RequirementStatus）之间存在【单向映射】，
              且映射【集中在一处】（KPS:665-696 + syncRequirementStatus）
              ⇒ 合法分层映射，【非】语义漂移
Watch 理由  : 防止未来某模块写出「gap active ⇒ requirement met」这类越过契约的语义跳跃
Disposition : 🟡 REGISTERED / WATCH · NO-FIX
★ 不因「它是合法映射」而修掉它（合法 ≠ 应重写）
```

### H4-04 · 📋 REGISTERED / SAFE COUPLING · NO-FIX — `MaterialIngestStatus.completed` 与 evidence 确认度

```text
Evidence    : material-confirmation.ts:15「CONSERVATIVE: anything not positively attributable to a
               `completed` material is not confirmed.」· :68 同义
              material-ingest-service.ts:284「Only a `completed` material may own confirmed evidence」
判定        : 设计意图（CONSERVATIVE 策略，防「崩溃使 Claim 看似 confirmed」）⇒ **已声明的合法耦合**
★ 与「Artifact exists ≠ Task completed」同族 —— 跨层状态确实参与上层语义判定，但属显式声明
Disposition : 📋 REGISTERED / DECLARED SAFE COUPLING · NO-FIX
```

---

## §8 Architecture Governance Gate（H-4 版 6 问）

```text
① 每个核心状态机是否有唯一 Semantic / Transition Authority？   🟢（Task→TaskEngine 唯一 setter；
                                                                Knowledge→KPS 独占 5 个转换入口）
② 每个状态是否有明确语义（非仅命名）？                        🟢（KnowledgeBeliefState 为全仓唯一带
                                                                完整逐字注释的状态机；Pool/Gap/Candidate 亦有注释）
③ 合法转换是否有明确入口？                                    🟢（两个正面基准：setStatus terminal guard ·
                                                                isEvolvableBeliefState + evolution-target）
④ 是否存在多模块重新解释同一状态？                            🟢 未发现
⑤ 跨层同名 / 异名同义状态是否被混用？                          🟡（H4-03 映射链合法但登记为 WATCH）
⑥ 历史状态与当前状态是否严格分离？                             🟢
```

---

## §9 Disposition

```text
H-4 Read-only Lifecycle / State Semantics Review   🟢 FINAL PASS / NO-FIX
Real defects                                       0
Remediation                                        0
架构债务新增                                        0

H4-01 🟡 REGISTERED / DECLARED-BUT-UNWIRED · NO-FIX
H4-02 📋 REGISTERED / LEGACY · NO-FIX
H4-03 🟡 REGISTERED / WATCH · NO-FIX
H4-04 📋 REGISTERED / DECLARED SAFE COUPLING · NO-FIX
```

---

## §10 Out of scope / 明确未做

```text
❌ 未修改 production code / tests
❌ 未修改 enum / 状态机 / 命名
❌ 未重构 Repository · 未删除 legacy 字段
❌ 未 remediation（H4-01 / H4-02 / H4-03 / H4-04 全部仅登记）
❌ 未修改 H-1 / H-2 / H-3 / R6-ERR Proposal
❌ 未修改 Methodology v1 / HANDOFF / README
❌ 未 commit · 未 push · 未 Freeze
❌ 未处理 colleague artifacts
❌ 未并行启动 H-5
```

---

## §11 交叉引用（不在本记录范围内）

```text
H-5 Evolution / Version / Extension Safety
  待答：① Version owner 是否完整 ② 新模块能否不复制 SoT 语义接入（H-3 Gate ⑦ 的 NOT YET）
  顺序：H-4 record → H-5（严格串行，不并行）
  ⛔ 未授权

R6-ERR Formal Freeze
  前置：H-1 → H-2 → H-3 → H-4 → H-5 → Comprehensive Architecture Governance Review
  ⛔ NOT AUTHORIZED
```
