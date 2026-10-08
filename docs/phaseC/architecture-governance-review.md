# H-6 Comprehensive Architecture Governance Review

```text
Document kind     : READ-ONLY ARCHITECTURE GOVERNANCE REVIEW
Nature            : 横向一致性验证（H-1 → H-5 是否真正闭环）
Implementation    : NONE
Contract          : NONE
Authorization     : NONE（本记录不构成任何授权）
Remediation       : NONE
Frozen            : NO（本记录不是冻结契约）
Baseline          : HEAD = origin/main = ls-remote = 277447561a4aaccd882367f5ee4b2fc57ffd665c
Second-level review : 🟢 ACCEPTED（G1–G6 / Readiness / Verdict 均接受）
```

---

## §1 Scope / Boundary

```text
唯一要答的更高层问题 :
  经过 H-1 → H-5 的连续审计，Tiancha 当前核心架构是否已形成一个
  【自洽、无竞争权威、可安全演进】的整体？

★ 不做第六轮局部代码扫描（防无限审计）
★ 只验证「跨轮次是否闭环」，不新增局部 Gate
★ 性质 = read-only architecture governance review

治理边界分离：
  H-6（Review）  ≠  R6-ERR Formal Freeze（Governance Decision）
```

---

## §2 Baseline / 输入范围

```text
Baseline : HEAD = origin/main = ls-remote = 277447561a4aaccd882367f5ee4b2fc57ffd665c · ahead/behind 0/0

输入（只读 · 6 份已发布文档）：
  docs/phaseC/h1-sufficiency-remediation-contract.md   376 行
  docs/phaseC/h2-preflight-findings.md                 363 行（含 §14 Erratum）
  docs/phaseC/h3-preflight-findings.md                 259 行
  docs/phaseC/h4-preflight-findings.md                 306 行
  docs/phaseC/h5-preflight-findings.md                 338 行
  docs/phaseC/r6err-proposal-refinement-record.md      259 行

代码：仅读取【验证具体断言所必需的最小锚点】，未做范围外扩展扫描。
```

---

## §3 G1 SoT Coherence 🟢 PASS

```text
竞争者三分类（不用单一「竞争者」字段）：
  Competing Semantic Authority      = 0
  Competing SoT / Current Predicate = 0
  Legacy / Projection-only          = 可存在，但必须【无业务语义权威】
```

| 语义 | 当前 Authority / SoT | Writer | Competing Semantic Authority | Competing SoT/Current | Legacy/Projection-only |
|---|---|---|---|---|---|
| Current Knowledge | `isCurrentBelief()`（`knowledge-belief.ts:34-35`，唯一定义） | KPS | **0** | **0** | `industry.current_knowledge_id`（业务读取 = 0） |
| Requirement | `repo.listRequirements()` | `opportunity-discovery:167`（creation）· `KPS:854`（status sync） | **0** | **0** | — |
| Claim | `OpportunityDiscoveryService.ingestClaims()`（三处头注互证） | 同左 | **0** | **0** | — |
| Evaluation | `EvaluationService.evaluate()` | `evaluation-service:141` | **0** | **0** | — |
| Methodology active version | `getActiveMethodology()`（`repository:1566`） | `MethodologyService`（`decide:180`） | **0** | **0** | — |
| Policy | `PolicyRegistry` | immutable registry | **0** | **0** | — |
| Task lifecycle | `TaskEngine.setStatus()`（`:142`） | TaskEngine（`:55/:107/:119`） | **0** | **0** | — |
| Knowledge evolution target | `evolution-target.ts`（"the ONE place"） | candidate-review / candidate-projection | **0** | **0** | — |

