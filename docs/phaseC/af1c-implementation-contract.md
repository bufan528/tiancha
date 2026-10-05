# AF-1C · Pi Execution Provider Implementation Contract

> **状态：🔒 FROZEN（AF-1C Implementation Contract Freeze）· 仅文档 · 零代码**
> **AF-1C Implementation：⛔ NOT AUTHORIZED**（★ Freeze ≠ Implementation Authorization）
> **基线：AF-1C Frozen Contract（`execution-provider-af1c-implementation-contract.md` · 🔒 FROZEN @`ce0802a`）**
> **本文件不修改 AF-1C Frozen Contract、AF-1 rev2、AF-1 Impl、AF-4 Design/Impl、AF-1A Port、AF-1B、AF-1B-I 中的任何一份。**

```text
本契约的唯一目的：
  把「架构裁定」落成可实施、可验收的【实施规格】。
  它不重新设计行为边界（那已由 AF-1C Frozen Contract 冻结），
  只回答：在哪里落文件、谁持有什么、谁禁止做什么、按什么顺序、如何验收。

【裁定 vs 代码 —— 严格区分】
  本契约中所有「已裁定」的项，一律标注为 RESOLVED / DECIDED。
  未写过的代码，一律标注为 NOT IMPLEMENTED。
  ⇒ 不得把「裁定完成」读成「代码已存在」。
```

---

## §0 Status / Authorization

```text
【上游 / 基线（全部只读引用，本契约不改）】
AF-1A Port（execution-provider.port.ts）              d6d81f1 + ① Port Amendment（prompt: string）
AF-1 rev2（execution-provider-contract.md）           c3fb4d6 + §18.9 Amendment 1
AF-1 Impl（execution-provider-implementation-contract.md）  3294b72 + §18 Amendment 2
AF-4 Design（execution-coordinator-contract.md）      1e796a5 + §20 Amendment 1（R-5）
AF-4 Impl（execution-coordinator-implementation-contract.md） 38862f5 + Amendment 1（§4.3 A-9）
AF-1B（execution-session-lookup-seam-contract.md）    a97cf6b（FROZEN / PUBLISHED）
AF-1B-I（execution-session-lookup-seam-implementation-contract.md） d64b824（FROZEN / PUBLISHED）
AF-2 + AF-3（task-engine-failure-boundary-contract.md） eef63ac（FROZEN）
R2（round-execution-driver-contract.md）              275b84d（FROZEN）
AF-1C Frozen Contract（execution-provider-af1c-implementation-contract.md）  🔒 FROZEN @ce0802a
AF-1A Change Proposal（af1a-contract-change-proposal-execution-request-prompt.md） 🟢 APPROVED

【本契约解决的四项 Implementation Decision（O-AIC）】
O-AIC-1  🟢 DECIDED    Provider 落点
O-AIC-2  🟢 DECIDED    不新增 SessionLookup interface
O-AIC-3  🟢 DECIDED    Pi Adapter 落点（REVISED：src/，非 research）+ SourcePort ❌ REJECTED
O-AIC-6  🟢 DECIDED    诊断约定 session_lookup_miss / prompt_failed（非 exhaustive enum）

【本契约纳入的 G-04 Composition Boundary 裁定】
G-04 Boundary Decision   🟢 RESOLVED
G-04 Preflight           🟢 CLOSED（G04-P1…P5 全 PASS）
P4 seam                  🟢 b1′（最小权限 seam；禁止公开 registry）
P5 remove                🟢 绑定 `ChildSession.close()` 生命周期

【未授权项（本契约不得越权）】
AF-1C Implementation                       ⛔ NOT AUTHORIZED
修改 src/                                   ⛔ NOT AUTHORIZED
修改 packages/research/src/runtime/         ⛔ NOT AUTHORIZED
Commit                                      ⛔ NOT AUTHORIZED
Push                                        ⛔ NOT AUTHORIZED
G-03 / G-04 / G-05 / G-06                  🟡 DEFERRED
AF-4 Design / Impl Status Cleanup           📋 INDEPENDENT / DEFERRED

【实现状态（一律 NOT IMPLEMENTED）】
PiExecutionProvider            ⏸ NOT IMPLEMENTED
PiSessionCapabilityAdapter     ⏸ NOT IMPLEMENTED
TianchaRuntime 的注册 seam      ⏸ NOT IMPLEMENTED
register 写入点                 ⏸ NOT IMPLEMENTED
remove 生命周期绑定             ⏸ NOT IMPLEMENTED
```

**本轮唯一允许的动作：在 `docs/phaseC/` 下新建本文件。不碰代码、不改既有契约、不 commit、不 push。**

---

## §1 Purpose / Scope / Non-goals

### §1.1 Purpose

把 AF-1C Frozen Contract（行为边界）翻译成**可实施的落点、所有权、时序与验收规格**，使「谁写哪一行、谁持有什么、谁绝对不能做什么」不再有解释空间。

### §1.2 Scope

