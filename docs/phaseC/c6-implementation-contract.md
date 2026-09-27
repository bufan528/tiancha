# Phase C6 · 资料闭环 Implementation Contract

> 状态：**rev10 — 第 ①–⑤ 片全部已授权实现并交付（§C6.18–§C6.23）：C6 实现完成。** 未授权项：模型提取器 · U-1/U-2/U-3 · Wind · 自动发现 · Phase D。
> **C6 设计起始基线** `a237129`（C-MVP-R1 已发布，总契约 §29 rev16）。**这不是"当前远端 HEAD"** —— 契约随 `docs:` 同步推进，**当前 HEAD 一律以 `git log --oneline` 为准**（见总契约 §29.22 基线维护规则）。
> 依据：用户 2026-09-27 裁决 —— 单行业试点收口（§C6.1）+ 五项核心（D6-1…D6-5）+ **验收者契约审查的 5 处补清与三项裁定建议**（§C6.0 rev2、§C6.15）。
> 文件定位：**C6 专项契约**（同 `c2-*` / `c5-*`）；总契约 `implementation-contract.md` **§30 只做索引**。

---

## §C6.0 修订历史

| 版本 | 变更 |
|---|---|
| rev1 | 首版：试点依据 · 目标链路 · D6-1…D6-6 · I-C6-1…I-C6-7 · T-C6-1…T-C6-9 · OUT · 待裁决 D-C6-A/B/C |
| **rev10** | **第 ⑤ 片（报告接入）实现并交付 → C6 实现全部完成**（`0e5a92a`）：按 D-C6-D 用候选行**反查** `contentKind` 分流 `keyFacts`/`mainJudgments`（无候选的历史 `[CLAIM]` 保持原行为）· `pendingCandidates` 收**判别联合** （不新增 section key）· 渲染摘录标注 `nfkc-lf-v1` · 2 例验收 · 全量 **449/449** + smoke PASS。**仍留后续：原文切片（位置映射）未做**。详见 §C6.23 |
| **rev9** | **第 ④ 片（投影到既有认知路径）实现并交付**（`13db5d1`）：`CandidateProjectionService` **只调用** 既有 `ingestClaims()`（不改其语义）· confirm 记录即投影 + `candidate project` 幂等续跑 · `reservedClaimId` 在 P1 持久化 ⇒ 崩溃后**找回同一 Claim** · 重跑不产生第二个 Claim/belief · `confirmedClaimRef` 用统一 claimRef 形状 · 6 例验收 · 全量 **447/447** + smoke PASS。**片 ⑤ 未授权**。详见 §C6.22 |
| **rev8** | **第 ③ 片（人工审阅入口）实现并交付**（`57259e7`）：CLI `candidate list/show/confirm/revise/reject` · `--operator` 必填 · `confirm` 需 `--relation`（I-C6-8）· **`revise` 只编辑并保持 draft** · append-only 审计 · Agent 只读工具（20 → 21）· **确认≠投影**（实测下游全 0）· 8 例验收 · 全量 **441/441** + smoke PASS。**片 ④–⑤ 未授权**。详见 §C6.21 |
| **rev7** | **第 ② 片（候选生成与身份，W3）实现并交付**（`fb93e4c`）：新增 `claim_candidate` / `candidate_review` / `extraction_run`（29 → **32**）· `extractionConfigKey` 纳入身份 · insert-only 保护人工编辑 · `isProjectable` 落实 I-C6-8 · **LLM-free 参考提取器 + 可注入接口**（模型提取器仍未授权）· 9 例验收 · 全量 **433/433** + smoke PASS。**片 ③–⑤ 未授权**。详见 §C6.20 |
| **rev6** | **第 ① 片修订（slice-1 review 闭环，§C6.19）**：W1 **真正原子**（单事务，嵌套安全）· 版本**必须属于既有 Material** 且 subject 从 Material 读取 · 版本**不可变**（insert-only，同 id 不同内容**报错**）· locator 合法性校验（整数/非空/范围内）· **完整性与定位检查分离**（`verifyVersionIntegrity` vs `verifyFragmentLocation`）· 分段规则与**引用口径**写入契约 · 表名同步为 `fragment_evidence`。测试 9 → **13** 例；全量 **424/424** |
| **rev5** | **第 ① 片（材料版本 + Fragment/Evidence，W1–W2）实现并交付**（`6407d49`）：新增 3 表（26 → 29）· 独立类型而非扩展既有类型 · 双 hash · v1 定位 · 确定性身份与幂等 · 9 例验收全绿 · 全量 420/420 + smoke PASS。**片 ②–⑤ 未授权**。详见 §C6.18 |
| **rev4** | **验收者第二轮契约审查后的 4 处校准确认**（**不改 scope**）：① **版本头/基线**修正（头部 rev2→rev4；起始基线不再写作"当前 HEAD"）；② **表数修正为 6 张**（`candidate_review` **独立成表**、append-only、与 `extraction_run` 生命周期不同）；③ **D-C6-D = 反查方案**（`confirmedClaimRef` 作分类关联；补数据流、落库、按 subject 查询与"历史 `[CLAIM]` 无 `contentKind`"的展示规则）；④ **D-C6-E = 联合类型**（保留 `KnowledgeLine` 的身份字段必填；新增 `ClaimCandidateLine`，`pendingCandidates` 收判别联合；并修正"零破坏"说法）；⑤ **D-C6-F 补审计参数**（`--operator` 必填、`--relation` 必填、`revise` 只记录修改并保持 draft）；⑥ **新增 §C6.17 候选级恢复协议**（W4 细化：预留/进度/并发/回填前崩溃）并据此改写 T-C6-8 |
| **rev3** | **用户确认三项裁定**（§C6.15）+ **实现前复核**（§C6.16：预计文件清单 / T-C6 可测性 / 回归面 / 分片）+ 复核新发现的 3 项待定小项（§C6.16.5 D-C6-D/E/F）。**不改 scope** |
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

### v1 分段与引用口径（第 ① 片落地补记）

