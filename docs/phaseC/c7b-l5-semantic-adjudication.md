# C7-B · L-5 Semantic Adjudication（Semantic Addendum）

> 状态：**DRAFT SEMANTIC RULING · DESIGN ONLY · NOT IMPLEMENTATION · NOT AUTHORIZED**。
> 本文件**不修改 C7-B FINAL LOCK**、**不写任何实现**、**不改任何代码/schema**；§3 记录已作出的语义裁定（Ruling），§4 列出禁止结论。
> 基线：`HEAD = origin/main = ls-remote = 81f4a02`（C7-B Execution-Wiring Contract rev3 FINAL LOCK）。
> 前置（均已完成、均 READ-ONLY）：
> · **L-5 Independent Provenance Audit** = PASS（结论：`Task.waiting` / `Task.cancelled` 仅声明、无 writer）
> · **Phase 0 → Phase C Contract Supersession / Effectivity Audit** = PASS（结论：Phase 0 Runtime = **SILENT RETENTION**）
> 严格流程：**L-5 Semantic Ruling（已完成）→ 补充本 Addendum（本文件）→ Human review → 若通过：commit docs-only → C7-B amendment review → C7-C planning**。

---

## §1 Evidence baseline

### §1.1 基线

```text
HEAD = origin/main = ls-remote = 81f4a02c827ad7cb3738462d990869132765d146
C7-B Execution-Wiring Contract rev3 = FINAL LOCK（本文件【不】修改它）
worktree CLEAN · 本文件为新增 docs-only 产物
```

### §1.2 L-5 取证结论（代码层）

```text
packages/research/src/domain/task.ts（1963 B · 自 Initial commit 起从未修改）
  TaskStatus = queued | running | waiting | completed | failed | cancelled
  TASK_TERMINAL_STATUSES = { completed, failed, cancelled }
  → waiting / cancelled 均无 JSDoc 语义；dependencies 注释仅「依赖 id（同 round DAG 内）」

writer 取证：
  · Task.status 的唯一 writer = runtime/task-engine.ts 的 setStatus（只产生 running / completed / failed）
  · 全仓不存在写入 "waiting" 的代码（唯一出现处 = task.ts:33 的 enum 声明）
  · "cancelled" 的生产写入全部属【其他域】：NextActionStatus（knowledge-projection-service.ts:769）·
    HumanGateStatus · ResearchRunStatus · RequirementStatus.blocked（information-requirement.ts:8）
  · 反证搜索：cancelTask / abortTask / waitTask / dependencyFail / resumeTask / blockTask ⇒ 全部零命中
  · 旁路搜索：Object.assign(task,…) / patchTask / updateTask / saveTask / persistTask / task.status = ⇒ 全部零命中
  · 测试层：无任何测试构造 status: "waiting" / "cancelled" 的 Task（仅 task-graph.test.ts:11 用 "queued"）
  · 调用链：.succeed( / .fail( ⇒ 全仓零调用者；Orchestrator.finishRun / finishRound ⇒ 零调用者；
            smoke 只调 engine.start() 后即 close() ⇒ 现有代码中 Task 生命周期仅到达 running
```

### §1.3 Phase 0 provenance（历史设计层）

```text
docs/phase0/04-research-kernel-design.md（HISTORICAL）
  L59-63  三层状态机：Run / Round / Task（enum 与代码一致）
  L61     状态机片段：「├──needs-input──▶ waiting ──resume──▶ running」
  L65     Task：「`waiting` = 等外部输入（HumanGate / 数据源返回）」
  L67     「completed / failed / cancelled 为终态。闭环不靠重开旧 task…」
  L54     「`human_gate` 类 task 进 `waiting`，由持久化 HumanGate 恢复。」
  L80     Round.rejected 语义：「旧 Round 内所有 task 维持其终态（completed/failed），不复活、不修改；
           orchestrator 依据打回原因新建一个 Round（状态 planned）」
docs/phase0/07-research-runtime-design.md:140-159 状态集 + Task 不可变 + 1..N TaskAttempt
docs/phase0/08-research-data-model.md:34,47       Run/Task 状态枚举
★ cancelled 的【触发条件】在 Phase 0 亦无定义（仅被列为终态）。
★ 「dependency failure → 后继 Task」的语义在 Phase 0 亦【无】。
```

### §1.4 效力层（Phase 0 → Phase C）

