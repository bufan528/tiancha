# Phase C6 · 模型提取器 Implementation Contract（D-C6-H / D-C6-I / D-C6-J）

> 状态：**rev1 — DESIGN ONLY（实现未授权）**。本文档只锁定语义、边界、失败与恢复规则、验收；**模型适配器的实现须在本契约定稿后单独授权**。
> 依据：用户 2026-09-28 的三项结构性裁决（§M2）。用户原话要点：**输入按可追溯片段分批**、**模型只提交引用文本与位置且 ID 由天查生成**、**模型调用异步且整次运行全部验证后再落候选**。
> 前置契约：`docs/phaseC/c6-implementation-contract.md` §C6.18–§C6.27（资料闭环：材料版本 / Fragment / Evidence / 候选 / 人工闸门 / 投影；其中 `[CANDIDATE]` 确定性提取器 **已交付**）· `docs/HANDOFF.md` §10（**LLM 边界**：禁止 LLM 直接产生 `Claim` / `Fact` / `Knowledge` / `PoolItem` / `Evaluation` 或 0–100 分；模型只能**起草**带来源定位的候选且**必须人工确认**）。
> 文件定位：**C6 模型提取器专项契约**（同 `c2-*` / `c5-*` / `c6-implementation-contract.md`）；总契约 `implementation-contract.md` §30 只做索引。

---

## §M0 一句话

**让普通行业报告（散文）自动进入候选层 —— 但模型只负责"提出可核对的引用"，不负责定位、不负责命名、不负责落库、不负责确认。**

---

## §M1 范围与不做的事

### §M1.1 范围

* 输入：**已登记**的 `MaterialVersion`（`material_version` 行，含 `rawText` / `normalizedHash`）。
* 输出：**候选**（`claim_candidate`，一律 `reviewStatus = draft`）+ 由天查生成的 `Fragment` / `FragmentEvidence`，以及一条可审计的 `extraction_run`。
* 目标场景：合同、券商研报、行业纪要之类的**普通文本**，无需人工改写成 `[CANDIDATE]` 块。

### §M1.2 不做的事（红线，越界即打回）

1. **不产生** `Claim` / `KnowledgeBelief` / `PoolItem` / `InvestmentEvaluation` / `Report` 的任何写入。候选必须经**人工确认**（既有 CLI `candidate confirm`）才进入既有认知路径。
2. **不使用**模型生成 0–100 投资分、`contentKind` 之外的语义标签、或任何"投资结论"。
3. **不依赖** Pi Coding Agent / 具体模型 SDK / 网络细节 —— Research Core 只依赖一个**注入的纯函数缝**（§M3.4）。
4. **不允许**模型伪造来源：模型给出的引用若不成立，**整次提取失败**（§M6），绝不"降级为无来源候选"。
5. **不覆盖**人工正在看或审核过的候选（§M8）。
6. **不落库**任何未经校验的中间产物；**不发布部分候选**（§M7）。
7. **不改** `KnowledgeProjectionService` / `OpportunityDiscoveryService.ingestClaims()` / `CandidateReviewService` / `CandidateProjectionService` 的既有语义。
8. 首版**只承诺"引用能回到规范化材料"**（`nfkc-lf-v1`）；**原文位置映射**（PDF 页码 / 原始字符位置）**不阻塞首版**（§M11.3）。

---

## §M2 裁定（用户 2026-09-28）

| # | 裁定 | 落到契约 |
|---|---|---|
| **D-C6-H** | **输入按可追溯片段分批**：以已登记的 `MaterialVersion` 为输入，先按段落生成**确定、可复算**的文本窗口；过长段落再按规范化字符范围切分；窗口间**保留少量重叠**（避免结论跨段丢上下文）。**窗口规则及版本进入提取配置身份**。模型使用 `nfkc-lf-v1` 规范化文本 | §M4 |
| **D-C6-I** | **模型提交引用文本和位置，Evidence ID 由天查生成**：模型输出候选陈述 / 维度 / `fact` / `judgment` / 置信度，以及它引用的**输入片段与精确摘录**；**不生成** `evidenceRef` / Fragment ID / Evidence ID，**不写数据库**。天查校验摘录**确实出现在本材料版本对应的规范化片段中**，再生成并保存 Fragment、Evidence 与候选。引用不存在 / 跨材料 / 位置与摘录不符 ⇒ **整次提取失败**，不得留下半份候选。候选一律 `draft`，须人工审核 | §M5、§M6 |
| **D-C6-J** | **模型调用异步；整次运行全部验证后再落候选**：`CandidateExtractor.extract()` 与 `CandidateExtractionService.run()` 明确**改为异步**；运行期间记录**模型 / 提示词 / 分块器 / 解析器 / schema** 版本；首版**整次运行全成或全败**（所有批次返回并通过引用校验后，才在**一个主库事务**里写 Evidence、候选与完成状态）；任何批次失败 ⇒ 运行 `failed`，**不发布部分候选**。相同配置重跑**不得覆盖**人工改过或审核过的候选，**不得悄悄给已审核候选追加新证据**；新增或变化的提取结果必须作为**可审阅的新版本**处理 | §M3、§M6、§M7、§M8 |

