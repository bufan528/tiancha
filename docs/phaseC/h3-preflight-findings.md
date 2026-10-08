# Phase C6 H-3 Read-only Architecture Review Findings

```text
Document kind     : READ-ONLY AUDIT RECORD
Scope             : Semantic Authority / State Ownership / Projection Boundary
Nature            : 补集式审计 —— 只补 H-2 未覆盖面 + 交叉引用 H-2 既有结论
Implementation    : NONE
Contract          : NONE
Authorization     : NONE
Remediation       : NONE
Baseline          : HEAD = origin/main = ls-remote = 3dc01a37ec0825580405e12825976f73a82cbc5a
```

---

## §1 Scope

```text
补集定义（相对 H-2 已覆盖的 R1–R10）：
  · H-3-A  Semantic Authority Map（对 H-2 的 authority 维度补强）
  · H-3-B  全链 Projection Boundary（domain → DB → repository → application → accessor）
  · H-3-C  Read / Write / Semantic Authority 三分

明确出界（留给后续 Slice）：
  · 状态机完整语义与合法转换     → H-4
  · 新增模块能否不复制 SoT 接入   → H-5
```

---

## §2 H-3-A — Semantic Authority Map

```text
写面总量 = 45（ResearchRepository 38 · KnowledgeRepository 6 · ArtifactStore 1）

语义事实            Write Authority（生产持有者）                        Read / Current Authority
──────────────────────────────────────────────────────────────────────────────────────────────
Knowledge 本体      KPS:341(insertBelief) / :344,:427(upsertKnowledge)  listCurrentBeliefs（唯一）
Knowledge 状态      KPS:282 · :297 · :407 · :412 · :446（全部 5 处）      filter(isCurrentBelief)
Belief 关系         KPS:408(appendBeliefRelation)                       —
Conflict            KPS:303 → knowledge-repository:198（内部路径）       listOpenConflicts
Requirement 创建    opportunity-discovery:167（status:"open"）            listRequirements
Requirement 状态    KPS:854（syncRequirementStatus · 仅变化时写）          listRequirements
Gap                 KPS:674 / :681（upsertGap）                          activeGaps / isActiveGapStatus
Pool Slot           KPS:572 · opportunity-discovery:183                  getPoolSlot
Pool Item           KPS:541（upsertPoolItem）                            listPoolItems
ResearchState       KPS:622 / :792 · opportunity-discovery:247           getStateBySubject
NextAction/Priority KPS:744(create) / :769(cancel)                       listNextActions
Claim               opportunity-discovery `ingestClaims()`【唯一】        artifactStore.get / listByTask
Artifact            artifactStore.put（4 主体 · 见 §4）                   artifactStore.get
Evaluation          evaluation-service:141                                getLatestEvaluation
Candidate 投影      candidate-projection-service:166/175/211/232/239/246  —
Candidate 审阅      candidate-review-service:270                         —
Material 认领       material-ingest-service:347（claimMaterialIngest）   —
Report              ⇒ 0（无写 authority）                                —
```

---

## §3 H-3-B — Projection Boundary（全链：domain → DB → repository → application → accessor）

| Property | domain | DB column | repo 写 | repo 读 | app 写 | app 读 | 判定 |
|---|---|---|---|---|---|---|---|
| `current_knowledge_id` | `industry.ts:23` | `research-db.ts:1061`(+`:1053-1065` 迁移) | `:91` | `:1709` | **0** | **0** | 🟢 无 authority（DEPRECATED） |
| `current_state_id` | `industry.ts:21` · `company.ts:18` | `:62`(industry) · `:75`(company) | `:89` · `:135` | `:1707` · `:1771` | **★`opportunity-discovery:248`** | **0** | 🟡 见 H3-01 |
| `current_evaluation_run_id` | `industry.ts:22` | `:63` | `:90` | `:1708` | **0** | **0** | 📋 见 H3-02 |

```text
★ stateId 由 KPS:623 固定为 `state-${subjectKind}-${subjectId}`（`prev?.stateId ?? …`）
  ⇒ 同一 subject 仅 1 个 stateId 且原地更新 ⇒ 指针指向恒不改变（否证 F-1，见 §6）。
★ 未发现「projection 被业务层当作 authority 使用」的实例（三列 app 读全为 0）。
```

---

## §4 H-3-C — Read / Write / Semantic Authority 三分

