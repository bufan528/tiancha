# Phase C6 · 资料闭环 Implementation Contract

> 状态：**rev1 — DESIGN ONLY。Implementation / Commit / Push 均未授权。**
> 父基线：`31b1e1a`（= `origin/main`；C-MVP-R1 已发布，总契约 §29 rev16）。
> 依据：用户 2026-09-27 裁决 —— **单行业试点收口**（§C6.1）+ 五项核心要求（结构化定位 / 候选与认知分开 / 内容类型 vs 审核状态 / 分值语义 / 提取重跑审计）。
> 文件定位：**C6 专项契约**（与 `c2-implementation-contract.md` / `c5-implementation-contract.md` 同例）；总契约 `implementation-contract.md` **§30 只做索引**，不重复正文。

---

## §C6.0 修订历史

| 版本 | 变更 |
|---|---|
| **rev1** | 首版：试点依据 · 目标链路 · D6-1…D6-5 五项核心（+D6-6 冲突验收）· 数据模型 · 不变量 I-C6-1…I-C6-7 · 验收 T-C6-1…T-C6-9 · OUT · 待裁决 D-C6-A…D-C6-C |

---

## §C6.1 定位与试点依据（**实测，非推测**）

C-MVP 已证明「**明确写成 `[CLAIM]` 的内容**」可以驱动既有链路；C6 要补的是**它前面缺的那一段**：普通材料（报告 / 纪要 / 访谈稿）如何变成**可检查、可追溯**的认知。

**单行业试点（隔离库 `USERPROFILE` 重定向，真实材料：`samples/人形机器人行业研究报告.md`）实测结论**：

| 已跑通（真实材料上） | 证据 |
|---|---|
| 人工整理的真实 Claim 驱动全链 | 11 条 Claim → `knowledge_belief` **11 全 confirmed** → Pool **9/12 sufficient** → Gap **12→3** → Priority（`key_validation` 81/100 居首，带因子明细与规则版本） |
| critical 门控挡住决策 | `evaluate` 决策 = **暂不判断（key_validation 证据不足）** ✓ 行为正确 |
| 重复导入幂等 | 第二次导入：`相同材料已完整入库`，缺口 3→3、优先级 3→3、**槽位变化（无）** |
| Echo 未污染 | beliefs 全是真实 Claim；`research_source` = 2（骨架 + 材料，幂等 `src-<ingestId>`） |

| 已确认的能力边界（**C6 的输入**） | 证据 |
|---|---|
| **普通文本不产生 Claim** | 报告整篇进入系统只作材料文本；1112 字符需**逐条人工定位来源句**才得到 11 条 Claim |
| **来源定位没有结构** | `source:` 是自由文本，**无法机器校验**"这条 Claim 出自原文哪一段" |
| **缺少语义分类** | 报告 `当前认知 / 关键事实 / 主要判断` 三区取自 current belief / confirmed belief / Pool item，**全部 11 条是自然结果**（11 条皆 confirmed 且全进 Pool）—— 需要的是**内容类型**分类，**不是**让区块数量不同 |
| **分值是证据充分度** | 9 个已评估维度**全 60**、`risk` 为 **100** ⇒ 机械映射，**绝不能当投资判断** |

---

## §C6.2 目标链路（本契约的唯一纵向切片）

```text
原始材料（不可变 + 版本 + content hash）
   → Fragment（结构化定位：page / paragraph / timestamp / char_range）
   → Evidence（对某个判断的 supports / refutes / context）
   → Claim 候选（带 evidenceRefs + 提取版本，reviewStatus=draft）
   → 人工审核（confirm | revise | reject）
   → 已确认 Claim（**走既有 `OpportunityDiscoveryService.ingestClaims()`**）
   → Knowledge / Pool / Gap / Priority / Evaluation / Report
```

> 这条链**只补"原始材料 → 候选"这一段**；`已确认 Claim → Knowledge → …` **完全复用既有实现**，不重写、不复制写入逻辑。

---

## §C6.3 D6-1 结构化来源定位（**LOCKED**）

**原则**：材料保持**原样**；定位必须能被**机器复算**。`source:` 自由文本保留作**说明**，**不承担**定位职责。

### 新增/扩展对象

| 对象 | 关键字段 | 说明 |
|---|---|---|
| `material_version` | `materialVersionId` · `materialId` · `contentHash`(sha256, utf8) · `normalizationVersion` · `byteLength` · `createdAt` | 材料不可变；任何改动 = **新版本**（旧版本永不删） |
| `fragment` | `fragmentId` · `materialVersionId` · `locator` · `text` · `textHash` · `createdAt` | 原文片段，**必须**带定位 |

### `locator`（判别联合，v1 只启用前两种）

