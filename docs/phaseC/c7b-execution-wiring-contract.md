# C7-B · Research Execution Wiring — Implementation Contract

> **rev4 · 问题空间与边界 + 语义契约 + L-5b closure 裁定（CONTRACT DESIGN ONLY）**
>
> ★ **C7-B 不负责创造新的研究认知层。它负责把已有执行能力与已有研究业务能力接起来。**
> 状态：**DESIGN ONLY · NOT AUTHORIZED · NOT IMPLEMENTED**。本文件**只界定问题与边界**，不含实现、不含 schema。
> 基线：`HEAD = 25b9ace`（C7 设计草案已入库，未 push）· `origin/main = 3972035`（C6 RMA FINAL/PUBLISHED/FROZEN）。
> 前置：`docs/phaseC/c7-research-execution-expansion.md`（§10 G2 Preflight = PASS）· `c6-real-model-adapter-contract.md`（rev8 FROZEN）· `docs/HANDOFF.md` §10。
> 本文件是 C7-B 的**第一步**（用户裁定：先做 Contract Design，不写实现）。

---

## §1 目标与非目标

```text
目标（C7-B = wiring / integration）：
  把"缺口/目标"变成"被执行的研究任务"，并把执行结果沿既有管线沉淀：
    Gap / Target → Task → 依赖感知执行 → Material → C6 RMA 提取
      → Candidate → Human Review → approved Candidate → Claim
    （并为上述链路提供可恢复的执行状态 —— 载体待裁定，见 §5.4）

非目标（本片不做）：
  ❌ 不改 C6 RMA 任何条款（FROZEN）
  ❌ 不重设计既有 Execution Engine 骨架（Orchestrator / TaskEngine / TaskGraph / HumanGate）
  ❌ 不新增模型通道（ModelRouter 保持 Task/Agent runtime 用途；提取一律走 C6 RMA —— D-C7-H）
  ❌ 不让模型直接产生 Claim / Fact / Knowledge / PoolItem / Evaluation（HANDOFF §10）
  ❌ 不做多 provider / registry / retry 策略 / 观测持久化（分别属其他独立契约）
```

---

## §2 前置事实（G2 取证摘要，作为本契约的地基）

```text
已在且部分 FROZEN（inherit, do not redesign）：
  域：ResearchRun(6态) · ResearchRound(5态) · ResearchTask(6态/18字段) · TaskAttempt(4态, lock ④)
      · TaskGraph(严格 DAG + Kahn, 无 LLM) · ResearchEvent(lock ⑤, durable)
  运行时：Orchestrator(startRun/startRound/finishRound/finishRun) · TaskEngine(enqueue/start/succeed/fail)
          · TianchaRuntime(组装) · HumanGate 原语(resumeToken: hash+scope+单次+过期) · ResearchEventAdapter
  持久化：`research_event` 表(durable) · artifact store · `research_state`(知识/缺口层 SoT)
  其他层的 resume：material ingest（完整）· human gate（完整）· candidate projection（幂等）

缺口（G2-a…G2-g，本契约要界定）：
  G2-a 执行层无持久化（Run/Round/Task/Attempt 皆内存 Map）
  G2-b 无 Task 工厂 / 无 Gap→Task / Target→Task 派生
  G2-c TaskGraph 拓扑序只用于排序与事件 payload，未驱动调度
  G2-d 执行与研究对象零耦合（material / candidate / review / projection 四条接入全缺）
  G2-e 执行层无 resume/recovery（其他三层有）
  G2-f 无产品化入口（唯一调用者 = smoke）
  G2-g 两条模型通道并存（ModelRouter vs C6 RMA）—— 已由 D-C7-H 裁定接线方向

provenance debt（D-C7-G）：`lock ④ / lock ⑤` 的原始规格文档不在仓库 ⇒ 本契约
   FROZEN-BY-EXISTING-CODE，只继承其可观察语义，不重解释、不弱化、不扩展、不补写原文。
```

---

## §3 问题空间（G2-a…G2-g：每个缺口的难点、必须钉死的语义、禁止的解法）

### G2-a 执行持久化

```text
问题：Run/Round/Task/Attempt 目前只在 Orchestrator/TaskEngine 的内存 Map 中，进程结束即失。
为什么难：一旦引入持久化，会立刻牵动【恢复语义 / 所有权 / 生命周期 / 幂等锚点 / 并发】五件事；
          在没有钉死它们之前选择载体（表 / 事件流 / 投影），等于把架构赌在一个未定义语义上。
必须先钉死（本契约 §5）：
  ① 恢复到哪一层？（attempt / task / round / run）
  ② 谁是权威写入者？（单写者？租约？）
  ③ 幂等锚点是什么？（attemptId? taskId+roundId? 内容 hash?）
禁止的解法：
  ❌ "因为没表，所以建 Run/Round/Task 三张表"（反模式：把既有 domain contract 翻译成第二套 persistence）
  ❌ 引入与既有 `research_event` 事件流并列的第二条历史
  ❌ 让执行层状态进入 `research_state`（那是知识/缺口层的投影，语义不同层）
```

