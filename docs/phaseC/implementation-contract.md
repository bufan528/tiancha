# Tiancha Phase C — Implementation Contract

> **Phase C Full Contract v1 · Final Lock · rev 4**（已按 C-FIX-1…6、C-FIX-7…12 与 **C-FIX-13** 修订，见 §28.5 / §28.6 / §28.7）
>
> **状态：Final Lock Candidate —— 等待用户审批后冻结。`C1 未授权实现`。**
> 基线：**Phase B v1 FINAL PASS**（B5 代码 `6eb9ea2` / B5 文档 `8ec8f6f` / acceptance closure `27b9a37` / final cleanup `7faa8e5` = 当前 HEAD）。
> 本文是 Phase C 的**业务、领域与实现边界契约**；**在本文冻结之前，不允许进入 C1 编码**。
> **本版已同步 P1–P6 最终裁决与 CR-1–CR-12 一致性修订**：逐条落实对照见 **§28**。
> 上游：`06-business-intelligence-architecture-v3.1-final.md` · `07-domain-model-design.md` · `08-code-design.md` · `docs/phaseB/implementation-contract.md`（B1–B5 已实现）。

> ★★ **C1 边界声明（先读这一条）**
> **C1 不是重新实现 Phase 2C，也不是重构 Pool / Gap / Priority / State。**
> **C1 = 把已经存在的 `KnowledgeProjectionService` 从旧「2C v1」语义，对齐到本契约的 Phase C Final Lock 语义。**
> 除 Knowledge 相关代码 + 必要的 Repository 查询接口外，**不得重写既有业务链。**

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
| `rejected`    |            ❌ | 人工审查后**明确拒绝**的候选（既非 current，也非历史事实认知） |

因此（**对既有实现的兼容性修正，属 C1**）：

* `listCurrentBeliefs()` **必须只返回 `state == "confirmed"`**，而**不是**当前的 `state != "superseded"`；
* ★ **C-FIX-12**：`KnowledgeRepository.listCurrentBeliefs()` 是**全系统唯一的 current predicate 来源** —— `Report` / `Pool` / `CLI` / `Agent` **不得**各自再定义一遍 `current`；
* 任何"当前认知"视图（含 Report 的"当前认知"节）**必须**经该判据（或等价的 Repository / Domain API）获得；
* 历史与非 current 状态（`candidate` / `rejected` / `revised` / `superseded` / `conflicting`）仍然**全部保留**，只是**不再出现在 current 视图**里。

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

**判定算法（封闭枚举，唯一实现）** —— 顺序不可调换，**每一步失败都必须是零 mutation**：

```text
① 已投影检查（最先，C-FIX-11）
   (knowledgeId, claimRef) 已存在（无论 state 是 candidate / confirmed / rejected /
     revised / conflicting / superseded）
   → SKIPPED，reason = ALREADY_PROJECTED（exact no-op）

② 演化目标校验（仅 REVISE / SUPERSEDE，C-FIX-8 + C-FIX-13）
   targetClaimRef 必须：存在 / 同 knowledge / 同 dimension / state ∈ { confirmed, conflicting }
   不满足 → SKIPPED，reason = INVALID_EVOLUTION_TARGET（不得有任何 mutation）

③ Open Conflict 优先（维度级，C-FIX-7）
   该 dimension 存在 open KnowledgeConflict 时：
     无 relation（或显式 SUPPORT / NEW）
        → 【禁止自动 NEW / confirmed】
        → 能构造可审候选 ⇒ candidate + Human Gate（§7）
        → 否则          ⇒ SKIPPED，reason = OPEN_CONFLICT_REQUIRES_REVIEW
     显式 REVISE / SUPERSEDE（已通过 ②；target ∈ { confirmed, conflicting }）
        → 允许落地：只改变 target 与新 belief 的**认知关系**（§6.7）
        → **不自动关闭** conflict、**不替**其他 conflicting belief 选赢家
        → 只要该维度仍有 open conflict，Pool 仍为 conflicting（§9 / §10）

④ 常规判定
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

### 5.2 REVISE / SUPERSEDE 必须指定**合法的演化目标**（**C-FIX-8**）

`REVISE` / `SUPERSEDE` **不得**再依赖"同维度最新的那个 anchor"这种**隐式**目标；必须由输入**显式指定** `targetClaimRef`。

目标必须同时满足：

```text
1. 该 claimRef 在本 knowledge 中确实存在一条 belief
2. 属于同一个 knowledgeId（同 subject）
3. 属于同一个 dimension
4. 该 belief 的 state ∈ { "confirmed", "conflicting" }
   （C-FIX-13：只有【当前认知】或【未解决的冲突认知】才能被修正 / 被取代）
```

任一不满足（例如 target 为 `candidate` / `rejected` / `revised` / `superseded`，或不存在 / 跨 knowledge / 跨 dimension）：

```text
→ SKIPPED，reason = INVALID_EVOLUTION_TARGET
→ 不得对任何 belief / conflict 产生 mutation（校验先行，写操作在后）
```

> ★ **为什么 target 必须允许 `conflicting`（C-FIX-13）**：维度级 CONFLICT 会把该维度**全部** `confirmed` 变成 `conflicting`（§6.1）。
> 如果 target 只能是 `confirmed`，那么 §6.4 / Rule F 里"显式 `REVISE` / `SUPERSEDE` 是解决冲突的合法路径"这条规则**永远不可达**（算法上自我封闭）。
> **target 为 `conflicting` 时不是普通演化**：它只改变 target 与新 belief 的**认知生命周期关系**，**不**自动恢复其他 conflicting beliefs、**不**自动关闭 `KnowledgeConflict`、**不**选 winner —— 完整语义见 **§6.7**。

> **反例（必须失败）**：`market` 维度有 A / B / C 三条 confirmed，新 Claim D 声明 `SUPERSEDE A`。
> 正确结果：`A → superseded`、`D → confirmed`、**B / C 不受影响**。
> **绝不能**因为"最近的一条是 C"就把 C 置为 `superseded`（那等于擅自改写历史认知）。

### 5.3 已投影的 Claim 一律 **exact no-op**（**C-FIX-11**）

```text
若 (knowledgeId, claimRef) 已经存在
   （无论其 state 是 candidate / confirmed / rejected / revised / conflicting / superseded）
→ SKIPPED，reason = ALREADY_PROJECTED
→ exact no-op：不新增行、不翻转状态、不新增 conflict、不改变 current 视图
```

> * **不为 `ALREADY_PROJECTED` 新增 outcome 值**（`ProjectionOutcome` 保持 §4 的六个值）；
> * 特别地：已 `revised` / `conflicting` / `candidate` 的 Claim **再次投影不得"重新生成"一条 belief**。

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

### 6.4 Open Conflict **不得被普通 NEW / SUPPORT 绕过**（**C-FIX-7**）

```text
若 dimension 存在 open KnowledgeConflict：

无 relation（或显式 SUPPORT / NEW）
    → 【禁止】自动 NEW / confirmed
    → 能构造可审候选 ⇒ candidate + Human Gate
    → 否则          ⇒ SKIPPED，reason = OPEN_CONFLICT_REQUIRES_REVIEW

显式 REVISE / SUPERSEDE（目标合法：target ∈ { confirmed, conflicting }，§5.2）
    → 允许落地（这是"解决冲突"的正式路径）
    → 只改变 target 与该新 belief 的认知关系（§6.7）：**不自动关闭** conflict、**不选** winner
    → 但该维度只要仍有 open conflict，Pool 仍为 conflicting（§9 / §10）

显式 CONFLICT（**C-FIX-15**）
    → 【禁止】在已有 open conflict 时再执行一次冲突投影
    → SKIPPED，reason = OPEN_CONFLICT_REQUIRES_REVIEW（**零 mutation**）
```

> ★ **C-FIX-15（为什么连 `CONFLICT` 也要禁）**：契约没有定义"冲突之上的冲突"的生命周期。
> 若先执行 dimension-level conflict 投影（该维度全部 `confirmed` 退出 current + 新增冲突对），
> **再**把新 belief 降级为 candidate，就会在**任何人确认之前**改动该维度的冲突认知 —— 这与
> "candidate 还不是 current 认知"自相矛盾。因此 C1 **宁可 SKIPPED，也不自创生命周期**。

**为什么必须禁止**：否则会出现

```text
A conflicting
B conflicting（conflict 仍 open）

    ↓ 一条普通新 Claim C（无 relation）

C confirmed
    ↓
