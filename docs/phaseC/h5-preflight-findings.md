# Phase C6 H-5 Read-only Evolution / Version / Extension Safety Findings

```text
Document kind     : READ-ONLY AUDIT RECORD
Scope             : Evolution / Version / Extension Safety
Nature            : Read-only architecture review —— 只回答「版本归属与演进/扩展安全是否自洽」
Implementation    : NONE
Contract          : NONE
Authorization     : NONE
Remediation       : NONE
Baseline          : HEAD = origin/main = ls-remote = 8554550e3900f9faa33439a4778a747b9395a7ca
```

---

## §1 Scope / Boundary Review

```text
唯一要答的问题 : 当前的【版本归属】与【演进 / 扩展安全】是否自洽？
链位           : H-3（谁有权读写）→ H-4（状态是什么、如何变化）→ H-5（版本如何演进、新模块如何接入）
```

### §1.1 6 个核心 Gate

```text
H5-01 Version Authority      谁定义 / 创建推进 / 持久化 version？是否存在竞争性 Version Authority？
H5-02 Evolution Safety       Methodology 演进链条是否完整？是否存在绕过 Human Gate 的生产路径？
H5-03 Extension Safety       新模块能否复用既有 SoT / semantic authority 而无需复制状态语义？
H5-04 Version/Stage/Lifecycle/Kind Boundary
                             是否存在把 Version 当 Lifecycle、Stage 当 State、Kind 当 State 的风险？
H5-05 Methodology v1 Governance
                             Experience → Proposal → Human Gate → Version 是否仍成立？
                             Model 能否直接修改 Methodology？是否存在隐式自动演进路径？
H5-06 New-Module Reachability（延续 H-3 Gate ⑦）
                             用 H-4 的四分区分：Semantic Authority / Transition Authority /
                             Persistence-Projection Writer / Runtime Reachability
```

### §1.2 两项文字精化（Scope 阶段确立）

```text
★ 精化 A —— Version Owner ≠ Version Writer（沿用 H-4 三分法）
    Semantic Authority / Version-Transition Authority / Persistence-Projection Writer 三者分离。
    例：KPS 写 `IndustryKnowledge.version`，但该 version 的 semantic authority 仍在
        IndustryKnowledge（domain）；KPS 只是 Persistence / Projection Writer。

★ 精化 B —— 可达但复制语义 ≠ Extension Safe
    新模块测试不是「有没有 API 可调用」，而是：
      New Module → 复用既有 Semantic Authority → 复用既有 Current / Version Predicate
                 → 复用既有 Transition Authority
                 → 【不自行建立第二套 SoT / current / confirmed / version 语义】
```

---

## §2 R1 Version Inventory（7 个家族）

| 家族 | SoT 载体 / 定义点 | 写入者（生产） | 状态 |
|---|---|---|---|
| Methodology | `MethodologyVersion`（`domain/methodology.ts:48`）· `methodology-v1.ts:16` = `"mw-v1"` | **MethodologyService 唯一**（:77 bootstrap · :180 activate · :102/:167 upsertCandidate） | 🟢 |
| Knowledge | `IndustryKnowledge.version` | **KPS 唯一**（:254 / :346 / :429） | 🟢 |
| Knowledge | `ResearchState.version`（独立另一族） | **KPS:635** | 🟢 |
| Material | `MaterialVersion`（`material-source.ts:143`） | material-version-service | 🟢 |
| Artifact | `schemaVersion`（`artifact.ts:34`） | artifact-store.ts:116 | 🟢 |
| Policy | `VersionedPolicy`（`policy-registry.ts:14`） | PolicyRegistry（不可变注册 · eval-v1 / agg-v1 / prio-v1 / suf-*） | 🟢 |
| Extraction | `modelVersion` / `promptVersion` / `parserVersion` / `schemaVersion`（`claim-candidate.ts:98-101`） | 随 extraction run 记录（lineage） | 🟡 见 H5-01 |
| Priority | `next_action.priority` + `policyVersionId` | KPS（C3 已证） | 🟢 |

---

## §3 R2 Version Authority