* ★ **段落切分规则（写死）**：`paragraph` 按 **`\n{2,}`（一个或多个空行）** 切分，并**剥掉段落的尾随换行**（文档末尾的换行不是段落内容）。写库与 `resolveLocator` 使用**同一函数**，因此复算精确。
* ★ **引用口径（⑤ 片前必须定；v1 结论）**：`locator` 与 `fragment.text` 都在**规范化文本**上，所以
  * 报告 / 界面展示规范化摘录时**必须标注 `nfkc-lf-v1`**；
  * **若要原文字面引用**（PDF 页码、原文标点），**单有当前 locator 不足** ⇒ ⑤ 片必须引入 **"规范化位置 → 原文位置"映射**（或额外保存原文切片字段）—— **列为 ⑤ 片的前置条件**。

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
| **T-C6-8** | 跨库部分失败与恢复 | **对 W1–W4 每个边界注入失败**：W1 回滚无残骸；W2/W3 重跑不重复； **W4 必须覆盖 §C6.17 的 4 个候选级崩溃点**（P1 前 / P2 写后未回写 / P3 投影后未回写 / P4 回填前）⇒ 重跑按 `projectionStatus` 续做、`reservedClaimId` 不变、artifact 与 belief **均不重复**；断言"无一 Artifact 丢失或重复"。**仅说"复用 §29 注入点"不足以证明这条路径** |
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
> ① **已完成**：用户已确认 §C6.15 三项裁定；② **已完成**：实现前复核见 **§C6.16**（其中 §C6.16.5 提出 3 项实现前待定小项 D-C6-D/E/F）。
> **实现仍未被授权** —— 需用户单独授权（建议按片授权，见 §C6.16.4）。
> 实现按片推进（**每片单独授权**）：**① 材料版本 + Fragment/Evidence（W1–W2）→ ② 候选生成与身份（W3）→ ③ 人工审阅入口（confirm/revise/reject + relation）→ ④ 确认后既有 Knowledge 投影（W4）→ ⑤ 报告引用与缺口回填**；每片用**本次试点的 11 条 Claim** 作真实基准，用**合成冲突**补边界。

---

## §C6.15 裁定记录（2026-09-27，**用户已确认**）

| # | 议题 | 结论（**已确认**） |
|---|---|---|
| **D-C6-A** | v1 支持的 locator | **(a) 仅文本**：`char_range` + `paragraph`；PDF 页码 / 音频时间戳**保留定义、暂不启用**，等真实输入需求出现再扩展 |
| **D-C6-B** | `contentKind` 判定方与范围 | **(b) 模型提议 + 人工确认**，且**仅适用于 `fact` / `judgment`**；`candidate` / `conflict` / `open_question` **移出该枚举**，改由审核状态与领域对象（Conflict / Gap / Question）派生 |
| **D-C6-C** | 候选提取粒度 | **候选原子、证据定位到精确句段**：可按**段落分块**处理以控制输入规模，但**一条 Candidate = 一个可审核的判断**，并链接到支持它的**准确片段**；**禁止**把整段复合观点做成一条 Candidate |

> 附：U-1～U-3 拆为独立可用性工作、`research chain` 继续人工触发、合成冲突仅用于隔离测试库 —— 均确认。

**End of contract（rev2）.**


---

## §C6.16 实现前复核（2026-09-27）

> 目的：在**不写代码**的前提下，把"落点 / 可测性 / 回归面 / 分片"核实到"可安全实现"的程度。
> 结论摘要：**报告侧可不新增 section（不撞 C4-A 冻结断言）**；新增表需 PRAGMA 预检查；**3 项实现前小项**见 §C6.16.5。

### §C6.16.1 预计文件清单（按片）

| 片 | 生产文件 | 测试文件 |
|---|---|---|
| **① 材料版本 + Fragment/Evidence（W1–W2）** | `domain/source.ts`（扩展 `DocumentFragment` → 带 `locator`/`textHash`）· 新增 `domain/material-version.ts`（`MaterialVersion`）· 新增 `domain/evidence.ts` 扩展（`Evidence` + `stance`/`quoteHash`）· `storage/research-db.ts`（**新增 2–3 表** + PRAGMA 预检查）· `storage/research-repository.ts`（版本/片段/证据的确定性 identity + upsert）· 新增 `application/material-version-service.ts`（登记版本 + 切片段 + 规范化/双 hash） | 新增 `phase-c6-fragment.test.ts`（T-C6-1/T-C6-2 部分） |
| **② 候选生成与身份（W3）** | 新增 `domain/claim-candidate.ts`（含 `contentKind` / `reviewStatus` / `decision`）· 新增 `application/candidate-extraction-service.ts`（`extractionConfigKey` + 确定性 `candidateId`）· `storage/`：`claim_candidate` + `candidate_review` + `extraction_run` 表 | 新增 `phase-c6-candidate.test.ts`（T-C6-6） |
| **③ 人工审阅入口** | `src/cli/research-commands.ts`（`candidate list/show/confirm/revise/reject`）· `src/cli/research-format.ts` · `src/cli/tiancha.ts`（路由）· Agent：**只读** `research_candidate_list`（**不给写**） | 新增 `src/cli/phase-c6-cli.test.ts`（T-C6-3 的 CLI 面） |
| **④ 确认后既有投影（W4）** | `application/candidate-review-service.ts`：`confirm` ⇒ **调用既有 `OpportunityDiscoveryService.ingestClaims()`**（**复用 C-MVP-R1 的 P1→P4**）· `confirmedClaimRef` 回填 | `phase-c6-projection.test.ts`（T-C6-2/T-C6-3/T-C6-8） |
| **⑤ 报告引用与缺口回填** | `application/report-service.ts`（**按 `contentKind` 分流**既有分区 + 接入候选）· 可能 `domain/report.ts`（见 §C6.16.5 的 D-C6-E） | `phase-c6-report.test.ts`（T-C6-4/T-C6-7） |

**表数量（rev4 修正）**：当前 **26** 张 → 预计 **+6 张 = 32**：`material_version` · `fragment` · **`fragment_evidence`** · `claim_candidate` · **`candidate_review`** · `extraction_run`。

* ★ **`candidate_review` 独立成表、且必须独立**：**审阅历史与提取运行是两个不同的生命周期**（前者由人驱动、后者由提取驱动），不能互相承载；
* ★ **它必须 append-only**：每次审阅**只追加一行**（`candidateId` · `action` · `operator` · `comment?` · `at` · `before`/`after`），**永不 UPDATE / DELETE 既有行**（与 `report_snapshot` 同一纪律，I-C6-5 的落点）；
* **每张新表都要 PRAGMA 预检查惯例**（与既有迁移一致）。

### §C6.16.2 T-C6-1…T-C6-9 可测性

