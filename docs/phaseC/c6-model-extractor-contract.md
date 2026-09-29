# Phase C6 · 模型提取器 Implementation Contract（D-C6-H / D-C6-I / D-C6-J）

> 状态：**rev13 — Slice F2 实施契约（§M14 新增；纯文档，未实现）**。**rev11 的四条收紧语义、§M13.7 测试矩阵、以及 rev12 的 F 状态校准全部保留、未改一字**；rev13 只**新增 §M14**，把 §M13.5 的 F2 清单六项落成可执行条文（生产装配点 / 模型路径入口 / A-B-C 接线 / `mxcfg-` 身份分派 / 超时与取消 / `ADAPTER_NOT_CONFIGURED` / F2 文件白名单 / 测试矩阵 W-1…W-11）。**F2 目前是"契约已定、实现未授权"。** 实现进度：**Slice A–E 已验收（E 已 FROZEN）· Slice F 已冻结（审计链 `22b3951` → 独立复核 REJECTED FOR REPAIR → `1554054` 收紧修复口径 → **`a5b80a4`** 完成修复 + 真正的 F-1…F-17 ⇒ **ACCEPTED / FROZEN**，`origin/main = a5b80a4`）· F2 = 契约 rev13（实现未授权）**。仍**未授权**：真实模型适配器 · 原文切片 · U-1/U-2/U-3 · Wind · 自动发现 · Phase D。
> rev2–rev12 = 各轮审查意见的收口（§M2.1–§M2.5）、实施期文档同步、F 契约澄清与 F 状态校准（其中 **rev11 = F 修复轮的语义收紧**、**rev12 = F 状态校准**）。
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

### §M2.3 rev4 的收口（第三轮审查意见 —— 逐条核实后**全部成立**，含审查者自行更正的一项）

| 审查发现 | rev4 处理 |
|---|---|
| **超长段落后的分隔符仍无归属**：§M4.2 只说"普通窗口"吞分隔符，而超长段落切片按 `paragraph.end` 收尾 ⇒ 其后的 `\n{2,}` **无人覆盖**，区间并集**仍有缺口** | §M4.2 新增"**超长段落切片的最后一片也必须吞掉它后面的分隔符**"（末片 `end` = 下一个段落的 `start`；末段则到 `normalized.length`），并明确 **`maxChars` 只约束段落正文长度、分隔符不计入**（否则要么留缺口、要么造成重叠）；§M4.3 第 3 步同步；T-C6-29 增"超长段落 + 紧接普通段落"案例 |
| **原子认领缺可执行的数据库机制**：`claimMaterialIngest()` 更新的是**已存在的 `material` 行**，而提取运行需**按尝试留多条痕迹** ⇒ 不能照搬；且**首次运行没有行可 `UPDATE`** | §M7.1a 重写为可执行机制：**INSERT 新尝试行**（不是 UPDATE）· **部分唯一索引** `UNIQUE(material_version_id, extraction_config_key) WHERE status = 'running'`（数据库层保证同配置最多一个 `running`；项目已有多处 `CREATE UNIQUE INDEX` 范式：`research-db.ts:377/392/452`）· 单事务内**固定顺序**的四步认领 · **三种情况的数据库结果表** · 提交带 **`generation`** 校验；§M9 新增 **#4b** |
| **"模型调用恰好一次"与"租约接管"矛盾**：旧进程的请求可能仍在服务商处运行，接管会**再发一次**；fencing 只能阻止**旧结果提交**，**无法撤销已发出的请求** | §M7.1a ⑤ 改写承诺：**有效租约内只有一个持有者调用模型** · **接管后允许重复请求** · **但只有当前代次能提交结果** · **最终只有一条 `completed`**；远端严格去重**必须**依赖**服务商幂等键**（适配器可声明 `supportsIdempotencyKey`），**未声明时不得声称严格去重** |
| **并发测试手段不足**（单进程只证明进程内串行化） | §M7.1a ⑥ + T-C6-37：**必须用两个独立进程，或至少两个独立数据库连接**；**租约接管**用例断言**旧代次零残留**（无候选 / 无 Evidence / 未 `completed`） |
| **配置快照没记录生成参数本身**（`model` 只有版本串；把参数塞进 `promptVersion` 无法还原当时请求） | §M7.3 快照新增 **`generation` 对象**（`temperature` / `topP` / `maxOutputTokens` / `seed` / `toolConfig` / `extra`）；`promptVersion` **只标识提示词**（§M9 #10 改写）；`generation` **参与配置身份**（`generationHash`，§M9 #5）；T-C6-30 增参数身份用例 |
| **成本提示算错**（审查者自行更正：`+43%` 的比较基准被混淆） | §M4.3 改为**写明两个基准**：`600` 相对**零重叠** = `2000/1400` = **+42.9%**；`600` 相对 **`500`** = `1500/1400` = **+7.1%**（真实代价）—— 并给出 `step = maxChars − overlapChars` 算式 |

### §M2.4 rev5 的收口（第四轮审查意见 —— 逐条核实后**全部成立**）

| 审查发现 | rev5 处理 |
|---|---|
| **旧 `extraction_run` 行迁移后会卡死认领**：加列后历史 `running` 行的 `owner` / `lease_until` 为 `NULL` ⇒ `>= now` 与 `< now` **都不成立** ⇒ 既不算"占用"也不算"可接管" ⇒ 新认领 INSERT 被**部分唯一索引拒绝**；若旧库有多条同配置 `running`，**建索引本身就会失败** | 新增 **§M7.1b 迁移规则**：① 加列 ② **回填 `attempt_seq` / `generation`**（按 `(version, config, started_at, extraction_id)` 升序，确定性）③ **无租约证据的历史 `running` ⇒ `failed` / `error='legacy_interrupted'`**（**不删、不静默**，对齐 `migrateMaterialIngestState()` 的残骸降级）④ 清理后**仍冲突 ⇒ FAIL FAST 并列出冲突行** ⑤ **最后**才建索引（顺序不可颠倒）。§M9 新增 **#4c**（迁移方法），并要求 #4b 的索引**在迁移之后**创建；新增 **T-C6-38** 迁移验收（含"不卡死"与"冲突中止"两面） |
| **幂等键含 `attemptSeq` ⇒ 去重不了接管后的重复请求**：接管生成新 `attemptSeq` ⇒ 新键 ⇒ 服务商视为**新请求** | §M7.1a ⑤ 更正键的构成：`idempotencyKey = deterministicId("xidem", materialVersionId \| extractionConfigKey \| windowId)` —— **不含 `attemptSeq`** ⇒ **同一逻辑批次（同一窗口）在接管后仍用同一个键**，不同窗口互不相同；`attemptSeq` 只留在审计里。服务商不支持该语义时，rev4 已写明的"允许重复请求"边界依然有效 |

### §M2.5 rev6 的收口（第五轮审查意见 —— 核实后成立）

| 审查发现 | rev6 处理 |
|---|---|
| **迁移没有原子性 / 可安全续跑的明确规定**：§M7.1b 只列了步骤、**没写事务边界** ⇒ ① 若冲突检查失败，先前的**加列 / 回填 / 降级可能已经提交**；② 若迁移**中途退出**，"重跑时只给 `attempt_seq IS NULL` 的行从 `1..N` 分配"可能**撞上已回填的编号** | §M7.1b 增加**两层保障**：<br>① **首选 —— 整段迁移一个事务**（`BEGIN IMMEDIATE … COMMIT`，任一步失败即 `ROLLBACK`）⇒ 冲突时**结构与数据指纹均不变**；<br>② **兜底 —— 每一步幂等**：回填**只处理 `attempt_seq IS NULL`** 且**编号从该分组当前 `MAX+1` 起** ⇒ 已回填者不再入选、重跑从已回填的最大值继续 ⇒ **绝不产生重复编号**；降级**只匹配当前仍为 `running` 且缺租约的行** ⇒ 可重复执行。<br>已核实项目事实：**`migrate()` 本身不开事务**（`research-db.ts:950` 的 `BEGIN` 属于 `transaction<T>()` 方法）⇒ 该迁移方法**需自带事务边界**；§M9 #4c 已注明。T-C6-38 新增 **⑥ 原子性**（结构与数据指纹不变）与 **⑦ 可重跑**（无重复 `attempt_seq`） |

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
* **超长段落切片的最后一片也必须吞掉它后面的分隔符**：该片的 `end` = **下一个段落的 `start`**（若该段落是全文最后一段 ⇒ `end = normalized.length`）。★ rev4：rev3 只写了"普通窗口"吞分隔符，而超长段落切片按 `paragraph.end` 收尾 ⇒ 紧跟其后的 `\n{2,}` **无人覆盖**，**区间并集仍有缺口**（审查意见成立）。
* **`maxChars` 只约束段落正文长度，分隔符不计入**。因此末片吞掉分隔符后，其原始字符跨度可能略大于 `maxChars`（最多多出一个 `\n{2,}`）—— 这是**允许且必要**的：否则要么留缺口，要么让下一段的窗口回退而造成重叠。切片内部的 `step = maxChars - overlapChars` 同样**只按正文**计算。
* 模型**不被要求**引用分隔符。引文若落在分隔符上，V3 仍可能通过（文本一致），但这类引用没有信息价值 —— 由**人工审阅**发现（§M11.1 的诚实边界），契约不额外禁止。

### §M4.3 切分算法（`WINDOW_RULE_VERSION = "para-greedy-v1"`）

```
1) paragraphs := splitParagraphs(normalized)
2) 贪心合并相邻段落，直到加入下一段会超过 maxChars ⇒ 一个"段落组窗口"（区间按 §M4.2 取）
3) 若某段落自身长度 > maxChars ⇒ 该段落**单独**按 char_range 切分：
     step = maxChars - overlapChars            （★ 只按正文长度计算）
     以 step 步长推进，直到覆盖该段落正文末尾（最后一片可短于 maxChars）
     ⇒ 相邻片共享 overlapChars 个字符（仅在**同一段落内部**）
     末片：end 再延伸到**下一个段落的 start**（吞掉尾部分隔符；末段则到 normalized.length）
4) 窗口按 start 升序编号 index = 0,1,2,…
```

**首版默认值**：`maxChars = 2000` · `overlapChars = 600` · `maxQuoteChars = 500`（三者皆为 UTF-16 code unit，且**全部进 `extractionConfigKey`**；§M9 #5）。`overlapChars` 取 **600 > `maxQuoteChars` = 500**，正是为了满足下面的第三条约束 —— 超长段落切分处的引文仍能在相邻片内**完整**出现。

> **成本提示（★ rev4 修正基准 —— 上一版把两个基准混为一谈，审查意见成立）**：`overlapChars` 只作用于**超长段落**，它越大，那类段落被重复处理的文本越多。以 `maxChars = 2000` 计，步长 `step = maxChars - overlapChars`：
>
> | 比较基准 | 计算 | 处理量变化 |
> |---|---|---|
> | `600` 相对 **零重叠** | `2000 / (2000 − 600) = 2000/1400` | **+42.9%** |
> | `600` 相对 **`500`**（契约允许的最小合法值） | `1500 / 1400` | **+7.1%** |
>
> ⇒ 取 `600` 的真实代价是**相对最小合法重叠多约 7%**（**不是 43%**），换来 `600 − maxQuoteChars(500) = 100` 字符的余量。若只求满足约束，`500` 即可。**该值属配置身份**，改动会使已有候选需按新配置重新提取（§M7.1）。

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

通过后由服务端**计算**，并在 **Slice F 写入时生成**（模型不得给出任何 id）：

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

**★ 实施切片边界（rev7 按实施裁决同步）**：上表列出的是**端到端**最终产物。实现按"一次一片"拆分，**计算**与**生成身份 / 落库**分属不同片 —— 不要把 Slice B 读成"应该已经生成了身份"：

| 归属 | 内容 | 状态 |
|---|---|---|
| **Slice A** | `extractionWindowFor`（窗口切分，§M4）· `windowRuleKey` | **已实现并验收**（`4274bab`，T-C6-29） |
| **Slice B** | 注入缝类型 + `resolveQuote` / `resolveQuotes`：**只计算** `startGlobal` / `endGlobal` / `fragmentLocator` / `quoteHash` / `quoteText`；**不生成任何 Tiancha 身份**（无 `fragmentId` / `evidenceId` / `stance`），**不写任何表** | **已实现并验收**（`da1993b`，T-C6-31(unit) / T-C6-32(unit)） |
| **Slice F** | 由 `fragmentLocator` **生成** `fragmentId`，用 `buildMaterialFragment` / `buildFragmentEvidence` 生成 Fragment 与 Evidence（`stance = "supports"`），并在**全成或全败的单事务**里写入 | 未开始 |