---

## §M3 运行架构

### §M3.1 三段式（职责分离）

```
MaterialVersion（规范化文本）
   │  ① 分块：确定性、可复算、无模型
   ▼
ExtractionWindow[] ──► ② 模型适配器（注入的纯函数缝）
   │                        │  只读窗口文本，返回"候选 + 引用"
   │                        ▼
   │                   ModelBatchResult[]（未经校验，不可落库）
   │  ③ 校验 + 落库：确定性、服务端垄断 ID 生成
   ▼
Fragment / FragmentEvidence / claim_candidate（全成或全败，单事务）
```

### §M3.2 新增服务端构件（实现轮落地，命名供评审）

| 构件 | 位置 | 职责 |
|---|---|---|
| `extractionWindowFor(version, rule)` | `application/extraction-window.ts` | 纯函数：`MaterialVersion` → `ExtractionWindow[]`（§M4） |
| `WINDOW_RULE_VERSION` | 同上 | 常量版本串，**进入 `extractionConfigKey`** |
| `ModelCandidateDraft` | `application/model-extraction.ts` | 模型输出的**候选载荷类型**（含 `quotes`，**不含任何 id**） |
| `ModelExtractionAdapter` | 同上 | **注入缝**：`extractBatch(input) => Promise<ModelBatchResult>`（§M3.4） |
| `ModelCandidateExtractor` | 同上 | 实现既有 `CandidateExtractor`：编排窗口 → 适配器 → 转成 `CandidateDraft` |
| `resolveQuotes(...)` | 同上 | 纯函数：把 `quote` 解析为 `(fragmentId, normalizedStart/End, quoteHash)`；不成立即抛（§M5） |

### §M3.3 与既有代码的关系

* **复用**：`normalizeText` / `splitParagraphs` / `locatorKey` / `buildMaterialFragment` / `buildFragmentEvidence` / `fragmentEvidenceIdFor` / `materialFragmentIdFor` / `sha256Hex`（`domain/material-source.ts`）；`repo.insertFragments` / `appendCandidateEvidence`（仅 draft）/ `repo.transaction`（嵌套安全）。
* **改造**：`CandidateExtractor.extract()` 变 **async**；`CandidateExtractionService.run()` 变 **async** 且**单事务收口**；`ExtractionRun` + `extraction_run` 增 `chunker_version`；`extractionConfigKeyFor` 增 `chunkerVersion` 段（§M9）。
* **`ExplicitBlockExtractor`**：语义**不变**（仍是确定性 `[CANDIDATE]` 解析），仅以 `async` 包装以适配新签名。

### §M3.4 注入缝（模型调用的唯一边界）

```ts
/** The ONLY way a model enters this system. Pure with respect to storage: reads text, returns data. */
export interface ModelExtractionAdapter {
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly parserVersion: string;
  /** ★ Async on purpose (D-C6-J). Must not write anything, anywhere. */
  extractBatch(input: ModelBatchInput): Promise<ModelBatchResult>;
}

export interface ModelBatchInput {
  materialVersionId: string;
  window: { windowId: string; index: number; text: string };  // 规范化文本，仅此窗口
  /** 供模型自我定位；模型可忽略，但不得伪造（伪造即为无效引用，§M6）。 */
  windowStartInVersion: number;
  dimensionHints: string[];   // 只来自当前激活方法论的维度 key，避免模型自造维度
}
```

**契约要求**：适配器**只读**、**只返回数据**；Research Core 不 import 任何模型 SDK；装配点（composition root，`src/cli/tiancha.ts`）负责把具体实现注入。**适配器缺失/未配置 ⇒ 明确失败**（不是静默退回 `[CANDIDATE]`，见 §M11.2）。

---

## §M4 窗口协议（D-C6-H）

### §M4.1 输入文本