```text
★ 关键证据 —— research-repository.ts:1565 逐字注释：
    「The currently activated version (latest activatedAt). **Never a constant.**」
  ⇒ 明确声明 getActiveMethodology() 【不是 METHODOLOGY_V1 常量】✓

★ repository 实现（:1566-1571）：
    SELECT * FROM methodology WHERE activated_at IS NOT NULL ORDER BY activated_at DESC LIMIT 1
  ⇒ 只返回【已激活】版本 ✓

★ 全部 8 处 MethodologyService 使用点均为【读】或【装配】：
    chain-projection-service:31 · diligence-preparation-service:169 · evaluation-service:79 ·
    research-commands:1201 · tiancha.ts:385 · tiancha-agent-host:88 · research-tools（Agent 注入，只读展示）
  ⇒ 无竞争性 Version Authority ✓

★ 精化 A 落地：Version Writer（KPS / artifact-store / material-version-service）与
  Version Semantic Owner（domain 对象）已分离，未发现混同。
```

---

## §4 R3 Evolution Path（绕过搜索）

### 🟢 Human Gate 链条完整且强制

```text
methodology-service.ts 头注（L2-12）逐字：
  「MethodologyService (Phase P1) — versioned, Human-gated methodology evolution.」
  ★ Invariant 6: a methodology version can only become ACTIVE after a human decision.
    **The model may PROPOSE a candidate; it can never activate one.**
  Flow: Material → MethodologyCandidate → Agent Explanation → Human Review → New Version → Activate
  「History is never overwritten: activating a new version keeps every prior version row;
    getActive() returns the latest ACTIVATED version.」

强制点实测：
  · :123-125  `if (!input.operator) throw`「methodology cannot activate without a human gate (Invariant 6)」
  · :128-133  全程 transaction；status !== "pending" ⇒ throw（防重复激活）
  · :101-114  propose 在【同一 transaction】内原子创建 candidate + HumanGate
              （`createHumanGate({type: "methodology_activate", …})` + upsertHumanGate）
  · :138-158  resumeToken（可选）经 `consumeResumeToken` 校验 scope / expiry / replay，
              并把 gate 置为 decision + operator + decidedAt + resumeTokenConsumed
  · :169      rejected ⇒ return（不激活）
  · :176-180  唯一激活点：`isHumanApprovedBaseline: true` + activatedAt
  · :186-188 / :196-197  历史 append-only（nextVersionTag = `v${listMethodologies().length + 1}` 单调）

激活路径穷举（`isHumanApprovedBaseline` 的全部来源）：
  ① methodology-v1.ts:18   V1 baseline 常量（内置）
  ② methodology-service.ts:176  decide 的 activatedVersion
  ⇒ ★★ 无第三条激活路径 ✓✓
```

### 🟢 Agent / Model 的能力边界（Invariant 6 成立）

```text
propose 的生产调用者：
  · src/agent/research-tools.ts:285  `methodology.propose({…})`  ⇒ Agent 可 PROPOSE ✓
  · src/cli/tiancha.ts:423           `svc.propose({…})`          ⇒ CLI ✓
decide 的生产调用者：
  · src/cli/tiancha.ts:456           `svc.decide({…})`           ⇒ ★ 唯一，且仅 CLI ✓
  （evaluation-service.ts:123 的 `this.decide` 是【同名私有方法】，与 methodology 无关 —— 勿混）

★ research-tools.ts 自证只读：:41 / :47 / :55 / :407 / :433 多处声明「READ-ONLY」
```

---

## §5 R4 Extension Simulation

```text
★ 正面证据 —— DB schema 层已 subject-generic：
  research-db.ts 中 12+ 张表统一使用 `subject_kind TEXT NOT NULL`
    （industry_knowledge:81 · information_pool:95 · investment_evaluation:122 · research_state:134 ·
      information_requirement:108 · material:166 …）
  + 索引 idx_state_subject / idx_knowledge_subject / idx_eval_subject
  ⇒ 扩展 Company 侧【无需新表、无需 schema 变更】，复用同表 + `subject_kind = "company"` ✓

★ 类型层已预留：ClaimSubjectKind / KnowledgeSubjectKind 均含 "company"
★ 实现层尚未复制：CompanyKnowledge / CompanyEvaluation = 0 命中
```

| 模拟新模块 | Semantic Authority | Transition Authority | Persistence / Projection Writer | Runtime Reachability | 是否需复制语义 |
|---|---|---|---|---|---|
| ① CompanyKnowledge | 复用 `KnowledgeRepository`（`subject_kind="company"`） | 复用 KPS（唯一） | 复用 KPS | 未接线（类型已备） | ❌ 不需复制 |
| ② CompanyEvaluation | 复用 `EvaluationService` | 复用 evaluation-service | 复用 | 未接线 | ❌ 不需复制 |
| ③ New ResearchPosition | 复用 `ResearchPosition` / `upsertPosition` | 复用既有 holder | 复用 ResearchRepository | 未接线 | ❌ 不需复制 |

