# Tiancha Phase C — Implementation Contract

> **Phase C Full Contract v1 · Final Lock Candidate · rev 2**（已按 Final Lock Review 的 C-FIX-1…6 修订，见 §28.5）
>
> **状态：Final Lock Candidate —— 等待用户审批后冻结。`C1 未授权实现`。**
> 基线：**Phase B v1 FINAL PASS**（B5 代码 `6eb9ea2` / B5 文档 `8ec8f6f` / acceptance closure `27b9a37` / final cleanup `7faa8e5` = 当前 HEAD）。
> 本文是 Phase C 的**业务、领域与实现边界契约**；**在本文冻结之前，不允许进入 C1 编码**。
> **本版已同步 P1–P6 最终裁决与 CR-1–CR-12 一致性修订**：逐条落实对照见 **§28**。
> 上游：`06-business-intelligence-architecture-v3.1-final.md` · `07-domain-model-design.md` · `08-code-design.md` · `docs/phaseB/implementation-contract.md`（B1–B5 已实现）。

> ★ **本契约与既有实现的关系（最重要的一条前提）**
> `Knowledge → Pool → Gap → NextAction → State` 这条投影链**已经存在并且已经接线**：
> `KnowledgeProjectionService.refreshSubject()` = `reconcilePool → refreshGaps → refreshNextActions → refreshState`，由 `OpportunityDiscoveryService.ingestClaims()`（以及 C-MVP 的 material 入口）触发。
> 因此 Phase C **不是从零新建这条链**，而是**在这条链上修改 / 补齐 / 独立验证语义**。
> 对应的红线：
> > **C1 可以触发既有 Pool / Gap / NextAction 链，但不得在 C1 中重新定义它们的业务规则。**

---

## 0. Phase C 的唯一目标

Phase C 不负责"再做一个材料上传器"。

C-MVP 已经解决：

> 用户材料 → 基础 Claim 提取 → Pool / Gap 状态变化

Phase C Full 要解决的是：

> **一次真实调研产生的新材料，如何安全地改变天查对行业的长期认知，并使认知变化继续传导至 Pool → Gap → Priority → NextAction → Report。**

最终闭环：

```text
Research Target
      ↓
Diligence Preparation
      ↓
真实调研
      ↓
Research Material
      ↓
Claim
      ↓
Knowledge Projection
      ↓
Knowledge / Belief / Conflict
      ↓
Information Pool
      ↓
Gap Lifecycle
      ↓
Research Priority
      ↓
Next Action
      ↓
Report
```

核心原则：

> **新材料可以改变"当前认知"，但不得抹掉"历史认知"。**

---

## 1. Phase C 不允许做什么

Phase C 默认禁止：

* 重做 C-MVP；
* 重做 Material ingest；
* 顺带开放 Agent `project chain` / `record target` 写权限；
* 自动发现或虚构研究企业；
* 自动选择研究目标；
* 自动生成未经确认的事实；
* 用 LLM 替代确定性领域规则；
* 删除历史 Claim；
* 覆盖式更新 Knowledge；
* 强制解决冲突；
* 因为出现新 Claim 就直接删除旧 Pool Item；
* 因为 Gap 状态变化而偷偷修改 Priority Policy；
* 因为 Knowledge 更新而绕过 Evaluation；
* Report 反向写 Knowledge / Pool / Gap；
* 引入 Evidence / Fragment 大链条，除非后续单独授权；
* 引入 Experience 完整领域；
* 引入投资策略、交易决策或自动投资建议。

> **C1 追加禁止（CR-9 的推论）**：不得借 C1 之名重新定义 Pool / Gap / NextAction 的**业务规则**（Sufficiency Policy、Gap 类型映射、Priority 因子与排序）。C1 只能改变**进入这条链的知识判定**，并验证链的下游表现。

---

## 2. SoT 边界

Phase C 必须明确区分：

```text
Claim
  ↓
Knowledge Projection
  ↓
Information Pool
```

三者不是同一个东西。

### 2.1 Claim

Claim 是：

> 某份材料中提取出的、具有来源指向的具体陈述。

Claim 是事实陈述的历史记录。

**Claim 不因后续知识变化而删除。**

实现事实：Claim 存在 **`artifacts.sqlite`**（`research_artifact.blob`，`kind="claim"`），主库只持有引用（`artifact:claim/<claimId>`）；`claimId = claim-<uuid>`；全仓**不存在任何删除 Claim / Belief 的代码路径**。

### 2.2 Knowledge

Knowledge 是：

> Tiancha 对某个 Industry 当前认知的结构化投影。

Knowledge **不是原始事实库**。

Knowledge 允许随着新材料发生：

* 支持；
* 修正；
* 冲突；
* 被取代。

但这些变化必须保留历史轨迹。

因此：

> **Knowledge 是当前认知的 Projection，不是 Claim 的替代品。**

实现事实：主库有三张表 `industry_knowledge`（header，version 递增）/ `knowledge_belief`（**只 INSERT + 只翻转 state**）/ `knowledge_conflict`（只翻转 status）；**无任何 UNIQUE 约束**（见 §16 与 §18）。

### 2.3 Information Pool

Information Pool 是：

> 面向研究状态与问题覆盖度的 operational projection。

Pool 不承担完整知识历史。

Pool 可以读取当前有效 Knowledge / Belief，但不能成为 Knowledge 的 SoT。

因此：

```text
Claim       = 历史证据性陈述
Knowledge   = 当前认知 Projection
Pool        = 当前研究覆盖状态 Projection
Gap         = 当前信息缺口
```

不得反过来理解。

实现事实（既有语义，C1 不得改变）：

* Pool 的 **item 记录该维度的全部 beliefs**（含 `revised` / `conflicting` 历史，永不整体删除）；
* Pool 的 **`sufficient` 判定只使用 `state === "confirmed"` 的 belief**，并按该 slot 的 `Requirement.sufficiencyPolicyRef` 经 `PolicyRegistry` 解析后的 policy 判定；
* `requirement.sufficiencyPolicyRef` **缺失或未知 ⇒ 抛错**（不得静默回退，否则 provenance 失真）；
* **没有 requirement 的 slot 永远不能到达 `sufficient`**。

### 2.4 `industry.current_knowledge_id`（**已裁决：弃用**）

> **裁决（P4）**：`industry.current_knowledge_id` **不作为 C1 的 current 判断依据**。

理由：它会制造**第二套 current SoT**。系统已经用 `belief.state` 表达当前认知；如果再有 `industry.current_knowledge_id`，就会出现"指针指向 K1，但 K1 全是 `conflicting`，K2 才有 `confirmed`"的歧义。

约定：

* `C1 不读取、不写入该列`；
* 该列在本文与实现中标记为 **`DEPRECATED / UNUSED`**；
* 如果无法立即从 schema 删除，则保留，但**以后单独 cleanup**，不并入 Phase C。

实现事实：该列当前**只被写成 `null`**，全仓没有任何生产代码读取它。

---

## 3. Knowledge 的历史原则

### 3.1 历史永久保留

任何已经形成过的 Knowledge Belief：

> **原则上永久保留。**

不能通过 update/delete 把旧认知从数据库中抹掉。

状态变化只允许形成新的 projection / revision / supersession 关系。

> **实现红线**：`belief` 行**只 INSERT**，状态变化**只做 `state` 翻转**；任何"为了加约束而清洗历史数据"的行为一律禁止（见 §16）。