* 唯一输入是 **`normalizeText(version.rawText)`**（即 `nfkc-lf-v1` 之后的文本）。窗口、位置、摘录**全部以规范化文本为坐标**。
* 窗口**不落库**（纯派生、可复算），但**窗口规则版本进入 `extractionConfigKey`**，因此"同一材料 + 同一规则 + 同一模型配置"是**可复现**的。

### §M4.2 切分算法（`WINDOW_RULE_VERSION = "para-greedy-v1"`）

```
1) paragraphs := splitParagraphs(normalized)          // 既有函数：\n{2,} 分隔 + 剥尾随换行
2) 贪心合并相邻段落直到加入下一段会超过 maxChars（默认 2000） ⇒ 一个"段落组窗口"
3) 若某一段落自身长度 > maxChars ⇒ 该段落按 char_range 切分：
     step = maxChars - overlapChars（默认 overlapChars = 200）
     切到段落末尾为止（最后一片可短于 maxChars）
4) 窗口按 (start, end) 升序编号 index = 0,1,2,…
```

* **确定性**：只依赖 `normalized` 文本与三个常量（`maxChars` / `overlapChars` / 规则版本），**不含时间戳、随机数、模型输出**。
* **可复算**：给定同一 `MaterialVersion`，任意进程、任意次数调用得到**完全相同**的窗口数组（实现轮必须有一个"两次调用深比较相等"的测试）。
* **重叠**：仅在同一超长段落被切分时出现（相邻片共享 `overlapChars` 字符）；段落组窗口之间**不重叠**（段落边界天然是断点）。
* **常量进身份**：`maxChars` / `overlapChars` / `WINDOW_RULE_VERSION` 一并进入 `extractionConfigKey`（§M9），否则"改了分块参数却算同一配置"会让重跑语义失真。

### §M4.3 窗口形状

```ts
interface ExtractionWindow {
  windowId: string;      // deterministicId("win", `${materialVersionId}|${WINDOW_RULE_VERSION}|${start}|${end}`)
  index: number;         // 0-based, 升序
  start: number;         // 规范化文本中的全局字符偏移（闭）
  end: number;           // 规范化文本中的全局字符偏移（开）
  text: string;          // === normalized.slice(start, end)
  paragraphIndexes: number[];  // 覆盖的段落 index（仅段落组窗口；切分窗口为单段）
}
```

**不变量**：`text === normalized.slice(start, end)`；`index` 连续；窗口集合**覆盖**整篇（不丢字符，除尾随空白）。

---

## §M5 模型输出与校验（D-C6-I）

### §M5.1 模型必须提交什么（每批）

```ts
interface ModelCandidateDraft {
  dimension: string;            // 必须取自 dimensionHints（不得自造）
  statement: string;            // 候选陈述（非空）
  contentKind: "fact" | "judgment";  // §C6.5
  confidence?: number;          // 0..1，可以不给
  quotes: Array<{
    windowId: string;           // 必须属于本 MaterialVersion 的窗口集合
    startInWindow: number;      // 闭
    endInWindow: number;        // 开
    text: string;               // ★ 逐字引文
  }>;                            // ≥ 1
}
```

### §M5.2 模型**绝不**提交什么

* **不提交** `evidenceRef` / `fragmentId` / `evidenceId` / `candidateId`；
* **不提交**任何数据库字段、SQL、文件路径；
* **不提交**"审批结果"、`reviewStatus`、`contentKind` 以外的语义标签；
* **不写**任何存储（适配器必须是纯的，见 §M3.4）。

> 理由：ID 由天查**确定性生成**（`materialFragmentIdFor` / `fragmentEvidenceIdFor` / `claimCandidateIdFor`）。让模型给 ID 等于把"来源可核验"交给不可信方。

### §M5.3 服务端校验（`resolveQuotes`，逐条，零容忍）

对每个 `quote` 依次：

| # | 检查 | 不通过 |
|---|---|---|
| V1 | `windowId` 属于**本 `MaterialVersion`** 的窗口集合（否则视为跨材料/伪造） | 整次失败 `QUOTE_OUT_OF_VERSION` |
| V2 | `0 ≤ startInWindow < endInWindow ≤ window.text.length` | 整次失败 `QUOTE_RANGE_INVALID` |
| V3 | `window.text.slice(startInWindow, endInWindow) === quote.text`（**逐字**，规范化文本） | 整次失败 `QUOTE_MISMATCH` |
| V4 | 全局范围落在**连续**段落范围内（可跨段落；但必须连续、且完全落在 `[frag.start, frag.end]` 之内） | 整次失败 `QUOTE_SPANS_DISCONTINUOUS` |
| V5 | 计算结果非空（`end > start`）且长度 ≤ `maxQuoteChars`（默认 500，防"整段引用"当作定位） | 整次失败 `QUOTE_TOO_LONG` |