### G2-b Task 派生

```text
问题：没有 Task 工厂，也没有 Gap→Task / Target→Task 的派生路径；调用者需自行构造 ResearchTask[]。
为什么难：Task 是 immutable（"改变意图 = 新建 Task"），且有 dependencies / agentRole / modelPolicy /
          humanGate / retry / budget 六个策略字段 ⇒ 派生规则实际上是一份【研究规划策略】，
          一旦写歪，会绕过 C7-C 之外重新定义"研究该做什么"。
必须钉死：派生规则的输入/输出、可解释性、是否必须 Human Gate 参与选对象、派生结果的稳定性（同输入同结果）。
禁止的解法：
  ❌ 让 LLM 自由生成 Task 列表并直接执行（无闸门、不可回溯）
  ❌ 在派生阶段写研究结论（派生只产出"要做什么"，不产出"知道了什么"）
```

### G2-c DAG 驱动调度

```text
问题：`buildTaskGraph` + `validateDAG` 只校验拓扑并把 `topo.order` 写进 round.taskIds 与事件 payload；
      实际入队是平铺 `for (const task of tasks) engine.enqueue(task)` ⇒ 依赖未被调度约束。
为什么难：真正的"依赖感知调度"要求任务在被依赖项未完成时【不进入 running】，
          而这需要定义 `waiting` 语义（状态机第 3 态已存在）与失败传播规则（依赖失败 ⇒ 后继如何处理）。
必须钉死：依赖满足的判定者、`waiting` ↔ `queued` 的转移条件、依赖失败/取消的传播规则（不得自动重试）。
禁止的解法：
  ❌ 重写 TaskGraph（D-C7-H 的锁死 4 条之 2）
  ❌ 用"平铺入队 + 运行时自旋等待"伪装成 DAG 调度
```

### G2-d 研究域接线

```text
问题：TaskEngine 与研究对象零耦合（无 material / candidate / review / projection 引用）。
为什么难：这四条接入是 C7-B 的【主要交付价值】，但每条都已有既有实现（material-ingest /
          C6 RMA extraction / candidate-review / candidate-projection）⇒ 难点不是"造"而是"接"，
          并且必须保证接的方向不可逆（不得从执行层反向写业务真相）。
必须钉死：接线的方向与调用者、每一步的幂等边界、失败时谁负责收口、以及"执行失败"与"业务失败"的区分。
交付形态（候选，待裁定）：TaskEngine 只负责"执行任务"，
    Material 由既有 material-ingest 摄入、提取由 C6 RMA 完成、审阅与投影由既有服务完成。
禁止的解法：
  ❌ TaskEngine 自己变成 Extraction Engine（D-C7-H 的反模式）
  ❌ 从 attempt outputs 反推 Claim（必须经 Candidate → Human Review）
```

### G2-e run 级 resume/recovery

```text
问题：material / human-gate / candidate-projection 三层都有 resume，唯独执行层没有。
为什么难：执行层的"恢复"必须与业务三层对齐 —— 重复执行不得重复摄入材料、不得重复提取、
          不得重复投影；否则会破坏 C6 已建立的幂等不变量（同内容同身份）。
必须钉死：恢复的判据（依据什么判断"这一步已做过"）、恢复的粒度、恢复后 attempt 的新旧关系
          （TaskAttempt 语义：retries/resume 追加新 attempt，不修改旧 attempt）。
禁止的解法：
  ❌ 用"重跑一遍"代替恢复（会重复产生 Fragment / Candidate）
  ❌ 修改已完成的 attempt（域语义禁止）
```

### G2-f 产品与 Agent 入口

```text
问题：`startRun/startRound/TaskEngine.start` 的唯一调用者是 smoke 测试 ⇒ 无产品化驱动路径。
为什么难：引入入口会立即牵扯【权限边界】（CLI-only 写 / Agent 只读 的既有治理）与【人的位置】
          （选对象、审候选、批方法论都必须有人工闸门）。
必须钉死：入口的载体（CLI / Agent tool / 两者）、每个入口允许的动作集合、Human Gate 的插入点。
禁止的解法：
  ❌ 为"全功能闭环"扩大 Agent 写权限（违背既有 B5 治理）
  ❌ 让入口绕过 Human Review 直接产出 Claim
```

### G2-g Execution ↔ C6 RMA 提取边界