### 3.2 Current ≠ History

一个 Industry 可以同时存在：

```text
Current Knowledge
        +
Historical Knowledge
        +
Conflicting Knowledge
```

其中：

* Current：当前用于研究判断的认知；
* Historical：曾经有效但现在不再作为 current 的认知；
* Conflicting：目前无法合理归并的相互冲突认知。

### 3.3 术语唯一判据（**新增 · 解决 CR-5 / CR-6**）

> **`current` 不是一个独立 state，而是由 `state` 派生出来的视图。**

第一版唯一判据：

```text
current belief  ≡  state == "confirmed"
```

| state         | 是否 current | 含义                       |
| ------------- | -----------: | ------------------------ |
| `candidate`   |            ❌ | 等待 Human Gate            |
| `confirmed`   |            ✅ | 当前有效认知                   |
| `revised`     |            ❌ | 已被修正，但历史保留               |
| `superseded`  |            ❌ | 已被整体取代                   |
| `conflicting` |            ❌ | 当前存在冲突，不能作为已确认认知         |

因此（**对既有实现的兼容性修正，属 C1**）：

* `listCurrentBeliefs()` **必须只返回 `state == "confirmed"`**，而**不是**当前的 `state != "superseded"`；
* 任何"当前认知"视图（含 Report 的"当前认知"节）**必须**使用同一判据，不得各写一套；
* 历史（`revised` / `superseded` / `conflicting`）仍然**全部保留**，只是**不再出现在 current 视图**里。

---

## 4. 知识演化：`ProjectionOutcome`（**分层定义**，CR-11）

Phase C 固定以下枚举，并**分层理解**——它们不是"六种 Evolution relation"：

```text
ProjectionOutcome
├── NEW          （结构事件：该维度此前无 Knowledge）
├── SUPPORT      （Evolution relation）
├── REVISE       （Evolution relation）
├── CONFLICT     （Evolution relation）
├── SUPERSEDE    （Evolution relation）
└── SKIPPED      （未投影事件：Claim 没有被安全地投影）
```

* **`NEW`**：不是演化关系，而是"当前维度没有既有 Knowledge，该 Claim 创建第一条 belief"。
* **`SKIPPED`**：不是知识演化，而是"该 Claim 没有被安全投影"（例如占位数据、非法 relation、缺失必要信息、无法满足 projection 不变量）。**必须记录原因，且不得改变任何 current 认知。**
* **`SUPPORT` / `REVISE` / `CONFLICT` / `SUPERSEDE`**：四种真正的 Evolution relation。

> ★ **`NEW` 与 `SKIPPED` 必须保留**，不得从实现或契约中删除：
> 缺少 `NEW` 会破坏"首次投影"的表达，缺少 `SKIPPED` 会破坏 **Invariant 13**（占位数据不得进入 Knowledge）。

### 4.1 SUPPORT

定义：

> 新 Claim 为已有 Knowledge 提供额外支持，但不改变其核心含义。

结果（**按既有实现语义写定**）：

* 原 belief **保持 `confirmed`**（不翻转状态）；
* **新增一条 belief**（自身 `state = "confirmed"`，作为一条新的当前支持）；
* 新 belief 记录关系边 `historicalRelations: [{ relation: "SUPPORT", otherBeliefId }]`；
* **不产生 Conflict**；
* `current` 视图因此**多一条** confirmed belief（"current knowledge" 是**该维度的 confirmed belief 集合**，不是"一行"）。

> 与契约早期措辞的差异（CR-1 相关）：SUPPORT **确实会新增一条 current belief**；"不产生新的 Current Knowledge"应理解为"不改变 anchor 的含义与状态"，而不是"不写入任何行"。

### 4.2 REVISE

定义：

> 新 Claim 表明已有 Knowledge 的部分内容需要修正，但旧 Knowledge 仍然具有历史意义。

结果：

```text
旧 belief → state = "revised"   （历史保留，退出 current 视图）
新 belief → state = "confirmed" （成为 current）
关系边     → new.historicalRelations = [{ relation: "REVISE", otherBeliefId: old }]
```

**旧 belief 永久保留**，必须能够追溯到"新认知修正了哪一条旧认知"。

### 4.3 CONFLICT

定义：

> 新 Claim 与已有 Knowledge 在当前证据条件下无法同时被视为同一认知的无冲突表达。

结果（**按 P2 裁决 + C-FIX-1 写定**）：

```text
该维度【全部】当前 confirmed beliefs → state = "conflicting"
      （含 anchor＝直接冲突中的旧认知、含新 Claim 形成的 belief、
        也含该维度其他原本 confirmed 的 beliefs）

KnowledgeConflict { claimARef: anchor.claimRef, claimBRef: new.claimRef, dimension, status: "open" }
      ← 只记录【直接冲突的那一对】；不为其他 beliefs 虚构 conflict edge

该维度 confirmed belief = 0
```

* **禁止自动选择赢家**；
* **所有相关 belief 都必须保留**（不删除、不改写内容）；
* **CONFLICT 是「维度级」研究状态**：一旦该维度发生冲突，该维度的**当前认知整体作废**（全部退出 `confirmed`），而不是只作废其中一条；
* 因为该维度已无可用的 `confirmed` belief，**Pool 该 slot 变为 `conflicting`**，**Gap 变为 `conflict`**（§10）；
* **状态传播 ≠ 关系图**：`conflicting` 可以传播到该维度的所有 current beliefs，但 `KnowledgeConflict` 关系**只记录直接冲突对**（不制造 B↔D、C↔D 这类虚构边）。

Conflict 本身就是研究状态。

### 4.4 SUPERSEDE

定义：

> 新 Knowledge 在证据充分且语义明确的情况下，整体替代旧 Knowledge 作为 current cognition。

结果：

```text
旧 belief → state = "superseded"（历史保留，退出 current 视图）
新 belief → state = "confirmed"  （成为 current）
关系边     → new.historicalRelations = [{ relation: "SUPERSEDE", otherBeliefId: old }]
```

但是：

```text
old ≠ deleted
```

是否仍满足该 Requirement，**完全由既有 Sufficiency Policy 决定**（不得因为"这是一次 SUPERSEDE"就默认 `sufficient`）。

---

## 5. Evolution 的判定规则（**P1 裁决后的唯一算法**）

Phase C-1 **不允许 LLM 自由决定演化操作**。第一版必须是：

> **确定性领域规则 + 明确输入信号。**

**"明确输入信号"的第一版来源**是材料中的显式声明（C-MVP 已支持）：

```text
[CLAIM]
dimension: market
content: ...
relation: SUPPORT | REVISE | CONFLICT | SUPERSEDE      # 可选
supersedes: artifact:claim/xxx                          # relation=SUPERSEDE 时必需
[/CLAIM]
```

**判定算法（封闭枚举，唯一实现）**：

```text
有合法 relation 声明            → 使用该 relation
无 relation + 同维度无 anchor   → NEW
无 relation + 同维度有 anchor   → SUPPORT（规则默认，确定性）
relation 值非法                 → 记录 error，且【不投影】（SKIPPED）
relation=SUPERSEDE 但缺 supersedes → 记录 error，且【不投影】（SKIPPED）
```