⇒ 因此上表中 **`fragmentId` / Fragment 文本 / `evidenceId` / `stance` / 落地方式** 四行**属于 Slice F**；Slice B 的产出止于 `ResolvedQuote`（`windowId` / `startGlobal` / `endGlobal` / `fragmentLocator` / `quoteHash` / `quoteText`，**不含任何身份字段**）。

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
3. 任何一步抛错 ⇒ 事务回滚 ⇒ `extraction_run.status = failed` + `error`（**该写入在事务之外**，因为它必须留下"这次失败过"的记录）。★ **rev11**：该收口**仍必须受 `generation` / `owner` fencing 约束**（复用既有 `finishRun` 的同一组谓词）；若因租约已被接管而 `changes() === 0`，**安全忽略** —— 详见 **§M13.9 澄清二**。
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

### §M7.1a 同配置的**并发**请求必须有互斥（rev3 新增；★ rev4 落到可执行机制）

rev2 只规定"已有 `completed` 则复用" —— 两个**同时**到达的同配置请求可能**都**没看到 `completed`，于是**都**调用模型并**都**写出结果。

**rev4 更正**：rev3 直接照搬了 `ResearchRepository.claimMaterialIngest()` 的写法，但那个方法**更新的是已经存在的 `material` 行**（`UPDATE material ... WHERE material_id = ?`，带租约与 `RETURNING`），而提取运行需要**按尝试留多条痕迹** —— **数据结构不同，不能照搬**（审查意见成立）。下面给出可执行的机制。

#### ① 数据结构

* `extraction_run` 每 `(material_version_id, extraction_config_key, attempt_seq)` **一行**（`attempt_seq` 从 1 开始）。
* **部分唯一索引**（SQLite 支持带 `WHERE` 的索引；本项目已有多处 `CREATE UNIQUE INDEX` 范式：`research-db.ts:377` / `:392` / `:452`）：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_extraction_run_single_active
  ON extraction_run(material_version_id, extraction_config_key)
  WHERE status = 'running';
```

⇒ 数据库层面保证**同一配置最多一个 `running`**，不依赖应用层自觉。

#### ② 认领（**单事务**，顺序固定）

```
BEGIN IMMEDIATE
  1) 该 (versionId, configKey) 已有 completed 运行 ⇒ 复用其 candidateIds（§M7.1）⇒ COMMIT（不新建行）
  2) 存在 running 且 lease_until >= now
       ⇒ 认领失败 ⇒ COMMIT（不新建行），返回 in_progress(owner, leaseUntil, attemptSeq)
  3) 存在 running 但 lease_until < now（过期）
       ⇒ 把该行标记为 failed / error='lease_expired'（★ 先让出唯一索引）
  4) INSERT 新运行行：attempt_seq = (SELECT COALESCE(MAX(attempt_seq),0)+1
                                      FROM extraction_run WHERE material_version_id=? AND extraction_config_key=?)
                      status='running', owner=?, lease_until=?, generation=attempt_seq, started_at=?
COMMIT
```

* **第一次运行时没有任何行可供 `UPDATE`** ⇒ 认领靠 **INSERT 新行**，**不是** `UPDATE` 已有行（这正是 rev3 照搬失败的根因）。
* 第 3 步的"标 failed"在同一事务内**先于**第 4 步的 INSERT ⇒ 不会撞 `idx_extraction_run_single_active`。

#### ③ 三种情况的**数据库结果**

| 情况 | 新建 `extraction_run` 行 | 其它写入 |
|---|---|---|
| 认领成功 | **+1**（`status='running'`，新 `attempt_seq`） | 无 |
| 已有 `completed` ⇒ 复用 | **0** | **0**（§M7.1：零副作用，指纹不变） |
| 被有效租约占用 ⇒ `in_progress` | **0** | **0** |
| 租约过期 ⇒ 接管 | **+1**（新 `attempt_seq`） | 过期行**行数不变**，仅改为 `status='failed'` / `error='lease_expired'` |

#### ④ 提交结果必须带**代际校验**（fencing）

```sql
UPDATE extraction_run SET status='completed', finished_at=?, candidate_ids_json=?
 WHERE extraction_id = ? AND status='running' AND generation = ?
```

* `changes() !== 1` ⇒ 本代次**已被接管** ⇒ **不得**写入任何候选/Evidence，本代次结果**整体丢弃**。
* 候选 / Evidence 的写入与该 `UPDATE` 在**同一事务**内（§M6.3）⇒ 代际校验一旦失败，全部回滚。

#### ⑤ "模型调用恰好一次"的**修正承诺**（★ rev4）

rev3 说"任意并发下模型调用恰好一次"，这与"租约过期后可接管"**互相矛盾**：旧进程的请求可能**仍在服务商处运行**，新认领会**再发一次**请求；fencing 能阻止**旧结果提交**，但**无法撤销已发出的请求**（审查意见成立）。rev4 改为：

| 承诺 | 内容 |
|---|---|
| **有效租约内** | 只由**一个持有者**调用模型；其余请求**不得**调用（复用或返回 `in_progress`） |
| **租约接管后** | **允许**出现第二次（乃至更多次）模型请求 |
| **但** | **只有当前代次能提交结果**；旧代次的结果一律丢弃（fencing） |
| **最终收敛** | 同一 `(versionId, configKey)` 最终**只有一条 `completed`**，其候选集**唯一** |
| **远端严格去重（可选）** | 若要求"连请求也不重复"，**必须**依赖**服务商支持的幂等键**：适配器可声明 `supportsIdempotencyKey: boolean` 并接受 `idempotencyKey`。★ **rev5 更正键的构成**：`idempotencyKey = deterministicId("xidem", materialVersionId + "\|" + extractionConfigKey + "\|" + windowId)` —— **不含 `attemptSeq`**。理由（审查意见成立）：接管会生成**新的 `attemptSeq`**，若键里含它，新请求在服务商看来就是**另一个请求**，**去重不了旧进程仍在处理的那个**；而 `(materialVersionId, extractionConfigKey, windowId)` 是**同一逻辑批次**的稳定身份 ⇒ 接管后同一窗口**继续用同一个键**，不同窗口仍互不相同。`attemptSeq` 只留在**运行审计**里。**未声明支持时不得声称严格去重** |

#### ⑥ 测试要求（★ rev4 加严）

* **并发用例必须用两个独立进程**（或**至少两个独立数据库连接**）—— 单进程内的 `Promise.all` 只证明"进程内串行化"，**不足以**证明互斥（审查意见成立）。
* **租约接管用例**必须断言旧代次**零残留**：无新增 `claim_candidate`、无新增 `fragment_evidence`、运行未被写成 `completed`；且新代次正常完成。

### §M7.1b 历史 `extraction_run` 行的迁移规则（★ rev5 新增，审查意见）

**问题**（审查意见成立）：现有表**没有** `owner` / `lease_until` / `generation` 等新列。`addColumnIfMissing` 之后，**旧的 `status='running'` 行**在这些字段上为 `NULL`：

* `lease_until >= now` ⇒ **不成立**（`NULL` 参与比较得 `NULL`，非真）；
* `lease_until < now` ⇒ **同样不成立** ⇒ 该行**既不算"有效占用"、也不算"可接管"**；
* ⇒ 随后新认领 INSERT 另一条 `running` ⇒ 被**部分唯一索引拒绝** ⇒ **认领静默卡死**。
* 更糟：若旧库里已有**多条**同配置 `running`，**创建部分唯一索引本身就会失败**。

**迁移顺序**（与项目既有范式一致：**加列 → 唯一性检查 FAIL FAST → 迁移降级**，见 `research-db.ts:601-603`；`migrateMaterialIngestState()` 的 `legacy_failed` 就是"残骸保守降级"先例）：

**★ rev6：整段迁移必须是原子的，且每一步都幂等可重跑（双保险）。** 审查意见成立 —— rev5 只列了步骤、**没写事务边界**：若冲突检查失败，先前的结构与数据改动可能**已经提交**；若中途退出，重跑时"只给 `attempt_seq IS NULL` 的行从 `1..N` 分配"还可能**撞上已回填的编号**。

```
★ 整段包在一个事务里（首选；BEGIN IMMEDIATE … COMMIT）—— 任一步失败即 ROLLBACK，
  结构与数据指纹均不变（T-C6-38 断言）：

1) addColumnIfMissing：chunker_version / methodology_version_id / dimension_set_hash /
   max_quote_chars / attempt_seq / config_snapshot_json / owner / lease_until / generation
   （ALTER TABLE 在 SQLite 事务内合法）
2) 回填身份（★ 幂等）：对 attempt_seq IS NULL 的行，按
      (material_version_id, extraction_config_key, started_at, extraction_id) 升序，
   编号从**该 (材料版本, 配置) 分组当前的 MAX(attempt_seq) + 1** 起连续分配；
   并把 generation 回填为 attempt_seq（代际初始值 = 尝试号）
3) 处理"无租约证据"的历史 running（★ 幂等）：
     status='running' 且 (owner IS NULL OR lease_until IS NULL)
       ⇒ 标为 failed，error='legacy_interrupted'
   ★ 依据：持有者/租约**不可知**，**无法证明**仍有进程在写 ⇒ 保守降级。
   ★ **不静默删除**（保留行与原始 error 上下文），**也不静默卡住**。
4) 冲突检查（FAIL FAST）：若**仍有**同一 (material_version_id, extraction_config_key)
   多条 status='running' ⇒ **抛错**（错误信息列出冲突行 extraction_id + attempt_seq）
   ⇒ 事务 **ROLLBACK** ⇒ 加列、回填、降级**全部不落地**，库回到迁移前状态。
5) **最后**创建部分唯一索引 idx_extraction_run_single_active（§M9 #4b）—— 顺序不可颠倒，
   否则索引创建可能先于清理而失败。
COMMIT
```

**幂等回填规则（rev6 明确）—— 同时也是"若某环境不支持整段事务"时的兜底**：

* 第 2 步**只处理 `attempt_seq IS NULL` 的行**，且编号**从该分组当前的 `MAX + 1` 起** ⇒
  * 已回填的行**不再满足条件**，不会被重新编号；
  * 中途退出后重跑，剩余行从**已回填的最大值继续** ⇒ **绝不产生重复编号**；
  * 因此即使第 4 步失败后重跑（无论事务是否回滚），`attempt_seq` 在分组内**始终唯一**。
* 第 3 步的降级**只匹配当前仍为 `running` 且缺租约的行** ⇒ 已降级的行不再匹配 ⇒ 可重复执行。
* 两条规则都**不依赖"整段事务"**才成立 —— **事务是首选保障，幂等是兜底保障**（两者都要写）。

**明确不做**：删除历史 `running` 行 · 把无法判定的历史运行当作 `completed`（那会伪造"已提取"）· 冲突时**静默**选一条留下。

**迁移验收**：**T-C6-38**（§M10）—— 带**旧 `running` 行**与**同配置重复运行行**的库必须按上述规则迁移，且迁移后认领/复用均正常工作。

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
  /** ★ rev4：**实际请求参数本身**（不只靠版本标签）—— 审查意见成立：版本字符串无法还原当时发给模型的参数 */
  generation: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    seed?: number;
    toolConfig?: Record<string, unknown>;
    /** 适配器自报的、会影响输出的其余参数；键值须可稳定 JSON 序列化 */
    extra?: Record<string, unknown>;
  };
  methodology: { methodologyVersionId: string; dimensionHints: string[] };  // ★ 有序，与传给模型的一致
  run: { timeoutMs: number; batchCount: number; attemptSeq: number; generation: number };  // batchCount = 窗口数
}
```