```text
问题：TaskEngine.start() 用 `modelRouter.resolve(agentRole, modelPolicy)`（agent runtime 通道），
      与 C6 RMA 是两条独立通道；执行层若"直接问模型"，会重新模糊 C6 已冻结的 boundary。
已裁定（D-C7-H，硬架构约束）：
  ModelRouter / ModelResolverPort = Task / Agent runtime 执行能力（不改变）
  C6 RMA                          = 结构化研究信息提取（复用并新接线）
必须钉死：接线的接口形态（执行层如何把 Material 交给提取、如何拿回 Candidate）、
          以及在提取路径上【不得】出现 ModelResolverPort（C6 §R1.6 已由自动断言保护）。
禁止的解法：
  ❌ Task → ModelRouter → 通用 Agent 自行决定如何抽取 Claim
```

---

## §4 边界（与既有资产及其他片的交界）

```text
上游（不得改动）：C6 RMA（FROZEN）· 既有 Execution Engine 骨架（inherit）·
                  既有 material / candidate / review / projection / knowledge 服务
下游（不在本片）：C7-A（真实 provider 运行）· C7-C（知识演化驱动）
平行（独立契约，不在本片）：
  C7-D Operational Observability（若将来需要观测持久化 —— D-C7-A 已明确不放宽 §R9）
  Retry Contract（若将来需要突破 maxAttempts=1 —— D-C7-B 已明确不突破）
  Provenance Recovery（D-C7-G 的 provenance debt，属审计/文档任务）
```

---

## §5 三大契约问题（★ 本契约的核心：先钉语义，后选载体）

### §5.1 生命周期契约（语义已钉死 —— 继承既有状态机，不得新增）