> ★ **P1 裁决**：`无 relation + 有同维度 anchor ⇒ SUPPORT` 是**确切的规则默认**，**不是"无法判断"**。不得把它改写成"进入 Human Gate"，否则会改变既有材料的语义、并直接影响 Pool `sufficient` / Gap 关闭 / Priority。

**"无法判断"的定义（C-FIX-2：只说"无法形成可审查候选"）**：

> "无法判断" = **既有规则无法构造出任何可审查、可展示的候选认知**（例如：需要跨维度 / 跨口径的比较，而第一版没有 Metric Ontology；缺少必要字段；无法建立合法 Evolution relation）。
>
> 此时：

```text
→ 不强行投影
→ 保留 Claim
→ 标记为 SKIPPED + reason（可复核、可重放）
→ 不创建 candidate
→ 不改变任何 current 认知
```

### 5.1 SKIPPED 与 CANDIDATE 的二分（**C-FIX-2，硬规则**）

```text
若规则无法形成任何可审查的候选认知                    → SKIPPED（绝不创建 candidate）
若规则能形成明确、可解释、可展示、可被确认的候选，
   但【不允许】自动成为 current                      → candidate + Human Gate（§7）
```

> * **不得把 `SKIPPED` 自动转成 `candidate`**；
> * **也不得把候选降级成 `SKIPPED` 来"绕过"Human Gate**；
> * 两者是**两种不同的处理结果**，判据只有一条：**规则能不能构造出一个可展示、可确认的候选认知**。

因此：

> **宁可暂不更新 Knowledge，也不能因为自动判断不确定而错误覆盖认知。**

---

## 6. Conflict 处理原则（**P2 裁决后的唯一语义**）

Conflict 是一等公民。

### 6.1 Conflict **不选边**：该维度的 current 认知**整体**失去 current 状态

```text
该维度全部 current confirmed beliefs → conflicting
      （anchor A、新 Claim B、以及该维度其他原本 confirmed 的 beliefs）

KnowledgeConflict { claimARef: A, claimBRef: B }（status = open）   ← 仅【直接冲突对】
current confirmed belief on this dimension = none
```

> ★ **C-FIX-1（维度级一致性）**：CONFLICT 的对象是**该维度的当前认知**，不是"两个 belief 之间的局部事件"。
> 若只把 anchor 与新 Claim 置为 `conflicting`，该维度可能仍有其他 `confirmed` belief 存活 —— 那样
> "该维度 confirmed = 0 / Pool = conflicting / Gap = conflict"这几条规则**无法同时成立**。
> 因此：**状态传播到整个维度，关系边只记直接冲突对。**

**不能**出现"保留 A 为 current、B 为 conflict"的形态。理由：

```text
旧 A 仍 confirmed
      ↓
Pool 继续认为该 Requirement sufficient
      ↓
等于系统在发现冲突之后，仍然偷偷相信旧答案
```

**不允许。**

### 6.2 Conflict 不等于错误

Conflict 的含义是：

> 当前证据不能让系统把两个认知安全地合并为单一认知。

它不表示：A 错 / B 对 / 谁更可信。

除非后续出现足够的新信息并经过明确的领域规则（或 Human Gate 确认）。

### 6.3 Conflict → Gap

如果 Conflict 对某个 Requirement 有实质影响：

```text
Conflict（open）
   ↓
该维度 confirmed belief = 0
   ↓
Pool slot = conflicting
   ↓
Gap = conflict（若原本 resolved 则【重新打开】）
```

因此 Conflict 可以重新打开一个此前已经解决的 Gap。

---

## 7. Human Gate（**P3 裁决：最小方案**）

Phase C 必须保留 Human Gate。

> **P3 裁决**：引入"知识候选"，但采用**最小方案** —— `belief.state` 增加 **`candidate`**。
> **不复用** methodology 的 `human_gate`（两者语义必须独立）。

### 7.1 状态与流转

```text
candidate  ──（人确认：confirmCandidate + 显式 relation）──→  confirmed
candidate  ──（人拒绝 / 丢弃）──→  不进入 current（历史保留）
```

`KnowledgeBeliefState` 最终为：

```text
candidate | confirmed | revised | superseded | conflicting
```

> `candidate` **不是 current**（§3.3）：它不参与 Pool 的 `sufficient` 判定，也不进入 Report 的"当前认知"。

### 7.2 什么必须走 Human Gate（**B 类：可形成候选，但不得自动成为 current**）

以下情况**不得自动成为 current**：

* 关键维度（`criticality = critical`）发生重大修正；
* 高重要性 Conflict；
* 多个同等级候选无法区分；
* 需要用户确认的事实；
* 其他"规则能构造出明确候选、但第一版不允许自动确认"的情况。

系统可以：

> **提出候选认知 + 给出依据 + 请求用户确认。**

但**不能假装用户已经确认**。

> ★ **C-FIX-2 边界**：本节每一项都必须是"**规则能构造出一个可审查的候选**"。
> 如果规则连候选都构造不出来（§5 的"无法判断"），结果是 **`SKIPPED`，而不是 `candidate`**。

### 7.3 候选的确认是**独立的 Human Gate 状态迁移**（**C-FIX-3**）

```text
projectFromClaim(claim)                 ← 投影（重复调用 ⇒ no-op，§16.2）
confirmCandidate(beliefId, relation)    ← 人工确认（显式状态迁移）
```

> * 二者是**两个不同的动作**，不得混为一谈；
> * **`candidate → confirmed` 只能由 `confirmCandidate` 完成**；
> * **不得**通过"再次投影同一个 Claim"来确认候选（那只会 no-op，造成"用户以为确认了、系统其实没确认"）；
> * 因此实现里**不存在**"投影时发现已有 candidate 就顺手确认"的路径。

### 7.4 确认时必须**显式指定最终 Evolution relation**（**C-FIX-4**）

确认一个候选**不是**简单地把 `state` 改成 `confirmed`，而是必须同时确定它"演化成了什么"：

```text
candidate
   ↓ human confirms + relation = NEW | SUPPORT | REVISE | SUPERSEDE
   ↓
按该 relation 的既有规则落地（§4 / §8 Rule A–C）：新增 / 支持 / 修正 / 取代
```

* **relation 由人显式给出**，**不得由实现自由推断**；
* `CONFLICT` **不是**候选确认时的合法终态选择（冲突由 §4.3 的规则判定，不由人工"确认"产生）；
* 人选择 `REVISE` / `SUPERSEDE` 时，按 §4.2 / §4.4 的规则翻转旧 belief 状态并建立关系边；
* 人选择 `NEW` / `SUPPORT` 时，新 belief 直接成为 `confirmed`（`NEW` 仅在该维度确实无既有认知时成立）。

### 7.5 候选必须"可展示、有依据"（**语义冻结；字段实现留 C1**）

> 契约冻结的是**语义要求**，不是字段名：

```text
candidate 必须可以被展示为：
  - candidate belief（其维度 / 来源可查）
  - 来源 Claim（artifact:claim/<claimId>）
  - candidate reason（为什么需要人确认：封闭短语或结构化理由）
  - requiresHumanGate = true
```

字段层面（复用现有 `confidence` / `topic`，还是新增 `candidateReason`）**留待 C1 决定**。

### 7.6 确认入口与权限

* 第一版确认入口：**CLI / researcher human action**（`tiancha research knowledge ...`，具体命令名在 C1 实现时定）。
* **Agent 只读**：可以展示候选、解释候选、展示来源、提示"需要确认"；**Agent 不得自动确认 candidate**（延续 Phase B Q1）。
* Agent 不新增写工具。