```text
{ kind: "char_range", start: number, end: number }        // 计量单位见下
{ kind: "paragraph",   index: number }                    // 0-based 段落序号（按 \n\n 切分）
{ kind: "page",        page: number, start?: number, end?: number }   // v1 保留定义，未接入 PDF
{ kind: "timestamp",   startMs: number, endMs: number }              // v1 保留定义，未接入音频
```

**计量与规范化（必须写死，否则不可复算）**：

* 字符偏移以 **UTF-16 code unit** 计量（与 JS `String#slice` 一致）；`utf8` 与 `utf16` 两种计量**不得混用**；
* 文本规范化版本 = `nfkc-lf-v1`：Unicode **NFKC** + 换行统一为 `\n`；**规范化后的文本**才用于定位与 hash；
* 引用校验（验收必须真跑）：`normalize(materialVersion.rawText).slice(start,end) === fragment.text` **且** `sha256(fragment.text) === fragment.textHash`；
* Fragment **不得**跨材料、不得跨版本。

**OUT**：v1 **不**做 PDF 解析与音频转写（`page` / `timestamp` 仅保留定义）—— 见待裁决 **D-C6-A**。

---

## §C6.4 D6-2 候选与认知状态分开（**LOCKED**）

**硬规则**：候选**永不**直接进入 `ingestClaims()`（该路径会产生**已确认认知**）。

| 对象 | 关键字段 |
|---|---|
| `claim_candidate` | `candidateId`（确定性） · `subjectKind` · `subjectId` · `dimension` · `statement` · `evidenceRefs[]`（≥1，指向 **evidence**） · `confidence?` · `extractionRef` · `reviewStatus`(`draft`/`confirmed`/`revised`/`rejected`) · `reviewedBy?` · `reviewedAt?` · `decision?`(`relation`: SUPPORT/REVISE/CONFLICT/SUPERSEDE) · `confirmedClaimRef?` · `createdAt` |
| `candidate_review` | `candidateId` · `action` · `operator` · `comment?` · `at` · `before`/`after`（人工改了什么） |

**闸门**：

* `reviewStatus = draft` ⇒ **不得**提高 Pool 充分度、**不得**关闭 Gap、**不得**进入 Evaluation 输入（I-C6-4）；
* 只有 `confirmed`（或 `revised`）后，才把该候选的 `statement` 交给既有 `ingestClaims()`；成功后回填 `confirmedClaimRef`（候选 ↔ 真 Claim **双向可追**）；
* 人工编写的 `[CLAIM]` 路径**保持原语义**（C-MVP 不变），两条入口并存、互不干扰。

---

## §C6.5 D6-3 内容类型 vs 审核状态（**LOCKED**）

**两类正交**，不得互相代替：

```text
reviewStatus : draft | confirmed | revised | rejected     ← "人审过了吗"
contentKind  : fact | judgment | candidate | conflict | open_question   ← "这句话是什么性质"
```

* ★ **`confirmed` 是审核状态，不代表"客观事实"**：一条**已确认的分析推断**，`contentKind` 仍是 `judgment`。
* 报告的语义分区**按 `contentKind`**（已确认事实 / 分析判断 / 待确认候选 / 矛盾 / 待核实），**不是**按 `reviewStatus` 切；
* **明确不要求**各区块数量互不相同 —— 试点里三区同为 11 条是**正确**的自然结果；
* `contentKind` 的**判定方**见待裁决 **D-C6-B**（v1 建议：人工指定为默认，模型只可**提议**且需人工确认）。
* **快照兼容**：`report_snapshot.sections_json` **新增可选字段**承载新分区；**不迁移**老快照，老快照按原样可读（I14 不变）。

---

## §C6.6 D6-4 分值语义（**LOCKED**）

* 现有数值一律标注为 **「证据充分度 / 覆盖度」+ 规则版本**（`eval-v1` / `agg-v1` / `suf-v1` / `prio-v1`），在 **CLI / 报告 / Agent** 三处输出中**显式**标注；
* **禁止**以"评分 / 投资吸引力"口径呈现；`risk = 100` 的含义必须写明 = "**该维度的证据满足确认条件**"，**不是**"风险低"；
* **投资吸引力评分不在 C6**：它需要经审阅的方法论 + 对应数据 + 独立验收；
* **critical 门控是回归条件**：C6 不得改变"关键维度证据不足 ⇒ `暂不判断`"的行为。

---

## §C6.7 D6-5 提取与重跑审计（**LOCKED**）

| 对象 | 关键字段 |
|---|---|
| `extraction_run` | `extractionId` · `materialVersionId` · `modelVersion` · `promptVersion` · `parserVersion` · `startedAt` · `finishedAt` · `status`(`running`/`completed`/`failed`) · `candidateIds[]` · `error?` |

