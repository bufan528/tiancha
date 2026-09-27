# Phase C6 · 模型提取器 Implementation Contract（D-C6-H / D-C6-I / D-C6-J）

> 状态：**rev3 — DESIGN ONLY（实现未授权）**。本文档只锁定语义、边界、失败与恢复规则、验收；**模型适配器的实现须在本契约定稿后单独授权**。rev2 = 第一轮审查的四处补齐（§M2.1）；rev3 = 第二轮审查的收口（窗口覆盖规则拆分 · 同配置**并发互斥** · 运行身份 · **审计配置快照** · 可复现承诺修正，见 §M2.2）。
> 依据：用户 2026-09-27 的三项结构性裁决（§M2）。用户原话要点：**输入按可追溯片段分批**、**模型只提交引用文本与位置且 ID 由天查生成**、**模型调用异步且整次运行全部验证后再落候选**。
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

## §M2 裁定（用户 2026-09-27）

| # | 裁定 | 落到契约 |
|---|---|---|
| **D-C6-H** | **输入按可追溯片段分批**：以已登记的 `MaterialVersion` 为输入，先按段落生成**确定、可复算**的文本窗口（**段落组窗口首尾相接、不重叠**）；过长段落**再**按规范化字符范围切分成切片，**切片之间保留少量重叠**（避免结论在切分处丢上下文）。**窗口规则及三个常量进入提取配置身份**。模型使用 `nfkc-lf-v1` 规范化文本。★ rev3：**首版不承诺"跨段落组边界的整条引文"**（§M4.4） | §M4 |
| **D-C6-I** | **模型提交引用文本和位置，Evidence ID 由天查生成**：模型输出候选陈述 / 维度 / `fact` / `judgment` / 置信度，以及它引用的**输入片段与精确摘录**；**不生成** `evidenceRef` / Fragment ID / Evidence ID，**不写数据库**。天查校验摘录**确实出现在本材料版本对应的规范化片段中**，再生成并保存 Fragment、Evidence 与候选。引用不存在 / 跨材料 / 位置与摘录不符 ⇒ **整次提取失败**，不得留下半份候选。候选一律 `draft`，须人工审核 | §M5、§M6 |
| **D-C6-J** | **模型调用异步；整次运行全部验证后再落候选**：`CandidateExtractor.extract()` 与 `CandidateExtractionService.run()` 明确**改为异步**；运行期间记录**模型 / 提示词 / 分块器 / 解析器 / schema** 版本；首版**整次运行全成或全败**（所有批次返回并通过引用校验后，才在**一个主库事务**里写 Evidence、候选与完成状态）；任何批次失败 ⇒ 运行 `failed`，**不发布部分候选**。相同配置重跑**不得覆盖**人工改过或审核过的候选，**不得悄悄给已审核候选追加新证据**；新增或变化的提取结果必须作为**可审阅的新版本**处理 | §M3、§M6、§M7、§M8 |

### §M2.1 rev2 的四处补齐（第一轮审查意见 —— 逐条核实后**全部成立**）

| 审查发现 | rev2 处理 |
|---|---|
| **M5.3** 的 Fragment 与引文不是同一段文本（`buildFragmentEvidence()` 取整个 `fragment.text` 当引文）；且 `fragmentEvidenceIdFor()` 的第三参数被写成 `locator`（实为 `stance`） | §M5.3 改为**引文即 Fragment**（精确覆盖引文区间的 `char_range`），更正身份参数，并给出"四者一致"的不可协商不变量 |
| **M4** 的"覆盖全文"与 `splitParagraphs()` 的段落边界有缺口（段间 `\n{2,}` 不在任何段落区间内） | §M4.2 规定**分隔符归前一个窗口** ⇒ 窗口首尾相接、**恰好覆盖**全文；§M4.1 明确定义**坐标单位 = UTF-16 code unit**；§M4.3 增加配置约束（`maxChars > 0`、`0 ≤ overlapChars < maxChars`、`overlapChars ≥ maxQuoteChars`）；§M4.4 明确**首版不承诺"跨段落组边界的整条引文"** |
| **配置身份**缺少会改变结果的输入（`dimensionHints` 的来源与方法论版本；`maxQuoteChars`） | §M3.4 的 `ModelBatchInput` 增加 `methodologyVersionId`；§M6 / §M9 要求 `extractionConfigKey` **与运行审计**都包含**分块器 / 方法论版本 / 维度集合 hash / `maxQuoteChars`**，且审计**保留原值**以便还原当时配置（不只有 hash） |
| **M7.2** 对模型重跑的承诺过强（同配置仍可能返回不同候选；候选 id 含陈述 hash ⇒ 可能产生新候选且不一定形成 lineage） | §M7.1 锁定为：**同一材料版本 + 同一配置已有 `completed` 运行 ⇒ 直接复用结果，不再次调用模型**；要重新提取**必须提升配置版本**；影响输出的生成参数必须由适配器编码进 `modelVersion` / `promptVersion` |

**同轮落定的四项判断**（审查意见表）：`maxQuoteChars` 进配置身份（#3 行已含）· `stance` 语义与**审核界面可见性**（§M5.5）· `chunker_version` 加列**且审计保留窗口参数与方法论版本**（§M9 #4）· 超时的**边界与取消方式**（§M6.2a，adapter 必须响应 `AbortSignal`）。

### §M2.2 rev3 的收口（第二轮审查意见 —— 逐条核实后**全部成立**）

