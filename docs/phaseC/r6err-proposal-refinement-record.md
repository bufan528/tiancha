# R6-ERR — SoT Legality Check · Proposal / Refinement Record

```text
Document kind     : PROPOSAL / REFINEMENT RECORD
Nature            : Engineering Governance / Architecture Review Method 候选
Status            : PROPOSED — pending Human Gate on Formal Freeze
Implementation    : NONE (this document authorizes no change)
Frozen            : NO (explicitly NOT a frozen method)
Baseline          : HEAD = origin/main = ls-remote = bb92430bdf66b7468f0357778d09289290c2eb8a
Origin            : H-1（currentKnowledgeId 误判）· H-2（H2-01～04）· R6-ERR Proposal Review
Revision          : v1.1（v1 + G-3 措辞收紧 + Case 2 更名）
```

---

## §1 问题陈述（问题真实性）

一个「信息源」可以被访问，并不意味着它在当前架构下【有权代表某类语义】。
H-1 的 `Industry.currentKnowledgeId` 是最典型的反例：字段存在，但既非合法 SoT，也已被明令弃用。

⇒ R6-ERR 要回答的唯一问题：

```text
该来源在当前 Slice / 当前架构 / 当前语义下，
是否具有【作为某类语义事实的合法权威来源】的资格？
```

> 措辞说明：使用「作为某类语义事实的合法权威来源」而非「读取某类语义事实的合法权威性」，
> 因为检查对象不限于字面意义的「读取」，还包括 projection / domain representation / application 语义入口。

---

## §2 边界

```text
【检查对象】四类载体：
   domain 类型字段 · Repository accessor · application 语义入口 · DB projection

【检查】仅一个问题：该来源是否具有【合法语义权威】

【明确排除】
   代码质量 · 性能 · API 好用度 · 是否有测试 · 是否 reachable ·
   是否该删除 · 是否该重构 · 个人编码偏好

【判据】一条判定若要进入 SoT Legality，必须回答
   「它影响的是【谁有权代表这个语义】，还是【这段代码好不好 / 有没有人用】」
   —— 后者一律出界。
```

---

## §3 六层模型（非等价 Gate）

```text
Candidate Source
   ↓
L1 Presence                   〔GATE〕       false ⇒ INVALID（终止）
   ↓ true
L2 Ownership                  〔ASSESSMENT〕 single | multi | undefined   ← 质量属性，非通过/不通过
   ↓
L3 Contract Permission        〔GATE〕       deny ⇒ ILLEGAL
   ↓ allow / unspecified
L4 Deprecation                〔ASSESSMENT〕 deprecated | active         ← 属性，不单独判死
   ↓
L5 Competition / Authority Resolution 〔RESOLVER〕
       NONE | EXISTS_AND_AUTHORITY_IDENTIFIED | EXISTS_BUT_AUTHORITY_UNCLEAR
   ↓
L6 Slice Dependency Legality  〔GATE〕       deny ⇒ ILLEGAL
   ↓
SoT Decision
```

```text
★ L5 不是通过/失败谓词（G-1）：「发现竞争源」是【不利】信号，与其余五层极性相反。
  ⇒ 严禁写成 `L1..L6 全 PASS ⇒ LEGAL`。
★ 三类节点语义不同：GATE（可终止）· ASSESSMENT（记录属性）· RESOLVER（消解竞争）
  ⇒ 不可同权计分（G-2）。
★ 命名说明：本层为 `L6 Slice Dependency Legality`（而非 `L6 Slice Legality`），
  以避免与「实现 Slice」串味；真实含义 =「当前来源是否被当前 Slice 合法依赖」。
```

---

## §3.1 Decision Resolution（属性 → 决定的转换规则）