Pool sufficient
Gap resolved
```

即：**一个新 Claim 把尚未解决的冲突"悄悄绕过"，让该维度重新变成 current**。这与 §6.1 / §6.2 的"不选边"直接矛盾，因此**禁止**。

### 6.5 Conflict Resolution Semantics（**C-FIX-10**）

```text
resolveConflict()  只能：  open → resolved（或 accepted）
                   不得：  conflicting → confirmed
```

> * `resolveConflict()` 只是"**研究者已处理 / 关闭这个冲突事件**"，**不表示系统知道了哪一边是真的**；
> * 它**不修改任何 belief 的 state**；
> * **恢复 current cognition 只能通过新的、显式的 Evolution / Human Gate 路径完成**（§6.4 的 REVISE / SUPERSEDE，或候选确认 §7.4）。

因此"冲突解除"是**两件事的组合**，缺一不可：

```text
① conflict 记录被 resolved（研究者处理完毕）
② 该维度重新出现 confirmed 认知（只能经显式 Evolution / Human Gate）
```

只做 ① 不做 ② 时：该维度没有 confirmed ⇒ Pool 为 `unknown` / `partial`（不再 `conflicting`，也不存在 `sufficient`）。

> 说明：`KnowledgeConflictStatus` 现有枚举 `open | resolved | accepted` 中，`accepted` 属**遗留值**（既有实现从未写入）；第一版只使用 `open → resolved`，`accepted` 保留但**不产生**。
>
> ★ **`accepted` 的硬约束（C1）**：
> * **不得新增**任何产生 `accepted` 的路径；
> * **不得**把 `accepted` 当作 current 判据；
> * **不得**把 `accepted` 当作 `resolved` 的别名；
> * **不得**在 C1 里顺手清理该枚举（技术清理会无谓扩大 diff，留待将来单独的 cleanup）。
>
> **Evolution-based cognition resolution**（用新 Claim 显式演化来推进冲突维度的认知）见 **§6.7**；
> 它与 `resolveConflict()`（只关闭冲突**事件**）**不可互相替代**。

### 6.6 `Claim.temporalRelation` 与 `Belief.state` 是**两条轨**（不得机械映射）

| 概念 | 回答的问题 | 取值 |
|---|---|---|
| `Claim.temporalRelation` | 「这条**来源陈述**在时间上的关系」 | `current` / `old` / `superseded` |
| `Belief.state` | 「**Knowledge 对这个 claim 所代表的认知**的生命周期」 | `candidate` / `confirmed` / `rejected` / `revised` / `conflicting` / `superseded` |

> 两者**不能互相替代**，也**不得**做机械映射（例如"`Claim=old` ⇒ `Belief=superseded`"是**错的**）。
> `Claim A(temporalRelation=old)` 与 `Belief A(state=revised)` 可以同时合法存在。

### 6.7 target 为 `conflicting` 的演化：只改变认知关系（**C-FIX-13**）

> **闭合 C-FIX-7 × C-FIX-8 的生命周期矛盾**：维度级 CONFLICT 会把该维度**全部** `confirmed` 变成 `conflicting`（§6.1）；
> 如果 `REVISE` / `SUPERSEDE` 的 target 只能是 `confirmed`，那么"C-FIX-7 允许显式演化解决冲突"这条规则**算法上永远不可达**。
> 因此合法 target 扩为 `confirmed | conflicting`（§5.2），并把"target 为 `conflicting`"的后果钉死如下。

```text
A conflicting
B conflicting                （KnowledgeConflict(A,B) 仍 open）

C SUPERSEDE A
        ↓
A → superseded
C → confirmed
B → conflicting              （B 不受影响）
KnowledgeConflict(A,B) → 仍 open
Pool（该 dimension）   → 仍 conflicting
```

规则：

1. **只改变 target 与新 belief 的生命周期关系**：`SUPERSEDE` ⇒ `target → superseded`；`REVISE` ⇒ `target → revised`；新 belief ⇒ `confirmed`；
2. **不自动恢复 / 确认 / 解决**该维度中其他 `conflicting` beliefs；
3. **不自动关闭任何 `KnowledgeConflict`** —— 特别是 `A` 被 `C` supersede **不等于**系统证明 `B` 正确；
4. 因此**只要该维度仍有 open conflict，Pool 仍为 `conflicting`**（§9 ⑤），Gap 仍是 `conflict`；
5. 要继续推进，只能再来一次**显式**演化（例如 `D SUPERSEDE B`）或走 **Human Gate**（§7）；
6. **禁止**以"解决冲突"为名，在一次演化里同时处置多个 conflicting beliefs。

> 与 C-FIX-10 的分工：`resolveConflict()` 只关闭**事件**（§6.5）；§6.7 只推进**认知关系**。两者可以独立发生、也可以组合，但都不能替另一方完成工作。

---

## 7. Human Gate（**P3 裁决：最小方案**）

Phase C 必须保留 Human Gate。

> **P3 裁决**：引入"知识候选"，但采用**最小方案** —— `belief.state` 增加 **`candidate`**。
> **不复用** methodology 的 `human_gate`（两者语义必须独立）。

### 7.1 状态与流转

```text
candidate  ──（人确认：confirmCandidate + 显式 relation）──→  confirmed
candidate  ──（人拒绝：rejectCandidate）──→  rejected（不进入 current；也不进入历史事实认知）
```

`KnowledgeBeliefState` 最终为：

```text
candidate | confirmed | rejected | revised | superseded | conflicting
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
>
> ★ **C-FIX-14：确认同样受 §6.4 约束（人工路径不得绕过 open conflict）**
> * 该维度**仍有 open conflict** 时，`NEW` / `SUPPORT` **不得**把候选确认为 current（必须**明确拒绝**，并提示改用显式 `REVISE` / `SUPERSEDE`）；
> * 合法路径只有显式 `REVISE` / `SUPERSEDE`（§6.7），且**不得**自动关闭任何 `KnowledgeConflict`、**不得**选 winner；
> * **确认改变 current 认知 ⇒ 必须推进当前投影版本**（`version` / `updatedAt`）；
> * **拒绝（`rejected`）不改变 current 认知 ⇒ 不推进版本**。

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

**拒绝路径（C-FIX-9）**：

```text
candidate  ──（人拒绝：rejectCandidate）──→  rejected
```

* `rejected` **既不是 current，也不是历史事实认知**；它表示"**人工审查后明确拒绝的该候选认知**"；
* Report 可以把它单独呈现（`Rejected candidates`），**不与 `Historical beliefs` 混在一起**；
* **禁止**用 `superseded` 冒充"被拒绝" —— 一个从未成为 current 的候选没有资格叫 superseded；
* `rejected` 不参与 Pool 的支撑集合（与 `candidate` 同样"不是 current"）。

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

### Rule F：Open Conflict 优先（**C-FIX-7**）

> 只要该维度存在 **open `KnowledgeConflict`**，**任何"自动成为 `confirmed`"的路径都被禁止**（包括规则默认的 `SUPPORT` 与 `NEW`）。

```text
open conflict 存在
   ├── 无 relation / SUPPORT / NEW  → candidate（可构造候选时）或 SKIPPED（构造不出时）
   └── 显式 REVISE / SUPERSEDE      → 允许，target ∈ { confirmed, conflicting }（§5.2）
                                       target 为 conflicting 时只改变认知关系（§6.7）：
                                       **不自动关闭** conflict、**不选** winner
```

> 该维度**只要仍有 open conflict**，Pool slot 就保持 `conflicting`（即使同时存在 `confirmed` 认知）。

### Rule G：rejected（**C-FIX-9**）

`rejected` **不是 current，也不是历史事实认知**；它不影响 Pool 的支撑集合，也不参与任何 sufficiency 判定。
它只回答："这条候选认知被人工审查**明确拒绝**过。"

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
> ③ policy ref 缺失/未知 ⇒ **抛错**；④ 无 requirement 的 slot 永不到 `sufficient`；
> ⑤ 该维度存在 open conflict ⇒ slot = `conflicting`（**即使同时存在 `confirmed`**，C-FIX-7）—— 不能因为"又有本条 confirmed 了"就绕过未解决的冲突（包括经 §6.7 显式演化新产生的 `confirmed`）。

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
>
> **推论（C-FIX-7）**：因为只要仍有 open conflict 该 slot 就保持 `conflicting`（§9 ⑤），"未解决的冲突"会**持续**表现为一个 `gapType=conflict` 的 open gap —— 这正是它必须**留在研究队列**里的原因。

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
* Conflict（open / resolved）；
* 已 supersede 的历史认知；
* 候选认知（`candidate`，**标注为待确认**）；
* **被拒绝的候选（`rejected`，`Rejected candidates` 单独呈现，不与历史事实认知混同，C-FIX-9）**；
* reopened Gap；
* 新 Priority；
* 下一步研究动作。