```text
本契约覆盖：
  · AF-1C 实现的两处文件落点（Provider / Adapter）
  · Registry 的 ownership 与两个写入语义（register / remove）的挂点
  · composition boundary 的最小 seam 形态（b1′）
  · Provider 的构造依赖与执行流程规格
  · Adapter 的输入/输出规格
  · 诊断约定（kind 取值）
  · 测试规格与验收门
  · 未闭合边界（G-04 writer 生产化 / R-2B / G-05 / G-06）的登记
```

### §1.3 Non-goals（本契约明确不做）

```text
❌ 不重新设计 AF-1C 的行为边界（已由 AF-1C Frozen Contract 冻结）
❌ 不实现任何代码（本契约零代码）
❌ 不修改 src/ 与 packages/research/src/runtime/ 的任何文件
❌ 不新增 Port（SourcePort 已 REJECTED）
❌ 不新增 SessionLookup interface（O-AIC-2 = 不新增）
❌ 不扩大 ExecutionSessionCapability 的能力面
❌ 不让 Provider / Adapter / TaskEngine 承担 registry ownership
❌ 不解决 G-04 的「生产 writer 何时接入」（那是独立的 G-04 生产化切片）
   ⇒ ★ 澄清（G9）：本契约【裁定】G-04 的代码挂点位置（§6 IC-6-2 / IC-6-2.1），
      但【不授权】把该挂点接入生产运行链；「挂点已裁定」≠「生产 writer 已接入」
❌ 不解决 G-05（ChildSession.close 与 Pi dispose/abort）/ G-06（model fidelity）
❌ 不引入 scheduler / retry / concurrency / timeout 语义
❌ 不引入 ExecutionInput / prompt resolver / prompt policy / runtime abstraction
```

---

## §2 Freeze dependency（逐字继承，不解释、不改写）

```text
AF-1C Frozen Contract 已冻结的关键边界（本契约只能沿用，不得松动）：
  · Provider 是 consumer：不创建 session、不注册、不做 model resolution、不进入 TaskEngine
  · 执行链唯一形态：execute(handle, request) → lookup(handle.sessionId) → prompt → messages
  · lookup miss ⇒ 显式失败（不得伪装成 model / execution failure）
  · prompt() throw ⇒ 显式失败；失败统一为 ExecutionOutcome.failed
  · messages 保持 unknown[]；❌ 不得声明为 Pi 类型
  · ❌ Provider 不 artifactize、不写 Task/Round/Run 状态、不调度、不重试
  · ❌ Provider 不调 close / dispose / abort / finishSession / waitForIdle
  · prompt() resolve ≡ execution settled（无需额外 settlement 调用）
  · 顶层判别字段唯一为 status；不得引入第二套分类字段
  · ExecutionRequest 形状（含 Amendment 1 的 prompt）逐字继承 AF-1 rev2 §18.2：
      taskId / runId / roundId? / model / thinkingLevel / prompt / context?
```

---

## §3 实现落点（O-AIC-1 / O-AIC-3 / S3）

```text
IC-3-1  PiExecutionProvider 落点（O-AIC-1 · DECIDED）
        packages/research/src/runtime/pi-execution-provider.ts
        · 与 session-registry / execution-session 同层（runtime 内部 seam）
        · ★ 不进入 packages/research/src/providers/（C6 RMA 命名空间 · AI-4-1）
        · ★ 不加入 packages/research/src/runtime/index.ts（保持内部 seam）
        · ★ 不得 import 任何 Pi 类型（EP-15）

IC-3-2  PiSessionCapabilityAdapter 落点（O-AIC-3 · DECIDED / REVISED · S3 ADOPTED）
        src/agent/pi-session-capability-adapter.ts
        · ★ 落在 Pi 接触层（src/），不落 packages/research（research 永不 import Pi）
        · ★ 不加入任何 research barrel（它在 research 之外）

IC-3-3  ExecutionSessionSourcePort ❌ REJECTED
        · 不定义、不落盘、不加入 ports/index.ts
        · 理由：capability 与 sessionId 在同一创建调用点配对（§6 / §7），
          source/lookup 形态会退化为第二套 SessionLookup（与 O-AIC-2 冲突）

IC-3-4  SessionLookup interface ❌ 不新增（O-AIC-2 · DECIDED）
        · Provider 依赖具体类 SessionRegistry，但行为契约仅允许 .lookup()
        · 类型层不强制（接受），由契约层（IC-9）＋实现审查＋测试三重约束

IC-3-5  依赖方向（不可逆）
        src/（Pi 接触层）──► packages/research（执行抽象层）
        · research 侧只认识：ExecutionSessionCapability / SessionRegistry /
          ExecutionProviderPort / ExecutionRequest / ExecutionOutcome
        · research 侧完全不知道：Pi / AgentSession / createAgentSessionFromServices /
          dispose / abort / SessionManager
```

---

## §4 PiExecutionProvider 规格