```text
既有状态机（只读确认，不得扩展、不得新增）：
  ResearchRunStatus    = planning | active | waiting_input | completed | failed | cancelled   （6）
  ResearchRoundStatus  = planned | running | review | completed | rejected                    （5）
  TaskStatus           = queued | running | waiting | completed | failed | cancelled          （6）
                         TASK_TERMINAL_STATUSES = { completed, failed, cancelled }
                         守卫：`isTaskTerminal 且目标状态不同` ⇒ throw（终端态不可转移）
  TaskAttemptStatus    = running | succeeded | failed | aborted                                （4）
  TaskType（11 种）= plan | hypothesis | collect | extract_industry | resolve | enrich |
                     evaluate | critic | dossier_update | report | human_gate

钉死的语义（rev2 裁定，rev3 澄清）：
  L-1 三个"非终态但非运行"的语义（只使用既有状态，不新增）：
        Run.waiting_input  由"需要人工输入"进入；人工输入经合法入口提交后离开。
        Task.waiting       由"等待外部输入"进入（HumanGate / 数据源返回）；外部输入到达后回到可运行。
        ★ 语义边界（L-5b Q1 裁定）：Task.waiting【不吸收】dependency starvation ——
          "依赖未满足"不是 waiting 的原因；它只由 readiness predicate 表达（见 L-3）。
        Round.review       由"本轮任务全部到达终态、等待判定"进入。
       三者均【不得】被解释为终态，也【不得】新增任何平行状态。
  L-2 终态收口责任（权威 owner 唯一）：
        Task 终态     ⇒ Orchestrator 判定（依据 TaskEngine 报告的执行结果）
        Round / Run 终态 ⇒ 各自的权威 owner 按生命周期规则执行
  L-3 依赖不可执行的传播（对应裁定 D-C7B-5 + L-5b；rev4 澄清）：
        ★ `non-runnable`【不是】TaskStatus —— 它是【派生的调度就绪条件（readiness predicate）】。
          依赖未满足的后继 Task 保持在既有【非终态】status；调度器【MUST NOT】将其入队。
          【禁止】新增状态（`blocked` / `skipped` / `dependency_failed` 一律禁止）。
        ★ 两个阶段必须严格区分（否则本条与 L-6 会自相矛盾）：
          阶段①（暂不可运行）：依赖未满足、但【存在】合法恢复路径
                ⇒ 保持既有非终态 + 不入队；非终态 ≠ waiting ≠ 终态。
          阶段②（永久不可执行）：Orchestrator 经确定性 DAG 评估判定【永久不可能】
                ⇒ lifecycle closure ⇒ Task.status = `failed`（见 L-6 / DEPENDENCY-CLOSURE-1）。
          在阶段②判定完成【之前】：non-runnable 【≠】 waiting、【≠】 cancelled、【≠】 failed。
        【禁止】把失败依赖"跳过"当作成功前置；
        【禁止】把 dependency impossibility 机械等价为 Round.rejected；
        【不得】把 Task failure 机械等价为 Round.rejected（后者是 Round 层既有状态，语义不同）；
        ★ 传播的是【永久不可执行事实】（由 Orchestrator 逐级评估），【不是】`failed` status 的机械级联。
        ★ 阶段①（暂不可运行）的 Task 持有 `queued`（V1 裁定，基于代码证据）：
          · `status` 是 ResearchTask 的构造必填字段（domain/task.ts:67）⇒ 不存在"无状态 Task"；
            唯一合法初值 = `queued`（全仓两个构造点均赋 queued：src/cli/tiancha.ts:166 ·
            packages/research/src/task-graph.test.ts:11）。
          · 阶段①采用 3a：未就绪 Task 保持在 DAG 内、【不向 TaskEngine 注册】；status 仍为
            构造时赋的 `queued` ⇒ "MUST NOT enqueue" 字面成立、零代码成本。
          · 解耦事实（V1 的关键证伪）：`TaskEngine.enqueue()` 只做重复检查 + Map 注册，
            【不写 status】（runtime/task-engine.ts:34-39）⇒ "queued 状态"（构造方赋）与
            "enqueue 动词"（引擎登记）在代码层面本就解耦；`start()` 首行 mustGet（:54）
            ⇒ 未注册 Task 本就无法被 start ⇒ 天然守卫已在。
          · TaskEngine 无内部调度循环（全仓无 setInterval / while(true)）；queued 静置无副作用；
            queued → running 仅由显式 start（runtime/task-engine.ts:53）触发。
          · DAG 成员资格 ≠ 引擎注册：恢复语义（R-1/R-2）以 DAG 成员资格为准，不受 3a 影响。
  L-4 TaskAttempt 与 activeAttemptId：
        attempt 为不可变执行历史；一个 Task 在任一时刻至多一个 active attempt；
        合法恢复 ⇒ 追加【新】attempt（旧 attempt 一律不可变）；
        终端 attempt 永不被修改（与既有域语义一致）。
  L-5 dependency 永久失败后的生命周期收口（L-5b · rev4 已裁定；原 ★ OPEN ITEM 已关闭）：
        裁定（Q10）：closure target = `failed`（既有终态成员；不新增任何状态）。
        `failed` 语义 = Task lifecycle terminal state：
            "Task has terminated without successful completion."
            （【不是】"execution attempt failed" —— 执行失败只是进入该状态的原因之一）
        两类进入原因（仅【语义分类】，rev4【不新增】failureReason 字段 / 不涉 schema）：
            · execution_failure        —— 经 TaskEngine.fail()；存在 TaskAttempt
            · dependency_impossibility —— Orchestrator lifecycle closure；【不创建】TaskAttempt
        约束：closure 由 Orchestrator 完成；不经 TaskEngine.fail()；不伪造 execution outcome；
              不可撤销（terminal closure irreversible；新的恢复机会不得 resurrect 旧 Task）。
        完整行为禁令见 §6 的 DEPENDENCY-CLOSURE-1；permanence 判定条件见 §6 的 I-15。
        ★ 原取证事实（保留为 provenance 记录）：`TaskStatus.cancelled` 与 `waiting` 在既有代码中
          【从未被设置】（TaskEngine 只设 running / completed / failed）；该 enum 成员与
          `TASK_TERMINAL_STATUSES` 是【声明式】的，其触发语义在仓库中不可考（与 D-C7G 同性质）。
  L-6 dependency-impossibility closure 的可执行语义（rev4 新增）：
        唯一合法路径：Dependency facts → Orchestrator DAG evaluation →
            permanent impossibility confirmed（P-1 ∧ P-2 ∧ P-3；唯一定义处 §7 D-C7B-12）→ Task lifecycle closure →
            Task.status = `failed`
        【禁止】路径：TaskEngine 观察到 dependency failed ⇒ 自行置 Task.status = failed
            （TaskEngine 不是 scheduler authority —— 见 §5.2 O-4）
        结果特征：不创建 TaskAttempt · 不调用 TaskEngine.fail() · 不伪造 execution outcome ·
                  进入终态后不可转移（I-4）
        ★ 该 closure 是 §5.2 O-5 所载"Task 终态由 Orchestrator 收口"的【生命周期转换】，
          【不是】对既有 TaskEngine outcome API 的重解释（见 I-8 / I-13）。
        ★ 确定性与恢复约束（V6）：见 §7 D-C7B-12，本处不重复。
不得做：新增状态、新增状态机、复用别的层的状态表示执行层状态。
```

### §5.2 所有权契约（语义已钉死 —— 单一权威，禁止第二套写者）

