# AF-1A Contract Change Proposal — `ExecutionRequest.prompt: string`

> **状态：PROPOSAL / DOCS-ONLY DRAFT**
> **AF-1A Port modification：⛔ NOT AUTHORIZED**（本 Proposal 不是对 Port 的修改）
> **AF-1C Contract Freeze：⛔ NOT READY / BLOCKED**（blocked by 本 Proposal）
> **AF-1C Implementation：⛔ NOT AUTHORIZED**
>
> **Scope:** docs-only。就「AF-1C 需要 `ExecutionRequest.prompt: string`」提出**变更提案**：动机、前后对比、语义、兼容性 / 影响面、不变量、替代方案、门禁顺序。**不修改任何既有文件**（含 `execution-provider.port.ts`）。
> **★ 重要：本 Proposal 中出现的 `prompt: string` 是【变更提案】，不是对 Port 的实际修改。**
> **上游依据（严格继承，均不修改）:** `docs/phaseC/execution-provider-contract.md`（AF-1 rev2 · FROZEN `c3fb4d6` · §18.2 L586-593）· `docs/phaseC/execution-provider-implementation-contract.md`（AF-1 Impl · FROZEN `3294b72`）· `packages/research/src/ports/execution-provider.port.ts`（AF-1A · FROZEN / PUBLISHED `d6d81f1` · sha256 `bb7c5b71…` · `ExecutionRequest` 在 L34-41）· `docs/phaseC/execution-session-lookup-seam-contract.md`（AF-1B · FROZEN `a97cf6b`）· `docs/phaseC/execution-session-lookup-seam-implementation-contract.md`（AF-1B-I · FROZEN `d64b824`）· `docs/phaseC/execution-coordinator-implementation-contract.md`（AF-4 Impl rev2 · FROZEN `38862f5` · §4.2 L155-166 · §4.3 A-9 L186-197）· `docs/phaseC/execution-provider-af1c-implementation-contract.md`（AF-1C Draft · AMENDED / APPROVED · 557 行 · sha256 `75c152dd…` · §8 / §8.1）
> **证据基础:** AF-1C Read-only Preflight（P1–P8，只读）· AF-1C Amended Draft Review（PASS）
> **本 Proposal 不授权任何实现或修改。** 未授权：修改 `execution-provider.port.ts` · 修改任何既有 docs · 修改 Registry / TaskEngine / Orchestrator / CLI / AF-4 · 创建 Provider / Adapter · Freeze AF-1A / AF-1C · G-03 / G-04 / G-05 / G-06 · commit · push。

---

## §0 Status / Authorization

```text
AF-1 rev2 / AF-1 Impl Contract                🔒 FROZEN · 🟢 PUBLISHED
AF-1A（Port + 6 types）                        🟢 CLOSED / PUBLISHED（d6d81f1）
AF-1B Session Lookup Seam                     🟢 FROZEN / PUBLISHED（a97cf6b）
AF-1B-I Registry                              🟢 CLOSED / PUBLISHED（bfe563f）
AF-1C Implementation Contract                 📝 AMENDED DRAFT — APPROVED（557 行 · 75c152dd…）
  P6 Direction                                🟢 CLOSED（A1 SELECTED / PROPOSED）
  P6 Contract                                 🔴 NOT YET CLOSED
AF-1A Contract Change Proposal（本文）          📝 PROPOSAL / DOCS-ONLY DRAFT · ❌ NOT YET REVIEWED
AF-1A Port modification                       ⛔ NOT AUTHORIZED
AF-1C Contract Freeze                         ⛔ NOT READY / BLOCKED（by 本 Proposal）
AF-1C Implementation                          ⛔ NOT AUTHORIZED
AF-4 Coordinator Implementation               ⛔ NOT AUTHORIZED
TaskEngine · R2 · AF-4                        🔒 FROZEN / 不修改
G-03 · G-04 · G-05 · G-06                     🟡 DEFERRED
```

**本轮唯一允许的动作：在 `docs/phaseC/` 下新建本 Proposal 文件。不碰代码、不改既有文档与契约、不 commit、不 push。**