* ★ rev4：`generation` **既存下实际值，也参与配置身份** —— 参数变化 ⇒ `extractionConfigKey` 变化 ⇒ 新候选（§M7.2）。`promptVersion` 只标识**提示词**版本，**不再**充当生成参数的容器（§M9 #10 已改写）。
* 注意 `generation`（模型生成参数）与 `run.generation`（运行**代际 token**，用于 fencing，§M7.1a）是**两个不同的东西** —— 快照里分开命名，避免混淆。

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
| 4 | `ExtractionRun` + `extraction_run` 增**审计与认领列**：`chunker_version` · `methodology_version_id` · `dimension_set_hash` · `max_quote_chars` · **`attempt_seq`** · **`config_snapshot_json`** · **`owner`** · **`lease_until`** · **`generation`** | 建表列 + `addColumnIfMissing`（PRAGMA 预检查，同 `superseded_claim_ref` 法）；**表数仍 32**（加列不加表）。★ 审计要能**逐字还原当时配置**（§M7.3 快照）；后四列服务 §M7.1a 的并发互斥与运行身份 |
| 4b | **部分唯一索引** `idx_extraction_run_single_active`：`UNIQUE(material_version_id, extraction_config_key) WHERE status = 'running'` —— ★ **必须在 §M7.1b 迁移之后创建** | §M7.1a ① + §M7.1b 第 5 步：在**数据库层**保证同一配置最多一个 `running`。项目已有多处 `CREATE UNIQUE INDEX` 范式（`research-db.ts:377` / `:392` / `:452`）。**不新增表** |
| 4c | **新增迁移方法** `migrateExtractionRunState()`，在 `migrate()` 内、`ensureMaterialIngestColumns()` 一带之后、**建索引之前**调用；★ **整段包在一个事务里**（`BEGIN IMMEDIATE` … `COMMIT`，失败即 `ROLLBACK`） | §M7.1b：加列 + 回填 `attempt_seq` / `generation` + 无租约的历史 `running` ⇒ `failed` / `legacy_interrupted`（**不删、不静默**）+ 冲突 ⇒ **FAIL FAST 并列出冲突行** ⇒ **整体回滚**（结构与数据指纹不变）+ 最后建索引。**每一步同时幂等可重跑**（兜底保障）。范式对齐既有 `migrateMaterialIngestState()`（`research-db.ts:832`）—— 注意 **`migrate()` 本身不开事务**（`:950` 的 `BEGIN` 属于 `transaction<T>()` 方法），故本方法**需自带事务边界** |
| 5 | `extractionConfigKeyFor` 增 **`chunkerVersion`**（含 `WINDOW_RULE_VERSION` + `maxChars` + `overlapChars`）· **`methodologyVersionId`** · **`dimensionSetHash`** · **`maxQuoteChars`** · **`generationHash`**（`generation` 实际参数值的稳定 hash） | 这些**都会改变哪些输出被产出 / 被接受** ⇒ 必须进身份（审查意见成立）。`dimensionSetHash = sha256Hex(dimensionHints.join("|"))`，`dimensionHints` 取**方法论声明的原始顺序**（**不 sort**，§M3.4），与传给模型的有序列表**逐位一致**；`generationHash` 对**稳定序列化后的 `generation` 对象**计算（键序固定） |
| 6 | Evidence 追加**仅限 `draft`** | §M7.1 |
| 7 | `RunResult` 增 **`reused`**（§M7.1 复用）、**`skippedReviewed`**（§M7.1 表）与 **`in_progress`**（§M7.1a 未抢到认领时） | 让"复用 / 跳过已审核 / 正在跑"**可见**而非静默。★ **rev8 / §M13.1 澄清**：`reused: number` 保持**候选级**计数不变；§M7.1 的"整次运行被复用"由**新增的 `reusedRun: boolean`** 表达 —— 二者不得由同一字段承担 |
| 8 | 新增 §M3.2 的四个构件 | `extraction-window.ts` / `model-extraction.ts` |
| 9 | 装配点注入 `ModelExtractionAdapter` + `AbortController` | CLI 侧；Research Core 不 import 任何模型 SDK |
| 10 | 适配器**必须**：① `promptVersion` 标识**提示词版本**；② **模型部署版本**（服务商不可变标识，或可获取的 `deploymentId` / `snapshotDate`）进 `modelVersion`；③ **实际生成参数**（温度 / topP / maxOutputTokens / seed / 工具配置…）**单独作为值**写进 `config_snapshot_json.generation` 并**参与 `extractionConfigKey`**（`generationHash`），**不再**把它们塞进 `promptVersion`；④ 把该部署标识的**来源与稳定性边界**写进实现注记 | §M7.1 不承诺"同版本逐次输出一致"，但要求：**同配置只调用一次 + 结果被复用 + 实际版本与参数写入审计**（§M7.3）。**不得**用会静默漂移的名字当版本号 |
| 11 | **实现前先枚举 `extract()` / `run()` 的全部调用点**（CLI / Agent / 全部测试）并逐一 `await` | 契约不代列清单，实现轮用 `grep` 产出并写进交付说明（审查意见要求） |
| 12 | `candidate show` / 报告行在每条来源上显示 **`stance`** | §M5.5：审核界面必须能看到"模型声称此引文支持该候选"这一**未确认**关系 |

**不做**：不改 `KnowledgeProjectionService` / `ingestClaims` / 审核闸门 / 投影服务 / 报告；不新增表；不引入模型依赖到 `packages/research`。

---

## §M10 验收（T-C6-29…T-C6-38；实现轮落地）

| 用例 | 必须断言的行为 |
|---|---|
| **T-C6-29 窗口确定性与覆盖（★ rev3 拆分 · rev4 加案例）** | 两次生成**深比较完全相等**；**I1** `text === normalized.slice(start,end)`；**I2** `index` 连续；**I3** 首个窗口 `start === 0`；**I4 区间并集 = `[0, normalized.length)`（全文无缺口；允许切片重叠）**；**I5 仅段落组窗口之间** `end === 下一个 start`（不重叠）；**I6 仅同一超长段落的切片之间**共享 `overlapChars`；**I7** 末窗口 `end === normalized.length`。<br>★ **rev4 新增案例**：**"超长段落 + 紧随其后的普通段落"** ⇒ 断言 ① 无缺口（并集仍为全文）② 超长段落**末片**的 `end` **等于下一段的 `start`**（即吞掉了尾部分隔符）③ 该末片 `text` **以分隔符结尾** ④ 除该末片外，各窗口**正文长度** ≤ `maxChars` |
| **T-C6-30 窗口 / 引文 / 生成参数进身份** | 分别改变 `maxChars` / `overlapChars` / `WINDOW_RULE_VERSION` / **`maxQuoteChars`** / **方法论维度集合** / ★ **`generation` 里的任一生成参数（温度 / seed 等）** ⇒ `extractionConfigKey` **变化** ⇒ 生成**不同** `candidateId`（旧候选原样保留） |
| **T-C6-31 引文即 Fragment（四者一致）** | 一条引文（含**跨段落但连续**的引文）⇒ 断言 `fragment.text === evidence.quoteText === quote.text` 且 `sha256Hex(quote.text) === evidence.quoteHash === fragment.textHash`；`fragment.locator` 是**精确覆盖该区间的 `char_range`**；并经 `resolveLocator(normalized, fragment.locator)` **解析回材料原文**得到同一段文本。<br>★ **`(unit)` 子集已落地于 Slice B**（`da1993b`）：locator / 全局区间 / `quoteHash` / 解析回原文已断言；**含 `fragmentId` 与 Fragment 行的"四者一致"属 Slice F** |
| **T-C6-32 引用不成立 ⇒ 整次失败（V1–V4 各一例）** | V1 窗口不属于本版本 · V2 区间越界/倒置 · **V3 文本与位置不符** · **V4 长度超过 `maxQuoteChars`** ⇒ 运行 `failed`；`claim_candidate` **零新增**；`extraction_run.candidate_ids_json = []`；`error` 指明失败类别与第几个窗口 / 第几条 quote。<br>★ **`(unit)` 子集已落地于 Slice B**（`da1993b`）：**校验与拒绝**已断言（含 fail-fast 与"同长度不同内容"的 V3 反例）；**"整次失败、零残留"的持久化语义属 Slice F** |
| **T-C6-33 人工确认前下游指纹不变（完整指纹）** | 成功运行后，§M8 十张表的**完整内容指纹**与运行前**逐项相等**（**不是**只比行数）；候选全为 `draft` / `projectionStatus = "none"` / 无 `decisionRelation` |
| **T-C6-34 超时 / 取消不误报完成** | 适配器**永不 resolve** ⇒ 运行 `failed` + `error` 以 `timeout:` 开头；**零候选**；`finishedAt` 有值；**且**断言适配器**收到了 abort**（其 promise 在 `signal` 触发后以 `AbortError` 结束），证明不是"只把状态改成失败" |
| **T-C6-35 已审核候选不被改动** | 先 `confirm` / `reject` 某候选 ⇒ **候选写入阶段**遇到同 id ⇒ 该候选 `reviewStatus` / `statement` / `evidenceRefs` **一字不变**，并计入 `skippedReviewed`；`draft` 候选仍可合并 Evidence（`merged` 计入） |
| **T-C6-36 无适配器 ⇒ 明确失败** | 未配置 `ModelExtractionAdapter` ⇒ **报错** `ADAPTER_NOT_CONFIGURED`；**不静默退回** `[CANDIDATE]`；**不写任何表** |
| **T-C6-37 复用与并发认领**（★ rev3 加并发 · **rev4 修正承诺与测试手段**） | **串行**：同 `(materialVersionId, extractionConfigKey)` 第二次调用 ⇒ 既有 `candidateIds` + `reused = true` + `completed`；**适配器调用次数仍为 1**；**不写任何表**（指纹不变）；适配器**故意不可用**时也不受影响。<br>**并发 —— 必须用两个独立进程，或至少两个独立数据库连接**（单进程 `Promise.all` 只证明进程内串行化，**不算**）：① 断言**有效租约内只有 1 次模型调用**、**`completed` 运行只有 1 条**；未抢到者拿到**复用结果**或显式 **`in_progress`**，**且没有第二次模型调用**；② **租约接管**：令持有者过期 ⇒ 新代次可认领（新 `attemptSeq`；此时**出现第二次模型请求是允许的**）⇒ 断言**旧代次零残留**（无新增 `claim_candidate`、无新增 `fragment_evidence`、运行未被写成 `completed`），新代次正常 `completed`；③ 断言**部分唯一索引**确实阻止两个 `running` 并存（§M7.1a ①） |
| **T-C6-38 历史运行行的迁移**（★ rev5 新增，审查意见） | 构造一个**旧结构**库：手工插入 ① 一条 `status='running'` 且 `owner` / `lease_until` 为 `NULL` 的历史运行 ② 同一 `(materialVersionId, extractionConfigKey)` 下的**两条** `running` 行。打开库（触发迁移）后断言：<br>① 历史行**未被删除**，且被标为 `failed` + `error='legacy_interrupted'`；<br>② 所有行的 `attempt_seq` / `generation` 已回填，且在同配置内**连续、唯一**；<br>③ 部分唯一索引**已建立**，且同配置**不再有两条 `running`**；<br>④ 随后**认领成功**（新 `attempt_seq`），**复用与 `in_progress` 路径也都正常**（即认领**不再被历史行卡死**）；<br>⑤ 反面用例：构造**清理后仍冲突**的局面（例如两条都带有效租约的 `running`）⇒ 迁移**抛错中止**，错误信息**列出冲突行的 `extraction_id` + `attempt_seq`**；<br>⑥ ★ **原子性**：上述失败后断言**结构与数据指纹均未改变** —— `PRAGMA table_info(extraction_run)` 与迁移前**逐项相同**、各表内容指纹不变（即加列 / 回填 / 降级**全部没有落地**）；<br>⑦ ★ **可重跑**：移除冲突后**重跑迁移** ⇒ 成功，且 `attempt_seq` 在**每个 `(material_version_id, extraction_config_key)` 分组内仍唯一**（不因上次部分执行而重复编号）；随后认领与复用均正常 |

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

## §M13 Slice F Contract Clarification（rev8 新增；纯文档；★ rev11 = F 修复轮的契约收紧）

本节**只澄清 F 的边界与语义**，不改变 §M0–§M12 已锁定的任何规则（窗口协议 / 引用校验 V1–V4 / 单事务 / 不覆盖已审核 / 认领与 fencing 全部不变）。它解决 preflight 审计发现的五个必须先定口径的问题（preflight 记为 G1–G10；本节 = C-F-1…C-F-5）。

### §M13.0 结论：F 与 F2 拆分（preflight G1 的裁决）

```text
Slice F  = 持久化与原子收口（Persistence boundary）
           输入 = ValidatedCandidate[]（draft payload + ResolvedQuote[]，见 §M13.4），不含模型调用
           唯一持久化入口 = CandidateExtractionService.persistValidatedCandidates()（§M13.9）

Slice F2 = 模型链路接线（Model wiring）
           输入 = MaterialVersion → ExtractionWindow → ModelExtractionAdapter → resolveQuotes()
                  → ValidatedCandidate[]
```

* **F 不接模型**：A / B / C 三片的产物（`extractionWindowFor` / `ModelExtractionAdapter` / `resolveQuotes` / `modelExtractionConfigKeyFor`）目前在生产代码**零调用**；把 `A→B→C→D→E→persistence` 一次接通会让"测试失败时无法定位是哪一层"。**F 保持为可独立验证的持久化边界。**
* **F 的输入从哪来（★ rev11）**：`CandidateExtractionService.run()` 的 legacy `[CANDIDATE]` 路径经 **§M13.5a** 的**唯一确定性兼容桥**把 `CandidateDraft[]` 转成 `ValidatedCandidate[]`；模型路径的 `ValidatedCandidate[]` 由 **F2** 组装（§M13.5 #6）。F **只消费成品**。
* **F2 才接**：多窗口批次、`mxcfg-` 身份分派、`AbortController` + 逐批 `signal`、`ADAPTER_NOT_CONFIGURED`、以及端到端 T-C6-34 / T-C6-36 / T-C6-37 的模型调用侧断言。
* **E 不重开**：E 的 `claim` / `lease` / `generation` / `owner` / fencing / "timeout 不直接把 run 改成 failed" **全部保持**（preflight G9 的裁决：`AbortController` 属 F2 新增功能，不构成重开 E 的理由）。

### §M13.1 C-F-1：`reusedRun` 与 `reused` 是两个字段，不得合并

§M7.1 写的是「`reused = true`」（**整次运行被复用**），而 `RunResult.reused: number` 既有语义是**候选级**的（同 id `draft` 候选已存在 ⇒ 合并 Evidence）。**二者绝不可由同一字段承担。**