```text
现状（G2 取证，作为基线）：
  Orchestrator  创建 Run / Round（并 emit `round_created`）· 校验 DAG · 平铺入队
  TaskEngine    创建 Attempt（randomUUID）+ child session · 显式 succeed/fail（由调用者驱动）
  调用者        构造 ResearchTask[]（本该由工厂产生 —— G2-b 缺口）
  事件           Orchestrator / TaskEngine / 调用者均可 emit（经 ResearchEventAdapter）

钉死的语义（rev2 裁定，rev3 澄清 —— D-C7B-2 / D-C7B-3）：
  O-1 Run / Round 的权威写入者 = Orchestrator（唯一）。
  O-2 Task 的创建：提议者与创建者【分离】——
        TaskDerivation（纯函数、确定性、无副作用、不持久化）= 提议者，产出 ResearchTask 定义；
        Orchestrator = 唯一权威创建者/入图者，校验/提交派生结果进入 Round。
  O-3 Attempt 的追加者 = TaskEngine（执行权威）；TaskEngine 执行"已被授权的 Task"。
  O-4 依赖/就绪权威 = Orchestrator（决定"现在哪个 Task 可入队"）；
        TaskEngine 只做局部运行守卫（可拒绝非法启动），【MUST NOT】独立调度下游 Task，
        也【不得】维护第二套 dependency scheduler。
  O-5 终态收口者：与 §5.1 L-2 一致（Task 由 Orchestrator 收口；Round/Run 由各自权威 owner）。
        ★ 桥接（rev3，用于保护 I-8）：TaskEngine reports execution outcome；
          Orchestrator owns the authoritative lifecycle transition of Task。
          C7-B MUST NOT reinterpret an existing TaskEngine outcome API
          as a second Task lifecycle state machine.
          ⇒ 既有 `TaskEngine.succeed() / fail()` 的【可观察语义不被改变】：
            它们表达"执行结果"，【不】直接等价于 Task 生命周期状态机。
  O-6 并发：同一 Run/Round 的推进不引入第二套写者；互斥语义（若有）须与既有 material 层的
        租约/fencing【语义】一致，但本契约【不】在此选择载体或实现方式。
不得做：引入第二套写者；让执行层的写者绕过 Orchestrator / TaskEngine 的既有职责边界。
```

### §5.3 恢复语义契约（语义已钉死 —— 粒度 = Task）

```text
现状（G2 取证）：
  material ingest：完整（ledger / resume anchors / 三分类 / 租约 fencing / sticky overlap）
  human gate：完整（resumeToken hash + scope + 单次 + 过期）
  candidate projection：幂等（同 candidate ⇒ 同 claim id）
  执行层：无

钉死的语义（rev2 裁定，rev3 澄清 —— D-C7B-1）：
  R-1 Task is the minimum resumable execution unit.
        Run / Round recovery = reconstruct orchestration state → identify incomplete / recoverable
        Tasks → resume Tasks according to their persisted execution facts.
        Run = orchestration scope · Round = execution grouping · Task = resumable unit ·
        Attempt = immutable execution attempt · Event = durable history.
        ★ recovery ≠ automatic recovery：v1 recovery is explicitly initiated by a legal
          resume action and is NOT automatic（见 R-5）。

  R-2 恢复判据：以 Task 的可执行事实为准（不是"重跑"）；具体事实集属 §5.4（未选载体）。
  R-3 恢复与业务幂等的对齐（强制）：恢复【不得】导致重复 Material / Fragment / Candidate / Claim；
        必须落在既有幂等锚点上（既有身份机制，I-3）。
  R-4 恢复后 attempt 关系：Resume MUST NOT mutate an existing terminal TaskAttempt；
        Resume creates a NEW TaskAttempt when a Task is legally resumed.
  R-5 不可自动恢复 / 不自动恢复（rev3 澄清）：
        恢复语义存在 ≠ 自动恢复策略存在。
        v1 的 resume 必须由【显式合法动作】发起（explicit / legal resume action），【不】自动触发；
        并参照 material 层既有先例：残骸不自动续跑，需人工决定。
不得做：把"重跑"伪装成"恢复"；修改已终态的 attempt/task；为恢复而在本契约内选择持久化载体。
```

### §5.4 持久化载体问题（★ 只列问题与判据，不选方案 —— G2-a 的约束）

```text
本契约【不】提出持久化方案。仅给出"选载体前必须回答的问题"与"候选载体的判据"：
必须回答（答案取决于 §5.1–§5.3 的结论）：
  Q1 需要持久化的最小事实集是什么？（在钉死恢复粒度之前无法回答）
  Q2 既有 `research_event` 事件流能否作为唯一历史？还是必须另有"当前状态"载体？
     （事件流擅长"发生过什么"，不天然提供"现在处于什么状态"的可恢复快照）
  Q3 `research_artifact` / artifact store 已承载 attempt outputs（ArtifactRefs）—— 是否足够？
  Q4 既有 `research_state` 明确是知识/缺口层投影 ⇒ 本契约确认它【不】承载执行层状态。
  Q5 若确需新表：如何避免成为"第二套 persistence architecture"？（判据见下）
判据（用于将来评估任何载体提案）：
  最小性 · 权威单一性（谁是 SoT）· 与既有事件流的关系 · 与既有 resume 语义的一致性 ·
  幂等锚点是否落在既有身份机制上（不新建身份函数）· 可迁移性（既有 migration 机制）
★ rev2 状态：本节的 Q1…Q5 与判据【原样保留】，rev2 仍未选择任何持久化载体。
★ 明确：任何"新增表 / 改 schema"的提案都必须【另行】获得显式授权（D-C7-C）。
★ 确定性与恢复约束（V6）：见 §7 D-C7B-12，本处不重复。
```