### 7.7 与 methodology Human Gate 的关系

```text
methodology human_gate  ≠  knowledge confirmation
```

两个领域**语义独立**，不得共用同一套表语义、不得共用同一套 token/审批流程。

---

## 8. Current Knowledge 的确定规则

Current Knowledge 不是"最后写入的就是 current"。第一版必须遵循：

### Rule A：SUPPORT

已有 `confirmed` belief **保持 `confirmed`**（新增一条 `confirmed` 支持 belief）。

### Rule B：REVISE

新 belief 成为 `confirmed`；**旧 belief → `revised`（退出 current 视图）**。

### Rule C：SUPERSEDE

新 belief 成为 `confirmed`；**旧 belief → `superseded`（退出 current 视图）**。

### Rule D：CONFLICT（**P2 + C-FIX-1**）

> **不得选择 current。** CONFLICT 的对象是**该维度的当前认知整体**：该维度**所有**当前 `confirmed` belief（anchor、新 Claim 形成的 belief、以及该维度其他原本 `confirmed` 的 belief）**全部**失去 `confirmed` 状态（置 `conflicting`），Conflict 记录为 `open`。

```text
该维度全部 confirmed beliefs → conflicting     （维度级传播）
KnowledgeConflict             → 新增（open）  （只记直接冲突对）
current confirmed belief（该维度）= 无
Pool slot = conflicting
Gap = conflict
```

> 只把 anchor 与新 Claim 置为 `conflicting` 是**错的**：该维度若仍有 `confirmed` belief 存活，
> 就会与本节"该维度 confirmed = 0 / Pool = conflicting / Gap = conflict"自相矛盾。

而不是：

```text
last write wins
保留原 current
```

> Rule D 的判据与 §6.1 完全一致：**任何"发现冲突后仍保留一方为 current"的实现都是错的。**

### Rule E：candidate（**P3**）

`candidate` 既不进入 current，也不进入 Pool 的支撑集合；只有在**人确认**后才转成 `confirmed`（并按其确认时选定的 relation 语义落地：新增/修正/取代）。

---

## 9. Information Pool 与 Knowledge 的关系

Pool 不保存完整 Knowledge 历史。

Pool 主要回答：

> "当前这个 Requirement 到底有没有足够的信息？"

因此：

```text
Knowledge evolution
       ↓
KnowledgeProjection
       ↓
Pool reconciliation
       ↓
Requirement / Gap lifecycle
```

Pool 必须能够表达：

* unknown；
* partial；
* sufficient；
* conflicting；
* （经 Gap）reopened。

> **既有语义（C1 不得改变）**：
> ① item 记录该维度**全部** beliefs（历史保留，不整体删除）；
> ② `sufficient` 判定**只用 `confirmed`**，并使用该 slot 的 `Requirement.sufficiencyPolicyRef` 指向的 policy；
> ③ policy ref 缺失/未知 ⇒ **抛错**；④ 无 requirement 的 slot 永不到 `sufficient`。

---

## 10. Gap 生命周期

Phase C 允许 Knowledge Evolution（经 Pool）驱动 Gap 状态变化。

典型路径：

```text
unknown
   ↓
partial
   ↓
sufficient
```

也允许：

```text
sufficient
   ↓
reopened
```

以及：

```text
partial
   ↓
conflict
```

但：

> **Gap 状态变化必须通过既有 Sufficiency Policy / Evaluation 语义决定；Knowledge Service 不得自己发明新的 sufficiency 标准。**

> **既有实现（C2 验证对象，非新建）**：Gap 由 Pool slot status 驱动 —— `sufficient ⇒ resolved`（行保留）、`partial ⇒ gapType=insufficient`、`unknown ⇒ gapType=unknown`、`conflicting ⇒ gapType=conflict`（**不自动解决**）；已 resolved 的 gap 在 slot 再次降级时**重新打开（同一 `gapId`，`discoveredAt` 保留）**。

---

## 11. 什么情况下 unknown → sufficient

不能简单规定：

> "出现一个 Claim = sufficient"。

必须继续使用已有 Requirement 的 suffiency policy：

```text
new Claim
  ↓
Knowledge projection（必须是 confirmed 才计入）
  ↓
Pool evidence state
  ↓
existing sufficiency policy
  ↓
Gap lifecycle
```

**C1 不修改 S4.5 的 sufficiency policy。**

> 推论（CR-1 的影响）：若 C1 让某条 claim 变成 `candidate`（而非 `confirmed`），它**不能**帮助该维度达到 `sufficient`。这是 `candidate` 的预期效果，也是"默认 SUPPORT"必须保留的原因（否则既有材料会集体失去支撑）。

---

## 12. 什么情况下 sufficient → reopened

如果已有 Requirement 曾经 `sufficient`，但新的 Knowledge Evolution 造成：

### 情况 A：REVISE

新认知使原 Requirement 的关键事实发生变化：

```text
sufficient → reopened
```

（实现上：新的 confirmed belief 改变了该维度的证据集合，policy 重判后若不满足 ⇒ slot 降级 ⇒ gap 重新打开。）

### 情况 B：CONFLICT

出现重大冲突（该维度**全部** current 认知置 `conflicting` ⇒ 该维度无 confirmed）：

```text
sufficient → reopened（gapType = conflict）
```

### 情况 C：SUPERSEDE

新认知替代旧认知，但**仍满足** Requirement 的 policy：

```text
保持 sufficient
```

（若新认知**不满足** policy ⇒ 按情况 A 的规则 reopened。判据永远是 policy，不是"操作类型"。）

### 情况 D：SUPPORT

一般：

```text
保持 sufficient
```

---

## 13. Priority 的处理

Phase C **不重新设计 S5 Priority**。

Priority 的职责仍然是：

> 对当前 Gap 进行研究获取优先级。

因此：

```text
Knowledge change
      ↓
Gap state change
      ↓
existing persisted Priority / NextAction lifecycle
```

如果 Gap reopened：

> 允许产生新的 Priority 状态 / NextAction。

但：

* 不修改 Priority Policy；
* 不改变 S5 `acquisitionValue` / `acquisitionCost` 定义；
* 不让 KnowledgeService 直接计算 priority；
* 不让 Report 重新计算 priority。

> **既有实现（C3 验证对象，非新建）**：Gap → NextAction 已由 `PriorityService.rank()` + gapType→actionKind 映射驱动，幂等、可审计（因子明细写入 `params`）、gap 关闭则 action `cancelled`。

---

## 14. Report 的处理

Report 继续遵守 S6-R1 的原则：

> **读取已持久化的当前状态，不偷偷重新计算上游业务状态。**

Knowledge 更新后：

```text
Knowledge
Pool
Gap
Priority
NextAction
       ↓
Report
```

Report 可以展示：

* 当前认知（`state == "confirmed"`）；
* 新增认知；
* 被修正认知（`revised`，**标注为历史**）；
* Conflict；
* 已 supersede 的历史认知；
* 候选认知（`candidate`，**标注为待确认**）；
* reopened Gap；
* 新 Priority；
* 下一步研究动作。

但 Report 不得：

* 创建 Knowledge；
* 确认 candidate；
* 解决 Conflict；
* 修改 Gap；
* 重新计算 Priority。