| # | 可测性 | 所需基建 |
|---|---|---|
| T-C6-1 | ✅ `:memory:` 库 + 纯函数 `normalize()` + `slice` 即可断言；"改一个字符 ⇒ 转红"是天然 mutation | 无新基建 |
| T-C6-2 | ✅ 复用试点用的**全状态指纹**（Pool/Gap/NextAction/Evaluation 输入） | 无 |
| T-C6-3 | ✅ `confirm + relation` 后断言 belief 变化 + `confirmedClaimRef` 双向可追；"无 relation ⇒ 拒绝"是纯行为测试 | 无 |
| T-C6-4 | ✅ **混合状态 fixture**（fact/judgment/candidate + 一条合成 conflict + 一个 open gap）⇒ 按 §C6.5 来源表核对 | 需 §C6.16.5 的 D-C6-E 定案 |
| T-C6-5 | ✅ 隔离库 + `synthetic: true`；"真实库不得出现 synthetic 行"可用**同一进程开两个库**断言 | 无 |
| T-C6-6 | ✅ 改 `extractionConfigKey` ⇒ 断言新候选 + `supersedesCandidateRef`；已 `confirmed` 不被改写 | 无 |
| T-C6-7 | ✅ 断言三处输出含"证据充分度 + 规则版本"；critical 门控回归用**既有** S4 断言 | 无 |
| T-C6-8 | ✅ **故障注入**：W1 用事务回滚；W2/W3 用 throwing store/repo 包装（**复用 C-MVP-R1 的 `FlakyArtifactStore` 手法**）；W4 直接复用 §29 的注入点 | 无（手法已有） |
| T-C6-9 | ✅ 静态 + 行为各一条 | 无 |

**结论**：9 条**全部可测**，且**不需要新测试基建** —— 试点与 C-MVP-R1 已经提供了全部手段（隔离库、全状态指纹、故障注入包装）。

### §C6.16.3 回归面（**关键发现**）

1. ★ **报告侧可不新增 section**：`ReportSections` **已含** C6 需要的全部落点 —— `keyFacts`（PoolItem）· `mainJudgments`（`state === "confirmed"` 的 belief）· **`pendingCandidates`（`state === "candidate"`）** · `conflicts`（open）· `gaps`（active）· `conflictHistory` / `revisedBeliefs` / `supersededBeliefs` / `rejectedBeliefs` / `conflictingBeliefs` / `state`。
   ⇒ 因此 **C6 不需要给 `ReportSections` 加字段**，**不触碰 C4-A 的"section 集合精确"断言**（`phase-c4-a.test.ts` T-C4-6）。
   ⇒ 需要改的只是**内容的分配规则**（按 `contentKind` 分流）+ 候选的接入（见 D-C6-E）。
2. **C-MVP / C-MVP-R1 零改动**：C6 只**调用** `ingestClaims()`（W4），不改其签名与语义；`[CLAIM]` 路径完全不动。
3. **I1–I16 无冲突**：新对象全部 append/版本化（I2）；候选不进 SoT（I1）；冲突并列（I3）；报告仍是投影（I14）；分值语义按 §C6.6 标注（不违反任何既有不变量）。
4. **既有测试的影响面（rev4 修正措辞）**：**section 集合不变**（不撞 T-C4-6）这个结论成立；但 ★ **不能说"零破坏"** —— 第 ⑤ 片会改变
   **`pendingCandidates` 的行类型（判别联合）**、**报告各分区的内容分配**、以及 **fact / judgment 的筛选规则**，
   因此 **C4-A / S6 相关回归测试需要适配**（属于"预期内的断言更新"，不是回归缺陷）。
   其余各片的既有影响面确实为零（新表 / 新 domain / 新 service / 新 CLI 子命令）。
5. **真实库**：C6 不迁移老数据（只新增表）；`material_version` 与既有 `material` 是**父子关系**，既有 `material` 行**不需要**版本行即可继续工作（版本按需创建）。

### §C6.16.4 分片与依赖（实现授权建议）

```text
① 材料版本 + Fragment/Evidence（W1–W2）   ← 无依赖，可先做
② 候选生成与身份（W3）                     ← 依赖 ①
③ 人工审阅入口（CLI/Agent 只读列表）        ← 依赖 ②
④ 确认后既有投影（W4）                     ← 依赖 ③；复用 C-MVP-R1 §29.5b
⑤ 报告引用与缺口回填                       ← 依赖 ④
```

* 每片**单独授权、单独收口**（`tsc` 两处 + 全量测试 + smoke）；
* 每片都用**本次试点的 11 条 Claim** 作真实基准（`samples/` 材料 + 人工整理版本）；
* **U-1/U-2/U-3** 三项可用性小步**独立于以上分片**，可随时插入。

### §C6.16.5 复核新发现的 3 项实现前小项（**需裁决，但不阻塞契约**）

| # | 议题 | 背景 | 候选方案 |
|---|---|---|---|
| **D-C6-D** | `contentKind` 如何**随确认传递到 Claim** | **已定：(b) 反查方案** —— 见 §C6.16.7 |
| **D-C6-E** | 报告"待确认候选"的**落点** | **已定：保留 `KnowledgeLine` 身份字段必填 + 新增 `ClaimCandidateLine` + `pendingCandidates` 收判别联合** —— 见 §C6.16.8 |
| **D-C6-F** | C6 的 **CLI 命令面** | **已定：`research candidate list/show/confirm/revise/reject` + `--operator` 必填 + `--relation` 必填 + `revise` 只记录修改** —— 见 §C6.16.9 |

> 三项都**只影响实现细节**，不影响 §C6.2 的链路与 I-C6-1…I-C6-8；建议在**授权第 ① 片之前**一并定案（其中 D-C6-D 影响 ⑤、D-C6-E 影响 ⑤、D-C6-F 影响 ③）。

### §C6.16.6 复核结论

* 契约 **rev4**（已校准 版本头 · 表数 · D-C6-D/E/F · **W4 候选级恢复协议 §C6.17**）**可安全进入分片实现**；
* **D-C6-D / D-C6-E / D-C6-F 已定**（§C6.16.7 – §C6.16.9）⇒ **第 ① 片（材料版本 + Fragment/Evidence）无剩余阻塞**；按片授权，从 ① 开始；
* 报告侧**不改 section 集合**这一点，使 C6 对已发布冻结面的影响降到最低。


---

## §C6.16.7 D-C6-D 落定：用 `confirmedClaimRef` **反查**做分类关联（**LOCKED**）

