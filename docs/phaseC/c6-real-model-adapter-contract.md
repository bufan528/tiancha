# Phase C6 · Real Model Adapter / Provider Implementation Contract（D-RMA-*）

> 状态：**rev6 — 纯文档、DESIGN ONLY、未实现、未授权实施**。本文件**不实施任何代码**，也**不修改**任何既有契约。
> 基线：**`6bbb26b`**（C6 F2 生命周期 CLOSED / FROZEN；`origin/main`；验证 550/550 · 137 suites）。
> 前置契约：[`docs/phaseC/c6-model-extractor-contract.md`](c6-model-extractor-contract.md)（**rev13**：§M1–§M14，其中 §M14 = F2 实施契约，**已实现并发布**）· [`docs/phaseC/c6-implementation-contract.md`](c6-implementation-contract.md) §C6.18–§C6.27（资料闭环）· [`docs/HANDOFF.md`](../HANDOFF.md) §10（**LLM 边界红线**）。
> **rev2 依据**：用户 2026-09-29 的正式 A–R Contract Audit —— rev1 判为 **BLOCK / FINAL LOCK = NO**，并给出 15 项 BLOCKER + 6 项 SHOULD FIX（见 §R17）。rev2 **只把 rev1 已正确的架构方向精化为可实施、可测试、无歧义的条文**；不推翻 rev1 的架构结论。
> **rev3 依据**：用户 2026-09-29 的 **Final Lock Audit** —— rev2 判为 **不通过**（4 个阻塞 + 2 个验收细节）：① **schema 如何到达 adapter 未闭合**（`ModelBatchInput` 不含 schema，而 §R12.2 又禁止改它）；② **GenerationIdentity 与 snapshot 字段映射对不上**（provider/model/deployment 可读值无落点，§R5.3 的重建判据不成立）；③ **包导出白名单漏了 `index.ts`**（CLI 无法引用新 adapter）；④ **§R15.2 五项未裁决**（含本地无认证实例的边界）；⑤ T-RMA-27 缺可执行方案；⑥ 失效交叉引用与 CLI 层分类未定。rev3 逐条闭合（见 §R17 的 rev3 行）。
> 一句话：**把已经存在的 `ModelExtractionAdapter` 缝接到一个真实 provider 上**。不新增研究能力，不改变数据模型，不改变 F2 的任何冻结语义。

---

## §R0 范围与红线

### §R0.1 范围（本片做什么）

```text
CandidateExtractionService.run(version, at, { model })
        │
        │  ModelExtractionAdapter            ← F2 已冻结的缝（§M3.4 / §M14.2）
        ▼
   RealModelAdapter（本片的新增构件之一）      ← provider boundary 的实现
        │
        ▼
   provider transport（一个 provider 实例）     ← 唯一的真实外部依赖
```

**本片唯一新增的业务能力是"Real Model Adapter / Provider 接入"**；transport、credential 解析、error mapper、provider 配置等，都是**同一个 provider boundary 内的实现构件**，不构成新的业务能力。
（rev2 修正：rev1 写"唯一的新构件"，与后面允许新增 transport / credential / errors 自相矛盾 —— 见 §R17 的 A1。）

本片交付**四样东西**：

1. **一个真实 provider 实例的 adapter 实现**，满足 F2 已冻结的 `ModelExtractionAdapter` 接口（§R1.4 的 profile / instance 区分）；
2. **provider boundary 内的构件**：credential 解析（§R2）、部署/模型身份（§R3）、请求/响应映射（§R4）、generation 参数（§R5）、abort 传播（§R6）、错误分类与协议（§R7）、能力声明（§R1.5）；
3. **生产装配点**：把 `resolveModelAdapter()`（当前恒 `undefined`，§M14.6）接到真实 adapter 上；
4. **adapter 专属测试 + mutation probes**（§R13）。

### §R0.2 不做的事（红线，越界即打回）

- ❌ **多 provider**：不做 provider 注册表、不做 provider 间 fallback、不做 routing、不做"自动选择更便宜的模型"。
- ❌ **隐藏 retry**：不做未经契约批准的自动重试（§R8）。
- ❌ **不改数据模型**：`ClaimCandidate` / `Claim` / `Fact` / `Knowledge` / `PoolItem` / `Evaluation` / `ResearchTarget` / `Methodology` / `Report` / `Dossier` 一个字段都不动。
- ❌ **不改 DB schema**：不新增表、不新增列、不改索引、不加 migration。
  （rev2 修正：rev1 在这里写了"唯一例外见 §R9.4"，会被读成"本片已开一个 schema 例外"。**本片没有任何 schema 例外**；若将来确需持久化 execution telemetry，必须**另立契约 + 单独授权 migration**，不在本片内。见 §R17 的 G10。）
- ❌ **不改 CLI 研究体系**：不动 `research` 的其它子命令；**`--json` 的既有形状不变**（`{status, reason, …}` 的字段名与结构都不动）。v1 **只允许** `reason` 的**取值域**按 §R7.1 的闭集扩展，并在**未装配**时保持既有 `ADAPTER_NOT_CONFIGURED`（§R7.5）。
- ❌ **不做新业务功能**：不做自动研究、不做 report 生成、不做 Knowledge writeback、不做 methodology 演化。
- ❌ **不碰 Slice E / Slice F 的冻结语义**（§R0.3 逐条列出）。
- ❌ **不把 LLM 输出直接变成 `Claim` / `Fact` / `Knowledge`**（HANDOFF §10 红线；模型只能**起草**带来源定位的候选，且必须人工确认 —— §M8 下游红线不变）。
- ❌ **不做"本地模型优先"的架构绑定**：本地 provider（LM Studio / Ollama）只能作为**某个 provider instance**，不得成为 Tiancha 的架构前提（§R11.3）。
- ❌ **不新增 port**：本片不为了"架构整齐"而新建 `ports/*.port.ts`（§R12.1 / §R17 的 M2）。

### §R0.3 与 F2 的关系：只填空位，不改语义

F2（`cf74576`）已经冻结了下列性质。**本片必须继承、不得改动**：

| # | F2 已冻结的性质 | 出处 | 本片的义务 |
|---|---|---|---|
| 1 | `ModelExtractionAdapter` 是模型进入系统的**唯一**缝；它没有存储、没有 id 生成能力 | §M3.4 | 不得给 adapter 任何写入口 |
| 2 | 模型路径由 `run(opts.model)` 的**显式参数**触发；无 env 开关、无隐式 fallback | §M14.2 | 保持不变（`--model` 仍不得退化成 legacy） |
| 3 | **compute-first**：所有窗口抽取 + 所有 quote 校验完成**之后**才有唯一一次写入 | §M14.3 / §M6.3 | 不得改成"边抽边写" |
| 4 | **单一持久化入口** `persistValidatedCandidates()` | §M13.9 | 不得新增第二条写路径 |
| 5 | V1–V4 零容忍：**第一条**失败 quote ⇒ **整次**失败 | §M5.3 | 不得降级为"跳过坏候选" |
| 6 | 两条路径身份隔离：`mxcfg-…`（模型）vs `xcfg-…`（legacy），互不复用、互不覆盖 | §M14.4 / §M11.2 | 不得让两条路径共享身份 |
| 7 | `generationHash` 必须**真的进入**最终身份（hard gate #11） | §M7.3 / §M14.4 | 本片填的 generation 必须真的进身份（§R5.4） |
| 8 | timeout **两层语义**：`RunResult.status = "failed"` **≠** `extraction_run.status`（后者保持 `running`、`finished_at = NULL`，由 lease 自然过期） | §M14.5 | 不得合并这两层、不得"顺手修" |
| 9 | lease / fencing：`status='running' AND generation=? AND owner=?` 是 SQL 的 WHERE 谓词 | §M7.1a | 不得绕过 |
| 10 | 同配置 `completed` ⇒ **复用**（不重复调用模型，零副作用） | §M7.1 / §M13.10 | 本片不得让复用路径变成"还会调一次模型" |

**本片允许在"F2 预留的空位"上填值 —— 且只允许以下四处**（rev6 把 rev2–rev5 的"三处"更正为"四处"：S1 核查发现第 4 处此前被遗漏）：

1. `candidate-extraction-service.ts` 中 **模型路径** 的 `generation: {}`（identity 与 snapshot 各一处）⇒ 换成 adapter 的 `generationParams`（§R5.4）；
2. `candidate-extraction-service.ts` 的 `snapshotFor()` 中 **模型路径** 的 `model.{modelVersion,promptVersion,parserVersion}` 当前取自 `this.extractor`（legacy 提取器）⇒ 换成 **adapter 的对应值**，使模型路径的"快照身份"与"配置身份"同源（§R5.5；rev2 新增，见 §R17 的 N8）；
3. `src/cli/research-commands.ts` 中 `resolveModelAdapter()` 恒返回 `undefined` ⇒ 接上真实 adapter（§R1.4 / §R1.5 / §R4.3）；
4. **★ rev6 补齐（S1 核查发现）**：`candidate-extraction-service.ts` 的 `claimRun()` 在 INSERT `extraction_run` 时，把 `this.extractor.modelVersion` / `this.extractor.promptVersion` 写入该行的**身份列** —— 这是 legacy 与模型路径的**共用点**。模型路径必须改为写 **adapter 的对应值**（§R5.5 的路径归属表 + §R12.2）。

**除这四处以外，F2 的已发布行为不得改变。** 任何"顺手优化 F2"都视为越界。
**legacy 路径不在这三处之中**：legacy 的 `extractionConfigKey`（`xcfg-`）、`generation: {}`、`snapshot.model.*` **一个字节都不得移动**（§R13 的 T-RMA-24 硬门）。

### §R0.4 本片是 `packages/research` 第一次引入外部网络边界（rev2 新增）

事实（已核实）：该包**当前零网络** —— 全包没有 `fetch` / `http` / `axios` / `undici` 调用。

因此本片冻结以下边界：

```text
production：research → provider transport → network
tests     ：research → 可注入 transport → 【零真实网络】
```

- 全部硬门测试**必须**能在无网络环境通过（§R13.0）；
- 必须有一条 **guard**：测试期间若发生真实网络调用 ⇒ 测试**失败**（§R13 T-RMA-27）；
- 真实联网验证不属于本片硬门（属于 §R16 的回放片）。

---

## §R1 Provider 边界（D-RMA-A / D-RMA-N）

### §R1.1 分层与依赖方向

```text
packages/research/src/application/       ← domain / application（不得知道任何 provider 细节）
        CandidateExtractionService
                │  ModelExtractionAdapter（接口，已冻结）
                ▼
        <provider adapter>               ← 本片新增；provider 细节只允许出现在这里
                │
                ▼
        <provider transport>             ← 本片新增；HTTP/SDK 细节只允许出现在这里
```

**依赖方向是单向的**：application 层不得 import provider adapter 或 transport；adapter 可以 import 接口。

### §R1.2 research domain 不得知道的清单

以下内容**只允许**出现在 adapter / transport 层，**绝不允许**泄漏到 `CandidateExtractionService`、`ModelBatchInput`、`ModelBatchResult`、`CandidateDraft`、`ValidatedCandidate`、`ExtractionConfigSnapshot`、候选持久化、report、CLI 输出：

```text
provider 名称 / 厂商（除 §R3 规定的身份字符串字段外）
SDK 类型、SDK 对象、SDK 的 request/response 类型
API URL / endpoint / path
HTTP method / header / Authorization / Bearer token
provider-specific 的 request options（如 vendor 专有字段）
provider 的原始 response 对象 / 原始错误对象
deployment 的内部 id / 账号 id / 组织 id
credential 的任何形态
```

**判定标准**：如果一个字段只有在"知道是哪家 provider"时才有意义，它就不属于 application 层。

### §R1.3 强制机制（不是注释）

契约要求**可执行的**边界，而不是文档承诺：

1. **类型边界**：application 层不新增任何 provider 相关类型；adapter 只通过已冻结的接口（`ModelExtractionAdapter` + §R5.4 的最小扩展）与上层通信。
2. **架构断言测试**：一条测试扫描 `packages/research/src/application/` 下**除 adapter 文件外**的源码，断言其中不出现 provider 标识（vendor 名、endpoint、`Authorization` 等），且不 import adapter 模块（§R13 T-RMA-13）。
3. **唯一入口断言**：`run()` 的模型路径只能通过 `ModelExtractionAdapter` 得到候选（§R13 T-RMA-16）。

### §R1.4 Provider **profile** 与 Provider **instance**（★ rev2 术语分离；A 冻结）

rev1 把"OpenAI-compatible HTTP"与"一个 provider"混用，会导致后面出现"LM Studio / Ollama / vLLM / DeepSeek 到底是 provider 还是 profile"的混乱。rev2 冻结两个层级：

```text
Provider Profile   = 协议形态。v1 冻结为：OpenAI-compatible HTTP（/v1/chat/completions 风格）
Provider Instance  = 一个具体的 endpoint + deployment 配置（base URL、model 名、deployment 名）
```

**D-RMA-A（已冻结，rev2）**：首版 profile = **OpenAI-compatible HTTP**（纯 HTTP，无 vendor SDK）。
理由：provider-agnostic 的底线是"transport 可替换"；同一实现可指向本地（LM Studio / Ollama / vLLM）与远程兼容端点；"先本地、后远程"是**配置变化**而非代码重写。

**v1 只接一个 provider instance**（§R11）。profile 是可替换的**协议**，不是"多家 provider 已接入"。

### §R1.5 Tiancha Required Provider Capability（★ rev2 新增；D-RMA-N 冻结）

> rev1 只写了"OpenAI-compatible"，那是一个**标签**，不是 contract —— 不同兼容服务对 structured output / abort / usage 的支持程度完全不同。

**v1 的能力契约（唯一权威）**：

| 能力 | v1 要求 | 不满足时 |
|---|---|---|
| **structured output**（provider 原生 JSON schema / `response_format` 等价机制） | **REQUIRED** | **fail closed**（见下） |
| **AbortSignal 传播**（请求可被 caller 的 signal 中止） | **REQUIRED** | **fail closed**（见下） |
| usage telemetry（token 用量等） | OPTIONAL | 缺失不影响可用（§R9） |
| streaming | **UNUSED / 不用**（v1 完全不用流式） | 若 provider 只支持流式实现该能力 ⇒ 视为不满足 REQUIRED |
| tool calling / 多模态 / 其它 provider 特性 | **UNUSED** | 不得被本片使用 |

**★ fail closed 的确切含义**（不得有任何变体）：