* **幂等键**：`(materialVersionId, blockHash, dimension)` ⇒ 同一材料同一块在**同一提取版本**下重复运行**不产生第二份候选**；
* **重跑留痕**：模型 / 提示词 / 解析器版本变化 ⇒ **新 `extraction_run`**（候选可新增，但**不得**删除或改写旧 run）✓
* ★ **人工改过的候选不可被重跑静默覆盖**（I-C6-5）：`reviewStatus ≠ draft` 的候选，重跑**只能新增**，冲突时保留两条并标注来源 run；
* **跨库部分失败与恢复**（研究库 + `artifacts.sqlite`）：**从契约阶段就写清** —— 复用 C-MVP-R1 §29 的模式：**状态标记 + 幂等重跑**，不用跨库事务（§15 CR-10）；`extraction_run.status` 是唯一的恢复锚点。

---

## §C6.8 D6-6 冲突处理与验收口径（**LOCKED**）

* **冲突并列保留、不选边**（沿用 I3 与既有演化规则）；同一指标不同口径 / 不同时间 ⇒ **保留来源、并列差异**，交既有规则处理；
* **冲突的软件验收不需要真实资料**：允许使用**明确标记为合成、且仅存在于测试隔离库**的两份矛盾 Claim（`synthetic: true`），用于验证"来源并存 / 冲突候选 / 人工确认 / 对 Knowledge·Pool·Gap 的影响"；
* **业务真实性验证**必须等**真实第二来源或访谈材料**，不在 C6 验收范围内。

---

## §C6.9 不变量（I-C6-1…I-C6-7）

| # | 不变量 |
|---|---|
| **I-C6-1** | 候选（`draft`）**永不**直接进入 Claim / Knowledge / Pool / Gap / Evaluation —— 必须经人工确认 |
| **I-C6-2** | 每个 Evidence 必须指向 **≥1 个 Fragment**；每个 Fragment 必须能被**机器复算**回到材料原文（同规范化版本 + 同 hash + 同偏移） |
| **I-C6-3** | `reviewStatus` 与 `contentKind` **正交**；`confirmed` 不得被解释为"客观事实"；报告分区按 `contentKind` |
| **I-C6-4** | 未确认候选**不得**提高 Pool 充分度、关闭 Gap 或影响 Evaluation（全状态指纹证明） |
| **I-C6-5** | 人工修改过的候选（`confirmed` / `revised` / `rejected`）**不得**被后续重跑静默覆盖 |
| **I-C6-6** | 冲突双方**并列保留**，永不静默合并或选边 |
| **I-C6-7** | 分值只表示**证据充分度 / 覆盖度**且必须带规则版本；不得包装成投资吸引力评分 |

---

## §C6.10 与既有冻结面的关系

| 冻结面 | 约束 | C6 影响 |
|---|---|---|
| C-MVP（`[CLAIM]` 规则解析） | 只有 `[CLAIM]` 块产生 Claim；语义冻结 | ✅ **不变**（两条入口并存） |
| C-MVP-R1（§29） | 五态 / fencing / 账本 / 重叠检测 / 人工归属 | ✅ 复用其"状态机 + 幂等重跑"模式，**不改**它 |
| C1（Knowledge 投影语义） | 演化四型 / current 判据 | ✅ 候选确认后**走同一路径**，不新增语义 |
| I1–I16 | 全部 | ✅ 遵守（尤其 I3 冲突、I13 占位、I14 报告只是投影） |
| Phase B（chain / target / diligence） | 模板实例 / Human-confirmed subject | ✅ 不变；C6 只补"材料 → 候选" |
| Report = Projection | 不改 SoT；可重算 | ✅ 新分区字段**可选**，老快照可读 |

---

## §C6.11 OUT（明确不做）

* ❌ 改写 C-MVP 的 `[CLAIM]` 规则语义
* ❌ 让模型输出**直接**成为已确认 Claim / Knowledge / PoolItem（须人工闸门）
* ❌ 投资吸引力评分 / 分数校准（需方法论 + 数据 + 独立验收）
* ❌ PDF 解析 / 音频转写（v1 只保留 locator 定义）
* ❌ Wind / 自动发现 / Phase D（外环）
* ❌ 删除或改写历史（候选、证据、片段、快照一律 append / 版本化）

---

## §C6.12 验收矩阵（T-C6-1…T-C6-9）