| 审查发现 | rev3 处理 |
|---|---|
| **窗口覆盖规则内部冲突**：§M4.2 要求"全部窗口首尾相接、无重叠"，§M4.3 又让超长段落切片重叠，§M4.5 / T-C6-29 同时断言两者 ⇒ 验收**不可能同时通过** | §M4.2 拆成三句规则（段落组窗口首尾相接 / 切片重叠 / **全文按区间并集检查无缺口**）；§M4.5 的不变量改为**按窗口种类分别断言**（I4 并集覆盖、I5 仅段落组、I6 仅切片）；T-C6-29 同步拆分 |
| **同配置的并发请求没有互斥**：M7.1 只规定"已有 `completed` 则复用"，两个同时到达的请求会**都**调模型、**都**写结果 | 新增 **§M7.1a**：以 `(materialVersionId, extractionConfigKey)` 做**原子认领**（`attempt_seq = MAX+1`、`changes() === 1`）+ 租约 + **代际 token fencing**，复用既有 `claimMaterialIngest()`（`research-repository.ts:697-731`）同一思路；未抢到的一方**不得**调模型（复用结果或显式 `in_progress`）。T-C6-37 增**并发**子用例（模型调用恰好 1 次、`completed` 恰好 1 条） |
| **运行 id 的唯一熵源不足**：`startedAt` 同毫秒会撞 id | §M6.2a：运行 id = `extractionRunIdFor(materialVersionId, configKey, **attemptSeq**)`；`started_at` 仅作审计字段、**不参与身份** |
| **审计没有完整保留配置**：§M7.3 字段清单漏方法论版本 / 维度集合 / `maxQuoteChars`；§M9 #4 未保存 `maxChars` / `overlapChars` 与维度提示**实际内容** | §M7.3 升级为**不可变配置快照** `config_snapshot_json`（含 windowRule / quotePolicy / model / methodology（**有序** `dimensionHints`）/ run），运行行补 `attempt_seq` 与认领三列；§M9 #4 同步 |
| **`dimensionHints` 顺序未定**，而 hash 用排序后计算 ⇒ 身份可能与实际输入不一致 | §M3.4：顺序 = **方法论声明的原始顺序**（**不排序**），**按该顺序传给模型**；`dimensionSetHash = sha256Hex(dimensionHints.join("|"))`（**不 sort**）⇒ 传给模型的与进入身份的**逐位一致** |
| **"同版本必须可复现"承诺过强**（外部服务有采样差异 / 服务端更新） | §M7.1 改为：配置身份覆盖**模型部署版本** + 提示词 + 生成参数；**成功运行被复用、不再调用模型**；**失败重试是新尝试**且实际版本写入审计快照；服务商无不可变版本号时**必须记录可获取的部署标识**（§M9 #10） |
| **文档收尾**：§M10 标题仍写 T-C6-29…T-C6-36（下方已有 T-C6-37）· 决策日期写成 `2026-09-28` 而工作区为 `2026-09-27` | §M10 标题改为 **T-C6-29…T-C6-37**；全仓 13 处 `2026-09-28` 已按真实日期改为 **`2026-09-27`**（`Get-Date` 核实） |

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
  /**
   * ★ Async on purpose (D-C6-J). Must not write anything, anywhere.
   * ★ rev2：**必须**响应 `signal` —— "只把运行标成 failed 而请求仍在后台跑"不可接受（审查意见
   *   成立）。适配器收到 abort 后必须终止在途工作。
   */
  extractBatch(input: ModelBatchInput, signal: AbortSignal): Promise<ModelBatchResult>;
}

export interface ModelBatchInput {
  materialVersionId: string;
  window: { windowId: string; index: number; text: string };  // 规范化文本，仅此窗口
  /** 供模型自我定位；模型可忽略，但不得伪造（伪造即为无效引用，§M6）。 */
  windowStartInVersion: number;
  /**
   * ★ rev2：只来自**当前激活方法论**的维度 key（避免模型自造维度）。其**来源**在此写死：
   * 调用方从 `MethodologyService.getActive().dimensions` 读取，并把 `methodologyVersionId` 与
   * 该维度**有序列表**的 hash 一并传入（§M9）—— 否则"同一配置"可能对应不同维度集合，配置身份
   * 失真（审查意见成立）。
   *
   * ★ rev3（审查意见）：**顺序必须唯一确定** —— 取**方法论声明的原始顺序**（`active.dimensions`
   * 的声明序，**不排序**），并**按该顺序传给模型**；`dimensionSetHash` 对**同一有序列表**计算
   * （`sha256Hex(keys.join("|"))`，**不 sort**）。于是"传给模型的东西"与"进入身份的东西"
   * **逐位一致**；顺序变化 ⇒ hash 变化 ⇒ 视为**新配置**（合理：模型的维度提示确实变了）。
   */
  dimensionHints: string[];
  /** 产生 `dimensionHints` 的方法论版本 id；进入运行审计与 `extractionConfigKey`。 */
  methodologyVersionId: string;
}
```

**契约要求**：适配器**只读**、**只返回数据**；Research Core 不 import 任何模型 SDK；装配点（composition root，`src/cli/tiancha.ts`）负责把具体实现注入。**适配器缺失/未配置 ⇒ 明确失败**（不是静默退回 `[CANDIDATE]`，见 §M11.2）。

---

## §M4 窗口协议（D-C6-H）

### §M4.1 输入文本与坐标单位

* 唯一输入是 **`normalizeText(version.rawText)`**（`nfkc-lf-v1` 之后的文本）。
* **坐标单位 = UTF-16 code unit**（等价于 `String.prototype.length` 与 `slice` 的语义）—— `start` / `end` / `maxChars` / `overlapChars` / `maxQuoteChars` **全部**是该单位，**不是字节、不是 Unicode 码点**。
* 窗口**不落库**（纯派生、可复算），但**窗口规则版本 + 三个常量进入 `extractionConfigKey`**（§M9）。

### §M4.2 段落与分隔符归属（修正 rev1 的覆盖缺口）

`splitParagraphs()` 返回段落区间 `[start, end)`，其中 `end` **不含**段落之间的 `\n{2,}` 分隔符（`material-source.ts:84-97`：`end: m.index`，下一段 `start = m.index + m[0].length`）。因此**不能**用"首段 start … 末段 end"表示窗口 —— 那样相邻窗口之间会漏掉分隔符，却仍宣称覆盖全文。

**窗口区间按"分隔符归前一个窗口"定义**：

```
普通窗口: [首段.start, 下一个段落的.start)      // 把段间分隔符并入前一个窗口
末窗口  : [首段.start, normalized.length)      // 吞掉尾部
```

* **段落组窗口之间首尾相接、不重叠**：`window[i].end === window[i + 1].start`。
* **超长段落切片之间按规则重叠** `overlapChars`（§M4.3 第 3 步）—— 它们**不是**首尾相接。
* **全文覆盖按"区间并集"检查**：所有窗口区间的并集必须**恰好等于** `[0, normalized.length)`，即从 0 到全文长度**没有任何缺口**；**允许**超长段落切片之间的重叠（重复覆盖不算缺口）。
* `window.text === normalized.slice(start, end)`（**含**尾部分隔符）。
* 模型**不被要求**引用分隔符。引文若落在分隔符上，V3 仍可能通过（文本一致），但这类引用没有信息价值 —— 由**人工审阅**发现（§M11.1 的诚实边界），契约不额外禁止。

### §M4.3 切分算法（`WINDOW_RULE_VERSION = "para-greedy-v1"`）

```
1) paragraphs := splitParagraphs(normalized)
2) 贪心合并相邻段落，直到加入下一段会超过 maxChars ⇒ 一个"段落组窗口"（区间按 §M4.2 取）
3) 若某段落自身长度 > maxChars ⇒ 该段落**单独**按 char_range 切分：
     step = maxChars - overlapChars
     以 step 步长推进直到覆盖该段落末尾（最后一片可短于 maxChars）
     ⇒ 相邻片共享 overlapChars 个字符