> ★ **P5 / CR-6 的兼容性要求**：Report 的"当前认知"**必须**与 §3.3 使用同一判据（`state == "confirmed"`）。当前实现里 `ReportService` 的"当前认知"用的是"非 superseded"集合，会**把 `revised` 的旧认知也算作当前认知** —— 这必须在 **C1** 内一并对齐（属 C1 的兼容性修改，不属于 C2）。

## 15. 历史可追溯性（**CR-10：跨库，应用层解析**）

任何 Knowledge 当前状态，都必须能够回答：

> "为什么现在会变成这样？"

至少需要形成逻辑链：

```text
Current Knowledge（confirmed belief）
      ↓
Evolution relation（historicalRelations: SUPPORT/REVISE/CONFLICT/SUPERSEDE）
      ↓
Previous Knowledge（revised / superseded / conflicting belief，全部保留）
      ↓
Claim（artifact:claim/<claimId>）
      ↓
Material（material.claim_refs 记录裸 claimId）
```

> ★ **CR-10 写定**：这条链是**跨库的** —— Claim 存在 `artifacts.sqlite`，`Material` / `Knowledge` 在主库 `tiancha.sqlite`。
> 因此：
> * 追溯**通过应用层解析**（`ArtifactStore.get(claimId)` + 主库按 `claimRef` 反查 Material），**不要求 SQL join**；
> * **不允许**为了"可 join"而给 Phase C 加表/加列；
> * **不允许**把 Claim 正文复制进 Knowledge（§2.2：Knowledge 不是事实库）。
> * `belief.claimRef` 的唯一前缀写法是 `artifact:claim/<claimId>`；`Material.claimRefs` 存的是**裸 claimId**（已知的不对称，C1 不修改，但追溯时不得混用）。

---

## 16. 幂等（**P6 裁决后的唯一规则**）

Knowledge projection 必须幂等。同一个：

```text
subject
+ claim
+ existing knowledge state
```

重复投影**不得**产生无限重复 Knowledge。

### 16.1 身份规则（唯一）

```text
beliefId   = deterministic(knowledgeId, claimRef)
```

实现可以采用项目既有的确定性 identity 风格（例如 `bel-<knowledgeId>-<slug(claimRef)>`），**不要求**与本文示例逐字符一致，但必须满足：

* **不含时间戳、不含随机数、不含序号**；
* 同一 `(knowledgeId, claimRef)` **永远**得到同一个 `beliefId`。

同理，Conflict 的身份也必须确定性，且**对 claim pair 无方向性**（**C-FIX-5**）：

```text
canonicalClaimPair = sort([claimARef, claimBRef])              // 规范化顺序（字符串序）
conflictId         = deterministic(dimension, canonicalPair[0], canonicalPair[1])
```

> * `(A, B)` 与 `(B, A)` **必须**得到同一个 `conflictId`；
> * 否则同一冲突会出现两条记录（`KCF-1: A↔B` 与 `KCF-2: B↔A`），直接破坏 §16.2 的幂等。

### 16.2 重复投影的行为（唯一）

```text
第 1 次投影：(knowledgeId, claimRef) 不存在 → INSERT
第 2 次投影：(knowledgeId, claimRef) 已存在 → 【no-op】
```

`no-op` 的准确含义：**不新增 belief 行、不翻转任何 belief 的 state、不新增 Conflict 行、不改变 current 视图**。

因此：

```text
projection(A)
projection(A)
        ↓
最终领域状态完全一致（含 version 与 Pool / Gap / NextAction 的可观察结果）
```

### 16.3 与 REVISE / SUPERSEDE 的关系

REVISE / SUPERSEDE 产生**新的 belief**（`claimRef` 不同）⇒ 身份天然不同 ⇒ **不是**重复投影，仍然照常新增行并翻转旧行状态。

### 16.4 历史 belief ID **不得批量改写**

历史 belief 可能已经被 `knowledge_conflict`、Pool item、测试或其他 artifact 引用。

> **新投影使用确定性 identity；历史已有 belief 的 ID 不做无意义的批量改写。**

### 16.5 若要增加 UNIQUE 约束（可选，附带硬条件）

如果为了保证数据库层面的绝对幂等需要增加 `UNIQUE(knowledge_id, claim_ref)`，**必须同时满足**：

1. 先检查历史数据；
2. 确认不存在重复（同一 `(knowledge_id, claim_ref)` 只有一行）；
3. migration 可回滚；
4. **不删除任何历史 belief**；
5. 不改变已有 belief 的语义。

> **不能为了加 UNIQUE 而偷偷清洗历史数据。** 若检查发现历史重复，则**停止**加约束，改为在 C1 内单独提出"历史去重"的授权请求。

### 16.6 `candidate` 的确认**不是**投影（**C-FIX-3**）

* `projectFromClaim()` 与 `confirmCandidate()` 是**两个不同的动作**；
* 对同一条已存在 `candidate` 的 Claim 重复调用 `projectFromClaim()`，仍然**遵守 §16.2 的 no-op**（不新增行、不翻转 state、不改变 current 视图）；
* **`candidate → confirmed` 必须通过显式的人工确认动作完成**（§7.3 / §7.4），**不能、也不得**通过"重复投影同一个 Claim"来实现；
* 因此实现里**不存在**"投影时发现已有 candidate 就顺手确认"的路径，也不存在"投影即确认"的隐式语义。

---

## 17. 不允许的写入方向

严格禁止：

```text
Report → Knowledge
Report → Pool
Report → Gap

Priority → Knowledge
Priority → Claim

Pool → Claim
Pool → Knowledge（Pool 不是 Knowledge 的 SoT）

Target → Knowledge
Target → Claim
Chain/Position → Knowledge
Knowledge → Claim（Knowledge 永不修改原始事实）

State → Pool（既有 I4）
Methodology → Knowledge（方法论只提供研究框架与 policy，不写认知）
```

允许的主要方向：

```text
Claim
  ↓
Knowledge Projection
  ↓
Pool
  ↓
Gap
  ↓
Priority / NextAction
  ↓
Report
```

> 唯一例外（Human Gate，§7）：`candidate → confirmed` 是**人工确认**驱动的状态迁移，它仍然只发生在 Knowledge 内部，**不构成对上述方向的破坏**。

---

## 18. C1 最小实现边界

### Domain（**以既有实际模型为准，C1 是修改而非新建**）

下列对象**已经存在**：

```text
IndustryKnowledge          （header；注意：不是 Knowledge）
KnowledgeBelief            （含 state / historicalRelations）
KnowledgeConflict
ProjectionOutcome          （当前代码类型名为 KnowledgeEvolution，含 NEW / SKIPPED）
KnowledgeProjectionService （projectFromClaim / reconcilePool / refreshGaps /
                             refreshNextActions / refreshState / refreshSubject）
```

C1 对它们做的是：

1. **`current` 判据唯一化**（§3.3 / §8 / §14）：`listCurrentBeliefs` 只返回 `confirmed`，并同步 Report 的"当前认知"读取；
2. **`beliefId` / `conflictId` 确定性 + 重复投影 no-op**（§16）；
3. **`candidate` 状态与确认路径**（§7）；
4. **`ProjectionOutcome` 的显式分层与 `reason`**（§4 / §20）；
5. **CONFLICT 语义固定为"该维度全部 current 认知都 `conflicting`、不选 current"**（**维度级**，§6 / §8 Rule D，与既有实现一致，写进契约并加测试守护）。