```text
能力检查不通过
      ↓
【不发起任何 provider 调用】
      ↓
以 capability/configuration 类错误失败（§R7）
      ↓
零业务残留
```

**禁止**：

```text
❌ structured output 不支持 ⇒ 自动退 JSON-in-prompt ⇒ 偷偷继续
❌ abort 不支持 ⇒ 用内部超时/忽略 signal 继续
❌ 运行期静默切换执行模式
```

**判定时机（rev2 冻结）**：能力检查发生在 **adapter 装配时**，即 `resolveModelAdapter()` 构造阶段，依据 adapter 的**静态能力声明**（capability declaration）。
- 声明不足以覆盖 REQUIRED ⇒ **装配失败**：`resolveModelAdapter()` **抛出**带 `code` 的 `ProviderError`（`capability_unsupported` / `configuration`），由 `runCandidateExtract()` 的装配段捕获并映射（§R7.5）。**未装配**（本 build 没有 adapter）仍返回 `undefined` ⇒ 该语义不变。两者**不得混同**：`ADAPTER_NOT_CONFIGURED` 只表示"没有 adapter"（§R2.3 / §R7.3）。
- 声明与运行时事实不符（例如声明了 structured output 但 provider 返回"不支持该参数"）⇒ 归 `invalid_request` / `capability_unsupported`，**不得**降级、**不得**重试成另一种模式。

**v1 不允许 structured-output downgrade**（D-RMA-K 冻结，rev2 改死；rev1 的"允许但进身份"作废）：见 §R4.4。

### §R1.6 `ModelResolverPort` 隔离（★ rev2 新增；架构硬边界）

**事实（已核实）**：repo 已存在 [`packages/research/src/ports/model-resolver.port.ts`](../../packages/research/src/ports/model-resolver.port.ts)：

```ts
export interface ResolvedModel { model: string; thinkingLevel: string; }
export interface ModelResolverPort {
  resolve(role: AgentRole, modelPolicy: ModelPolicy): Promise<ResolvedModel>;
}
// 注释原文："Backed by Pi's ModelRegistry/ScopedModel in the impl."
```

它是 **agent / runtime 的模型策略解析**（按角色与策略选模型 + thinkingLevel），与本片的 **extraction provider / model 身份**是**两套职责**。

**冻结（Architecture BLOCKER，不得以"复用既有代码"为由绕过）**：

```text
Agent runtime 模型解析      → ModelResolverPort   （既有，保持不变）
Candidate extraction 供给   → ModelExtractionAdapter → 真实 provider adapter（本片）
```

**禁止**：

```text
❌ RealModelAdapter → ModelResolverPort → Pi ModelRegistry（把 runtime 策略拖进 extraction）
❌ extraction identity ← ModelResolverPort.resolve(...)
❌ 用 ModelResolverPort 解析本片的 provider / model / deployment
❌ 让两套解析互相取值、共享缓存、共享"当前模型"状态
```

**理由**：否则会产生**两个模型真相源** —— `mxcfg-` 身份会被 agent runtime 的策略变化（与 extraction 行为无关）污染，reuse 语义随之失效。

**v1 不允许新增替代 port**（§R17 的 M2）：不需要 `ports/model-extraction.port.ts` 之类的第二层抽象；`ModelExtractionAdapter`（`application/model-extraction.ts`）已是唯一缝。

---

## §R2 Credential 来源（D-RMA-B）

> 这一节被认为**比"用哪个模型"更重要**：它决定 Tiancha 会不会在无意中把密钥写进业务状态或日志。

### §R2.1 来源、查找算法与优先级（★ rev2 精化）

**v1 支持的来源（只有两种）**：

```text
① env    —— 进程环境变量（单一、明确的变量名；变量名在 Final Lock 冻结）
② file   —— 项目外部的 credential 文件（路径由环境变量给出；文件不在仓库内、不在工作区数据库旁）
```

**rev2 明确删除 rev1 的"③ 本地 provider 的既有配置"**：对 OpenAI-compatible HTTP profile 而言，"本地 provider 自带配置"**不是统一协议的一部分**，把它写进契约会让不同实现各写一套。若将来要支持，须另立裁定。

**查找算法（冻结，命中即停）**：

```text
1. 若 ① 的变量已设置且非空 ⇒ 用它
2. 否则若 ② 的路径变量已设置且非空 ⇒ 读取该文件
3. 否则 ⇒ 视为"未配置"（missing）
```

**行为语义（冻结）**：

| 情形 | 行为 |
|---|---|
| 两个来源都未设置 | `missing` ⇒ 装配期分类为 `configuration`（§R7.3）；**不发起任何 provider 调用** |
| ② 的路径已设置但文件不存在 / 不可读 | `invalid` ⇒ 装配期分类为 `configuration`；**失败信息不得包含路径以外的任何内容**（不得回显文件内容） |
| 来源值解析失败（格式非法） | `invalid` ⇒ `configuration` |
| 来源存在但被 provider 拒绝（401/403） | 运行期 ⇒ `authentication`（§R7.1） |

**不允许**：命令行参数直接传密钥（会进 shell history / 进程列表）、把密钥写进仓库内任何文件、把密钥写进 `tiancha.sqlite` / artifact store。

**变量名（rev3 冻结，D-RMA-B）**：

```text
① TIANCHA_MODEL_API_KEY            —— 密钥（env）
② TIANCHA_MODEL_CREDENTIAL_FILE    —— 密钥文件路径（env；文件内容为单行密钥）
③ TIANCHA_MODEL_AUTH_MODE          —— "api-key"（默认） | "none"
```

**★ 本地无认证实例（rev3 冻结，闭合 B/J 的边界）**：

```text
"无认证"不是"credential 缺失"，而是【显式选择的执行模式】：
  - 缺失 credential 且 AUTH_MODE 未显式设为 "none" ⇒ configuration 失败（【不得】隐式无认证）
  - AUTH_MODE = "none" 只允许 endpoint 为【回环地址】（127.0.0.1 / ::1 / localhost）；
    非回环 ⇒ 装配期 configuration 失败
  - authMode 必须进入 Identity（§R3.1 / §R5.0）⇒ 否则 "none" 与 "api-key" 打到同一 endpoint
    会被当作同一配置复用（两种执行模式混同）
```

### §R2.2 绝对禁止（逐条可断言）

| # | 禁止 | 断言方式（§R13） |
|---|---|---|
| 1 | 密钥出现在**源码**中 | T-RMA-1（扫描新增源码，无字面量密钥形态） |
| 2 | 密钥写入 **SQLite**（任意表、任意列） | T-RMA-2（全表 dump + 扫描） |
| 3 | 密钥写入 **`config_snapshot_json`** | T-RMA-2（解析 snapshot 后扫描） |
| 4 | 密钥写入 **report / dossier / 候选 / evidence** | T-RMA-2 |
| 5 | 密钥写入 **log / stderr / 控制台输出** | T-RMA-3（捕获 stdout/stderr 后扫描） |
| 6 | 密钥写入 **error message / `RunResult.error`** | T-RMA-3（含失败路径） |
| 7 | 密钥进入**身份**（AdapterIdentity / RequestIdentity） | T-RMA-4（改 credential 不改变 `mxcfg-`） |

### §R2.3 失败语义

- credential `missing` / `invalid` ⇒ **诚实失败**（装配期 `configuration`，见 §R2.1 表）；provider 拒绝 ⇒ 运行期 `authentication`。
- **`resolveModelAdapter()` 不得因为"credential 缺失"而返回 `undefined`**：那会让上层错误地报成 `ADAPTER_NOT_CONFIGURED`（语义污染）。两者的区分是硬要求：

```text
没有 adapter（本 build 未装配）        → ADAPTER_NOT_CONFIGURED
有 adapter，但 credential 缺失/非法     → configuration
adapter + credential 均就绪，被 provider 拒绝 → authentication
```

- 失败消息必须**可诊断但不泄密**：可以说"变量 `X` 未设置"或"认证被拒绝（HTTP 401）"，**不得**回显密钥的任何前缀 / 长度 / 片段。

### §R2.4 与业务状态的关系

**credential 不属于 extraction business state。** 即使把 `extraction_run` 整行 dump、把 `config_snapshot_json` 整个导出、把工作区数据库交给别人，也**不得**出现 credential。本片不得引入任何"为了审计而记录凭证"的机制。

---

## §R3 Deployment / Model 身份（D-RMA-C / D-RMA-R）

### §R3.1 身份字段与 canonical 形式（★ rev2 重写）

adapter 必须向上提供**真实请求身份**，其**逻辑**字段至少包含：

```text
provider          → profile/厂商标识（稳定字符串）
model             → 模型名（稳定字符串）
deployment        → 部署/端点标识（稳定字符串）
endpointIdentity  → 该 provider instance 的 canonical 端点标识（★ rev2 新增，见下）
adapterVersion    → 本 adapter 实现的版本（稳定字符串）
```

**★ rev2 加入 `endpointIdentity` 的理由（D-RMA-R 冻结；rev1 存在身份漏洞）**：
rev1 允许 `baseURL` 只作为 adapter 配置、不进身份。于是：

```text
deployment = "qwen-local"
第一次 baseURL = http://localhost:1234
第二次 baseURL = http://localhost:5678
⇒ provider / model / deployment 相同 ⇒ mxcfg- 相同 ⇒ 但实际打的是两个不同端点
```

⇒ **污染 reuse**。rev2 冻结：

> **所有会改变实际 ProviderRequest 路由或行为的非敏感配置，必须具有身份归属。**

`endpointIdentity` 的构造规则（冻结）：

```text
由 base URL 经 canonical 化得到：
  - scheme 小写
  - host 小写；端口为默认值时省略
  - 路径去掉尾部 "/"
  - 不含 query / fragment（若配置里出现 ⇒ 视为非法配置）
  - 不含任何 credential / token / 用户信息（userinfo 一律禁止 ⇒ 非法配置）
```

**同一 `deployment` 名 + 不同 endpoint ⇒ 必须是不同的 `mxcfg-`**（§R13 T-RMA-25 硬门）。

**canonical serialization（★ rev2 冻结；不得字符串拼接猜格式）**：

```text
禁止：
    ❌ 让实现层自己拼 "provider:model:deployment" 并猜解析规则
       （deployment 里若含 ":" 会产生歧义）
    ❌ 新增 realModelIdentityKey() / 第二套身份函数或第二个前缀

要求：
    Identity 字段（provider / model / deployment / endpointIdentity / adapterVersion）
        → 结构化对象
        → 经【既有】stableStringify() + sha256Hex()（model-extraction-config.ts 既有能力）
        → 得到 identityHash
        → 作为【既有】身份输入 modelVersion 的值（形如 "pid-<hash>"，具体前缀由 D-RMA-C 冻结）
```

- `snapshot.model.modelVersion` 与 `mxcfg-` 的 `modelVersion` 输入**必须是同一个 canonical 值**（§R5.5）。
- 身份字符串**不得**含时间、随机数、进程信息、本机路径（否则 reuse 永不命中）。
- 段级归一：NFKC + trim；不得依赖运行环境的 locale / 大小写规则（host 归一在 §R3.1 的 endpoint 规则里完成）。

### §R3.2 「什么变化必须产生新身份」表（rev2 补行）

| 变化 | 是否必须产生**新的** `mxcfg-` 身份 | 由谁承担 |
|---|---|---|
| provider / model / deployment | ✅ 必须 | 本片（经 §R5.4 / §R5.5 进 `mxcfg-`） |
| **endpointIdentity（base URL 的 canonical 形式）** | ✅ **必须**（rev2 补，D-RMA-R） | 本片 |
| `adapterVersion` | ✅ 必须 | 本片 |
| temperature / top_p / max_tokens / seed | ✅ 必须 | 本片（生成参数，F2 的 hard gate #11 已就位） |
| prompt / template 版本 | ✅ 必须 | 本片（`promptVersion` 已是身份输入） |
| `schemaVersion` | ✅ 必须 | **Tiancha 拥有**（§R4.3） |
| window rule（版本 + 常量） | ✅ 必须 | **F2 已承担**（不得重复实现） |
| `maxQuoteChars` | ✅ 必须 | **F2 已承担** |
| methodology 版本 + **有序** dimension set | ✅ 必须 | **F2 已承担** |
| **非敏感的 provider 专用路由/行为配置**（rev2 补） | ✅ 必须 | 本片（走 `endpointIdentity` 或显式身份字段） |
| token 用量 / latency / request id / finishReason | ❌ **不得** | 执行事实，进身份会让 reuse 永不命中（§R5.0 / §R9.3） |
| credential | ❌ 不得 | §R2.4 |
| 调用次数（含 retry 次数） | ❌ 不得 | 执行事实，不是配置身份（§R8.3） |
| structured-output **模式** | ❌ 不得（v1 只允许一种，§R4.4） | 模式是常量 ⇒ 由 `parserVersion` / `adapterVersion` 承担 |

### §R3.3 与 F2 身份体系的去重边界

F2 已经承担：window rule · `maxQuoteChars` · methodology 版本 · 有序 dimension set · `modelVersion` / `promptVersion` / `parserVersion` / `schemaVersion` · `generationHash`。

**本片不得**：新增第二套身份函数、新增第二个身份前缀、把 provider 身份写成"额外的兼容字段"塞进 `xcfg-` 域、或让两条路径的身份可比。

**本片只做**：让 AdapterIdentity 与生成参数 **进入既有的 `modelExtractionConfigKeyFor()` 输入**（§R5.4 / §R5.5），并保持 `mxcfg-` 前缀不变。

### §R3.4 硬门（必须用 mutation probe 反证）

契约要求**"变化真的进身份"**，不是"字段被定义了"。实施时必须证明（§R13 T-RMA-9/10/11/25）：

```text
只改 deployment        ⇒ mxcfg- 必须变化
只改 model             ⇒ mxcfg- 必须变化
只改 base URL（endpointIdentity） ⇒ mxcfg- 必须变化   ← rev2 新增
只改 temperature       ⇒ mxcfg- 必须变化
只改 max_tokens        ⇒ mxcfg- 必须变化
只改 adapterVersion    ⇒ mxcfg- 必须变化
只改 token 用量        ⇒ mxcfg- 必须【不变】
只改 latency           ⇒ mxcfg- 必须【不变】          ← rev2 新增
只改 requestId         ⇒ mxcfg- 必须【不变】          ← rev2 新增
只改 finishReason      ⇒ mxcfg- 必须【不变】          ← rev2 新增
只改 credential        ⇒ mxcfg- 必须【不变】
```

每一条都必须有**真实的**失败-再来验证（mutation probe：故意把该字段从身份里摘掉，测试必须失败）。