**为什么不是"给 Claim 加 `contentKind`"**：`ReportService` **只读主库**（Knowledge / Pool / Gap / `research_state` …），
**没有读 `artifacts.sqlite` 中 Claim blob 的接口**；而 `mainJudgments` 按 **belief 状态**取数、`keyFacts` 按 **PoolItem** 取数。
⇒ 只在 Claim JSON 上加字段，**报告侧依然拿不到它**。因此采用**反查**：

```text
claim_candidate.confirmedClaimRef ──(C6 分类关联)──► belief.claimRef / pool_item.claimRef
        │                                                      ▲
        └─ contentKind (fact | judgment)                        │
                  报告服务：按 subject 取出该 subject 的候选关联表，建立 claimRef → contentKind 映射
                            mainJudgments / keyFacts 据此分流
```

**契约要求（必须写清）**：

| 项 | 规则 |
|---|---|
| **关联如何落库** | 关联**存在候选行上**（`claim_candidate.confirmedClaimRef`），**不**改 `ingestClaims()` 签名、**不**改 Claim blob 结构 |
| **如何按 subject 查询** | 候选表有 `subjectKind` / `subjectId` ⇒ 报告服务按 subject 一次取出 `{confirmedClaimRef → contentKind}` 映射（**主库内查询，不跨库**） |
| **`contentKind` 缺失时** | ★ **历史 `[CLAIM]` 材料**（C-MVP 路径）**没有**候选行 ⇒ **没有 `contentKind`**。展示规则：**继续沿用既有语义**（出现在 `keyFacts` 与 `mainJudgments`，**不强行归类为 fact/judgment**）；报告需在**"数据来源"处**区分"经 C6 候选确认"与"人工 `[CLAIM]` 直入" |
| **不变的边界** | C-MVP / C-MVP-R1 **零改动**；`ingestClaims()` 只被**调用**，其签名与语义不变 |

---

## §C6.16.8 D-C6-E 落定：判别联合，而非把身份字段改成可选（**LOCKED**）

**不采纳"把 `KnowledgeLine.beliefId` / `claimRef` 改成可选"** —— 它们是**现有 Knowledge 行的必要身份字段**，改成可选会**削弱类型保证**。

**采纳**：保留现有类型不动，新增 C6 候选行，让 `pendingCandidates` 收**判别联合**：

```text
KnowledgeLine          // 既有：belief 候选（beliefId + claimRef 必填，不变）
ClaimCandidateLine     // 新增：C6 候选（candidateId + reviewStatus + contentKind + evidenceRefs + statement + sourceLocator）
pendingCandidates: Array<KnowledgeLine | ClaimCandidateLine>   // 判别字段：candidateId? / beliefId?
```

* **不新增 section key** ⇒ 不撞 C4-A 的 T-C4-6 字段集断言 ✓
* **不削弱既有行的类型保证** ✓
* ★ 但必须**同步适配回归测试**：老快照读取（老 `sections_json` 无新行类型 ⇒ 按原样可读）、C4-A / S6 的候选断言（见 §C6.16.3 第 4 点的措辞修正）

---

## §C6.16.9 D-C6-F 落定：CLI 命令面 + 审计参数（**LOCKED**）

```text
tiancha research candidate list   <行业> [--json]
tiancha research candidate show   <candidateId> [--json]
tiancha research candidate confirm <candidateId> --operator <名> --relation <SUPPORT|REVISE|CONFLICT|SUPERSEDE>
tiancha research candidate revise  <candidateId> --operator <名> [--statement …] [--content-kind …]
tiancha research candidate reject  <candidateId> --operator <名> [--comment …]
```

| 规则 | 内容 |
|---|---|
| **`--operator`** | 所有**写**操作（`confirm` / `revise` / `reject`）**必填且非空**（与 C5-B 的 `confirm/reject` 同一治理） |
| **`--relation`** | `confirm` **必填**（I-C6-8）；`CONFLICT` / `SUPERSEDE` 需带必要参数（对齐总契约 §7） |
| ★ **`revise` 的语义（唯一）** | **只记录修改并保持 `draft`** —— 审核动作 ≠ 投影动作。投影**只能**由 `confirm --relation …` 触发 |
| **Agent 权限** | 只给**只读** `research_candidate_list`（与 `research_material_list` 同一治理）；**不给**任何写工具 |

---

## §C6.17 候选级恢复协议（W4 细化，**LOCKED**）

> **为什么需要单独写**：§C6.7 说"W4 复用 C-MVP-R1 §29.5b 的 P1→P4"，但 R1 的**认领状态机、租约与进度账本由 `MaterialIngestService` 编排**；
> `OpportunityDiscoveryService.ingestClaims()` 本身**只**负责写 Claim 与投影，**不提供**候选级的认领/租约/恢复账本。
> ⇒ 候选确认**必须有自己的恢复语义**（本节）。

**承载表（唯一）**：**`claim_candidate` 自身字段**（候选是**单条**，不需要材料那样的"多块账本"表）：

| 字段 | 作用 |
|---|---|
| `projectionStatus` | `none` → `reserved` → `claim_written` → `projected` → `finalized`（**单向、永不回退**） |
| `reservedClaimId` | ★ **P1 就持久化**的稳定 Claim id —— 崩溃后据此**找回同一个 Claim**（回答"回填前崩溃怎么办"） |
| `confirmedClaimRef` | 投影成功后回填（**不**作为恢复锚点，恢复锚点是 `reservedClaimId` + `projectionStatus`） |
| `projectionError?` | `failed` 时的错误摘要（不含凭据） |

```text
P1 预留【主库·单事务】projectionStatus: none → reserved；reservedClaimId 生成并持久化
                       ↑ 同时写 reviewStatus=confirmed + decision.relation（一次原子状态转换）
P2 写 artifact【跨库】artifactStore.put({ artifactId: reservedClaimId, … })   ← 幂等（by artifactId）
                       → 回写 projectionStatus = claim_written
P3 投影【主库】knowledge.projectFromClaim({ claim, dimension, … })            ← 幂等（确定性 beliefId，§16.1）
                       → 回写 projectionStatus = projected
P4 回填【主库】confirmedClaimRef = reservedClaimId；projectionStatus = finalized
```

**崩溃恢复（必须逐点可测）**：