```text
IC-4-1  类与端口
        export class PiExecutionProvider implements ExecutionProviderPort
        execute(handle: ExecutionHandle, request: ExecutionRequest): Promise<ExecutionOutcome>

IC-4-2  构造输入（最小）
        { registry: SessionRegistry }
        · ★ 只接收 registry；不得接收 source / provider factory / taskEngine / modelRouter
        · ★ 允许只使用 registry.lookup(...)（IC-9-3）
        · ★ 不得持有 Pi 类型、不得持有 AgentSession、不得持有 ChildSession

IC-4-3  执行流程（唯一形态 · 与 AF-1C Frozen §7 逐条一致）
        ① lookup(handle.sessionId)
             · miss ⇒ return { status: "failed", error: { message, kind: "session_lookup_miss" } }
                 ⇒ 【不得】读 messages、【不得】产 output（AF-1C AI-9-3）
                 ⇒ 【不得】伪装成 model / execution failure（AF-1C AI-9-2）
             · hit  ⇒ capability = 该实例（原引用，不复制、不包装、不代理 · SI-LKP-2）
        ② await capability.prompt(request.prompt)
             · resolve ≡ settled ⇒ 【不得】再调 waitForIdle / 任何 settlement
             · throw   ⇒ return { status: "failed", error: { message, kind: "prompt_failed" } }
        ③ 读 capability.messages
             · 投影为 ExecutionOutput { text?, messages? }
             · messages 保持 unknown[]；❌ 不得声明为 AgentMessage[] 或任何 Pi 类型
             · raw 当前无消费者 ⇒ 【不得】要求 Provider 填充 raw
        ④ return { status: "succeeded", output }

IC-4-3.1  ★ messages → text 的确定性投影规则（本契约裁定 · 消除解释空间）
        【背景事实（已取证）】调用方所指的 “AF-1B Settlement/Output Preflight 结论”
        从未落盘为任何文档：docs/phaseC/ 下无该文件；AF-1C Frozen 只写
        「text 是 messages 的【确定性投影】」（AI-11-3），AF-1 rev2 只写 `text?: string`。
        ⇒ 因此投影规则在本契约中【显式固定】，不留实现自由。

        【唯一允许的投影（Provider 必须逐字实现）】
            let text: string | undefined = undefined;
            const msgs = capability.messages;                    // unknown[]
            for (let i = msgs.length - 1; i >= 0; i--) {         // 从后向前找
                const m = msgs[i] as { role?: unknown; content?: unknown };
                if (m?.role !== "assistant") continue;           // 只认 assistant
                text = projectContent(m.content);
                break;                                            // 取【最后一条】assistant
            }
            其中 projectContent(c)：
                · typeof c === "string"          ⇒ 返回 c
                · Array.isArray(c)               ⇒ 按【数组顺序】遍历 c 的每个元素，逐个判定：
                      · 元素为 { type: "text", text: string }（type 严格等于 "text"
                        且 text 为 string）⇒ 该 text 作为一个片段
                      · 其余元素（非 text block，含 type 非 "text" / text 非 string /
                        形状不符）⇒ 【跳过】：不产片段、不报错、不占位
                  最后把所有片段按上述数组顺序以 "\n" 连接（无任何 text block ⇒ 返回 ""）
                · 其它（undefined / 其它形状）    ⇒ 返回 ""（不得编造、不得 JSON.stringify）

        【硬约束（逐条）】
            · 只读 role / content 两个字段；其余字段（含任何 provider/Pi 专有字段）一律不读
            · 元素形状按【结构化假设】读取，❌ 不得引入任何 Pi 类型或消息类型声明
            · 无 assistant message ⇒ 返回 { status: "succeeded", output: { messages } }，
              text 【省略】（undefined）；❌ 不得编造文本、❌ 不得把空串当成功文本以外的语义
            · ❌ 不得使用 JSON.stringify / ❌ 不得拼接【全部】message / ❌ 不得取非 assistant message
            · ❌ 不得从 Pi session 取 “final text” getter 或新增 Pi-specific API（AF-1C AI-11-3）
            · messages 字段本身【原样透传】（不筛选、不裁剪、不重排）

        ⇒ ★ 该规则是本契约的【裁定】，不是对既有文档的引用（因该文档不存在）。
        ⇒ ★ 若未来需要变更投影语义，必须走契约 Amendment，不得在实现中自行调整。

IC-4-4  绝对禁止（逐条 · 与 AF-1C §17.1 一致）
        ❌ registry.register(...) / registry.remove(...)
        ❌ new SessionRegistry()
        ❌ 调用 close / dispose / abort / finishSession / waitForIdle
        ❌ 读取 session.model / session.thinkingLevel（第二真相源）
        ❌ 调用 ModelRouter.resolve()
        ❌ 访问 TaskEngine 任何 private state（含 openSessions）
        ❌ 写 Task / Round / Run 状态、artifactize、调度、重试
        ❌ 从 taskId / objective / context 推导 prompt
        ❌ 从 child-${taskId} 之类字符串反推 sessionId

IC-4-5  model / thinkingLevel 的来源（A-6 / AC-3 / E-1·E-2）
        · Provider 【不得】自行 resolve，也【不得】读 session getter 建立第二真相
        · request.model / request.thinkingLevel 由上游 execution caller 装配传入（只读使用）
```