---

## §R4 请求 / 响应 Schema（D-RMA-D）

### §R4.1 Tiancha Input ↔ ProviderRequest 的映射

**Tiancha 侧输入是冻结的**（`ModelBatchInput`，§M3.4），本片**不得**修改它：

```text
ModelBatchInput
 ├─ materialVersionId      （Tiancha 身份；不进 provider 请求，除非确有必要——默认【不进】）
 ├─ window { windowId, index, text }
 ├─ windowStartInVersion
 ├─ dimensionHints[]       （methodology 的【声明顺序】，不得排序）
 └─ methodologyVersionId
```

```text
        │ adapter mapping（本片实现，必须显式、可测）
        ▼

ProviderRequest（adapter 内部形态，不出边界）
 ├─ model / deployment / endpoint
 ├─ messages（system + user；模板版本 = promptVersion）
 ├─ generation 参数（temperature / top_p / max_tokens / seed …）
 ├─ structured output schema（= Tiancha 拥有的 schema，见 §R4.3）
 └─ provider-specific options（不出边界）
```

**映射规则**：

- `window.text` 是**唯一**的素材正文来源；不得额外拼接其它窗口的内容（避免跨窗口上下文污染 —— §M4 的窗口协议不变）。
- `dimensionHints` **按声明顺序**原样进入 prompt；不得排序、不得去重、不得让模型自创维度（§M3.4）。
- `materialVersionId` / `windowId` **默认不进入** provider 请求：它们是 Tiancha 身份，模型不需要它们就能引用文本（它引用的是 `windowId` + 偏移，由 Tiancha 校验）。若某个 provider 的 prompt 设计确实需要窗口标识，必须是**可复现的固定映射**，且进 prompt 模板版本（`promptVersion`）。

### §R4.2 ProviderResponse → `ModelBatchResult` 的规范化（严格）

规范化必须**拒绝而不是猜测**：

| 情况 | 必须的行为 |
|---|---|
| response 不是合法 JSON / 无法解析 | **抛错**（分类 `malformed_response`，§R7）；**不得**重试成"空结果" |
| 缺少 `candidates` | **抛错**；**不得**当成"本窗口没有候选" |
| `candidates` 为空数组 | **合法**（"本窗口没有候选"，§M14.3 已规定） |
| 某候选缺 `dimension` / `statement` / `contentKind` | **抛错**；**不得**填默认值 |
| `dimension` 不在 `dimensionHints` 内 | **抛错**（模型不得自创维度） |
| `contentKind` 不是 `"fact" \| "judgment"` | **抛错**；**不得**默认成 `fact` |
| `confidence` 越界 / 非数字 | **抛错**；**不得**截断 |
| `quotes` 缺失 / 空 | **抛错** |
| quote 缺 `windowId` / `startInWindow` / `endInWindow` / `text` | **抛错**（**不得**在 adapter 里补全偏移） |
| response 中出现 `fragmentId` / `evidenceId` / `candidateId` / `claimRef` 等 id 字段 | **丢弃**这些字段（它们不可能进入 `ModelCandidateDraft` 的类型），且**不得**据此建立任何映射 |
| response 里有额外的未知字段 | **忽略**（不进入上层），**不得**透传 |
| 模型输出了"已确认""approved"之类的语义 | **无意义**：人工确认是 Tiancha 的闸门（§M8），模型不能自我批准 |

**★ 绝对禁止：Provider response 直接进入候选持久化。** 唯一的通路是 §R10 的顺序。

### §R4.3 schemaVersion 的**唯一 owner**（★ rev2 重写；D-RMA-D 冻结）

> rev1 把 `schemaVersion` 写成"service 侧 vs adapter 报告"两个选项 —— 那会让契约留下"第二个 schema 权威"，出现"身份说 v2、校验按 v1"的错位。rev2 消灭它。

**冻结**：

```text
Extraction Output Contract（模型输出应当满足的结构）属于【Tiancha】，不属于 provider。

Tiancha owns：
    - schema 的定义
    - schemaVersion
    - 对输出的结构校验（V1–V4 前后的结构判定）

adapter：
    - 【消费】Tiancha 给出的 schema（把它翻译成 provider 的 structured-output 形式）
    - 不得拥有、不得声明、不得覆写 schemaVersion
```

因此：**`schemaVersion` 的取值来源只有一个** —— 既有的 service 侧 `schemaVersion`（`CandidateExtractionService` 的 `options.schemaVersion ?? DEFAULT_SCHEMA_VERSION`）。adapter **不得**提供第二个 `schemaVersion`。

| 版本标识 | 含义 | owner | 是否进身份 |
|---|---|---|---|
| `schemaVersion` | 输出结构契约版本 | **Tiancha（service 侧，唯一来源）** | ✅（F2 已是身份输入） |
| `promptVersion` | prompt / template 版本 | 本片（adapter 报告） | ✅ |
| `parserVersion` | 解析 / 规范化 provider response 的版本 | 本片（adapter 报告） | ✅ |
| `adapterVersion` | adapter 实现版本 | 本片（§R3.1） | ✅ |
| `modelVersion` | canonical provider identity（§R3.1） | 本片 | ✅（F2 已是身份输入） |

**硬规则**：任何"会改变输出或被接受范围"的版本都必须进身份，且**只有一个来源**。
若实施时出现"adapter 也能提供 schema 版本"的设计 ⇒ **越界**（§R13 T-RMA-22 会杀死它）。

**★ schemaVersion 必须由 Tiancha 解析【一次】（rev4 冻结）**：

```text
service resolves schemaVersion exactly once
        ↓
ExtractionOutputContract（version + schema）
        ↓
adapter（消费）
        ↓
snapshot.model.schemaVersion
        ↓
mxcfg- 身份

禁止：
    ❌ 在多处重复写 `options.schemaVersion ?? DEFAULT_SCHEMA_VERSION` 这类表达式
      （今天看起来一样，将来改默认值或改解析点就会出现第二个真相源）
    ✅ 解析出的【同一个值】既注入 ExtractionOutputContract，又进 snapshot 与身份
```

**★ schemaVersion → schema 的一对一稳定性（rev4 冻结）**：

```text
schemaVersion 是 schema 内容的【不可变版本标识】：
  - 同一个 schemaVersion 在本片及后续版本中【不得】指向不同的 ExtractionOutputContract.schema 内容；
  - schema 内容发生任何会影响 provider 请求或输出验收的变化 ⇒【必须】创建新的 schemaVersion；
  - 【不得】原地修改旧版本的 schema。
```

⇒ 使 `schemaVersion → schema → provider request` 成为一条**可重放的确定链**（T-RMA-22 已加对应断言）。

**★ schemaVersion → adapter 的【唯一数据流】（rev5 钉死；Final Lock 的 P0-B）**：

rev4 同时冻结了"Service 解析一次"与"装配期注入 adapter"，但没有钉死一个事实：**装配发生在 `run()` 之前**。于是产生必须回答的问题 —— adapter 在 assembly 阶段从哪里拿到那个已解析的 `schemaVersion`？rev5 冻结唯一合法链路：

```text
① CandidateExtractionService 构造时解析 schemaVersion 【恰好一次】
        ↓
② 该 service 暴露一个【只读】成员  outputContract: ExtractionOutputContract
   （同一份值；不得在任何地方重复解析同一个表达式）
        ↓
③ CLI 装配层把它作为【只读输入】交给  resolveModelAdapter(outputContract)
        ↓
④ RealModelAdapter 构造时【只读持有】该 contract
        ↓
⑤ run() 写 snapshot.model.schemaVersion 时使用【同一个】已解析值
```

**禁止（把三种旁路全部封死）**：

```text
❌ adapter 自己解析 schemaVersion（owner 从 Service 漂到 assembly）
❌ resolveModelAdapter() 自己解析 schemaVersion（同上）
❌ 先创建 adapter、之后 setSchema(...) 注入（可变配置 / 第二个生命周期 / schema 可被替换）
❌ adapter 提供、覆写、放宽 schema 或 schemaVersion
❌ 在 assembly 之后替换 schema contract（contract 在 adapter 生命周期内不可变）
```

**因此 `resolveModelAdapter()` 的签名（rev5 冻结）**：

```ts
resolveModelAdapter(outputContract: ExtractionOutputContract): ModelExtractionAdapter | undefined
```

- 参数是**只读**的 Tiancha 侧契约；
- 返回值语义仍遵循 §R7.5 的三条互斥路径（undefined / 抛 ProviderError / adapter）。
- **这是"补 F2 预留的装配空位"，不是修改 F2 语义**：该函数在 F2（§M14.1 / §M14.6）中唯一的既定性质是"模型路径唯一的 adapter 解析点、且当前恒 `undefined`"；本片只是把它接到真实 adapter 上（§R0.3 的第 3 处接入点）。

**★ schema 如何到达 adapter（rev3 新增；rev2 的阻塞缺口）**：

rev2 只说"adapter 消费 Tiancha 的 schema"，却没有规定 schema **怎么交给 adapter**：`ModelBatchInput` 不含 schema，而 §R12.2 又禁止改它 —— 结果 adapter 只能把 schema 写死在自己内部，那等于**adapter 拥有 schema 定义**（正是 §R4.3 要禁止的）。仅凭 `schemaVersion` 字符串，adapter 无法重建 schema。

**v1 冻结（不改 `ModelBatchInput`）**：

```text
Tiancha 侧新增一个【只读】的输出契约对象：
    ExtractionOutputContract = { version: schemaVersion, schema: <结构化 JSON schema 定义> }
    位置：packages/research/src/application/extraction-output-contract.ts（§R12.1 白名单）
    version 的唯一来源 = 既有 service 侧 schemaVersion（§R4.3；不新增第二个版本号）
    schema 的内容 = 与既有的 ModelCandidateDraft 形状一致（模型应当返回什么）

传递方式：
    在【adapter 装配时】由 Tiancha 注入 adapter（构造参数 / 只读依赖）
    adapter 只能【消费】：把 Tiancha 的 schema 翻译成 provider 的 structured-output 形式

禁止：
    ❌ adapter 内部持有自己的 schema 定义（哪怕是"等价的"）
    ❌ adapter 覆写 / 放宽 / 改名 schema 的内容
    ❌ 把 schema 塞进 ModelBatchInput（会改 F2 冻结的输入类型）
    ❌ 让 schema 的内容成为 provider 配置的一部分
      （provider 配置里只允许"如何表达 schema"的形式参数）
```

因此 **T-RMA-22 的断言对象扩展**为"请求实际使用的 schema 就是 Tiancha 提供的那个"（§R13.1 已改写）。

### §R4.4 structured output 模式（★ rev2 重写；**v1 禁止降级** — D-RMA-K 冻结）

**v1 只有一种执行模式**：

```text
provider 原生 structured output（JSON schema / response_format 等价机制）+ 严格解析
```

**v1 禁止任何降级**：

```text
provider 不支持 structured output
        ↓
fail closed（§R1.5）
        ↓
分类为 capability/configuration 错误
        ↓
零业务残留
```

**禁止**（rev1 曾把"降级但进身份"列为可选 ⇒ 现作废）：

```text
❌ native structured output 不支持 ⇒ 退到"prompt 约定 + 自己 parse JSON"
❌ 任何运行期静默/显式切换执行模式
```

**理由（rev2 冻结记录）**：降级不是"多一个 fallback"，而是**引入第二种 provider execution semantics**：两套测试矩阵、两种 malformed-response 面、两种能力判断、后续 provider 差异扩大。v1 不承担这个复杂度。将来若要支持，**另立契约**。

---

## §R5 Generation：identity / snapshot / telemetry（D-RMA-E / D-RMA-O）

> 这是本片**最值得认真设计**的部分：F2 故意留下 `generation: {}`，正是因为真实模型还没接。

### §R5.0 概念分层：**三个实际对象**（★ rev4 命名统一；D-RMA-O 冻结）

rev2 引入的 `GenerationIdentity` 是个**概念描述**，不是第三个 runtime/domain object。若把它当成平级的第三个对象，实施时极易写出三个互相复制字段的 interface。rev4 把命名钉死：

```text
概念（描述用，不落成对象）：
    GenerationIdentity ≈ "决定输出应该长什么样的配置身份"
    → 它在实现上【就是】AdapterIdentity + RequestIdentity 的字段集合，不新增 interface
    → ★ 【不得】作为代码符号出现（无 `interface GenerationIdentity` / `type GenerationIdentity`
      / class / factory / 变量名）；rev5 已在 §R5.4 用真实成员名 `adapterIdentity` +
      `generationParams` 钉死 adapter 侧要提供的东西

runtime/domain 实际对象（v1 只有三个）：
    (1) AdapterIdentity     —— adapter 声明"我是什么"（§R5.1(A)）；adapter 的必填只读成员
    (2) RequestIdentity     —— 服务组合后"这一次请求是什么"（§R5.1(B)）
    (3) ExecutionTelemetry  —— 执行事实（每次调用都不同）
```

```text
(1) AdapterIdentity（adapter 声明）
    provider · model · deployment · endpointIdentity · adapterVersion · authMode

(2) RequestIdentity（= (1) + Tiancha 侧字段 + 生成参数）
    (1) 全部字段
    promptVersion · parserVersion（adapter 报告）
    schemaVersion（【Tiancha 提供】）
    temperature · topP · maxOutputTokens · seed

(3) ExecutionTelemetry（执行事实）
    requestId · providerRequestId · latency
    inputTokens · outputTokens · totalTokens
    attempts · finishReason
```

**分层规则（冻结）**：

```text
(1) AdapterIdentity
    → 经 identityHash 成为 modelVersion 的值（§R3.1 / §R5.5）
    → 可读形式进 snapshot 的 generation.extra.adapterIdentity

(2) RequestIdentity
    → 进 snapshot（§R5.5 的唯一落点表）
    → 进 mxcfg- 身份 —— 【只能】经 F2 既有机制（§R5.5 的最终身份不变量）

(3) ExecutionTelemetry
    → 永不进身份（不得进 ModelGenerationParams、不得进 mxcfg-）
    → 永不进 ExtractionConfigSnapshot
    → 永不进业务持久化
    → v1 不跨越 adapter 边界向上传递（§R9.4）
```

**接口层要求**：`ModelExtractionAdapter` 的扩展必须把两者作为**两个独立的成员/概念**，**不得**用同一个对象混装（例如把 `latency` / `usage` 塞进 generation 参数对象）。
**边界案例（rev2 明确）**：`finishReason = timeout|aborted` 属于 ExecutionTelemetry —— **不得**因为某次运行超时就把"timeout"写进 AdapterIdentity 或生成参数。