```text
★ 判定：三者均可【复用既有 authority】接入，无需复制 current / confirmed / version 语义
  ⇒ 符合精化 B（不复制语义是硬边界）
```

---

## §6 R5 Boundary Cross-check（Version / Stage / Lifecycle / Kind）

```text
🟢 Version 未被当 Lifecycle —— 全仓 `.version` 比较仅 2 处，皆非 lifecycle 用途：
  · research-commands.ts:1540  `if (version === undefined)`（存在性检查）
  · extraction-window.ts:64    `typeof rule.version !== "string"`（类型校验）

🟢 Stage 未被当 State —— CLI 显式区分两个字段：
  · research-format.ts:315  `${v.stage ? "，停在 " + v.stage : ""}（状态 ${v.ingestStatus}）`
    ⇒ stage 与 ingestStatus 在同一行渲染但【明确标注为不同概念】✓
  · research-commands.ts:655 / :801  `stage: result.outcome === "failed" ? result.stage : undefined`
    ⇒ stage 仅表示【失败停留阶段】✓
  · `MaterialIngestStage`（received|parsed|projecting|migration）与 `MaterialIngestStatus`
    是两个独立维度 ✓

🟢 Kind 未被当 State（H-4 已证，H-5 复核无新增）
```

---

## §7 R6 Methodology Governance + ★ 静默 fallback 完整裁定

### §7.1 4 处 `getActiveMethodology() ?? METHODOLOGY_V1` 逐一取证

```text
① methodology-service.ts:83
     getActive(baseline = METHODOLOGY_V1) {
       return this.repo.getActiveMethodology() ?? this.bootstrap(baseline);
     }
   头注（:81）：「The active version, bootstrapping the frozen v1 baseline if none exists.」
   ⇒ 语义 = 【幂等 seed】（bootstrap 会写库）⇒ 明确限定为 bootstrap 语义 ✓

② candidate-extraction-service.ts:723
     const methodology = this.repo.getActiveMethodology() ?? METHODOLOGY_V1;
   ⇒ read-only 兜底（不写库）

③ report-service.ts:88-92  ★★ 逐字理由：
     「★ C4-A / R1: read-only + legal fallback.
       `getActive()` would BOOTSTRAP — i.e. WRITE `methodology` — when no active row exists,
       which contradicts "Report writes only its own append-only projection" (I14).
       **The returned `versionId` is UNCHANGED; no bootstrap, no upsert.**」
   ⇒ 语义 = 故意不用 getActive() 以避免写库（保护 I14）✓

④ research-plan-service.ts:87-93  ★★ 逐字理由：
     「★ READ-ONLY on purpose: the methodology *service*'s `getActive()` bootstraps
       (i.e. WRITES) the frozen baseline when no active version exists. The plan must not write,
       so it reads the active row directly and falls back to the dimension key when that row is absent.」
   ⇒ 语义 = 同样故意规避 bootstrap 写库 ✓
```

### §7.2 判定（按 Scope 阶段确立的规则）

```text
规则：
  明确 bootstrap-only + 不绕过 governance        → LEGAL / NO-FIX
  runtime-wide silent fallback                  → 候选 Architecture Finding
  fallback 可绕过 Human Gate / Version governance → HIGH-VALUE Finding

实测结论：
  · 无一处是 runtime-wide silent fallback                                ✔
  · fallback 不写库（③④ 逐字声明 no bootstrap / no upsert）               ✔
  · fallback 不改 activated version（repository:1565「Never a constant」） ✔
  · fallback 不绕过 Human Gate（激活仍只经 decide:180）                    ✔

★ 裁定：METHODOLOGY_V1 fallback 属于合法的
        frozen-baseline bootstrap / read-only compatibility 语义，而非 Governance Bypass
  ⇒ **LEGAL / NO-FIX**

★ 与 H-1 INV-6（unknown/missing policy ref ⇒ THROW）的差异是【有意的】：
    policy ref 缺失 = 配置错误（必须 THROW）；
    methodology 无 active 行 = bootstrap 缺省态（合法 fallback）。
    两者解决不同语义问题，不矛盾。
```

---

## §8 Findings