```text
判定按【确定性短路顺序】执行，首个命中即为最终 SoT Decision：

  R1  L1 Presence = false                        ⇒ INVALID（不入 SoT Decision 枚举）
  R2  L3 Contract Permission = deny              ⇒ ILLEGAL
  R3  L5 = EXISTS_BUT_AUTHORITY_UNCLEAR          ⇒ AMBIGUOUS
  R4  L6 Slice Dependency Legality = deny        ⇒ ILLEGAL
  R5  L5 = EXISTS_AND_AUTHORITY_IDENTIFIED
      且当前来源【非】被指定的权威                ⇒ ILLEGAL（as-SoT）
  R6  以上皆未命中，且（L5 = NONE，或当前来源即被指定权威）⇒ LEGAL

【属性不判死】—— ASSESSMENT 层不单独决定 Decision：
  · L2 Ownership = undefined / multi
      ⇒ 仅作属性输出；仅在 L5 无法消解 authority 时【经 R3】转 AMBIGUOUS
  · L4 Deprecation = deprecated
      ⇒ 仅作属性输出，不单独判 ILLEGAL
        （deprecated 通常与 L3 / L6 的 deny 并存 —— 那时由 L3 / L6 判死；
          deprecation 是【证据】而非【判据】）
  · reachability
      ⇒ 不入本判定（属轴 2，独立报告）

【确定性保证】同一组六层输入 ⇒ 唯一 Decision（短路顺序固定，无 reviewer 主观空间）
```

**典型情形对照**

| 情形 | L1 | L2 | L3 | L4 | L5 | L6 | ⇒ Decision | 命中规则 |
|---|---|---|---|---|---|---|---|---|
| **A** | present | undefined | allow | active | NONE | allow | **LEGAL** | R6 |
| **B** | present | undefined | unspecified | active | EXISTS_BUT_UNCLEAR | allow | **AMBIGUOUS** | R3 |
| **C** | present | — | **deny** | — | — | — | **ILLEGAL** | R2 |
| **D** | present | — | allow | **deprecated** | NONE | allow | **LEGAL** | R6 |
| **Case 1（实）** `currentKnowledgeId` | present | undefined | **deny** | deprecated | EXISTS | **deny** | **ILLEGAL** | R2 |
| **Case 5（实）** `supersedeClaim` | present | single | allow | active | NONE | allow | **LEGAL**（Reachability = TEST_ONLY 入轴 2） | R6 |

```text
★ 情形 D 明确 = LEGAL：deprecated 只是属性，不是判死条件。
  ⇒ 消除「同一组六层结果、两个 reviewer 给出不同结论」的风险。
```

---

## §4 输出模型（双轴，G-4）

```text
【轴 1】SoT Decision          LEGAL | ILLEGAL | AMBIGUOUS
    （INVALID 属前置状态，非 Decision 值）
    · LEGACY / UNREACHABLE 不进入本枚举

【轴 2】Runtime Attributes（独立报告，不参与轴 1 判定）
    ownership     = single | multi | undefined
    deprecated    = true | false
    competing     = NONE | IDENTIFIED | UNCLEAR
    reachability  = WIRED | TEST_ONLY | UNREACHABLE
```

---

## §5 审查范围与频率（G-5）

```text
默认：Scoped SoT Legality
  Slice → 识别【本 Slice 实际读取 / 新引入】的语义来源 → 逐源判定

升级：Expanded SoT Legality Review（自动触发，条件 = Slice 触及下列任一）
  SoT 本体 · Repository accessor · Projection · Ownership · Contract 条文
```

---

## §6 L7 Reachability：主体外置且正交

```text
Semantic Authority   ⟂   Runtime Reachability
⇒ 独立判定 + 联合报告；不得由 Reachability 反推 SoT Legality。

反例锚点：supersedeClaim = contract-covered（T9）+ test-covered + production-unwired
         ⇒ SoT Legality = LEGAL 且 Reachability = TEST_ONLY 可【同时成立】。
```

---

## §7 G-3 Authority Resolution 的规范缺口

