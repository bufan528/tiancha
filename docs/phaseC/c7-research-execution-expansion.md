# Phase C7 · Research Execution Expansion（设计草案 —— DESIGN ONLY）

> 状态：**草案 / DESIGN ONLY**。本文件**不实施任何代码**、**不修改任何既有契约**、**未授权实施**。
> 基线：**C6 RMA FINAL / PUBLISHED / FROZEN**（`3972035` = `origin/main` = CLEAN；608/608 · 148 suites）。
> 代码验证基线：`cf74576`（F2 实现）。前置契约：[`c6-model-extractor-contract.md`](c6-model-extractor-contract.md)（rev13）· [`c6-real-model-adapter-contract.md`](c6-real-model-adapter-contract.md)（rev11 → 见该文件 §R17）· [`implementation-contract.md`](implementation-contract.md)（总契约）· [`docs/HANDOFF.md`](../HANDOFF.md) §10（LLM 边界红线）。
> 一句话：**C6 让模型能够作为一个干净的 provider boundary 被接进来；C7 让"能调用模型"变成"能真正做研究"。**
>
> **★ G2 Preflight Audit = PASS**（只读取证，20/20 项）。本 Phase 的定位据此锁定：
>
> ```text
> C7-B is a WIRING / INTEGRATION phase, NOT an execution-engine redesign phase.
>   Execution Engine  ← existing skeleton（inherit, do not redesign）
>   C6 RMA            ← existing extraction capability（FROZEN）
>   C7-B              ← connects them WITHOUT collapsing their boundaries
> ```
>
> 新增两项裁定见 §7：**D-C7-G**（lock ④/⑤ = Frozen-by-existing-code / provenance pending）·
> **D-C7-H**（Task 内提取 MUST 走 C6 RMA，MUST NOT 复用 ModelRouter 作提取替代）。

---

## §0 为什么需要 C7

C6 已经解决的是**"能力面"**问题：

```text
provider boundary 干净存在
  ├─ credential 隔离（不进身份/快照/日志/DB）
  ├─ identity 单一来源（AdapterIdentity → 既有 mxcfg- 机制）
  ├─ generation / snapshot / extraction_run 三处身份同源
  ├─ 零真实网络硬门 + 权威错误分类 + V1–V4 绝对边界
  └─ 可配置（TIANCHA_MODEL_BASE_URL / _NAME / _DEPLOYMENT / credential / AUTH_MODE）
```

C7 要解决的是**"使用面"**问题：

```text
用户如何稳定地用它          → C7-A
研究如何被真正驱动执行      → C7-B
研究结果如何演化成知识/方法论 → C7-C
```

**C7 不是 C6 的续片**：它不增强 RMA，而是消费 RMA。

---

## §1 边界红线（本 Phase 不做）

```text
❌ 不改 RMA 契约 rev8 的任何条款（C6 已 FROZEN）
❌ 不新增第二套持久化 / 状态机（Claim/Evidence/Knowledge 的 SoT 不变）
❌ 不让模型直接产生 Claim / Fact / Knowledge / PoolItem / Evaluation（HANDOFF §10 红线）
❌ 不做"模型自动选择调研对象"（人工闸门必须保留）
❌ 不做多 provider registry / fallback / routing（须单独契约）
❌ 不接外部真实数据源（Echo 占位仍在 ⇒ Phase E 的范围）
❌ 不改 C4 / C5 已冻结语义（Report / Diligence 投影面）
❌ 不引入 Experience domain（除非单独裁定 —— 见 §7 D-C7-E）
❌ 不做原文切片（原始字符位置映射；须单独契约）
```

---

## §2 已核实资产矩阵（设计依据 = 事实，非推测）