### §R5.1 两个层次的身份：AdapterIdentity 与 RequestIdentity（rev3 重写）

必须能回答："**六个月后重新打开这次 extraction，我知不知道当时到底用了什么模型、什么参数、什么 prompt/schema？**"

rev2 把"adapter 声明的身份"与"服务组合后的请求身份"混成一个清单，并把 `schemaVersion` 错列为 adapter 的必填项。rev3 冻结为两个概念：

```text
(A) AdapterIdentity —— adapter 声明"我是什么"（由 adapter 提供的【必填只读成员】，§R5.4）
    provider · model · deployment · endpointIdentity · adapterVersion
    + authMode（§R2.1 的 "api-key" | "none"）
    可选：modelRevision 等（provider 支持时）

(B) RequestIdentity —— 服务组合后"这一次请求是什么"（= (A) + Tiancha 侧字段 + 生成参数）
    (A) 的全部字段
    promptVersion · parserVersion    ← adapter 报告
    schemaVersion                    ← 【Tiancha 提供】（§R4.3；adapter 不参与、不得列入 adapter 必填）
    temperature · topP · maxOutputTokens · seed   ← 生成参数（adapter 报告）
```

**原则**：**足够复现身份，不保存不必要的 provider 噪声或敏感信息。**
每个字段在 snapshot 中的落点是**唯一**的（§R5.5 的唯一落点表），且 `§R5.3` 的"仅凭 snapshot 重建请求"只针对 **(B)** 成立。

### §R5.2 禁止进入身份 / Snapshot 的字段

```text
❌ credential（任何形态）
❌ ExecutionTelemetry 的任何字段（requestId / latency / usage / attempts / finishReason）
❌ provider 原始 response（原文，尤其是 raw JSON）
❌ provider 的 HTTP headers
❌ 账号 id / 组织 id（若属敏感标识）
❌ 任何"模型输出的原始文本"（它已经以候选 + quote 的形式被验证并持久化）
❌ 时间戳 / 随机数 / 进程信息 / 本机路径
```

### §R5.3 可复现性判据

实施时必须能用 snapshot **独立重建**当时的请求（除 credential 外），并证明：

```text
同一 snapshot + 同一窗口文本  ⇒  同一 ProviderRequest 形态（字段级一致）
```

这条必须是**测试**（§R13 T-RMA-17），不是文档承诺。

### §R5.4 接入点一：`generation: {}` 的替换规则

F2 当前在**模型路径**写 `generation: {}`（配置身份计算与 snapshot 两处）。本片必须把它换成 adapter 提供的**真实值**，且遵守：

1. **只改模型路径**。legacy `[CANDIDATE]` 路径的 `generation: {}` **不得**改动。
2. **★ 成员名与类型在此钉死（rev5；消除 rev4 的自相矛盾）**：`ModelExtractionAdapter` **只新增两个必填只读成员**，且**不得**新增 `GenerationIdentity` 的 `interface` / `type` / `class` / factory 或任何 runtime 符号（`GenerationIdentity` 只是**概念术语**，见 §R5.0）：

```ts
interface ModelExtractionAdapter {
  // —— F2 既有成员（形状不变；仅 `modelVersion` 的【值语义】由本片规定）——
  readonly modelVersion: string;   // 本片语义：canonical provider identity 串 = `pid-<identityHash>`
  readonly promptVersion: string;
  readonly parserVersion: string;
  extractBatch(input: ModelBatchInput, signal: AbortSignal): Promise<ModelBatchResult>;
  // —— ★ 本片新增（必填、只读、结构化）——
  readonly adapterIdentity: AdapterIdentity;          // (§A)，见 §R5.1(A)
  readonly generationParams: ModelGenerationParams;   // temperature / topP / maxOutputTokens / seed（既有类型）
}
```

- `AdapterIdentity` 是**本片新增的一个只读结构化类型**（字段见 §R5.1(A)），定义在 `application/model-extraction.ts`（§R12.2 白名单）；除此之外**不得**新增任何身份类符号。
- `adapterIdentity` 与 `modelVersion` 必须**一致**：`modelVersion === "pid-" + sha256Hex(stableStringify(adapterIdentity))`（复用既有能力；T-RMA-32 用 mutation probe 钉死）。
- 若做成**可选**成员，"忘了提供"会静默退回 `{}`，正好把 F2 的 hard gate #11 打穿 ⇒ **必须必填**。
3. **identity 与 snapshot 必须用同一个不可变值**（不允许"身份用真实值、快照写空"或反之）。该值经既有的 `generationHashOf()`（§M7.3 的 hard gate #11）进入 `mxcfg-` —— 本片**不得**新增第二个哈希函数或第二个身份域。
4. **值必须可稳定序列化**：`stableStringify` 会拒绝 `undefined` / `NaN` / `Infinity` / `bigint`（既有行为）。adapter 提供的值不得含这些；缺省字段应当**省略**而不是填 `undefined`。
5. **接口扩展的连带改动必须显式列出并授权**：`ModelExtractionAdapter` 是多处测试 fake 实现的接口，扩展它会要求那些 fake 也提供该成员。这类改动**只允许"加成员"**，**不得**改变任何既有断言的语义（§R12.2 逐条列出）。

### §R5.5 接入点二：按**现有类型**的精确字段映射（★ rev2 新增）

> rev2 要求"不要让实施阶段再决定字段到底放哪里"。以下是**基于现有类型**（已核实，非想象）的映射；若实施时发现类型与此不符，**必须先回到契约**，不得自行改结构。

**现有类型（已核实）**：

```ts
// application/model-extraction-config.ts
interface ModelGenerationParams { temperature?; topP?; maxOutputTokens?; seed?; toolConfig?; extra?; }
interface ExtractionConfigSnapshot {
  windowRule; quotePolicy;
  model: { modelVersion; promptVersion; parserVersion; schemaVersion };   // ← 四个 string 字段
  generation: ModelGenerationParams;
  methodology; run;
}
```

**映射（冻结，**不新增类型字段**）**：

```text
ExtractionConfigSnapshot.model
 ├─ modelVersion   ← canonical provider identity（§R3.1 的结构化 → identityHash）
 │                    ★ 与 mxcfg- 的 modelVersion 输入【同一个值】
 ├─ promptVersion  ← adapter.promptVersion
 ├─ parserVersion  ← adapter.parserVersion
 └─ schemaVersion  ← Tiancha（service 侧，§R4.3；adapter 不参与）

ExtractionConfigSnapshot.generation
 ├─ temperature / topP / maxOutputTokens / seed   ← (§B) 的生成参数
 └─ extra.adapterIdentity                         ← (§A) AdapterIdentity 的【可读形式】（对象）
      = { provider, model, deployment, endpointIdentity, adapterVersion, authMode }
```

**唯一落点表（rev3 冻结；每个必需字段恰好一个落点）**：

| (§B) RequestIdentity 字段 | snapshot 落点 | 备注 |
|---|---|---|
| provider / model / deployment / endpointIdentity / adapterVersion / authMode | `generation.extra.adapterIdentity.*` | **可读形式**（§R5.3 重建请求所需的可读值） |
| 上述五者的**身份哈希** | `model.modelVersion`（= `pid-<identityHash>`） | 与 `mxcfg-` 的 `modelVersion` 输入**同一个值** |
| promptVersion | `model.promptVersion` | adapter 报告 |
| parserVersion | `model.parserVersion` | adapter 报告 |
| schemaVersion | `model.schemaVersion` | **Tiancha 提供**（§R4.3）；adapter 不参与 |
| temperature / topP / maxOutputTokens / seed | `generation.*` | 缺省省略（不得填 `undefined`） |

（v1：structured output 模式是常量 ⇒ 不额外落字段；若将来放开，必须在此处与身份同步落地。
 因此 §R5.3 的"同一 snapshot + 同一窗口文本 ⇒ 同一 ProviderRequest"成立：可读身份 + 生成参数 + 窗口文本齐备。）

### §R5.6 【最终身份不变量】（★ rev4 钉死；P0-1）

> 这是整个 RMA 最容易演变成"看起来没绕过 F2、实际又造了一套身份系统"的地方。rev4 用一个不变量把它钉死。

```text
【最终身份不变量】

RMA 【不】计算 mxcfg-。

RMA 只提供三个输入：
  1. AdapterIdentity        → 经 identityHash 成为 modelVersion 的既定值（§R3.1）
  2. adapter 提供的生成参数  → temperature / topP / maxOutputTokens / seed
  3. Tiancha 拥有的版本      → promptVersion / parserVersion（adapter 报告）+ schemaVersion（Tiancha 解析一次）

最终 mxcfg- 【必须且只能】继续由 F2 已存在的
    modelExtractionConfigKeyFor(...)
及其既有的
    generationHashOf(...)
计算 —— 输入形态就是该函数【今天的签名】（§M7.3 / §M14.4），不改签名、不改语义。

因此：
  - RMA 不新增 identity / hash / key 函数（无 realModelIdentityKey() 之类）；
  - RMA 不新增 mxcfg- 前缀、不新增第二套身份域；
  - RMA 不直接拼接 mxcfg- 字符串；
  - 同一个 RequestIdentity 必须得到同一个既有 mxcfg-；
  - 任一 RequestIdentity 输入变化，若该字段属于既有 identity 输入，则 mxcfg- 必须变化。
```

**身份链（v1 唯一形态）**：

```text
AdapterIdentity ──identityHash──► modelVersion ─┐
promptVersion / parserVersion ──────────────────┤
schemaVersion（Tiancha 解析一次）────────────────┼─► modelExtractionConfigKeyFor(...) ─► mxcfg-
generation parameters ──generationHashOf(...)──►─┘        （F2 既有函数，未改）
```

**钉它的测试**：T-RMA-4 / 9 / 10 / 11 / 14 / 25 / 26 直接落在这个不变量上；若实施时出现"自算 mxcfg-"的实现，T-RMA-16 与上述 mutation probes 必须失败。

**★ rev2 新发现并冻结的接入点（N8）**：`snapshotFor()` 当前把 `model.{modelVersion,promptVersion,parserVersion}` 硬编码为 **legacy 提取器** 的值（`this.extractor.*`），而**配置身份**用的是 **adapter** 的值 ⇒ 模型路径会出现"快照身份 ≠ 配置身份"。
**冻结**：模型路径必须让二者**同源**（都取 adapter）；legacy 路径**保持不变**。
**取证（已核实，rev2 记录）**：F2 的 W 矩阵只断言 `snapshot.run.batchCount` 与 `snapshot.methodology.*`，**没有**断言 `snapshot.model.*` ⇒ 该修正**不改变任何既有断言的语义**。

### §R5.7 `this.extractor` 引用的【路径归属表】（★ rev6 新增；Final Lock 的 S1）

> S1 的目的：防止实施时把"legacy 与模型路径共用"的引用当成 legacy 专属（或反之），从而被 T-RMA-24（legacy 逐字节不变）打回。

**已核实**（`packages/research/src/application/candidate-extraction-service.ts`）：`this.extractor` 共 **3 处、4 行**：

| 位置 | 代码 | 归属 | 本片是否可动 |
|---|---|---|---|
| `L235–242` `get extractionConfigKey()` | `extractionConfigKeyFor({ modelVersion: this.extractor.modelVersion, promptVersion: this.extractor.promptVersion, parserVersion: this.parserVersion, schemaVersion: this.schemaVersion })` | **legacy `xcfg-` 身份** | ❌ **不得动**（T-RMA-24） |
| `L564–569` `snapshotFor()` 的 `model: { … }` | `modelVersion` / `promptVersion` 取自 `this.extractor` | **legacy 与 model 共用** | ✅ **模型路径必须改为 adapter 来源** —— 接入点 2 |
| `L757` `this.extractor.extract({ version, fragments })` | 调用 legacy 确定性提取器 | **仅 legacy 分支**（在 `if (opts.model === undefined)` 内） | ❌ **不得动** |
| `L970–971` `claimRun()` 的 INSERT | `extraction_run` 的**身份列**写入 `this.extractor.modelVersion` / `this.extractor.promptVersion` | **legacy 与 model 共用** | ✅ **模型路径必须改为 adapter 来源** —— 接入点 4（rev6 新增） |

**实施纪律（冻结）**：

```text
- 两个"共用点"（snapshotFor() 与 claimRun()）都必须改成【按路径取来源】：
    模型路径 → adapter 的 adapterIdentity / promptVersion / parserVersion
    legacy 路径 → 保持 this.extractor.*（且 schemaVersion 两侧都取 Tiancha，§R4.3）
- 改法必须是"新增可选参数 / 按路径分支"，【不得】直接替换共享代码里的 this.extractor.*
  （那会移动 legacy 的字节 ⇒ T-RMA-24 直接打回）
- T-RMA-24 必须【同时】覆盖两条：legacy 的 xcfg- 身份、legacy 的 generation:{}、legacy 的
  snapshot.model.*、以及 legacy 的 extraction_run 身份列（L970–971 那条 INSERT 的结果）
```

---

## §R6 Timeout / Abort（D-RMA-F / D-RMA-P）

### §R6.1 继承 F2 的上层语义（逐条，不改）

```text
caller 的 timeoutMs
        ↓
一个 AbortController 覆盖整次 run（同一个 signal 传给每一个 batch）
        ↓
adapter 收到 signal
        ↓
deadline 到 ⇒ controller.abort() + Promise.race 兜底
        ↓
RunResult.status = "failed"，error = "extraction timed out after Nms"
        ↓
零业务残留；extraction_run 仍为 running / finished_at = NULL（lease 自然过期）
```

**本片不得**：改 `timeoutMs` 校验、改超时文案、改"timeout ≠ lease failure"的两层语义、把 `extraction_run` 在超时时标成 `failed`、新增第二种取消机制。

### §R6.2 adapter 侧的新增义务

F2 的上层只能保证"run 不会被一直持有、且什么都不写"。**本片必须把 adapter 侧的责任写实**：

1. adapter **必须**把收到的 `AbortSignal` 传播到底层请求（HTTP 请求必须可被中止）。
2. adapter **不得吞掉** abort：不得把 abort 转成"空结果"、不得转成"合法失败但继续跑"、不得在 abort 后用缓存结果"补救"。
3. adapter **不得**用自己的内部超时**掩盖** caller 的 abort。
4. adapter 在 abort 之后**不得**再产生任何副作用（不得继续写日志级别的"结果已就绪"、不得回调上层）。
5. abort 时抛出的错误必须进入 §R6.5 的分类。

### §R6.3 边界澄清（与 F2 的表述不冲突）