| 崩溃在 | 重跑行为 |
|---|---|
| P1 之前 | 无副作用；重新 `confirm` |
| P2 写 artifact 之后、回写之前 | 重跑 P2：`put` 幂等（同 `reservedClaimId`）⇒ **artifact 不重复** |
| P3 投影之后、回写之前 | 重跑 P3：`beliefId` 确定性 ⇒ **no-op**（§16.1） |
| P4 回填之前 | `reservedClaimId` 已持久化 ⇒ 重跑能找到**同一个** Claim ⇒ 直接回填 |

**并发确认（候选级 fencing）**：

* 用**一条原子 `UPDATE`** 完成"`none` → `reserved` + 写 relation"：`WHERE candidate_id = ? AND projection_status = 'none'`，校验 `changes() === 1`；
* 输家 ⇒ 返回"已被处理"（不等待、不自旋）；**候选是单条、单步很小**，因此 **v1 不引入租约/续租**
  （若将来做**批量确认**，再按 C-MVP-R1 §29.5a 的模式加租约 —— 此处明确**为什么现在不加**）。

**与 T-C6-8 的关系**：T-C6-8 必须**逐点覆盖 P1–P4 的 4 个崩溃点**，而不是笼统说"复用 §29 注入点"。

---

## §C6.18 第 ① 片实现记录（2026-09-27，**已授权并交付**）

| 项 | 内容 |
|---|---|
| Commit | **`6407d49`**（代码 + 测试；文档单独提交） |
| 范围 | **W1–W2**：`material_version`（版本 + 双 hash）· `fragment`（v1 定位）· `fragment_evidence`（一个片段一个立场） |
| 新表 | **3 张** ⇒ 代码 schema **26 → 29**；**加法迁移**，既有表零改动 |
| 类型落点 | ★ **未扩展** `DocumentFragment` / `Evidence`：它们的 `documentId` / `claimId` **必填**，与"绑 `materialVersionId`"和"evidence 指向片段而非 claim"冲突 ⇒ 新增独立类型 `MaterialVersion` / `MaterialFragment` / `FragmentEvidence`（`domain/material-source.ts`）。§C6.16.1 写的"扩展"据此修正为"新增独立类型" |
| 规范化 | **`nfkc-lf-v1`**：先换行统一（`\r\n?` → `\n`）再 **NFKC**；**只有规范化文本**用于定位与 `textHash` |
| 双 hash | `rawHash` = sha256(**原始字节**)；`normalizedHash` = sha256(**规范化文本**)。实测：CRLF 版与 LF 版 ⇒ **同 `normalizedHash`、不同 `rawHash`** ⇒ 判为**新版本**（正是 `rawHash` 的用途）；两者从不混用 |
| 定位 | v1 启用 `char_range`（**UTF-16 code unit**）+ `paragraph`（按 `\n{2,}` 切分、**剥掉尾随换行**）；`page` / `timestamp` **保留定义但显式抛错**（D-C6-A = (a)） |
| 身份 | `material_version` = `det(materialId, rawHash, normalizationVersion)` · `fragment` = `det(versionId, locatorKey)` · `fragment_evidence` = `det(versionId, fragmentId, stance, quoteHash)` ⇒ **所有写入幂等** |
| ★ 语义发现 | **NFKC 会把全角标点规范化为半角**（`：` → `:`）⇒ `fragment.text` 是**规范化文本**，不再是原文的字面。⇒ ⑤ 片做报告引用时，必须**标注规范化版本**或改用原文切片，否则"引用能回到原文"在标点上对不上 |
| 验收 | `phase-c6-fragment.test.ts`：T-C6-1（复算正确）· T-C6-1b（**改一字符 ⇒ 转红**＋双 hash 不混用）· T-C6-1c（规范化幂等）· T-C6-1d（v1 拒 `page`/`timestamp`）· §C6.7 身份与幂等（版本 / 片段 / 证据）· 表存在性 —— **9 例全绿** |
| 既有断言适配 | `phase-c3-b.test.ts` 的 `TABLES_24`（**精确集合**断言）追加 3 个表名；`c3-implementation-contract.md` §7.4 **追加注记**（原文一字未改） |
| 收口 | root `tsc` **0** · research typecheck **0** · **420 tests / 420 pass / 0 fail**（117 suites）· `research smoke` **PASS**（child-session=real） |
| 真实运行证据 | 隔离库 `D:\reasonix-data\tiancha-c6-slice1-*`：W1 `created=true` + 双 hash + 两个 locator **recompute=true**；W2 evidence 的 quote **取自片段**；**重跑 ⇒ `created=false` / versions=1 / fragments=2 / evidence=1**；`TABLES: 29` |
| 未做（按授权边界） | 候选 / 审阅 / 提取运行（片 ②）· AI 审阅入口（片 ③）· 投影（片 ④）· 报告接入（片 ⑤）· CLI / Agent 面 —— **全部未授权** |

---

## §C6.19 第 ① 片修订记录（2026-09-27，**slice-1 review 闭环**）

> 验收者对第 ① 片做静态复核，指出 3 处数据完整性问题 + 3 处校验缺口 + 2 处契约同步；**全部成立**，已修复并补验收。

### §C6.19.1 数据完整性（3 项）

| # | 缺陷 | 修复 |
|---|---|---|
| 1 | ★ **W1 并不原子**：`registerWithFragments()` 先单独写版本、再对片段批次开事务 ⇒ 两步之间崩溃会留下**没有片段的版本行** | `registerWithFragments()` 改为在 **`repo.transaction(...)` 内**执行"版本 + 初始片段"；共享的 `transaction()` helper 在**已在事务中时加入外层事务**（SQLite 不允许嵌套 BEGIN）⇒ **W1 真正原子** |
| 2 | ★ **版本没有验证它属于对应的 C-MVP Material**：subject / rawText 全由调用方传入，拼错 `materialId` 或配对不一致的 subject 都能登记 | `registerVersion({ materialId, rawText })` **必须**取出既有 Material（不存在则**报错**），并**从 Material 读取 subject**（调用方无法伪造）；测试先 `seedMaterial` 再登记 |
| 3 | ★ **版本宣称不可变，仓储却能覆盖**：`upsertMaterialVersion` 在主键冲突时更新 `raw_text` / hash / subject | 改为 **`insertMaterialVersion`（insert-only）**：同 id + 同内容 ⇒ **no-op**；同 id + 不同不可变字段 ⇒ **显式报错**（静默覆盖会让已定位的片段全部失效） |