| # | 场景 | 断言要点 |
|---|---|---|
| **T-C6-1** | Fragment 定位可回到原文 | 对每类 locator：`normalize(rawText).slice(start,end) === fragment.text` 且 `sha256(text) === textHash`；**故意改一个片段字符 ⇒ 校验必须转红** |
| **T-C6-2** | 未确认候选不影响任何下游 | 造候选（`draft`）⇒ Pool 状态 / Gap 状态 / `NextAction` / Evaluation 输入的**全状态指纹前后一致** |
| **T-C6-3** | 确认后走**既有**路径 | `confirm` ⇒ 调用既有 `ingestClaims()` ⇒ belief 变化；`candidate.confirmedClaimRef` 与 belief 的 `claimRef` **双向可追** |
| **T-C6-4** | **混合状态**材料的语义分类 | 同一材料含 fact / judgment / candidate / conflict / open_question ⇒ 报告五类分区**各归其位**；**不断言**区块数量互不相同 |
| **T-C6-5** | 合成冲突（测试隔离库，`synthetic: true`） | 两份矛盾 Claim：来源并存、冲突可见、人工确认后按**既有演化规则**处理；真实库**不得**出现 synthetic 行 |
| **T-C6-6** | 幂等 + 重跑不覆盖人工修改 | 同版本重跑 ⇒ 候选不翻倍；把一条候选改为 `confirmed` 后重跑 ⇒ 该条**不被改写**，新增候选另存 |
| **T-C6-7** | 分值语义 + critical 门控回归 | 三处输出都带"证据充分度 + 规则版本"；`risk=100` 的解释文本存在；关键维度证据不足 ⇒ 决策仍为 `暂不判断` |
| **T-C6-8** | 跨库部分失败与恢复 | 在"研究库写入后、artifacts 写入前"注入失败 ⇒ `extraction_run.status = failed`；重跑续做、候选/证据/片段**不重复** |
| **T-C6-9** | 边界：候选不得绕过闸门 | 静态 + 行为各一条：不存在"候选 → `ingestClaims`"的直接调用路径；未确认候选不出现在任何投影视野 |

---

### §C6.12b 拆出 C6 的三项可用性小步（**不属本契约范围**）

试点暴露的三项**可用性**缺口，按验收者裁决**拆出** C6 核心，各自独立小步，**不阻塞**本契约：

| 小步 | 内容 | 归属 |
|---|---|---|
| **U-1** | `research chain` **保持人工触发**（治理边界不动）；**Plan 渲染**在"建议研究位置"为空时**提示**执行 `tiancha research chain <行业>`（`research need` 已有同类提示，Plan 没有） | CLI 展示层小步 |
| **U-2** | 新增只读 CLI：`research question list` / `research gap list` / `research next action list`（与既有 Agent 只读工具对齐；Plan 已有部分汇总，独立列表是研究者排查细节的便利入口） | 只读 CLI 小步 |
| **U-3** | 对错误命令 `research state show` 增加**本地 fail-fast 提示**（避免落入模型调用路径），并在帮助信息中明确正确命令是 `state show` | CLI 路由小步 |

> 三者**都不涉及** Evidence / 候选的数据模型，因此**不与 C6 同阶段实现**；可先行或后行，各自单独授权。

## §C6.13 待裁决（3 项，**阻塞实现授权**）

| # | 议题 | 候选方案 |
|---|---|---|
| **D-C6-A** | v1 支持的 locator 范围 | (a) 仅文本（`char_range` + `paragraph`）· (b) 文本 + PDF `page` · (c) 三者全上（含音频 `timestamp`） |
| **D-C6-B** | `contentKind` 的判定方 | (a) 人工指定（模型不可参与）· (b) 模型**提议** + 人工确认（默认人工可改）· (c) 纯规则判定 |
| **D-C6-C** | 候选提取的粒度 | (a) 段级 · (b) 句级 · (c) 两者兼顾（块级候选 + 句级 evidence 定位） |

> 已裁决事项**不再列为待裁决**：模型可起草**带原文引用**的候选、候选须经人工确认后才进入 Claim → Knowledge、报告本身不是事实来源（见 `HANDOFF.md` §10 独立决策记录）。

---

## §C6.14 授权声明

> **本契约 rev1 为 DESIGN ONLY。实现 / commit / push 均未授权。**
> 进入实现前需：① 用户裁决 **D-C6-A / D-C6-B / D-C6-C**；② 实现前复核（预计文件清单 + T-C6-1…T-C6-9 可测性 + 回归面）。
> 实现建议按片推进（每片单独授权）：**① 材料版本 + Fragment/Evidence 存储与定位 → ② 候选生成 → ③ 人工审阅入口 → ④ 确认后既有 Knowledge 投影 → ⑤ 报告引用与缺口回填**，每片都用**本次试点的 11 条 Claim** 作真实基准，用**合成冲突**补边界。

**End of contract（rev1）.**
