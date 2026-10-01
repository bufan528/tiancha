# C7-B · Research Execution Wiring — Implementation Contract

> **rev1 · 问题空间与边界设计（CONTRACT DESIGN ONLY）**
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

### §5.1 生命周期契约（继承既有状态机，不得新增）

```text
既有（只读确认，不得扩展）：
  ResearchRunStatus    = planning | active | waiting_input | completed | failed | cancelled   （6）
  ResearchRoundStatus  = planned | running | review | completed | rejected                    （5）
  TaskStatus           = queued | running | waiting | completed | failed | cancelled          （6）
                         TASK_TERMINAL_STATUSES = { completed, failed, cancelled }
                         守卫：`isTaskTerminal 且目标状态不同` ⇒ throw（终端态不可转移）
  TaskAttemptStatus    = running | succeeded | failed | aborted                                （4）
  TaskType（11 种）= plan | hypothesis | collect | extract_industry | resolve | enrich |
                     evaluate | critic | dossier_update | report | human_gate
必须钉死（本契约需回答）：
  ① 三个"非终态但非运行"的语义边界：Run.waiting_input / Task.waiting / Round.review
     —— 分别由谁进入、由谁离开、与 Human Gate 的关系
  ② 终态的收口责任：谁有权把 Task/Round/Run 置为 completed / failed / cancelled
  ③ 一个 Task 失败时，同 round 内后继任务的传播规则（阻断？跳过？整体 round rejected？）
  ④ `TaskAttempt` 的追加语义与 `activeAttemptId` 的关系（resume 时旧 attempt 保持不可变）
不得做：新增状态、新增状态机、复用别的层的状态表示执行层状态。
```

### §5.2 所有权契约（谁创建 / 谁推进 / 谁收口）

```text
现状（G2 取证）：
  Orchestrator  创建 Run / Round（并 emit `round_created`）· 校验 DAG · 平铺入队
  TaskEngine    创建 Attempt（randomUUID）+ child session · 显式 succeed/fail（由调用者驱动）
  调用者        构造 ResearchTask[]（本该由工厂产生 —— G2-b 缺口）
  事件           Orchestrator / TaskEngine / 调用者均可 emit（经 ResearchEventAdapter）
必须钉死（本契约需回答）：
  ① Run/Round 的权威写入者是谁（是否仍唯一为 Orchestrator）
  ② Task 的创建者（若新增派生器：它是"提议者"还是"创建者"？谁真正把 Task 入图）
  ③ Attempt 的追加者（TaskEngine 独占？）
  ④ 终态收口者（与 §5.1 ② 对应）
  ⑤ 并发：同一 Run/Round 是否允许并发推进；若不，如何互斥（既有 material 层已有租约/fencing 先例，可参照其【语义】）
不得做：引入第二套写者；让执行层的写者绕过既有 ORCHESTRATOR/TASKENGINE 的职责边界。
```

### §5.3 恢复语义契约（恢复到哪、依据什么、幂等锚点）

```text
现状（G2 取证）：
  material ingest：完整（ledger / resume anchors / 三分类 / 租约 fencing / sticky overlap）
  human gate：完整（resumeToken hash + scope + 单次 + 过期）
  candidate projection：幂等（同 candidate ⇒ 同 claim id）
  执行层：无
必须钉死（本契约需回答）：
  ① 恢复粒度：attempt 级 / task 级 / round 级 / run 级 —— 决定持久化最小集
  ② 恢复判据：依据什么判定"这一步已经做过"（attempt 状态？业务侧幂等锚点？两者？）
  ③ 恢复与业务幂等的对齐：恢复不得导致重复 Material / 重复 Fragment / 重复 Candidate / 重复 Claim
  ④ 恢复后 attempt 关系：追加新 attempt（域语义），旧 attempt 不可变
  ⑤ "不可自动恢复"的情形（参照 material 层既有先例：legacy 残骸不自动续跑，需人工决定）
不得做：把"重跑"伪装成"恢复"；修改已终态的 attempt/task。
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
★ 明确：任何"新增表 / 改 schema"的提案都必须【另行】获得显式授权（D-C7-C）。
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
```

---

## §7 待裁定（需要用户决策 —— 本契约的问题清单）

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

---

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

**End of rev1（C7-B · Research Execution Wiring — Implementation Contract · 问题空间与边界设计 · DESIGN ONLY · NOT AUTHORIZED · NOT IMPLEMENTED。基线 `25b9ace`。本文件不含 schema、不含实现。）**