```text
docs/INDEX.md（自称「docs 文档地图（权威性排序）」· 2026-09-24）
  ✅ 权威：HANDOFF.md · phaseC/implementation-contract.md · architecture-review/06-v3.1-final ·
          07-domain-model-design.md · 08-code-design.md · phaseB/implementation-contract.md
  🕘 历史（原文：部分内容已被 06/07/08 取代）：01/02/03/04/05 · **phase0/** · phase2c
  🗄 已归档（原文：不要据此判断当前状态）：PROJECT_STATUS.md · SCORING_MODEL.md

docs/HANDOFF.md:710  | `docs/phase0/*`、`docs/phase2c/implementation-design.md` | Phase 0/2C 设计（历史） |

权威文档中唯一的执行层效力声明：
  docs/architecture-review/07-domain-model-design.md:551
  | Runtime（Run/Round/Task/Artifact/EventStore/HumanGate） | **保留** | **冻结契约** |
  ⇒ 笼统继承（RETAINED BY BLANKET REFERENCE）；**未重述任何内部状态语义**。
  ⇒ 07 的聚合清单（§3.1–§3.10）不含 Run/Round/Task/TaskAttempt/TaskGraph（执行层不在权威聚合体系内）。
  ⇒ 对照：07:223 对 NextAction 写了「gap 关闭时对应 action 置 cancelled」——对 Task 无对应定义。

权威文档中的实现状态（自认）：
  HANDOFF.md:725  Runtime 契约（Run/Round/TaskGraph/Attempt/Artifact/EventStore/ChildSession/HumanGate）→「⚠️ 仅 smoke」
  HANDOFF.md:243  planning/research-planner.ts「只 interface」
```

### §1.5 三条已确立的事实（本文件的全部前提）

```text
F-1 Task.waiting 的【历史语义】= 等待外部输入（HumanGate / 数据源返回），
    属 DOCUMENTED-HISTORICAL；当前权威契约【沉默】（未取代、亦未重述）⇒ SILENT RETENTION。
F-2 Task.cancelled 只有【声明】（enum + terminal 集合），无 writer / 无 trigger / 无文档
    ⇒ DECLARED-ONLY。不得据此推断 cancellation capability 存在。
F-3 "依赖未满足/失败" 与 Task.status 的映射关系，在【代码 / Phase 0 / Phase C】三者中【均无】语义
    ⇒ PROVENANCE-PENDING（原先合并为一个 OPEN ITEM，本文件按 §2 拆分）。
```

---

## §2 Split

```text
原先的单一 OPEN ITEM（L-5）实际包含两个性质不同的问题，本文件将其拆开。
```

### §2.1 L-5a — Scheduler readiness closure（调度就绪收口）

```text
问题域：调度语义（scheduler semantics）—— 不是生命周期语义。
问题：当依赖未完成或已失败时，后继 Task 是否可进入 runnable 集合（即是否可被入队）？

已由 C7-B 裁定（D-C7B-5 / §5.1 L-3）的部分：
  · dependency failure ⇒ 后继 Task non-runnable
  · non-runnable【不是】TaskStatus，而是【派生的调度就绪条件（readiness predicate）】
  · MUST NOT enqueue；禁止 dependency skipping
  · 不得新增 blocked / skipped / dependency_failed
  · 不得把 Task failure 机械等价为 Round.rejected

状态：PARTIALLY RESOLVED（就绪判定侧已定）
剩余（未裁定）：non-runnable 状态【长期存在】时如何处理？（本文件不回答，见 §3 Q5/Q6）
```

### §2.2 L-5b — Lifecycle closure after permanent dependency failure（永久依赖失败后的生命周期收口）

```text
问题域：生命周期语义（lifecycle semantics）。
问题：若前置 Task 永久失败，后继 Task 永不可运行 —— 它的【最终合法状态】是什么？

候选方向（均【无】provenance，均未裁定）：
  waiting（历史语义为"等外部输入"，非"等依赖")
  cancelled（DECLARED-ONLY，无 trigger）
  failed（可能被误用为"失败前置的等价"）
  新的终态（被 C7-B §6 I-5 / D-C7B-5 明确禁止）
  永远保持 queued / 非终态（C7-B 目前的临时安全行为，且已声明"不构成最终生命周期闭合语义"）

状态：OPEN
```

---

## §3 Semantic questions and rulings

> Q1–Q10 为问题空间（**原文保留**）；`Ruling:` 字段为 2026 L-5 semantic ruling 的裁定结果。
> 全部裁定均在 §2 的三条前提与 §4 的禁止结论之下作出。

```text
Q1  既有的 Task.waiting（等待外部输入：HumanGate / 数据源）是否允许被扩展用于表达
    "依赖饥饿（dependency starvation）"？若不作为同一语义，二者如何区分而不新增状态？

Ruling: 不允许（NOT ALLOWED）。两者不可合并：
        waiting               = 外部信息缺失（HumanGate / Data source），输入到达后可继续；
        dependency starvation = 依赖生命周期终止，依赖已不存在恢复路径；
        责任主体不同：前者 HumanGate/Data source，后者 Scheduler/Dependency graph。
        ⇒ dependency failure ≠ waiting。不得把 waiting 泛化。

Q2  永久依赖失败是否应当【终止】下游 Task？若应当，"终止"是否等于既有
    TASK_TERMINAL_STATUSES 中的某一成员？

Ruling: 是 —— 需要生命周期闭合（lifecycle closure）。
        理由：B 永久 non-runnable 而永远停留在 queued，会导致 ① DAG 永久悬挂；
        ② Runtime 无法判断 round 是否可收口；③ 观察层无法区分"等待输入"与"永远不可执行"。
        ★ 但：需要终止 ≠ cancelled 已成立（收口目标状态仍未确定，见 §2.2 / Q6）。

Q3  谁有权收口下游 Task 的生命周期？（Orchestrator / TaskEngine / 人工动作 / 其它）
    该权限与 C7-B §5.2 O-1…O-6 的所有权契约如何共存？

Ruling: 权责三分（保持 C7-B ownership，不新增写者）：
        · Dependency evaluation → 提供事实：发现 dependency terminal failure；
        · Orchestrator          → 判断该 failure 是否导致【永久】不可执行；
        · TaskEngine            → 执行合法的 Task transition。
        ✗ 禁止 TaskEngine 自己扫描 DAG；✗ 禁止 Orchestrator 直接修改 task.status。

Q4  收口是否应当是【显式人工决定】（与 material ingest 层"残骸不自动续跑、需人工决定"的既有先例一致）？
    还是允许自动收口？若自动，触发条件是什么？

Ruling: 允许【自动】收口，但必须建立在明确的 deterministic trigger 上（dependency failure 是系统事实，
        不是主观判断）；人工 gate 非必需。★ 但禁止"自动 cancel 全部 dependency failure"——
        必须区分 temporary failure 与 permanent failure。

Q5  当 non-runnable 长期存在（依赖永久失败）时，系统是否需要一个【可观察】表示？
    还是接受"不可观察"（即永远停留在既有非终态且不入队）？

Ruling: 需要可观察，但【不是】TaskStatus。
        TaskStatus 保持生命周期语义；可观察性由 readiness predicate（derived scheduling state）承载，
        例如概念上的 `task.isRunnable()` / `task.blockingDependencies()`。
        ⇒ C7-B 既有方向（non-runnable 为就绪谓词）正确。

Q6  若需要收口，触发器应当是什么：人工动作 / 依赖物化 / round 生命周期事件 / 其它？
    该触发器是否需要 Human Gate 参与？

Ruling: 触发条件 = Dependency terminal state reached
                  + No valid recovery path
                  + Graph evaluation confirms permanent impossibility。
        ⇒ 必须经过 dependency closure evaluation；不是 "A failed → B cancelled"。

Q7  收口是否需要与既有 TaskAttempt 语义一致（attempt 不可变、合法恢复追加新 attempt、
    终端 attempt 永不被修改）？收口是否会与"Task 不可变"冲突？

Ruling: 需要一致。TaskAttempt immutable 继续有效：禁止修改旧 attempt，允许追加新 attempt。
        ★ 但 dependency failure closure【不是】attempt retry，而是 task lifecycle resolution ——
          二者必须分离。

Q8  Phase 0 的 waiting（等外部输入）与"依赖未满足"是否必须【分离表达】？
    若必须分离，且不得新增状态 —— 那么"依赖未满足"应当由什么承载（例如仅由 readiness predicate 承载）？

Ruling: 必须分离（MUST SEPARATE）。
        waiting              = 外部输入等待（HumanGate / Data source）；
        dependency not ready = scheduler readiness predicate，【不进入】TaskStatus。

Q9  是否需要在权威契约中补一句执行层继承声明（即把 07:551 的笼统继承显式化），
    以免再次出现"enum 存在 ⇒ 误以为有语义 ⇒ 发明 transition"？
    若需要，应落在哪份权威文档（phaseC/implementation-contract.md 或 Runtime 专门契约）？

Ruling: 需要。最大风险 = enum 存在 ⇒ 开发者以为语义存在 ⇒ 自行实现 transition。
        落点：新增 Runtime Contract 文档（例：`docs/architecture-review/runtime-contract.md`），
        声明「TaskStatus members without transition provenance must not be implemented
        without semantic ruling.」
        ★ 不是修改 C7-B FINAL LOCK（该动作尚未授权、需独立 review）。

Q10 L-5a 与 L-5b 的裁定是否必须同时进行？（例如：若 Q1 的答案是"不允许扩展 waiting"，
    则 L-5b 的候选方向会随之收窄）

Ruling: 不需要同时进行；拆分有效。L-5a（scheduler readiness）= 已部分解决；
        L-5b（lifecycle closure）= 继续裁定。

──── 由 Q1–Q10 导出的当前语义模型（closure target 仍未确定）────

Dependency incomplete
        ↓
Runnable?
        ├── no → non-runnable（readiness predicate，非 TaskStatus）
        ↓
Dependency permanently failed?
        ├── no  → 仍属 temporary / 等外部输入（waiting 语义不变）
        └── yes → 需要 lifecycle closure
                     ↓
              closure target status = ★ 仍未确定（L-5b OPEN）

──── 对 Task.cancelled 的裁定（本轮）────
TaskStatus.cancelled 当前 = DECLARED-ONLY。本轮【不授予】dependency failure 使用权（无 provenance）。
⇒ dependency failure ≠ Task.cancelled。
```

## §4 Forbidden conclusions

> 经 §3 的 Ruling 后，以下禁止结论【仍然全部有效】（裁定只收窄语义，不解除任何禁令）。
> 在 L-5 semantic ruling 正式作出之前，以下结论一律**禁止**进入本文件、C7-B 契约或任何实现。

```text
❌ No Task.cancelled assignment
     —— 不得把任何情形（依赖失败 / 父任务取消 / 人工停止 / run 取消 / round 打回）判定为
        Task.status = "cancelled"。cancelled 当前仅为 DECLARED-ONLY，无 trigger。

❌ No new TaskStatus
     —— 不得新增状态成员（含任何形态的第七态）。

❌ No blocked / skipped / dependency_failed
     —— 不得新增任何等价语义的伪状态（包括以派生字段/投影/标签方式变相引入）。

❌ No implementation
     —— 不得写生产代码、测试、schema、migration；不得改 TaskEngine / Orchestrator / TaskStatus。

❌ No assertion that Phase 0 semantics are currently binding
     —— 不得据 docs/phase0/* 断言"当前系统 Task.waiting = 等外部输入"；
        该文档已被 INDEX/HANDOFF 归入"历史"，当前权威契约对其状态语义保持沉默（SILENT RETENTION）。

❌ No assertion that Phase 0 semantics are deprecated
     —— 反之亦不得断言 Phase 0 的 Task 语义已被取代（无任何 supersede 声明）。

❌ No promotion of scheduler readiness into lifecycle status
     —— 不得把 non-runnable（readiness predicate）当作或改写为任何 TaskStatus。

❌ No mechanical equivalence
     —— 不得把 Task failure 机械等价为 Round.rejected；不得把 Round.rejected 映射为 Task.cancelled
        （Phase 0 的反向证据是"旧 task 维持其终态、不复活、不修改"）。

❌ No modification of C7-B FINAL LOCK
     —— 不得在本文件中修改 docs/phaseC/c7b-execution-wiring-contract.md。
        若将来确需修改（例如 §5.1 L-1 的 waiting 措辞），必须走独立的 docs-only amendment + review，
        不得顺手混入本文件。

❌ No dependency on unverified provenance
     —— 不得把"工程直觉"（例如"既然不能运行，那就 cancelled/blocked 吧"）当作语义依据。
```

**End of design（C7-B · L-5 Semantic Adjudication · DESIGN ONLY · NOT IMPLEMENTATION · NOT AUTHORIZED。基线 `81f4a02`。本文件不含语义裁定、不含实现、不含 schema。）**