| 字段 | 类型 | 含义 |
|---|---|---|
| **`reusedRun`**（新增） | `boolean` | 本次 `run()` **没有执行新的 extraction**，而是**直接复用了已 `completed` 的运行**（§M7.1）：不调用模型、零写入、返回既有 `candidateIds` |
| **`reused`**（保持 `number`） | `number` | 本次**实际持久化**阶段，有多少个候选是"已存在同 id ⇒ 复用"（其中真正合并到新 Evidence 的计入 `merged`） |
| **`skippedReviewed`**（新增） | `number` | 本次持久化阶段命中**已受保护候选**、因而**未追加、未修改**的候选数（判据见 §M13.2） |

* `reusedRun === true` 时：`created = reused = merged = skippedReviewed = 0`、`candidateIds` = 该 `completed` 运行的历史集合、`status = "completed"`。
* §M9 #7 中"增 `reused`"按本表理解为"增 `reused`（候选级计数，既有）+ 增 `reusedRun`（运行级布尔）"，**不是**把 `reused` 改成布尔。

### §M13.2 C-F-2：reviewed protection 的**判据**（比 §M7.1b 表更严，preflight G4）

§M7.1b 的表以 `reviewStatus` 为判据，但现行实现里 **`revise` 有意保持 `draft`**（`candidate-review-service.ts` 注释：`★ stays draft — deliberately NOT revised`），只写 `reviewedBy` / `reviewedAt`。若只判 `reviewStatus !== "draft"`，**人工 revise 过的候选会被后续模型提取悄悄追加证据** —— 这正是要防的事。

**锁定判据**：

```text
受保护（protected） ⟺  reviewStatus !== "draft"  OR  reviewed_by IS NOT NULL
```

| `reviewStatus` | `reviewedBy` | F 的行为 |
|---|---|---|
| `draft` | `NULL` | 允许合并新 Evidence（`reused` / `merged` 计数） |
| `draft` | **有值**（人工 revise 过） | **受保护** ⇒ `skippedReviewed` |
| `confirmed` | 有值 | **受保护** ⇒ `skippedReviewed` |
| `revised` | 有值 | **受保护** ⇒ `skippedReviewed` |
| `rejected` | 有值 | **受保护** ⇒ `skippedReviewed` |

> 通俗表述：**凡经人工审核动作触碰过的候选，都不得被后续提取追加或修改。**

★ **rev11 收紧：判定必须在写入之前，且保护是真正的零写入。** 受保护判定（`reviewStatus !== "draft" OR reviewed_by IS NOT NULL`）必须在**为该候选生成任何 Fragment / Evidence 之前**完成：

```text
查 candidate
  ↓
protected?
  ├─ 是 ⇒ 计入 skippedReviewed，★ 绝不新增该候选的 Fragment / Evidence，也绝不动任何字段
  └─ 否 ⇒ persistQuotes（Fragment + Evidence）⇒ merge / insert Candidate
```

理由：**被保护的候选，不应因为一次新的提取而产生无用的 Fragment / Evidence 副作用**。先写后判（`persistQuotes()` 之后再 `isProtected()`）**不合规** —— 它会让"保护"只保护候选行，却仍在库里留下这两类新行。

### §M13.3 C-F-3：Repository SQL 是 reviewed protection 的**最终防线**（preflight G3）

`appendCandidateEvidence()` 现为**无条件** union。F 必须在**数据层**加条件，而不只靠 service 自觉：

* `appendCandidateEvidence`（或等价的合并写入）的 SQL **必须**带 `AND review_status = 'draft' AND reviewed_by IS NULL`（§M13.2 判据的 SQL 形式），`changes() !== 1` ⇒ 视为"未合并"。
* 层次：**Service 决策 → 事务 → Repository SQL 守卫 → 数据库不变量**。service 侧的判断可以有，但**不能替代** SQL 守卫。
* F **允许修改 `packages/research/src/storage/research-repository.ts`，但仅限该守卫本身**；**不得**顺手重构 repository。

### §M13.4 C-F-4：F 的输入 = **已验证候选 payload + `ResolvedQuote[]`**

★ **rev9 修正（BLOCKING-1）**：F 的输入**不是**单独的 `ResolvedQuote[]`。`ResolvedQuote`（Slice B 冻结）**只有六个字段** —— `windowId` / `startGlobal` / `endGlobal` / `fragmentLocator` / `quoteHash` / `quoteText` —— **没有** `statement` / `dimension` / `contentKind`。而候选身份恰恰依赖它们：

```text
blockHash   = candidateBlockHash({ dimension, statement, contentKind })            (§M5.4)
candidateId = claimCandidateIdFor(materialVersionId, blockHash, dimension, extractionConfigKey)
```

只给 `ResolvedQuote[]`，F **无法**确定候选的 `statement` / `dimension` / `contentKind` / `blockHash` / `candidateId` ⇒ **输入契约不闭合**。若不在此处锁死，实现时必然三选一，且**三个都是错的**：(a) 从 `ResolvedQuote` 反推候选内容（不可能）；(b) 在 F 里回头调用 B 的产出（把 F 变成 B/F 混合片）；(c) 把这三个字段塞进 `ResolvedQuote`（**违反 Slice B 已冻结的类型边界**）。

**锁定输入类型**（名字可随实现微调，**语义不可变**）：

```ts
/** What Slice B has already VALIDATED (V1–V4) and resolved — the ONLY thing F consumes. */
interface ValidatedCandidate {
  /** The model's candidate payload, UNCHANGED — F never re-derives, re-parses or re-prompts it. */
  draft: {
    dimension: string;
    statement: string;
    contentKind: "fact" | "judgment";
    confidence?: number;
  };
  /** The quotes of THIS draft, already resolved to version-global coordinates (Slice B). */
  quotes: ResolvedQuote[];
}
```

* **F 消费 `ValidatedCandidate[]`**（一个 persistence unit 一个）；F **不关心**它来自哪个窗口、哪一次模型调用。
* **★ 不得修改 Slice B 的 `ResolvedQuote` 六字段契约**，也**不得**把 `statement` / `dimension` / `contentKind` 塞进 `ResolvedQuote`。draft payload 与 quotes 是**两个并列部分**，不是一个类型的扩展。
* **F 不重新生成、不重新解析、不重新调用模型**：`draft` 的三个内容字段由 B 侧产出并校验，F 只做**身份生成与持久化**。
* 边界因此闭合：

```text
B   ModelCandidateDraft ──resolveQuotes()──► ResolvedQuote[] ┐
                                                             ├─► ValidatedCandidate[] ──► F
B   ModelCandidateDraft（draft payload 原样透传）              ┘
```

F 内的职责（全部在**一个事务**内；★ rev11：步骤编号与 **§M13.9** 的 ①–⑦ 对齐）：

1. **① fencing gate（只读存在性判定）**：以 SQL 条件确认 `extraction_id` + `status='running'` + `generation` + `owner` 仍成立。★ **本步不得修改任何状态**，且**不是**最终 fencing —— 最终权威是第 7 步（⑦），见 §M13.9 澄清一；
2. 由 `fragmentLocator` 生成 `fragmentId`（`materialFragmentIdFor`）并 `buildMaterialFragment` / `insertFragments`（§M5.3）。★ rev11：**受保护候选必须在这一步之前判出**，受保护者整条跳过 2–4（§M13.2 / §M13.9 澄清四）；
3. `buildFragmentEvidence(version, fragment, "supports", at)` / `upsertFragmentEvidence`（`stance = "supports"` 固定）；
4. 用 `draft.dimension` / `draft.statement` / `draft.contentKind` 算 `blockHash` 与候选身份（沿用 §C6.7 / §M5.4，**不新增口径**）+ `insertClaimCandidate`（`ON CONFLICT DO NOTHING`，天然不覆盖）；
5. reviewed protection（§M13.2 / §M13.3）+ `reused` / `merged` / `skippedReviewed` 计数 —— ★ rev11：**判定动作发生在步骤 2 之前**，本步只负责计数与合并；
6. 写入 §M7.3 的**不可变配置快照**与运行行审计列（`chunker_version` / `methodology_version_id` / `dimension_set_hash` / `max_quote_chars` / `config_snapshot_json`）；
7. **⑦ 带 `generation` + `owner` + `status='running'` 谓词地收口** `extraction_run`（`status='completed'` / `finished_at` / `candidate_ids_json`）；`changes() !== 1` ⇒ `LostLeaseError` ⇒ 回滚。★ **本步是最终权威 fencing gate**。

* 任一环节抛错 ⇒ **整个事务回滚**（业务零残留，`extraction_run` 回到 `running`）⇒ ★ rev11：随后在**事务之外**写 `status='failed'` + `error`（§M6.3），且该写入**仍受 `generation` / `owner` fencing 约束**；**不得**把"事务回滚"当成"运行已自动变成 `failed`"（§M13.9 澄清二）。
* **`started_at` 不参与身份**；运行 id 由 `attemptSeq` 决定（§M6.2a）。

### §M13.5 C-F-5：F2 负责的东西（明确不在 F）

| # | F2 内容 | 说明 |
|---|---|---|
| 1 | **A/B/C 生产接线** | `extractionWindowFor` 切窗口 → 逐批 `adapter.extractBatch(input, signal)` → `resolveQuotes` |
| 2 | **`mxcfg-` 身份分派** | 模型路径使用 `modelExtractionConfigKeyFor`（含 `chunkerVersion` / `methodologyVersionId` / `dimensionSetHash` / `maxQuoteChars` / `generationHash`）；`[CANDIDATE]` 路径继续用 `xcfg-`。**F 本身不改任何 identity function**，只接受调用方给定的 `extractionConfigKey` |
| 3 | **`AbortController` + 逐批 `signal`** | §M6.2a：超时触发 `abort()`，`signal` 逐批传递；T-C6-34 断言适配器**确实收到 abort** |
| 4 | **`ADAPTER_NOT_CONFIGURED`** | §M11.2 / T-C6-36：模型路径缺少适配器 ⇒ 明确失败，**绝不**静默退回 `[CANDIDATE]` |
| 5 | 端到端 T-C6-34 / T-C6-36 / T-C6-37（模型调用侧） | 含"有效租约内模型调用恰好 1 次" |
| 6 | **模型路径的 `ValidatedCandidate[]` 组装** | 把 B 的 `ModelCandidateDraft`（draft payload 原样）与其 `resolveQuotes(...)` 结果配对，形成 §M13.4 的 F 输入；**模型路径**由 F2 负责这一步，F 只消费成品（legacy 路径见 §M13.5a） |

### §M13.5a legacy `CandidateDraft → ValidatedCandidate` 兼容桥（★ rev11 新增）

**背景**：`CandidateExtractor.extract()` 返回 `CandidateDraft[]`（Slice ②/E 的契约，**F 不得修改**），而 §M13.9 又要求 `run()` **必须**经由唯一持久化入口写候选。两者要同时成立，就需要一条确定性的桥；否则只剩两条出路 —— 改 E 的接口，或绕过唯一入口，**都超出授权**。

**裁定**：

> **legacy `[CANDIDATE]` 路径的 `CandidateDraft → ValidatedCandidate` 桥接，属于 F 的最小 compatibility wiring；模型路径的 `ValidatedCandidate[]` 组装仍属于 F2。**

```text
Legacy CandidateExtractor
CandidateDraft[]
      │
      │  F：唯一、确定性的 legacy compatibility bridge
      ▼
ValidatedCandidate[]
      │
      ▼
persistValidatedCandidates()          ⇒ F persistence

ModelExtractionAdapter
ModelBatchResult
      │
      │  F2：模型路径负责组装
      ▼
ValidatedCandidate[]
      │
      ▼
persistValidatedCandidates()          ⇒ F persistence
```

**四项硬限制（越界即打回）**：

1. **只能有一处桥接**，位于 `run()` → `persistValidatedCandidates()` 之间；
2. 只能使用现有 `CandidateDraft` 的 `dimension` / `statement` / `contentKind` / `confidence` / `evidenceRefs`；
3. `quotes` 只能由已有 `evidenceRefs` **确定性反查**（evidence → fragment → locator / text / textHash）得到；**禁止从 quote 反推任何语义**；
4. **不得修改 `ResolvedQuote` 六字段契约**，也**不得**为了这条桥重新调用 B（`resolveQuotes` / `ModelExtractionAdapter`）。

### §M13.6 F 的文件白名单（授权实施时按此锁）

**允许修改**

```text
packages/research/src/application/candidate-extraction-service.ts
packages/research/src/storage/research-repository.ts   ← 仅 §M13.3 的 draft 守卫
新增 packages/research/src/phase-c6-persistence.test.ts
```

**明确禁止**

```text
✗ research-db.ts（表结构与迁移）
✗ extraction-window.ts（Slice A）
✗ model-extraction.ts（Slice B）
✗ model-extraction-config.ts（Slice C）
✗ candidate-review-service.ts（审核闸门）
✗ candidate-projection-service.ts（投影）
✗ knowledge projection / report / methodology / CLI
✗ 新表 / migration / 模型 SDK
✗ domain/claim-candidate.ts  ← 默认不允许；§M13.1 已证明无需改 domain
✗ ExplicitBlockExtractor 的"边算边写"（preflight G5 裁决：保持现状，F 不改）
✗ E 已冻结的任何行为
```