---

## §5 PiSessionCapabilityAdapter 规格

```text
IC-5-1  类与职责（唯一职责）
        src/agent/pi-session-capability-adapter.ts
        Pi AgentSession ──► ExecutionSessionCapability
        · ★ 它是 Pi 边界的转换器：把 Pi 的真实 session 对象收窄为 research 认识的最小能力面

IC-5-2  输入 / 输出
        输入：Pi AgentSession（在此文件内接触 Pi 类型 —— 这是它存在的理由）
        输出：ExecutionSessionCapability { prompt(text): Promise<void>; readonly messages: unknown[] }
        · messages 必须以结构不透明方式暴露为 unknown[]（不得把 AgentMessage[] 直接外泄为 Pi 类型）
        · prompt(text) 直接映射 AgentSession.prompt(text)；resolve ≡ settled（无需附加调用）
        · ★ G7 澄清：Adapter 【不做】messages 的语义投影 —— 只做【类型视图收窄】
          （把 Pi 的 AgentMessage[] 以 unknown[] 视图暴露）。
          ⇒ ❌ 不筛选、❌ 不裁剪、❌ 不重排、❌ 不浅拷贝/深拷贝（保持原引用语义，
            与 SI-LKP-2「返回原实例引用」一致）
          ⇒ 语义投影（messages → text）只发生在 Provider 侧（IC-4-3.1），不在此处。

IC-5-3  不得承担
        ❌ 生成 / 分配 sessionId
        ❌ 调用 registry.register / remove
        ❌ 持有 SessionRegistry
        ❌ model resolution
        ❌ session lifecycle 决策（close / dispose / abort 的【调用时机】不由它决定，见 §6）
        ❌ 暴露 abort / dispose / close / waitForIdle / model / thinkingLevel / state / raw
          （SI-14：registered capability 不得以最小能力形式暴露这些）

IC-5-4  边界声明
        · 本文件位于 src/ ⇒ 允许 import Pi 类型
        · ★ 但它【产出】的类型（ExecutionSessionCapability）必须不含任何 Pi 类型
        · ★ 不得成为第二套 session creation seam（不创建 session，只转换）
```

---

## §6 Registry ownership 与生命周期绑定（P5 裁定）

```text
IC-6-1  ownership（SI-OWN-1 的落地）
        Registry 的 ownership = composition root / concrete-session owning side = src/
        · ★ 不是 Provider、不是 Adapter、不是 TaskEngine、不是 Orchestrator、不是 AF-4
        · ★ TaskEngine 继续只管 ChildSession 生命周期，它【不需要知道 Registry 存在】

IC-6-2  register 的唯一【注册调用点】（P4 / 架构裁定）
        ⇒ ★ 术语（G4）：本项只规定 register；remove 的调用点见 IC-6-3。
          两者合称 Registry 的两个 mutation 调用点，不得合并表述为「唯一写入点」。
        在 AgentSession 创建返回点（同一栈帧内同时可见 sessionId 与 AgentSession）：
            src/cli/tiancha.ts 的 AgentSessionFactory implementation，create(opts) 内、
            `return ChildSession` 之前
        顺序：
            const result = await createAgentSessionFromServices({...})
            const capability = new PiSessionCapabilityAdapter(result.session)
            const sessionId  = <本 factory 决定的全值>
            <register>(sessionId, capability)          ← 唯一【注册】调用点
            return { sessionId, taskId, close() }
        · ⇒ ★ 不存在「ChildSession 已对外可用但 registry 尚未建立」的窗口
          （因 TaskEngine 在 `await create()` 返回后才会 openSessions.set）

IC-6-2.1  ★ 与 G-04 生产化的区别（G9 澄清 · 必须逐字保留）
        「register 调用点已裁定」 ≠ 「register 已接入生产运行链」：
            · 本契约只裁定该调用点的【代码位置】与【时序】
            · ❌ 不授权把该调用点接入当前生产路径（生产 writer = G-04，仍 DEFERRED）
            · ❌ 不授权修改 orchestrator.stepRound / TaskEngine 以“让 register 真正发生”
        ⇒ 不得把「register location decided」读成「production registration enabled」。

IC-6-3  remove 的挂点（P5 裁定）
        绑定到 ChildSession.close() 的 composition-boundary 闭包中：
            async close() {
                await <在 Pi 边界完成底层 session 关闭/dispose>
                <remove>(sessionId)
            }
        · ★ 顺序 = 先关闭底层 session，后 remove（Registry entry 必须一直对应有效 session）
        · ★ Pi AgentSession.dispose() 是【同步 void】，且 Pi 没有 close()
              ⇒ 不得重新制造一个假的 Pi close() API
              ⇒ 真实生命周期桥接由 composition boundary（本工厂）负责
        · ★ 不得改 TaskEngine 的 ownership：
              finishSession() → session.close() → openSessions.delete(taskId) 保持不变
              即：未来 TaskEngine.complete()/fail() 真正进入生产路径时，
              remove 自然闭环，无需 TaskEngine 认识 Registry

IC-6-4  与 AF-1B-I 的关系
        · O-SI-5（remove 的具体调用时机）⇒ 本契约裁定为「绑定 ChildSession.close()」
        · O-SI-6（production writer）= G-04 ⇒ 本契约只固定【写入点位置】，不接入生产
        · O-SI-7（R-2B：Factory / CLI 集成）= Adapter + 本契约的 create() 规格
        · ★ AF-1B-I SI-OWN-3 声明「registry 的实现归属不在该契约冻结」⇒ 本契约的落点裁定不冲突

IC-6-5  生产 caller 现状（必须如实登记，不得掩盖）
        register 生产 caller = 0
        remove   生产 caller = 0
        · 原因：生产路径（orchestrator.stepRound → engine.start）从不调用 complete()/fail()
        · ★ 本契约不改变这一事实；G-04 生产化是独立切片
        · ★ 不得把「写入点已定义」读成「Registry 已进入运行链」
```

