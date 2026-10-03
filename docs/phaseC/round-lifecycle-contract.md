# Round Lifecycle Contract（rev1）

> 状态：**SEMANTIC ADJUDICATED · NOT IMPLEMENTED · NOT AUTHORIZED FOR IMPLEMENTATION**。
> 本文件只定义 **Round 生命周期语义**；不含实现、不含 schema、不含 event carrier、不含 Run lifecycle。
> 基线：`HEAD = origin/main = ls-remote = 10c1529`（C7-B Execution-Wiring Contract rev4 = FROZEN）。
> 前置裁定：**Round Semantic Adjudication**（R-S1…R-S8 = RESOLVED）· **Round Contract Amendment READ-ONLY DESIGN**（D-R1…D-R9）。

---

## §0 范围（scope）与非目标（OUT）

```text
IN   本契约只定义 Round 生命周期语义：
       §1 权威性与优先级登记 · §2 状态机与 terminal 集合 · §3 `planned` v1 语义 ·
       §4 `running → review` · §5 `review → completed | rejected` · §6 两层消费模型 ·
       §7 `rejected` no-reopen · §8 `completed` 前置条件 · §9 Task.failed 非机械关系 ·
       §10 三层独立性 · §11 独立 gap 登记 · §12 明确不做

OUT  ❌ Round persistence（G2-a / D-C7-C）      ❌ Round event carrier / round_finished 等新事件
     ❌ Run lifecycle                            ❌ critic 实现
     ❌ HumanGate 实现                           ❌ Round scheduler 实现
     ❌ TaskEngine 变更                          ❌ C7-C
     ❌ evaluation criteria 算法（含 critical path）   ❌ Runtime inheritance / Q9 完整解决
     ❌ 任何 TypeScript / helper 实现 / 测试        ❌ 修改 C7-B rev4（10c1529 FROZEN）
```

---

## §1 权威性与优先级（scope + precedence）

```text
本契约是【语义层契约】（尚未实现）。与既有权威文档的分工：

  Task / Execution wiring 语义   → docs/phaseC/c7b-execution-wiring-contract.md（rev4，FROZEN）
  Phase C 业务语义（知识/SoT/演化/验收） → docs/phaseC/implementation-contract.md（Phase C 总契约）
  Round 生命周期语义             → 【本文件】（仅在 Round 语义范围内优先）
  Run 生命周期                   → 仍 OPEN（无契约；本文件【不】定义）

precedence（冲突裁决）：
  · 涉及 Task 层语义 ⇒ 以 c7b-execution-wiring-contract.md（rev4）为准
  · 涉及业务层语义 ⇒ 以 phaseC/implementation-contract.md 为准
  · 仅涉及 Round 生命周期语义 ⇒ 以本文件为准

★ 本文件【不】定义 Runtime Contract inheritance（Q9 保持独立 OPEN）。
★ 本文件【不】声称覆盖任何其它文档的领域；不得据此扩张解释权。
```

---

## §2 Round 状态机与 terminal 集合

```text
ResearchRoundStatus（继承既有 5 态，【不新增】）：
  planned | running | review | completed | rejected

ROUND_TERMINAL_STATUSES = { completed, rejected }
isRoundTerminal(status) —— Round 终态判定（语义层；实现属后续 slice）

依据：
  · completed / rejected 是 Round 自身定义的两个结束性语义
  · 无证据表明 `review` 是终态（review = 待审查的进行中语义）
  · `planned` / `running` 显然是进行中状态
★ 本契约【不】新增任何 Round 状态成员。
```

---

## §3 `planned` 的 v1 语义（declared-but-unreachable）

```text
planned is declared-but-unreachable in v1.

No v1 lifecycle transition may enter `planned`.
No v1 writer may introduce `planned` as a reachable Round state.

Round construction enters `running`（据现实现：runtime/orchestrator.ts:60 `status: "running"`）。

★ 不得因"当前无 writer"而删除该 enum 成员 —— 删除属【代码契约变更】，另需裁定。
★ 未来若确实需要真正的 pre-execution planning phase，须单独设计 `planned → running`
  （含 owner / 触发条件 / 与持久化的关系）。
★ 本约束锁定的是【语义可达性】，不规定实现形态
  （即：不要求"必须不存在某个名为 X 的函数"之类的形态约束）。
```