但 Report 不得：

* 创建 Knowledge；
* 确认 candidate；
* 解决 Conflict；
* 修改 Gap；
* 重新计算 Priority。

> ★ **P5 / CR-6 / C-FIX-12 的兼容性要求**：Report 的"当前认知"**必须**与 §3.3 使用同一判据（`state == "confirmed"`），且**只能经 `KnowledgeRepository` 的 current predicate 获得**（不得在 Report 里再写一份过滤条件）。当前实现里 `ReportService` 的"当前认知"用的是"非 superseded"集合，会**把 `revised` / `conflicting` 的 belief 也算作当前认知** —— 这必须在 **C1** 内一并对齐（属 C1 的兼容性修改，不属于 C2）。

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

> 覆盖范围（**C-FIX-11**）：无论已存在的那条 belief 处于 `candidate` / `confirmed` / `rejected` / `revised` / `conflicting` / `superseded` 哪一种状态，重复投影都是 `SKIPPED` + `reason = ALREADY_PROJECTED`（exact no-op）。

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

## 18. C1 实现边界（Knowledge Projection **Semantic Alignment**）

> ★ **C1 的定义（不是"实现"，而是"对齐"）**：Phase 2C 已经实现了可运行的 Knowledge Projection
> （`projectFromClaim` + `refreshSubject` 已在 `ingestClaims` 路径上接线）。
> 因此 **C1 = 把现有实现从旧「2C v1」语义，校准到本契约的 Final Lock 语义**，
> **不是**重新实现 Phase 2C，**也不是**重构 Pool / Gap / Priority / State。

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

1. **`current` 判据唯一化**（§3.3 / §8 / §14 / **C-FIX-12**）：`listCurrentBeliefs` 只返回 `confirmed`，并同步 Report 的"当前认知"读取；
2. **`beliefId` / `conflictId` 确定性 + 重复投影 exact no-op**（§16 / **C-FIX-11**）；
3. **`candidate` / `rejected` 状态与确认 / 拒绝路径**（§7 / **C-FIX-9**）；
4. **`ProjectionOutcome` 的显式分层与 `reason`**（§4 / §20）；
5. **CONFLICT 语义固定为"该维度全部 current 认知都 `conflicting`、不选 current"**（**维度级**，§6 / §8 Rule D，与既有实现一致，写进契约并加测试守护）→ **升级为 C-FIX-1 的维度级传播**；
6. **`REVISE` / `SUPERSEDE` 的演化目标显式化与合法性校验**（§5.2 / **C-FIX-8**）—— 移除"取同维度最新 anchor"的隐式行为；
7. **Open Conflict 优先规则**（§5 算法 / §6.4 / §8 Rule F / **C-FIX-7**）—— 禁止普通 `NEW` / `SUPPORT` 绕过未解决冲突；
8. **`resolveConflict` 的语义边界**（§6.5 / **C-FIX-10**）—— 只关事件，不恢复认知。

**不得**重复建立已经存在的对象，**不得**改名重造。

### Persistence

> **原则：C1 不新增表。**

* `candidate` **与 `rejected`** 都是**领域枚举扩展**：现状 `knowledge_belief.state` 为 `TEXT NOT NULL`、**无 CHECK 约束** ⇒ **无需 DDL 变更**即可表达它们。
* ★ **C-FIX-12：`KnowledgeRepository` 属于 C1 允许修改的范围**（current predicate 是 persistence / query 边界问题）。至少需要：
  `listCurrentBeliefs()` 改为 `state == "confirmed"`，并补齐确定性查询接口，例如
  `findBeliefByKnowledgeAndClaim(knowledgeId, claimRef)` / `listBeliefsByDimension(...)` / `listConfirmedBeliefsByDimension(...)` / `listOpenConflictsByDimension(...)`。
  **理由**：否则 Service 或 Report 会各自手写过滤，重新长出第二套 `current` 语义。
* 知识候选的"确认 / 拒绝"状态**只用 `state` 表达**，不新增 `knowledge_candidate` 表、不复用 `methodology_candidate` / `human_gate`。
* 幂等所需的 `UNIQUE` 索引是**可选**的，且必须满足 §16.5 的 5 条硬条件后**单独说明**。

不得顺带创建：

```text
Target / Chain / Outline / Experience / Evidence / Strategy / Report 新表
```

### 兼容性修改（属 C1，不算越界）

* `ReportService` 的"当前认知"必须与 §3.3 同判据（否则出现"repository 说不 current、Report 说 current"的自相矛盾）。
* 既有测试**只允许加严**，不允许放宽；语义变更必须伴随"证明新不变量"的断言。

### 允许修改的文件范围（**白名单**）

```text
packages/research/src/domain/knowledge-belief.ts
packages/research/src/domain/knowledge-conflict.ts
packages/research/src/domain/industry-knowledge.ts
packages/research/src/application/knowledge-projection-service.ts
packages/research/src/storage/knowledge-repository.ts
+ 必要的 schema migration（仅当 §16.5 的 UNIQUE 条件全部满足时）
+ 相关测试文件（含新增测试）
```

### 禁止触碰（**黑名单**）

```text
packages/research/src/application/priority-service.ts
packages/research/src/application/evaluation-service.ts
packages/research/src/application/material-ingest-service.ts
packages/research/src/application/chain-projection-service.ts
packages/research/src/application/target-service.ts
packages/research/src/application/diligence-preparation-service.ts
```

> 除非是**极小的类型适配**，且必须在交付说明里**证明业务语义没有变化**。
> `reconcilePool` / `refreshGaps` / `refreshNextActions` / `refreshState` 的**业务规则**不得重写（CR-9 红线）：
> C1 只允许改动"**进入这条链的知识判定**"，并为其**补测试**。

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
* **State 重构** —— `refreshState()` 每次 version +1（即使 Pool 无变化）是**既有 Phase A/B 遗留**；**C1 不得顺手重构 State**。测试里必须把「projection 幂等（beliefs / conflicts / current 认知不变）」与「state version 递增」**分开断言**；
* **`priority-service.ts`** —— 不得修改（含"改成只按 confirmed 排序"这类想法）；Priority 的传播必须走既有 `refreshNextActions`；
* **Pool / Gap / Evaluation 的既有规则** —— 不得重新定义（S4.5 / S5 的成果必须保留，尤其 `Requirement.sufficiencyPolicyRef ⇒ PolicyRegistry` 的解析与"缺失即抛错"）。

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
reason?          （封闭短语；第一版取值集合 ——
                  ALREADY_PROJECTED / INVALID_EVOLUTION_TARGET /
                  OPEN_CONFLICT_REQUIRES_REVIEW / CANDIDATE_REQUIRES_CONFIRMATION /
                  PLACEHOLDER_DATA / INVALID_RELATION；
                  不得是自由长文）