---

## §7 Composition boundary 的最小 seam（P4 裁定 = b1′）

```text
IC-7-1  ★ 最终裁定（G5 · 已定，不再是 Open Question）
        采用【优先级 1】：composition root（`src/cli/tiancha.ts`）直接持有同一个
        `SessionRegistry` 实例，并把【最小能力】传给 AgentSessionFactory。
        ⇒ 不采用优先级 2；❌ 禁止 public readonly registry（见 IC-7-2）。

IC-7-1.1  ⚠️ 优先级 1 的前置条件（必须如实登记，不得假装已解决）
        【已取证事实】`SessionRegistry` 当前对包外完全不可达：
            packages/research/src/index.ts        不导出（0 处）
            packages/research/src/runtime/index.ts 不导出（0 处）
            packages/research/src/ports/index.ts   不导出（0 处）
            全仓非测试代码 import SessionRegistry  = 0
        且 AF-1B-I 实现层注明 registry 刻意不是 product-level Port
        （execution-session.ts：「no ports/ entry, no barrel export, no index export」）。
        ★ 硬要求（Freeze Gate 已明确）：composition root 合法取得的必须是
          【与交给 PiExecutionProvider 的同一个 SessionRegistry 实例】
          —— 即：register 写入的那一个 registry 与 Provider lookup 的那一个 registry
          必须 identity-equal；❌ 不得出现两个各自 new 的实例。
        ⇒ 因此优先级 1 要真正可实施，必须先解决【一个可达性前置】：
              `src/cli/tiancha.ts` 如何合法取得 `SessionRegistry`（类 / 实例）
          候选（属实施轮的 D-level 决定，本契约不预设）：
              (a) 在 research 侧新增一个【最小的类导出】（例如 runtime/index.ts 仅导出该类）
              (b) 由 composition root 经一个已导出的工厂函数取得该实例
        ⇒ ★ 本契约只裁定「seam 形态 = 优先级 1」；
          该可达性前置的最终解法必须在实施轮【一次显式登记】，
          且不得借此把 registry 整体升级为半公开产品面（IC-7-2 继续成立）。

IC-7-2  为什么禁止 public readonly registry
        · SessionRegistry 的三个成员（register / lookup / remove）全部 public
        · 暴露字段 = 把 remove（G-04 writer 不应拥有的操作）也一并交出，违反最小权限
        · 且 AF-1B-I 的实现层刻意声明 registry 是内部实现
          （execution-session.ts：「deliberately NOT a product-level Port
            (no ports/ entry, no barrel export, no index export)」）
        · ★ 本契约不得把该内部实现升级为半公开产品面

IC-7-3  与优先级 1 配套的最小能力传递
        · composition root 持有 registry 实例后，只把【注册所必需的那个操作】
          作为能力交给 AgentSessionFactory（而不是把整个 registry 对象交出去）
        · ❌ 不得把 registry 实例本身作为 factory 的公共参数类型暴露给 research 之外的更多位置

IC-7-4  时序（优先级 1 下的实际形态）
        · 现状：factory 在 new TianchaRuntime(...) 之前创建（src/cli/tiancha.ts:145 → :147）
        · 优先级 1 下 registry 由 composition root 自己持有 ⇒ 时序上不再需要“从 runtime 取”
        · ★ 具体接线方式（先建 registry 再建 factory，或两段式）属实施细节，
          但必须在实施轮明确写出，不得含糊

IC-7-2  为什么禁止 public readonly registry
        · SessionRegistry 的三个成员（register / lookup / remove）全部 public
        · 暴露字段 = 把 remove（G-04 writer 不应拥有的操作）也一并交出，违反最小权限
        · 且 AF-1B-I 的实现层刻意声明 registry 是内部实现
          （execution-session.ts：「deliberately NOT a product-level Port
            (no ports/ entry, no barrel export, no index export)」）
        · ★ 本契约不得把该内部实现升级为半公开产品面

IC-7-3  registry 的可达性（如最终走优先级 2）
        · 现状（已取证）：@tiancha/research 的公开面【不含】SessionRegistry
          （index.ts / runtime/index.ts / ports/index.ts 均 0 处导出）
        · 若走优先级 2 ⇒ 通过 TianchaRuntime 的【方法】可达，而不是字段
        · 若走优先级 1 ⇒ 不需要任何新的导出面变更

IC-7-4  时序约束（如最终走优先级 2）
        · 现状：factory 在 new TianchaRuntime(...) 之前创建（src/cli/tiancha.ts）
        · 因此若经 runtime 暴露，需要延迟绑定（闭包 / getter / 两段式构造）
        · ★ 该选择属实现细节，但必须在实施轮明确写出，不得含糊
```