```text
★ 实测：Current 判定全仓仅经 `isCurrentBelief`
    （`knowledge-belief.ts:34-35` 定义 · `knowledge-repository.ts:103/124` accessor 内部 ·
      `knowledge-projection-service.ts:190` 消费）
  ⇒ 无任何自写 `state === "confirmed"` ✔

★ 实测：Task 状态写入全仓仅 `task-engine.ts:146`（唯一 setter 内部）
  ⇒ Transition Authority = 1 ✔
  （`target-service.ts:110` 的 `setStatus` 是【不同对象的同名方法】，非 Task）

★ 「另一条路径」检查：
    current Knowledge
      ├── isCurrentBelief() / listCurrentBeliefs()   ← 正确（Semantic Authority = 1）
      └── industry.current_knowledge_id              ← Legacy Projection（业务读取 = 0）
    ⇒ Semantic Authority = 1 · Legacy Projection = 1 · Business Consumer = 0
    ⇒ **No competing SoT**
```

---

## §4 G2 Authority Coherence 🟢 PASS

```text
四列（严格分离，不合并 Version 与 Lifecycle Transition）：
  Semantic Authority | Version Authority / Transition Authority |
  Persistence-Projection Writer | Runtime Reachability

★ 声明：Version Authority 与一般 Lifecycle Transition Authority 可以由同一组件承担，
  也可以不同；**不得因共用 Writer 而自动推导二者相同**。
```

```text
① Semantic Authority 唯一性 —— 🟢
   KnowledgeBeliefState → isCurrentBelief → KPS（唯一）
   ⇒ 未发现「NewXxxService 自己判断 current」的实例

② Version Authority vs Lifecycle Transition Authority —— 🟢
   · Task lifecycle        : TaskEngine.setStatus（Transition Authority）；Task 不携带 version 语义
   · Knowledge version     : KPS（Version Writer）｜belief lifecycle : KPS（Transition Authority）
       ⇒ 【同组件承担两者】，但未被推导为概念相同
   · Methodology version   : MethodologyService（Version Authority）
       vs Knowledge lifecycle : KPS（Transition Authority）⇒ 【不同组件】
   ⇒ 两类 authority 已正确拆开，未产生混合概念

③ 多个 Writer 的语义理由 —— 🟢
   Requirement：creation（`opportunity-discovery:167`）vs status sync（`KPS:854`）
     ⇒ 共享同一 Semantic Authority（Requirement SoT）· 属【不同 lifecycle entry】
     ⇒ 合法分工，非第二 authority
   ⇒ 未用 writer 数量机械判断 authority
```

```text
★ 反例专项（未发现）：
   · 绕过 TaskEngine.setStatus 直接改 task.status
   · 新模块自判 current
```

---

## §5 G3 State / Lifecycle Coherence 🟢 PASS

```text
六者互不混用（H-4 分类 · H-6 横向复核）：

  Lifecycle State   : KnowledgeBeliefState · TaskStatus · RequirementStatus · GapStatus ·
                      MaterialIngestStatus · …（H-4 §2 的 24 个）
  Current Predicate : KnowledgeBeliefState.confirmed（isCurrentBelief）
  Temporal Relation : ClaimTemporalRelation（current | old | superseded）
  Projection Flag   : DiligenceQuestionState（current | retired）· TargetAssociationStatus
  Stage             : MaterialIngestStage（received | parsed | projecting | migration）
  Kind              : ArtifactKind · ReportKind · …（不得当 State）

★ 正向映射链（H-4 H4-03）复核：
    PoolSlotStatus → gapType / uncertainty → GapStatus → RequirementStatus
    集中点：KPS:665-696 + syncRequirementStatus ⇒ 单向 ✔

★ 反向检查（关键）：
    RequirementStatus → 反推 PoolSlotStatus 的路径
    ⇒ 实测：KPS 中 poolStatus 仅【读 slot】（`:665` `slot?.status ?? "unknown"`），
      无任何「从 requirement.status 反推 slot.status」的代码
    ⇒ **无循环语义** ✔

★ Current 词族区分复核：
    confirmed（KnowledgeBeliefState 的 current）
    ≠ active（Gap / Run 的有效性）
    ≠ current（ClaimTemporalRelation 的时间关系 · DiligenceQuestionState 的投影标志）
    ≠ latest（Methodology 的「latest ACTIVATED」= 排序语义，非状态）
    ⇒ 四词分属不同层，全仓未混用 ✔
```

---

## §6 G4 Version / Evolution Coherence 🟢 PASS

