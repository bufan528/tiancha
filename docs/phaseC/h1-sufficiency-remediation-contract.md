# H-1 Sufficiency Semantics Remediation Contract（rev1）

> 状态：**🔒 FROZEN（rev1）**。本契约只定义 H-1 的修复契约；**实现仍未授权**。
> 基线：`HEAD = origin/main = ls-remote = 64a6dd8` · ahead/behind 0/0 · staged 0 · 我方未提交修改 0。
> 上游依据：[`docs/audit-2026/README.md`](../audit-2026/README.md) **§3 🟠 High · H-1** ·
> [`docs/audit-2026/code-app-domain.md`](../audit-2026/code-app-domain.md) §2 ·
> [`docs/audit-2026/repro/c1-repro.test.ts`](../audit-2026/repro/c1-repro.test.ts)（H-1 的独立复现证据）。
> 既有冻结契约（**本契约不修改，只落实**）：
> [`docs/phaseC/implementation-contract.md`](implementation-contract.md)（Phase C 总契约）
> **L925 / L927 / L1304** · **C-FIX-12**（current predicate 唯一化）。
> 授权状态（用户裁定）：**H-1 Read-only Audit = 🟢 FINAL PASS** · **SoT = 🟢 CONFIRMED** ·
> **New Architecture = ❌ NOT NEEDED** · **Contract Draft = 🟢 AUTHORIZED** ·
> **Contract Freeze / Implementation = ⛔ NOT AUTHORIZED**。
> **本文件只定义 H-1 的修复契约；不含代码落地。**

---

## §1 Purpose / Non-goals