---

## §8 诊断约定（O-AIC-6 · DECIDED）

```text
IC-8-1  AF-1C 当前两条确定失败路径的 diagnostic kind：
        "session_lookup_miss"   ← lookup miss（AF-1B SL-ERR-*）
        "prompt_failed"         ← capability.prompt() throw（AF-1 rev2 EP-3 / Q-EP-3）

IC-8-2  映射（逐条）
        lookup miss   ⇒ { status: "failed", error: { message, kind: "session_lookup_miss" } }
        prompt throw  ⇒ { status: "failed", error: { message, kind: "prompt_failed" } }

IC-8-3  ★ 边界声明（必须逐字保留，防止误读）
        · ExecutionError.kind 仍为 optional string（AF-1A 类型不修改）
        · 上述两个值【不构成】ExecutionError.kind 的全系统 exhaustive enum
        · 不新增顶层 outcome discriminator
        · ❌ 不得把 lookup failure 伪装成 model / execution failure（SL-ERR-3 / AI-9-2）
        · ❌ 不得让 SourcePort 之类不存在的 seam 的 miss 复用 "session_lookup_miss"
```

---

## §9 十项锁死条款（本契约的核心禁令面）

```text
IC-9-1   Pi Adapter 的职责 = 单一转换（Pi AgentSession → ExecutionSessionCapability）
         ❌ 不生成 sessionId ❌ 不注册 ❌ 不持有 registry ❌ 不做 model resolution
IC-9-2   Registry ownership = composition root（src/）
         ❌ 不是 Provider / Adapter / TaskEngine / Orchestrator / AF-4
IC-9-3   register 的唯一【调用点】 = AgentSession 创建返回点（create() 内、return 之前）
         ⇒ ★ 术语精确化（G4）：Registry 有【两个】mutation 调用点，必须分别表述：
              · register —— 唯一【注册调用点】 = 见 IC-6-2
              · remove   —— 唯一【生命周期调用点】 = 见 IC-6-3 / IC-9-4
         ❌ 不得笼统表述为「Registry 唯一写入点」（会误读成只有一个 mutation site）
IC-9-4   remove 与 ChildSession.close() 生命周期绑定（先关底层 session，后 remove）
IC-9-5   Provider 只能 lookup（❌ 不 register ❌ 不 remove ❌ 不创建 session）
IC-9-6   ❌ 不新增 SessionLookup（或任何同义 lookup-only interface）
IC-9-7   ❌ 不新增 SourcePort / capability source / factory-sink seam
IC-9-8   ❌ 不扩大 ExecutionSessionCapability（保持 prompt + messages 两项）
IC-9-9   ❌ 不让 TaskEngine 持有 Registry（SI-OWN-4 继续成立）
IC-9-10  ❌ 不把 Registry 整体暴露成 TianchaRuntime.registry
```

```text
附加（继承 AF-1C Frozen §17）：
IC-9-11  ❌ packages/research 永不 import @earendil-works/pi-coding-agent（EP-15）
IC-9-12  ❌ 不引入 scheduler / retry / concurrency / timeout 实现 / 第二套状态机
IC-9-13  ❌ 不写 Task / Round / Run 状态、不 artifactize、不调度（EP-6 / EP-10）
IC-9-14  ❌ 不从任何非 request 来源推导 prompt（事实来源唯一性 · A-9 / R-5）
```

---

## §10 测试规格与验收门