```

> 既有实现返回 `{ knowledgeId, evolution, beliefId }`；C1 需要**扩展**该结果对象（向后兼容地保留 `evolution` 字段或提供等价字段），并同步更新断言。

**与 Human Gate 的关系（C-FIX-3 / C-FIX-4）**：

* 投影产出 `candidate` 时：`requiresHumanGate = true`、`reason` 非空、`newBeliefRef` 指向那条 candidate belief；
* `candidate → confirmed` **不是投影**，而是 §7.3 的**独立人工确认动作**（且必须显式指定最终 relation，§7.4）；
* 因此 `ProjectionResult` **不包含**"确认"语义，也**不得**用它来表达确认。

ProjectionService：

> **不得直接负责 Priority / Report。**

---

## 21. C2 —— Gap-driven Research Planning（**已改由专项契约定义**）

> **C2 = `ResearchGap → Requirement → Position → Target → Question → Preparation`**
> （把 C1 冻结的 Gap 语义**向下**驱动："研究什么 → 研究谁 → 问什么"）
>
> 详细实现契约见 **`docs/phaseC/c2-implementation-contract.md`**（语义链 / 字段 / identity / 不变量 I-C2-1…12 / 验收 T-C2-1…25）。
>
> **原 §21 的"C1 后 Pool → Gap 传播验证"已并入 C1 回归**（由 C1 的 E2E 与 29 条用例覆盖），不再单独占用一个阶段 —— 依据 Q1 裁决 A。
>
> 边界不变：C2 **只消费** C1 已冻结的 Knowledge / Gap 语义，**不得反向修改** Knowledge Projection（见该文 I-C2-1）。

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
15. **Open Conflict 不被绕过（C-FIX-7）**：该维度存在 open conflict 时，普通 `NEW` / `SUPPORT` **不得**把维度重新变成 current；
16. **演化目标合法（C-FIX-8）**：`REVISE` / `SUPERSEDE` 指向不存在的 / 跨维度的 / 非 `confirmed` 的目标必须 `SKIPPED`（`INVALID_EVOLUTION_TARGET`）且**零 mutation**。

### 26.1 必须具备的测试清单（C1，**≥ 20 条**）

现有 2C 的 8 条左右（NEW / placeholder→SKIPPED / SUPPORT / REVISE / CONFLICT / SUPERSEDE / cross-dimension / version）**不足以证明本契约**。C1 至少覆盖：

| 测试 | 状态 |
|---|---|
| first Claim → `NEW` | 既有（保留） |
| placeholder（echo）→ `SKIPPED`（Invariant 13） | 既有（保留） |
| SUPPORT → 多条 `confirmed` 并存 | 既有（加严） |
| REVISE → 旧 `revised` / 新 `confirmed` | 既有（加严） |
| SUPERSEDE → **精确 target**（非"最新 anchor"） | **新增** |
| invalid SUPERSEDE target（不存在 / 跨 knowledge / 跨 dimension / `candidate` / `rejected` / `revised` / `superseded`） | **新增** |
| invalid REVISE target（同上） | **新增** |
| **open conflict 下的显式演化（C-FIX-13）**：`A confirmed; B CONFLICT A; C SUPERSEDE A` ⇒ `A superseded` / `C confirmed` / `B conflicting`；`KnowledgeConflict(A,B)` **仍 open**；Pool **仍 `conflicting`** | **新增（关键）** |
| 维度级 CONFLICT（多条 confirmed 一起退场） | **新增** |
| conflict 只记录**直接冲突对**（不虚构 edge） | **新增** |
| `current == confirmed only`（Repository predicate） | **新增** |
| `revised` 不是 current | **新增** |
| `conflicting` 不是 current | **新增** |
| `candidate` 不是 current | **新增** |
| `rejected` 不是 current，也不是历史事实认知 | **新增** |
| `candidate` 重复投影 = exact no-op（`ALREADY_PROJECTED`） | **新增** |
| `confirmed` 重复投影 = exact no-op | **新增** |
| `conflicting` / `revised` / `superseded` 重复投影 = exact no-op | **新增** |
| deterministic `beliefId`（无时间戳 / 无随机 / 无序号） | **新增** |
| deterministic `conflictId`（`(A,B)` 与 `(B,A)` 同 id） | **新增** |
| open conflict 阻止普通 `NEW` / `SUPPORT` | **新增** |
| candidate 显式 confirm（含必须指定 relation） | **新增** |
| 重复 confirm 幂等 / 不可二次确认 | **新增** |
| `rejectCandidate` → `rejected`，且不影响 current / Pool | **新增** |
| `resolveConflict` 只改 conflict 状态、**不**恢复 current | **新增** |
| 旧 Claim 永不被删除（全链） | **新增** |
| Knowledge → Pool 传播 | **C1 集成** |
| Conflict → Gap（`gapType=conflict`） | **C1 集成** |

### 26.2 完整 E2E 场景（必须做，不能只调 service 单元）

```text
Material → Claim A → Knowledge A(confirmed) → Pool → Gap
        → Claim B(CONFLICT) → A/B 均 conflicting → Pool conflicting → Gap conflict → NextAction
        → Claim C(SUPERSEDE B) → B superseded / C confirmed / A 仍 conflicting
        → 观察 Pool / Gap / NextAction 按【既有规则】传播
```

### 26.3 "绝对不能通过"的反例（必须写成测试）

```text
A confirmed
B confirmed
      ↓ CONFLICT
A conflicting
B conflicting（conflict 仍 open）
      ↓ 普通 Claim C（无 relation）
【必须不能】出现：C confirmed / Pool sufficient / Gap resolved
```

> 这是当前设计**最容易漏掉**的逻辑漏洞；C1 必须用测试把它钉死。

### 26.4 "冲突解决路径必须真实可达"（**C-FIX-13 的回归护栏**）

必须有一条测试证明：**进入维度级 open conflict 之后，仍然存在一条可执行的演化路径** —— 否则 §6.4 / Rule F 里写的"允许"就是一句空头支票：

```text
A confirmed
B CONFLICT A            → A conflicting / B conflicting / conflict open / confirmed = 0
C REVISE A              → 必须【成功】（不是 INVALID_EVOLUTION_TARGET）
                        → A revised / C confirmed / B conflicting / conflict 仍 open
D SUPERSEDE B           → 必须【成功】
                        → B superseded / D confirmed / A revised（不变）
                        → 既有 conflict(A,B) 记录与状态【不被自动关闭】