```text
★ 「谁可以宣布 current」= KPS 独占
    updateBeliefState(…, "confirmed") 的唯一生产点 = KPS:412
  ⇒ Semantic Authority（宣布 current）与 Write Authority（写库）同主体且唯一 🟢

★ 「谁可以 supersede / confirm / reject」= 同一 updateBeliefState 家族（KPS:282/297/407/412/446）🟢

★ 「谁可以改变 Knowledge 本体」= KPS:341(insertBelief) / :344,:427(upsertKnowledge) 🟢

★ ArtifactStore.put 的 4 个写主体（语义分层清晰）：
    · runtime/execution-coordinator.ts:136 → kind="execution"（AF-4 · 无 knowledge 语义）
    · opportunity-discovery-service.ts:211/341/392/419 → 业务 Claim 等 artifact
    · src/cli/tiancha.ts:235 → CLI 自检（"Write an Artifact and read it back"，kind="evidence"）
  ⇒ 未发现「同一 kind 被两个主体争写」🟢

★ Claim write authority = `OpportunityDiscoveryService.ingestClaims()` 唯一，
  由三处独立头注互证：
    candidate-projection-service.ts:5-6 · candidate-review-service.ts:8 · material-ingest-service.ts:10
  ⇒ 三个下游服务都显式声明「不重新实现 claim writing，只调用既有 ingestClaims()」🟢🟢

★ Report 无写 authority（与 H-2 §7 一致）🟢
```

---

## §5 Findings

### H3-01 · 🟡 REGISTERED · NO-FIX — `current_state_id`

```text
Nature : Architecture Observation / Projection Hygiene Finding
         （不是 Architecture Debt：无错误 authority、无错误读取、无语义漂移、无契约违反）

Projection Write Owner : opportunity-discovery-service.ts:248
Semantic Read          : 0
Business Consumer      : 0
```

```text
★ 术语要求（防长期歧义）：此处「write」仅指【projection write ownership】，
  **不代表** current-state semantic authority。真正的 current-state 语义属于 ResearchState；
  其生产与维护入口由 KPS 负责。
  ⇒ Projection Writer ≠ Read Authority ≠ Semantic Authority
  ⇒ 核心结论：写入 projection 不等于拥有 SoT。

结论：该列目前是 actively maintained but semantically unconsumed projection；
      不得据此推导其具有 current-state semantic authority。
与 H2-03 的关系：H2-03 记为「仅写入、无读取」；H-3 补充确证其存在真实的 projection write owner。

Severity    : Low（影响 = 0，无消费者）
Disposition : 🟡 REGISTERED · NO-FIX（不 remediation）
```

### H3-02 · 📋 REGISTERED / LEGACY — `current_evaluation_run_id`

```text
Evidence    : domain industry.ts:22 · DB :63 · repo 写 :90 · repo 读 :1708；app 写/读 = 0
Disposition : 📋 REGISTERED / LEGACY
```

### H3-03 · 🟡 REGISTERED / TEST_ONLY · NO-FIX — `replacePoolItems`

```text
Evidence       : research-repository.ts:469（定义）· 唯一引用 = pool-slot-migration.test.ts:163（测试）
SoT Legality   : 未发现违法
                 （该判断基于 H-3 当前证据；与 R6-ERR Proposal §7 的 proposed principle 一致，
                  但不以其 Formal Freeze 为前提；R6-ERR Proposal 仅作一致性参照，不构成 H-3 的规范依据）
Reachability   : TEST_ONLY / production-unwired
★ 与 H2-01（supersedeClaim）同形：contract-covered + test-covered + production-unwired
Disposition    : 🟡 REGISTERED / TEST_ONLY · NO-FIX
★ 原则：Semantic Authority ≠ Runtime Reachability —— 不得因无 production caller 判为 illegal / dead / 应删除
```

### H3-04 · 🟢 VALID AUTHORITY SPLIT — Requirement 有 2 个 write owner

```text
① creation authority         = opportunity-discovery-service.ts:167（status:"open"）
② lifecycle/status authority = knowledge-projection-service.ts:854（syncRequirementStatus）
判定：二者是【两个不同语义动作】⇒ 合法 authority 分工，非 competing authority。
★ 方法论要点：多 Write Owner ≠ competing SoT。
Disposition : 🟢 非缺陷（登记为 authority 分工事实；未来可作 R6-ERR 正式案例）
```