```text
按【语义】而非字段名重新分类：

  Governance Version  : MethodologyVersion（可激活 · `isHumanApprovedBaseline`）
                        PolicyVersion（不可变注册 · eval-v1 / agg-v1 / prio-v1 / suf-*）
  Knowledge Version   : IndustryKnowledge.version（KPS 推进）
                        ResearchState.version（KPS:635 递增）
  Lineage Version     : modelVersion · promptVersion · parserVersion · schemaVersion
                        （随 extraction run 记录 ⇒ 只溯源，不可激活 ＝ H5-01 WATCH 的语义）
  Material Version    : materialVersionId（material-version-service）
  Artifact Schema Ver : schemaVersion（artifact.ts:34）
  Priority Version    : next_action.priority + policyVersionId

★ 明确结论：
    version ≠ activation  ·  version ≠ lifecycle  ·  version ≠ stage  ·  version ≠ current
  ⇒ 只有 Governance Version（Methodology / Policy）具有「可激活」语义；
    其余五类 version 均不具备 ⇒ 不得被当作可激活 / 生命周期状态

★ Evolution 双链分离复核：
    Knowledge belief evolution : confirmed|conflicting → evolution-target → KPS.updateBeliefState
    Methodology evolution      : candidate → Human Gate → decide → activate
    ⇒ 两条链未混同 ✔
```

---

## §7 G5 Extension / Reachability Coherence 🟢 PASS

```text
三场景压力测试（只读 · 不实现）：
```

| Scenario | 复用检查 | 结论 |
|---|---|---|
| **A** Company Knowledge | Semantic Authority：复用 `KnowledgeRepository`（`subject_kind="company"`；DB 12+ 表已 generic）· current predicate：复用 `isCurrentBelief` · version：复用 KPS 推进 · 新 SoT：不需要 | **Extension Safe** |
| **B** Company Evaluation | Requirement：复用 `listRequirements` · Evaluation Policy：复用 `PolicyRegistry`（eval-v1）· Sufficiency Policy：复用 H-1 的 `Requirement → sufficiencyPolicyRef → PolicyRegistry` 链 · Provenance：复用 `sufficiencyPolicyRef/VersionId` | **Extension Safe** |
| **C** ResearchPosition | Position ≠ Target（`ResearchPosition` 与 `ResearchTarget` 是不同 domain 对象）· 未复制 `TargetStatus`（Target 有独立 `setStatus` at `target-service.ts:110`）· 未复制 `ResearchState` · 无第二套 lifecycle | **Extension Safe** |

```text
★ 三值输出：Extension Safe | Extension Unsafe | Extension Conditionally Safe
  ⇒ 本轮三场景均为 **Extension Safe**（非 PASS/FAIL 二值）
★ 关键依据：Type 层已预留 `"company"`；DB 层 `subject_kind` 已 generic；
  Position / Target 在 domain 层已明确分离 ⇒ 无需复制语义
```

---

## §8 G6 Governance Closure 🟢 PASS

### ① 跨轮结论是否冲突

```text
逐轮断言交叉比对（7 组）：
  H-2「legacy current* 列仅写入、无读取」        vs H-3「存在真实 projection write owner」      ⇒ 互补，非冲突
  H-3「PoolItem.valueText 生产读取 = 0」         vs H-2 R5 同结论                              ⇒ 一致
  H-3「Requirement 两个 write owner = 合法分工」 vs H-2 R2「listRequirements 唯一入口」        ⇒ 一致（前者讲 writer，后者讲 SoT）
  H-4「Task cancelled 无生产入口」               vs H-5「Human Gate 链条完整」                 ⇒ 不同对象，无冲突
  H-4「PoolSlot→Gap→Requirement 单向」           vs H-5「未复制语义」                          ⇒ 一致
  R6-ERR「L5 极性与其他层相反」                  vs H-3/H-4 的 authority 唯一性                ⇒ 一致（方法 vs 事实）
  R6-ERR Case 1/4/5 三值判定                     vs H-1/H-2/H-3 实测                           ⇒ 一致

⇒ **Cross-round contradiction: 0**
```