* ★ **契约关系同步（诚实化）**：§C6.3 早先写"Material 侧记录当前版本引用"，但 `Material` 类型/表**没有** `currentVersionId`，第 ① 片也**不写** Material 侧 ⇒ 修订为：**"当前版本"由查询派生**（`listMaterialVersions` 取最新），**本片不做 Material 侧回写**；这会作为**未来集成项**（不写成"已实现"）。

### §C6.19.2 校验缺口（3 项）

| # | 缺口 | 修复 |
|---|---|---|
| 4 | `char_range` 直接交给 `slice()`：负数 / 越界 / `start === end` 会产出**看似合法、实为空**的片段，且**复算同样通过** | 新增 **`assertValidLocator`**：整数 + `0 <= start < end <= normalizedText.length`（`paragraph` 同样要求整数非负）；拒绝时**不写任何行** |
| 5 | `verifyVersionIntegrity` 缺失：只查规范化文本 hash + 切片 ⇒ **NFKC 可让原文的变化"隐身"**（全角/半角冒号互换后 rawHash 变了、定位检查仍绿） | **拆成两个检查**：`verifyVersionIntegrity`（`rawHash` + `normalizedHash` + 规范化版本）与 `verifyFragmentLocation`（定位 + `textHash`）；`MaterialVersionService.verifyVersion` 返回**两部分 + 合并 `ok`**。测试用"ASCII 冒号 ↔ 全角冒号"实证：定位检查仍绿，完整性检查**转红** |
| 6 | 精确引用的口径未定 | 见 §C6.3 新增的 **"v1 分段与引用口径"**：`paragraph` 按 `\n{2,}` 切分并剥尾随换行；**报告展示必须标注 `nfkc-lf-v1`**；若要**原文字面**，⑤ 片须引入"规范化位置 → 原文位置"映射（**⑤ 片前置条件**） |

### §C6.19.3 契约同步（2 项）

| # | 项 | 处置 |
|---|---|---|
| 7 | 分段规则：实现用 `\n{2,}`，契约早先写 `\n\n` | **统一写入契约**（§C6.3 补记）与测试（T-C6-1 断言 `paragraph` 文本 + 复算） |
| 8 | 分片清单仍称表为 `evidence` | 同步为实际表名 **`fragment_evidence`**（§C6.16.1 清单已更新） |

### §C6.19.4 修订后的验证（实测）

| 项 | 结果 |
|---|---|
| 测试 | `phase-c6-fragment.test.ts` **9 → 13 例**（新增 T-C6-1d 非法区间、T-C6-1e 完整性 vs 定位、T-C6-1f 原子性、T-C6-1g 归属、T-C6-1h 不可变） |
| 全量 | root `tsc` **0** · research typecheck **0** · **424 tests / 424 pass / 0 fail**（117 suites）· `research smoke` **PASS** |
| 真实证据（隔离库） | 缺 Material ⇒ **报错**；W1 `created=true` + `integrity` 三项全 true + 两个 locator `locationOk=true`；**坏 locator ⇒ 版本回滚**（versions 1 → 1）；**覆盖版本 ⇒ 报错**；W2 evidence quote 取自片段；`TABLES: 29` |

---

## §C6.20 第 ② 片实现记录（2026-09-27，**已授权并交付**）

| 项 | 内容 |
|---|---|
| Commit | **`fb93e4c`**（代码 + 测试；文档单独提交） |
| 范围 | **W3**：候选数据模型 + 确定性身份 + 提取运行生命周期 + **可注入的提取器接口** |
| 新表 | **3 张 ⇒ 代码 schema 29 → 32**：`claim_candidate` · `candidate_review`（**append-only**）· `extraction_run` |
| ★ LLM 边界 | 参考提取器 `ExplicitBlockExtractor` **确定性、无 LLM**（读显式 `[CANDIDATE]` 块）。**模型提取器仍未授权**（`HANDOFF` §10：模型起草候选须另立契约 + 单独授权）—— `CandidateExtractor` 接口**就是那个接口位**，填入模型实现即可，无需改本片其余部分 |
| 身份（§C6.7） | `extractionConfigKey = hash(modelVersion|promptVersion|parserVersion|schemaVersion)` **纳入** `candidateId` ⇒ **同配置重跑复用身份**（实测 `created=0 / reused=1 / sameIds=true`）；**新配置 ⇒ 新候选** + `supersedesCandidateRef` **lineage**（实测指向旧配置的同块同维候选） |
| I-C6-1 | 候选**只写自己的表**；本片**不存在**任何投影路径 ⇒ 实测 `knowledge_belief = 0` · `information_pool_item = 0` |
| I-C6-4 | 实测**下游指纹不变**（`industry_knowledge` / `knowledge_belief` / `knowledge_conflict` / pool slot+item / `research_gap` / `next_action` / `investment_evaluation` / `report_snapshot` 在候选生成前后**逐表行数一致**） |
| I-C6-5 | `insertClaimCandidate` = **insert-only**（`DO NOTHING`）⇒ 人工编辑 / 审阅过的候选**永不被重跑覆盖**（测试用"改写 + `revised` + relation"模拟人工动作后，行内容与 `reviewStatus` 均**未变**） |
| I-C6-8 | `isProjectable()` = **非 draft 且显式 relation**；实测 `confirmed` **无 relation** ⇒ `false` ✓（`rejected` + relation 亦为 `false`） |
| I-C6-3 | `contentKind` **仅 `fact` \| `judgment`**；与 `reviewStatus` / 领域关系（Conflict · Gap）**正交** |
| §C6.17 预留 | `projectionStatus` / `reservedClaimId` / `projectionError` **三列本片已建但完全不使用**（④ 片启用 ⇒ 避免二次迁移）；新候选恒为 `projectionStatus = none` |
| 提取运行 | `extraction_run` 记录 model / prompt / parser / schema 版本 + config key + `running → completed/failed`；**失败留痕**（`status=failed` + `error` + `candidateIds=[]`，且**不产生候选**） |
| 契约校验 | 无 evidence / 空 statement / 空 dimension 的 draft **一律拒绝**（整run 失败，不落半条） |
| 验收 | `phase-c6-candidate.test.ts` **9 例**：T-C6-6a 同配置幂等 · 6b 新配置 + lineage · 6c 不覆盖 · 6d 默认 draft/无 relation · **6e I-C6-4 下游指纹** · 6f run 失败留痕 · 6g 非法 draft · 6h I-C6-8 · §C6.7 身份 + append-only 审计 |
| 既有断言适配 | `phase-c3-b.test.ts` 基线 **29 → 32** |
| 收口 | root `tsc` **0** · research typecheck **0** · **433 tests / 433 pass / 0 fail**（118 suites）· `research smoke` **PASS** |
| 真实证据（隔离库） | RUN-1 `created=1` ⇒ RUN-2 同配置 `created=0 / reused=1 / sameIds=true` ⇒ 新配置 `created=1` + `lineage -> cand-…`；候选 `draft` / `projectionStatus=none` / `contentKind=fact` / `evidenceRefs=1` / `relation=undefined`；`isProjectable` false →(`confirmed`+`SUPPORT`) true；**beliefs 0 / pool items 0**；`TABLES: 32` |
| 未做（按授权边界） | 人工审阅入口（片 ③）· 投影到既有 `ingestClaims`（片 ④）· 报告接入（片 ⑤）· CLI / Agent 面 —— **全部未授权** |