### H3-05 · 🟢 PASS — Version authority 存在且被正确维护

```text
Evidence    : research-state.ts:25(字段) · research-db.ts:144(version INTEGER NOT NULL) ·
              KPS:635 `version: (prev?.version ?? 0) + 1` · KPS:254 / :346 / :429（knowledge version）
Disposition : 🟢（与 H-2 §8 交叉印证）
```

---

## §6 否证证据（F-1 / F-2）★ 保留

```text
F-1 📋 FALSE ALARM
  原假设：KPS 更新 ResearchState 但不回写 industry.current_state_id ⇒ 可能 pointer drift
  取证推翻：stateId = `state-${subjectKind}-${subjectId}`（KPS:623，`prev?.stateId ?? …`）
            ⇒ 同一 subject 仅 1 个 stateId、原地更新 ⇒ 指针恒不改变 ⇒ 不存在 pointer drift
  方法论教训 ①：**看到两个写点 ≠ 存在两个 current authority。**
  方法论教训 ②：**Projection Review 必须包含 Identity Construction Verification。**

F-2 📋 FALSE ALARM
  原假设：三处 upsertState 均未显式维护 ResearchState.version
  取证推翻：KPS:635 有 `version: (prev?.version ?? 0) + 1`（首次取证窗口 L622-630 被截断而漏看）
  方法论教训：**局部代码窗口不足以证明不存在语义维护逻辑。**
```

---

## §7 Architecture Governance Gate（7 问）

```text
① 每个核心语义事实是否有明确 authority？           🟢 PASS
② current / active / confirmed 是否唯一？          🟢 PASS
③ Repository / Projection 是否未冒充 SoT？         🟢 PASS
④ Write / Read / Semantic Authority 是否清晰？     🟡 PARTIAL
                                                    （仅 H3-01：有 projection writer、无 reader）
⑤ 状态机是否有明确 owner 与合法转换？               🟢*（本轮仅 evidence 层；完整判定属 H-4）
⑥ Version 是否都有明确 owner？                     🟢 PASS
⑦ 新增模块能否不复制 SoT 语义接入？                 🟡 NOT YET（属 H-5 范围，本记录不扩大 H-3）
```

```text
★ Gate ④ 🟡 PARTIAL 与 H-3 FINAL PASS 可【同时成立】—— PARTIAL 描述的是状态，不是审计结论。
★ Gate ⑦ 的 NOT YET 不得用于扩大 H-3 范围。
```

---

## §8 Disposition

```text
H-3 Read-only Architecture Review   🟢 FINAL PASS / NO-FIX
真实缺陷                            0
需要 remediation                    0
架构债务新增                        0

H3-01 🟡 REGISTERED · NO-FIX（Architecture Observation / Projection Hygiene）
H3-02 📋 REGISTERED / LEGACY
H3-03 🟡 REGISTERED / TEST_ONLY · NO-FIX
H3-04 🟢 VALID AUTHORITY SPLIT
H3-05 🟢 PASS
F-1   📋 FALSE ALARM（retained）
F-2   📋 FALSE ALARM（retained）
```

---

## §9 明确未做

```text
❌ 未改生产代码 / 测试 / 既有契约
❌ 未修改 H-1 / H-2（含 §10 原文）/ R6-ERR Proposal
❌ 未修改 Methodology v1 / HANDOFF / README
❌ 未 remediation · 未 commit · 未 push · 未 Freeze
❌ 未创建 AD（Architecture Debt）文件
❌ 未处理 colleague artifacts
❌ 未扩大到 H-4 / H-5
```

---

## §10 交叉引用（不在本记录范围内）

```text
H-4 Lifecycle / State Semantics
  待答 6 问：① 每个核心状态机是否有唯一 owner ② 每个状态是否有明确语义（非仅命名）
             ③ 状态转换是否有明确合法入口 ④ 是否存在多模块解释同一状态
             ⑤ current/active/confirmed/completed/superseded/revised 是否跨层混用
             ⑥ 历史状态与当前状态是否严格分离
  重点：Claim / KnowledgeBelief / Requirement / Gap / ResearchState / Task / TaskAttempt /
        Artifact / Evaluation
  ⛔ 未授权

H-5 Evolution / Version / Extension Safety
  ⛔ 未授权

R6-ERR Formal Freeze
  ⛔ NOT AUTHORIZED
```