F2 §M14.5 的表述是上限层："契约承诺的是**不被 await、不被使用、什么都没写**，**从不承诺**'厂商的 socket 已关闭'"。

本片**不改变**这条上层承诺，只是**增加 adapter 侧的义务**：adapter 应**尽力**中止底层请求，且该行为**必须可测**（§R13 T-RMA-6）。因此：

```text
上层（F2，冻结）：Promise.race 兜底 + 零写入        ← 不变
adapter（本片）：收到 abort ⇒ 中止底层请求           ← 新增义务，可测
```

两者**相容**：即使某个 provider 的底层库无法真正中断连接，上层仍然安全（零写入）；但**不得**用"反正上层兜底"作为"adapter 不传播 abort"的理由。

### §R6.4 测试判据

- T-RMA-6：**悬挂 provider + abort ⇒ 底层请求确实收到中止信号**（例如可注入的 transport 记录 abort 事件），且零业务残留。
- T-RMA-7：timeout ⇒ `RunResult.failed` **且** `extraction_run` 保持 `running` / `finished_at = NULL`（**两层语义**，不得合并）。
- 反证：把 adapter 的 signal 传播**摘掉**，T-RMA-6 必须失败（mutation probe）。

### §R6.5 AbortError / caller abort 的唯一归类（★ rev2 新增；D-RMA-P 冻结）

**问题（rev1 未定）**：adapter 收到 abort 后，底层 provider 可能抛 `AbortError`、`DOMException`、网络取消错误、或厂商专有的取消错误。若不固定，timeout 会被错误地变成 provider failure。

**冻结（唯一映射）**：

```text
若 caller 的 signal 已经 aborted：
    provider 抛出的【任何】取消/中断类错误
        → 一律归类为 abort
        → 若可证明是 deadline 触发 ⇒ 归类为 timeout
        → 【绝不】归类为 network / provider_unavailable / malformed_response

若 caller 的 signal 未 aborted：
    provider 自身的传输中断
        → network（§R7.1）

一律禁止：
    ❌ 把 vendor 的取消错误对象暴露到 adapter 边界之外
    ❌ 让"abort"和"provider 失败"共用同一个标识
```

**测试**：T-RMA-7 与 T-RMA-23（§R13）。

---

## §R7 Provider 错误分类与**错误协议**（D-RMA-G）

### §R7.1 最小分类

| 分类（机器可读 code） | 典型来源 | retryable（§R8） |
|---|---|---|
| `configuration` | 缺少配置/变量、非法参数、找不到 deployment、credential 缺失/非法 | ❌ |
| `authentication` | 401 / 403 / 凭证被拒 | ❌ |
| `capability_unsupported` | provider 不支持 REQUIRED 能力（§R1.5） | ❌ |
| `invalid_request` | 400 / 请求体不合法 / schema 不被接受 | ❌ |
| `rate_limited` | 429 | ❌（v1：不允许 retry） |
| `provider_unavailable` | 5xx / 服务不可用 | ❌（v1：不允许 retry） |
| `network` | DNS / 连接 / TLS 中断 | ❌（v1：不允许 retry） |
| `timeout` | caller 的 deadline 触发 | ❌（由上层控制） |
| `abort` | caller 的 abort（§R6.5） | ❌ |
| `malformed_response` | 解析失败、schema 不符、字段非法（§R4.2） | ❌ |

### §R7.2 retryable 属性

- `retryable` 必须是**显式属性**，而不是"adapter 觉得可以再试一次"。
- v1：**所有分类的 `retryable` 都是 false**（§R8.1 的 `maxAttempts = 1`）。该字段为将来保留，但**不得被用于任何自动重试**。

### §R7.3 错误协议（★ rev2 重写；rev1 只给了分类名，没有协议）

**内部形态（adapter 边界内，冻结）**：

```ts
interface ProviderError {
  readonly code: ProviderErrorCode;   // §R7.1 的闭集
  readonly retryable: boolean;        // v1 恒 false
  readonly message: string;           // 可诊断、不含敏感信息
}
```

**向上承载（F2 的类型不可改）**：`RunResult.error` 是既有 `string` 类型（已核实），因此本片冻结**字符串承载格式**：

```text
RunResult.error = `${code}: ${message}`
示例： provider error → "capability_unsupported: provider does not support structured output"
      凭证问题     → "authentication: provider rejected the credential (HTTP 401)"
      配置问题     → "configuration: environment variable X is not set"
```

**唯一例外（冻结的历史格式，不得"顺手统一"）**：

```text
timeout ⇒ RunResult.error 仍为既有 "extraction timed out after Nms"
（F2 / §M10 的既有文案，本片不得修改；classify 时按 timeout 处理）
```

**`ADAPTER_NOT_CONFIGURED` 的含义不变**：仅表示"本 build 没有 adapter"，**不得**用它表达 credential / capability / provider 问题（§R2.3 / §R1.5）。

### §R7.4 敏感信息隔离（★ rev2 强化）

`RunResult.error`、日志、异常信息中**一律不得**出现：

```text
❌ credential（任何形态，含前缀/长度/片段）
❌ provider 原始 response body（全文或大段）
❌ 请求体全文
❌ HTTP headers（尤其 Authorization）
❌ request URL（若其中可能含 token / 账号信息）
❌ 账号 id / 组织 id（若属敏感）
❌ 原始 provider 错误对象的堆栈 / cause（不得跨 adapter 边界）
```

- adapter **可以**在**内部**保留 debug 用的 cause/stack，但**没有独立受控的 logging contract 时，不得把它带出 adapter boundary**；
- v1 **不引入**"详细 debug 日志"机制（若要引入，须另立契约并冻结脱敏规则）。

### §R7.5 装配期错误的传播与 CLI 映射（★ rev3 新增）

**问题（rev2 未定）**：`resolveModelAdapter()` 在 `runCandidateExtract()` 中位于 `try { … }` **之外**（已核实：装配段在 `run()` 调用之前、内层错误处理之前）。若装配期抛错而没有对应捕获，错误会直接冒泡出 CLI 函数，行为不确定。

**冻结（v1）**：

```text
三种装配结果，三条互斥路径：

① 本 build 未装配 adapter
      resolveModelAdapter() → undefined
      ⇒ 既有行为不变：--json 输出 { status: "failed", reason: "ADAPTER_NOT_CONFIGURED" }，
        退出码非 0，不写任何表，【绝不】回退 legacy

② 已装配，但能力/凭证/配置不满足（§R1.5 / §R2.1）
      resolveModelAdapter() → 抛出带 code 的 ProviderError
      ⇒ runCandidateExtract() 的装配段捕获，输出同一形状的 JSON：
        { status: "failed", reason: "<code>" }（code ∈ §R7.1 闭集）
        退出码非 0，不写任何表

③ 已装配且就绪
      resolveModelAdapter() → adapter
      ⇒ 继续走既有 run() 路径
```

**硬规则**：

```text
- 断言①②③互斥，且【不得】出现"装配失败却回退 legacy"的路径（T-RMA-30 覆盖）
- --json 的【形状】不变（仍为 { status, reason, … }），只有 reason 的取值域扩展
- 错误文案不得包含 credential（§R7.4）
- 装配期失败【不得】产生任何 extraction_run 行（零残留）
```

---

## §R8 Retry（D-RMA-H）

### §R8.1 `maxAttempts = 1` 是 v1 的 **contract invariant**（★ rev2 提升）

不重试。理由（契约必须写明，避免以后被误改）：

```text
F2 已建立：one run → deterministic identity → compute-first → one persistence
若 adapter 内部重试：调用次数 ≠ 窗口数 ⇒ 成本不可见 · latency 改变 ·
provider 侧效应难追踪 · 测试复杂度上升 · reuse/身份语义被搅动
```

### §R8.2 若将来允许 retry，必须冻结的六项

```text
① maxAttempts（上限，硬数字）
② backoff 策略（起始/倍数/上限/是否带抖动）
③ retryable 集合（精确到 §R7.1 的分类）
④ attempt count 的可观测性（每次尝试必须被记录，且【不进身份】）
⑤ 触发条件边界（是否只在"尚无可观察副作用"的失败上重试）
⑥ 与 timeout 的关系（retry 不得让整次 run 超过 caller 的 timeoutMs）
```

**任一未冻结，就不允许开启 retry。**

### §R8.3 调用次数的**正确不变式**（★ rev2 修正 rev1 的错误断言）

> rev1 写"provider 调用次数必须是 `窗口数 × maxAttempts`" —— 这是**错的**：F2 的窗口是**顺序**执行的，第 k 个窗口失败后，k+1…n 根本不会被调用。

**冻结**：

```text
一般不变式（恒成立）：
    calls = （已【实际开始执行】的窗口数）× maxAttempts
    calls ≤ windowCount × maxAttempts

完整成功：
    calls = windowCount × maxAttempts

在第 k 个窗口失败（k ≤ windowCount）：
    calls = k × maxAttempts

v1（maxAttempts = 1）：
    完整成功 ⇒ calls = windowCount
    第 k 个窗口失败 ⇒ calls = k
```

**测试（T-RMA-12，rev2 改写）**：必须分别断言**上界**与**精确情形**（成功路径精确等于 windowCount；中途失败路径精确等于失败窗口序号）—— 不允许只断言一个"看起来差不多"的数字。

### §R8.4 禁止隐藏 retry

- ❌ transport 层（HTTP client / SDK）自带的重试**必须被关闭**（v1 不允许"计入 maxAttempts"的变体）。
- ❌ 不得存在"看起来一次、实际多次"的通路。
- ❌ retry 次数**不得**进入 `mxcfg-` 身份（§R3.2），且 v1 也不得向上暴露（§R9.4）。

---

## §R9 Execution Telemetry（usage 等）（D-RMA-I）

### §R9.1 定义

以下是 **ExecutionTelemetry**（执行遥测），与 §R5.0 的定义一致：

```text
requestId · providerRequestId · latency
inputTokens · outputTokens · totalTokens
attempts · finishReason
```

### §R9.2 绝不进入研究知识体系

`Token usage` **不是** `Claim` / `Fact` / `Knowledge` / `PoolItem` / `Gap` / `Evaluation` 的属性。禁止出现"这个行业 Claim 消耗了多少 token"这类混合。研究知识与执行遥测必须保持分离。

### §R9.3 ★ 绝不进入身份

- **禁止**让 telemetry 进入身份（AdapterIdentity / RequestIdentity，§R5.0）。
- 反证（T-RMA-14 / T-RMA-26）：只改 usage / latency / requestId / finishReason，`mxcfg-` 必须**不变**。
- 原因：它们每次调用都在变 ⇒ 一旦进身份，同配置永远无法 reuse（直接打穿 §M7.1）。

### §R9.4 v1 存放：**仅内存内，不跨边界**（★ rev2 重写；解决与 `--json` 的冲突）

> rev1 写"仅结构化 stderr / `--json` 报告"，同时 §R0.2 又写"不动 `--json` 输出契约" —— **自相矛盾**（把 usage 加进 `--json` 本身就是 CLI JSON 契约变更）。

**v1 冻结**：

```text
ExecutionTelemetry：
    ✅ adapter 内部可以获得（例如用于它自己的错误分类判断）
    ❌ 不得跨越 adapter 边界向上传递
    ❌ 不得进入 ExtractionConfigSnapshot
    ❌ 不得进入业务持久化（不建表、不加列、不加 migration）
    ❌ 不得进入 CLI 输出（`--json` 与用户可见的 stderr 均不变）
```

**未来**：若要持久化或输出 telemetry，必须**另立契约**，其中同时冻结：存储方案（表/列 + migration）、CLI JSON schema 变更、脱敏规则。**不得**在本片顺手引入。
**注意**：无论何时，§R9.3 的禁令不变。

---

## §R10 V1–V4 绝对边界

### §R10.1 唯一链路（顺序不可倒置）

```text
Provider
   ↓
raw provider response
   ↓
adapter normalization（§R4.2，严格、拒绝而非猜测）
   ↓
ModelBatchResult（ModelCandidateDraft[]）
   ↓
V1 window 属于本材料版本
V2 偏移是整数且落在窗口内
V3 窗口切片与引用文本【逐字符】相同
V4 解析出的跨度 ≤ maxQuoteChars        ← 以上四条由既有的 resolveQuotes() 实施（§M5.3）；本片不得绕过、不得旁路
   ↓
ValidatedCandidate[]
   ↓
既有唯一持久化入口 persistValidatedCandidates()（§M13.9）
```

**禁止的形态**：

```text
❌ Provider → Candidate → save → validate
❌ Provider → save(raw) → 事后校验
❌ Provider → Candidate → 写 Fragment/Evidence → 再校验 quote
```

### §R10.2 五条禁令

1. ❌ adapter **不得"修复"quote**（不得改 `text`、不得调 `startInWindow`/`endInWindow`、不得"就近匹配"）—— 引用要么逐字符成立，要么整次失败。
2. ❌ adapter **不得**为了让校验通过而**裁剪 / 规范化**引用文本（不得 NFKC、不得改空白；坐标单位与文本归一化由 Tiancha 既有链路决定，§M4.1）。
3. ❌ adapter **不得**缓存上一次成功的输出并复用（不得用缓存绕过 provider 调用与校验）。
4. ❌ adapter **不得**跳过 V1–V4（它没有合法性去"相信"模型）。
5. ❌ adapter **不得**把"部分成功"当结果（一条失败 quote ⇒ 整次失败，§M6.3）。

### §R10.3 零残留判据

必须证明（§R13 T-RMA-5 / T-RMA-20）：

```text
provider 返回畸形输出（引用不存在 / 越界 / 文本不符 / 缺字段）
        ↓
整次 run 失败
        ↓
零业务残留：无 Fragment · 无 Evidence · 无 candidate · 无 claimRef
        ↓
extraction_run 不处于 completed
```

**F2 已建立这条性质；本片不得让它退化。** 任何让"坏输出也能留下半个候选"的改动都视为打回。

---

## §R11 首版范围：单 provider instance（D-RMA-K）

### §R11.1 允许

```text
ModelExtractionAdapter（接口，冻结）
        ↓
一个真实 provider instance 的 adapter 实现（profile = OpenAI-compatible HTTP）
        ↓
一个明确的 model / deployment / endpoint（可配置，但只有一个）
```

### §R11.2 禁止

```text
❌ provider 注册表 / 插件发现
❌ provider 间 fallback（"失败就换一家"）
❌ routing / 负载均衡 / 成本优先选择
❌ 多 provider instance 的配置体系
❌ 把"多 provider"做成"看起来只是一个配置数组"
❌ 把 profile 的可替换性说成"已经支持多家 provider"
```