通过后由服务端**生成**：

* `fragmentId` = 覆盖 `startGlobal` 的段落 Fragment（`materialFragmentIdFor(versionId, {kind:"paragraph", index})`）；
* `normalizedStart/End` = 全局偏移；
* `evidenceId` = `fragmentEvidenceIdFor(versionId, fragmentId, locator, quoteHash)`；
* `quoteHash` = `sha256Hex(quote.text)`；
* `stance` = `"supports"`（v1 固定；模型不得声明 `refutes` / `context`）。

### §M5.4 候选身份（沿用 §C6.7，不新增口径）

`candidateId = claimCandidateIdFor(materialVersionId, blockHash, dimension, extractionConfigKey)`，其中

`blockHash = candidateBlockHash({ dimension, statement, contentKind })`

⇒ **同一句在报告里出现两次**仍是**一个候选**，其 Evidence **合并**（既有 `appendCandidateEvidence`，`merged` 计数）——这一点与 `[CANDIDATE]` 路径**完全一致**。

---

## §M6 运行状态机、超时与"全成或全败"（D-C6-J）

### §M6.1 异步化

```ts
// 变化点（实现轮）：同步 → 异步
interface CandidateExtractor {
  extract(input: ExtractInput): Promise<CandidateDraft[]>;   // ★ was: CandidateDraft[]
}
class CandidateExtractionService {
  async run(version: MaterialVersion, at?: string, opts?: RunOptions): Promise<RunResult>;  // ★ was: RunResult
}
```

* 兼容性：**调用点必须一起改**（CLI / 测试 / Agent 侧若有）；契约要求实现轮先 `grep` 全部调用点再动手。
* `ExplicitBlockExtractor.extract` 变 `async` 但**行为不变**（确定性解析）。

### §M6.2 运行状态

```
running ──► completed      （全部批次返回且全部引用校验通过，落库成功）
   │
   └─────► failed           （任一批次失败 / 任一引用校验失败 / 超时 / 落库异常）
```

* 状态集**沿用** `ExtractionStatus = "running" | "completed" | "failed"`，**不新增**值；
* **超时**必须记为 `failed`（`error` 以 `timeout:` 开头）——**绝不允许**把超时写成 `completed`（用户验收项）；
* `finishedAt` 仅在终态写入；`error` 只写**机器可读前缀 + 简述**（不写模型原始输出全文）。

### §M6.3 全成或全败

1. **先算后写**：所有窗口的适配器调用与**全部**引用校验完成后，才进入写入阶段。
2. **一个主库事务**（`repo.transaction`，嵌套安全）：`insertFragments`（若新窗口需要新 Fragment）+ Evidence + 候选 + `extraction_run.status = completed` 一起提交。
3. 任何一步抛错 ⇒ 事务回滚 ⇒ `extraction_run.status = failed` + `error`（**该写入在事务之外**，因为它必须留下"这次失败过"的记录）。
4. **不发布部分候选**：事务回滚后 `claim_candidate` 对本次运行**零新增**；`extraction_run.candidate_ids_json` 保持 `[]`。

### §M6.4 失败恢复

| 崩溃/失败点 | 恢复语义 |
|---|---|
| 适配器抛错 / 超时 | `failed`；**无候选、无 Evidence 新增**；重跑是全新的运行（新 `extractionId`，同配置 ⇒ 同候选 id） |
| 引用校验失败（任一条） | 同上；`error` 指出是第几个窗口的第几条 quote 与哪一类失败（V1–V5） |
| 事务中途崩溃（进程被杀） | SQLite 事务回滚 ⇒ 与"未开始写入"等价；重跑安全 |
| `extraction_run` 记录了 `running` 却无终态（进程被杀） | 视为**未发布**：候选集合为空；重跑允许；**不得**据此推断"部分成功" |
| 数据库已存在同 id 候选（同配置重跑） | 见 §M8 |

---

## §M7 幂等与"不覆盖"（D-C6-J 后半）

### §M7.1 相同配置重跑

* 候选已存在 ⇒ **insert-only**（既有语义）：**不改** `statement` / `contentKind` / `confidence`，**不改**人工编辑结果（I-C6-5）。
* Evidence 追加规则**收紧**（本次新增）：