```

> 这条测试同时防止**两个方向的回归**：① 契约再次退回"target 必须是 `confirmed`"（路径被堵死）；
> ② 实现把"显式演化"当成"顺手关闭冲突 / 替另一方选赢家"（越权）。

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
- [ ] **Open Conflict 不得被普通 `NEW` / `SUPPORT` 绕过**（C-FIX-7），且 `OPEN_CONFLICT_REQUIRES_REVIEW` 的判定条件冻结；
- [ ] **`REVISE` / `SUPERSEDE` 的演化目标校验冻结**（存在 / 同 knowledge / 同 dimension / `state ∈ { confirmed, conflicting }`；否则零 mutation）（C-FIX-8 + **C-FIX-13**）；
- [ ] **"target 为 `conflicting` 时只改变认知关系"冻结**（不自动关 conflict、不选 winner、Pool 仍 `conflicting`）（**C-FIX-13**），并有 §26.4 的"解决路径必须真实可达"回归测试；
- [ ] **`accepted` 约束冻结**（不新增产生路径 / 不当 current 判据 / 不当 `resolved` 别名 / 不顺手清理）；
- [ ] **`rejected` 状态与拒绝路径冻结**（C-FIX-9），且 `rejected ≠ current ≠ historical factual cognition`；
- [ ] **`resolveConflict` 语义边界冻结**（只 `open → resolved`，**不得**恢复 current）（C-FIX-10）；
- [ ] **已投影一律 `ALREADY_PROJECTED` exact no-op**（覆盖全部 state）（C-FIX-11）；
- [ ] **`KnowledgeRepository.listCurrentBeliefs()` 是唯一 current predicate**（C-FIX-12），且 C1 允许修改 `knowledge-repository.ts`；
- [ ] **C1 白名单 / 黑名单冻结**（§18）：不得重写 `reconcilePool` / `refreshGaps` / `refreshNextActions` / `refreshState` 的业务规则；
- [ ] **测试清单 ≥ 20 条 + E2E + 反例**（§26.1–§26.3）纳入 C1 交付；
- [ ] **人工确认路径同样受 open conflict 约束**（C-FIX-14）：仍有 open conflict ⇒ `NEW`/`SUPPORT` 拒绝确认；确认推进版本、`rejected` 不推进；
- [ ] **`open conflict + CONFLICT` ⇒ `SKIPPED`（零 mutation）**（C-FIX-15），不得先 mutation 再 candidate；
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

### 28.6 第二轮 Final Lock Review 修订（**C-FIX-7 … C-FIX-12**，本版 = **rev 3**）

> 这一轮的输入是"**契约 rev 2 × GitHub `main` 真实代码**"的逐条比对。

| # | 审查者指出的问题（结合真实代码） | 落实位置 | 本版写定 |
|---|---|---|---|
| **C-FIX-7** | **Open Conflict 可被普通 `NEW` 绕过**（必须冻结） | §5 算法 ③、**§6.4**（新增）、**§8 Rule F**（新增）、§9 ⑤、§10 推论、§26 #15 + §26.3 反例、§27 | 该维度存在 open conflict 时：无 relation / `SUPPORT` / `NEW` **禁止自动 confirmed**（可构造候选 ⇒ `candidate`；否则 `SKIPPED` + `OPEN_CONFLICT_REQUIRES_REVIEW`）；显式 `REVISE` / `SUPERSEDE` 允许；**只要仍有 open conflict，Pool 保持 `conflicting`** |
| **C-FIX-8** | **`SUPERSEDE` 的 target 实际未生效**（必须冻结） | §5 算法 ②、**§5.2**（新增）、§26 #16、§27 | 目标必须**显式**给出且满足"存在 / 同 knowledge / 同 dimension / `confirmed`"；否则 `SKIPPED` + `INVALID_EVOLUTION_TARGET` 且**零 mutation**；**禁止**再用"同维度最新 anchor" |
| **C-FIX-9** | **Candidate rejection 未定义**（必须冻结） | §3.3 表、§7.1、§7.4 拒绝路径、**§8 Rule G**（新增）、§14、§18、§26、§27 | 新增 state **`rejected`**；`rejected ≠ current ≠ 历史事实认知`；不得用 `superseded` 冒充拒绝；Report 单独呈现 `Rejected candidates` |
| **C-FIX-10** | Conflict resolve 只有 status，**没有 cognition lifecycle** | **§6.5**（新增）、§18 第 8 项、§26、§27 | `resolveConflict()` 只能 `open → resolved`；**不得** `conflicting → confirmed`；恢复 current 只能靠显式 Evolution / Human Gate（"关事件"与"恢复认知"是两件事） |
| **C-FIX-11** | 需要**全状态**的 exact no-op | §5 算法 ①、**§5.3**（新增）、§16.2、§20（reason）、§26、§27 | `(knowledgeId, claimRef)` 已存在 ⇒ **无论** `candidate`/`confirmed`/`rejected`/`revised`/`conflicting`/`superseded`，一律 `SKIPPED` + `ALREADY_PROJECTED`（exact no-op）；**不新增 outcome 值** |
| **C-FIX-12** | current predicate 必须**唯一**，且 `KnowledgeRepository` 应属 C1 范围 | §3.3、§14、§18 Persistence、§26、§27 | `KnowledgeRepository.listCurrentBeliefs()`（`state == confirmed`）是**唯一** current 判据；Report / Pool / CLI / Agent 不得自建；C1 允许修改 `knowledge-repository.ts` 并补齐确定性查询接口 |
| （附带） | **C1 的定义**必须写死 | 头部"边界声明"、§18 开头 + 白/黑名单 | **C1 = Knowledge Projection Semantic Alignment**（对齐，不是实现/重构）；白名单 5 文件 + migration/测试；黑名单 6 个 service |
| （附带） | `Claim.temporalRelation` 与 `Belief.state` 易被机械映射 | **§6.6**（新增） | 两条轨：来源层时间关系 vs 认知生命周期；不得互相替代 |
| （附带） | `refreshState()` 的 version churn | §19 | 属**既有遗留**，**C1 不得顺手重构 State**；测试需分开断言"projection 幂等"与"state version 递增" |
| （附带） | 测试不足以证明新契约 | **§26.1 / §26.2 / §26.3**（新增） | ≥ 20 条测试清单 + 完整 E2E + "绝对不能通过"的反例 |
| （附带） | Evidence 仍是 placeholder | §1 / §19（既有） | 保持"不引入 Evidence / Fragment 链"；C1 不得因看到 `evidenceRef?` 就自建 Evidence Domain |

### 28.7 第三轮 Final Lock Review 修订（**C-FIX-13**，本版 = **rev 4**）

> 输入是"**rev 3 × 真实代码**"的第三轮比对。本轮只修 **1 个 P0 语义矛盾**（外加 `accepted` 的一条硬约束），不扩 scope。

| # | 审查者指出的问题 | 落实位置 | 本版写定 |
|---|---|---|---|
| **C-FIX-13** | **C-FIX-7 × C-FIX-8 生命周期矛盾（P0）**：维度级 CONFLICT 会把该维度**全部** `confirmed` 变成 `conflicting`，而 C-FIX-8 又要求 `REVISE`/`SUPERSEDE` 的 target 必须 `confirmed` ⇒ "显式演化是解决冲突的合法路径"**算法上不可达** | §5 算法 ②③、**§5.2**、§6.4、**§6.7**（新增）、§8 Rule F、§9 ⑤、§26 测试清单 + **§26.4**（新增）、§27 | 合法 target 扩为 **`state ∈ { confirmed, conflicting }`**；**target 为 `conflicting` 时只改变 target 与新 belief 的认知关系**（`SUPERSEDE`⇒superseded、`REVISE`⇒revised、新 belief⇒confirmed），**不自动恢复其他 conflicting beliefs、不自动关闭 `KnowledgeConflict`、不选 winner**；只要仍有 open conflict，Pool 仍 `conflicting`。配 §26.4 的"解决路径必须真实可达"回归测试 |
| （附带） | `accepted` 死枚举的处理需要写死 | §6.5 | **不得**新增产生路径 / 不得当 current 判据 / 不得当 `resolved` 别名 / **不得**在 C1 顺手清理 |

### 28.8 C1 实施审计修订（**C-FIX-14 / C-FIX-15**，2026-09-25）

> 输入是"**C1 的实际产品代码 diff**"（`2b48ac6`）逐段审计的结果：静态边界、current 判据、确定性
> identity、exact no-op、显式 target、C-FIX-13、维度级冲突、直接冲突对、占位保护、历史保留全部 PASS；
> 但发现 **2 个 Human Gate / Conflict 交互缺口**（已在 `740d44d` 修复）。

| # | 审计发现 | 落实位置 | 写定 |
|---|---|---|---|
| **C-FIX-14** | `confirmCandidate()` 未检查 open conflict ⇒ **人工确认路径可绕过 C-FIX-7**（普通候选可直接被确认为 current，而冲突仍 open） | **§7.3** | 该维度仍有 open conflict 时，`NEW` / `SUPPORT` **拒绝确认**（明确报错并提示改用显式 `REVISE` / `SUPERSEDE`）；合法路径只有显式 `REVISE` / `SUPERSEDE`，且**不自动关闭** conflict、**不选** winner；**确认改变 current ⇒ 推进投影版本**，`rejected` 不推进 |
| **C-FIX-15** | `open conflict + CONFLICT` 会**先执行 dimension-level mutation、再把新 belief 降级为 candidate**（在任何人确认前改动冲突认知） | **§6.4** | 已有 open conflict 时**禁止**再次执行冲突投影 ⇒ `SKIPPED` + `OPEN_CONFLICT_REQUIRES_REVIEW`（**零 mutation**）；**不自创"冲突叠加"生命周期** |

### 28.9 C2 拆分（2026-09-25）

| 变更 | 内容 |
|---|---|
| §21 | 原「C2 = Gap Lifecycle（验证 + 补齐）」→ **索引**：`C2 = Gap-driven Research Planning`，实现契约移至 **`docs/phaseC/c2-implementation-contract.md`** |
| 依据 | **Q1 裁决 A**：C1 的 E2E（`C1-24`）已证明"Knowledge → Pool → Gap 在 C1 语义下正确"，该验证并入 C1 回归，不再单独占阶段 |
| 范围 | 本次改动**只动"分工与索引"**；C1 已冻结的 Knowledge 语义**一行未改** |

---

# §29 rev2 — C-MVP-R1 Implementation Contract（Material 导入可靠性：状态机 + 续跑）

> 状态：**rev2 — DESIGN ONLY（实现仍未授权）。** rev1 已发布（`b7233e6`）；rev2 = **验收者复核后的"恢复 / 迁移契约"补齐**（5 处，见 §29.0）—— 补的是**契约文本**，**不含任何实现代码**。
> 父基线：`aa4dc95` → `6a14942`（= `origin/main`；C5-D 已发布、基线已校准、root `tsc` 已归零）。
> 依据：用户 2026-09-26 裁决 —— **(a) 状态机 + 续跑** 为方案；**(c)「只有 `completed` 才算导入完成」并入查重规则**；
> (b)「先解析再保存」只作**前置校验优化**，**不单独解决完整性问题**（解析成功后 Claim 写入 / 跨库更新 / 知识投影仍可能失败）。
> 定位：本契约是 **C-MVP 的可靠性修订**，**不改动** C-MVP 已发布的规则解析语义（`[CLAIM]` 规则、无 LLM、不臆测）。

## §29.0 修订历史

| 版本 | 变更 |
|---|---|
| **rev1** | 首版：as-built 失败机制（逐行核对）+ 状态机 + 查重规则 + 返回语义 + 跨库恢复 + 幂等身份（含 **1 项待裁决**）+ OUT + 失败注入验收 T-R1-1…T-R1-9 |
| **rev2** | 验收者复核后的 5 处闭合（**不改 scope**）：① **§29.2 历史行迁移三分判定**（空引用旧行不再一律落 `received`，新增 `legacy_failed` + 迁移汇总）；② **§29.5a 并发所有权认领**（唯一索引 + 原子 `UPDATE` 租约；T-R1-10 用**两个独立进程**验收）；③ **§29.5b 逐块可恢复协议**（`claimId` 在 P1 预留并持久化；`ArtifactStore.put` 幂等复用；`ingestClaims` 向后兼容扩展）；④ **§29.6.1 未完成材料的可见性**（**D-R1-5 待裁决**）；⑤ **§29.8 T-R1-2 计数口径**（限定为**有效解析**的块；格式错误块只进 `parseErrors`）。新增 T-R1-10 / T-R1-11 / T-R1-12 |

## §29.1 现状（as-built 失败机制，逐行核对）

代码位置：`packages/research/src/application/material-ingest-service.ts`

```text
行 61      existing = repo.findMaterialByHash(subjectKind, subjectId, contentHash)   ← 查重门：只看"存在"
行 62-70   命中 ⇒ return { created: false, parsedClaims: existing.claimRefs.length, claimIds: [] }
行 86      repo.upsertMaterial(material)        ← Material 先落库（此时 claimRefs = []）
行 88      parseClaims(text)                    ← 规则解析（无 LLM）
行 94-101  discovery.ingestClaims({...})        ← 写 artifacts.sqlite(Claim) + 主库(Source/Document/Knowledge/Pool/Gap)
行 104-105 repo.upsertMaterial({ ...claimRefs: claimIds })
```

**缺陷（可复现推演）**：

| 中断点 | 后果 |
|---|---|
| `:86` 之后、`:105` 之前任意失败（含跨库写入失败） | Material 已存在且 `claimRefs = []` |
| 再次提交同一份材料 | `:61` 命中 ⇒ 返回 `created:false` / `parsedClaims:0` / `claimIds:[]` ⇒ **该材料永远无法补完**，调用方看到的是"重复资料"（**静默成功**） |
| `created:false` 的语义 | 同时表示「完全重复」与「上一次失败的残骸」—— **不可区分** |

**次生问题（同源；属 C-MVP 已发布范围，但本契约必须一并写清）**：

- `OpportunityDiscoveryService.ingestClaims()`（`:285`）与 `ingestMaterial()`（`:84` / `:92`）**每次调用**都新建 `src-${randomUUID()}` / `doc-${randomUUID()}`；
  Claim id 亦为 `claim-${randomUUID()}`（`:295`）。⇒ **重跑一次 = 多出一份 Source / Document / Claim**。
- 跨库：Claim 正文在 `artifacts.sqlite`，Source / Document / Material / Knowledge / Pool 在 `tiancha.sqlite`
  ⇒ **不存在能包住两者的普通事务**（§15 CR-10 已写定同一事实）。
- 行业骨架的幂等（`:120` `questionKey(subject, dimension)`）**不覆盖** Source / Document / Claim。

## §29.2 状态机（D-R1-1，**LOCKED**）

新增列（`material` 表；**加列必经 `PRAGMA table_info` 预检查**，与 DATA-R1 同一手法）：

| 列 | 类型 | 含义 |
|---|---|---|
| `ingest_status` | TEXT NOT NULL DEFAULT `'received'` | `received` / `parsed` / `projecting` / `completed` / `failed` / **`legacy_failed`**（rev2：**仅由迁移产生**，见下） |
| `ingest_stage` | TEXT NULL | `failed` 时记录失败阶段（取值同上，标明停在哪一步） |
| `ingest_error` | TEXT NULL | `failed` 时的错误摘要（message 截断；**不得**写入密钥/凭据） |
| `parser_version` | TEXT NOT NULL | 解析器版本（当前 `material-parser/v1`） |
| `model_version` | TEXT NULL | 模型版本；C-MVP-R1 **恒 `null`**（规则解析无模型）。字段为**未来"模型候选层"预留**，**不表示**已引入 LLM |
| `ingest_attempts` | INTEGER NOT NULL DEFAULT `0` | 续跑计数（审计用） |
| `ingest_owner` | TEXT NULL | **rev2**：当前持租约者的不透明标识（进程 / 会话 id；不写用户名等 PII） |
| `ingest_lease_until` | TEXT NULL | **rev2**：租约到期时间（ISO）；到期后可被其他进程原子认领（见 §29.5a） |

**rev2 唯一约束（并发的前提）**：`material` 上需要 `UNIQUE(subject_kind, subject_id, content_hash)`。
落地前**必须**先检查历史重复（沿用 §16.5 的硬条件精神）：**若发现重复，停止加约束**，改为在 C-MVP-R1 内单独提出"历史去重"请求；**绝不为加约束而静默清洗历史数据**。

**历史行回填（rev2 修订：三分判定，不得只凭 `claim_refs_json` 判断）**：

| 类别 | 判定条件（迁移时离线执行**纯函数** `parseClaims(rawText)`） | 回填结果 |
|---|---|---|
| (a) 已完成 | `claim_refs_json` **非空** | `completed` |
| (b) 已完成（无 Claim 产出） | `claim_refs_json` **为空** 且 `parseClaims(rawText).claims.length === 0` | `completed`（导入确实走完，只是材料里没有有效 `[CLAIM]` 块） |
| (c) **可能残骸** | `claim_refs_json` **为空** 且 `parseClaims(rawText).claims.length > 0` | **`legacy_failed`**（`ingest_stage = 'parsed'`，`ingest_error = 'LEGACY_PARTIAL_IMPORT'`） |

- (c) 之所以**不能**直接落 `received`：`received` 是"可被自动续跑"的状态，而这些行**可能**已在 `artifacts.sqlite` 留下部分 Claim（旧流程逐块 `put` + 投影，无状态记录）。因此 (c) **必须要求人工复核**后才能 `retry`。
- (c) 的 `retry` 前置：先跑**孤儿 Claim 检测**（§29.5b P2 的幂等路径；比对该材料的块 hash 与既有 artifact 内容），把已存在的 Claim **复用**而非重建。
- 迁移**只做判定与回填**，不删除、不修改 `materialId` / `claim_refs_json` / 行数；`parser_version` 一律回填 `'material-parser/v1'`，`model_version` 回填 `NULL`。
- 迁移必须输出**汇总报告**（`completed(a)=N · completed(b)=M · legacy_failed(c)=K`）并进入 CLI 输出；**不得**静默。
- 判定使用**当前**解析器版本 ⇒ 报告里必须写明"判定依据 `parser_version='material-parser/v1'`"；解析器升级后**不得**重跑该判定（历史行已有状态）。
- 回填是**一次性 + 幂等**（`PRAGMA` 预检查驱动），**不改身份、不新建行、不删历史**。

状态迁移（**唯一合法图**）：

```text
received ──parse 成功──► parsed ──开始写入──► projecting ──全部完成──► completed
    │                     │                     │
    └──────失败───────────┴─────────────────────┴──► failed（记录 ingest_stage + ingest_error）