---

## §4 `running → review`（execution settlement）

```text
唯一触发条件：该 Round 内【全部 Task 均已进入 Task terminal state】。

形式化：
  ∀ task ∈ round.taskIds : isTaskTerminal(task.status) === true

terminal 定义【复用】C7-B rev4，本契约【不重新发明第二套定义】：
  completed | failed | cancelled   （= TASK_TERMINAL_STATUSES）

★ 特别（与 C7-B rev4 的交界面）：经 dependency-impossibility closure 进入 `failed` 的 Task
  【算 terminal】—— 否则会出现：
      Task 已被 Orchestrator 合法判定永久不可能 ⇒ Task.failed
      但 Round 仍认为"该 Task 未结束" ⇒ Round 永远无法进入 review
  这会重新制造 L-3 / L-5 已消除的"永久不可执行但 non-terminal"问题。

★ non-runnable ≠ terminal ⇒
  · 阶段①（依赖暂不可满足；被阻塞 Task 保持 `queued`）⇒ Task non-terminal ⇒【阻止】running → review
  · 阶段②（永久不可能 ⇒ 经 Orchestrator closure 进入 `failed`）⇒ 已 terminal ⇒ 不再阻止

★ 禁止以以下任一作为【唯一】触发条件：
  · "critic task completed"（critic 目前零实现：agents/critic.ts = "Phase 2 placeholder, Contract only"）
  · "拓扑序耗尽"（TaskGraph 拓扑序是【结构】，不是执行完成证明）
  · "HumanGate 触发"（治理输入不是 settlement 判据）
  理由：review 的语义是对【本轮完整 DAG 结果】的审查；存在 non-terminal Task ⇒ 仍有未结束的执行工作。
```

---

## §5 `review → completed | rejected`

```text
lifecycle authority = **Orchestrator**（继承 C7-B §5.2 O-1：Run/Round authority = Orchestrator）。

数据流（单向；禁止旁路）：
  critic / human / deterministic evidence  →  review evidence  →  Orchestrator  →  completed | rejected

The base Round lifecycle contract does not require critic participation or Human Gate participation
for every Round.

Where critic evaluation or Human Gate decision is required, that requirement MUST come from the
applicable Round/review contract or governance rule.

Such participants provide review evidence / decision input only; they do not become Round lifecycle authority.

★ 禁止 `critic → Round.status`；禁止 `HumanGate` 绕过 Orchestrator 直写 Round 状态。
★ 本契约【不】定义"参与是否每轮可配"这类 configuration model（避免引入未设计的配置语义）。
```

---

## §6 Task terminal outcomes 如何被 Round 消费（两层模型）

```text
第一层 · Execution settlement（【确定性事实】，不含价值判断）
  Orchestrator 判定：该 Round 内所有 Task 是否已 terminal（判据见 §4）。

第二层 · Round review / evaluation（进入 `review` 后）
  Orchestrator 综合以下输入，再决定 `completed` 或 `rejected`：
    · Task terminal outcomes
    · Task / DAG 结构
    · Round objective / evidence
    · 契约要求时的 review evidence（critic / human / deterministic）

⇒ 报告形态：
    Task status  →  facts  →  Round evaluation  →  Round lifecycle
  【不是】：
    Task.failed  →  Round.rejected
```

---

## §7 `rejected` 的 no-reopen 规则

```text
Round.rejected = terminal，且【不得 reopen 其内任何 Task】。
（既有代码注释已表达同义：domain/round.ts:3-4「Rejection does NOT reopen old tasks:
  the orchestrator creates a new round instead.」）

★ 这是【硬约束】，不是 continuation policy。
★ "是否创建新 Round" 属【Run 层 continuation policy】，不由 Round 自身决定（见 §10）。
```