| 候选当前状态 | 重跑遇到同一 `candidateId` 时的行为 |
|---|---|
| `draft` | 允许**合并**新 Evidence（既有 `appendCandidateEvidence`，`merged` 计数） |
| `confirmed` / `revised` | **不追加任何 Evidence**，**不改**任何字段 ⇒ 计入 `skippedReviewed`，运行照常 `completed` |
| `rejected` | 同上（**不追加**）——否则"被否决的候选"会被静默复活 |

> 理由（用户裁决原话）："不得悄悄给已审核候选追加新证据"。

### §M7.2 提取结果"变化" ⇒ 新版本

* 口径变化的**唯一**合法途径是**改变 `extractionConfigKey`**（模型 / 提示词 / 解析器 / schema / **分块器** 任一版本变化）⇒ 得到**新的 `candidateId`**（§C6.7），旧候选**原样保留**，新候选带 `supersedesCandidateRef` lineage（既有机制）。
* **禁止**在配置不变的情况下覆盖已审核候选的内容。若确实需要"重新提取同一配置"，只能**新建候选**（明确记为一次新运行），不得原地改。

### §M7.3 运行可审计性

`extraction_run` 必须记录：`model_version` / `prompt_version` / `parser_version` / `schema_version` / **`chunker_version`** / `extraction_config_key` / `started_at` / `finished_at` / `status` / `candidate_ids_json` / `error`。

---

## §M8 下游红线（人工确认前必须指纹不变）

* 一次模型提取运行结束后，**下列表的行数必须与运行前逐项相等**（实现轮用"全状态指纹"断言）：
  `knowledge_belief` · `industry_knowledge` · `knowledge_conflict` · `information_pool_slot` · `information_pool_item` · `research_gap` · `next_action` · `investment_evaluation` · `report_snapshot` · `research_state`。
* 模型提取**只能**写：`fragment`（如需）、`fragment_evidence`、`claim_candidate`、`extraction_run`。
* 候选一律 `draft`，`projectionStatus = "none"`，`decisionRelation` 为空 ⇒ 不满足 I-C6-8，**不可投影**。

---

## §M9 对既有代码的改动清单（实现轮执行；**本文档不实施**）

| # | 改动 | 说明 |
|---|---|---|
| 1 | `CandidateExtractor.extract` → `Promise<CandidateDraft[]>` | D-C6-J；`ExplicitBlockExtractor` 加 `async`（行为不变） |
| 2 | `CandidateExtractionService.run` → `async` | 同上；调用点（CLI / 测试）同步改 |
| 3 | `run()` **单事务收口** | 现有实现是顺序写；改为"先算后写 + 一个事务" |
| 4 | `ExtractionRun` + `extraction_run` 增 **`chunker_version`** | 建表列 + `addColumnIfMissing`（PRAGMA 预检查，同 `superseded_claim_ref` 法）；表数 **32 → 32**（加列不加表） |
| 5 | `extractionConfigKeyFor` 增 `chunkerVersion`（含 `WINDOW_RULE_VERSION` + `maxChars` + `overlapChars`） | 窗口规则进身份 |
| 6 | Evidence 追加**仅限 `draft`** | 已审核候选不追加（§M7.1） |
| 7 | `RunResult` 增 `skippedReviewed` 计数 | 让"跳过已审核"可见而不是静默 |
| 8 | 新增 §M3.2 的四个构件 | `extraction-window.ts` / `model-extraction.ts` |
| 9 | 装配点注入 `ModelExtractionAdapter`（CLI 侧） | Research Core 不 import 模型 SDK |

**不做**：不改 `KnowledgeProjectionService` / `ingestClaims` / 审核闸门 / 投影服务 / 报告；不新增表；不引入模型依赖到 `packages/research`。

---

## §M10 验收（T-C6-29…T-C6-36；实现轮落地）