| 能力面 | 现状 | 出处 |
|---|---|---|
| 行业 / 公司 | ✅ `company-service` · `opportunity-discovery-service` | C1/C2 |
| 研究链 / 位置 | ✅ 域 `research-position.ts` · `chain-projection-service`（`chain` CLI） | C2 |
| 研究目标 | ✅ 域 `research-target.ts` · `target-service` / `target-proposal` / `target-recommendation` | C2 / C5-A |
| 问题-目标适配 | ✅ `question-target-fit-service`（含 fallback 需求） | C2/B3 |
| 调研准备 | ✅ `diligence-preparation-service`（只读，`diligence` CLI） | C5-D |
| 信息池（Slot+Item） | ✅ 域 `information-pool.ts` + 2 张表 + `pool` CLI（只读） | S3 |
| 材料 / 片段 / 证据 | ✅ `material-*` · `fragment` · `fragment_evidence`（双 hash + `nfkc-lf-v1` 定位） | C6 ① |
| 候选提取（模型缝） | ✅ `candidate-extraction-service`（legacy `[CANDIDATE]` + 模型路径） | F / F2 |
| **真实 provider 配置面** | ✅ `assembleModelAdapter(outputContract, process.env)` + credential + 能力校验 | **C6-A** |
| 候选审阅（人工闸门） | ✅ `candidate-review-service`（确认 ≠ 投影） | C6 ③ |
| 投影到 Claim | ✅ `candidate-projection-service`（复用既有 `ingestClaims`） | C6 ④ |
| Knowledge 投影 | ✅ `knowledge-projection-service`（belief / conflict / SUPERSEDE 校验） | C1 / C6 收口 |
| 优先级 / 下一步 | ✅ `priority-service`（persisted SoT） | C3 |
| 报告 | ✅ `report-service`（只读投影 + 按 `contentKind` 分流） | C4 |
| 方法论（含候选 + Human Gate） | ✅ `methodology-service` · 域 `methodology.ts` / `human-gate.ts` / `methodology_candidate` 表 | S1 / C1 |
| **研究执行引擎骨架** | ✅ **已存在且部分 FROZEN**：域 `run.ts` / `round.ts` / `task.ts` / `task-attempt.ts`（**FROZEN lock ④**）/ `task-graph.ts`（严格 DAG + Kahn，无 LLM）/ `research-event.ts`（**FROZEN lock ⑤**，落 SQLite）；运行时 `runtime/orchestrator.ts` · `runtime/task-engine.ts`（`TaskEngine`）· `tiancha-runtime.ts` · `child-session.ts` | **Phase 2A（既有）** |
| 外部真实数据源 | ❌ `echo-data-provider.ts` 仍是占位（`isRealExternalData=false`） | Phase E |
| 真实模型**运行闭环实测** | ❌ 未做过一次真实 provider 的端到端 run | **C7-A** |
| 研究执行的**产品化驱动** | ⚠️ 骨架已存在，但"缺口 → 任务 → 执行 → 沉淀"的驱动完成度**未核实** | **C7-B（需前置审查）** |
| 知识 → 方法论的**演化驱动** | ⚠️ 候选 + Human Gate 已有；"从研究结果自动**提出**候选"的驱动无 | **C7-C** |

> ★ **本草案最重要的设计约束**：`ResearchRun / Round / Task / TaskAttempt / TaskGraph / ResearchEvent` 与 `TaskEngine`/`orchestrator` **不是空白**，而是**既有且部分已冻结**的资产。C7-B **只允许继承与接线**，**不允许重新设计**。（其完成度必须先经一次只读前置审查确认 —— 见 §4 G2。）

---

## §3 三个缺口（C7 要补的）

```text
G1（C7-A）真实 provider 的【运行闭环】未验证
   配置面已就位；缺的是：一次真实的端到端运行（真实模型 → 候选 → 人工审阅 → 投影）
   + 用户可控的模型选择面 + 运行观测 + 受控的失败恢复策略

G2（C7-B）研究执行的【驱动】完成度未知
   执行引擎骨架（Run/Round/Task/Attempt/Graph/Event + TaskEngine/orchestrator）已存在；
   缺的是"从 ResearchGap / ResearchTarget 派生出研究任务并驱动执行、把结果沉淀为材料与候选"
   这一条链路的完成度核实与接线。★ 必须先做只读前置审查，不得假设它是空的。

G3（C7-C）知识 → 方法论的【演化驱动】缺自动提出
   `methodology_candidate` + `human_gate` 已有；缺的是"研究结果（Claim/Evidence/冲突/反例）
   → 提出 MethodologyCandidate"的驱动。升版权始终在 Human Gate。
```

---

## §4 契约拆分（三片，各自独立）

### C7-A · Real Provider Operationalization