failed ──显式续跑──► 回到失败阶段继续（幂等）
completed ──默认终态──► 仅 `--force`（人工显式）可重跑；见 §29.5
```

- 每个阶段的执行**幂等可重入**：重复执行同一阶段**不得**产生第二份记录。
- `received` 只表示"Material 行已持久化"，**不得**据此认为已导入。

## §29.3 查重规则（D-R1-1 + (c)，**LOCKED**）

> **命中条件**：同 `(subjectKind, subjectId, contentHash)` **且 `ingest_status = 'completed'`**。

| 命中情况 | 返回 |
|---|---|
| 同内容、`completed` | `duplicate`（完整重复，不重跑） |
| 同内容、`received` / `parsed` / `projecting` / `failed` | **不是重复** ⇒ 走续跑，或**明确报错**（见 §29.4） |
| 无同内容行 | 新建（`INSERT` 受 §29.2 唯一约束保护）→ 走状态机 |
| 同内容、`legacy_failed` | **不是重复** ⇒ 明确报错并要求人工复核（见 §29.2 (c)），**不允许**自动续跑 |

## §29.4 返回语义（D-R1-2，**LOCKED**）

`created: boolean` **对外废弃**（不再作为业务语义），改为枚举：

```text
type MaterialIngestOutcome =
  | { outcome: "created";     material; claimIds }   // 首次导入并走到 completed
  | { outcome: "duplicate";   material }             // 同内容且已 completed
  | { outcome: "resumed";     material; claimIds }   // 从 failed / 半成品续跑并完成
  | { outcome: "failed";      material; stage; error } // 仍未完成（不抛异常时的返回）
  | { outcome: "in_progress"; material }             // 已有一条同内容导入正在 projecting（并发保护）