---

## §6 不变量与红线（本契约不得违反）

```text
I-1  执行层不得直接产生 Claim / Fact / Knowledge（必须经 Candidate → Human Review → projection）
I-2  提取路径不得依赖 ModelResolverPort（C6 §R1.6，已有自动断言保护）
I-3  不得新增第二套身份函数；幂等锚点必须落在既有身份机制上
I-4  终端态不可转移（既有守卫）；attempt 一经结束不可修改
I-5  不得新增状态 / 状态机；执行层状态不得与知识层状态混用
I-6  不得绕过 Human Gate（选对象 / 审候选 / 升版）
I-7  不得为 G2-a 直接进入 schema 设计
I-8  不得改动 C6 RMA 与既有 Execution Engine 的可观察语义
I-9  只有一个 execution application service；CLI 与 Agent tool 均为【适配器】，不得各自实现执行逻辑
I-10 不引入新的自动 retry policy；`ResearchTask.retry` 不得成为绕开 C6 §R8 的后门
I-11 Execution state 不得投影进 `research_state`（执行事实 ≠ 知识结论）
I-12 运行观测（tokenUsage / cost 等）不得新增持久化，不得成为 durable 执行 SoT
I-13 不得把既有 TaskEngine outcome API（`succeed` / `fail`）重解释为第二套 Task 生命周期状态机

DEPENDENCY-CLOSURE-1（rev4 新增 —— closure 行为禁令）
（命名型 invariant：与 I-1…I-16 编号体系并列；本条为 closure 行为禁令；P-1 / P-2 / P-3 的定义见 §7 D-C7B-12）

A Task may enter terminal status `failed` due to
deterministically established permanent dependency impossibility
without creating a TaskAttempt.

Such closure MUST be performed by the Orchestrator and MUST NOT
be represented by TaskEngine.fail(), MUST NOT synthesize an attempt,
and MUST NOT infer permanence from a single failed dependency/attempt
or retry exhaustion.

★ permanent dependency impossibility requires P-1 AND P-2 AND P-3（定义见 §7 D-C7B-12；
  本条不重复其定义）—— 上面的 MUST NOT 列表是【禁令示例】，不是"其余任何事实都可以推出 permanence"的许可。

I-14  `failed` 可由 Orchestrator 对"该 Task 无剩余合法执行路径"的确定性判定触发，
      即使该 Task 从未有 TaskAttempt。
I-15  permanent 判定必须【同时】满足 P-1（dependency terminal）AND P-2（no legal recovery path）
      AND P-3（deterministic DAG evaluation）；不得由单条失败事实（dependency failed /
      attempt failed / attempts exhausted / retry exhausted / timeout / inactivity）单独推出。
      判定者为 Orchestrator。（P-x 定义见 §7 D-C7B-12）
I-16  派生 readiness / diagnostic 信息（例如 Task 是否可运行、哪些依赖阻塞它、
      确定性评估是否确立"永久不可能"）【不得】构成第二套 Task lifecycle、
      不得具有独立 terminal transition、不得绕过 TaskStatus、不得成为第二个 lifecycle authority。
      （本条约束的是【语义类别】，不规定任何具体方法名 / 字段名 / API。）
```

---

## §7 裁定记录（D-C7B-1…11 —— 全部已裁定，rev2 并入）