**不得**重复建立已经存在的对象，**不得**改名重造。

### Persistence

> **原则：C1 不新增表。**

* `candidate` 是**领域枚举扩展**：现状 `knowledge_belief.state` 为 `TEXT NOT NULL`、**无 CHECK 约束** ⇒ **无需 DDL 变更**即可表达 `candidate`。
* 知识候选的"确认"状态**只用 `state` 表达**，不新增 `knowledge_candidate` 表、不复用 `methodology_candidate` / `human_gate`。
* 幂等所需的 `UNIQUE` 索引是**可选**的，且必须满足 §16.5 的 5 条硬条件后**单独说明**。

不得顺带创建：

```text
Target / Chain / Outline / Experience / Evidence / Strategy / Report 新表
```

### 兼容性修改（属 C1，不算越界）

* `ReportService` 的"当前认知"必须与 §3.3 同判据（否则出现"repository 说不 current、Report 说 current"的自相矛盾）。
* 既有测试**只允许加严**，不允许放宽；语义变更必须伴随"证明新不变量"的断言。

---

## 19. C1 不负责

C1 **不负责**（按 CR-9 重述：不是"不触发"，而是"不实现 / 不重新定义"）：

* Gap 完整回写 —— **不负责重写** Gap lifecycle（该链已存在，属 C2 验证）；
* Priority 重新生成 —— **不负责**改 Priority 语义；
* NextAction 完整闭环 —— **不负责**改其规则；
* Report 更新 —— 只做"当前认知判据对齐"这一处兼容性修改（§14），**不负责**新增 Report 能力；
* LLM extraction；
* 外部数据；
* PDF / 音频解析；
* Agent 新写权限；
* Company Discovery。

> ★ 同时必须承认（CR-9）：**C1 的改动会即时影响 downstream**（因为链已接通）。这条不是"越界"，而是"影响面"：C1 必须**证明** downstream 在新语义下仍正确（见 §25 的验证清单）。

---

## 20. C1 输入输出契约

### 输入（**CR-12：逐 Claim，顺序由上层保证**）

```text
Claim（逐条投影）
+ dimension（必填，Claim 本身不带 dimension）
+ relationHint?（来自材料 [CLAIM] 块；缺失即触发 §5 的规则默认）
+ sourceRef? / confidence? / topic?
+ existing Knowledge state
+ existing Pool / Requirement context
```

* C1 **继续逐条投影**（`projectFromClaim` 语义），**不引入批量 API**；
* 批量场景（一份材料多个 `[CLAIM]` 块）由上层（material ingest / CLI）**按材料中的出现顺序**串行调用，保证**确定性顺序**；
* **不得**并发乱序投影同一 subject。

### 输出（`ProjectionResult`）

至少能够说明：

```text
claimRef
outcome          : NEW | SUPPORT | REVISE | CONFLICT | SUPERSEDE | SKIPPED
knowledgeId
newBeliefRef?    （SKIPPED 时为空）
affectedBeliefRefs[]  （被翻转状态的旧 belief，如 anchor）
conflictRef?     （CONFLICT 时）
requiresHumanGate : boolean
reason?          （封闭短语，便于审计与测试；不得是自由长文）
```

> 既有实现返回 `{ knowledgeId, evolution, beliefId }`；C1 需要**扩展**该结果对象（向后兼容地保留 `evolution` 字段或提供等价字段），并同步更新断言。

**与 Human Gate 的关系（C-FIX-3 / C-FIX-4）**：

* 投影产出 `candidate` 时：`requiresHumanGate = true`、`reason` 非空、`newBeliefRef` 指向那条 candidate belief；
* `candidate → confirmed` **不是投影**，而是 §7.3 的**独立人工确认动作**（且必须显式指定最终 relation，§7.4）；
* 因此 `ProjectionResult` **不包含**"确认"语义，也**不得**用它来表达确认。

ProjectionService：

> **不得直接负责 Priority / Report。**

---

## 21. C2 —— Gap Lifecycle（**重定义：验证 + 补齐，不是从零实现**）

C2 专门负责：

> **在 C1 新语义下，验证并（必要时）补齐 Knowledge Evolution → Pool / Requirement / Gap lifecycle。**

重点：

```text
unknown
partial
sufficient
conflict
reopened
resolved
```

但继续复用既有 Sufficiency Policy。

C2 **不重写 S4.5**；C2 的独立验收对象是"既有链在 C1 语义下的正确性"，不是"新写一条链"。

---

## 22. C3 —— Priority / NextAction（**重定义：验证**）

C3 专门负责：

> **验证 Knowledge 引起的 Gap 变化能正确驱动既有 persisted Priority / NextAction。**

必须继续遵守：

* Priority 是 persisted SoT；
* Report 不重新计算；
* Policy version 保留；
* Priority 解释可追溯；
* reopened Gap 能重新进入研究队列。

**不新增 Priority 规则、不改 Policy、不改 acquisitionValue 定义。**

---

## 23. C4 —— Report（**重定义：消费既有状态**）

C4 专门负责：

> **使 Report 正确消费 Knowledge Evolution + downstream persisted state。**

重点增加：

* cognition changes（含 `candidate` 待确认、`revised` 历史标注）；
* revised beliefs；
* conflicts；
* superseded history；
* reopened gaps；
* research progression。

继续遵守 S6-R1：

> Report 是读取 / 快照层，**不成为上游业务状态的计算器**；
> 并且 C4 之后，Report 的"当前认知"必须与 §3.3 的 `current` 判据**完全一致**（C1 已做基础对齐，C4 负责展示层完整化）。

---

## 24. Agent 权限（全阶段继承 Phase B Q1）

> **Agent 不获得 `project chain` / `record target` 的受控写权限。**

Knowledge 侧（**P3**）：

* Agent **可以**读取 Knowledge（含 `candidate` / `revised` / `superseded` 历史）；
* Agent **可以**解释 Conflict；
* Agent **可以**展示 Gap；
* Agent **可以**展示 Priority；
* Agent **可以**建议下一步；
* Agent **可以**要求用户确认；
* Agent **可以**展示"某条候选认知等待确认"及其来源。

但：

* **Agent 不得自动确认 `candidate`**；
* **Agent 不得因为一次自然语言对话就自行制造新的 ResearchTarget 或 Chain Projection**；
* **Agent 不得写入 Knowledge / Pool / Gap / Priority**。

任何未来 Agent 写权限：

> **必须单独授权 + 单独修改契约。**

---

## 25. 实现顺序（**CR-9 修正后的正确理解**）

```text
C Full Contract（本文，冻结）
      ↓
C1 Knowledge Evolution
      ↓
C1 独立验收
      ↓
C2 Gap Lifecycle（验证 + 补齐）
      ↓
C2 独立验收
      ↓
C3 Priority / NextAction（验证）
      ↓
C3 独立验收
      ↓
C4 Report（消费 + 展示完整化）
      ↓
真实调研场景验收
```

**不要把顺序理解成"C1 完全不影响后面"**：

```text
              ┌──────────────┐
Claim ───────→│ C1 Knowledge │
              └──────┬───────┘
                     │
                     ▼
              已存在的 Projection Chain
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
        Pool        Gap      NextAction
          │          │          │
          └──────────┼──────────┘
                     ▼
                  Report
```