4) 窗口按 start 升序编号 index = 0,1,2,…
```

**首版默认值**：`maxChars = 2000` · `overlapChars = 600` · `maxQuoteChars = 500`（三者皆为 UTF-16 code unit，且**全部进 `extractionConfigKey`**；§M9 #5）。`overlapChars` 取 **600 > `maxQuoteChars` = 500**，正是为了满足下面的第三条约束 —— 超长段落切分处的引文仍能在相邻片内**完整**出现。

> **成本提示（rev3 补，审查意见）**：`overlapChars` 只作用于**超长段落**，但它越大，那类段落的窗口调用量越高 —— 600 相对 500 约 **+43%**。若只求满足契约约束，`500` 已经够；取 `600` 是为留一点余量。**该值属配置身份**，改动会使已有候选需要按新配置重新提取（§M7.1）。

**配置约束（不满足即拒绝该配置并抛错，不静默钳制）**：

| 约束 | 理由 |
|---|---|
| `maxChars > 0` | 否则窗口为空 |
| `0 ≤ overlapChars < maxChars` | 否则 `step ≤ 0`，切分不前进 |
| **`overlapChars ≥ maxQuoteChars`** | 保证**超长段落切分处**的引文仍能在相邻片内**完整**出现 |

**确定性**：只依赖 `normalized` 与规则常量，**不含**时间戳 / 随机数 / 模型输出。**可复算**：同一 `MaterialVersion` 任意次数调用得到**完全相同**的窗口数组。

### §M4.4 首版明确边界：不承诺"跨段落组边界的整条引文"

* 段落组窗口之间**不重叠**（段落边界天然是断点）。
* ⇒ 首版**不承诺**"一条引文跨越两个段落组窗口边界"仍能被完整引用。若结论确实跨窗口，模型应**分别**在各自窗口内给出引文 —— 这本来就是"一个候选引用多处来源"的既有能力（§C6.7 / T-C6-12）。
* 超长段落切分处**有重叠**（`overlapChars`），故**那类**边界上的引文可以在相邻片内完整出现。
* 首版**不**把重叠提到"段落组之间也重叠"——那会让窗口重叠、重复计费，并与"段落组窗口首尾相接"的可验证性冲突。将来若需要，作为**新的 `WINDOW_RULE_VERSION`** 处理（配置身份随之改变）。
* ★ rev3：**§M2 的 D-C6-H 摘要已同步改写**，不再使用"窗口间保留少量重叠"这一容易被读成"段落组窗口也重叠"的表述（审查意见成立）。

### §M4.5 窗口形状

```ts
interface ExtractionWindow {
  windowId: string;      // deterministicId("win", `${materialVersionId}|${WINDOW_RULE_VERSION}|${maxChars}|${overlapChars}|${start}|${end}`)
  index: number;         // 0-based, 升序
  start: number;         // UTF-16 code unit，闭
  end: number;           // UTF-16 code unit，开
  text: string;          // === normalized.slice(start, end)
  paragraphIndexes: number[];   // 覆盖的段落 index（切分出的片为单段）
  splitOfParagraph?: number;    // 若本窗口由超长段落切分而来 ⇒ 该段落 index
}
```

**不变量（实现轮逐条断言；★ rev3 修正为可同时成立的版本）**：

| # | 不变量 | 适用范围 |
|---|---|---|
| I1 | `text === normalized.slice(start, end)` | 全部窗口 |
| I2 | `index` 连续、从 0 开始 | 全部窗口 |
| I3 | `window[0].start === 0` | 全部窗口 |
| I4 | **区间并集 = `[0, normalized.length)`，无缺口** | 全部窗口 |
| I5 | `window[i].end === window[i + 1].start`（首尾相接、**不重叠**） | **仅段落组窗口之间** |
| I6 | 相邻切片共享 `overlapChars` 个字符（**允许重叠**） | **仅同一超长段落的切片之间** |
| I7 | 末窗口的 `end === normalized.length` | 全部窗口（末窗口吞掉尾部） |

rev2 把 I5 与 I6 写成"对全部窗口成立"，**自相矛盾**（审查意见成立）；rev3 按窗口**种类**分别断言，T-C6-29 同此拆分。

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
| V1 | `windowId` 属于**本 `MaterialVersion`** 的窗口集合（否则视为跨材料 / 伪造） | 整次失败 `QUOTE_OUT_OF_VERSION` |
| V2 | `startInWindow` / `endInWindow` 为整数，且 `0 ≤ startInWindow < endInWindow ≤ window.text.length` | 整次失败 `QUOTE_RANGE_INVALID` |
| V3 | `window.text.slice(startInWindow, endInWindow) === quote.text`（**逐字**，规范化文本） | 整次失败 `QUOTE_MISMATCH` |
| V4 | 长度 `endGlobal - startGlobal ≤ maxQuoteChars`（默认 `500`） | 整次失败 `QUOTE_TOO_LONG` |

> **rev2 更正**：rev1 的 V4（"必须落在连续段落范围内"）**已删除** —— 单个 `[start, end)` 区间**天然连续**，该检查既无法表达也无法失败（审查意见成立）；它想防的"跨不连续片段"由 V2 + V3 完全覆盖。原 V5 重编号为 V4，并**补上验收**（T-C6-32 内加 V4 反例）。
> `maxQuoteChars` 会改变"哪些输出能通过校验"，因此**计入配置身份与运行审计**（§M6、§M9）。

通过后由服务端**生成**（模型不得给出任何 id）：

| 产物 | 生成规则 |
|---|---|
| `startGlobal` / `endGlobal` | `window.start + startInWindow` / `window.start + endInWindow`（UTF-16 code unit） |
| **`fragmentLocator`** | **★ `{ kind: "char_range", start: startGlobal, end: endGlobal }`** —— 每条引文生成一个**精确覆盖该区间**的 Fragment |
| `fragmentId` | `materialFragmentIdFor(versionId, fragmentLocator)` |
| Fragment 文本 | `buildMaterialFragment(version, locator, at)` 产出，其 `text === normalized.slice(startGlobal, endGlobal)` ⇒ **就是那条逐字引文**；其 `textHash === sha256Hex(它的 text)` |
| `quoteHash` | `sha256Hex(quote.text)` |
| **`evidenceId`** | `fragmentEvidenceIdFor(versionId, fragmentId, "supports", quoteHash)` —— **第三参数是 `stance`，不是 `locator`**（`material-source.ts:205-212`）；rev1 此处写错，rev2 更正 |
| 落地方式 | `buildFragmentEvidence(version, fragment, "supports", at)`（**沿用既有构造函数**，它要求 `fragment.materialVersionId === version.materialVersionId`，并把 `fragment.text` 作为 `quoteText`） |
| `stance` | `"supports"`（v1 固定；模型不得声明 `refutes` / `context`） |

**★ 四者一致（不可协商的不变量）**：因为 Fragment 由**引文自己的区间**生成，而 `buildFragmentEvidence()` 取 `fragment.text` 作为 `quoteText` 并据此算 `quoteHash`（`material-source.ts:280,289`）⇒ 必然满足

```
fragment.text === evidence.quoteText === quote.text
sha256Hex(quote.text) === evidence.quoteHash === fragment.textHash
```

rev1 把"引文起点所在的整段"当 Fragment，与"引文可达 500 字符"**不可能**同时成立（审查意见成立）；rev2 改为**引文即 Fragment**。T-C6-31 断言上述四者（外加"解析回材料原文"）。

**并存说明**：同一材料既有**版本注册时按段落生成**的 Fragment（`MaterialVersionService.registerVersion`），也有本次为引文生成的 **`char_range` Fragment** —— 两者都是 `fragment` 行，定位键不同（`locatorKey` 不同 ⇒ `fragmentId` 不同），互不覆盖。

### §M5.4 候选身份（沿用 §C6.7，不新增口径）

`candidateId = claimCandidateIdFor(materialVersionId, blockHash, dimension, extractionConfigKey)`，其中

`blockHash = candidateBlockHash({ dimension, statement, contentKind })`

⇒ **同一句在报告里出现两次**仍是**一个候选**，其 Evidence **合并**（既有 `appendCandidateEvidence`，`merged` 计数）——这一点与 `[CANDIDATE]` 路径**完全一致**。

### §M5.5 `stance` 的含义与可见性（rev2 按审查意见补清）

* v1 的 `stance` 固定为 `"supports"`，含义是"**这条 draft 候选声称**该引文支持它"——**不是**人工确认过的支持关系，也**不会**因此进入 Knowledge / Pool / Evaluation。
* 该关系**只能随候选留在审核层**：它存在于 `fragment_evidence.stance` 与候选的 evidence 列表上；**在人工确认（`candidate confirm`）之前，任何下游投影都看不到它**（§M8 的指纹不变即为证明）。
* **审核界面必须能看到它**（审查意见要求）：`candidate show` 的每条来源除 `evidenceRef` / `locator` / `excerpt` 外，**还要显示 `stance`**（`supports`），让人能自行判断"模型声称这句支持它"是否成立。⇒ 属实现轮的展示改动，记入 §M9 #12。

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
* **超时**必须记为 `failed`（`error` 以 `timeout:` 开头）——**绝不允许**把超时写成 `completed`（验收项）；
* `finishedAt` 仅在终态写入；`error` 只写**机器可读前缀 + 简述**（不写模型原始输出全文）。

#### §M6.2a 超时边界与取消（rev2 补清）

| 项 | 规则 |
|---|---|
| 超时参数 | `run(version, at, { timeoutMs })` 显式传入；**默认 `120_000`**；要求 `timeoutMs > 0`，否则**拒绝该配置并抛错** |
| 计时范围 | **整个运行**（`started_at` → 最后一个批次返回），**不是**"每批各算一次" |
| 取消方式 | 运行持有一个 `AbortController`：超时触发 `abort()`；`signal` **逐批**传给 `adapter.extractBatch(input, signal)` |
| 适配器义务 | 收到 abort ⇒ **终止在途请求**并尽快 reject；**不得**忽略 signal 把请求跑完 |
| 本契约能保证与不能保证 | 不能保证第三方 SDK 真的切断底层连接；**能**保证：本系统**不再 await 它**、**不使用其结果**、**不写任何表**、**记 `failed` + `timeout:` 前缀**。残留请求**零副作用**（适配器是纯的，§M3.4） |
| 运行身份（★ rev3 修正） | `extractionConfigKey` **不含时间戳**（否则重跑永远算"新配置"，§M7.1 的复用就不成立）—— 这条不变。但 **`startedAt` 不能单独充当运行 id 的唯一熵源**：同一毫秒启动的两个请求会算出**同一个 id**（审查意见成立）。<br>⇒ 运行 id = `extractionRunIdFor(materialVersionId, extractionConfigKey, attemptSeq)`，其中 **`attemptSeq`** 在**认领**时于同一事务内取 `MAX(attempt_seq) + 1`（§M7.1a）；`started_at` **作为审计字段保留**，**不参与身份**。 |

### §M6.3 全成或全败

1. **先算后写**：所有窗口的适配器调用与**全部**引用校验完成后，才进入写入阶段。
2. **一个主库事务**（`repo.transaction`，嵌套安全）：`insertFragments`（若新窗口需要新 Fragment）+ Evidence + 候选 + `extraction_run.status = completed` 一起提交。
3. 任何一步抛错 ⇒ 事务回滚 ⇒ `extraction_run.status = failed` + `error`（**该写入在事务之外**，因为它必须留下"这次失败过"的记录）。
4. **不发布部分候选**：事务回滚后 `claim_candidate` 对本次运行**零新增**；`extraction_run.candidate_ids_json` 保持 `[]`。

### §M6.4 失败恢复

| 崩溃/失败点 | 恢复语义 |
|---|---|
| 适配器抛错 / 超时 | `failed`；**无候选、无 Evidence 新增**；重跑是全新的运行（新 `extractionId`，同配置 ⇒ 同候选 id） |
| 引用校验失败（任一条） | 同上；`error` 指出是第几个窗口的第几条 quote 与哪一类失败（V1–V4） |
| 事务中途崩溃（进程被杀） | SQLite 事务回滚 ⇒ 与"未开始写入"等价；重跑安全 |
| `extraction_run` 记录了 `running` 却无终态（进程被杀） | 视为**未发布**：候选集合为空；重跑允许；**不得**据此推断"部分成功" |
| 数据库已存在同 id 候选（同配置重跑） | 见 §M8 |

---

## §M7 幂等与"不覆盖"（D-C6-J 后半）

### §M7.1 相同配置重跑：**已有成功运行则直接复用（不再次调用模型）**

**rev2 更正**：rev1 断言"输出变化只能由配置变化导致"，这是**过强**的承诺 —— 相同模型 + 相同提示词 + 相同配置再次调用，仍可能返回**不同**候选；而候选 id 含 `statement` 的 `blockHash`，于是"同一配置"可能产生**新的** `candidateId`，且**不一定**形成 lineage（审查意见成立）。

**rev2 锁定为**（rev3 按审查意见补正措辞）：

* 对 `(materialVersionId, extractionConfigKey)` **已有 `completed` 运行**的请求 ⇒ **直接复用已完成结果**：
  * **不再次调用** `ModelExtractionAdapter`；
  * 返回既有 `candidateIds` + `status = "completed"` + **`reused = true`**；
  * **不写任何表**（零副作用）。
* **要重新提取，必须提升配置版本**（新 `extractionConfigKey` ⇒ 新候选 + `supersedesCandidateRef` lineage，§C6.7 既有机制）。
* ⇒ 本系统**不承认**"同配置的第二次模型调用"这一概念 —— 从根上消掉"静默引入随机新结果"。
* ★ **rev3：不再承诺"同一版本号必须可复现"**（审查意见成立 —— 外部模型服务存在采样差异或服务端更新，本系统**无法保证**逐次输出一致）。改为承诺：
  * 配置身份**覆盖**：模型**部署版本** / 提示词 / 解析器 / schema / 分块器（规则 + 三个常量）/ 方法论版本 / 维度**有序列表** / `maxQuoteChars`；
  * **成功运行被复用，绝不再次调用模型**（上面第一条）；
  * **失败后的重试是一次新的运行尝试**（新 `attemptSeq`），其**实际**模型版本与请求配置**写入审计**（§M7.3 的配置快照）；
  * 若服务商**不能提供不可变模型版本** ⇒ 适配器**必须**把可获取的**部署标识**（`deploymentId` / `snapshotDate` / 响应里的 model 字段等）编码进 `modelVersion`，并在实现注记里写明该标识的**来源与稳定性边界**；**不得**把一个会静默漂移的名字当版本号。
  * ⇒ 本契约保证的是"**同配置只调用一次、结果可复用地记录在审计里**"，**不是**"同配置跨时间逐次输出一致"。

### §M7.1a 同配置的**并发**请求必须有互斥（rev3 新增，审查意见）

rev2 只规定"已有 `completed` 则复用" —— 两个**同时**到达的同配置请求可能**都**没看到 `completed`，于是**都**调用模型并**都**写出结果（审查意见成立）。

**规则**（复用本项目已有原语 `ResearchRepository.claimMaterialIngest()` 的**同一思路**：一条**原子 UPDATE** + 租约 + 代际 token，见 `research-repository.ts:697-731`）：

| 步骤 | 规则 |
|---|---|
| 认领 | 以 `(materialVersionId, extractionConfigKey)` 为键**原子**写认领：`status = 'running'` + `owner` + `lease_until` + **`attempt_seq = MAX(attempt_seq) + 1`**；该语句必须**恰好生效一次**（`changes() === 1`） |
| 未抢到的一方 | **不得**调用模型。两种允许语义（**必须显式**，不得静默重复调用）：<br>① 已有 `completed` ⇒ 走 §M7.1 复用；<br>② 否则返回明确的 **`in_progress`**（含 `owner` / `lease_until` / `attemptSeq`），或**等待**该运行结束后复用其结果（由 CLI 选择，契约两种都允许） |
| 租约过期 | 认领方崩溃 ⇒ 租约到期后另一请求可**重新认领**（新 `attemptSeq`）；被抢方即使仍在跑，其写入**必须**带**代际 token** 校验而失败（fencing，同 `claimMaterialIngest`） |
| 结果 | 同一 `(materialVersionId, extractionConfigKey)` 在任意并发下：**模型调用恰好一次**、**`completed` 运行恰好一条** |

**候选层面的不覆盖**（既有语义 + 本次收紧）：

| 候选当前状态 | 行为 |
|---|---|
| `draft` | 允许**合并**新 Evidence（既有 `appendCandidateEvidence`，`merged` 计数） |
| `confirmed` / `revised` | **不追加任何 Evidence**、**不改**任何字段 ⇒ 计入 `skippedReviewed` |
| `rejected` | 同上（**不追加**）——否则"被否决的候选"会被静默复活 |

> 理由（用户裁决原话）："不得悄悄给已审核候选追加新证据"。
> 注：该表只约束**一次运行的候选写入阶段**（§M6.3 单事务）遇到**已存在同 id 候选**时的行为（例如人工先建了候选、或上一轮运行留下过同名候选）。它**不是**"重跑再调模型"的通道 —— 后者已被本节第一段的复用规则关闭。

### §M7.2 结果"变化" ⇒ 新配置 / 新版本

* 口径变化的**唯一**合法途径是**改变 `extractionConfigKey`**（模型 / 提示词 / 解析器 / schema / **分块器** / **引文长度上限** / **方法论维度集合** 任一变化）⇒ 得到**新的 `candidateId`**，旧候选**原样保留**，新候选带 `supersedesCandidateRef`（既有机制）。
* **禁止**在配置不变的情况下覆盖任何候选的内容。
* **禁止**在配置不变的情况下"再抽一次看看" —— 见 §M7.1。

### §M7.3 运行可审计性（★ rev3：从"字段清单"升级为**不可变配置快照**）

审查意见：§M2.1 承诺审计保留配置原值，但字段清单**漏了**方法论版本、维度集合、`maxQuoteChars`；§M9 #4 也没保存 `maxChars` / `overlapChars` 与维度提示的**实际内容**。rev3 改为：

**① 运行行（`extraction_run`）必记字段**：

`extraction_id` · `material_version_id` · **`attempt_seq`** · `extraction_config_key`（身份，含全部配置维度的 hash）· `model_version` · `prompt_version` · `parser_version` · `schema_version` · **`chunker_version`** · **`methodology_version_id`** · **`dimension_set_hash`** · **`max_quote_chars`** · `started_at` · `finished_at` · `status` · `candidate_ids_json` · `error` · **`config_snapshot_json`** · `owner` · `lease_until` · `generation`（后三项服务 §M7.1a 的认领与 fencing）

**② 不可变配置快照（`config_snapshot_json`）** —— 必须足以**逐字还原模型实际收到的配置**：

```ts
interface ExtractionConfigSnapshot {
  windowRule: { version: string; maxChars: number; overlapChars: number; overlapAppliesTo: "long-paragraph-slices-only" };
  quotePolicy: { maxQuoteChars: number; allowedStances: ["supports"] };
  model: { modelVersion: string; promptVersion: string; parserVersion: string; schemaVersion: string };
  methodology: { methodologyVersionId: string; dimensionHints: string[] };  // ★ 有序，与传给模型的一致
  run: { timeoutMs: number; batchCount: number };                           // batchCount = 窗口数
}
```

* 快照在运行时**写入一次、此后不可变**；运行重试 = 新 `attemptSeq` = **新快照**（§M7.1a）。
* `dimensionHints` 在快照里**保留实际顺序**（§M3.4）；`dimension_set_hash` 只是其派生值，**不替代**它。
* 由此，任何一次历史运行都能回答"当时模型**到底**收到了什么"，而不是只有"当时的 hash 是多少"。

---

## §M8 下游红线（人工确认前必须指纹不变）

* 一次模型提取运行结束后，**下游状态必须与运行前完全一致**。记录方式（rev2 按审查意见收紧为**完整下游状态指纹**，不是"只比行数"）：
  * 对下列每张表读取**全部行**（`SELECT * FROM <t>`），**列按列名升序**、**行按主键（无主键则 `rowid`）升序**，逐行 JSON 序列化后拼接，取 `sha256Hex`；
  * 运行前后，**每张表的指纹**必须**逐项相等**（只要有一列值变化即失败）；
  * 只比行数会漏掉"行数不变但内容被改写"的情形，故**不采用**仅计数。
* 表清单：`knowledge_belief` · `industry_knowledge` · `knowledge_conflict` · `information_pool_slot` · `information_pool_item` · `research_gap` · `next_action` · `investment_evaluation` · `report_snapshot` · `research_state`。
* 模型提取**只能**写：`fragment`（如需）、`fragment_evidence`、`claim_candidate`、`extraction_run`。
* 候选一律 `draft`，`projectionStatus = "none"`，`decisionRelation` 为空 ⇒ 不满足 I-C6-8，**不可投影**。

---

## §M9 对既有代码的改动清单（实现轮执行；**本文档不实施**）

| # | 改动 | 说明 |
|---|---|---|
| 1 | `CandidateExtractor.extract` → `Promise<CandidateDraft[]>` | D-C6-J；`ExplicitBlockExtractor` 加 `async`（行为不变） |
| 2 | `CandidateExtractionService.run` → `async` + 接受 `{ timeoutMs }` | 同上；超时与取消见 §M6.2a |
| 3 | `run()` **单事务收口** | 改为"先算后写 + 一个事务"；失败记录写在事务之外（§M6.3） |
| 4 | `ExtractionRun` + `extraction_run` 增**审计与认领列**：`chunker_version` · `methodology_version_id` · `dimension_set_hash` · `max_quote_chars` · **`attempt_seq`** · **`config_snapshot_json`** · **`owner`** · **`lease_until`** · **`generation`** | 建表列 + `addColumnIfMissing`（PRAGMA 预检查，同 `superseded_claim_ref` 法）；**表数仍 32**（加列不加表）。★ 按审查意见：审计要能**逐字还原当时配置**（§M7.3 快照）；后四列服务 §M7.1a 的并发互斥与运行身份 |
| 5 | `extractionConfigKeyFor` 增 **`chunkerVersion`**（含 `WINDOW_RULE_VERSION` + `maxChars` + `overlapChars`）· **`methodologyVersionId`** · **`dimensionSetHash`** · **`maxQuoteChars`** | 这些**都会改变哪些输出被产出 / 被接受** ⇒ 必须进身份（审查意见成立）。`dimensionSetHash = sha256Hex(dimensionHints.join("|"))`，其中 `dimensionHints` 取**方法论声明的原始顺序**（**不 sort**，§M3.4），与传给模型的有序列表**逐位一致** |
| 6 | Evidence 追加**仅限 `draft`** | §M7.1 |
| 7 | `RunResult` 增 **`reused`**（§M7.1 复用）、**`skippedReviewed`**（§M7.1 表）与 **`in_progress`**（§M7.1a 未抢到认领时） | 让"复用 / 跳过已审核 / 正在跑"**可见**而非静默 |
| 8 | 新增 §M3.2 的四个构件 | `extraction-window.ts` / `model-extraction.ts` |
| 9 | 装配点注入 `ModelExtractionAdapter` + `AbortController` | CLI 侧；Research Core 不 import 任何模型 SDK |
| 10 | 适配器**必须**把影响输出的东西编码进版本号：**生成参数**（温度 / topP / seed / 工具开关…）进 `promptVersion`；**模型部署版本**（服务商的不可变标识，或可获取的 `deploymentId` / `snapshotDate`）进 `modelVersion`；并**把该标识的来源与稳定性边界写进实现注记** | §M7.1（rev3 修正后）**不再**承诺"同版本逐次输出一致"，但要求：**同配置只调用一次 + 结果被复用 + 实际版本写入审计**（§M7.3 快照）。**不得**用会静默漂移的名字当版本号 |
| 11 | **实现前先枚举 `extract()` / `run()` 的全部调用点**（CLI / Agent / 全部测试）并逐一 `await` | 契约不代列清单，实现轮用 `grep` 产出并写进交付说明（审查意见要求） |
| 12 | `candidate show` / 报告行在每条来源上显示 **`stance`** | §M5.5：审核界面必须能看到"模型声称此引文支持该候选"这一**未确认**关系 |

**不做**：不改 `KnowledgeProjectionService` / `ingestClaims` / 审核闸门 / 投影服务 / 报告；不新增表；不引入模型依赖到 `packages/research`。

---

## §M10 验收（T-C6-29…T-C6-37；实现轮落地）

| 用例 | 必须断言的行为 |
|---|---|
| **T-C6-29 窗口确定性与覆盖（★ rev3 拆为三种情况）** | 两次生成**深比较完全相等**；**I1** `text === normalized.slice(start,end)`；**I2** `index` 连续；**I3** 首个窗口 `start === 0`；**I4 区间并集 = `[0, normalized.length)`（全文无缺口；允许切片重叠）**；**I5 仅段落组窗口之间** `end === 下一个 start`（不重叠）；**I6 仅同一超长段落的切片之间**共享 `overlapChars`；**I7** 末窗口 `end === normalized.length` |
| **T-C6-30 窗口 / 引文规则进身份** | 分别改变 `maxChars` / `overlapChars` / `WINDOW_RULE_VERSION` / **`maxQuoteChars`** / **方法论维度集合** ⇒ `extractionConfigKey` **变化** ⇒ 生成**不同** `candidateId`（旧候选原样保留） |
| **T-C6-31 引文即 Fragment（四者一致）** | 一条引文（含**跨段落但连续**的引文）⇒ 断言 `fragment.text === evidence.quoteText === quote.text` 且 `sha256Hex(quote.text) === evidence.quoteHash === fragment.textHash`；`fragment.locator` 是**精确覆盖该区间的 `char_range`**；并经 `resolveLocator(normalized, fragment.locator)` **解析回材料原文**得到同一段文本 |
| **T-C6-32 引用不成立 ⇒ 整次失败（V1–V4 各一例）** | V1 窗口不属于本版本 · V2 区间越界/倒置 · **V3 文本与位置不符** · **V4 长度超过 `maxQuoteChars`** ⇒ 运行 `failed`；`claim_candidate` **零新增**；`extraction_run.candidate_ids_json = []`；`error` 指明失败类别与第几个窗口 / 第几条 quote |
| **T-C6-33 人工确认前下游指纹不变（完整指纹）** | 成功运行后，§M8 十张表的**完整内容指纹**与运行前**逐项相等**（**不是**只比行数）；候选全为 `draft` / `projectionStatus = "none"` / 无 `decisionRelation` |
| **T-C6-34 超时 / 取消不误报完成** | 适配器**永不 resolve** ⇒ 运行 `failed` + `error` 以 `timeout:` 开头；**零候选**；`finishedAt` 有值；**且**断言适配器**收到了 abort**（其 promise 在 `signal` 触发后以 `AbortError` 结束），证明不是"只把状态改成失败" |
| **T-C6-35 已审核候选不被改动** | 先 `confirm` / `reject` 某候选 ⇒ **候选写入阶段**遇到同 id ⇒ 该候选 `reviewStatus` / `statement` / `evidenceRefs` **一字不变**，并计入 `skippedReviewed`；`draft` 候选仍可合并 Evidence（`merged` 计入） |
| **T-C6-36 无适配器 ⇒ 明确失败** | 未配置 `ModelExtractionAdapter` ⇒ **报错** `ADAPTER_NOT_CONFIGURED`；**不静默退回** `[CANDIDATE]`；**不写任何表** |
| **T-C6-37 已有成功运行 ⇒ 复用而不重调模型**（★ rev3 加**并发**） | **串行**：同 `(materialVersionId, extractionConfigKey)` 第二次调用 ⇒ 既有 `candidateIds` + `reused = true` + `completed`；**适配器调用次数仍为 1**；**不写任何表**（指纹不变）；适配器**故意不可用**时也不受影响。<br>**并发**：两个同配置请求**同时**发起 ⇒ 计数适配器断言**模型调用恰好 1 次**、**`completed` 运行恰好 1 条**；未抢到认领的一方拿到**复用结果**或显式 **`in_progress`**（**不得**出现第二次模型调用）；租约过期后可重新认领（新 `attemptSeq`），被抢方的写入因**代际 token** 校验而失败（§M7.1a） |

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
| **rev3** | **第二轮审查意见的收口**（§M2.2，逐条核实后全部成立）：① **窗口覆盖规则拆分**（段落组窗口首尾相接 / 超长段落切片重叠 / 全文按**区间并集**检查无缺口；§M4.2、§M4.5 的 I4–I6 按窗口种类分别断言、T-C6-29 同步）—— rev2 把"不重叠"与"重叠"同时写为对全部窗口成立，**自相矛盾**；② **同配置并发互斥**：§M7.1a 原子认领（`attempt_seq = MAX+1`、`changes() === 1`）+ 租约 + 代际 token fencing（复用 `claimMaterialIngest` 思路），未抢到者不得调模型；T-C6-37 增并发子用例；③ **运行身份**改用 `attemptSeq`（`startedAt` 只作审计字段）；④ **审计升级为不可变配置快照** `config_snapshot_json`（含有序 `dimensionHints`）+ 运行行补 `attempt_seq` 与认领三列；⑤ **`dimensionHints` 顺序**定为方法论声明序（不排序），`dimensionSetHash` 对**同一有序列表**计算；⑥ **删除"同版本必须可复现"**的过强承诺，改为"同配置只调用一次 + 结果复用 + 实际版本写入审计"，服务商无不稳定标识时须记录部署标识；⑦ 文档收尾：§M10 标题改 T-C6-29…T-C6-37、全仓日期按真实值改为 `2026-09-27` |
| **rev2** | **第一轮审查意见的四处补齐**（§M2.1）：① **引文即 Fragment**（精确 `char_range`）+ 更正 `fragmentEvidenceIdFor` 的 `stance` 参数 + "四者一致"不变量；② **分隔符归前一窗口** ⇒ 窗口覆盖全文；明确**坐标单位 = UTF-16 code unit**；补配置约束；明确**首版不承诺跨段落组边界的整条引文**；③ **配置身份与运行审计**补入分块器 / **方法论版本** / **维度集合 hash** / **`maxQuoteChars`**，审计保留原值；④ **重跑语义收紧**为"已有成功运行 ⇒ 复用，不再调用模型"。另：`stance` 的语义与**审核界面可见性**（§M5.5）· 超时的**边界与取消**（`AbortSignal`，§M6.2a）· 删除无法失败的"不连续"检查并补 V4（长度上限）验收 · T-C6-33 改为**完整下游状态指纹** · 新增 T-C6-37 |
| **rev1** | 首版（DESIGN ONLY）：D-C6-H/I/J 三项裁定落为可执行规则 —— 窗口协议（`para-greedy-v1` + 重叠 + 规则进身份）· 模型输出 schema 与 V1–V5 引用校验 · 异步化与"全成或全败"单事务 · 不覆盖已审核候选 · 验收 T-C6-29…T-C6-36 · 改动清单（含 `chunker_version` 加列） |

**End of contract（rev3: 模型提取器契约，DESIGN ONLY —— 实现未授权）.**