### ② WATCH 是否已达 remediation 程度

```text
判定链（四问）：correctness？ → authority uniqueness？ → current/version semantics？ → 阻止安全扩展？

| 登记项 | correctness | authority uniqueness | current/version semantics | 阻止安全扩展 | 结论 |
|---|---|---|---|---|---|
| H2-01 supersedeClaim NOT REACHABLE | No | No | No | No | WATCH remains WATCH |
| H2-02 Requirement 无失效态 | No | No | No | No | WATCH remains WATCH |
| H2-03 legacy current* 列 | No | No（无读取） | No | No | LEGACY remains LEGACY |
| H2-04 同名 superseded | No | No | No | No | SEMANTIC BOUNDARY 保持 |
| H3-01 current_state_id | No | No | No | No | WATCH remains WATCH |
| H3-02 legacy | No | No | No | No | LEGACY 保持 |
| H3-03 replacePoolItems | No | No | No | No | **TEST_ONLY 保持（H-3 原始语义）** |
| H3 F-1 / F-2 | — | — | — | — | FALSE-ALARM 保持 |
| H4-01 TaskStatus.cancelled | No | No | No | No | WATCH remains WATCH |
| H4-02 / H4-03 / H4-04 | No | No | No | No | LEGACY / WATCH / SAFE COUPLING 保持 |
| H5-01 / H5-02 | No | No | No | No | WATCH 保持 |
| AD-R6-1 | No | No | No | No | REGISTERED 保持 |

⇒ 全部四项均为 No ⇒ **WATCH remains WATCH**（无一升级为 REMEDIATION CANDIDATE）
```

### ③ 组合风险（★ 必须有实际 semantic/runtime linkage 证据）

```text
候选组合形状：
   H3 legacy writer（`opportunity-discovery:248` 写 current_state_id）
 + H4 legacy lifecycle
 + H5 extension duplication risk
 ⇒ 假设后果：New module 读 legacy projection → 误当 current → 创建新 state

★ 实证检查（决定性）：
   · `.currentStateId` / `.currentKnowledgeId` / `.currentEvaluationRunId` 的【业务读取】= 0
     （唯一命中 = `src/cli/research-commands.ts:239` 的【禁令注释】）
   · 从 `current_state_id` 反推 state 的路径 = 0
   ⇒ **A × B × C 之间【无任何可达 / 语义连接证据】**

★ 判定门：
   「Combination Risk requires demonstrated semantic/runtime linkage;
     hypothetical composition alone is not a defect.」
   ⇒ 本项 = hypothetical composition only ⇒ **不构成 defect**

⇒ **Combined Risk = 0（有实证：linkage 不存在）**
```

---

## §9 Cross-round Contradiction Matrix

```text
Cross-round contradiction: 0

（比对 7 组跨轮断言，全部互补或一致；无冲突项。不使用「基本一致」类模糊表述。）
```

---

## §10 WATCH / LEGACY / FALSE-ALARM Disposition

```text
六值分类（逐项落位）：

  KEEP                  : 无
  WATCH                 : H2-01 · H2-02 · H3-01 · H4-01 · H4-03 · H5-01 · H5-02
  TEST_ONLY             : H3-03（保持 H-3 原始语义标签，未被压成 WATCH）
  LEGACY                : H2-03 · H3-02 · H4-02
  FALSE-ALARM           : H3 F-1 · H3 F-2
  NO-FIX                : H3-04 · H3-05 · H4-04 · H5-03 · R6-ERR Fallback（METHODOLOGY_V1）
  REMEDIATION CANDIDATE : 0

另（保持既有登记语义，未纳入六值）：
  AD-R6-1 = REGISTERED / record-only
  H2-04   = SEMANTIC BOUNDARY
  H4-04   = DECLARED SAFE COUPLING（同时在 NO-FIX 中）

★ 声明：`REMEDIATION CANDIDATE` 仅为审查结论，**不代表授权 remediation**。
★ H-6 的任务是【横向治理归并】，不把既有标签压成六类；
  已证为 TEST_ONLY 者保持 TEST_ONLY，仅在此处明确其治理处置。
```