---

## §1 Motivation（P6 缺口）

```text
AF-1C 的执行链（AF-1C Draft §7）需要把一段文本交给 execution session 执行：
        execute(handle, request)
                ├── lookup(handle.sessionId)
                ├── prompt(<prompt input>)      ← ★ 需要一段 text
                ├── read messages
                └── ExecutionOutcome

但 AF-1A 冻结的入参【没有】该文本：
        ExecutionRequest（ports/execution-provider.port.ts L34-41）
            = { taskId, runId, roundId?, model, thinkingLevel, context?: ResearchContext }
            ⇒ 无 prompt / text 字段

且 context 不能充当 prompt：
        ResearchContext（domain/research-context.ts L33-46）
            = { runId, roundId?, taskId?, objective, scope,
                systemPrompt?, appendSystemPrompt?, agentsFilesOverride? }
        其文件头 L2-5 明确：它映射到 Pi resource-loader 通道
            （systemPrompt / appendSystemPrompt / promptsOverride / agentsFilesOverride），
            "never passed as a raw session arg"。
        ⇒ 它是【资源 / 配置】载体，不是【执行输入】。

⇒ 结论（P6）：AF-1C 需要一段「已由上游 execution caller 确定的执行输入文本」，
   而 AF-1A 的 ExecutionRequest 无处承载它。
⇒ 已裁定方向：A1（AF-1C Draft §8.1 · P6 Direction 🟢 CLOSED）。
   本 Proposal 即对 A1 的正式变更提案。
```

**为什么不能由 AF-1C 自行生产该文本**（AF-1C Draft §8 AI-8-1…AI-8-3）：

```text
❌ taskId / runId / roundId 推导
❌ objective（把研究目标偷换成执行提示）
❌ JSON.stringify(request)
❌ "Execute task " + taskId 之类拼接
❌ provider 本地固定文本 / 运行时生成文本
⇒ Provider 是【执行者】，不是 prompt 的【业务生成者】。
```

---

## §2 Proposed Change（A1）

```text
【A1 · SELECTED / PROPOSED】
    ExecutionRequest 增加一个必填字段：

        prompt: string

    语义与约束见 §4；本 Proposal 【不】改写任何文件。
```

**提案后的目标形状（仅作为提案陈述，非已生效契约）：**

```ts
interface ExecutionRequest {
    taskId: string;
    runId: string;
    roundId?: string;
    model: string;
    thinkingLevel: string;
    context?: ResearchContext;
    prompt: string;          // ★ 本 Proposal 提出；语义见 §4
}
```

```text
★ 本 Proposal 不做的事：
  · 不修改 `packages/research/src/ports/execution-provider.port.ts`
  · 不修改 AF-1 rev2 / AF-1 Impl / AF-4 Impl 任何文档
  · 不声明该字段已生效、已冻结或已授权
```

---

## §3 Before / After 对比

| | Before（当前冻结，d6d81f1 / c3fb4d6 / 3294b72） | After（**提案**，未生效） |
| --- | --- | --- |
| `ExecutionRequest` 字段 | `taskId` · `runId` · `roundId?` · `model` · `thinkingLevel` · `context?` | 上述 6 项 **＋ `prompt: string`** |
| 字段数 | 6（含 2 可选） | 7（含 2 可选） |
| `execute()` 形状 | `execute(handle, request)` | **不变**（`execute(handle, request)`） |
| `ExecutionHandle` | `{ sessionId }` | **不变** |
| `ExecutionOutcome` | `succeeded(output) \| failed(error)` | **不变** |
| `ExecutionOutput` | `{ text?, messages?, raw? }` | **不变** |
| `ExecutionError` | `{ message, kind? }` | **不变** |

```text
⇒ 变更面【仅】`ExecutionRequest` 一个字段；`ExecutionProviderPort` 的方法签名与其余 5 个类型【不变】。
```

---

## §4 Semantics（`prompt` 的语义与 SoT）