* **C1**：修改 Knowledge Evolution 核心语义，**并验证现有 downstream projection 不被破坏**（不是"不碰 Gap"）。
* **C2**：**补齐 / 修正** C1 新语义下的 Gap lifecycle，并独立验收（不是从零实现 Gap）。
* **C3**：**验证** Knowledge-induced Gap changes 能正确驱动现有 Priority / NextAction persistence（不是从零实现 Priority）。
* **C4**：**使 Report 正确消费** Knowledge Evolution + downstream persisted state（不是从零实现 Report）。

每一步：

```text
实现
↓
diff 审查
↓
测试（证明真实不变量，而非"测试全绿"）
↓
tsc（两处）
↓
smoke
↓
真实 CLI 运行证据
↓
状态 fingerprint（SoT 前后不变 / 变化仅限允许范围）
↓
独立验收
```

---

## 26. Phase C 最终验收场景

必须最终能够跑通一个真实闭环：

```text
已有 Industry
      ↓
已有 Requirement / Gap
      ↓
已有 Research Target
      ↓
完成 Diligence
      ↓
加入真实 Material
      ↓
产生 Claims
      ↓
Knowledge Evolution
      ↓
至少出现一次：
    SUPPORT / REVISE / CONFLICT / SUPERSEDE
      ↓
Pool 更新
      ↓
Gap 状态变化
      ↓
Priority / NextAction 更新
      ↓
Report 更新
```

同时验证：

1. 旧 Claim 未被删除；
2. 旧 Knowledge 未被覆盖删除；
3. Conflict 可以并存（且**该维度全部 current 认知均退出 current**，只记录直接冲突对）；
4. Projection 幂等（同 claim 重复投影 ⇒ 领域状态完全一致）；
5. Gap 可以 reopened；
6. Priority 不被 Report 偷算；
7. Agent 写边界没有扩大；
8. 历史状态可追溯（§15 的跨库应用层链）；
9. 整条链不会产生重复实体（belief / conflict / gap / action 身份稳定）；
10. 重跑相同材料不会改变最终状态（material content-hash + projection 幂等）。
11. **`candidate` 不进入 current**：未确认的候选不影响 Pool `sufficient` / Gap 关闭；
12. **Report 不把 `revised` 当 current**：修正后的旧认知只出现在历史/修订节。
13. **维度级 CONFLICT 一致性（C-FIX-1）**：该维度存在多条 `confirmed` 时，一次 CONFLICT ⇒ 该维度**全部** current beliefs 退出 current，且**只**记录一对直接冲突（不虚构其他 conflict edge）。
14. **`SKIPPED` 与 `candidate` 不混用（C-FIX-2）**：无法构造候选 ⇒ `SKIPPED`；能构造候选但不能自动确认 ⇒ `candidate`；重复投影 candidate 仍 no-op，确认只走人工动作（C-FIX-3）。

---

## 27. C1 授权门槛

在以下条件全部满足之前：

> **不得开始 C1 编码。**

- [ ] 本 Contract（Final Lock Candidate）获得用户批准；
- [ ] Knowledge 是 Projection，而不是 Claim 替代品；
- [ ] 历史 Knowledge 永久保留（且不得为加约束而清洗）；
- [ ] Conflict 可以并存，且 **CONFLICT ⇒ 该维度全部 current confirmed 退出 current**、**只记录直接冲突对**（P2 + C-FIX-1）；
- [ ] 四种 Evolution relation 语义冻结，且 `ProjectionOutcome` 保留 `NEW` / `SKIPPED`（CR-11）；
- [ ] **`current` 唯一判据 = `state == "confirmed"`**（P5），`listCurrentBeliefs` 与 Report 同判据；
- [ ] **无 relation + 有 anchor ⇒ SUPPORT 为规则默认**（P1），不是"无法判断"；
- [ ] `beliefId` 确定性 + 重复投影 no-op（P6）；
- [ ] **`conflictId` 对 claim pair 无方向**（canonical pair，C-FIX-5）；
- [ ] **`SKIPPED` 与 `candidate` 二分冻结**（C-FIX-2）；
- [ ] `candidate` 状态、CLI 确认路径、**"确认是独立 Human Gate 迁移且必须显式指定最终 relation"** 冻结（P3 + C-FIX-3 / C-FIX-4），且 Agent 只读；
- [ ] **不增加 `CANDIDATE` historical relation**（C-FIX-6）；
- [ ] `industry.current_knowledge_id` 明确弃用（P4）；
- [ ] Gap reopened 规则冻结；
- [ ] Pool 不成为 Knowledge SoT；
- [ ] C1 不修改 Priority / Report 的业务语义（只做 §14 的判据对齐）；
- [ ] Phase B Q1 Human Gate 继续有效；
- [ ] C-MVP 不返工。

**只有用户明确授权 C1 后，coding agent 才可以进入 C1 implementation。**

---

## 28. 裁决与一致性修订记录（P1–P6 / CR-1–CR-12 → 落实点）

> 本节用于**逐条核对**：本版相对"用户提供的 v1 draft"改了什么、为什么改。
> 原始 draft 为对话粘贴稿（未入库），因此对照以"原文 → 本版"的形式给出。

### 28.1 P1–P6 裁决落实

| 裁决 | 内容 | 落实位置 | 原文 → 本版 |
|---|---|---|---|
| **P1** | 无 relation + 有同维度 anchor ⇒ **规则默认 SUPPORT**（不是"无法判断"，不进 Human Gate） | §5、§27 | 原文 §5 只写"无法可靠判断 ⇒ unresolved/requires review"；本版补**封闭枚举算法**（合法 relation / 无 relation 无 anchor⇒NEW / 无 relation 有 anchor⇒SUPPORT / 非法 relation⇒SKIPPED 且不投影），并把"无法判断"收窄为"既有规则确实无法确定"的情况 |
| **P2** | CONFLICT ⇒ **两侧都 `conflicting`，不选 current** | §4.3、§6.1、§8 Rule D、§12 情况 B | 原文 §8 Rule D 写"保留原 current，conflict = 新增"，§6.1 用"A = current candidate"暗示一方仍 current；本版统一改为"两侧均失去 confirmed/current，Pool=conflicting，Gap=conflict"，并写明理由（否则等于发现冲突后仍偷偷相信旧答案）。（**rev 2 再收紧为「维度级」**：见 §28.5 C-FIX-1） |
| **P3** | 引入 **`belief.state = candidate`** 最小方案；**不复用** methodology `human_gate`；**CLI** 确认入口；**Agent 只读** | §7（全部重写）、§8 Rule E、§18、§24、§27 | 原文 §7 只写"必须保留 Human Gate"，未定义候选落在哪；本版写定 state 枚举扩展、流转（candidate→confirmed / 拒绝不进入 current）、确认入口、Agent 边界、与 methodology gate 的独立关系 |
| **P4** | `industry.current_knowledge_id` **弃用**，C1 不读不写 | §2.4（新增）、§27 | 原文未提该列；本版新增"已裁决：弃用"小节，标记 DEPRECATED/UNUSED，以后单独 cleanup |
| **P5** | `current` 唯一判据 = **`state == "confirmed"`**（派生视图，非独立 state） | §3.3（新增）、§8、§14、§27 | 原文 §3.2 只有"Current/Historical/Conflicting"三分，未给判据；本版给出 state 表格 + 要求 `listCurrentBeliefs` 与 Report 同判据（并写明这是 C1 的兼容性修改） |
| **P6** | `beliefId = deterministic(knowledgeId, claimRef)`；重复投影 **no-op**；**不批量改写历史 ID** | §16（全部重写）、§18、§27 | 原文 §16 只写"必须幂等"；本版给出身份规则、no-op 的准确含义、与 REVISE/SUPERSEDE 的关系、历史 ID 不改写、UNIQUE 的 5 条前置硬条件（禁止为加约束清洗历史） |