```text
目标：让用户【稳定可用】地使用 C6 建立的 provider boundary。
消费：C6 的 assembleModelAdapter / credential / capability / 错误分类 / 零网络硬门。
候选交付面：
  ① 配置面的明确化与文档化（env 变量、AUTH_MODE、loopback 约束）—— 已存在，只是需要"使用说明 + 校验错误可读性"
  ② 用户可控的模型选择（CLI 面的显式选择；不引入 registry）
  ③ 运行观测（★ 只读、非身份化；不得进入 snapshot/identity/DB，除非另立契约放宽 §R9）
  ④ 失败恢复策略（★ 需要显式裁定：C6 §R8 的 maxAttempts=1 是 v1 invariant）
验收方向：一次【真实】端到端运行（真实 provider → 候选 → 人工审阅 → 投影）的证据留档。
不做：多 provider / registry / streaming / tool calling / 成本优化路由。
```

### C7-B · Research Execution Engine

```text
目标：把"缺口/目标"变成"被执行的研究任务"，并把结果沉淀（材料 → 候选 → 人工闸门 → Claim）。
消费：既有 Run/Round/Task/Attempt/TaskGraph/ResearchEvent + TaskEngine/orchestrator（★ 继承，不重设计）
     + ResearchGap / ResearchTarget / QuestionTargetFit / DiligencePreparation / Material / Candidate / Claim。
候选交付面：
  ① 一次只读前置审查（执行引擎完成度、缺口、可接线点）—— 【第一步，先于任何设计细节】
  ② "Gap/Target → ResearchTask 派生"的规则（必须 Human Gate 参与选对象）
  ③ 任务执行 → 材料摄入（复用 material-ingest）→ 候选提取（复用 RMA）→ 人工审阅 → 投影（复用 C6 ④）
  ④ 续跑 / 恢复（复用既有 TaskAttempt 语义；不得新增第二套状态机）
不做：自动选对象 / 自动决策 / 模型直接写 Knowledge / 新 SoT。
依赖：C7-A（真实模型稳定可用）。
```

### C7-C · Knowledge Evolution

```text
目标：研究结果 → Claim/Evidence → Knowledge →（提出）MethodologyCandidate → Human Gate → Methodology Version。
消费：knowledge-projection-service / methodology-service / human_gate / knowledge_conflict。
候选交付面：
  ① "研究结果 → 提出方法论候选"的判定规则（必须可解释、可回溯到证据）
  ② 升版仍严格由 Human Gate（模型不得自行升版）
不做：删除旧 Claim / 自动裁决冲突 / 模型自行升版。
依赖：C7-B（需要有研究结果产出）。
```

---

## §5 依赖与顺序（已按 D-C7-D 调整）

```text
C7-B / G2 Preflight Audit（★ 先做，只读，不写代码）
   ↓  审查既有 Research Execution Engine，确定【真正】缺口
   ↓
C7-A（Real Provider Operationalization：真实运行 / 配置 / 观测 / 失败语义）
   ↓
C7-B（Research Execution Wiring：Gap/Target → Task → 既有 TaskEngine/TaskGraph/Attempt
   ↓   → material ingest → candidate extraction → human review → Claim projection）
C7-C（Knowledge Evolution：result → Claim/Evidence → Knowledge → MethodologyCandidate → Human Gate）
```

★ 先审查 C7-B 的理由：执行引擎骨架**已经存在且部分 FROZEN**。若先做 C7-A，存在把 C7-A 做成
"第二个研究执行路径"的风险；正确架构是 **既有 Execution Engine ← C7-A 提供能力**，而不是
**C7-A 自己造执行流程**。

每片都走既有流程：**设计 → 审查 → Final Lock → 窄口径授权 → 实施 → 测试 + mutation → 全量门禁 → 独立 commit → push → 验证**。

---

## §6 明确不做（防膨胀清单）

```text
❌ C6 的任何 enhancement（RMA 已 FROZEN）
❌ 多 provider / provider registry / fallback / routing
❌ 外部真实数据源（Phase E）
❌ Experience domain（除 §7 D-C7-E 裁定）
❌ Report / Diligence 语义变更
❌ 原文切片
❌ 把 C7-A/B/C 合成一片
```

---

## §7 裁定记录（用户已裁定 —— 六项全部落定）