```text
P-1  ★ `ExecutionRequest.prompt` 语义（冻结提案）：
        「已经由上游 execution caller 确定的、供本次 execution session 执行的
          user/task prompt text」
P-2  数据流（唯一形态）：
            上游 execution caller
                    │（已确定的 prompt）
                    ▼
            ExecutionRequest.prompt
                    │
                    ▼
            AF-1C Provider
                    │
                    ▼
            ExecutionSessionCapability.prompt(text)     （AF-1B-I seam）
P-3  ★ SoT 分离（不得互相充抵）：
            prompt  = execution input（本次要执行的用户 / 任务提示文本）
            context = research / resource context（systemPrompt 类资源注入通道）
            ⇒ ❌ 不得用 context 任何字段回填 / 推导 prompt
            ⇒ ❌ 不得用 prompt 回填 context
P-4  ❌ prompt 【不得】为下列产物：
            ResearchContext.objective · systemPrompt · appendSystemPrompt
            taskId / runId / roundId 的任何推导
            JSON.stringify(request) · 字符串拼接
            provider 本地固定 / 运行时生成的文本
P-5  prompt 的【生命周期】：在一次 `execute()` 调用内是**只读输入**；
            Provider 不得改写、不得回写、不得持久化（artifactization 属 AF-4）。
P-6  prompt 【不】参与 model / thinkingLevel 的事实链（AF-1 IP-D-1 单链不变）。
P-7  prompt 的**生产者**（谁在何时确定它）= future integration caller / 上层执行装配；
            本 Proposal 【不】裁定其具体归属（见 §7 Non-goals / §9 gates）。
```

---

## §5 Compatibility & Impact（影响面）

### §5.1 代码层影响面

```text
【事实】全仓 `ExecutionRequest` 引用仅 2 处，且【无任何构造点 / 无消费者】：
    packages/research/src/ports/execution-provider.port.ts:34   （定义）
    packages/research/src/ports/execution-provider.port.ts:93   （execute 签名使用）

⇒ 兼容性影响（代码层）—— ★ Amendment B（收紧表述）：
    · 无既有 `ExecutionRequest` 对象字面量 ⇒ 当前仓库【无构造点】
    · 唯一类型定义处需新增必填字段 `prompt: string`
    · ★ 精确结论（不得写成「完全向后兼容」）：
          在当前仓库基线中，`ExecutionRequest` 无生产构造点，
          因此增加 required `prompt` 【不会】产生现有仓库运行路径上的构造编译破坏；
          【但】TypeScript required field 的语义意味着 —— 所有未来 / 外部 /
          未纳入当前仓库扫描范围的构造者【都必须】补 `prompt`。
      ⇒ 即：「当前仓库影响面极小」 ≠ 「一般意义上的完全向后兼容」。
⇒ 判定：代码层影响面 = 极小（单文件单字段），但【不是】无条件向后兼容。
```

### §5.2 契约层影响面（★ 本 Proposal 的关键发现）