### §M13.7 F 的测试矩阵（硬门）

| 用例 | 必须证明 |
|---|---|
| F-1 | 单 persistence unit 落库：Fragment + Evidence + Candidate，且 §M5.3 四者一致（输入 = §M13.4 的 `ValidatedCandidate`） |
| F-2 | 多个 persistence unit 全部成功 |
| **F-3** | **`ValidatedCandidate` 全部已通过校验；其中任一 persistence unit 在落库过程中抛错 ⇒ 整个主库事务回滚**，已成功落库的 unit **也一并回滚**（反例：写成"每 unit 一个事务"必须失败）。★ rev9 措辞修正：**F 不负责模型 batch 执行**，故不写"batch 失败"；模型侧的批次与校验失败属 F2 / §M6.3 的"先算后写"阶段 |
| F-4 | 当前 `generation` + `owner` 可提交（`changes() === 1`） |
| **F-5** | **stale `generation` 无法提交** ⇒ 零候选 / 零 Evidence / 运行未被写成 `completed`。★ **rev11 加严**：必须证明 —— **stale owner 不能完成 persistence · 不能写 `completed` · 不产生任何业务残留 · 不覆盖新 owner 的状态**（租约被接管后，新 owner 的 `extraction_run` 行**逐字不被**旧代次改动）。① gate 让 stale owner **更早**失败是允许的，但 **⑦ 的最终 fenced `UPDATE` 仍必须存在**（§M13.9 澄清一） |
| **F-6** | **`owner` 不一致无法提交** |
| **F-7** | `confirmed` / `revised` / `rejected` 候选的 `reviewStatus` / `statement` / `evidenceRefs` **一字不变** |
| **F-8** | **`draft` 但 `reviewedBy` 有值**（人工 revise 过）⇒ 同样**受保护**，计入 `skippedReviewed` |
| F-9 | 已存在 `draft`（且未被人触碰）候选 ⇒ `reused`；真正合并到新 Evidence ⇒ `merged` |
| **F-10** | 同一 attempt 重试不产生重复 Fragment / Evidence / Candidate（幂等） |
| F-11 | Fragment / Evidence / Candidate 引用一致，且 `resolveLocator` 能解析回材料原文 |
| F-12 | 成功后 `extraction_run` 正确终态（`completed` + `candidate_ids_json` + `finished_at`） |
| F-13 | ★ **rev11 明确**（BLOCKING-1 的核心回归）：persistence 抛错 ⇒ **事务 rollback** ⇒ `extraction_run.status = 'failed'` · `error != null` · `candidate_ids_json = []`，且 `fragment` / `fragment_evidence` / `claim_candidate` **零新增**。`failed` 的写入在**事务之外**，且**仍受 `generation` / `owner` fencing 约束**（§M6.3 / §M13.9 澄清二） |
| **F-14** | 失败**不留任何业务半成品**（`claim_candidate` / `fragment_evidence` / `fragment` 零新增） |
| F-15 | 下游 10 张表**完整内容指纹**与运行前逐项相等（§M8 / T-C6-33） |
| **F-16** | 已有 `completed` 运行 ⇒ `reusedRun = true`。★ rev9 澄清 **zero side effect 必须包括 `extraction_run` 本身**：**不新建 attempt 行、不改动既有 `completed` 行**（不写 `finished_at`/`candidate_ids_json`）；调用前后 `extraction_run` 仍**恰好 1 条 `completed`**，`candidate` / `fragment` / `fragment_evidence` 计数不变，下游 10 表指纹不变。**反例**：先 INSERT 一条新 run 再"发现 completed"⇒ 必须失败（那不是复用）。★ rev10：实现条文见 **§M13.10**（判断必须在创建任何新 attempt 之前）；"不执行抽取"用 `CandidateExtractor.extract()` 的 counting stub 断言为 **0 次**，**不得接入** `ModelExtractionAdapter` |
| **F-17** | ★ **rev11 新增**（BLOCKING-1 的端到端回归）：`run()` ⇒ `extract()` ⇒ legacy 兼容桥（§M13.5a）⇒ `persistValidatedCandidates()` ⇒ **persistence 抛错** ⇒ 断言 `RunResult.status === "failed"` · `reusedRun === false` · DB `extraction_run === failed` · **业务表零残留**。它证明「业务异常 ⇒ 事务回滚 ⇒ 事务外 **fenced** `failed`」这条路径在**唯一持久化入口**上真的接通（§M13.9 澄清二） |

### §M13.8 F 的边界自检（越界即打回）

```text
✗ 不接模型 / 不调 adapter / 不引入 mxcfg- 分派（属 F2）
✗ 不为「模型路径」组装 ValidatedCandidate[]（那是 F2 的职责，§M13.5）
   ★ rev11：legacy [CANDIDATE] 路径的 CandidateDraft → ValidatedCandidate 桥接例外——
     它是 F 的最小 compatibility wiring，受 §M13.5a 的四项硬限制约束
✗ 不重新生成 / 重新解析 / 重新提示候选内容（statement / dimension / contentKind 原样透传）
✗ 不从 quote 反推任何候选语义（legacy 桥只能用 evidenceRefs 确定性反查 locator）
✗ 不修改 Slice B 的 ResolvedQuote 六字段契约
✗ 不写 Claim / Knowledge / Pool / Gap / Report / Evaluation
✗ 不自动确认候选 / 不改 Methodology
✗ 不做 ExplicitBlockExtractor 的改造
✗ 不重开 Slice E
```

### §M13.9 F 的持久化入口

Slice F 的持久化能力必须通过 `CandidateExtractionService` 上**一个新的 async 方法**暴露。其语义形如：

```ts
async persistValidatedCandidates(input: {
  version: MaterialVersion;
  extractionId: string;
  owner: string;
  generation: number;
  extractionConfigKey: string;
  snapshot: ExtractionConfigSnapshot;
  candidates: ValidatedCandidate[];
}): Promise<PersistResult>
```

其中具体 TypeScript 类型可复用仓库既有类型；**不得修改 Slice B 的 `ResolvedQuote` 六字段契约**。

该方法负责完成 §M13.4 所定义的 F 持久化步骤，包括：

1. **① fencing gate**（★ rev11：只读存在性判定，**不改状态**）；
2. Fragment 持久化（★ rev11：**仅对未被保护的候选**）；
3. Evidence 持久化；
4. ClaimCandidate 身份计算与持久化；
5. reviewed protection 与 `reused` / `skippedReviewed` 计数（★ rev11：**判定位置在步骤 2 之前**，见澄清四）；
6. snapshot / audit 字段；
7. **⑦ 带 generation / owner / status 谓词的 `completed` 收口**（★ rev11：**最终权威 fencing gate**，见澄清一）。

上述步骤必须位于**同一个主库事务**中。任一 persistence unit 抛错，整个主事务必须 rollback；`failed` 状态更新必须发生在该事务之外，并继续受 generation / owner fencing 约束。

#### ★ rev11 澄清一：① 与 ⑦ 是两个不同的步骤，⑦ 才是最终权威

```
BEGIN IMMEDIATE

① fencing gate —— SQL 条件确认（extraction_id + status='running' + generation + owner）
   ★ 它只做存在性判定，**不得在此修改任何状态**

② Fragment   ③ Evidence   ④ Candidate   ⑤ counts   ⑥ snapshot / audit

⑦ UPDATE extraction_run SET status='completed', finished_at=?, candidate_ids_json=?, <audit…>
     WHERE extraction_id=? AND status='running' AND generation=? AND owner=?

   changes() === 1  ⇒ COMMIT
   changes() !== 1  ⇒ throw LostLeaseError ⇒ ROLLBACK
```

* **⑦ 是最终的 fencing gate。** ① 可以是 SQL 存在性检查，但**绝不能替代** ⑦。
* **① 成功时不修改任何状态** —— 于是即使租约在 ① 与 ⑦ 之间被接管，⑦ 仍能阻止 stale owner 完成。
* `candidate_ids_json` **只可能随 ⑦ 的成功一起落库**；⑦ 失败 ⇒ 事务回滚 ⇒ 零业务残留。
* 「先写 `completed` 再写业务行」**不合规**：那会把 ⑦ 提前到 ①，契约顺序被打乱。

#### ★ rev11 澄清二：persistence 异常 ⇒ rollback ⇒ 事务外 fenced `failed`

```text
persist transaction
    │
    ├─ 成功 ⇒ completed
    │
    └─ 任一 persistence 异常 / LostLeaseError
            ↓
        ROLLBACK（业务零残留，extraction_run 回到 running）
            ↓
        调用方在**事务之外**执行 fenced failed 收口
        （复用既有 finishRun 的 WHERE … status='running' AND generation=? AND owner=?）
            ↓
        RunResult.status = "failed" + error
```

* **绝不**认为"事务回滚 ⇒ `extraction_run` 自动变成 `failed`"。回滚只把行恢复成 `running`；把它收口成 `failed` 是**调用方的责任**，且必须**仍在 fencing 之下**。
* `finishRun()` 若因租约已被接管而 `changes() === 0`，**可以安全忽略** —— 那正是 fencing 应有的结果。
* **业务异常是主错误；`failed` 收口是 best-effort，但必须 fenced。** 收口自身抛错**不得**让原始业务异常以未处理 reject 的形式泄漏；**不得**为此新增第二套状态机。

#### ★ rev11 澄清三：legacy 桥只能有一处

`run()` 经 §M13.5a 的唯一兼容桥把 `CandidateDraft[]` 转成 `ValidatedCandidate[]`，再交给本方法；**候选写入逻辑（含桥）只能存在一份实现**。

`run()` 必须继续承担 Slice E 已有的 async / claim / lease / fencing / extractor 调用职责，并通过该唯一持久化入口完成候选写入。

**候选持久化逻辑只能存在一份实现。** `run()` 与 Slice F persistence tests 必须调用同一 `persistValidatedCandidates()`；禁止在 F 测试或其他新路径中复制第二套候选写入逻辑。

除为接入该唯一入口所必需的最小重构外，不得改变 Slice E 的 async / claim / lease / fencing 语义。

**允许的结构**：

```text
run()
  ↓
claim / lease
  ↓
extract()
  ↓
validateDrafts()
  ↓
persistValidatedCandidates(...)
  ↓
finish / lease release
```

**不允许**：

```text
run()                ── 一套写入逻辑
F test/service       ── 另一套写入逻辑
```

```text
F → 重新调用 ModelExtractionAdapter   ✗
F → 重新解析 draft                     ✗
F → 从 quote 反推 statement/dimension/contentKind ✗
```

`ValidatedCandidate` 仍然是 **B/F2 边界产生的输入对象**，F 只是消费它。

#### ★ rev11 澄清四：受保护候选必须先判定，再决定是否写 Fragment / Evidence

每个候选的逐步顺序（与 **§M13.2** 的 rev11 收紧配套，细化上面步骤 2–5）：

```text
查 candidate（read）
   ↓
protected?   ⇔   review_status !== 'draft'   OR   reviewed_by IS NOT NULL
   ├─ 是 ⇒ skippedReviewed += 1
   │        ★ 跳过 ②③④：不新增该候选的 Fragment、不新增 Evidence、不改任何字段
   └─ 否 ⇒ ② Fragment ⇒ ③ Evidence ⇒ ④ merge / insert Candidate
```

* **先写后判不合规**：若先 `persistQuotes()`（Fragment + Evidence）再判 `protected`，那"保护"就只保护了候选行，而库里仍留下本次运行新增的 Fragment / Evidence —— 那是**副作用残留**，不是保护。
* 本澄清**只**调整"判定 vs 写入"的相对顺序；**① / ⑦ 的 fencing 语义不变，⑦ 仍是最终权威**（澄清一）。

### §M13.10 §M7.1 Completed Reuse 的落点与 Slice E 测试迁移

§M7.1 / §M7.1a 规定的：

> **已有 `(materialVersionId, extractionConfigKey)` 的 `completed` extraction run ⇒ 直接复用其 `candidateIds`，`COMMIT`，且不创建新的 extraction attempt / 不修改既有 completed row**

在 Slice E 中尚未实现。

因此该行为明确属于 **Slice F 的交付内容**，对应 §M13.1 的 `reusedRun` 与 §M13.7 的 F-16；**不得**视为重新设计或修改 Slice E 的 claim / lease / fencing 语义。

`completed` 判断必须发生在**创建任何新 attempt 之前**。实现可以位于 `run()` 入口或 `claimRun()` 内，但必须处于能够保证其与 attempt 创建之间**不存在竞态**的主库事务 / 原子 claim 边界内。

对已经存在 `status='completed'` 的 `(materialVersionId, extractionConfigKey)`：