---

## §11 R6-ERR Readiness Assessment

```text
六项判定依据：
  ① 与 H-1～H-5 已确认语义一致？          ✔（Case 1/4/5 三值判定与实测一致；G1–G5 无冲突）
  ② 无 competing SoT？                    ✔（G1：全部为 0）
  ③ 无 competing authority？              ✔（G2：Semantic / Transition 均唯一或合法分工）
  ④ 规则 deterministic？                  ✔（§3.1 R1–R6 确定性短路 + 情形对照表）
  ⑤ scope 清晰？                          ✔（§2 四类载体 + 8 项排除；§5 Scoped / Expanded）
  ⑥ implementation boundary 清晰？        ✔（§10 明确不授权；§4 双轴；§6 Reachability 正交外置）
  （另：§7 G-3 保持 PARTIAL + AD-R6-1 REGISTERED —— 已明确「不阻断当前 SoT 合法性」）

⇒ **R6-ERR Readiness = READY FOR HUMAN GATE**

★ 边界：READY FOR HUMAN GATE ≠ FROZEN ≠ IMPLEMENTATION AUTHORIZED
```

---

## §12 Final Governance Verdict

```text
PASS
  → 可以进入后续 Human Gate

PASS WITH CONDITIONS
  → 必须先满足条件，再进入 Human Gate

FAIL
  → 需要定向 remediation；不得进入 Freeze
```

```text
H-6 = PASS

依据：
  G1 🟢 · G2 🟢 · G3 🟢 · G4 🟢 · G5 🟢 · G6 🟢
  Cross-round contradiction = 0
  Real defects              = 0
  Combination Risk          = 0（有实证：linkage 不存在）
  Remediation Candidate      = 0
  R6-ERR                     = READY FOR HUMAN GATE

★ 「PASS」仅表示【架构自洽，可进入 Human Gate】，
  不代表 Freeze，也不代表 Implementation。
```

---

## §13 Out of Scope / 明确未做

```text
❌ 修改生产代码 / 测试 / 既有契约 / schema
❌ 修改 Methodology / Version 机制 / Human Gate / R6-ERR proposal
❌ 重构 subject-kind · 修复任何 WATCH
❌ remediation · R6-ERR Formal Freeze · implementation · commit · push
❌ 范围外代码扫描
❌ 处理 colleague artifacts
```

---

## §14 Evidence / Cross References

```text
本轮直接引用的代码锚点（全部实测，未做扩展扫描）：
  domain/knowledge-belief.ts:34-35          isCurrentBelief（唯一 current 定义）
  storage/knowledge-repository.ts:103/124   accessor 内部使用 isCurrentBelief
  application/knowledge-projection-service.ts:190   filter(isCurrentBelief)
  application/knowledge-projection-service.ts:665-696  poolStatus → gapType/uncertainty → RequirementStatus
  runtime/task-engine.ts:142-146            setStatus（唯一 setter + terminal guard）
  runtime/task-engine.ts:55/107/119         start / complete / fail 三个转换入口
  application/target-service.ts:110         ResearchTarget.setStatus（同名不同对象）
  storage/research-repository.ts:1565-1571  getActiveMethodology（"Never a constant"）
  application/methodology-service.ts:123-180  decide（operator 强制 · 唯一激活点）
  application/methodology-service.ts:101-114  propose（候选 + HumanGate 原子创建）
  domain/methodology.ts:52-57               isHumanApprovedBaseline / MethodologyCandidateStatus

输入文档交叉引用：
  docs/phaseC/h1-sufficiency-remediation-contract.md
  docs/phaseC/h2-preflight-findings.md（含 §14 Erratum E-1）
  docs/phaseC/h3-preflight-findings.md
  docs/phaseC/h4-preflight-findings.md
  docs/phaseC/h5-preflight-findings.md
  docs/phaseC/r6err-proposal-refinement-record.md（v1.1 · PROPOSED / NOT FROZEN）

后续（不在本记录范围内，均需单独授权）：
  R6-ERR Formal Freeze（Human Gate 决定）
  R6-ERR Implementation Contract / Implementation
```