```text
⚠️ A1 不是「只改一处」，而是【需同步的跨文档变更】：

① `packages/research/src/ports/execution-provider.port.ts`（AF-1A · 唯一代码定义处）
     ⇒ 需新增 `prompt: string`

② `docs/phaseC/execution-provider-contract.md`（AF-1 rev2 · §18.2 L586-593）
     ⇒ §18.2 的 `ExecutionRequest` 语义 shape 需同步
     ⇒ 形式【已裁定】= **rev2 + Amendment 1**（沿用既有 Amendment 模式：追加修订段、
        保留 rev2 原文与 Status 行）—— 但仍需独立 Review / Freeze，不得直接改

③ ★ `docs/phaseC/execution-coordinator-contract.md`（AF-4 **Design** Contract · FROZEN）
     ⇒ **§7 `ExecutionRequest`（L195 章标题）· L200 `interface ExecutionRequest {`**
        —— 本文档存在【独立的 shape 复刻】（此前未被列为同步面，本轮补入）
     ⇒ ⇒ ⚠️ 一旦 AF-1A 增加 `prompt`，AF-4 Design §7 将与之**漂移** ⇒ 必须同步
     ⇒ ⇒ ⇒ ★ **AF-4 Design Contract 与 AF-4 Implementation Contract 是两个【独立冻结契约】**，
           各自有自己的契约责任与后续 Gate ⇒ 【不得】合并成一个「AF-4 同步点」

④ `docs/phaseC/execution-coordinator-implementation-contract.md`（AF-4 **Impl** rev2 · FROZEN）
     ⇒ §4.2 L155 明确写：「`ExecutionRequest` 字段冻结（结构 = AF-1 rev2 §18.2，不新增字段）」
        且 L157-166 **逐字复制了该 interface 形状**
     ⇒ ⇒ ⚠️ 一旦 AF-1A 增加 `prompt`，AF-4 Impl §4.2 将与之**漂移** ⇒ 必须同步
     ⇒ §4.3 **A-9（事实来源唯一性，L186-197）逐字段指定了来源**：
            runId / roundId?      ← TaskEngine.get(taskId)
            model / thinkingLevel ← TaskEngine.listAttempts(taskId) 中匹配 attempt
            context?              ← future integration caller / 上层提供
        ⇒ ⇒ ⚠️ **A-9 中【没有】prompt 的来源条目** ⇒ 新字段将处于「无 SoT 指定」状态
        ⇒ ⇒ ⇒ AF-4 侧需补充 `prompt` 的来源指定（否则违反 A-9 的「事实来源唯一性」纪律）

⑤ ★ `docs/phaseC/execution-provider-implementation-contract.md`（AF-1 **Impl** Contract · FROZEN）
     ⇒ **L171：`· 入参 request = { taskId, runId, roundId?, model, thinkingLevel, context? }`**
        —— 本文档**已复刻 `ExecutionRequest` 的字段列表**（此前未列为同步面，本轮补入）
     ⇒ ⇒ ★ 更正先前事实记录：旧稿曾写「AF-1 Impl 未复刻该 shape —— 需在 Review 时复核」，
           经本轮补核（全仓扫描 + 逐文档核对）证实**该表述不准确**；
           正确表述为：**AF-1 Impl 已复刻 `ExecutionRequest` 字段列表，因此属于本次 shape 同步面；
           其同步状态需与 AF-1A Port / AF-1 rev2 一并独立审查。**
     ⇒ ⇒ 其余引用点（L89 / L132 / L169 / L350）仅为列举、签名引用与描述，**不含字段级复刻**
     ⇒ 依赖链归属：**② AF-1 rev2 → ⑤ AF-1 Impl**（同一 AF-1 系的同步链）

     ★ Amendment A — AF-4 独立门禁（冻结）：
           AF-1A A1 Proposal
               → identifies AF-4 synchronization dependency
               → does NOT authorize AF-4 modification
           AF-4 prompt source / A-9 amendment
               → requires separate AF-4 Contract Amendment / Authorization
           ⇒ AF-4 的 prompt 来源属【AF-4 独立契约同步 / 变更依赖】，
             【不属于】AF-1A Port Amendment 的隐含授权范围。
           ⇒ 锁死：**AF-1A Authorization  ⇏  AF-4 Authorization**（不得「顺手改 AF-4」）。
           ⇒ ★ 该原则同样适用于 AF-4 **Design** Contract（③）与 AF-4 **Impl** Contract（④）：
             二者各自独立授权，彼此也不互相隐含授权。

⑥ `docs/phaseC/execution-provider-af1c-implementation-contract.md`（AF-1C Draft）
     ⇒ 已含 §8 / §8.1 / AI-8-5…AI-8-9；本 Proposal 通过后其 P6 Contract 方可闭合

【非同步面（仅引用，不含 shape 复刻）】
  · AF-1B（`execution-session-lookup-seam-contract.md` L277）· AF-1B-I
    （`execution-session-lookup-seam-implementation-contract.md` L274 SI-MOD-3）
    —— 二者仅出现 `TaskAttempt.model → ExecutionRequest.model → actual execution` 的 model 链引用，
      不含 `ExecutionRequest` shape；且二者整体不依赖 `ExecutionRequest`
      （Registry 的唯一 key 是 opaque `sessionId`；seam 仅 `prompt(text)` + `messages`）
```

### §5.3 影响面汇总

```text
需同步的文件（若本 Proposal 获批）—— **共 6 处**：
  ① packages/research/src/ports/execution-provider.port.ts         （+ prompt: string）
  ② docs/phaseC/execution-provider-contract.md（AF-1 rev2 §18.2）   （同步 shape；形式 = rev2 + Amendment 1）
  ③ docs/phaseC/execution-coordinator-contract.md（AF-4 Design §7 · L195 / L200）
                                                                     （同步 shape）
  ④ docs/phaseC/execution-coordinator-implementation-contract.md（AF-4 Impl §4.2 / A-9）
                                                                     （同步 shape + 补 prompt 的 SoT）
  ⑤ docs/phaseC/execution-provider-implementation-contract.md（AF-1 Impl L171 字段列表）
                                                                     （同步 shape）
  ⑥ docs/phaseC/execution-provider-af1c-implementation-contract.md  （P6 Contract 闭合）

★ 事实更正：旧稿曾写「AF-1 Impl 未复刻该 shape —— 需在 Review 时复核」，**该表述已被本轮补核证伪**；
  正确表述：AF-1 Impl（⑤）**已复刻** `ExecutionRequest` 字段列表，属本次 shape 同步面。

非同步面（仅引用，不含 shape 复刻）：
  · AF-1B（execution-session-lookup-seam-contract.md L277）
  · AF-1B-I（execution-session-lookup-seam-implementation-contract.md L274 SI-MOD-3）
```

```text
★ 完整同步链（这是【关系】，不是授权）—— **6 处**：
      ① Port
          ↓
      ② AF-1 rev2 Contract
          ↓
      ⑤ AF-1 Impl Contract

      ③ AF-4 Design Contract
          ↓
      ④ AF-4 Impl Contract

      ⑥ AF-1C Contract

      ⇒ 三组之间存在【同步依赖】，但【不存在】「一次授权全部修改」的关系。

⚠️ 上述同步【不在本 Proposal 内执行】；本 Proposal 只提出与披露影响面。
⚠️ ★ **同步关系 ≠ 本 Proposal 的修改授权**：上述每一处
      （① Port / ② AF-1 rev2 / ③ AF-4 Design / ④ AF-4 Impl / ⑤ AF-1 Impl / ⑥ AF-1C）
   必须各自经过其对应的 Contract Amendment Gate（独立授权）。
⚠️ ★ 交叉不隐含关系（冻结）：
      AF-1A Authorization          ≠ AF-4 Design Authorization
                                   ≠ AF-4 Impl Authorization
                                   ≠ AF-1C Freeze Authorization
      AF-4 Design Authorization    ⇏ AF-4 Impl Authorization（两个独立冻结契约）
⚠️ ★ ③ AF-4 Design 与 ④ AF-4 Impl 是【两个独立冻结契约】，【不得】合并成一个「AF-4 同步点」。
```

---

## §6 Invariants（不变量与冻结面影响分析）

```text
【不变量保持（不得因 A1 而被破坏）】
I-1  `ExecutionProviderPort.execute(handle, request): Promise<ExecutionOutcome>` 形状【不变】。
I-2  `ExecutionHandle = { sessionId }`（identity，非 capability object）【不变】。
I-3  `ExecutionOutcome.status ∈ { "succeeded", "failed" }` 唯一判别字段【不变】；
     `ExecutionError.kind` 仍仅为诊断分类。
I-4  `ExecutionOutput.messages` / `raw` 保持 `unknown` 系；不得借 prompt 引入 Pi 类型（EP-15）。
I-5  model / thinkingLevel 事实链单向（`TaskAttempt → ExecutionRequest → 实际执行`）；
     prompt 不参与该链（§4 P-6）。
I-6  Registry 的 seam 仍仅 `prompt(text)` + `messages`（AF-1B-I SI-13 / SI-14）；不因 A1 扩张。
I-7  AF-1B-I 的 `sessionId` opaque 唯一 key 语义不受影响。
I-8  无 lifecycle / scheduler / retry / timeout / concurrency 语义引入。
I-9  `ExecutionRequest` 仍【不】含 `attemptId`（它只走 AF-4 的 `DispatchedExecutionContext`；
     不得因增加 prompt 而顺手引入 attemptId 或第三套 identity）。

【对 AF-1 rev2 §18.2 的影响】
· 字段级增补（+ prompt）属 §18.2 语义 shape 的变更 ⇒ 不能以「实现细节」处理；
  需在 AF-1 侧给出等价 amendment 或 rev3，并重走 Review / Freeze。
· 其余 5 个类型与 `execute()` 形状不受影响。

【对 AF-1B / AF-1B-I 的影响】
· 无。二者无 `ExecutionRequest` 依赖；seam 与 Registry 语义保持原样。

【对 AF-4 的影响】
· 见 §5.2 ④：AF-4 **Impl** §4.2 的「结构 = AF-1 rev2 §18.2，不新增字段」表述与新形状冲突，需同步；
· §4.3 A-9 需为 `prompt` 补一条来源指定，否则违背「事实来源唯一性」。
· AF-4 的 invoke 边界（`Coordinator` 调用 `provider.execute`）不变。

【对 AF-4 Design Contract 的影响】（★ 本轮补入）
· 见 §5.2 ③：`docs/phaseC/execution-coordinator-contract.md` §7 存在【独立的 shape 复刻】
  （L195 章标题 · L200 `interface ExecutionRequest {`）⇒ 需同步。
· 它与 AF-4 **Impl** Contract 是【两个独立冻结契约】：
  各自有独立的契约责任与后续 Gate ⇒ 【不合并】，也【不互相隐含授权】。

【对 AF-1 Impl Contract 的影响】（★ 本轮补入 · 并更正旧稿事实）
· 见 §5.2 ⑤：`docs/phaseC/execution-provider-implementation-contract.md` **L171
  `· 入参 request = { taskId, runId, roundId?, model, thinkingLevel, context? }`**
  已复刻 `ExecutionRequest` 字段列表 ⇒ 属本次 shape 同步面，需同步。
· ★ 更正：旧稿「AF-1 Impl 未复刻该 shape」的表述**不成立**，已在本轮修正。
· 依赖归属：② AF-1 rev2 → ⑤ AF-1 Impl（同一 AF-1 系同步链）。
```

---

## §7 Non-goals

```text
❌ 不修改 `execute(handle, request)` 方法形状（不引入第三参数）
❌ 不引入 `ExecutionInput` 之类容器抽象（避免无证据的泛化）
❌ 不为 prompt 引入 attachments / images / stream / metadata / variables / toolInput
❌ 不裁定 prompt 生产者（future integration caller）的具体归属与实现
❌ 不引入 timeout / retry / scheduler / concurrency
❌ 不修改 AF-1B / AF-1B-I / Registry / TaskEngine / Orchestrator / CLI / AF-4 实现
❌ 不解决 G-03 / G-04 / G-05 / G-06
❌ 不在本 Proposal 内执行任何代码或文档修改
```

---

## §8 Rejected alternatives

```text
A2 — REJECTED FOR THIS SLICE
    `ExecutionRequest` 增加 `input: ExecutionInput`，其中 `ExecutionInput = { prompt: string }`
    理由：当前仅需 prompt 一项；无证据表明需要容器抽象 ⇒ 属 future-proof 泛化，
          与「最小契约面」纪律冲突。

B — REJECTED
    改端口签名 `execute(handle, request, input)`
    理由：会改变 AF-1 rev2 §18.2 已冻结的 `execute(handle, request)` 形状，
          属更大的 Contract Surface Change；prompt 本质属一次 execution request 的输入事实，
          无需为它拆第三参数。

（其余候选：把 prompt 塞入 ResearchContext / 由 Provider 自造 —— 均已在 AF-1C Draft §8
  AI-8-1…AI-8-3 明确禁止，不再列为候选。）
```

---

## §9 Process & gates

```text
严格顺序（每一步独立授权）：
    ① AF-1C Draft Amendment                        ✅ DONE（557 行 · 75c152dd…）
    ② AF-1C Amended Draft Review                   ✅ PASS / APPROVED
    ③ AF-1A Contract Change Proposal（本文）        📝 本轮（docs-only）
    ④ Proposal Review                              ⏳ 待办（见下 7 项检查）
    ⑤ 显式 Authorization                           ⛔
    ⑥ AF-1A Port Contract Amendment                ⛔（① Port）
    ⑥a AF-1 rev2 Contract Amendment                ⛔（② AF-1 rev2 · 形式 = rev2 + Amendment 1）
    ⑥b AF-1 Impl Contract Amendment                ⛔（⑤ AF-1 Impl · 依赖 ②）
    ⑥′ AF-4 Design Contract Amendment              ⛔（③ AF-4 Design §7 · ★ 独立门禁 / 独立授权）
    ⑥″ AF-4 Impl Contract Amendment（A-9 补 prompt 来源）
                                                    ⛔（④ AF-4 Impl · 独立门禁；⇏ 由 ⑥′ 隐含授权）
    ⑦ AF-1C P6 Contract 闭合                        ⛔（⑥ AF-1C Draft）
    ⑧ AF-1C Freeze Readiness Review                 ⛔
    ⑨ AF-1C Contract Freeze                        ⛔
    ⑩ AF-1C Implementation                         ⛔

    ⇒ ★ 上述每一处均为【独立授权】，不存在「一次授权全部修改」；
      尤其 AF-4 Design（③）与 AF-4 Impl（④）是两个独立冻结契约，不合并、不互相隐含。
```

```text
Proposal Review 的 7 项检查（供 Review 时对照）：
  1. 是否确实只改变 AF-1A 所需的最小契约面
  2. `prompt` 的 SoT / 生命周期 / 数据流是否闭合（§4 P-1…P-7）
  3. 是否破坏 AF-1 rev2 §18.2 的既有不变量（§6 I-1…I-9）
  4. 是否影响 AF-1B / AF-1B-I（§6 结论：无）
  5. 是否与 AF-4 `ExecutionRequest` 消费边界一致（§5.2 ③ · §6）
  6. 是否存在不必要的兼容性或泛化（§7 / §8）
  7. 是否存在「Proposal 文档偷偷变成 Implementation Contract」的越界
```

```text
★ 本 Proposal 通过 ≠ 修改 Port 获得授权。

★ 防越权规则（冻结）—— Proposal Review 通过【仅】证明 A1 值得进入 Contract Amendment：
      Proposal Review 通过
          ≠ AF-1A Port modification authorization
          ≠ AF-1 Contract synchronization authorization
          ≠ AF-4 modification authorization
          ≠ AF-1C Freeze authorization
```

---

## §10 OUT 复核清单

```text
✅ 本 Proposal 未修改任何文件（含 `execution-provider.port.ts`）
✅ 本 Proposal 未修改任何既有 docs 与契约（AF-1 rev2 / AF-1 Impl / AF-1B / AF-1B-I / AF-4 Impl / AF-1C Draft）
✅ 本 Proposal 未创建 Provider / Adapter
✅ 本 Proposal 未 Freeze 任何契约（AF-1A / AF-1C 均未 Freeze）
✅ 本 Proposal 未引入 `execute(handle, request)` 形状变更
✅ 本 Proposal 未引入 `ExecutionInput` 容器 / prompt 附件 / 流式 / metadata 泛化
✅ 本 Proposal 未引入 timeout / retry / scheduler / concurrency / 第二套状态机
✅ 本 Proposal 未新增 interface / class / Map / 任何 .ts 实现
✅ 本 Proposal 未处理 G-03 / G-04 / G-05 / G-06
✅ 本 Proposal 未 commit · 未 push
✅ 本 Proposal 如实披露了跨文档同步影响面（含 AF-4 Impl §4.2 / A-9 的漂移风险）
```

---

**End of proposal（AF-1A Contract Change Proposal — ExecutionRequest.prompt: string · PROPOSAL / DOCS-ONLY DRAFT）**