* 返回 `reusedRun = true`；
* 复用既有 `candidateIds`；
* **不调用** `CandidateExtractor.extract()`；
* **不创建**新的 `extraction_run`；
* **不修改**既有 `completed` `extraction_run`；
* **不产生**新的 Fragment / Evidence / ClaimCandidate；
* **不产生**任何 downstream mutation。

`reusedRun = true` 时，§M13.1 规定的 candidate-level `reused`、`skippedReviewed` 等持久化计数必须**保持为零**。

#### Slice E 身份测试迁移

因上述既有契约行为此前未由 Slice E 实现，Slice E 测试文件 `phase-c6-run-claim.test.ts` 中**依赖同一 `(materialVersionId, extractionConfigKey)` 在已 `completed` 后继续创建 attempt 2 / 3 的测试场景，可以调整其前置场景**，以适配 completed reuse。

但测试**必须继续覆盖**原 Slice E 已锁定的身份 / fencing 语义：

* `attemptSeq` 进入 extraction run identity；
* 相同 `attemptSeq` 产生相同 run identity；
* `started_at` 不参与 run identity；
* lease takeover 产生新的 generation / attempt；
* 旧 generation 的写入被 fencing 阻断。

调整**只能改变测试如何构造"尚未 `completed` 的 claim/takeover 场景"**，**不得删除、弱化或改变上述测试目标**。

除该测试文件外，**不得修改** Slice A/B/C/D/E 的其他测试或生产文件；`candidate-extraction-service.ts` 的必要改动由 Slice F 白名单（§M13.6）覆盖。

F-16 的"复用时不执行抽取"验证使用现有 `CandidateExtractor.extract()` 接口的 **counting stub**；**不得接入** `ModelExtractionAdapter`。`ModelExtractionAdapter` 的接入仍属于 Slice F2（§M13.5）。

---

## §M14 Slice F2 Implementation Contract（★ rev13 新增；纯文档，**未实现**）

本节把 **§M13.5 的 F2 清单**（六项）落成**可执行条文**：生产装配点 / 模型路径入口 / A-B-C 接线 / `mxcfg-` 身份分派 / 超时与取消 / `ADAPTER_NOT_CONFIGURED` / 文件白名单 / 测试矩阵。**它不改变 §M0–§M13 的任何规则**：F 的唯一持久化入口（§M13.9）、① / ⑦ 两段式 fencing、事务外 fenced `failed`、受保护候选零写入（§M13.2）、legacy 兼容桥（§M13.5a）**全部照旧**。

### §M14.0 结论：F2 的范围，以及两条必须先说清的边界

```text
Slice F2 = 模型链路接线（Model wiring）

   MaterialVersion
        ↓  extractionWindowFor(version, rule)                        ← Slice A（纯函数）
   ExtractionWindow[]  ──逐批──►  adapter.extractBatch(input, signal) ← Slice B（唯一模型入口）
        ↓  resolveQuotes(batch.quotes, { windows, maxQuoteChars })   ← Slice B（V1–V4，零容忍）
   ValidatedCandidate[]（draft payload 原样 + ResolvedQuote[]）
        ↓  persistValidatedCandidates(...)                           ← Slice F（唯一持久化入口）
   fragment / evidence / claim_candidate + fenced `completed`
```

★ **边界一：F2 不接真实模型**（用户 2026-09-29 裁定）。本片交付 **缝 + 生产装配 + 失败路径 + 端到端骨架**，**不交付任何真实模型适配器**。真实适配器（服务商 SDK / 凭据 / 部署标识 / 生成参数进身份）属于**另一次单独授权**（§M14.11）。当前环境**无凭据**（`.env` 的 `DOUBAO_API_KEY` 为空、shell env 未设置）**不影响**本片交付。

★ **边界二：F2 的第二个交付物是"生产入口"**。当前生产代码里**没有任何地方构造 `CandidateExtractionService`**（只有 `CandidateReviewService` 的只读表面在 Agent 工具里），`[CANDIDATE]` 提取器**只在测试里跑**。F2 首次给它一个显式命令面 ⇒ "人工整理候选输入"这一现状在 F2 之后变为"**legacy 路径可一键跑；模型路径明确不可用**"。

### §M14.1 命令面与生产装配点

```text
tiancha research candidate extract <materialVersionId>
        [--model] [--operator <name>] [--timeout <ms>] [--window-max-chars <n>] [--json]
```

| 参数 | 语义 |
|---|---|
| `<materialVersionId>` | 必填；该版本的规范化文本即输入（§M4.1 坐标） |
| `--model` | **显式**选择模型路径；**缺失即 legacy 路径**（`ExplicitBlockExtractor`，`xcfg-` 身份） |
| `--operator` | 记录到运行审计；**模型路径下必填**（谁发起了一次模型调用） |
| `--timeout` / `--window-max-chars` | 可选；缺省用契约常量（§M6.2a / §M4.3） |

* **模型路径必须通过显式 `--model` 选择；未提供 `--model` 时保持既有 legacy 默认路径**（§M11.2 / §M13.5 #2）。**不存在**"有适配器就用、没有就退回 `[CANDIDATE]`"的隐式行为；**反向同样成立** —— 一旦给了 `--model` 就**绝不**退回 legacy（§M14.6）。
* 退出码：**0 仅当终态为 `completed` 且候选已落库**；`failed` / `in_progress` / `ADAPTER_NOT_CONFIGURED` 一律**非 0**，并打印机器可读原因（`--json` 时结构化）。
* 执行器放在 `src/cli/research-commands.ts`（与既有 `runCandidateConfirm|Revise|Reject|List|Show|Project` 同构）；`src/cli/tiancha.ts` 只做薄组装（构造 `ResearchDb` / `ResearchRepository` / `CandidateExtractionService`，并注入 extractor 或 adapter）。

**`--model` 的解析顺序（★ 绝不静默退回）**

```text
--model
   ↓ 装配点尝试解析一个可用的 ModelExtractionAdapter
   ├─ 成功 ⇒ service.run(version, at, { ..., model: adapter })
   └─ 失败 ⇒ 抛 ADAPTER_NOT_CONFIGURED ⇒ 命令以非 0 退出
              ★ 不调用 run()、不写任何表、**不**退化为 legacy
```

本片 `resolveModelAdapter()` 的**唯一实现是"没有可用适配器"**（返回 `undefined`）⇒ 生产上 `--model` **必然**以 `ADAPTER_NOT_CONFIGURED` 收口。**这不是缺陷**，而是本片被授权的边界（§M14.0）：它必须**如实**报错，**不得**用任何占位 / 假适配器掩盖。

### §M14.2 模型路径的入口：`run()` 的一个显式参数（**不改 E**）

`CandidateExtractionService.run(version, at, opts)` 的 `opts` 新增**可选** `model?: ModelExtractionAdapter`：

* **给了 `model`** ⇒ 模型路径（§M14.3）；
* **没给** ⇒ legacy 路径（现状不变：`ExplicitBlockExtractor` + 兼容桥 §M13.5a）。

两条路径**共用同一套运行骨架**：`claimRun()`（含 §M13.10 的 completed reuse）→ 取候选 → `persistValidatedCandidates()`（**唯一持久化入口**）→ `finishRun()` / 事务外 fenced `failed`（§M13.9 澄清二）。

* ★ **E 的 async / claim / lease / fencing 语义一字不改**；"候选写入只有一份实现"依然成立 —— 模型路径只是**另一个产出候选的人**，写入仍只走 `persistValidatedCandidates()`。
* ★ 分派是**显式参数**，**不是**环境变量、**不是**"service 里有没有 adapter 字段"的隐式开关 ⇒ "绝不静默退回 legacy"在类型层面即成立。
* `run()` 的最小改造范围：`configKey` 与 `snapshot` 由所选路径决定（§M14.4），改造**仅限本文件**。**不得**为此改动 `CandidateExtractor` 接口（legacy 缝保持不变）。

### §M14.3 模型路径的执行序（A-B-C 接线）

```text
0. claim / lease（与 legacy 同一入口；§M13.10 的 completed reuse 优先）
1. windows = extractionWindowFor(version, rule)                        ← Slice A
2. controller = new AbortController()；超时 ⇒ controller.abort()        ← §M14.5
3. for (const window of windows)                                       ← 逐批，顺序 = window.index 升序
     input = { materialVersionId,
               window: { windowId, index, text },
               windowStartInVersion: window.start,
               dimensionHints,          ← §M14.4（活跃方法论，声明序）
               methodologyVersionId }   ← §M14.4
     batch = await adapter.extractBatch(input, controller.signal)
4. for (const draft of batch.candidates)
     resolved = resolveQuotes(draft.quotes, { windows, maxQuoteChars }) ← V1–V4，零容忍
     units.push({ draft: { dimension, statement, contentKind, confidence? },
                  quotes: resolved })                                   ← §M13.4 的 ValidatedCandidate
5. ★ 先算后写：**全部批次与全部引用校验完成之后**才进写入阶段（§M6.3）
6. persistValidatedCandidates({ version, extractionId, owner, generation,
                                extractionConfigKey: modelKey,          ← §M14.4
                                snapshot, candidates: units })
```

* `dimensionHints` / `methodologyVersionId` **只来自活跃方法论**（§M14.4）；**不由模型决定**，也**不由窗口文本推断**。
* **任一**批次抛错、**任一** quote 被 V1–V4 拒绝 ⇒ 整次运行失败：**零候选 / 零 Fragment / 零 Evidence**（§M6.3 / §M13.4）。
* 批次返回 `candidates: []`（"这段没有候选"）是**合法**结果，不是失败。
* 批次里的 quote 若指向**不属于本版本**的窗口 ⇒ V1 `QUOTE_OUT_OF_VERSION` ⇒ 整次失败。
* **禁止**在模型路径上"边算边写"（先写 Fragment / Evidence 再校验）：那会破坏"全成或全败"。

### §M14.4 `mxcfg-` 身份分派与不可变配置快照

| 路径 | `extractionConfigKey` | 计算处 |
|---|---|---|
| legacy（不变） | `extractionConfigKeyFor({ modelVersion, promptVersion, parserVersion, schemaVersion })` ⇒ `xcfg-…` | 现状 |
| **模型（本片新增）** | `modelExtractionConfigKeyFor({ windowRule, maxQuoteChars, generation, methodologyVersionId, dimensionHints, modelVersion, promptVersion, parserVersion, schemaVersion })` ⇒ **`mxcfg-…`** | F2 |

* **维度与版本的真实来源**：`repo.getActiveMethodology() ?? METHODOLOGY_V1`（与 `report-service` / `research-plan-service` 同法）⇒
  `methodologyVersionId = m.id`，`dimensionHints = m.dimensions.map((d) => d.key)`（**方法论声明序；禁止排序**，§M3.4）。
* 于是"维度集合变了 / 分块参数变了 / 生成参数变了"都会**改变 configKey** ⇒ 改变候选 id（T-C6-30 的模型侧）。
* 两条路径前缀不同 ⇒ **同一材料的两条路径绝不互相覆盖、绝不互相复用**（§M11.2 的可区分性）。**禁止**用 `xcfg-` 冒充模型路径，反之亦然。
* `snapshot`（§M7.3 不可变快照）在模型路径下写**真实值**：`windowRule` · `quotePolicy.maxQuoteChars` · `methodology = { 真实 methodologyVersionId, 有序 dimensionHints }` · `run.batchCount = windows.length` · `run.attemptSeq/generation` · `generation`（**模型生成参数**：本片无真实模型 ⇒ `{}`，由真实适配器契约在接入时补齐，进身份由 `generationHashOf` 负责）。

### §M14.5 超时、取消，以及"timeout ≠ lease failure"

* **一个** `AbortController` 覆盖整次运行；`timeoutMs` 到期 ⇒ `abort()`；`signal` **逐批**传给 `adapter.extractBatch(input, signal)`。
* 适配器义务：收到 abort ⇒ **终止在途请求并尽快 reject**；**不得**忽略 signal 把请求跑完（§M6.2a）。
* 超时 ⇒ 与 legacy 路径**同一语义**：运行记 `failed` + `error` 以 `timeout:` 开头；**行不被收口成 `completed`**，租约自然过期（**E 的裁定不变**）。
* 本系统**不保证**第三方 SDK 真能切断底层连接；保证的是"**不再 await、不使用其结果、不写任何表**"（§M6.2a）。

### §M14.6 `ADAPTER_NOT_CONFIGURED`（失败路径的唯一定义）

* 模型路径**缺少可用适配器** ⇒ 明确失败 `ADAPTER_NOT_CONFIGURED`；**绝不**静默退回 `[CANDIDATE]`；**不写任何表**（§M11.2 / T-C6-36）。
* 该失败发生在**装配层**（§M14.1），即**在 `run()` 之前** ⇒ 不存在"半个模型运行"。
* 本片**不实现**真实适配器，因此本片的生产行为就是"`--model` 明确失败"。契约同时**禁止**：
  * 把任何 fake / mock / echo 适配器装配进生产（**禁止**出现在 CLI 或 `@tiancha/research` 的导出面）；
  * 在任何面向人的输出里把 fake 适配器描述为"模型已接入"。