---

## §8 `completed` 的前置条件

```text
Round.completed  ⇒  该 Round 内每一个 Task 都处于【terminal】状态
                    （completed | failed | cancelled）

★ 是 terminal，【不是】every Task.completed ⇒ 允许 failed / cancelled 与 completed 共存。
相容性：与 Phase 0（04-research-kernel-design.md:80）「旧 Round 内所有 task 维持其终态
（completed/failed）」相容。
```

---

## §9 Task.failed 与 Round 生命周期（非机械）

```text
Task.failed is an input fact to Round evaluation.

Task.failed MUST NOT mechanically determine Round.rejected.

After execution settlement has established that all Round Tasks are terminal, the Orchestrator evaluates
the Round using the applicable Round objective, task/DAG structure, terminal outcomes, and any required
review evidence.

The specific evaluation criteria that determine whether a Round objective is satisfied are outside this
amendment and require a separate design decision.

Therefore:
    Task.failed  ≠  Round.rejected
and:
    Task terminal outcomes  →  Round evaluation  →  Round lifecycle transition

★ 明确【不在本契约内定义】（后置为独立设计问题）：
  critical path 的判定 —— 谁定义？依据 DAG topology 还是 research objective？
  失败的支线 Task 是否可忽略？failed critic 与 failed collect 是否等价？是否允许人工 override？
⇒ 本契约只锁定"经 evaluation、非机械"这一层，不锁定 evaluation algorithm。
```

---

## §10 三层生命周期的独立性

```text
Task facts   →  Round settlement / evaluation  →  Round state
Round facts  →  Run evaluation                 →  Run state

禁止：
  Task.failed  →  Round.rejected
  Task.failed  →  Round.rejected  →  Run.failed

依据：
  · domain/run.ts:3「Run state is independent from Round/Task state」
  · C7-B rev4 §5.1 L-3（不得把 Task failure / dependency impossibility 机械等价为 Round.rejected）
  · 本契约 §9
★ Round.rejected 之后的 continuation（是否新建 Round）属 Run 层策略（见 §7）。
```

---

## §11 独立登记：GAP-EVENT-1（Round durable event carrier 缺失）

```text
事实：FROZEN 事件层（domain/research-event.ts，标注 "FROZEN durable event (lock ⑤)"）的 11 类事件中，
      Round 相关【只有 round_created】—— 无 round_finished / round_completed / round_rejected。

定位：这是 **event-contract gap**，【不属于】本契约范围。
禁止：本契约【不得】借此新增任何 Round 事件（那会触碰 FROZEN durable event contract）。

影响（仅登记，不解决）：
  Round 的 lifecycle 转换在 durable event 层【无记录】⇒ 与 Q14（auditability REQUIRED）相关；
  其 carrier 属 D-C7-C（persistence）范围。
```

---

## §12 明确不做

```text
❌ Round persistence（G2-a / D-C7-C）        ❌ Round event carrier / round_finished 等新事件
❌ Run lifecycle                              ❌ critic 实现
❌ HumanGate 实现                             ❌ Round scheduler 实现
❌ TaskEngine 变更                            ❌ C7-C
❌ evaluation criteria 算法（含 critical path）  ❌ Runtime inheritance / Q9 完整解决
❌ 任何 TypeScript / helper 实现 / 测试          ❌ 修改 C7-B rev4（10c1529 FROZEN）
```

---

## §13 后续（未授权）

```text
实现（ROUND_TERMINAL_STATUSES · isRoundTerminal · settlement 判定 · review 通路 · no-reopen 守卫）
属【后续 Round implementation slice】，需单独授权。
本契约当前只提供语义；在实施授权之前，不得据本契约写任何代码。
```

**End of contract（Round Lifecycle Contract · rev1 · SEMANTIC ADJUDICATED · NOT IMPLEMENTED · NOT AUTHORIZED FOR IMPLEMENTATION。基线 `10c1529`。）**