---

## §C6.21 第 ③ 片实现记录（2026-09-27，**已授权并交付**）

| 项 | 内容 |
|---|---|
| Commit | **`57259e7`**（代码 + 测试；文档单独提交） |
| 范围 | **人工审阅入口**：CLI 五命令 + 服务层 + Agent 只读工具 |
| CLI | `tiancha research candidate list \| show \| confirm \| revise \| reject`（`list` 用 `<行业名>` 或 `--material-version <id>`，可加 `--status`) |
| **`--operator`** | 所有写操作 **必填且非空** —— 实测缺省 ⇒ **exit 1** |
| **`--relation`** | `confirm` **必填**（I-C6-8）—— 实测缺省 ⇒ **exit 1** |
| ★ **`revise`** | **只编辑内容、保持 `draft`**（实测输出 `审核状态：draft`）⇒ **审核动作 ≠ 投影动作**；编辑后仍须 `confirm --relation …` 才可能进入投影 |
| `reject` | **终态**；不可再次操作 |
| 状态机 | 仅 `draft` 可被操作；`confirmed` / `rejected` 为终态（重复操作 ⇒ 报错） |
| 并发守卫 | `updateClaimCandidateForReview` 带 `WHERE review_status = 'draft'` ⇒ 并发双确认**只有一个成功** |
| 审计 | 每次动作 **append 1 行** `candidate_review`（含 `before` / `after`）；实测 confirm+revise+reject ⇒ **3 行** |
| ★ I-C6-1 / I-C6-4 | 实测 `knowledge_belief = 0` · `information_pool_item = 0` · `research_gap = 0`；且 `confirmedClaimRef` 仍 `undefined`、`projectionStatus` 仍 `none` ⇒ **"确认"不等于"投影"** |
| CLI 输出纪律 | 每次动作都显式打印 **"⚠ 尚未投影：本片只记录人工决定；候选→Claim/Knowledge 的投影在后续片启用"** |
| Agent | 新增**只读** `research_candidate_list`（工具 **20 → 21**）；**写操作只给 CLI** |
| 验收 | `src/cli/phase-c6-cli.test.ts` **8 例**（T-C6-7a…7g + list 过滤）· `s7-exposure.test.ts` 20 → 21 |
| 收口 | root `tsc` **0** · research typecheck **0** · **441 tests / 441 pass / 0 fail**（119 suites）· `research smoke` **PASS** |
| 未做（按授权边界） | 投影到既有 `ingestClaims()`（片 ④）· 报告接入（片 ⑤）—— **未授权** |

### §C6.21.1 真实 CLI 证据（隔离库 `USERPROFILE` 重定向）

```text
candidate list --material-version <id>
  · [draft] demand · judgment · 证据 1 条
  · [draft] market · fact     · 证据 1 条
  → 候选是提案，未确认前不进 Knowledge / Pool / Gap / 评价

candidate confirm <id> --operator analyst                    → exit 1（缺 --relation，拒绝）
candidate confirm <id> --operator analyst --relation SUPPORT → exit 0
  审核状态：confirmed · relation=SUPPORT
  ⚠ 尚未投影：本片只记录人工决定；候选→Claim/Knowledge 的投影在后续片启用。

candidate revise <other> --operator analyst --statement …    → exit 0
  审核状态：draft                    ← ★ revise 后仍是 draft
  下一步：用 confirm --relation … 明确接受，才可能进入投影。

candidate show <id>   → 候选 + 审阅记录（append-only，共 1 条：confirm by analyst）
candidate list --status draft → 1 条（且展示的是修订后的内容）
candidate reject <other> --operator analyst --comment 来源不可靠 → exit 0，rejected
```

下游实测：`claim_candidate = 2` · `candidate_review = 3` · **`knowledge_belief = 0`** · **`information_pool_item = 0`** · **`research_gap = 0`**。

---

## §C6.22 第 ④ 片实现记录（2026-09-27，**已授权并交付**）

| 项 | 内容 |
|---|---|
| Commit | **`13db5d1`**（代码 + 测试；文档单独提交） |
| 范围 | **W4 投影**：已确认候选 ⇒ **既有 `ingestClaims()`** ⇒ Knowledge |
| ★ **复用而非重写** | `CandidateProjectionService` **只调用** `OpportunityDiscoveryService.ingestClaims()`；Claim 写入 / 投影 / `refreshSubject` **全部由既有路径完成**，其签名与语义**未改**（§C6.10） |
| 触发 | `candidate confirm --relation …` **记录人工决定后立即投影**；`candidate project <id> --operator` 用于**任意时刻续跑 / 重做**（幂等） |
| I-C6-8 | `draft` 或**无 relation** 的候选 ⇒ **拒绝**（实测 draft 候选 `project` ⇒ **exit 1**） |
| §C6.17 状态机 | `none → reserved → claim_written → projected → finalized`；**P1 即持久化 `reservedClaimId`** ⇒ 崩溃后重跑**找回同一个 Claim** |
| 幂等 | 传 `claimIds: [reserved]` + **稳定** `sourceId` / `runId` ⇒ artifact `put` 按 `artifactId` 幂等 + belief 确定性 id ⇒ **重跑不产生第二个 Claim / belief**（实测第二次为 `already_projected` 且**计数不变**） |
| ★ claimRef 形状 | `confirmedClaimRef` 存**项目统一的引用形状** `artifact:claim/<id>`；`reservedClaimId` 存裸 artifact id —— 两者**不得混用** |
| 错误留痕 | 投影抛错 ⇒ 记 `projectionError`；候选**保持 `confirmed`**、状态可续跑（实测：注入抛错的 artifact store ⇒ `failed` + 记录；恢复后重跑**复用同一 `reservedClaimId`**） |
| SUPERSEDE | 必须给 `--supersedes-claim <claimRef>`，否则**拒绝**（不猜要取代哪条 Claim） |
| CLI 文案 | confirm 现在会真的投影 ⇒ 提示改为**按是否配置投影服务**区分（`attempted` / `not_wired`），不再固定说"尚未投影" |
| 验收 | `packages/research/src/phase-c6-projection.test.ts` **6 例**：T-C6-3（走既有路径 + **双向可追**）· T-C6-2（draft 拒绝 + 指纹不变）· T-C6-8（**任意点重跑幂等**：P4 后 / 清掉 P4 回填 / P2 后）· T-C6-8b（失败留痕 + 恢复同 id）· T-C6-9（SUPERSEDE 不猜）· 被拒候选不可投影 + 两候选独立 |
| 收口 | root `tsc` **0** · research typecheck **0** · **447 tests / 447 pass / 0 fail**（120 suites）· `research smoke` **PASS** |
| 未做（按授权边界） | 报告接入（片 ⑤）—— **未授权** |