```text
D-C7B-1  ACCEPT
         Task = minimum resumable execution unit.
         Run/Round recovery reconstructs orchestration state and resumes Tasks;
         TaskAttempt = immutable execution history / attempt anchor;
         resume never mutates a terminal attempt (appends a NEW attempt).

D-C7B-2  MODIFY
         Pure deterministic TaskDerivation proposes Task definitions (no persistence, no side effects);
         Orchestrator is the authoritative Task creator / graph inserter.

D-C7B-3  MODIFY
         Orchestrator owns dependency / readiness scheduling;
         TaskEngine executes authorized Tasks and enforces local start invariants,
         but does not become a second scheduler.

D-C7B-4  ACCEPT
         CLI + Agent Tool;
         both are adapters over ONE canonical execution application service.
         Allowed: start / resume execution · inspect execution state · submit legal human input.
         Forbidden: bypassing Human Gate to auto-confirm Target / Candidate / Methodology revision.

D-C7B-5  MODIFY（rev4 收窄为行为陈述 + 引用）
         Failed Task blocks dependent Tasks. No dependency skipping.
         `non-runnable` is NOT a TaskStatus — it is a derived scheduling condition
         (readiness predicate): the dependent Task keeps an existing NON-TERMINAL status
         UNTIL the Orchestrator establishes permanent impossibility, and MUST NOT be enqueued.
         No new `blocked` / `skipped` / `dependency_failed` state.
         Round/Run closure remains with their authoritative owners
         (a Task failure is NOT mechanically a Round.rejected).

         → 调度器不得启动 / 注册未就绪 Task；判定与收口规则见 D-C7B-12（本处不重复实质内容）。
D-C7B-6  ACCEPT
         Task retry semantics are distinct from C6 RMA retry.
         C6 RMA v1 remains maxAttempts = 1.
         No new automatic retry policy in C7-B v1; Task retry must not become a backdoor to §R8.

D-C7B-7  ACCEPT
         tokenUsage / cost are runtime observation only under C6 §R9;
         they may be produced, observed in-process, and asserted in tests / CLI run output,
         but MUST NOT become a durable execution SoT and MUST NOT add telemetry persistence.

D-C7B-8  ACCEPT
         Execution state does NOT project into `research_state`.
         (No `Task failed → uncertain`, no `Task completed → confirmed`.) The two layers stay independent.

D-C7B-9  MODIFY（rev3 澄清）
         TaskEngine MUST NOT directly own the RMA boundary.
         Task execution invokes the EXISTING research-domain extraction capability
         (the existing extraction service), which invokes C6 RMA.
         C7-B WIRES to that existing capability; it MUST NOT create a second / new
         extraction service, nor another abstraction layer.
         (TaskEngine = execution · existing Extraction Service = extraction workflow / IO contract ·
          C6 RMA = provider adapter boundary.)
D-C7B-10 MODIFY
         v1 primary vertical slice:
             collect → Material → extract_industry → C6 RMA → Candidate → Human Review → Claim.
         `human_gate` integrates as a governance / DAG capability, NOT as a mandatory fixed position
         in that chain; its completion must come from a real human action (never model-completed).

D-C7B-11 ACCEPT
         No new TaskType. Existing 11 types are sufficient; v1 activates only the required subset.
```

D-C7B-12 L-5b closure target adjudicated（rev4 新增 —— 本条为 closure 语义的唯一权威记录）
         target = `failed`（Task lifecycle terminal state: "Task has terminated without successful
         completion."）；执行者 = Orchestrator。L-5a = scheduler readiness（PARTIALLY RESOLVED，
         见 §5.1 L-3）；L-5b = lifecycle closure（RESOLVED，见 §5.1 L-5 / L-6）。

         ★ permanence 判定与恢复（P-1 / P-2 / P-3 的唯一定义处；L-6 / §6 / I-15 均引用本条）：
           （本条同时是 V6「确定性 + 恢复」的唯一权威表述）
           P-1  dependency terminal —— 所有阻断该 Task 的相关 dependency 均已进入不可继续改变的终态事实
           P-2  no legal recovery path —— 不存在当前契约允许的合法恢复路径（resume / 新 attempt /
                人工补输入等）
           P-3  deterministic DAG evaluation —— Orchestrator 对 DAG 做确定性闭包评估，
                证明该 Task 不存在任何合法执行路径
           ⇒ permanent dependency impossibility 当且仅当 P-1 AND P-2 AND P-3 同时成立。
           ⇒ 确定性：P-1/P-2/P-3 是 DAG 结构与已持久化 Task 执行事实的【纯函数】；相同输入必得
              相同判定；不依赖挂钟、重试预算余量或任何运行时可变状态。

           ⇒ 恢复：closure 载体（G2-a）尚未授权 ⇒ 载体选定前【不得持久化】；恢复路径上后继 Task 的
             "永久不可执行"状态必须【从持久化事实 + DAG 重新推导】，不得读取未持久化的 closure 假设。
         ★ closure 执行方式（V2 —— 代码必然，非风格选择）：
           由 Orchestrator 【直接执行 Task 状态写（`failed`）】，明确作为 §5.2 O-5 的生命周期转换，
           【不经】TaskEngine.fail()：
             `TaskEngine.fail()` 内部取 currentAttempt；无 activeAttemptId 即 throw
             （runtime/task-engine.ts:135-140）；activeAttemptId 的唯一赋值点是 start()（:71）
             ⇒ 从未 start 的 Task 机械上无法经 fail() 收口。
           closure 【不产生 TaskAttempt】（从未启动的 Task 合法拥有 0 个 attempt；收口不得伪造）。

         ★ 为何选 `failed` 而非 `cancelled`：
           ① provenance 强度：`failed` = enum + terminal 集合 + 【真实 writer】+ 既有终态声明
              （`TASK_TERMINAL_STATUSES`，domain/task.ts:38-42；历史来源 docs/phase0/04-research-kernel-design.md:67）
              + Orchestrator 收口权（L-2 / O-5）⇒ 证据链完整；
           ② 契约负担：采用 `cancelled` 须【首次】为其定义 trigger 语义，且同名 `NextAction.cancelled`
              具备【可逆】语义（cancelled → open），与本裁定的"不可撤销"相悖。
           ③ 折叠通道（措辞已按 V3 修正）：`fail()` 第三参即 TaskAttemptStatus
              （runtime/task-engine.ts:113），`"aborted"` 为该类型合法成员
              （domain/task-attempt.ts:9），且 L119 无条件 `setStatus(task, "failed")`
              ⇒ 【签名保证】attempt 中止会被折叠为 Task `failed`；
              ★ 但全仓【当前无】`fail(..., "aborted")` 调用先例 ⇒ 该折叠是"签名保证的通道"，
                而非"已发生的既有行为"。
           ④ 不新增状态：I-5 禁止新增状态 / 状态机 ⇒ 不得引入 blocked / skipped / dependency_failed。

         ★ 两类进入原因（仅【语义分类】，不新增 failureReason 字段 / 不涉 schema）：
           · execution_failure        —— 经 TaskEngine.fail()；存在 TaskAttempt
           · dependency_impossibility —— Orchestrator lifecycle closure；不创建 TaskAttempt；
                                        irreversible（不可撤销；新的恢复机会不得 resurrect 旧 Task）