理由：这些会**立刻**把一个 adapter 变成一个新系统，并让"真实材料回放"的可验证性崩塌。

### §R11.3 本地模型的定位

本地模型（如 LM Studio / Ollama / vLLM）**只是某个 provider instance**（同一 profile 的一个 endpoint），**不得**成为 Tiancha 的架构前提：

```text
✅ Tiancha → ModelExtractionAdapter → provider abstraction → 某个 provider instance（可能是本地）
❌ Tiancha → LM Studio API（直接绑定）
```

这样"本地 / 远程 / 换厂商"是**配置变化**，而不是动 Tiancha 核心。

---

## §R12 文件白名单与禁止触碰（授权实施时按此锁）

### §R12.1 允许新增（★ rev2 按实际 repo 结构重写）

**实际 repo 结构（已核实）**：

```text
packages/research/src/ports/       ← 端口（接口）：8 个 *.port.ts + index.ts barrel
packages/research/src/providers/   ← 实现：echo-data-provider.ts（DataProviderPort 的实现）
packages/research/src/infrastructure/  ← 【不存在】
```

⇒ rev1 建议的 `infrastructure/provider/` **作废**（D-RMA-M 冻结）。v1 允许新增：

```text
packages/research/src/providers/<profile>-model-adapter.ts   ← ModelExtractionAdapter 的真实实现
packages/research/src/providers/<profile>-transport.ts       ← HTTP transport（如需拆分）
packages/research/src/providers/model-credentials.ts         ← credential 查找/解析（§R2.1）
packages/research/src/providers/model-provider-errors.ts     ← §R7 的分类与协议
packages/research/src/application/extraction-output-contract.ts ← Tiancha 侧只读输出契约（§R4.3）
packages/research/src/providers/*.test.ts                     ← 本片测试（§R13）
（具体文件名为建议，D-RMA-M 已冻结目录，文件名在实施前最后一次确认）
```

**不新增 port**（§R17 的 M2）：不得为了本片新建 `ports/*.port.ts`，也不得重构既有 `ports/` barrel。

### §R12.2 允许修改（最小、逐条授权）

| 文件 | 允许的改动 | 理由 |
|---|---|---|
| `packages/research/src/application/model-extraction.ts` | **只允许**：(a) 为 `ModelExtractionAdapter` **增加两个必填只读成员** `adapterIdentity: AdapterIdentity` 与 `generationParams: ModelGenerationParams`（§R5.4）；(b) **新增一个只读类型 `AdapterIdentity`**（字段见 §R5.1(A)）。**不得**新增 `GenerationIdentity` 的任何符号；不得改 `ModelBatchInput` / `ModelQuote` / `ModelCandidateDraft` / `ModelBatchResult` / `resolveQuote(s)` 的任何语义 | 让 adapter 提供真实身份与生成参数 |
| `packages/research/src/application/candidate-extraction-service.ts` | **只允许**：(a) 模型路径的 `generation: {}`（身份 + snapshot）改为 adapter 的 `generationParams`（§R5.4）；(b) `snapshotFor()` **新增可选参数**，使**模型路径**的 `model.{modelVersion,promptVersion,parserVersion}` 取自 adapter（§R5.5）；(c) 把构造时已解析的 schemaVersion 作为**只读成员**暴露（`outputContract: ExtractionOutputContract`，§R4.3 的唯一数据流）；(d) **`claimRun()` 新增"身份来源"可选参数**，使**模型路径**写入 `extraction_run` 身份列时取 adapter 的值（§R5.7，接入点 4）。**不得**改 legacy 路径的 `generation: {}` / `snapshot.model.*` / `claimRun()` 的 legacy 分支、不得把两个共用点的 `this.extractor.*` 直接替换（会移动 legacy 字节）、不得改 `extractWithModel` 的编排顺序、不得改 timeout/lease/fencing 语义、**不得在多处重复解析 schemaVersion** | §R5.4 / §R5.5 / §R5.7 / §R4.3 四个接入点 |
| `src/cli/research-commands.ts` | **只允许**把 `resolveModelAdapter()` 从"无参、恒 `undefined`"改为 **`resolveModelAdapter(outputContract: ExtractionOutputContract)`**（§R4.3 的唯一数据流），内部按 §R2 解析 credential + 校验能力（§R1.5）+ 构造真实 adapter；**不得**在该函数内解析 `schemaVersion`（owner 只能在 Service）、不得改 `ADAPTER_NOT_CONFIGURED` 的语义、不得改 `--model` 必须带 `--operator` 的规则、不得改其它子命令、不得改 `--json` 输出 | §R1.4 / §R1.5 / §R4.3 装配点 |
| 既有测试 fake（`FakeModelAdapter` / `DeterministicFakeAdapter` / `HangingModelAdapter` 等） | **只允许**补齐新增的必填成员（`adapterIdentity` / `generationParams` / 能力声明）；**不得**改任何既有断言的语义 | 接口扩展的连带最小改动 |
| `packages/research/src/index.ts` | **只允许新增一行 `export *`**，导出本片新增的 provider adapter（对齐既有惯例：该文件已有 `export * from "./providers/echo-data-provider.js";`）。**不得**改动既有导出行、不得改包 `exports`（仍只有 `"."`） | CLI 经 `@tiancha/research` 导入（已核实 `exports` 仅开放 `"."`）；这是**接线**，不是第二条模型执行路径 |
| **（约束，rev4 补）** 上述 export 的用途 | **只允许**用于类型引用与 `resolveModelAdapter()` 内部的合法装配。**不得**成为第二条 adapter 实例化路径：CLI 侧**不得**出现 `new <RealModelAdapter>()`，取得 adapter 的入口**只有** `resolveModelAdapter()`（§R1.4 / §R7.5） | 否则会出现"绕过装配点直接造实例"，等于第二条模型执行路径（T-RMA-31 覆盖） |
| `packages/research/package.json` | 仅当 D-RMA-A 将来改用 vendor SDK（v2 起）才需要；v1 **不得**改动 `exports` | v1（纯 HTTP）**不需要新依赖** |

**已核实的兼容性结论（rev2 记录）**：`snapshotFor()` 的模型路径修正**不会**破坏 F2 测试 —— W 矩阵只断言 `snapshot.run.batchCount` 与 `snapshot.methodology.*`，未断言 `snapshot.model.*`。

### §R12.3 禁止触碰

```text
❌ docs/phaseC/c6-model-extractor-contract.md（F2 契约，已发布；如需修订须单独一轮）
❌ docs/phaseC/c6-implementation-contract.md（C6 资料闭环契约）
❌ Slice E 的任何已冻结语义与测试
❌ 候选 / Pool / Knowledge / Report / Methodology / ResearchTarget 的数据模型与投影链路
❌ DB schema（本片无例外：不新增表/列/索引/migration）
❌ F2 测试矩阵（W-1…W-11）与 F 测试矩阵（F-1…F-17）的**断言语义**
❌ `ports/`（不得为本片新增 port 或重构 barrel）
❌ `ModelResolverPort` 及其实现（§R1.6 隔离）
❌ 任何"顺手修 F2 / 顺手优化 legacy"的改动
```

### §R12.4 交付纪律

```text
契约（本文件）→ 审查 → Final Lock → 实施 → 测试 + mutation probes → 全量门禁 → 独立 commit → push → HEAD/remote/clean 验证
```

---

## §R13 测试矩阵（硬门）

### §R13.0 测试纪律（★ rev2 新增；必须写进契约而非"纪律"）

**(1) 必须经过真实 `CandidateExtractionService`**：

```text
✅ 允许的替换点：transport（以及 provider instance 配置）
❌ 不允许：绕过 CandidateExtractionService，只对 RealModelAdapter 做单元测试就算通过

链路类测试必须是：
    CandidateExtractionService.run()
        → ModelExtractionAdapter
        → RealModelAdapter
        → 注入的 transport（零真实网络）
        → V1–V4
        → persistValidatedCandidates()
```

**判定**：若一条"验收测试"没有走 `run()`，它**不计入本片验收**（可以存在，但必须标注为 adapter 单元测试）。

**(2) 零真实网络是硬门，且 guard 必须覆盖【全部网络入口】（rev4 修正 rev3 的绕过口）**：

rev3 写的是"替换全局 `fetch`；若环境无 `fetch`，再拦 `node:http` / `node:https`" —— 这留了一个绕过口：**环境有 `fetch` 时，若 transport 实际走 `node:https.request()`，guard 就抓不到**。

**rev4 冻结（无条件覆盖三个入口）**：

```text
不论运行环境是否存在 globalThis.fetch，
以下三个入口【必须同时】处于 guard 状态：

    1. globalThis.fetch
    2. node:http   （request / get）
    3. node:https  （request / get）

任何【未经本片注入 transport 覆盖】的网络调用：
    → guard 计数 +1
    → 【立即 throw】
    → 该测试失败

      ┌─ globalThis.fetch ─┐
研究 ─┼─ node:http.request ┼──X── 真实网络
      └─ node:https.request┘
              ↑
            guard（三入口同时生效）
```

**必须【同时】断言三件事（缺一不可）**：

```text
① guardCalls === 0
② 被测 CandidateExtractionService.run() 确实【完成了模型路径】（不是提前失败/跳过）
③ 至少产生一个【有效候选】（经 V1–V4 并通过既有持久化）
```

- 只断言 ① 不能排除"根本没走到网络"的假通过；只断言 ②③ 不能排除"确实打了真实网络但恰好也产出了候选"。
- 全部硬门测试必须在**无网络**环境（或上述 guard 生效）下通过；
- guard 的失败条件是**立即抛错并使该测试失败**，而不是"打印警告"。

**(3) mutation probe 必须"能杀死"**：每条 mutation probe 必须给出"故意破坏 ⇒ 测试确实失败"的证据；仅"有 mutation test 这个名字"不算。

**(4) F2 回归必须复用而非复制**：legacy 回归硬门（T-RMA-24）应**复用/强化** F2 既有测试，不得复制一套平行逻辑。

### §R13.1 测试矩阵

| # | 测试 | 断言要点 |
|---|---|---|
| T-RMA-1 | credential 不出现在源码 | 扫描新增源码，无字面量密钥形态（§R2.2 #1） |
| T-RMA-2 | credential 不落库 | 全表 dump + `config_snapshot_json` 解析后扫描（§R2.2 #2/#3/#4） |
| T-RMA-3 | credential 不进日志 / 输出 / 错误 | 捕获 stdout/stderr/`RunResult.error`（含失败路径）后扫描（§R2.2 #5/#6） |
| T-RMA-4 | 改 credential ⇒ `mxcfg-` **不变** | 身份隔离（§R2.2 #7 / §R3.2） |
| T-RMA-5 | 畸形 provider response ⇒ **零业务残留** | Fragment / Evidence / candidate / claimRef 计数全 0（§R10.3） |
| T-RMA-6 | 悬挂 provider + abort ⇒ **底层请求真的收到中止** | 注入 transport 记录 abort；零残留（§R6.2/§R6.4） |
| T-RMA-7 | timeout 的双层语义 | `RunResult.failed` **且** `extraction_run.status='running'`、`finished_at IS NULL`；错误文案仍是既有 `extraction timed out after Nms`（§R6.1 / §R7.3 例外） |
| T-RMA-8 | 同配置 reuse 不重复调用 provider | 计数 transport：第二次 run 的调用数 = 0（§M7.1） |
| T-RMA-9 | 只改 deployment / model ⇒ `mxcfg-` 变化 | mutation probe（§R3.4） |
| T-RMA-10 | 只改 temperature / max_tokens ⇒ `mxcfg-` 变化 | mutation probe（§R3.4） |
| T-RMA-11 | 只改 adapterVersion ⇒ `mxcfg-` 变化 | mutation probe（§R3.4） |
| T-RMA-12 | **调用次数不变式**（rev2 改写） | 成功：`calls == windowCount`；第 k 窗口失败：`calls == k`；一般上界 `calls ≤ windowCount × maxAttempts`（§R8.3） |
| T-RMA-13 | application 层不认识 provider | 架构断言：provider 标识只出现在 adapter 文件（§R1.3） |
| T-RMA-14 | 改 usage ⇒ `mxcfg-` **不变** | §R5.0 / §R9.3 |
| T-RMA-15 | **adapter 缺失** ⇒ `ADAPTER_NOT_CONFIGURED`（rev2 改写） | 用**测试专用**的"未装配"组合证明；**不得**与 credential 缺失混同（§R13 T-RMA-21） |
| T-RMA-16 | 候选只能经 `ModelExtractionAdapter` 进入 | 唯一入口断言（§R1.3） |
| T-RMA-17 | snapshot 可独立重建请求 | 同一 snapshot + 同窗口文本 ⇒ 字段级一致的 ProviderRequest（§R5.3）。**golden 必须包含 `dimensionHints` 的【全文与顺序】**（它进 prompt 且顺序敏感 —— Final Lock 的 S2），以及 `generation.extra.adapterIdentity` 的可读字段全集 |
| T-RMA-18 | abort 被吞掉 ⇒ 测试必须失败 | mutation probe（§R6.2 #2） |
| T-RMA-19 | adapter "修复" quote ⇒ 校验必须拒绝 | 故意改 offset/text，V1–V4 必须拦截（§R10.2 #1） |
| T-RMA-20 | 引用不存在 / 越界 / 文本不符 / 缺字段 各一例 | 每例都零残留（§R10.3） |
| **T-RMA-21** | **有 adapter 但 credential 缺失** ⇒ `configuration`，**不是** `ADAPTER_NOT_CONFIGURED` | §R2.3；与 T-RMA-15 成对 |
| **T-RMA-22** | 请求实际使用的是 **Tiancha 的 schema**（rev4 再强化） | (a) adapter 不得提供第二个 `schemaVersion`（编译期或断言失败）；(b) **改动 Tiancha 的 `ExtractionOutputContract.schema` ⇒ 发出的 provider 请求随之改变**；(c) adapter 无法覆写/放宽该 schema；(d) **同一 `schemaVersion` ⇒ schema 内容稳定**，schema 内容变化 ⇒ `schemaVersion` **必须**变化；(e) schemaVersion 只被服务解析**一次**（§R4.3） |
| **T-RMA-23** | abort 分类稳定 | caller abort 时，provider 抛 AbortError / DOMException / 厂商取消错误 ⇒ 一律 `abort`（deadline ⇒ `timeout`）；**绝不**变成 `network` / `provider_unavailable`；vendor 取消对象不出边界（§R6.5） |
| **T-RMA-24** | **legacy 回归硬门** | legacy 路径的 `xcfg-` 身份、`generation: {}`、`snapshot.model.*`、**以及 `extraction_run` 的身份列（`claimRun()` 的 INSERT 结果）** **逐字节不变**（复用/强化 F2 既有测试）（§R0.3 / §R5.5 / §R5.7） |
| **T-RMA-25** | 只改 base URL ⇒ `mxcfg-` **变化** | mutation probe（§R3.1 / §R3.4） |
| **T-RMA-26** | 改 latency / requestId / finishReason ⇒ `mxcfg-` **不变** | §R5.0 / §R9.3 |
| **T-RMA-27** | **零真实网络 guard（三入口）** | 不论环境是否有 `fetch`，`globalThis.fetch` + `node:http` + `node:https` **同时**处于 guard；任何未覆盖的网络调用 ⇒ 计数 +1 并**立即抛错**。断言三件套：`guardCalls === 0` **且** `run()` 真实完成模型路径 **且** 至少一个有效候选（§R0.4 / §R13.0(2)） |
| **T-RMA-28** | REQUIRED 能力不满足 ⇒ fail closed | structured output 或 abort 不支持 ⇒ **不发起 provider 调用**、分类为 capability/configuration、零残留（§R1.5） |
| **T-RMA-29** | ExecutionTelemetry 不出边界 | telemetry 不出现在 snapshot / 业务表 / CLI 输出（`--json` 与 stderr）中（§R9.4） |
| **T-RMA-30** | **装配期分类（CLI 真实入口）** | 经真实 `runCandidateExtract()`：(a) **未装配** ⇒ `reason = ADAPTER_NOT_CONFIGURED`、非零退出、无 `extraction_run` 行、**未回退 legacy**；(b) **已装配但不满足**（能力/凭证） ⇒ `reason = <code>`（§R7.1 闭集）、非零退出、零残留；(c) 就绪 ⇒ 继续既有 `run()` 路径。三条路径互斥（§R7.5） |
| **T-RMA-31** | **唯一装配入口**（rev4 新增） | CLI 侧不存在 `new <RealModelAdapter>()` 等直接实例化；取得 adapter 的入口**只有** `resolveModelAdapter()`；`index.ts` 的 export 仅用于类型引用与该方法内部装配（§R12.2）。mutation probe：把 `resolveModelAdapter()` 换成"直接在 CLI 里 new" ⇒ 架构断言必须失败 |
| **T-RMA-32** | **adapter 身份成员与 `GenerationIdentity` 命名**（rev5 新增） | (a) `ModelExtractionAdapter` 只新增 `adapterIdentity` / `generationParams` 两个必填只读成员；(b) **架构扫描断言代码中不存在 `GenerationIdentity` 符号**（interface/type/class/factory/变量）；(c) `modelVersion === "pid-" + sha256Hex(stableStringify(adapterIdentity))`（mutation probe：只改 `adapterIdentity` 的一个字段 ⇒ `modelVersion` 与 `mxcfg-` 必须随之变化）（§R5.4 / §R5.0） |
| **T-RMA-33** | **schemaVersion 唯一数据流**（rev5 新增） | 经真实装配链路断言：(a) `schemaVersion` **只在 Service 解析一次**（若在 assembly 处再解析一次 ⇒ 测试失败）；(b) adapter 拿到的 schema 就是 **Service 的只读 `outputContract`**（改动它 ⇒ provider 请求随之变化）；(c) adapter **不解析 / 不提供 / 不覆盖** `schemaVersion`；(d) **assembly 之后不可替换** schema contract（无 `setSchema` 类通路）（§R4.3 / §R12.2） |