### §C6.22.1 真实 CLI 证据（隔离库）

```text
BEFORE   knowledge_belief=0 | industry_knowledge=0 | information_pool_item=0 | research_gap=0

candidate confirm <id> --operator analyst --relation SUPPORT --comment 口径与报告一致
  审核状态：confirmed · relation=SUPPORT
  → 正在通过既有 ingestClaims 路径投影（结果见下）。
  候选 <id> · 投影结果：projected
  已生成 Claim：artifact:claim/claim-379055ff-…（可双向追溯：候选 ↔ Claim）

AFTER    knowledge_belief=1 | industry_knowledge=1 | information_pool_item=0 | research_gap=0

candidate project <id> --operator analyst     → already_projected，计数**不变**（belief 仍 1）
candidate project <draft-candidate> --operator analyst → exit 1（I-C6-8 拒绝）

候选行：review_status=confirmed · decision_relation=SUPPORT · projection_status=finalized
        reserved_claim_id=claim-379055ff-… · confirmed_claim_ref=artifact:claim/claim-379055ff-…
```

---

## §C6.23 第 ⑤ 片实现记录（2026-09-27，**已授权并交付 → C6 实现全部完成**）

| 项 | 内容 |
|---|---|
| Commit | **`0e5a92a`**（代码 + 测试；文档单独提交） |
| 范围 | 报告接入：`contentKind` 分流 · 候选进入 `pendingCandidates` · 引用口径标注 |
| D-C6-D（反查） | 报告**只读主库**的候选行（`confirmedClaimRef → contentKind`）⇒ **不需要** artifacts 里的 Claim blob（`ReportService` 从不读 blob ✓） |
| 分流规则 | 已知为 `judgment` 的 claim **不再**列在 `keyFacts`；已知为 `fact` 的 claim **不再**列在 `mainJudgments`；**无候选的历史 `[CLAIM]` claim 保持原行为**（不强归类、不静默丢弃） |
| D-C6-E（判别联合） | `pendingCandidates: Array<KnowledgeLine \| ClaimCandidateLine>`；`KnowledgeLine` 的**身份字段仍必填**；新增 `ClaimCandidateLine`（`candidateRef` / `contentKind` / `statement` / `reviewStatus` / `evidenceRefCount` / `materialVersionId` / `normalizationVersion`）；**不新增 section key** ⇒ 不撞 T-C4-6 |
| §C6.3（引用口径） | 渲染的摘录标注 `nfkc-lf-v1`；materialised Markdown **渲染待确认候选**（含证据条数与规范化版本） |
| 回归适配 | C4-A 的 **T-C4-5** 顺序断言适配联合类型（**同一排序判据** `candidateRef \|\| beliefId`，未削弱任何保证） |
| 验收 | `packages/research/src/phase-c6-report.test.ts` **2 例**：T-C6-4（混合状态：fact / judgment / draft 各归其位，**不断言区块数量不同**）· T-C6-7（充分度覆盖 + critical 门控仍为 `pending`） |
| 收口 | root `tsc` **0** · research typecheck **0** · **449 tests / 449 pass / 0 fail**（121 suites）· `research smoke` **PASS** |
| ★ 仍未实现 | **原文切片**（§C6.3 要求的"规范化位置 → 原文位置"映射）：当前只做**规范化摘录 + 版本标注**；**原文字面还原能力未做**，明确留作后续（不做成"已完成"） |

### §C6.23.1 真实证据（隔离库 + 真实 CLI）

```text
keyFacts: ["market"]           ← fact 的 claim
mainJudgments: ["demand"]      ← judgment 的 claim
pendingCandidates rows: 1
pending C6 row: {"dim":"supply","kind":"fact","status":"draft","norm":"nfkc-lf-v1"}

CLI: research report 测试行业
  内容：当前认知 2 · 关键事实 1 · 主要判断 1 · 主要冲突 0 · 缺口 10 · 下一步 10
  ← 三区不再是同一个数字：fact 与 judgment 已按 contentKind 分流

Markdown:
  待确认候选（提案：未确认前不进入已确认认知、Pool 充分度、Gap 或投资评价）：
  - **supply** · fact · draft → supply capacity about 30k units（证据 1 条；规范化 nfkc-lf-v1）
  > 引用来自材料的**规范化文本**（`nfkc-lf-v1`）…
```

### §C6.23.2 C6 交付总览（5/5 片）

| 片 | 内容 | Commit |
|---|---|---|
| ① | 材料版本 + Fragment + Evidence（W1–W2） | `cce59b3`（含 slice-1 review 闭环） |
| ② | 候选层（W3）：确定性身份 / 提取运行 / lineage | `fb93e4c` |
| ③ | 人工审阅闸门（CLI + Agent 只读） | `57259e7` |
| ④ | 投影走**既有** `ingestClaims()`（W4） | `13db5d1` |
| ⑤ | 报告接入（`contentKind` / 候选 / 引用口径） | `0e5a92a` |

**仍未授权**：模型提取器（`CandidateExtractor` 的模型实现 —— 见 §C6.16.1 与 `HANDOFF` §10）· U-1/U-2/U-3 可用性小步 · Wind · 自动发现 · Phase D。

**End of contract（rev10: §C6.23 第 ⑤ 片实现记录 · C6 实现全部完成）.**