### H5-01 · 🟡 REGISTERED / WATCH — Extraction 侧 version 家族

```text
Evidence    : claim-candidate.ts:98-101（ExtractionRun 的 modelVersion / promptVersion /
              parserVersion / schemaVersion）· material.ts:88/90 · artifact.ts:34
观察        : 这 4 个 version 随 extraction run 一起记录（lineage 溯源用），
              与 Methodology / Policy 的「可激活版本」【不同层】—— 前者不可激活、只记录来源
Disposition : 🟡 REGISTERED / WATCH · NO-FIX
★ 未发现第二 SoT / 第二 Version Authority；登记以备未来扩展时复核分类
```

### H5-02 · 🟡 REGISTERED / WATCH — subject-kind 枚举重复定义

```text
Evidence    : 命名类型仅 2 个（claim.ts:23 `ClaimSubjectKind` · industry-knowledge.ts:21 `KnowledgeSubjectKind`）
              + 行内字面量 7 处（claim-candidate.ts:41 · evaluation.ts:83 · information-pool.ts:25 / :59 ·
                information-requirement.ts:13 · material-source.ts:147 / :217）
              ⇒ 合计 **9 处定义同一个 `"industry" | "company" | "general"`**
Impact      : 新增 subject kind 需改 9 处 ⇒ 【类型层维护性风险】（某处漏改 ⇒ 类型不闭合）
★ 证据仅支持类型层维护性风险；【未】证明：
    · 第二 SoT / 第二 Semantic Authority / 第二 Transition Authority
    · current / confirmed / version 语义复制
    · DB schema 扩展障碍（DB 层统一用 subject_kind 列，已 generic）
    · 当前行为不一致 / 已发生的生产缺陷
  ⇒ 升级为 Architecture Finding 会过度定性
Disposition : 🟡 REGISTERED / WATCH · NO-FIX
★ 未来真正开始扩展 Company 领域时，作为【扩展前检查项】即可
```

### H5-03 · 🟢 LEGAL / NO-FIX — METHODOLOGY_V1 fallback

```text
裁定见 §7.2。语义 = frozen-baseline bootstrap / read-only compatibility，
非 Governance Bypass。
```

---

## §9 H-5 Governance Gate

```text
H5-01 Version Authority                     🟢 PASS
H5-02 Evolution Safety                      🟢 PASS
H5-03 Extension Safety                      🟢 PASS
H5-04 Version/Stage/Lifecycle/Kind Boundary 🟢 PASS
H5-05 Methodology v1 Governance             🟢 PASS
H5-06 New-Module Reachability               🟢 PASS
```

---

## §10 Disposition

```text
H-5 Read-only Evolution / Version / Extension Safety Review   🟢 FINAL PASS / NO-FIX
Real defects                                                  0
Remediation                                                   0
架构债务新增                                                   0

H5-01 🟡 REGISTERED / WATCH · NO-FIX
H5-02 🟡 REGISTERED / WATCH · NO-FIX
H5-03 🟢 LEGAL / NO-FIX
Fallback（METHODOLOGY_V1）  🟢 LEGAL / NO-FIX
```

---

## §11 Out of scope / 明确未做

```text
❌ 未修改 production code / tests / schema
❌ 未修改 Methodology / Version model / Human Gate
❌ 未修改既有契约
❌ 未实施 subject-kind 重构
❌ 未 remediation（H5-01 / H5-02 仅登记）
❌ 未修改 H-1 / H-2 / H-3 / H-4 / R6-ERR Proposal
❌ 未 commit · 未 push · 未 Freeze
❌ 未处理 colleague artifacts
```

---

## §12 交叉引用（不在本记录范围内）

```text
Comprehensive Architecture Governance Review（H-1 → H-5 完成后的综合评审）
  拟答 10 问：① SoT 是否唯一 ② Authority 是否唯一/合法分工 ③ Projection 是否会冒充 SoT
              ④ State 是否有明确生命周期 ⑤ Version 是否有明确 owner ⑥ Extension 是否会复制语义
              ⑦ Reachability 是否与 Legality 正确分离 ⑧ Historical/Current 是否严格分离
              ⑨ 新增模块是否能遵循既有架构 ⑩ R6-ERR 方法本身是否足够稳定
  ⛔ 未授权

R6-ERR Formal Freeze
  前置：H-1 → H-2 → H-3 → H-4 → H-5 → 综合 Governance Review
  ⛔ NOT AUTHORIZED
```