### 28.2 CR-1–CR-12 一致性修订落实

| CR | 问题 | 落实位置 | 原文 → 本版 |
|---|---|---|---|
| **CR-1** | 契约 §5"无法判断⇒review"与实现"默认 SUPPORT"直接冲突 | §5、§11 推论、§27 | 见 P1 行 |
| **CR-2** | 契约 §8 Rule D"保留原 current"与实现"两侧 conflicting"冲突 | §4.3、§6、§8 | 见 P2 行 |
| **CR-3** | 契约 §7 知识候选/确认机制**完全不存在** | §7、§18 | 见 P3 行 |
| **CR-4** | `projectFromClaim` 不幂等（beliefId/conflictId 带时间戳、无 UNIQUE） | §16 | 见 P6 行；另在 §16.1 明确 conflictId 也要确定性 |
| **CR-5** | "current"存在三套口径（repository / Pool / Report） | §3.3、§9、§14 | 本版新增 §3.3 术语唯一判据，并在 §9/§14 复述"Pool 只看 confirmed""Report 必须同判据" |
| **CR-6** | REVISE 后旧 belief 仍在 current 视图 | §3.3、§4.2、§14 | 本版明确 `revised` **退出 current 视图**（保留历史），并要求同步 Report |
| **CR-7** | `industry.current_knowledge_id` 是遗留列 | §2.4 | 见 P4 行 |
| **CR-8** | 候选机制与"§18 最小表"承诺冲突 | §18 | 本版写定：**不新增表**；`candidate` 是领域枚举扩展（现状 `state` 为 `TEXT NOT NULL` 无 CHECK ⇒ 无需 DDL）；UNIQUE 为可选且附硬条件 |
| **CR-9** | C1 与 downstream **不可隔离**（链已接线） | §1 追加禁止、§19 重述、§21/§22/§23 重定义、§25 | 原文把 C2/C3/C4 写成"专门负责实现"；本版改为"**验证 + 补齐 / 消费**"，并写死红线："C1 可以触发既有链，但不能重新定义其业务规则" |
| **CR-10** | 追溯链**跨库**（Claim 在 `artifacts.sqlite`） | §15 | 原文只给逻辑链；本版写明跨库、应用层解析、不得为此加表加列、`artifact:claim/` 与裸 claimId 的不对称 |
| **CR-11** | `NEW` / `SKIPPED` 必须保留且分层 | §4（新增分层说明）、§20、§27 | 原文 §4 只列四种；本版新增 `ProjectionOutcome` 分层（NEW 是结构事件、SKIPPED 是未投影事件），并在 §27 加入门槛 |
| **CR-12** | 输入是逐条还是批量 | §20 | 原文 §20 写输入 `Claim[]`；本版写定"**逐条投影**，批量由上层保证确定性顺序，不得并发乱序" |

### 28.3 本版**未改动**的内容

以下原文内容原样保留（除上述点外）：

* §0 目标与闭环图；§1 禁止清单（仅追加 CR-9 的一条推论）；§2.1–§2.3；§3.1–§3.2；
* §4.1、§4.2、§4.4 的语义定义（SUPPORT 处补了"确实会新增一条 confirmed belief"的实现对齐说明）；
* §5 的"No LLM"原则；§6.2；§6.3；§9 主体；§10–§13 主体；§15–§17 主体；§19 主体；
* §26 验收场景的 10 条验证（本版**追加** 2 条：candidate 不进 current、Report 不把 revised 当 current；**rev 2 再追加第 13 / 14 条**：维度级 CONFLICT 一致性、`SKIPPED`/`candidate` 不混用）。

### 28.4 已知的、**留待 C1 实现时确认**的细节（不影响本次冻结）

1. CLI 确认命令的最终命名（`tiancha research knowledge ...`）；
2. `candidate` 的 `confidence` / `reason` 的**具体承载字段**（现有 `confidence` 列 + `topic` 可承载，C1 时确认）——
   ⚠ **注意**：字段可以留待 C1，**语义不留** —— 已在 §7.5 冻结（候选必须可展示来源与依据，且 `requiresHumanGate = true`）；
3. 是否真的需要 `UNIQUE(knowledge_id, claim_ref)`（先做 §16.5 的历史数据检查）；
4. ~~`historicalRelations` 是否需要新增 `CANDIDATE` 关系值~~ → **已裁决（C-FIX-6）：不增加**。
   `candidate` 是 **belief state**，不是 evolution relation；确认之后再按最终 relation（`NEW` / `SUPPORT` / `REVISE` / `SUPERSEDE`）建立关系边。

### 28.5 Final Lock Review 修订（**C-FIX-1 … C-FIX-6**，本版 = **rev 2**）

| # | 审查者指出的问题 | 落实位置 | 本版写定 |
|---|---|---|---|
| **C-FIX-1** | CONFLICT 与 SUPPORT 的"多条 current"矛盾（**BLOCKER-1**） | §4.3、§6.1、§8 Rule D、§26 #13、§27 | CONFLICT 是**维度级**：该维度**全部** current `confirmed` 退出为 `conflicting`；**只**记录**直接冲突对**的 `KnowledgeConflict`，不为其他 beliefs 虚构边（**状态传播 ≠ 关系图**） |
| **C-FIX-2** | `SKIPPED` 与 `candidate` 未闭环（**BLOCKER-2**） | §5（"无法判断"重定义）、§5.1（新增）、§7.2、§7.3、§26 #14、§27 | 二分硬规则：**无法形成可审查候选 ⇒ `SKIPPED`（绝不创建 candidate）**；**能形成候选但不允许自动成为 current ⇒ `candidate` + Human Gate**；两者不得互相转换 |
| **C-FIX-3** | candidate confirmation ≠ projection no-op | §7.3（新增）、§16.6（新增）、§20、§26 #14、§27 | `projectFromClaim()` 与 `confirmCandidate()` 是两个动作；重复投影 candidate 仍 **no-op**；`candidate → confirmed` **只能**由显式人工确认完成 |
| **C-FIX-4** | 确认时的最终 relation 未定义 | §7.4（新增）、§20、§27 | 确认必须**显式指定** `NEW` / `SUPPORT` / `REVISE` / `SUPERSEDE`（`CONFLICT` 不是可确认的终态），然后按该 relation 的既有规则落地 |
| **C-FIX-5** | conflict identity 的方向性风险 | §16.1、§27 | `canonicalClaimPair = sort([A, B])` ⇒ `conflictId` 基于规范化 pair；`(A,B)` 与 `(B,A)` 必须得到同一 id |
| **C-FIX-6** | §28.4 #4 不应继续开放 | §28.4 #4、§7 | **不增加 `CANDIDATE` historical relation**：candidate 是 state，不是 relation |
| （附带） | §28.4 #2 应冻结**语义** | §7.5（新增）、§28.4 #2 | 候选必须"可展示来源与依据 + `requiresHumanGate = true`"；**字段留 C1，语义不留** |