```text
D-C7-A  运行观测边界   → ❌ 不放宽 C6 §R9。telemetry 继续【仅内存】。
                          允许：当前进程内观察 / CLI 展示 / 测试捕获 / failure diagnostics。
                          禁止：DB persistence · snapshot persistence · identity participation ·
                                Claim/Evidence projection · Knowledge projection · Report projection ·
                                ResearchEvent projection。latency/requestId/usage/tokens/provider
                                response metadata 一律【不得】变成研究事实。
                          若将来需要历史运行监控 ⇒ 另立 `C7-D / Operational Observability Contract`。

D-C7-B  失败恢复       → ❌ 不突破 C6 §R8 的 `maxAttempts = 1`（继续作为 v1 invariant）。
                          C7-A 只验证【成功 / 失败 / timeout / caller abort / provider error】能稳定结束。
                          不得同时解决 failed → retry → backoff → attempt 2/3。
                          retry 的归属（TaskAttempt? Provider invocation? ResearchTask?）尚未证明 ⇒ 另立契约，
                          并须一次冻结：上限 · backoff · retryable 集合 · 触发边界 · timeout 关系 ·
                          abort 关系 · identity 关系 · observability。

D-C7-C  新增持久化表   → ⏸️ 【暂不授权】。由 C7-B 前置审查基于既有 FROZEN contract 与 runtime/
                          persistence 事实提出【最小方案】，再单独裁定。
                          ★ 反模式警告：不得因"Run/Round/Task 没表"就直接建三张表 —— 那会把既有 domain
                          contract 重新翻译成第二套 persistence architecture。

D-C7-D  起点           → ✅ 【先做 C7-B G2 前置只读审查】（不是 C7-B 实现）。
                          先把已有执行引擎资产完整取证，再决定 C7-A 到底需要提供什么接口；
                          否则 C7-A 有可能自己造出"第二个执行流程"。

D-C7-E  Experience     → ❌ 继续 Deferred。C7-C 第一阶段只用既有 Claim/Evidence/Knowledge/
                          MethodologyCandidate/HumanGate 完成闭环，不新增 ResearchExperience 等中间真相层。

D-C7-F  模型选择载体   → ✅ 第一阶段继续 env（TIANCHA_MODEL_BASE_URL/_NAME/_DEPLOYMENT + credential +
                          AUTH_MODE），不新增 CLI flag / config file（避免 env / CLI / config 的 SoT 之争，
                          该问题属 identity/config semantics，另立契约）。
```

```text
D-C7-G  lock ④ / ⑤ 的溯源状态  → ✅ 裁定：**保持为代码现状约束，不升级为可引用的外部冻结契约。**

        Frozen-by-existing-code / provenance pending
        Existing source code explicitly marks these contracts as frozen (`lock ④` / `lock ⑤`),
        but the originating specification document has not been located in the repository.
        C7-B shall preserve the observed semantics and shall not reinterpret, weaken, or extend them.
        Provenance recovery is an audit/documentation task, not a C7-B implementation task.

        ⇒ 不追溯、不猜测、不补写所谓 lock ④/⑤ 原文、不修改代码。
        ⇒ 记为【独立 provenance debt】（不阻塞 C7-B）。

D-C7-H  Task 内提取的模型通道  → ✅ 裁定：**MUST use C6 RMA；MUST NOT reuse ModelRouter 作为提取替代。**

        | 通道 | 职责 | C7-B 是否改变 |
        |---|---|---|
        | `ModelRouter` / `ModelResolverPort` | Task / Agent runtime 执行能力 | **不改变** |
        | C6 RMA | 结构化研究信息提取 | **复用并新接线** |
        | C7-B | 把研究执行流程串起来（orchestration / wiring） | **负责接线** |

        ★ 反模式（禁止）：
              Task → ModelRouter → 由通用 Agent 自行决定如何抽取 Claim
          —— 这会重新模糊 C6 已经建立的 boundary。

        ★ 正确方向：
              Gap / Target → Task derivation → ResearchTask → TaskEngine
                ├── runtime execution ─→ ModelRouter
                └── research material ─→ Material → Extraction → C6 RMA → CandidateDraft
                                                                  → Human Review → Claim
          TaskEngine 不得自己变成 Extraction Engine。
```

### §7.1 原待裁定项（保留原文，已由上方裁定取代）

```text

```text
D-C7-A  运行观测的边界：C6 §R9 规定 telemetry "v1 仅内存内"。C7-A 若要展示/持久化运行观测，
        必须新契约明确放宽范围（否则只能做"只读、非身份化、不落库"的展示）。—— 待裁定
D-C7-B  失败恢复：C6 §R8 的 `maxAttempts = 1` 是 v1 invariant。C7-A 若要引入受控 retry，
        必须新契约冻结六项（上限/backoff/retryable 集合/可观测性/触发边界/与 timeout 的关系）。—— 待裁定
D-C7-C  C7-B 是否允许为"研究任务"新增持久化表（Run/Round/Task 目前【无表】），
        还是必须复用既有表/事件流？—— 待裁定（涉 DB schema，属重大边界）