```text
✅ current predicate 权威【有逐字条文】：
   docs/phaseC/implementation-contract.md:244   ★ C-FIX-12：listCurrentBeliefs() 是全系统唯一的 current predicate 来源
   docs/phaseC/implementation-contract.md:1045  ★ P5 / CR-6 / C-FIX-12：Report 的"当前认知"必须与 §3.3 同一判据，且只能经 KnowledgeRepository
   docs/phaseC/implementation-contract.md:1226  current 判据唯一化（§3.3 / §8 / §14 / C-FIX-12）
   docs/phaseC/implementation-contract.md:1659  [ ] listCurrentBeliefs() 是唯一 current predicate（C-FIX-12）
   docs/phaseC/implementation-contract.md:1749  | C-FIX-12 | current predicate 必须唯一 |
   docs/phaseC/c4-implementation-contract.md:310   > 红线 4.1：current 的判定只有 listCurrentBeliefs() 一处
   docs/phaseC/c4-implementation-contract.md:508   I-C4-2 current 的唯一判据 = state === "confirmed"（且只经 listCurrentBeliefs()）

⚠️ knowledgeId anchor 权威【无逐字规范性条文】：
   findKnowledgeBySubject —— 仅 c4-implementation-contract.md:116（表格罗列）
   + c5-implementation-contract.md:1143（证据引用）+ 9 处生产消费者

⇒ 诚实记录（不补造契约）：
   Architecturally treated as the current authority by the existing
   KnowledgeRepository architecture and production usage,
   but LACKING an explicit normative authority clause.
```

### AD-R6-1（Architecture Debt / Normative Explicitness Gap）

```text
AD-R6-1  Knowledge anchor authority lacks explicit normative clause
Severity  : Low（规范显式性不足，不是「当前 SoT 不合法」）
Status    : 📋 REGISTERED（仅登记在本记录内；不单独建档、不 remediation）
Review 触发条件（满足任一才考虑补 normative contract）：
   ① 出现第二个 Knowledge anchor candidate
   ② 需要改变 KnowledgeRepository ownership
   ③ 有新 Slice 需要依赖该 authority
   ④ 发生 authority 冲突
   ⑤ 要把 R6-ERR 正式自动化
```

---

## §8 真实案例库（全部行号已逐条复核）

```text
Case 1  Industry.currentKnowledgeId   ⇒ ILLEGAL（R2 命中）
        domain/industry.ts:23 · domain/industry-knowledge.ts:12(DEPRECATED) ·
        src/cli/research-commands.ts:239(禁令) · storage/knowledge-repository.ts:44(竞争源)
Case 2  current predicate 权威示例     ⇒ 证明 C-FIX-12 权威（implementation-contract.md:244 等）
Case 3  双源 + 权威指定                ⇒ 被指定者 LEGAL / 竞争者 ILLEGAL（R5）
Case 4  currentStateId（multi-owner 无声明）⇒ AMBIGUOUS
        domain/industry.ts:21 · domain/company.ts:18 · research-repository.ts:89/135/1707/1771 ·
        application/opportunity-discovery-service.ts:248
Case 5  supersedeClaim                ⇒ SoT Legality = LEGAL；Reachability = TEST_ONLY
        opportunity-discovery-service.ts:381(def)/410(provenance:"user")/417(isRealExternalData:true) ·
        foundation.test.ts:163/169/180
Case 6  ClaimTemporalRelation vs KnowledgeBeliefState ⇒ 名称相似 ≠ 语义相同（H2-04）
```

---

## §9 Freeze 前仍需闭合

```text
① 本记录经 Human Gate 审阅（当前 = PROPOSED）
② G-3 保持 PARTIAL + AD-R6-1 已登记（不做 micro-contract）
③ Formal Freeze 与 Implementation Authorization 必须【继续分离】
```

---

## §10 明确不授权

```text
❌ Implementation / runtime / SoT checker / CLI / Repository API
❌ Methodology v1 修改
❌ 生产代码 / 测试代码
❌ H-1 / H-2 修改（含 §10 原文）
❌ H-3 / H-4 / H-5 / M-* / legacy cleanup / supersedeClaim remediation
❌ AD-R6-1 单独建档
```

---

## §11 修订历史

```text
v1    L6 Slice Legality → L6 Slice Dependency Legality
      新增 §3.1 Decision Resolution（R1–R6 确定性短路 + 属性不判死 + 情形对照表）
      §1 措辞：读取…的合法权威性 → 作为…的合法权威来源

v1.1  §7 G-3 措辞收紧：Architecture-authoritative by existing repository architecture
        → Architecturally treated as the current authority by the existing KnowledgeRepository
          architecture and production usage, but LACKING an explicit normative authority clause
      §8 Case 2 更名：current predicate 反例 → current predicate 权威示例
```