```

- CLI **必须区分打印**这五种（**禁止**把 `resumed` 显示成 `duplicate`）。
- 只有 `created` / `resumed` 携带 `claimIds`。
- 未完成记录**必须**续跑或**明确报错**；**禁止**静默当作完整重复跳过。
- `legacy_failed`（迁移产生的残骸）**不得**自动续跑：返回 `failed`（`stage = 'migration'`、`error = 'LEGACY_PARTIAL_IMPORT'`），并要求人工执行 `retry`（须先经 §29.2 (c) 的孤儿 Claim 检测）。

## §29.5 跨库恢复（D-R1-4，**LOCKED**）

- **不使用**跨库事务（两库两连接，§15 CR-10）。恢复依靠 **状态标记 + 幂等重跑**。
- `completed` 是终态。人工显式 `--force` 重跑：记入 `ingest_attempts`，**保留**原 `claim_refs_json` 的审计轨迹（**不静默删除历史**）。
- 失败后保留的材料**允许且只允许**通过**显式人工动作**重新处理（CLI `retry` / `--force`）；系统**不得**自动重跑 `failed` 行。

### §29.5a 并发所有权认领（rev2 · D-R1-6，**LOCKED**）

**问题**：光有状态字段挡不住两个进程"同时查到没有记录 / 同时看到 `failed`，各自开始导入"。

**机制（唯一）**：**数据库唯一约束 + 原子状态认领（租约）**，不使用跨进程文件锁。
理由：SQLite 已经是唯一的共享状态；Windows 上的跨进程文件锁语义弱且难测；原子 `UPDATE` + `changes()` 已足够。

```text
① 新建路径：INSERT material(... ingest_status='received' ...)
             由 UNIQUE(subject_kind, subject_id, content_hash) 裁决
             冲突者 ⇒ 回读既有行，转 ②（不抛异常给用户）

② 认领路径（对 received / parsed / failed，或已过期的 projecting）：
   UPDATE material
      SET ingest_owner = :me,
          ingest_lease_until = :now_plus_lease,
          ingest_attempts = ingest_attempts + 1
    WHERE material_id = :id
      AND ( ingest_status IN ('received','parsed','failed')
            OR (ingest_status = 'projecting'
                AND (ingest_lease_until IS NULL OR ingest_lease_until < :now)) )
   检查 changes()：

   · changes() = 1  ⇒ 认领成功，进入 §29.5b 的逐块协议（该进程是唯一写入者）
   · changes() = 0  ⇒ 别人在跑 ⇒ 返回 outcome = "in_progress"（附对方 status / owner / lease_until，不等待、不自旋）
```

- **持租约者必须续租**：每完成一个块就刷新 `ingest_lease_until`（避免长材料把租约耗尽被别人抢走）。
- 租约时长是**契约参数**（默认值在实现时定稿，必须 ≥ 单块最坏处理时间的数倍）；**不得**用租约做"自动重跑"——它只用于**判定能否认领**。
- 崩溃后：租约到期 ⇒ 下一个 `retry` 可原子认领 ⇒ 按 §29.5b 从账本续做。
- **验收必须用两个独立进程**（T-R1-10），不是同一进程内的两次调用。

### §29.5b 逐块可恢复协议（rev2 · D-R1-4，**LOCKED**）

> 前提事实（已核对）：`ArtifactStore.put` 是 `INSERT OR REPLACE` 按 `artifactId` **幂等**；
> `ingestClaims()` 目前**逐块**执行 `put` + `projectFromClaim()`，且 `sourceId` / `runId` / `claimId` 均为 `randomUUID()`。

**协议（每一步都可重入；`claimId` 在 P1 就固定下来）**：

```text
P1 预留（主库，单事务）
   material.ingest_status = 'projecting'
   material.claim_blocks_json = [ { blockIndex, blockHash, claimId, state: 'reserved' }, ... ]
   ★ claimId 在此生成并持久化 —— 跨库恢复时才有稳定的锚点
   提交；之后任何崩溃都从账本恢复

P2 写 artifacts（逐块；对 state='reserved' 的块）
   artifactStore.put({ artifact: { artifactId: claimId, kind: 'claim', ... } })   ← 幂等复用
   material.claim_blocks_json[i].state = 'artifact_written'

P3 投影（逐块；对 state='artifact_written' 的块）
   knowledge.projectFromClaim({ claim, dimension, ... })      ← 用 P1 的 claimId，绝不新生成
   material.claim_blocks_json[i].state = 'projected'
   （state='projected' 的块在续跑时直接跳过 ⇒ 旧形 §16.1 的确定性 beliefId 保证 no-op）

P4 收口（全部块 state='projected'）
   material.claim_refs_json = [ ...按 blockIndex 的 claimId... ]
   material.ingest_status = 'completed'；清空 ingest_stage / ingest_error / 租约