```text
【Purpose】
把**已经冻结**的 Sufficiency / Current 语义【正确落实到 Evaluation】，并补齐 Evaluation 侧的可追溯性：
  · Evaluation 必须经 `KnowledgeRepository.listCurrentBeliefs()` 取得 current cognition（C-FIX-12）；
  · Evaluation 必须沿 `Requirement.sufficiencyPolicyRef → PolicyRegistry` 解析 sufficiency policy；
  · Evaluation 的 sufficiency facts / score / evidenceRefs 必须来自【同一套已解析的 current 输入集合】；
  · Evaluation 必须能追溯本次实际采用的 sufficiency policy；
  · 禁止 Evaluation 硬编码 sufficiency policy version。

★ 性质：这【不是】架构重设计，而是【落实既有契约】。既有契约已给出足够强的架构约束，
  不得为修 H-1 再造第二套抽象。

【Non-goals】（本契约【不】解决，且【不得】顺手解决）
  ❌ S-1  EvidenceSufficiency / SufficiencyFacts 的类型重复（⇒ OUT OF SCOPE，见 §7）
  ❌ S-2  `sufficiencyFacts` 的 `firstHand` 恒为 false（⇒ OUT OF SCOPE，见 §7）
  ❌ H-2 / H-3 / H-4 / H-5 · M-1…M-10
  ❌ 新建 SufficiencyServiceV2 / EvaluationSufficiencyResolver / 任何补丁层
  ❌ 修改 `SufficiencyPolicy` / `PolicyRegistry` 的既有业务语义、版本行为、判定规则或注册规则
     （✅ 允许把【纯 resolver】下沉到既有合适的 domain 语义位置；该移动不得改变任何既有规范行为
       —— 见 §6 H1-7-10）
  ❌ 修改数据库 schema（Q1 裁定的 provenance 若触及 schema ⇒ 列为 schema-impacting change，
     实现前单独 review；schema 实现【未授权】）
  ❌ 修改 CLI composition / Agent / 工具面
  ❌ 修改 `docs/audit-2026/**` 与同事产物（README.md / package.json / .acl-*）
```

---

## §2 Current Facts（H-1 只读审计取证 · 逐字）

```text
[F-1] SoT（判据）：`domain/sufficiency.ts`（75 行）
        `SufficiencyPolicy = { policyId, versionId, minItems, minIndependentSources, requiresFirstHand }`
        `sufficiencyFacts(items) = { itemCount, independentSources, firstHand }`
          · independentSources = Set(items.map(i => i.sourceRef ?? i.claimRef)).size
        `isSufficient(facts, policy)` = 纯判断
        `SUFFICIENCY_POLICY_V1 = { policyId:"sufficiency", versionId:"suf-v1",
                                   minItems:1, minIndependentSources:1, requiresFirstHand:false }`
        `sufficiencyPolicies = new PolicyRegistry<SufficiencyPolicy>("sufficiency")`
        头注：本文件是「the ONE shared judgement of "is the evidence enough?"」；
              「Pool and Evaluation MUST both use this — never a second, drifting copy of the rule」

[F-2] SoT（版本不可变）：`domain/policy-registry.ts`（61 行）
        register(policy)：同 versionId + 同内容 = no-op；同 versionId + 不同内容 ⇒ **throw**
        头注：「Changing a rule REQUIRES a new versionId（v1 → v2）；the old version stays resolvable forever」

[F-3] SoT（current 判据）：`domain/knowledge-belief.ts`（87 行）
        `KnowledgeBeliefState = candidate | confirmed | rejected | revised | conflicting | superseded`
        `CURRENT_BELIEF_STATE = "confirmed"`；`isCurrentBelief(state) = state === "confirmed"`
        头注（C-FIX-12）：「`KnowledgeRepository.listCurrentBeliefs()` is the single accessor；
        every other layer (Pool / Report / CLI / Agent) must go through it instead of re-deriving "current"」
        实现（`storage/knowledge-repository.ts:102-104`）：
          `listCurrentBeliefs(id) = listBeliefs(id).filter(b => isCurrentBelief(b.state))`
          注释：「Before C1 this filtered `state !== "superseded"` … that is exactly the semantic drift」

[F-4] 正确的解析器（现存，但在错误位置）：`application/knowledge-projection-service.ts:826-839`
        `function resolveSufficiencyPolicy(req?: InformationRequirement): SufficiencyPolicy | undefined`
          · 无 req ⇒ undefined（nothing to judge against；slot 只能 partial）
          · ref 缺失 ⇒ **THROW**
          · ref 未知 ⇒ **THROW**
        注释明写：「NEVER a hard-coded version: … silently falling back to a default would make
        the recorded provenance a lie」
        ⇒ ★ 该函数是 knowledge-projection-service 的【局部函数】（未导出），
            调用点仅 :556（同文件内）。

[F-5] Pool 侧（已正确）：`application/knowledge-projection-service.ts:552-569`
        `const policy = resolveSufficiencyPolicy(requirementByDimension.get(dim));`
        `const confirmedClaimRefs = new Set(beliefsForDim.filter(b => b.state === "confirmed").map(b => b.claimRef));`
        `const confirmingItems = repo.listPoolItems(slot.slotId).filter(it => confirmedClaimRefs.has(it.claimRef));`

[F-6] Evaluation 侧（★ 缺陷所在）：`application/evaluation-service.ts`
        L57-61  constructor(db, policy = EVALUATION_POLICY_V1, aggregationPolicy = AGGREGATION_POLICY_V1)
        L65-70  evaluate()：methodology = getActive()；dimensionEvaluations = dimensions.map(evaluateDimension)
                ⇒ ★ 全程【不取 knowledge】、【不取 requirement】
        L131-155 assessEvidence(subjectId, dim)：
                `const items = slot ? repo.listPoolItems(slotId) : [];`   ← ★ 全部 PoolItem（未过滤 current）
                `const sufficiency = sufficiencyFacts(items);`            ← ★ 同一（未过滤）集合
                `const evidenceRefs = items.map(i => i.claimRef);`        ← ★ 同一（未过滤）集合
                `if (isSufficient(sufficiency, this.policy.sufficiency))` ← ★ 固定 policy（默认 EVALUATION_POLICY_V1）
        L105-120 evaluation 记录：methodologyVersionId / evaluationPolicyVersionId / aggregationPolicyVersionId
                ⇒ ★ 未记录本次 sufficiency 所用的 requirement ref / resolved policy

[F-7] 漂移② 的机制：`domain/evaluation-policy.ts`
        L50-63 `EvaluationPolicy.sufficiency: SufficiencyPolicy`（注释：the SAME sufficiency policy object the Pool judges with）
        L92-97 `EVALUATION_POLICY_V1 = { …, sufficiency: SUFFICIENCY_POLICY_V1, … }`   ← ★ 硬编码 suf-v1
        生产构造点 = `src/cli/tiancha.ts:531` `new EvaluationService(db.db)`（未注入 policy）
        ⇒ 即：Evaluation 恒用 suf-v1；requirement 即便声明 suf-v2 也不会被遵守。

[F-8] 既有冻结契约（本契约的规范来源，逐字）
        `docs/phaseC/implementation-contract.md:925`
          「**C1 不修改 S4.5 的 sufficiency policy。**」
        `:927`（推论）
          「若 C1 让某条 claim 变成 `candidate`（而非 `confirmed`），它**不能**帮助该维度达到 `sufficient`。
            这是 `candidate` 的预期效果……」
        `:1304`
          「**Pool / Gap / Evaluation 的既有规则** —— 不得重新定义（S4.5 / S5 的成果必须保留，
            尤其 `Requirement.sufficiencyPolicyRef ⇒ PolicyRegist…`」
        C-FIX-12（多处方引：L244 / L1045 / L1226 / L1659 / L1749）
          「`KnowledgeRepository.listCurrentBeliefs()` 是**全系统唯一的 current predicate 来源**」

[F-9] 测试基线：`npm test` = 711 tests / 163 suites · pass 711 · fail 0（本契约基线）。
```

---

## §3 规范来源与性质

```text
★ 本契约的规范来源【全部是既有冻结条文】，不新造规范：

  ① current 语义      → C-FIX-12（`listCurrentBeliefs` 唯一访问器）
  ② sufficiency 判据   → S4.5（`Requirement.sufficiencyPolicyRef ⇒ PolicyRegistry`，契约 L1304 明文保留）
  ③ 非 confirmed 不计入 → 契约 L927（推论）
  ④ 版本不可变         → `PolicyRegistry`（既有）
  ⑤ 不 fallback        → 既有 `resolveSufficiencyPolicy` 的 THROW 语义

⇒ 因此 H-1 的 Contract 任务 = 【把上述规则在 Evaluation 侧落实 + 补齐溯源】，
  ★ 而非重新设计 sufficiency 架构。
```

---

## §4 Hard Invariants（H1-INV-1 … H1-INV-6）

```text
H1-INV-1  Current 唯一来源
  Evaluation 不得自行判断 `state === "confirmed"`，也不得自行 `items.filter(...)` 重新实现 current 语义；
  必须经 `KnowledgeRepository.listCurrentBeliefs(knowledgeId)` 取得 current cognition。

H1-INV-2  Sufficiency Policy 唯一解析链
  Evaluation 的 sufficiency 判据必须来自：
        Requirement → sufficiencyPolicyRef → PolicyRegistry → SufficiencyPolicy
  ❌ 禁止把 `SUFFICIENCY_POLICY_V1`（或任何版本）作为 Evaluation 的默认 sufficiency 判据。

H1-INV-3  非 current belief 不得贡献 sufficiency
  至少包括 candidate / rejected / revised / conflicting / superseded；
  不得通过 PoolItem 的【存在性】间接重新进入 sufficiency 判定。

H1-INV-4  Score / Facts / EvidenceRefs 同源
  三者必须来自【同一套已解析的 current evidence set】：
        Resolved Current Evidence Set ──┬── SufficiencyFacts
                                        ├── Score
                                        └── EvidenceRefs
H1-INV-4  Score / Facts / EvidenceRefs 同源（**语义约束，不要求新建类型**）
  Facts、Score、EvidenceRefs 必须基于【同一组】经过 current + policy eligibility resolution
  的输入证据计算：
        Resolved Current Input Evidence（概念集合）
                    │
           ┌────────┼────────┐
           ▼        ▼        ▼
         Facts    Score   EvidenceRefs
  ❌ 禁止三个地方各自重新查询后拼接。
  ★ 这是【语义约束】：**契约不要求新增独立类型 / DTO / domain object**
    （例如不得为它创建 `ResolvedCurrentEvidenceSet` 之类的新 domain 类型）。
    实现只需保证三者引用同一份已解析的输入证据。

H1-INV-5  Evaluation provenance（可追溯性 · Q1 裁定）
  InvestmentEvaluation 必须能够**独立识别**两个不同 policy domain 的版本：
        1. evaluation policy version（eval-*）
        2. sufficiency policy reference / resolved version（suf-*）
  ❌ 不得把 sufficiency policy version 压进 `evaluationPolicyVersionId`
     （二者是不同 policy domain：前者管「score 如何计算」，后者管「什么条件算 sufficient」）。
  ★ 具体字段名在实现前依现有 `InvestmentEvaluation` 模型命名；
    若新增 provenance 字段需要数据库 migration ⇒ 契约内明确列为 **schema-impacting change**，
    并在 Implementation 前单独做 migration impact review（schema 实现【未授权】）。

H1-INV-6  Unknown policy 不得 silently fallback
  Evaluation 必须继承既有语义：
        ref 缺失 → deterministic failure（THROW）
        ref 未知 → deterministic failure（THROW）
  ❌ 禁止 fallback 到 `suf-v1` 或任何默认版本。
```

---

## §5 验收矩阵（Case A–G + Static Guard）

```text
Case A  confirmed + revised（同维度）
        ⇒ revised 条目【不】计入 sufficiency / score / evidenceRefs

Case B  confirmed + superseded
        ⇒ superseded 条目【不】计入

Case C  confirmed + conflicting
        ⇒ conflicting 条目【不】计入

Case D  Requirement 声明 suf-v2（已注册的第二个版本）
        ⇒ Evaluation 必须使用 suf-v2
        ⇒ 不得使用 suf-v1

Case E  Requirement 声明【未注册】的 policy
        ⇒ deterministic failure（THROW）
        ⇒ 【不得】fallback（不得静默使用任何默认版本）

Case F  score / sufficiencyFacts / evidenceRefs
        ⇒ 三者必须来自同一 resolved current input set（H1-INV-4）
        （例如：断言 evidenceRefs 集合 == facts 的输入集合 == score 的输入集合）

Case G  复现 Audit-2026 的 H-1 reproduction
        ⇒ 一次 REVISE 之后：dimension score 由 80 回落到 60（40 + 20×1）
        ⇒ evidenceRefs 不再引用【已被 revised 取代】的 claim
        ⇒ Evaluation 的判定与 Pool 的判定一致（同一输入集合 + 同一 resolved policy）

Static Guard（negative architecture test）
        ⇒ 至少一条静态门：Evaluation 侧不得出现对 `SUFFICIENCY_POLICY_V1`
          （或任何绕过 PolicyRegistry 的路径）的直接使用。
        ⇒ 门必须排除注释/字符串，仅检查真实 code path。
```

---

## §6 MUST / MUST NOT

```text
【MUST】
H1-7-1  Evaluation 经 `listCurrentBeliefs()` 取 current cognition（H1-INV-1）。
H1-7-2  Evaluation 经 `sufficiencyPolicyRef → PolicyRegistry` 解析 policy（H1-INV-2）。
H1-7-3  非 current belief 不参与 sufficiency（H1-INV-3）。
H1-7-4  facts / score / evidenceRefs 同源（H1-INV-4）。
H1-7-5  记录本次实际采用的 sufficiency policy（H1-INV-5 · 形式见 §9）。
H1-7-6  ref 缺失/未知 ⇒ deterministic failure（H1-INV-6）。
H1-7-7  覆盖 Case A–G 的回归测试 + Static Guard（§5）。
H1-7-8  报告 research / root typecheck 与 full suite 的【前后数字】。

【MUST NOT】
H1-7-9  ❌ 新建 SufficiencyServiceV2 / EvaluationSufficiencyResolver / 任何补丁抽象层。
H1-7-10 ★ domain 边界（Q2 裁定收紧 —— 原文「❌ 修改 domain/sufficiency.ts · domain/policy-registry.ts」
        与 Q2(b) 冲突，故以本条为准）：
         ❌ 不得修改 `SufficiencyPolicy` / `PolicyRegistry` 的既有【业务语义、版本行为、
            判定规则或注册规则】（即：sufficiency 判据本体与版本不可变语义均不得改动）。
         ✅ 允许为复用既有解析语义，把【纯 resolver】放置到既有合适的 domain 语义位置
            （该移动 **不得改变任何既有规范行为**）；
         ❌ 不得让 Evaluation 依赖 KnowledgeProjectionService 以获得解析能力；
         ❌ 不得新建第三套 policy 解析实现 / 新增 Resolver Service。
H1-7-11 ❌ 修改数据库 schema（除非 §9 裁定要求，且须单独授权）。
H1-7-12 ❌ 修改 `Pool` 侧既有正确实现（`knowledge-projection-service` 的 confirmed 过滤链）。
H1-7-13 ❌ 修 S-1（类型重复）· 修 S-2（`firstHand` 恒 false）—— 二者 OUT OF SCOPE（§7）。
H1-7-14 ❌ 触碰 H-2/H-3/H-4/H-5 / M-* / README.md / package.json / docs/audit-2026/ / `.acl-*`。
H1-7-15 ❌ 修改任何已冻结契约的文本。
H1-7-16 ❌ commit / push（须另行授权）。
```

---

## §7 OUT OF SCOPE（登记 · 不纳入本 Slice）

```text
S-1  `EvidenceSufficiency`（domain/evaluation.ts:21）与 `SufficiencyFacts`（domain/sufficiency.ts:35）
     结构完全相同 { itemCount, independentSources, firstHand } ⇒ 类型重复定义（潜在漂移点）。
     ⇒ 📋 OUT OF SCOPE：涉及类型统一，属独立治理项；本 Slice 不合并、不顺手处理。

S-2  `sufficiencyFacts` 的 `firstHand` 恒为 false（domain/sufficiency.ts:51 硬编码）
     ⇒ 导致 `EVALUATION_POLICY_V1.scoring` 的 firstHandBonus（+20）恒不生效，
        且 `requiresFirstHand` 永不可满足。
     ⇒ 📋 OUT OF SCOPE：涉及 `firstHand` 的【信息来源 / 事实建模是否完整】，
        而不仅是 Evaluation 与 Pool 的语义漂移；不得偷偷塞进 H-1。
     ⚠️ 除非既有 H-1 契约明文要求，否则本 Slice 不修。
```

---

## §8 Expected File Impact（待 §9 裁定后细化）

```text
预计生产修改面（**仅为预期，实现前须经 Implementation Preflight 复核**）：
  1. packages/research/src/application/evaluation-service.ts        ← 落实 H1-INV-1…6
  2. resolver 的共享落点（Q2(b)）：把既有 `resolveSufficiencyPolicy` 的【纯解析职责】
     下沉到既有合适的 domain 语义位置，由 Pool 与 Evaluation 共同复用；
     ❌ 不改其判定逻辑 / 注册规则 / 版本语义；❌ 不让 Evaluation 依赖 KnowledgeProjectionService。
     ⚠️ 具体落点（domain 现有文件 vs 既有语义位置）在实现前裁定，不预先冻结函数名/文件。
  3. 可能涉及：knowledge-projection-service.ts（改为引用共享 resolver，行为不变）
  4. 可能涉及：provenance 字段（Q1）—— 若需 schema migration ⇒ 单独 review

预计测试面：
  · 新增 H-1 专项测试（Case A–G + Static Guard）

★ 若实现前 Preflight 发现需要修改第 3 个（或更多）生产文件 ⇒ STOP ⇒ 报告 ⇒ 重新裁定。
★ 本契约【不】预先冻结具体函数名 / 文件落点（避免无证据的抽象命名）。
```

---

## §9 Open Questions（已裁定 · RESOLVED）

```text
H1-Q-1  provenance（H1-INV-5）的表达方式                        🟢 RESOLVED
  裁定：(a) 为 InvestmentEvaluation 增加**独立**的 sufficiency provenance 表达。
  ★ 不得把 sufficiency policy version 塞进 `evaluationPolicyVersionId`（两个不同 policy domain）。
  ★ InvestmentEvaluation 必须能独立识别：① evaluation policy version ② sufficiency policy
    reference / resolved version。具体字段名实现前依现有模型命名。
  ★ 若需数据库 migration ⇒ 明确列为 **schema-impacting change**，实现前单独做 migration impact
    review；**schema 实现未授权**。

H1-Q-2  resolver 的复用方式                                    🟡 RESOLVED AFTER CONTRACT TIGHTENING
  裁定：**(b)** —— 把既有 `resolveSufficiencyPolicy` 的【纯解析职责】下沉到既有合适的
        domain 语义位置，由 Pool 与 Evaluation 共同复用。
  ❌ 不选 (a)：会让 Evaluation（application service）依赖另一个 application service
     （KnowledgeProjectionService）来获得本应共享的领域规则解析能力，与已冻结的 SoT 结论不一致。
  ★ 限定：纯 resolver 下沉、【语义不变】（不得改变任何既有规范行为）；
    不得新建 Resolver Service / 第三套解析实现。
  ★ §6 H1-7-10 已据本裁定收紧（原「❌ 修改 domain/sufficiency.ts」与 (b) 的冲突已消除）。

H1-Q-3  Evaluation 如何取得 knowledgeId / requirement            🟢 RESOLVED
  裁定：Evaluation 以 `knowledgeId` 为输入身份，从【既有 Requirement SoT】获取 active requirements，
        构造与 Pool 语义一致的 `requirementByDimension`：
              knowledgeId → resolve active requirements → requirementByDimension
                            → Requirement.sufficiencyPolicyRef → resolve
  ❌ 不得从 Pool 反向获得 requirement（Pool 不是第二 SoT）。
  ❌ 不得让 Evaluation 依赖 `new KnowledgeProjectionService(...)`。
  ❌ 不得复制另一套 requirement discovery。

H1-Q-4  无 requirement 时 Evaluation 的行为                       🟢 RESOLVED
  裁定：与 Pool 既有 **partial / non-sufficient** 语义对齐（Pool 侧：无 req ⇒ policy=undefined
        ⇒ slot 只能 partial，永不 sufficient）。
  ❌ 禁止 fallback 到 suf-v1 · ❌ 禁止 fabricate requirement · ❌ 禁止 fabricate sufficiency policy。
  ★ 具体 score 表现复用当前 Evaluation 已有的 partial semantics，**不得顺手发明新分数规则**。
```

---

## §10 Status

```text
H-1 Sufficiency Semantics Remediation Contract（rev1）  🔒 FROZEN
  §2 Current Facts（F-1…F-9）        🔒 frozen
  §3 规范来源与性质                    🔒 frozen（全部来自既有冻结条文）
  §4 H1-INV-1…6（含 Q1 收紧的 INV-5；INV-4 明确为语义约束）  🔒 frozen
  §5 验收矩阵 Case A–G + Static Guard  🔒 frozen
  §6 MUST / MUST NOT（含 Q2 收紧的 H1-7-10）  🔒 frozen
  §7 OUT OF SCOPE（S-1 / S-2）         🔒 frozen · S-1 / S-2 保持 OUT OF SCOPE
  §8 Expected File Impact（resolver 共享落点）  🔒 frozen
  §9 H1-Q-1…4                        🟢 RESOLVED（4/4）

H-1 Implementation Readiness / Preflight   🟢 下一阶段可进入（需单独授权）
H-1 Implementation        ⛔ NOT AUTHORIZED
H-1 Contract Freeze       🟢 DONE（本文件）
H-2 / H-3 / H-4 / H-5 / M-*   ⛔ NOT AUTHORIZED
Commit / Push             ⛔ NOT AUTHORIZED
```

---

## §11 Revision identity

```text
· 本文件为 rev1 首次落盘（初版 DESIGN ONLY）。
· ★ Freeze 记录：rev1 经 H-1 Read-only Audit（FINAL PASS）→ Contract Review（PASS WITH REQUIRED
  AMENDMENT）→ 两处契约表达修正（Q2 domain 边界收紧 · H1-INV-4 明确为语义约束）→ Landing Audit
  （PASS）→ Final Contract Review（PASS）后，经 Human Authorization 冻结为 **🔒 FROZEN（rev1）**。
  · 冻结基线 = §1–§10 当前内容；不再增加新设计、不再扩大 H-1 范围；
  · S-1 / S-2 保持 OUT OF SCOPE；
  · 未修改其他契约、未修改代码、未实现 schema migration。
· 本文件派生自 docs/audit-2026/ 的 H-1 发现、H-1 只读语义审计取证，以及既有冻结契约
  （docs/phaseC/implementation-contract.md L925 / L927 / L1304 · C-FIX-12）。
· 本文件不修改任何已冻结契约的文本；不含代码、不含 schema 变更。
```
