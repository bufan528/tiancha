# Phase C6 · 资料闭环 Implementation Contract

> 状态：**rev2 — DESIGN ONLY。Implementation / Commit / Push 均未授权。**
> 父基线：`a237129`（= `origin/main`；C-MVP-R1 已发布，总契约 §29 rev16）。
> 依据：用户 2026-09-27 裁决 —— 单行业试点收口（§C6.1）+ 五项核心（D6-1…D6-5）+ **验收者契约审查的 5 处补清与三项裁定建议**（§C6.0 rev2、§C6.15）。
> 文件定位：**C6 专项契约**（同 `c2-*` / `c5-*`）；总契约 `implementation-contract.md` **§30 只做索引**。

---

## §C6.0 修订历史

| 版本 | 变更 |
|---|---|
| rev1 | 首版：试点依据 · 目标链路 · D6-1…D6-6 · I-C6-1…I-C6-7 · T-C6-1…T-C6-9 · OUT · 待裁决 D-C6-A/B/C |
| **rev2** | **验收者审查后的 5 处模型补清 + 3 项裁定**（**不改 scope**）：① 原文**保存位置与双 hash**（§C6.3）；② `evidence` 字段表 + `contentKind` **收窄为 `fact`/`judgment`** + **报告分类来源拆开**（§C6.4/§C6.5）；③ **确认/修订投影必须有显式 relation**，"仅编辑"不得投影（§C6.4）；④ **`extractionConfigKey` 纳入候选身份** + 三个对象的**确定性身份与失败重跑语义**（§C6.7）；⑤ **跨库写入顺序 + 崩溃窗口表 + 每个边界的故障注入**（§C6.7）。三项裁定见 **§C6.15** |

---

## §C6.1 定位与试点依据（**实测，非推测**）

C-MVP 已证明「明确写成 `[CLAIM]` 的内容」可驱动既有链路；C6 补它前面缺的那段：普通材料（报告 / 纪要 / 访谈稿）如何变成**可检查、可追溯**的认知。

**单行业试点（隔离库 `USERPROFILE` 重定向；真实材料 `samples/人形机器人行业研究报告.md`）**：

| 已跑通 | 证据 |
|---|---|
| 人工整理的真实 Claim 驱动全链 | 11 条 → `knowledge_belief` **11 全 confirmed** → Pool **9/12 sufficient** → Gap **12→3** → Priority（`key_validation` 81/100 居首，带因子与规则版本） |
| critical 门控挡住决策 | `evaluate` ⇒ **暂不判断（key_validation 证据不足）** ✓ |
| 重复导入幂等 | 第二次导入：`相同材料已完整入库`，缺口 3→3、优先级 3→3、**槽位变化（无）** |
| Echo 未污染 | beliefs 全为真实 Claim；`research_source` = 2（骨架 + 材料；幂等 `src-<ingestId>`） |

| 已确认的能力边界（**C6 的输入**） | 证据 |
|---|---|
| **普通文本不产生 Claim** | 报告整篇只作材料文本；1122 字符需**逐条人工定位来源句**才得到 11 条 Claim |
| **来源定位没有结构** | `source:` 是自由文本，**无法机器校验**"这条 Claim 出自原文哪一段" |
| **缺少语义分类** | 报告三区取自 current belief / confirmed belief / Pool item，**同为 11 条是自然结果**（11 条皆 confirmed 且全进 Pool）—— 需要的是**内容性质**分类，**不是**让区块数量不同 |
| **分值是证据充分度** | 9 个已评估维度**全 60**、`risk` = **100** ⇒ 机械映射，**绝不能当投资判断** |

---

## §C6.2 目标链路（本契约的唯一纵向切片）

```text
原始材料（不可变 + 版本 + 双 hash）
   → Fragment（结构化定位：char_range / paragraph）
   → Evidence（一个片段上的一个立场：supports / refutes / context）
   → Claim 候选（带 evidenceRefs + 提取配置版本，reviewStatus=draft）
   → 人工审核（confirm | revise | reject —— 均须显式 relation 才可投影）
   → 已确认 Claim（**走既有 `OpportunityDiscoveryService.ingestClaims()`**）
   → Knowledge / Pool / Gap / Priority / Evaluation / Report
```