### §7.1 原问题清单（保留原文，已由上方裁定取代）

```text
D-C7B-1  恢复粒度选哪一层（attempt / task / round / run）？—— 决定 §5.4 的最小集
D-C7B-2  Task 派生器的形态：新服务 / Orchestrator 扩展 / 纯函数规则模块？（谁创建 Task）
D-C7B-3  依赖门控的裁决者：Orchestrator 调度 vs TaskEngine 自检？
D-C7B-4  产品入口载体：CLI / Agent tool / 两者？（及其允许的动作集）
D-C7B-5  依赖失败的传播规则（阻断后继 / round 置 rejected / 其它）？
D-C7B-6  `ResearchTask.retry`（域已声明）与 C6 §R8 `maxAttempts=1` 的边界如何在契约中表述？
D-C7B-7  `TaskAttempt.tokenUsage / cost` 与 C6 §R9（telemetry 仅内存）的关系表述？
D-C7B-8  执行层是否需要向 `research_state` 投影？还是完全独立？
D-C7B-9  G2-g 接线的接口形态：TaskEngine → C6 RMA 的直接调用 vs 经既有 extraction service？
D-C7B-10 v1 最小 vertical slice：先接哪些 TaskType（是否仅 collect / extract_industry / human_gate）？
D-C7B-11 既有 11 种 TaskType 是否足够，还是 v1 只用子集（不新增类型）？
```

### §7.2 本轮仍【未被授权】的事项

```text
❌ §5.4 持久化载体选择      ❌ 新表 / schema      ❌ migration
❌ retry 实现               ❌ Execution Engine redesign
❌ C6 RMA modification      ❌ Experience domain
❌ 自动选 ResearchTarget     ❌ 自动 Human Gate
❌ Round lifecycle 设计（Round 终态声明缺口 = 独立契约问题，另行 Round Lifecycle Contract Audit）
❌ Run lifecycle 交互设计（Run 状态独立于 Round/Task；不随本次 closure 裁定一并设计）
❌ closure audit carrier / persistence carrier（auditability REQUIRED，carrier DEFERRED —— 需显式授权）
```

## §8 明确不做（防膨胀）

```text
❌ 实现、schema、migration        ❌ C6 RMA 的任何改动
❌ Execution Engine 骨架重设计     ❌ 新模型通道 / 多 provider / retry 策略
❌ 观测持久化                      ❌ Experience domain
❌ 为"闭环"扩大 Agent 写权限        ❌ 把 C7-A / C7-C 塞进本片
```

---

## §9 下一步（尚未授权）

```text
本文件 = C7-B Contract Design 的【第一步：问题空间与边界】。
后续（未授权）：
  1. 用户对 §7 的 D-C7B-1…11 裁定
  2. 依裁定补全 §5 的语义契约（生命周期 / 所有权 / 恢复），形成 rev2
  3. 仅在语义钉死后，才讨论 §5.4 的持久化载体（且需 D-C7-C 的显式授权）
  4. Final Lock 之后，才可能有实现授权
```

**End of rev4（C7-B · Research Execution Wiring — Implementation Contract · 问题空间与边界 + 语义契约 + L-5b closure 裁定 · DESIGN ONLY · NOT AUTHORIZED · NOT IMPLEMENTED。基线 `b291a5c`。本文件不含 schema、不含实现、不含持久化载体选择。）**