| 用例 | 必须断言的行为 |
|---|---|
| **T-C6-29 窗口确定性** | 同一 `MaterialVersion` 两次生成窗口 ⇒ **深比较完全相等**；窗口 `text === normalized.slice(start,end)`；覆盖全文；超长段落切分**确有重叠** |
| **T-C6-30 窗口规则进身份** | 改变 `maxChars`/规则版本 ⇒ `extractionConfigKey` **变化** ⇒ 生成**不同** `candidateId`（旧候选原样保留） |
| **T-C6-31 跨段 / 重叠引用** | 一条 quote 跨越两个段落的**连续**范围 ⇒ **通过**（Fragment 取起点所在段落，`quoteHash` 覆盖整段引文）；**不连续**范围 ⇒ 整次失败 |
| **T-C6-32 伪造 / 错位引用 ⇒ 整次失败** | V1（窗口不属于本版本）· V2（越界）· V3（文本与位置不符）各一例 ⇒ 运行 `failed`，`claim_candidate` **零新增**，`extraction_run.candidate_ids_json = []`，`error` 指明失败类别 |
| **T-C6-33 人工确认前下游指纹不变** | 成功运行后，§M8 的十张表行数与运行前**逐项相等**；候选全为 `draft` / `projectionStatus=none` / 无 `decisionRelation` |
| **T-C6-34 超时不误报完成** | 适配器永不 resolve（或超时）⇒ 运行 `failed` + `error` 以 `timeout:` 开头；**不**产生候选；`finishedAt` 有值 |
| **T-C6-35 已审核候选不被重跑改动** | 先把某候选 `confirm`（或 `reject`）⇒ 同配置重跑 ⇒ 该候选 `reviewStatus` / `statement` / `evidenceRefs` **一字不变**，运行 `completed` 且 `skippedReviewed ≥ 1`；`draft` 候选仍可合并 Evidence（`merged` 计入） |
| **T-C6-36 无适配器 ⇒ 明确失败** | 未配置 `ModelExtractionAdapter` 时调用模型提取 ≠ 静默退回 `[CANDIDATE]`；必须**报错**（`ADAPTER_NOT_CONFIGURED`）且**不写任何表** |

**测试纪律（沿用 C6 标准）**：断言**行为与身份**（行数、状态、id、hash、指纹），**不断言文案**；每条正例必须证明"**真的**落库且可追溯"（Evidence → Fragment → 规范化位置）；每条反例必须证明"**零残留**"；并做至少一次 **mutation 反证**（例如把 V3 的逐字比较改成 `startsWith` ⇒ T-C6-32 必须失败）。

---

## §M11 边界、失败恢复与未完成

### §M11.1 诚实的边界（首版）

* 首版**只承诺规范化位置**（`nfkc-lf-v1` 文本中的 `paragraph:<i>` / 全局偏移）；**没有** PDF 页码、没有原始字符位置。
* 因此**任何面向人的输出**（候选展示、报告、Markdown）**必须标注**这一边界（沿用既有 `摘录（规范化 nfkc-lf-v1）` 标注）。
* 模型**可能漏提 / 误提**：本契约只保证"**模型说出来的每一条都有据可查**"，**不保证**召回率；漏提不构成缺陷，须靠**人工审阅**与**人工补充**（`[CANDIDATE]` 路径仍然可用）。

### §M11.2 适配器缺失 / 不可用

* 未配置 ⇒ `ADAPTER_NOT_CONFIGURED`（**明确失败**，不静默降级）。
* 运行时不可用（网络 / 凭据）⇒ 归入 `failed`，`error` 前缀 `adapter:`。
* **绝不**自动切换到 `[CANDIDATE]` 解析 —— 两条路径的产物必须可区分（`extractionConfigKey` 不同 ⇒ 候选 id 不同）。

### §M11.3 原文位置映射（**不阻塞首版**）

* 用户裁决：**"原文位置映射暂时不作为首版模型契约的阻塞项"**。
* 若正式使用要求提供 PDF 页码或原始字符位置 ⇒ **先完成原文切片**（`docs/phaseC/c6-implementation-contract.md` §C6.3 的"规范化位置 → 原文位置"映射），**再把该能力列为生产验收条件**。

### §M11.4 仍未授权

* **模型适配器实现**：**未授权**（本契约定稿后单独授权）。
* 原文切片 · U-1/U-2/U-3 · Wind · 自动发现 · Phase D：**未授权**。

---

## §M12 修订历史

| 版本 | 变更 |
|---|---|
| **rev1** | 首版（DESIGN ONLY）：D-C6-H/I/J 三项裁定落为可执行规则 —— 窗口协议（`para-greedy-v1` + 重叠 + 规则进身份）· 模型输出 schema 与 V1–V5 引用校验 · 异步化与"全成或全败"单事务 · 不覆盖已审核候选 · 验收 T-C6-29…T-C6-36 · 改动清单（含 `chunker_version` 加列） |

**End of contract（rev1: 模型提取器契约，DESIGN ONLY —— 实现未授权）.**