---

## §R14 边界自检（越界即打回；★ rev2 扩充）

实施 PR 自检清单：

```text
□ 新增/修改的文件是否都在 §R12 白名单内？
□ 是否改了 §R0.3 表中任何一条 F2 冻结语义？
□ 是否让 provider 细节进入了 application 层 / snapshot / identity / 错误消息？
□ 是否引入了隐藏 retry 或 transport 自带重试？
□ 是否让 ExecutionTelemetry / credential 进入了身份？
□ 是否新增了第二条持久化路径？
□ 是否让"坏 quote"能留下任何业务残留？
□ 是否新增了 DB schema（表/列/索引/migration）？本片无例外。
□ 是否把本地模型绑定成了架构前提？
□ 是否改动了 F / F2 测试矩阵的断言语义？
□ 【rev2】是否绕过了 ModelResolverPort，未将其用于 extraction model resolution？
□ 【rev2】是否满足 Tiancha Required Provider Capabilities（§R1.5）？
□ 【rev2】structured output 不支持时是否 fail closed（而非降级）？
□ 【rev2】schemaVersion 是否只有 Tiancha 一个 owner？
□ 【rev2】身份（AdapterIdentity / RequestIdentity）与 ExecutionTelemetry 是否严格分离（对象级）？
□ 【rev2】非敏感 endpoint / base URL 是否正确进入身份（§R3.1）？
□ 【rev2】provider 的 AbortError / 取消错误是否已按 §R6.5 归类？
□ 【rev2】全部验收测试是否都经过 CandidateExtractionService（§R13.0）？
□ 【rev2】硬门测试是否零真实网络（T-RMA-27）？
□ 【rev2】legacy identity / snapshot 是否逐字节未变（T-RMA-24）？
□ 【rev2】是否为了本片新增了 port（越界）？
□ 【rev3】adapter 的 schema 是否确实来自 Tiancha 的 `ExtractionOutputContract`（而非 adapter 自带）？
□ 【rev3】每个必需身份字段在 snapshot 中是否都有【唯一】落点（§R5.5）？
□ 【rev3】是否只新增了 `index.ts` 的一行 `export *`（未改既有导出行、未改包 exports）？
□ 【rev3】装配失败是否按 §R7.5 的三条互斥路径处理（未装配 ⇒ ADAPTER_NOT_CONFIGURED；不满足 ⇒ 抛错并映射；就绪 ⇒ 继续）？
□ 【rev3】本地实例是否走 `AUTH_MODE="none"` + 回环限制（而非"隐式无认证"）？
□ 【rev3】零真实网络 guard 是否【同时】断言"计数为 0"与"链路确实产出"？
□ 【rev4】实现是否【没有】自算/拼接 `mxcfg-`（只用既有 `modelExtractionConfigKeyFor` + `generationHashOf`）？
□ 【rev4】`GenerationIdentity` 是否只作为概念出现（未新增第三个 interface/对象）？
□ 【rev4】`schemaVersion` 是否只被解析一次，且同名版本内容稳定（一对一）？
□ 【rev4】CLI 侧是否【没有】任何 `new <RealModelAdapter>()`（唯一装配入口 = `resolveModelAdapter()`）？
□ 【rev4】网络 guard 是否【无条件】覆盖 fetch + node:http + node:https 三入口？
□ 【rev5】adapter 侧是否**没有**任何 `GenerationIdentity` 代码符号（只有 `adapterIdentity` + `generationParams`）？
□ 【rev5】`modelVersion` 是否 ≡ `"pid-" + sha256Hex(stableStringify(adapterIdentity))`？
□ 【rev5】`schemaVersion` 是否**只在 Service 解析一次**、经只读 `outputContract` 传给 `resolveModelAdapter()`，且 adapter 不解析 / 不提供 / 不覆盖、assembly 后不可替换？
□ 【rev6】两个"共用点"（`snapshotFor()` 与 `claimRun()`）是否都按**路径**取来源，且 legacy 分支未被触碰（§R5.7）？
□ 【rev6】`extraction_run` 的身份列在**模型路径**上是否来自 adapter（而非 legacy 提取器）？
```

---

## §R15 裁定项

### §R15.1 已冻结（rev2；用户在 2026-09-29 的 A–R 审计中裁定）

| 编号 | 裁定内容 |
|---|---|
| **D-RMA-A** | 首版 profile = **OpenAI-compatible HTTP**；同时**必须**定义并遵守 REQUIRED 能力（= D-RMA-N） |
| **D-RMA-D** | **Tiancha owns `schemaVersion`**（唯一 owner，adapter 只消费） |
| **D-RMA-G** | **`maxAttempts = 1`**（v1 contract invariant；transport 层不得自动重试） |
| **D-RMA-H** | usage 等 ExecutionTelemetry **v1 仅内存内**（不持久化、不出边界、不进 CLI 输出） |
| **D-RMA-K** | **structured-output downgrade = FORBIDDEN**（v1 只有一种执行模式） |
| **D-RMA-L** | `ModelExtractionAdapter` 扩展为**两个必填只读成员**：`adapterIdentity: AdapterIdentity` + `generationParams: ModelGenerationParams`（**rev5 钉死真实成员名**；`GenerationIdentity` 只是概念术语，**不得**成为代码符号；不得可选） |
| **D-RMA-M** | 目录 = `ports/`（不新增 port）+ `providers/`（放实现），**不使用** `infrastructure/` |
| **D-RMA-N** | REQUIRED 能力清单（structured output · AbortSignal 传播）+ **不满足即 fail closed**（装配期判定） |
| **D-RMA-O** | 实际对象**只有三个**：**AdapterIdentity / RequestIdentity / ExecutionTelemetry**（`GenerationIdentity` 仅作概念术语）；身份与 telemetry 不得混装；telemetry 永不进身份 / 快照 / 业务 |
| **D-RMA-P** | caller abort 已触发时，任何取消类错误 ⇒ 一律 `abort`（deadline ⇒ `timeout`） |
| **D-RMA-R** | 所有会改变 ProviderRequest 路由/行为的**非敏感**配置（含 base URL）必须具有**身份归属** |

（D-RMA-Q = "schemaVersion ownership"，与 **D-RMA-D** 为同一裁定，故不单列。）

### §R15.2 已冻结的第二批（rev3；Final Lock Audit 要求把这五项正式定下）

| 编号 | 冻结内容 |
|---|---|
| **D-RMA-B** | credential 变量名：`TIANCHA_MODEL_API_KEY`（env）/ `TIANCHA_MODEL_CREDENTIAL_FILE`（env）/ `TIANCHA_MODEL_AUTH_MODE`（`"api-key"` 默认 \| `"none"`）；查找顺序、缺失/无效行为见 §R2.1；**本地无认证只允许 `AUTH_MODE="none"` + 回环地址**，且 `authMode` 进身份 |
| **D-RMA-C** | 身份 canonical 值 = **`pid-<identityHash>`**，其中 `identityHash = sha256Hex(stableStringify(AdapterIdentity 结构化对象))`（复用既有能力，不新增序列化器/身份函数）；可读值另有落点（§R5.5） |
| **D-RMA-E** | AdapterIdentity / RequestIdentity 的字段与**唯一 snapshot 落点**见 §R5.1 + §R5.5 的唯一落点表；`extra` 通道键名 = **`generation.extra.adapterIdentity`**（对象）；**不新增 `ModelGenerationParams` / `ExtractionConfigSnapshot` 的类型字段** |
| **D-RMA-F** | 错误字符串形式 = **`<code>: <message>`**（`code` ∈ §R7.1 闭集，**不加** `provider:` 之类统一前缀）；timeout 保持既有 `extraction timed out after Nms`（唯一例外） |
| **D-RMA-J** | provider instance 配置载体 = **env**（`TIANCHA_MODEL_BASE_URL` / `TIANCHA_MODEL_NAME` / `TIANCHA_MODEL_DEPLOYMENT`），**与 credential 变量严格分开**；instance 配置的 canonical 形式进 `generation.extra.adapterIdentity`（§R5.5）；credential **一律不进** snapshot / 身份 / 日志；base URL 含 query / fragment / userinfo ⇒ **非法配置**（§R3.1） |

**因此 §R15 的全部裁定项均已冻结** —— 契约层面不再有"待裁定"项（本文件此后进入实施前 Final Lock 复核）。

---

## §R16 后续（不属于本片，仅登记以免范围漂移）

1. **真实材料回放 / 可靠性片**：短材料 · 长材料 · 多窗口 · 数字密集 · 表格 · 访谈记录 · 行业报告 · 重复信息 · 跨窗口信息 · 模型格式异常 · 引用不存在 · 引用越界 —— 建立 golden materials + 期望行为。
2. **Research Planning 片**：`Industry → ResearchChain → ResearchPosition → ResearchTarget → Question → Plan`（Chain/Position/Target 三层不得退化为"让模型猜一家公司"）。
3. **Report → Claim/Evidence → Knowledge projection 片**：`Report ≠ Knowledge`；旧 Claim 永不删除；conflict 不自动裁决。
4. **Methodology Evolution 片**：`Research Experience → MethodologyCandidate → Human Gate → Methodology V2`；模型不得自行升版。

> 以上四项**必须有各自的独立契约**，不得从本片"顺手接上"。

---

## §R17 修订历史