```text
IC-10-1 research 侧（packages/research/src/runtime/pi-execution-provider.test.ts）
        · ≥ 10 项行为测试，至少覆盖：
            T1  lookup hit ⇒ prompt 被调用一次，入参 = request.prompt
            T2  lookup hit ⇒ 成功返回 status="succeeded"，output.text 为 messages 投影
            T3  lookup miss ⇒ status="failed"，error.kind="session_lookup_miss"
            T4  lookup miss ⇒ 【不】调用 capability.prompt（spy 调用数 = 0）
            T5  lookup miss ⇒ 【不】产 output
            T6  prompt throw ⇒ status="failed"，error.kind="prompt_failed"
            T7  prompt throw ⇒ 【不】再调 waitForIdle / 任何 settlement（spy = 0）
            T8  messages 保持 unknown[]，且不暴露 Pi 类型（结构断言）
            T8b ★ 投影规则用例（对应 IC-4-3.1，逐条）
                  · 最后一条 assistant + content 为 string         ⇒ text = 该串
                  · 最后一条 assistant + content 为 text 块数组       ⇒ text = 各块以 "\n" 连接
                  · 仅存在非 assistant message                        ⇒ text 省略（undefined）
                  · 多条 assistant                                    ⇒ 取【最后一条】
                  · content 形状未知                                  ⇒ text = ""（不抛错、不 JSON.stringify）
            T9  ★（G10-A 修正）构造/API-shape gate，而非运行时行为 spy：
                  · Provider 的构造参数形状恰为 { registry }（API shape 断言 / 类型级 + 固定 fixture）
                  · 源码门：Provider 源码不含 source / taskEngine / modelRouter / AgentSession 引用
                  ⇒ 不再试图用运行时 spy “证明类不持有某依赖”
            T10 ★（G10-B 强化）不调用 register / remove —— 【双重】证明：
                  (a) 注入带 spy 的 registry，跑完全流程断言 register/remove 调用数 = 0
                  (b) ★ 源码反例门：Provider 源码中不出现 `\.register\(` / `\.remove\(`
                      （二者组合，避免“只在 mock 上成立”）
        · 说明：T10 对应你已登记的硬要求（remove 后 close/dispose/abort 调用数为 0 的同类精神）

IC-10-2 src 侧（src/agent/pi-session-capability-adapter 的测试）
        · 跨边界测试只验证 capability contract（prompt + messages 两项）
        · ❌ 不得把 Pi 类型带进 research 的测试
        · 可注入 fake AgentSession（结构替身）验证适配
        · ★ 验证 Adapter【不做】语义投影（messages 原样以 unknown[] 视图暴露）

IC-10-3 验收门（全绿才算本契约的实现可交付）
        · root `npx tsc --noEmit` = 0
        · `npm --prefix packages/research run typecheck` = 0
        · full suite 必须报告 suite 数 / 失败 / skip / todo 的变化量（不得只说“测试通过”）
        · ★（G10-C 取证修正）baseline 基线 = 649 tests / 151 suites，
          已用下列命令在 HEAD=ce0802a 实测复现（fail/cancelled/skipped/todo 全 0）：
              (a) node --import tsx --test packages/research/src/**/*.test.ts
                  ⇒ tests 538 · suites 118 · pass 538 · fail 0
              (b) node --import tsx --test 'src/**/*.test.ts'
                  ⇒ tests 111 · suites  33 · pass 111 · fail 0
              合并：538 + 111 = 649 tests ；118 + 33 = 151 suites
          ⇒ 实现后须以【同样两条命令】重新取证并报告差值（不得只给一个孤立数字）
        · `git diff --check` = empty；staged 状态如实报告

IC-10-4 反例门（必须显式断言“没做”）
        · Provider 不 import Pi（源码断言）
        · Provider 源码不出现 `.register(` / `.remove(`（IC-10-1 T10b）
        · research 不 import Pi（既有边界断言继续通过）
        · 不存在 SessionLookup / SourcePort / ExecutionInput / resolver / policy / runtime abstraction
```

---

## §11 未闭合边界（如实登记，不在本契约内解决）

```text
IC-11-1  G-04 production writer（谁在生产路径调用 register）
        状态：🟡 DEFERRED / 独立切片
        本契约职责：只固定【写入点位置】（§6 IC-6-2），不接入生产

IC-11-2  R-2B（Factory / CLI capability 集成）
        状态：🟡 DEFERRED（AF-1B-I O-SI-7）
        本契约职责：给出 Adapter + create() 规格（§5 / §6），不实施

IC-11-3  G-05（ChildSession.close 与 Pi dispose/abort 的历史问题）
        状态：🟡 DEFERRED
        事实：Pi AgentSession 无 close()；只有同步 dispose() / async abort()
        本契约职责：要求 composition boundary 正确桥接（§6 IC-6-3），不实施

IC-11-4  G-06（model fidelity：CLI 路径 model: undefined 导致 session 不可直接执行）
        状态：🟡 DEFERRED
        ★ 本契约明确禁止用“让 Provider 能跑”作为理由引入 model resolution（IC-4-5）

IC-11-5  AF-4 Design / Impl Status Cleanup
        状态：📋 INDEPENDENT / DEFERRED（既存状态文字滞后，与 AF-1C 无关）
```

---

## §12 Invariants（IC-INV-1 … IC-INV-10）

```text
IC-INV-1   research 侧不存在任何 Pi 类型（编译期 + 源码断言双重保证）
IC-INV-2   ExecutionSessionCapability 恰有 prompt + messages 两项，无第三项
IC-INV-3   Registry 的写入者有且仅有 composition boundary 一处
IC-INV-4   register 与 remove 的数量在正常路径下对称（一开一关）
IC-INV-5   Provider 对 Registry 只读（只 lookup）
IC-INV-6   顶层判别字段只有 status ∈ {"succeeded","failed"}
IC-INV-7   ExecutionError.kind 的已知取值仅两个，且不宣称 exhaustive
IC-INV-8   sessionId 与 capability 在同一创建调用点配对产生（结构上不可错配）
IC-INV-9   TaskEngine 的公开/私有面不因 AF-1C 改变
IC-INV-10  本契约落地不新增任何 Port interface
```

---

## §13 Open questions / gaps

```text
IC-O-1  Provider 的类名与文件名是否逐字采用 `PiExecutionProvider` / `pi-execution-provider.ts`
        （本契约按 O-AIC-1 裁定沿用；若实施轮需更名，需显式登记）
IC-O-2  Adapter 的类名是否逐字采用 `PiSessionCapabilityAdapter`
IC-O-3  ❌ 已关闭（G5 已裁定）：seam = 优先级 1（composition root 直接持有 registry）
        ⇒ 残留的【可达性前置】见 IC-7-1.1，属实施轮一次显式登记，不再是 Open Question
IC-O-4  sessionId 的权威生成规则（现状为 `child-${taskId}`，由 CLI factory 决定）
        ⇒ 归属 R-2B / G-04 生产化切片，不在本契约裁定
IC-O-5  ChildSession.close() 内「底层 session 关闭」的具体调用（dispose 还是既有 close?）
        ⇒ 属 G-05，本契约只固定顺序与位置
IC-O-6  测试文件的最终命名与落点
IC-O-7  ★ messages → text 的投影规则（IC-4-3.1）目前是【本契约的裁定】而非引用既有文档
        （因所指的 AF-1B Settlement/Output Preflight 结论从未落盘）
        ⇒ 待裁定：是否需把它上升为独立 Amendment / 或沉淀进 AF-1B 侧文档
```

---

## §14 Review gates

| Boundary | 检查点 | 状态 |
| --- | --- | --- |
| **① 落点** | Provider 在 research/runtime、Adapter 在 src/agent、无新 Port（IC-3） | 🟢 第一轮 PASS |
| **② 依赖方向** | src → research 单向；research 无 Pi（IC-3-5 / IC-INV-1） | 🟢 第一轮 PASS |
| **③ Registry ownership** | composition root；TaskEngine 不持有（IC-6-1 / IC-9-9） | 🟢 第一轮 PASS |
| **④ 写入点唯一性** | register / remove 两个调用点分别表述（IC-6-2 / IC-6-2.1 / IC-6-3 / IC-9-3 / IC-9-4） | 🟢 第二轮 CLOSED |
| **⑤ 最小 seam** | 优先级 1 已裁定（G5）；❌ 不公开 registry（IC-7 / IC-7-1.1） | 🟢 第二轮 CLOSED |
| **⑥ Provider 禁面** | 只 lookup；不 register/remove/lifecycle/model（IC-4-4 / IC-9-5） | 🟢 第二轮 CLOSED |
| **⑦ capability 面** | prompt + messages 两项，不扩大（IC-5-2 / IC-9-8） | 🟢 第二轮 CLOSED |
| **⑧ 诊断约定** | 两值 + 非 exhaustive 声明（IC-8） | 🟢 第一轮 PASS · 第二轮 CLOSED |
| **⑨ 未闭合边界** | G-04/R-2B/G-05/G-06 均如实登记且未越权解决（IC-11 / IC-6-2.1） | 🟢 第二轮 CLOSED |
| **⑩ 测试与验收** | ≥10 项；T9 API-shape gate；T10 双重证明；baseline 附取证命令（IC-10） | 🟢 第二轮 CLOSED |

```text
⇒ 第一轮 Formal Review 结论（外部 Review）：G1–G4 PASS · G5/G6/G10 BLOCKED · G7/G9 需澄清
⇒ 本轮为 Review Correction Slice，仅修正上述项；未扩大修改范围
⇒ 第二轮 Formal Review 结论（外部 Review）：**10/10 CLOSED · SECOND REVIEW PASS**
⇒ Freeze Gate（4 项只读检查）：检查 1 / 2 / 4 已补完 · 检查 3 本就 PASS ⇒ 4/4 PASS
⇒ ★ Freeze 裁定（外部）：**FREEZE APPROVED** ⇒ 本契约已落盘为 🔒 FROZEN（仅状态文字变更）
⇒ ★ 三个必须逐字保留的不等式（防止把流程推进误读成授权）：
        Second Review PASS  ≠  Freeze
        Freeze              ≠  Implementation Authorization
        Second Review PASS  ≠  Implementation Authorization
   ⇒ 即：本契约「建立」≠ 实现授权；「修正完成」≠ 实现授权；
        即便后续「FROZEN」成立，也 ≠ 实现授权（实现授权必须是独立的显式授权）。
```

---

**End of contract（AF-1C · Pi Execution Provider Implementation Contract · 🔒 FROZEN）**