> 只补**"原始材料 → 候选"**这一段；"已确认 Claim → Knowledge → …"**完全复用既有实现**，不重写、不复制写入逻辑。

---

## §C6.3 D6-1 结构化来源定位（**LOCKED**）

**原则**：材料保持原样；定位必须能被**机器复算**。`source:` 自由文本保留作**说明**，**不承担**定位职责。

### 原文的保存位置与双 hash（**rev2 补清**）

| 项 | 裁决 |
|---|---|
| **原文由谁持有** | **主库**（`tiancha.sqlite`）的 `material_version.raw_text` —— 与既有 `material.raw_text` **同库**，使"版本 + 片段"可在**单事务**内原子写入；**不**放 `ArtifactStore`（避免引入新的跨库面，见 §C6.7） |
| `rawTextRef` | **预留字段**：将来接入**大文件**（PDF / 音频二进制）时改为指向 `ArtifactStore` 的引用；**v1 恒为 `null`** |
| **`rawHash`** | sha256(**原始字节**，即文件原样）—— 用于判定"材料是否变过" |
| **`normalizedHash`** | sha256(**规范化文本**）—— 用于**片段定位校验** |
| **两 hash 不得混用** | 契约与实现中必须分别命名、分别校验；**禁止**用 `rawHash` 做片段校验，反之亦然 |

### 对象

| 对象 | 关键字段 |
|---|---|
| `material_version` | `materialVersionId`(确定性) · `materialId`（**关联既有 C-MVP 的 material**） · `raw_text` · `rawTextRef`(v1 null) · `rawHash` · `normalizedHash` · `normalizationVersion` · `byteLength` · `charLength`(UTF-16 code units) · `createdAt` |
| `fragment` | `fragmentId`(确定性) · `materialVersionId` · `locator` · `text` · `textHash` · `createdAt` |

* **版本与 `materialId` 的关系**：`material_version` 是某个 C-MVP `material` 的**版本流**；材料内容变化 ⇒ **新版本**（旧版本永不删）。**不改** C-MVP 的 `material` 五态语义；`material` 侧只记"当前版本引用"。
* **`locator`（判别联合，v1 只启用前两种 —— 见 §C6.15 D-C6-A）**：

```text
{ kind: "char_range", start: number, end: number }   // UTF-16 code unit
{ kind: "paragraph",   index: number }               // 0-based，按 \n\n 切分
{ kind: "page",        page: number, start?: number, end?: number }   // 定义保留，v1 未启用
{ kind: "timestamp",   startMs: number, endMs: number }              // 定义保留，v1 未启用
```

* **计量与规范化（必须写死）**：偏移以 **UTF-16 code unit** 计（与 JS `String#slice` 一致）；规范化版本 = **`nfkc-lf-v1`**（NFKC + 换行统一 `\n`）；**规范化后的文本**才用于定位与 `textHash`。
* **引用校验（验收必须真跑）**：`normalize(raw_text).slice(start,end) === fragment.text` **且** `sha256(fragment.text) === fragment.textHash`；故意改一个字符 ⇒ **必须转红**。
* Fragment **不得**跨材料、不得跨版本。

---

## §C6.4 D6-2 候选与认知状态分开（**LOCKED**）

**硬规则**：候选**永不**直接进入 `ingestClaims()`（该路径产生**已确认认知**）。

### `evidence`（**rev2 补字段**）

| 字段 | 说明 |
|---|---|
| `evidenceId` | **确定性**：`det(materialVersionId, fragmentId, stance, quoteHash)` |
| `materialVersionId` · `fragmentId` | **必须**指向一个真实 Fragment（同一版本内） |
| `stance` | `supports` / `refutes` / `context` |
| `quoteText` · `quoteHash` | 被引用的**原文片段文本**及其 hash（复用 §C6.3 的校验规则） |
| `note?` | 提取者说明（自由文本，**不承担**定位职责） |
| `createdAt` | — |

> 一条 Evidence = **一个片段**上的**一个立场**；需要多片段支持时用**多条** Evidence。Evidence **不得**跨材料、跨版本。

### `claim_candidate`（含 rev2 的 `contentKind`）

| 字段 | 说明 |
|---|---|
| `candidateId` | **确定性**：`det(materialVersionId, blockHash, dimension, extractionConfigKey)` ← rev2 |
| `subjectKind` · `subjectId` · `dimension` · `statement` | 同 C-MVP 的 Claim 语义 |
| `evidenceRefs[]` | **≥1**，指向 `evidence` |
| `confidence?` | 提取者给出的置信（**不替代**原文证据） |
| **`contentKind`** | **`fact` \| `judgment`**（**仅这两种** —— 见 §C6.5 与 §C6.15 D-C6-B） |
| `extractionRef` | 指向 `extraction_run` |
| `reviewStatus` | `draft` / `confirmed` / `revised` / `rejected` |
| `reviewedBy?` · `reviewedAt?` | — |
| **`decision.relation`** | `SUPPORT` / `REVISE` / `CONFLICT` / `SUPERSEDE` |
| `confirmedClaimRef?` | 投影成功后的真 Claim 引用（候选 ↔ Claim **双向可追**） |
| `supersedesCandidateRef?` | 新提取配置下产生的候选指向旧配置的对应候选（**lineage** ← rev2） |
| `createdAt` | — |

### 人工闸门（**rev2 收紧**）

* ★ **投影必须带显式 `decision.relation`**：`reviewStatus` 进入 `confirmed` / `revised` **且** `decision.relation` 已由人明确选择时，才可调用既有 `ingestClaims()`。
  —— 与总契约 **§7 Human Gate**（"确认时必须显式指定最终 Evolution relation"）一致，**杜绝** `CONFLICT`/`REVISE`/`SUPERSEDE` 因缺省而**走默认关系**。
* ★ **"修订" ≠ "确认"**：`revised` 若只是**编辑候选文字而未选 relation** ⇒ `reviewStatus` **保持 `draft`**，**不得**投影。
* `draft` 恒满足：**不得**提高 Pool 充分度、**不得**关闭 Gap、**不得**进入 Evaluation 输入（I-C6-4）。
* `candidate_review` 记录每次动作：`candidateId` · `action` · `operator` · `comment?` · `at` · `before`/`after`（人工改了什么）。
* 人工编写 `[CLAIM]` 的路径**语义不变**（C-MVP 不动），两条入口并存。

---

## §C6.5 D6-3 内容性质 vs 审核状态 vs **领域关系**（**rev2 拆开**）

rev1 把四种不同概念塞进一个枚举（`fact`/`judgment`/`candidate`/`conflict`/`open_question`），**这是错的**。rev2 拆为正交的三层：

```text
reviewStatus : draft | confirmed | revised | rejected        ← "人审过了吗"（候选自身状态）
contentKind  : fact | judgment                               ← "这句话是什么性质"（仅此两种）
domainRef    : Conflict（既有 knowledge_conflict） · Gap / Question  ← "关系/缺口"由领域对象承担
```

* ★ **`confirmed` 是审核状态，不代表"客观事实"**：一条**已确认的分析推断**，`contentKind` 仍是 `judgment`。
* ★ **报告分类来源拆开（唯一口径）**：

| 报告分区 | 来源（**不得**自行推导） |
|---|---|
| 已确认事实 | `reviewStatus ∈ {confirmed}` **且** `contentKind = fact` 的 Candidate / Claim |
| 分析判断 | `reviewStatus ∈ {confirmed}` **且** `contentKind = judgment` 的 Candidate / Claim |
| 待确认候选 | `reviewStatus = draft` 的 Candidate |
| 矛盾 | **既有 Conflict 关系**（`knowledge_conflict`） |
| 待核实 | **既有 Gap / Question** |

* **明确不要求**各区块数量互不相同（试点三区同为 11 条是**正确**的自然结果）。
* `contentKind` 的**判定方** = 模型**提议** + 人工确认，且**仅适用于 `fact` / `judgment`**（§C6.15 D-C6-B）。
* **快照兼容**：`report_snapshot.sections_json` **新增可选字段**承载新分区；**不迁移**老快照，老快照按原样可读（I14 不变）。

---

## §C6.6 D6-4 分值语义（**LOCKED**）

* 现有数值一律标注为 **「证据充分度 / 覆盖度」+ 规则版本**（`eval-v1` / `agg-v1` / `suf-v1` / `prio-v1`），在 **CLI / 报告 / Agent** 三处输出中**显式**标注；
* **禁止**以"评分 / 投资吸引力"口径呈现；`risk = 100` 的含义必须写明 = "**该维度的证据满足确认条件**"，**不是**"风险低"；
* **投资吸引力评分不在 C6**（需经审阅的方法论 + 对应数据 + 独立验收）；
* **critical 门控 = 回归条件**：不得改变"关键维度证据不足 ⇒ `暂不判断`"。

---

## §C6.7 D6-5 提取、身份与重跑审计（**rev2 补全**）

### 身份与幂等（唯一口径）

| 对象 | 确定性身份 | 失败/重跑语义 |
|---|---|---|
| `material_version` | `materialVersionId = det(materialId, rawHash, normalizationVersion)` | 同内容重复登记 ⇒ **复用**同一版本（不新增行） |
| `fragment` | `fragmentId = det(materialVersionId, locatorKey)` | 同定位 ⇒ **复用**（不新增） |
| `evidence` | `evidenceId = det(materialVersionId, fragmentId, stance, quoteHash)` | upsert，**按身份去重** |
| `claim_candidate` | `candidateId = det(materialVersionId, blockHash, dimension, extractionConfigKey)` | **同配置重试 ⇒ 复用身份**；**新配置 ⇒ 新候选** + `supersedesCandidateRef` 保留 lineage |

* ★ **`extractionConfigKey`**（rev2 引入）= `hash(modelVersion + promptVersion + parserVersion + schemaVersion)` —— **提取配置的稳定版本键**，**必须**纳入候选身份，否则"新版本产生新候选"会与幂等键**互相矛盾**（rev1 的缺陷）。
* ★ **人工改过的候选不可被重跑覆盖**（I-C6-5）：`reviewStatus ≠ draft` 的候选，重跑**只能新增**（新配置下的新候选），**不得**改写或删除既有行。

### `extraction_run`

`extractionId` · `materialVersionId` · `modelVersion` · `promptVersion` · `parserVersion` · **`extractionConfigKey`** · `startedAt` · `finishedAt` · `status`(`running`/`completed`/`failed`) · `candidateIds[]` · `error?`

### 写入顺序与崩溃窗口（**rev2 补全**）

```text
W1【主库·单事务】material_version（含 raw_text）+ 全部 fragment      ← 原子，崩溃则整体回滚
W2【主库】       evidence 逐条 upsert（按 evidenceId）
W3【主库】       extraction_run(running) → 候选逐条 upsert → extraction_run(completed)
W4【跨库】       人工 confirm(with relation) → 既有 ingestClaims()
                 ⇒ Claim 正文进 artifacts.sqlite，其余进主库
                 ⇒ **复用 C-MVP-R1 §29.5b 的 P1→P4 协议与 fencing**（不新造机制）
```

| 崩溃在 | 恢复 |
|---|---|
| W1 中途 | 事务回滚 ⇒ **无残骸**；重跑从头（身份不变 ⇒ 结果一致） |
| W2 中途 | 逐条 upsert 幂等 ⇒ 重跑补齐；**不重复** evidence |
| W3 中途 | 同配置重跑 ⇒ 候选按身份复用；`extraction_run` 另起一条（旧 run 标 `failed`） |
| W4 中途 | 按 §29.5b 恢复（P1 预留 → P2 幂等 put → P3 投影 → P4 收口） |

> ★ **故障注入必须覆盖 W1–W4 的每个边界**（T-C6-8）；"只有 `running`/`failed` 状态"不足以证明部分 Artifact 不会丢失或重复。
> ★ **C6 新增的跨库面只有 W4 一处**，且**完全复用**已发布的 C-MVP-R1 协议 —— 这是把原文与片段放在**主库**的直接收益。

---

## §C6.8 D6-6 冲突处理与验收口径（**LOCKED**）

* **冲突并列保留、不选边**（沿用 I3 与既有演化规则）；同一指标不同口径 / 时间 ⇒ 保留来源、并列差异；
* **冲突的软件验收不需要真实资料**：允许使用**明确标记为合成、且仅存在于测试隔离库**的两份矛盾 Claim（`synthetic: true`）；**真实库不得出现 synthetic 行**；
* **业务真实性验证**必须等**真实第二来源或访谈材料**，不在 C6 验收范围内。

---

## §C6.9 不变量（I-C6-1…I-C6-7）

| # | 不变量 |
|---|---|
| **I-C6-1** | 候选（`draft`）**永不**直接进入 Claim / Knowledge / Pool / Gap / Evaluation —— 必须经人工确认 |
| **I-C6-2** | 每个 Evidence 必须指向 **≥1 个 Fragment**；每个 Fragment 必须能被**机器复算**回到材料原文（同规范化版本 + 同 hash + 同偏移） |
| **I-C6-3** | `reviewStatus` / `contentKind` / 领域关系（Conflict·Gap·Question）**三层正交**；`confirmed` 不得被解释为"客观事实"；报告分区严格按 §C6.5 的来源表 |
| **I-C6-4** | 未确认候选**不得**提高 Pool 充分度、关闭 Gap 或影响 Evaluation |
| **I-C6-5** | 人工修改过的候选**不得**被后续重跑静默覆盖 |
| **I-C6-6** | 冲突双方并列保留，永不静默合并或选边 |
| **I-C6-7** | 分值只表示证据充分度 / 覆盖度且带规则版本；不得包装成投资吸引力评分 |
| **I-C6-8**（rev2） | **投影必须有显式 `decision.relation`**；"仅编辑未选 relation"不得投影 |

---

## §C6.10 与既有冻结面的关系

| 冻结面 | 约束 | C6 影响 |
|---|---|---|
| C-MVP（`[CLAIM]` 规则解析） | 只有 `[CLAIM]` 块产生 Claim；语义冻结 | ✅ **不变**（两条入口并存） |
| C-MVP-R1（§29） | 五态 / fencing / 账本 / 重叠检测 / 人工归属 | ✅ W4 **复用**其 P1→P4 协议；**不改**它 |
| C1（Knowledge 投影语义） | 演化四型 / current 判据 | ✅ 候选确认后**走同一路径** |
| 总契约 §7（Human Gate） | 确认时**必须显式指定** evolution relation | ✅ C6 闸门与之对齐（I-C6-8） |
| I1–I16 | 全部 | ✅ 遵守（I3 冲突 / I13 占位 / I14 报告是投影） |
| Phase B（chain / target / diligence） | 模板实例 / Human-confirmed subject | ✅ 不变；C6 只补"材料 → 候选" |
| Report = Projection | 不改 SoT；可重算 | ✅ 新分区字段**可选**，老快照可读 |

---

## §C6.11 OUT（明确不做）

* ❌ 改写 C-MVP 的 `[CLAIM]` 规则语义
* ❌ 让模型输出**直接**成为已确认 Claim / Knowledge / PoolItem（须人工闸门 + 显式 relation）
* ❌ 投资吸引力评分 / 分数校准
* ❌ PDF 解析 / 音频转写（v1 只保留 `page` / `timestamp` 定义）
* ❌ 把 `candidate` / `conflict` / `open_question` 塞进 `contentKind`（rev2 已拆出）
* ❌ Wind / 自动发现 / Phase D
* ❌ 删除或改写历史（一律 append / 版本化）

---

## §C6.12 验收矩阵（T-C6-1…T-C6-9）

| # | 场景 | 断言要点 |
|---|---|---|
| **T-C6-1** | Fragment 定位可回到原文 | 两类 v1 locator：`normalize(raw_text).slice(start,end) === fragment.text` 且 `sha256(text) === textHash`；**改一个字符 ⇒ 必须转红**；并断言 `rawHash ≠ normalizedHash` 的使用**不混用** |
| **T-C6-2** | 未确认候选不影响任何下游 | 造候选（`draft`）⇒ Pool / Gap / NextAction / Evaluation 输入的**全状态指纹前后一致** |
| **T-C6-3** | 确认后走**既有**路径 | `confirm + relation` ⇒ 调既有 `ingestClaims()` ⇒ belief 变化；`candidate.confirmedClaimRef` ↔ belief 的 `claimRef` **双向可追**；**无 relation ⇒ 拒绝投影**（I-C6-8） |
| **T-C6-4** | **混合状态**材料的语义分类 | 按 §C6.5 **来源表**逐区核对（事实/判断/候选/矛盾/待核实）；**不断言**区块数量互不相同 |
| **T-C6-5** | 合成冲突（隔离库，`synthetic: true`） | 来源并存、冲突可见、人工确认后按既有演化规则处理；**真实库不得出现 synthetic 行** |
| **T-C6-6** | 身份与重跑 | 同配置重跑 ⇒ 候选**不翻倍**（身份复用）；改 `extractionConfigKey` ⇒ **新候选** + `supersedesCandidateRef` 指向旧候选；已 `confirmed` 的候选**不被改写** |
| **T-C6-7** | 分值语义 + critical 门控回归 | 三处输出带"证据充分度 + 规则版本"；`risk=100` 解释文本存在；关键维度证据不足 ⇒ `暂不判断` |
| **T-C6-8** | 跨库部分失败与恢复 | **对 W1–W4 每个边界注入失败**：W1 回滚无残骸；W2/W3 重跑不重复；W4 按 §29.5b 恢复；断言"无一 Artifact 丢失或重复" |
| **T-C6-9** | 边界：候选不得绕过闸门 | 静态 + 行为各一条：不存在"候选 → `ingestClaims`"的直接路径；未确认候选不出现在任何投影视野 |

---

### §C6.12b 拆出 C6 的三项可用性小步（**不属本契约范围**）

| 小步 | 内容 | 归属 |
|---|---|---|
| **U-1** | `research chain` **保持人工触发**；**Plan 渲染**在"建议研究位置"为空时**提示**执行 `tiancha research chain <行业>` | CLI 展示层小步 |
| **U-2** | 新增只读 CLI：`research question list` / `research gap list` / `research next action list` | 只读 CLI 小步 |
| **U-3** | `research state show` 增加**本地 fail-fast 提示**；帮助信息明确正确命令是 `state show` | CLI 路由小步 |

> 三者**都不涉及** Evidence / 候选的数据模型 ⇒ **不与 C6 同阶段实现**，各自单独授权。

---

## §C6.13 待裁决

**本 rev 已无阻塞实现的待裁决项** —— D-C6-A / D-C6-B / D-C6-C 已按验收者建议在本 rev 落定，见 §C6.15 裁定记录。

---

## §C6.14 授权声明

> **本契约 rev2 为 DESIGN ONLY。实现 / commit / push 均未授权。**
> 进入实现前需：① 用户**确认 §C6.15 的三项裁定**（或提出修改）；② **实现前复核**（预计文件清单 + T-C6-1…T-C6-9 可测性 + 回归面）。
> 实现按片推进（**每片单独授权**）：**① 材料版本 + Fragment/Evidence（W1–W2）→ ② 候选生成与身份（W3）→ ③ 人工审阅入口（confirm/revise/reject + relation）→ ④ 确认后既有 Knowledge 投影（W4）→ ⑤ 报告引用与缺口回填**；每片用**本次试点的 11 条 Claim** 作真实基准，用**合成冲突**补边界。

---

## §C6.15 裁定记录（2026-09-27）

| # | 议题 | 结论（依验收者建议，待用户确认） |
|---|---|---|
| **D-C6-A** | v1 支持的 locator | **(a) 仅文本**：`char_range` + `paragraph`；PDF 页码 / 音频时间戳**保留定义、暂不启用**，等真实输入需求出现再扩展 |
| **D-C6-B** | `contentKind` 判定方与范围 | **(b) 模型提议 + 人工确认**，且**仅适用于 `fact` / `judgment`**；`candidate` / `conflict` / `open_question` **移出该枚举**，改由审核状态与领域对象（Conflict / Gap / Question）派生 |
| **D-C6-C** | 候选提取粒度 | **候选原子、证据定位到精确句段**：可按**段落分块**处理以控制输入规模，但**一条 Candidate = 一个可审核的判断**，并链接到支持它的**准确片段**；**禁止**把整段复合观点做成一条 Candidate |

> 附：U-1～U-3 拆为独立可用性工作、`research chain` 继续人工触发、合成冲突仅用于隔离测试库 —— 均确认。

**End of contract（rev2）.**