| 版本 | 内容 |
|---|---|
| **rev1** | 首版（**DESIGN ONLY**）：基于 `6bbb26b`（F2 CLOSED/FROZEN）起草 Real Model Adapter / Provider 独立实施契约。冻结 10 个面：provider 边界（§R1）· credential 来源（§R2）· 部署/模型身份（§R3）· 请求/响应 schema（§R4）· generation snapshot（§R5）· timeout/abort（§R6）· 错误分类（§R7）· retry（§R8）· usage telemetry（§R9）· V1–V4 绝对边界（§R10）；并冻结首版范围（单 provider，§R11）、文件白名单（§R12）、测试矩阵（§R13）、边界自检（§R14）、待裁定项（§R15）。**未实施任何代码**；**未修改**任何既有契约。 |
| **rev2** | **按正式 A–R Contract Audit 的修订**（rev1 = BLOCK / FINAL LOCK = NO）。**未实施任何代码**；**未修改**任何既有契约。修订项与来源：<br>**A1** §R0.1 措辞："唯一的新构件" → "唯一新增的业务能力"（transport/credential/errors 属同一边界内的构件）。<br>**G10** §R0.2 删除"DB schema 唯一例外"表述 ⇒ 本片**无 schema 例外**。<br>**G9** 新增 §R0.4：本片是 research 包**首次**引入外部网络边界 + 零真实网络硬门。<br>**G7 / M** §R12.1 按**实际 repo 结构**重写（`ports/` + `providers/`；`infrastructure/` 作废）。<br>**M2** §R0.2 / §R12.1 / §R1.6：明确**不新增 port**、不重构 `ports/` barrel。<br>**G1 / N** 新增 §R1.5 Tiancha Required Provider Capability（含 fail closed 与**装配期判定**）。<br>**G8** 新增 §R1.6 `ModelResolverPort` 隔离（架构硬边界）。<br>**G6 / K** §R4.4 重写：**v1 禁止 structured-output 降级**（rev1 的"允许但进身份"作废）。<br>**G3 / D / Q** §R4.3 重写：**Tiancha owns `schemaVersion`**（唯一 owner），删除"两个选项"。<br>**G2 / O** 新增 §R5.0：GenerationIdentity 与 ExecutionTelemetry **两个对象**；§R5.1/§R5.2/§R5.5 同步。<br>**G4 / P** 新增 §R6.5：abort / AbortError 的**唯一归类**。<br>**Q(R7)** §R7.3 重写：冻结**错误协议**（内部对象 + `RunResult.error` 字符串承载 + timeout 例外）。<br>**H2** §R7.4 强化：cause/stack/URL/headers/body/账号 id 一律不出 adapter 边界。<br>**R8** §R8.3 重写：修正 rev1 的错误断言（`calls = 已执行窗口数 × maxAttempts`；v1 成功 = windowCount、第 k 个失败 = k）；T-RMA-12 同步改写。<br>**R9** §R9.4 重写：v1 telemetry **仅内存内**，解决与 `--json` 不动契约的冲突。<br>**D-RMA-R** §R3.1/§R3.2 新增 `endpointIdentity`：**所有改变路由/行为的非敏感配置必须进身份**（堵住 base URL 漏洞）；§R3.4 增加对应 mutation。<br>**G3 补充** 新增 §R5.5：按**现有类型**的精确字段映射（不新增类型字段）+ `extra` 通道键名。<br>**N8（rev2 新发现）** §R0.3 / §R5.5：`snapshotFor()` 目前把模型路径的 `snapshot.model.*` 取自 **legacy 提取器**，而配置身份取自 adapter ⇒ 二者**必须同源**；已核实 F2 的 W 矩阵未断言该字段（不改变既有断言）。<br>**N1–N7** §R13.0 新增测试纪律（必须经 `CandidateExtractionService`、零真实网络、mutation 必须"能杀死"、legacy 回归复用既有测试）；§R13.1 新增 T-RMA-21…T-RMA-29；改写 T-RMA-12 / T-RMA-15。<br>**O** §R14 自检表扩充 10 条。<br>**P / Q** §R15 重组为"已冻结（A/D/G/H/K/L/M + 新增 N/O/P/Q·R）"与"仍需裁定（B/C/E/F/J）"。<br>**Q（范围）** §R16 保持不扩大；**R** §R17 不回写 rev1 的历史状态。 |
| **rev3** | **按 Final Lock Audit 的修订**（rev2 = 不通过：4 个阻塞 + 2 个验收细节）。**未实施任何代码**；**未修改**任何既有契约。<br>**阻塞①（schema 如何到达 adapter）** §R4.3 新增：Tiancha 侧只读 `ExtractionOutputContract`（`{version, schema}`，version 沿用既有 `schemaVersion`）+ **装配期注入** adapter；禁止 adapter 自带/覆写 schema、禁止塞进 `ModelBatchInput`；§R12.1 白名单新增 `application/extraction-output-contract.ts`；T-RMA-22 强化为"**改动 Tiancha 的 schema ⇒ provider 请求随之变化**"。<br>**阻塞②（身份与 snapshot 映射）** §R5.1 重写为 **AdapterIdentity（adapter 声明）** 与 **RequestIdentity（服务组合）** 两层（`schemaVersion` 从 adapter 必填项移除，回归 Tiancha）；§R5.5 新增 **唯一落点表**（可读身份落 `generation.extra.adapterIdentity`、哈希落 `model.modelVersion`、生成参数落 `generation.*`）⇒ §R5.3 的重建判据成立。<br>**阻塞③（包导出）** §R12.2 新增一行：`packages/research/src/index.ts` **只允许新增一行 `export *`**（对齐既有 `providers/echo-data-provider.js` 惯例），**不得**改既有导出行或包 `exports`；明确这是**接线**而非第二条执行路径。<br>**阻塞④（五项未裁决）** §R15 全部冻结：B（`TIANCHA_MODEL_API_KEY` / `TIANCHA_MODEL_CREDENTIAL_FILE` / `TIANCHA_MODEL_AUTH_MODE`）· C（`pid-<identityHash>`）· E（字段与落点 + `extra.adapterIdentity`）· F（`<code>: <message>`）· J（instance 配置 env，与 credential 严格分开）；并新增**本地无认证模式**：只允许 `AUTH_MODE="none"` + **回环地址**，且 `authMode` **进身份**。<br>**验收①（网络 guard 可执行）** §R13.0 补全：替换全局 `fetch` 的 guard（未覆盖的调用立即抛错）+ **同时**断言"计数为 0"与"链路确实产出候选"。<br>**验收②（失效引用与 CLI 分类）** §R1.5 的失效交叉引用修正（`§R7.5` 已实际新增）；新增 **§R7.5** 冻结装配期三条互斥路径与 CLI 映射（未装配 ⇒ `ADAPTER_NOT_CONFIGURED`；不满足 ⇒ 抛 `ProviderError` 并由 `runCandidateExtract()` 装配段捕获 ⇒ `--json` 形状不变、`reason` 取值域扩展）；§R0.2 的 `--json` 措辞同步修正（消除自相矛盾）；新增 **T-RMA-30**（经真实 CLI 入口验证三类分类）。<br>**§R14** 自检表再增 6 条（rev3 项）。 |
| **rev4** | **按 Final Lock 定向复核的修订**（rev3 = FINAL LOCK 暂不锁：2 个 P0 + 3 个 P1 + 一处解析细节）。**未实施任何代码**；**未修改**任何既有契约。<br>**P0-1（身份计算链钉死）** 新增 **§R5.6【最终身份不变量】**：RMA **不**计算 `mxcfg-`，只提供三个输入（AdapterIdentity→`modelVersion`、生成参数、Tiancha 侧版本），最终 `mxcfg-` **必须且只能**由 F2 既有的 `modelExtractionConfigKeyFor(...)` + `generationHashOf(...)` 以**今天的签名**计算；禁止新增 identity/hash/key 函数、禁止自拼前缀；并给出唯一身份链图 + 钉它的测试清单。<br>**P0-2（guard 绕过口）** §R13.0(2) 修正：**无条件同时** guard `globalThis.fetch` + `node:http` + `node:https`（不再"有 fetch 就只 guard fetch"）；断言升级为**三件套**（`guardCalls === 0` 且 `run()` 真实完成模型路径 且 至少一个有效候选）；T-RMA-27 同步改写。<br>**P1-1（schema 版本稳定性）** §R4.3 新增两条：`schemaVersion` 由服务**解析一次**（禁止多处重复表达式）、`schemaVersion → schema` **一对一不可变**（内容变化必须新版本）；T-RMA-22 增 (d)(e) 两个断言。<br>**P1-2（export 不得成为第二条实例化路径）** §R12.2 新增约束行：`index.ts` 的 export **只允许**用于类型引用与 `resolveModelAdapter()` 内部装配，CLI 侧**不得** `new <RealModelAdapter>()`；新增 **T-RMA-31** 覆盖。<br>**P1-3（命名统一）** §R5.0 重写为"**三个实际对象**"：`GenerationIdentity` 降为**概念术语**（不落 interface），runtime 实际只有 `AdapterIdentity` / `RequestIdentity` / `ExecutionTelemetry`；分层规则按三者重写。<br>**§R14** 自检表再增 5 条（rev4 项）。 |
| **rev5** | **按 Final Lock Audit（BLOCK，2 个 P0）的定向修正**。**未实施任何代码**；**未修改**任何既有契约。<br>**P0-A（`GenerationIdentity` 命名矛盾）** rev4 的 §R5.0 已把它降为概念，但 §R12.2 / §R15.1(D-RMA-L) / §R5.4 仍要求它是"必填只读成员" ⇒ 实施者会面对两种互斥解释（新增 interface，或不新增但成员名未定）。rev5 在 **§R5.4** 用代码块**钉死真实成员**：`ModelExtractionAdapter` 只新增 `adapterIdentity: AdapterIdentity` 与 `generationParams: ModelGenerationParams` 两个必填只读成员；`AdapterIdentity` 是**唯一新增的只读类型**（定义在 `application/model-extraction.ts`）；**明令不得存在 `GenerationIdentity` 的任何代码符号**；并要求 `modelVersion === "pid-" + sha256Hex(stableStringify(adapterIdentity))`（T-RMA-32 用 mutation probe 钉）。§R5.0 / §R12.2 / §R15.1 / §R14 同步。<br>**P0-B（`schemaVersion` → assembly 的数据流）** rev4 同时说"Service 解析一次"与"装配期注入"，却没回答"装配发生在 `run()` 之前时，adapter 从哪拿到已解析值"。rev5 在 **§R4.3** 冻结**唯一数据流**：Service 构造时解析**恰好一次** → 以**只读成员** `outputContract: ExtractionOutputContract` 暴露 → CLI 交给 **`resolveModelAdapter(outputContract)`** → adapter **只读持有** → `run()` 用**同一个**值写 snapshot；并**封死三种旁路**（adapter 自解析 / resolver 自解析 / 先建后 `setSchema` 注入），明确 assembly 后不可替换。§R12.2 三行白名单同步（service 暴露只读 contract、resolver 签名、禁止在 resolver 内解析）；新增 T-RMA-33；并明确该签名变更属"补 F2 预留的装配空位"，不是修改 F2 语义。 |
| **rev6** | **按 Final Lock 复核的两个 SHOULD FIX（S1 / S2）的落实**（rev5 = FINAL LOCK PASS（有条件），无新 BLOCKER）。**未实施任何代码**；**未修改**任何既有契约。<br>**S1（`this.extractor` 路径归属表）** 新增 **§R5.7**：实地核实 `candidate-extraction-service.ts` 中 `this.extractor` 共 **3 处、4 行**，并逐行标注归属 —— `L235–242`（legacy `xcfg-` 身份，**不得动**）· `L564–569`（`snapshotFor()` 的 `model.*`，**legacy/model 共用**，模型路径必须改）· `L757`（legacy 分支内的 `extract()`，**不得动**）· **`L970–971`（`claimRun()` 的 INSERT 写入 `extraction_run` 身份列，legacy/model 共用 —— rev5 遗漏的第 4 处接入点）**。据此把 §R0.3 的"三处接入点"更正为**四处**，并规定两个共用点必须"按路径取来源"、**不得直接替换共享代码里的 `this.extractor.*`**（否则移动 legacy 字节、T-RMA-24 打回）。<br>**S2（T-RMA-17 golden）** 明确重建测试的 golden 必须包含 **`dimensionHints` 的全文与顺序**（进 prompt 且顺序敏感）+ `generation.extra.adapterIdentity` 的可读字段全集。<br>**连带** §R12.2 的 `candidate-extraction-service.ts` 行新增 (d)（`claimRun()` 的身份来源可选参数）；**T-RMA-24** 扩展为同时覆盖 `extraction_run` 身份列；§R14 自检表 +2 条 rev6 项。 |

**End of contract（rev6: Real Model Adapter / Provider Implementation Contract —— 纯文档、DESIGN ONLY、**未实现**、**未授权实施**。基线 `6bbb26b`（F2 CLOSED / FROZEN）。rev2 = 按用户 2026-09-29 的正式 A–R Contract Audit（rev1 BLOCK）修订：补齐 REQUIRED 能力与 fail closed、`ModelResolverPort` 隔离、GenerationIdentity / ExecutionTelemetry 分层、`schemaVersion` 单一 owner、abort 唯一归类、错误协议、调用次数不变式、telemetry 仅内存、endpoint 身份归属、按实际 repo 的目录白名单、以及 9 条新硬门测试；**rev3** 再闭合 Final Lock Audit 的 4 个阻塞与 2 个验收细节：schema **如何到达** adapter（Tiancha 侧只读 `ExtractionOutputContract` + 装配期注入）、身份双层（AdapterIdentity / RequestIdentity）+ **唯一 snapshot 落点表**、`index.ts` 单行导出、§R15 五项全部冻结（含本地无认证模式与 `authMode` 进身份）、零真实网络 guard 的可执行方案、§R7.5 装配错误与 CLI 映射（三条互斥路径 + T-RMA-30）；**rev4** 再定向钉死 Final Lock 遗留的 2 个 P0 与 3 个 P1：**P0-1** §R5.6【最终身份不变量】（RMA 不计算/不拼接/不新增 identity 函数，`mxcfg-` 仍只由既有 `modelExtractionConfigKeyFor` + `generationHashOf` 产生）、**P0-2** T-RMA-27 的网络 guard **无条件**覆盖 `fetch + node:http + node:https` 三入口并断言三件套、**P1** ①`schemaVersion` 解析一次且与 schema 一对一稳定 ②`index.ts` 的 export 不得成为第二条 adapter 实例化路径（唯一装配入口仍是 `resolveModelAdapter()`）③`GenerationIdentity` 降级为概念术语（runtime 只有 AdapterIdentity / RequestIdentity / ExecutionTelemetry 三个对象）；**rev5** 再闭合 Final Lock 的 2 个 P0：**P0-A** 消灭 `GenerationIdentity` 的命名矛盾（§R5.4 钉死 adapter 侧真实成员 = `adapterIdentity: AdapterIdentity` + `generationParams: ModelGenerationParams`，并明令**不得**存在 `GenerationIdentity` 代码符号；§R5.0 / §R12.2 / §R15.1(D-RMA-L) / §R14 / T-RMA-32 同步）、**P0-B** 钉死 `schemaVersion → ExtractionOutputContract → resolveModelAdapter(outputContract) → RealModelAdapter` 的**唯一数据流**（Service 解析一次 + 只读 `outputContract` + 装配期注入 + assembly 后不可替换 + 三种旁路全部封死；§R12.2 / T-RMA-33 同步）；**rev6** 落实 Final Lock 复核的 S1（新增 §R5.7 `this.extractor` 路径归属表，并据此把接入点由三处更正为**四处** —— 补上此前遗漏的 `claimRun()` INSERT 身份列）与 S2（T-RMA-17 的 golden 必须含 `dimensionHints` 全文与顺序）。本片只做一件事：把已冻结的 `ModelExtractionAdapter` 缝接到**一个**真实 provider instance，并保持 F2 的全部语义不变 —— 不新增研究能力、不改数据模型、不新增 port、不做多 provider / fallback / routing / 隐藏 retry。**真实模型适配器仍未授权**；实施前须完成 **Final Lock 复核**（§R15 的全部裁定项已冻结，无遗留待裁定项））.**