### §M14.7 确定性 fake 适配器（**仅测试**）

* F2 的端到端证明使用**测试文件内**的确定性 fake 适配器（先例：`phase-c6-model-extraction.test.ts` 的 `DeterministicFakeAdapter`）：
  * 相同输入 ⇒ 逐字相同输出（纯函数）；
  * 引用的 quote **必须是窗口文本的真子串**（否则 V3 会（正确地）拒绝）；
  * 能按脚本**抛错 / 挂起 / 记录是否收到 abort / 计数被调用次数**。
* ★ 它**不得**成为生产导出、**不得**接进 CLI、**不得**写进 `README` / `HANDOFF` 的"能力矩阵"当作模型能力。

### §M14.8 F2 的文件白名单（授权实施时按此锁）

**允许修改 / 新增**

```text
packages/research/src/application/candidate-extraction-service.ts   ← 仅 §M14.2 的 opts.model 分派 + §M14.3 的模型编排 + §M14.4 的 configKey / snapshot 入参
packages/research/src/application/model-extraction.ts               ← 仅在必要时补类型 / 导出；**不得**改 ResolvedQuote 六字段契约与 V1–V4 判定
新增 packages/research/src/phase-c6-model-wiring.test.ts            ← F2 测试矩阵 W-1…W-10 + 测试内 fake 适配器
新增 src/cli/research-candidate-extract.test.ts                     ← 装配层用例（W-11）
src/cli/research-commands.ts                                        ← 新增 runCandidateExtract 执行器
src/cli/tiancha.ts                                                  ← 薄组装（candidate extract 子命令 + ADAPTER_NOT_CONFIGURED 退出路径）
```

**明确禁止**

```text
✗ 把任何模型 SDK / 服务商客户端 / HTTP 客户端引入 packages/research（红线：§M3.4 / §M9 #9）
✗ 真实适配器实现（服务商 SDK、凭据读取、部署标识解析）—— 属另一次单独授权
✗ 修改 F 的任何语义（§M13.2 / §M13.5a / §M13.8 / §M13.9 / §M13.10）
✗ 修改 Slice B 的 ResolvedQuote 六字段契约与 resolveQuotes 的 V1–V4 判定语义
✗ 修改 Slice A 的窗口规则与进身份的常量（WINDOW_RULE_VERSION / maxChars / overlapChars / maxQuoteChars）
✗ 修改 Slice C 的 identity 函数及其 payload 组成（chunkerVersionOf / dimensionSetHashOf / generationHashOf / modelExtractionConfigKeyFor）
✗ 修改 Slice E 的 async / claim / lease / fencing 语义；不得给 ExtractionStatus 增加成员
✗ research-db.ts / 迁移 / 新表 / 新依赖
✗ 投影 / Knowledge / Pool / Gap / Report / Methodology 的写路径 / 其它 CLI 子命令 / Agent 工具面
✗ 把 fake 适配器带进生产代码或生产导出
✗ 顺手同步其它 docs（仅允许本契约与 HANDOFF 的状态行）
```

### §M14.9 F2 测试矩阵（硬门）

| 用例 | 必须证明 |
|---|---|
| **W-1** | 模型路径端到端（fake 适配器）：窗口 → 逐批 → `resolveQuotes` → `ValidatedCandidate[]` → `persistValidatedCandidates()` ⇒ 候选 / Fragment / Evidence 落库，"四者一致"（§M5.3）且 `resolveLocator` 能解析回原文 |
| **W-2** | **逐批**：`extractBatch` 调用次数 = 窗口数；`snapshot.run.batchCount` = 窗口数；批次顺序按 `window.index` 升序 |
| **W-3** | **身份分派**：模型路径产出 `mxcfg-…`、legacy 产出 `xcfg-…`；同一材料两条路径**互不复用**；改变窗口规则 / `maxQuoteChars` / 维度集合 / generation ⇒ configKey 变 ⇒ 候选 id 变（T-C6-30 的模型侧） |
| **W-4** | **零容忍**：任一 quote 触发 V1 / V2 / V3 / V4 ⇒ 整次运行失败、**零候选 / 零 Fragment / 零 Evidence**、`extraction_run.status='failed'`，`error` 指明窗口与 quote 序号 |
| **W-5** | **超时与 abort**（T-C6-34 的模型侧）：适配器永不 resolve ⇒ 运行 `failed` + `timeout:` 前缀；**断言适配器确实收到了 abort**；该行**未被写成 `completed`** |
| **W-6** | **`ADAPTER_NOT_CONFIGURED`**（T-C6-36）：模型路径无可适配器 ⇒ 明确失败、**不写任何表**、**不静默退回** legacy（反例：退回 `[CANDIDATE]` 必须失败） |
| **W-7** | **有效租约内模型调用恰好 1 次**（T-C6-37 的模型侧）：两个独立连接并发 ⇒ 只有 1 条模型调用序列；未抢到者 `in_progress` |
| **W-8** | **completed reuse（模型路径）**：同配置第二次调用 ⇒ `reusedRun = true`、**`extractBatch` 调用次数不增加**、`extraction_run` 行逐字不变 |
| **W-9** | **维度来自活跃方法论**：`dimensionHints` 等于活跃方法论的**声明序**（不排序）；`methodologyVersionId` 进快照与身份 |
| **W-10** | **legacy 仍可用**：不带 `--model` 经**同一** `persistValidatedCandidates()` 落库；两条路径的候选 id 不同（`xcfg-` vs `mxcfg-`） |
| **W-11** | **装配层边界**（CLI）：`--model` ⇒ 非 0 退出 + `ADAPTER_NOT_CONFIGURED`；`--json` 含机器可读原因；**未写任何表** |

**测试纪律**（沿用 C6 标准）：断言**行为 / 身份 / 指纹**，不断言文案；每条反例必须证明"**零残留**"；至少一次 **mutation 反证**（例如把"整车 abort"改成"只对第一批传 signal" ⇒ W-5 必须失败）。

### §M14.10 F2 的边界自检（越界即打回）

```text
✗ 不接真实模型（无 SDK / 无凭据读取 / 无部署标识解析）
✗ 不让 fake 适配器进入生产代码或生产导出
✗ 不改 F 的语义、不改 Slice A/B/C/D/E 的任何已冻结契约
✗ 不给 ExtractionStatus 增加成员；不动 claim / lease / fencing
✗ 不让模型产生 id / stance / fragmentId / evidenceId / 维度（§M5.2 / §M14.3）
✗ 不在模型路径上"边算边写"（先算后写，§M6.3）
✗ 不把候选写进 Claim / Knowledge / Pool / Report —— 候选仍需**人工确认**
```

### §M14.11 本片未授权 / 接下来

* **未授权**：**真实模型适配器**（服务商 SDK + 凭据来源 + 部署标识 + 生成参数进身份 + 重试与成本上限）· 原文切片 · U-1/U-2/U-3 · Wind · 自动发现 · Phase D。
* 若要有真实模型，须**另立契约**并**单独授权**：提示词版本策略、服务商选型、凭据来源、失败重试策略、成本上限、部署标识的稳定性边界（§M7.3 的 `modelVersion` 要求）。
* 受控试点（先用已有试点材料建立人工核对基准，再选真实普通报告验证漏提 / 误提 / 引用错位 / 重复口径）**排在真实模型接入之后**；合成冲突仍只用于隔离库软件测试。

---

## §M12 修订历史