D-C7-D  起点：先做 C7-A（真实 provider 运行）还是先做 C7-B 的前置只读审查？—— 待裁定
D-C7-E  是否恢复 Experience domain（此前明确暂缓）？—— 待裁定
D-C7-F  模型选择的载体：继续 env（C6）/ 新增 CLI flag / 新增配置文件？—— 待裁定
```

---

## §8 启动条件

```text
1. 用户对本草案的目标/边界/拆分给出裁定（含 §7 的 D-C7-A…F）
2. 选定一片作为起点（建议 C7-A 或 C7-B 的前置只读审查）
3. 该片另立独立契约 → 审查 → Final Lock → 窄口径授权
4. 除此之外：【不写代码】
```

---

## §9 与 C6 的边界（一句话）

```text
C6 = 能不能把模型作为一个干净的 provider boundary 接进来。     （已完成 / FROZEN）
C7 = 接进来之后，研究能不能真的被驱动、被沉淀、被演化。        （本 Phase）
```

## §10 G2 Preflight Audit 结论（PASS）与边界锁定

### §10.1 G2 事实摘要（只读取证，20/20 项）

```text
EXISTING / FROZEN  Run/Round/Task/Attempt/TaskGraph/ResearchEvent 域模型（部分 FROZEN）
                   Orchestrator（Run/Round 生命周期 + DAG 校验 + 事件外发）· TaskEngine（attempt + session）
                   SqliteResearchEventStore + `research_event` 表（durable）· artifact store
                   HumanGate primitive（resumeToken：hash + scope + 单次 + 过期）
                   material ingest 的 resume 语义（完整，含 T-R1 系列）· candidate projection 的幂等 resume
                   research_state 表（知识/缺口层 SoT，由 knowledge-projection 写入）
PARTIAL            Run/Round/Task 全部为【内存 Map】· 拓扑序只用于排序与事件 payload（未驱动调度）
                   TaskEngine 无 timeout / AbortSignal / catch · 无产品化入口（唯一调用者 = smoke）
MISSING            Task 工厂 / Gap→Task / Target→Task / QuestionTargetFit 参与
                   Material / Candidate extraction / Review / Claim projection 四条接入
                   执行层的 resume / recovery
CONFLICT           两条模型通道并存（ModelRouter/ModelResolverPort vs C6 RMA）⇒ 由 D-C7-H 裁定
DEFERRED           Experience domain（D-C7-E）· 观测持久化（C7-D）· retry（另立契约）
```

### §10.2 C7-B 的边界（锁定）

```text
C6 RMA                     = Provider / Extraction capability = FROZEN（不改变）
Existing Execution Engine  = Run/Round/Task/Attempt/DAG/Event skeleton = inherit, do not redesign
C7-B                       = execution wiring：
                               Gap/Target → Task · dependency-aware execution · execution → Material
                               Material → C6 RMA extraction · Candidate → Human Review
                               approved Candidate → Claim projection · durable execution state / recovery
                               （是否新增 persistence：以证据另行决定，见 D-C7-C）
```

### §10.3 锁死 4 条（C7-B 不得越界）

```text
1. 不因为 G2-a 就马上设计 Run/Round/Task 表 —— 先进入 D-C7-C 的独立契约设计；当前只确认"缺失"。
2. 不因为 G2-c 就重写 TaskGraph —— 先定义"现有 DAG 如何成为真正调度约束"，再决定最小 wiring。
3. 不因为 G2-g 就改 ModelRouter —— C7-B 新增的是 Execution → Extraction 的接线，不是重定义模型路由。
4. 不因为 G2-d 就让模型直接产生 Claim/Knowledge —— 必须保持
   Material → RMA → Candidate → Human Review → Claim → Knowledge。
```

### §10.4 下一步（尚未授权）

```text
本文件到此为止。C7-B Implementation Contract 的独立设计/审查【未授权、未开始】。
届时才处理 G2-a…G2-f 的具体边界（尤其 Run/Round/Task 持久化 · Task 派生 · DAG 调度 ·
Material 接入 · resume/recovery）。
```

**End of draft（Phase C7 · Research Execution Expansion —— 设计草案、DESIGN ONLY、未实施、未授权。G2 Preflight = PASS。基线 C6 RMA FROZEN `3972035`。本文件只做目标/边界/拆分设计，不写任何实现代码。）**