```

崩溃点 → 恢复动作：

| 崩溃在 | 重跑时的行为 |
|---|---|
| P1 之后、P2 之前 | 按账本重跑 P2（全部 `reserved`）；`claimId` 已固定，不会产生第二份 Claim |
| P2 写 artifacts 中途 | `put` 幂等 ⇒ 重放该块无副作用；未写的块继续 |
| P2 完成、状态未回写 | 同上（重放 + 推进状态） |
| P3 投影中途 | 已 `projected` 的块跳过；其余继续（beliefId 确定性 ⇒ 重复投影为 no-op，§16.1） |
| P4 回写之前 | 全部块已 `projected` ⇒ 直接收口 |

**对既有代码的扩展要求（向后兼容，缺省行为不变）**：

| 组件 | 要求 |
|---|---|
| `OpportunityDiscoveryService.ingestClaims()` | 新增**可选**入参（如 `claimIds?: string[]` 或逐块回调），使调用方可**指定** `claimId`；**不传时行为与今天逐字节一致**（既有调用点必须原样通过回归） |
| `Source` / `Document` | 由 `ingestId`（= `mat-<sha256(subjectKind+subjectId+contentHash)>` 派生）而非 `randomUUID()` 生成，使续跑不新增 Source / Document。**该改动仅在 C-MVP-R1 路径生效**；`ingestMaterial()` / `ingestClaims()` 的既有调用点是否一并切换**属 D-R1-3 裁决范围** |
| `ArtifactStore.put` | 已有幂等语义（`INSERT OR REPLACE`）——**契约依赖它**，实现时**不得**改成追加式 |
| `material.claim_blocks_json` | 账本只能由**持租约者**写；块只能沿 `reserved → artifact_written → projected` **单向**推进，**禁止**回退 |

## §29.6 幂等身份（D-R1-3，**⚠️ 待裁决** —— 与 §29.6.1 的 D-R1-5 并列的两项待裁决之一）

现状矛盾：`claimId = claim-<uuid>`（`:295`）、`sourceId/documentId = src/doc-<uuid>`（`:84` / `:92` / `:285`）均为**随机身份**。
因此"续跑不重复"必须在下列两条路线中**选一条**：

| 路线 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A. 内容寻址身份** | `claimId = claim-<sha256(subjectKind\|subjectId\|dimension\|content)>`；`sourceId` / `documentId` 由 `ingestId = mat-<sha256(subjectKind+subjectId+contentHash)>` 派生 | 天然幂等；续跑即 no-op；belief 的 `claimRef` 稳定 | **改变 Claim 身份语义**：同内容来自**两个不同来源**的 Claim 会被合并 ⇒ 可能削弱 `sufficiency.independentSources` 口径（S4-FOLLOWUP 未修完） |
| **B. 块级进度账本**（★ 建议） | 保留随机 Claim id；`material` 增记录 `claim_blocks_json = [{blockIndex, blockHash, claimId}]`；续跑只处理**未记账**的块；`Source` / `Document` 由 `ingestId` 派生以避免重复 | **不动 Claim 身份 / 不动 sufficiency 口径**；与 C-MVP"复用既有 `ingestClaims`"一致 | 状态更多；整份材料完成前存在"部分可见"的 Claim |

**建议 B**。A 触及 `independentSources` 语义，属 S4.5 / S4-FOLLOWUP 领域，应另立裁决。
> 若选 A，须同时重新定义 `independentSources` 的口径（谁代表"独立来源"），并评估对既有 Evaluation 结果的影响。

### §29.6.1 未完成材料的可见性（rev2 · D-R1-5，**⚠️ 待裁决**）

**事实**：协议是**逐块投影**（P3），因此一份**未完成**的材料，其已 `projected` 的块**会立即影响** `Knowledge` / `PoolItem` / `Gap`（既有的 `ingestClaims()` 今天就是这个行为：`put` 后立刻 `projectFromClaim`）。这不是新增的语义，而是**现状的延续**。

| 路线 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **5a（★ 建议）接受部分可见 + 显式标注** | 保持逐块投影；但材料处于 `projecting` / `failed` / `legacy_failed` 时，**CLI 与 Agent 必须显式展示"材料未完成：已投影 K/N 块"**，且**禁止**把该材料的 Claim 计入"已确认材料证据"的任何汇总口径 | 贴合既有投影时序、改动小；续跑后自然收敛 | 未完成期间下游**已部分变化**；必须靠"显式标注"避免误读 |
| 5b 推迟投影（暂存 / 隔离） | P3 整段推迟到**所有块** `artifact_written` 之后才开始 | 未完成时下游**零变化**，窗口更小 | 需要把 `put` 与 `projectFromClaim` 彻底分离（改动更大）；**P3 中途失败仍会部分可见** —— 只能缩小窗口，**不能消除** |

- 两条路线都**不能**把"部分可见"降为零（投影是主库操作、逐块提交、跨库无事务）。
- **5a 是推荐值**；若选 **5b**，须同时写明"暂存层"的存放位置与失败展示口径，否则未完成材料会变成"看不见的 Claim"。
- **无论选哪条**，`research material list` 都必须暴露真实状态（`ingest_status` + 已投影块数 + `ingest_error`），**不得**把未完成材料显示为"已处理"。

## §29.7 OUT（明确禁止）

- ❌ 引入 LLM / 模型抽取（C-MVP 的"规则解析"语义不变；`model_version` 字段**不**代表已引入模型）
- ❌ 新增 `Fragment` / `Evidence`（属 Phase C 完整版，**另立契约**）
- ❌ 改 Priority / Evaluation / Knowledge 语义
- ❌ 为"可 join"而新增跨库表 / 列（§15 CR-10）
- ❌ 让 `material` 变成事实 SoT（`Claim` 仍是唯一 SoT）

## §29.8 失败注入验收（T-R1-*，每条须有"故意破坏 ⇒ 转红"证据）

| # | 场景（失败注入点） | 期望 |
|---|---|---|
| **T-R1-1** | `:86` 之后、解析之前抛错 | 材料行留存为 `failed/received`；**再次提交同内容 ⇒ `resumed` 并最终 `completed`**（不是 `duplicate`） |
| **T-R1-2** | Claim 写入 `artifacts.sqlite` 中途抛错 | `failed/projecting`；续跑后 **`state='projected'` 的块数 = `parseClaims(rawText).claims.length`**（**有效解析**的 `[CLAIM]` 块；格式错误块**不进入账本**，且必须原样出现在 `parseErrors` 里 —— 与"格式错误不臆测"一致；断言同时覆盖：`claim_blocks_json` 条数 = 有效块数，`parseErrors` 与首次解析一致） |
| **T-R1-3** | Knowledge 投影中途抛错 | 同上；续跑后 `belief` / PoolItem / Gap **不重复** |
| **T-R1-4** | 回写 `claim_refs_json` 之前抛错 | 续跑后 `material.claim_refs_json` 与 Claim 实际**一致**（双向引用完整） |
| **T-R1-5** | 同材料两次提交（同进程顺序） | 第二次得到 `duplicate`；零新行 |
| **T-R1-6** | `completed` 的同材料再次提交 | `duplicate`；**零**新行（整库内容指纹不变） |
| **T-R1-7** | 对外 API 不再有布尔 `created` | 编译期 + 行为各一条断言 |
| **T-R1-8** | 历史行（C-MVP 已导入）迁移 | 回填 `completed`；**不改** `materialId` / `claim_refs_json` / 行数 |
| **T-R1-9** | 解析器版本变更后重跑 | `parser_version` 变化被记录；`completed` 行**不**自动重跑 |
| **T-R1-10** | **两个独立进程**并发提交同一份材料（★ rev2 新增） | 恰好一个得到 `created` / `resumed`；另一个得到 `in_progress`（带对方 owner / lease）或 `duplicate`；最终 `Source` / `Document` / `Claim` **各只有一份**；断言方式是**行为**（进程退出码 + 两库行数），不是日志文案 |
| **T-R1-11** | 迁移三分判定（★ rev2 新增） | 构造 (a)(b)(c) 三类历史行 ⇒ 分别得到 `completed` / `completed` / **`legacy_failed`**；迁移汇总打印 `a/b/c` 三个数；`materialId` / `claim_refs_json` / 行数不变；**(c) 不被自动续跑** |
| **T-R1-12** | 跨库崩溃窗口（★ rev2 新增） | 在 P2 的 `put` 之后、状态回写之前打断 ⇒ 重跑**复用 P1 的 `claimId`**（`artifacts.sqlite` 里该 `claimId` 仍只有一行；不产生第二个 Claim），且账本不出现重复 `blockIndex` |

**mutation（必须能打红）**：

```text
· 查重门去掉 `ingest_status = 'completed'` 条件   ⇒ T-R1-1 必须转红
· 续跑时重建 Source / Document（随机 id）         ⇒ T-R1-2 必须转红
· 把 `resumed` 归并成 `duplicate`                 ⇒ T-R1-1 / T-R1-7 必须转红
· 迁移清空历史行或改 id                           ⇒ T-R1-8 必须转红
· 去掉 `changes() = 1` 的原子认领（改成"先查后写"）⇒ T-R1-10 必须转红
· P1 不持久化 `claimId`（改到 P2 才生成）          ⇒ T-R1-12 必须转红
· 迁移把 `claim_refs_json` 空的旧行一律置 `received` ⇒ T-R1-11 必须转红
· 把格式错误的 `[CLAIM]` 块也计入账本              ⇒ T-R1-2 必须转红
```

## §29.9 与已冻结面的冲突检查

| 冻结面 | 约束 | C-MVP-R1 影响 |
|---|---|---|
| C-MVP（规则解析） | 只有 `[CLAIM]` 产生 Claim；格式错误不臆测 | ✅ 不变 |
| I5（PoolItem 必须指向 Claim） | — | ✅ 不变 |
| I13（占位数据不进 Knowledge / Evaluation） | — | ✅ 不变 |
| §15 CR-10（跨库不 join） | 只允许应用层解析 | ✅ 遵守 |
| DATA-R1（加列 = PRAGMA 预检查 + 幂等回填） | — | ✅ 同一手法 |
| C5-D（Plan 只读） | — | ✅ 不涉及 |

## §29.10 预计文件清单（**待 Implementation Authorization 时确认**）

| 文件 | 性质 |
|---|---|
| `packages/research/src/domain/material.ts` | 生产（状态枚举 + 账本类型） |
| `packages/research/src/application/material-ingest-service.ts` | 生产（状态机 + 续跑 + 返回枚举） |
| `packages/research/src/storage/research-db.ts` | 生产（加列 + 历史回填，`PRAGMA` 预检查） |
| `packages/research/src/storage/research-repository.ts` | 生产（按状态查重 / 记进度 / **原子认领 `UPDATE` + `changes()`**） |
| `packages/research/src/storage/artifact-store.ts` | 生产（**不改**：其 `INSERT OR REPLACE` 幂等语义是本协议的前提，实现时不得改成追加式） |
| `packages/research/src/application/opportunity-discovery-service.ts` | 生产（**向后兼容扩展**：可选指定 `claimId` / `sourceId`；缺省路径行为不变 + 回归） |
| `packages/research/src/domain/material-parser.ts` | 生产（导出 `PARSER_VERSION`；**解析行为不变**） |
| `src/cli/research-commands.ts` · `src/cli/research-format.ts` | 生产（五种 outcome 的打印 + `retry` / `--force`） |
| `packages/research/src/c-mvp-r1.test.ts`（新） | 测试 T-R1-1 … T-R1-9 |
| `src/cli/c-mvp-r1-cli.test.ts`（新） | 测试 CLI 对五种 outcome 的区分 |

---

> **授权声明：§29 为 DESIGN ONLY。实现 / commit / push 均未授权。**
> **待裁决项（2 项）**：`D-R1-3`（幂等身份 A / B —— 建议 B）· `D-R1-5`（未完成材料可见性 5a / 5b —— 建议 5a）。
> **已随 rev2 锁定**：`D-R1-1`（状态机 + 查重）· `D-R1-2`（返回枚举）· `D-R1-4`（跨库恢复 + 逐块协议）· `D-R1-6`（并发认领）。
> 裁决后才进入 Implementation Authorization；届时先补"预计文件清单确认"与"失败场景可测性复核"。

**End of §29（rev2）.**