| 版本 | 变更 |
|---|---|
| **rev13** | **Slice F2 实施契约（§M14 新增；纯文档，未实现）**：把 §M13.5 的 F2 清单六项落成可执行条文，**不改动 §M0–§M13 的任何规则**（rev11 的四条收紧、§M13.7 矩阵、rev12 的 F 状态校准逐字保留）。**§M14.0** F2 = 缝 + 生产装配 + 失败路径 + 端到端骨架；★ **F2 不接真实模型**（用户 2026-09-29 裁定；真实适配器属另一次单独授权），且 F2 首次为候选提取建立**生产入口**（此前生产代码零构造点）。**§M14.1** 命令面 `tiancha research candidate extract <materialVersionId> [--model] [--operator] [--timeout] [--window-max-chars] [--json]`；执行器入 `src/cli/research-commands.ts`、薄组装入 `src/cli/tiancha.ts`；**Research Core 不 import 模型 SDK**；**模型路径必须由显式 `--model` 选择（未给 `--model` 则保持 legacy 默认路径，这不是隐式 fallback）**；`--model` 解析不到适配器 ⇒ **`ADAPTER_NOT_CONFIGURED`**、非 0 退出、**不写任何表、绝不退回 legacy**。**§M14.2** `run()` 新增**可选** `opts.model?: ModelExtractionAdapter`：给了走模型路径、不给走 legacy，两条路径**共用** claim / lease / **唯一持久化入口** / finish；分派是**显式参数**（非环境变量、非隐式开关）⇒ **E 的语义一字不改**；改造仅限该文件。**§M14.3** 模型路径执行序：`extractionWindowFor` → 逐批 `extractBatch(input, signal)` → `resolveQuotes`（V1–V4 零容忍）→ 组装 `ValidatedCandidate[]` → **先算后写** → 一次 `persistValidatedCandidates()`；批次内空候选合法；跨版本 quote ⇒ V1 ⇒ 整次失败。**§M14.4** `mxcfg-` 身份分派：`modelExtractionConfigKeyFor({ windowRule, maxQuoteChars, generation, methodologyVersionId, dimensionHints, … })`；维度与版本取自 `repo.getActiveMethodology() ?? METHODOLOGY_V1`（**声明序、禁止排序**）；两条路径前缀不同 ⇒ 互不复用、互不覆盖；快照写真实值。**§M14.5** 单个 `AbortController` 覆盖整次运行、signal 逐批传递、适配器必须响应 abort、**timeout ≠ lease failure**。**§M14.6** `ADAPTER_NOT_CONFIGURED` 发生在**装配层**（`run()` 之前）；禁止把 fake 适配器装配进生产、禁止称其为"模型已接入"。**§M14.7** fake 适配器**仅测试内**。**§M14.8** F2 文件白名单（service 最小改造 · `model-extraction.ts` 仅补类型 · 新增 `phase-c6-model-wiring.test.ts` 与 `src/cli/research-candidate-extract.test.ts` · `research-commands.ts` · `tiancha.ts`）+ 禁止项（SDK/真实适配器/F 语义/Slice A–E 契约/DB/迁移/投影/其它 CLI/Agent 面）。**§M14.9** F2 测试矩阵 **W-1…W-11**（端到端 · 逐批 · 身份分派 · 零容忍 · abort · ADAPTER_NOT_CONFIGURED · 租约内恰好 1 次 · completed reuse · 维度来源 · legacy 仍可用 · 装配层退出码）。**§M14.10/§M14.11** 边界自检与"真实模型仍未授权" |
| **rev12** | **F 状态校准**（纯文档，**无任何契约语义变化**）：**rev11 的四条收紧语义与 §M13.7 测试矩阵逐字保留、未改一字**；本行只把事实状态校准到与远端一致，并**完整保留**审计链 —— `22b3951` 首次实现（唯一持久化入口 + reviewed protection 的 SQL 守卫 + completed reuse）⇒ 被独立复核 **REJECTED FOR REPAIR**（三个阻塞项：persistence 异常未入 `failed` 收口 · close-out 顺序 · legacy bridge 边界；其 `phase-c6-persistence.test.ts` 后经查为**实现副本、0 个用例**，22b3951 声称的「F-1…F-16 全绿 / 535 全量」不可复现——实测 522 tests / 521 pass / 1 fail）⇒ **`1554054`**（rev8–rev11 的契约收紧，docs-only、先于代码修复）⇒ **`a5b80a4`** 完成三处修复（① **只读** ① gate + ⑦ 最终 fenced `completed` close-out；② persistence 异常 ⇒ **事务外 fenced `failed`**；③ 受保护候选**先判定、零 Fragment/Evidence 写入**）+ **交付真正的 F-1…F-17 测试矩阵**（17 例：含 F-12 的**顺序探针**、F-13/F-14 的口径拆分、F-17 的端到端失败，以及三条 **mutation 反证**）⇒ 通过独立复核 ⇒ **Slice F ACCEPTED / FROZEN**（`origin/main = a5b80a4`，ahead/behind 0/0；全量 538/538、135 suites）。**F2（模型链路接线）仍未授权** |
| **rev11** | **F 修复轮的契约收紧**（纯文档，无代码变化）：Slice F 已实现（`22b3951`）但被独立复核 **REJECTED FOR REPAIR**（三个阻塞项：persistence 异常未入 `failed` 收口 · close-out 顺序 · legacy bridge 边界）。本轮把修复口径写进契约 —— **① §M13.2**（BLOCKING 附带项）受保护候选的判定必须在**为该候选生成任何 Fragment / Evidence 之前**完成：`protected ⇒ skippedReviewed`，**零 Fragment / Evidence 副作用**；`persistQuotes()` 之后再 `isProtected()` **不合规**。**② §M13.5a（新增；BLOCKING-2 选 (a)）** legacy `[CANDIDATE]` 路径的 `CandidateDraft → ValidatedCandidate` **确定性兼容桥**归 **F 的最小 compatibility wiring**（模型路径的 `ValidatedCandidate[]` 组装仍归 **F2**），四项硬限制：只能有一处桥（`run()` → `persistValidatedCandidates()` 之间）· 只用 `dimension` / `statement` / `contentKind` / `confidence` / `evidenceRefs` · `quotes` 只能由已有 `evidenceRefs` **确定性反查**（evidence → fragment → locator / text / textHash），**禁止从 quote 反推任何语义** · **不得修改 `ResolvedQuote` 六字段契约**且**不得为了桥重调 B**。**③ §M13.9 澄清一（BLOCKING-3）** ① fencing gate 与 ⑦ 最终 fenced `completed` close-out 是**两个步骤**：① 可为 SQL 存在性判定但**不得修改任何状态**，**⑦ 才是最终权威**（`changes() !== 1` ⇒ `LostLeaseError` ⇒ rollback）；「先写 `completed` 再写业务行」不合规。**④ §M13.9 澄清二（BLOCKING-1）** persistence 异常 ⇒ 事务 **rollback**（`extraction_run` 回到 `running`）⇒ **事务外** fenced `failed` 收口（复用既有 `finishRun` 的四条件谓词）；`changes() === 0` **安全忽略**；**业务异常是主错误，`failed` 收口是 best-effort 但必须 fenced**，不得泄漏未处理 reject，也不得新增第二套状态机；**不得**认为"回滚 ⇒ 自动 `failed`"。**⑤ §M13.9 澄清三 / 澄清四** 桥只能有一处；受保护候选**先判定再写入**（细化步骤 ②–⑤）。**⑥ §M6.3 / §M13.4 同步** 步骤编号对齐 ①–⑦，`failed` 收口明确标注**仍受 fencing 约束**。**⑦ §M13.7 测试矩阵** **F-5 加严**（stale owner 不能完成 persistence / 不能写 `completed` / 零业务残留 / 不覆盖新 owner 状态，且 ⑦ 必须存在）· **F-13 明确**（rollback ⇒ `failed` + `error != null` + `candidate_ids_json = []` + `fragment` / `fragment_evidence` / `claim_candidate` 零新增）· **新增 F-17**（`run()` ⇒ 桥 ⇒ persist 抛错 ⇒ `RunResult.status === "failed"` · `reusedRun === false` · DB `failed` · 业务表零残留）。**F2 仍未授权**；本轮 Step A 为 **docs-only**，**先于**代码修复提交（Step B 白名单：`candidate-extraction-service.ts` · `phase-c6-persistence.test.ts` · `phase-c6-run-claim.test.ts`） |
| **rev10** | **§M13.9 / §M13.10 落定**（纯文档，无代码变化）：把两处"F 实现前必须先锁定的语义"写成正式条文 —— **§M13.9 F 的持久化入口**：F 的持久化能力必须由 `CandidateExtractionService` 上一个**新的 async 方法** `persistValidatedCandidates(input: { version, extractionId, owner, generation, extractionConfigKey, snapshot, candidates })` 暴露；它完成 §M13.4 的 1–7 步，**全部在同一主库事务**内，任一 persistence unit 抛错即整体回滚、`failed` 更新在事务之外；`run()` 保留 E 的 async / claim / lease / fencing / extractor 职责并**经由该唯一入口**写候选；**候选写入只能有一份实现**（禁止在 F 测试或新路径复制第二套）。**§M13.10 §M7.1 completed reuse 的落点与 Slice E 测试迁移**：明确该行为自 rev3 起即在契约内但 **Slice E 未实现** ⇒ **属 Slice F 的交付内容**（对应 `reusedRun` / F-16），**不是**重开或修改 Slice E；`completed` 判断必须发生在**创建任何新 attempt 之前**（`run()` 入口或 `claimRun()` 内，但需处于无竞态的原子边界）；命中时 `reusedRun = true`、复用既有 `candidateIds`、**不调用** `extract()`、不新建/不修改 `extraction_run`、不产生任何 Fragment / Evidence / ClaimCandidate 与 downstream mutation，候选级计数保持为 0。因该行为变化，允许**调整** `phase-c6-run-claim.test.ts` 中"已 completed 后继续创建 attempt 2/3"这类场景的**前置构造**，但必须**完整保留** `attemptSeq` 进身份 / 同 `attemptSeq` 同 id / `started_at` 不参与身份 / takeover 产生新 generation·attempt / 旧 generation 被 fencing 阻断这五项测试目标；除该测试文件外不得改动 Slice A/B/C/D/E 的其它测试与生产文件。F-16 的"复用不抽取"用现有 `CandidateExtractor.extract()` 的 **counting stub**，**不得接入** `ModelExtractionAdapter` |
| **rev9** | **Slice F Contract Clarification 的修订**（纯文档，无代码变化）：**BLOCKING-1** —— §M13.4 的 F 输入由「唯一输入 = `ResolvedQuote[]`」改为「**已验证候选 payload + `ResolvedQuote[]`**」，并定义 `ValidatedCandidate { draft: { dimension, statement, contentKind, confidence? }, quotes: ResolvedQuote[] }`；理由：`ResolvedQuote`（Slice B 冻结）**只有六字段**，不含 `statement` / `dimension` / `contentKind`，而候选身份依赖它们 ⇒ 原表述**输入契约不闭合**，实现时只能三选一且都错。同时锁死 **不得修改 `ResolvedQuote` 的六字段契约**、**不得把 draft 字段塞进 `ResolvedQuote`**、**F 不重新生成/解析候选内容**。**NON-BLOCKING-1** —— F-3 措辞由「任一 batch 失败」改为「**任一 persistence unit 在落库过程中抛错 ⇒ 整个主库事务回滚**」（F 不是模型 batch executor）。**NON-BLOCKING-2** —— F-16 明确 `completed` 复用的 zero side effect **包括 `extraction_run` 本身**（不新建 attempt、不改既有 `completed` 行），并给出反例 |
| **rev8** | **Slice F Contract Clarification**（纯文档，无代码变化）：新增 **§M13**，把 F（持久化与原子收口）/ F2（模型链路接线）拆分锁死，并解决 preflight 审计的 5 个必须先定口径的问题 —— **C-F-1** `reusedRun: boolean`（整次运行被复用）与 `reused: number`（候选级复用计数）**分列**，`skippedReviewed: number` 独立；**C-F-2** reviewed protection 判据收紧为 `reviewStatus !== "draft" OR reviewed_by IS NOT NULL`（覆盖"`revise` 有意保持 `draft` 但写 `reviewedBy`"的情形）；**C-F-3** Repository **SQL** 守卫是 reviewed protection 的最终防线（允许改 `research-repository.ts`，仅限该守卫）；**C-F-4** F 的输入是 `ResolvedQuote[]`，不含模型调用；**C-F-5** F2 负责 A/B/C 接线 / `mxcfg-` 身份分派 / `AbortController` + 逐批 `signal` / `ADAPTER_NOT_CONFIGURED`。附 F 文件白名单（§M13.6）与测试矩阵 F-1…F-16（§M13.7）。**不重开 Slice E**（`AbortController` 归 F2） |
| **rev7** | **实施期文档同步**（纯 docs，无代码变化）：§M5.3 明确**实施切片边界** —— `startGlobal` / `endGlobal` / `fragmentLocator` / `quoteHash` / `quoteText` 由 **Slice B 计算**，而 `fragmentId` / Fragment 文本 / `evidenceId` / `stance` / 落地方式由 **Slice F 生成并落库**（附 Slice A/B/F 归属表与已验收 commit）；表头由"生成"改为"**计算**，并在 Slice F 写入时**生成**"；§M10 的 `T-C6-31` / `T-C6-32` 标注 **`(unit)` 子集已落地于 Slice B**，含 Fragment 的端到端语义仍属 Slice F。**目的**：避免后续实施者误以为 Slice B 应已生成身份 |
| **rev6** | **第五轮审查意见的收口**（§M2.5）：**迁移的原子性与可安全续跑**（§M7.1b）—— 整段迁移**一个事务**（失败 `ROLLBACK`，结构与数据指纹不变）+ **每步幂等**兜底（回填只处理 `IS NULL` 且编号从该分组 `MAX+1` 起；降级只匹配当前仍 `running` 且缺租约的行）；并核实记录 `migrate()` 本身不开事务 ⇒ 该迁移**需自带事务边界** |
| **rev5** | **第四轮审查意见的收口**（§M2.4）：① **历史 `extraction_run` 行的迁移规则**（§M7.1b）—— 加列后历史 `running` 行的 `owner`/`lease_until` 为 `NULL` ⇒ `>= now` 与 `< now` **都不成立** ⇒ **卡死认领**；旧库多条同配置 `running` 会让**建索引失败**；规则为「加列 → 回填 `attempt_seq`/`generation` → 无租约的历史 `running` 标 `failed`/`legacy_interrupted`（**不删不静默**）→ 仍冲突则 **FAIL FAST 列出冲突行** → **最后**建索引」；§M9 #4c/#4b；新增 **T-C6-38**；② **跨接管幂等键构成更正**（不含 `attemptSeq`，§M7.1a ⑤） |
| **rev4** | **第三轮审查意见的收口**（§M2.3）：① **超长段落末片吞分隔符**（否则其后 `\n{2,}` 无人覆盖、并集有缺口），且 **`maxChars` 只约束正文**；② **原子认领落到可执行机制**（INSERT 新尝试行 · 部分唯一索引 `WHERE status='running'` · 单事务四步认领 · 三种情况的数据库结果表 · 提交带 `generation` 校验）；③ **修正"模型调用恰好一次"**（与租约接管矛盾）：有效租约内只一个持有者调用 · 接管后允许重复请求 · 只有当前代次能提交；④ **并发测试用两个独立进程/连接**，接管用例断言旧代次**零残留**；⑤ **快照新增 `generation` 对象**并参与配置身份，`promptVersion` 只管提示词；⑥ **成本提示更正为显式基准**（`600` vs 零重叠 `+42.9%`；`600` vs `500` `+7.1%`） |
| **rev3** | **第二轮审查意见的收口**（§M2.2）：① **窗口覆盖规则拆分**（段落组窗口首尾相接 / 超长段落切片重叠 / 全文按**区间并集**检查无缺口；不变量 I4–I6 按窗口种类分别断言）；② **同配置并发互斥**（§M7.1a 原子认领 + 租约 + 代际 token）；③ **运行身份**改用 `attemptSeq`（`startedAt` 只作审计字段）；④ **审计升级为不可变配置快照** `config_snapshot_json`；⑤ **`dimensionHints` 顺序**定为方法论声明序（不排序），`dimensionSetHash` 对**同一有序列表**计算；⑥ **删除"同版本必须可复现"**的过强承诺；⑦ 文档收尾（§M10 标题、全仓日期 `2026-09-27`） |
| **rev2** | **第一轮审查意见的四处补齐**（§M2.1）：① **引文即 Fragment**（精确 `char_range`）+ 更正 `fragmentEvidenceIdFor` 的 `stance` 参数 + "四者一致"不变量；② **分隔符归前一窗口** ⇒ 窗口覆盖全文；明确**坐标单位 = UTF-16 code unit**；补配置约束；明确**首版不承诺跨段落组边界的整条引文**；③ **配置身份与运行审计**补入分块器 / **方法论版本** / **维度集合 hash** / **`maxQuoteChars`**，审计保留原值；④ **重跑语义收紧**为"已有成功运行 ⇒ 复用，不再调用模型"。另：`stance` 的语义与**审核界面可见性**（§M5.5）· 超时的**边界与取消**（`AbortSignal`，§M6.2a）· 删除无法失败的"不连续"检查并补 V4（长度上限）验收 · T-C6-33 改为**完整下游状态指纹** · 新增 T-C6-37 |
| **rev1** | 首版（DESIGN ONLY）：D-C6-H/I/J 三项裁定落为可执行规则 —— 窗口协议（`para-greedy-v1` + 重叠 + 规则进身份）· 模型输出 schema 与 V1–V5 引用校验 · 异步化与"全成或全败"单事务 · 不覆盖已审核候选 · 验收 T-C6-29…T-C6-36 · 改动清单（含 `chunker_version` 加列） |

**End of contract（rev13: §M14 = Slice F2 实施契约（生产装配点 / 模型路径入口 / A-B-C 接线 / `mxcfg-` 身份分派 / abort / `ADAPTER_NOT_CONFIGURED` / F2 白名单 / 测试矩阵 W-1…W-11）—— 契约语义仍以 rev11–rev12 为准、逐字未改；★ **F2 不接真实模型**；**F2 契约已定、实现未授权**。Slice A–E 已验收（E 已 FROZEN）；Slice F 已冻结（`22b3951` → REJECTED FOR REPAIR → `1554054` → `a5b80a4` ⇒ ACCEPTED / FROZEN）；真实模型适配器 · 原文切片 · Phase D 未授权）.**
