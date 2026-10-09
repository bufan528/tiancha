# R6-ERR rev6 · Implementation Contract（rev5 · ACCEPTED · NOT FROZEN）

> **状态：ACCEPTED / NOT FROZEN / NOT EFFECTIVE / IMPLEMENTATION NOT AUTHORIZED**
> **接受授权：R6ERR-AUTH-22（rev5 接受；**不含**冻结授权）**
> **修订授权：R6ERR-AUTH-21（rev4 → rev5 合并修订）**
> **本文件不授权任何实施**。冻结、Commit、Push、Preflight、Implementation 均须另行授权。

---

```text
Kind              : IMPLEMENTATION CONTRACT（实施契约 · rev5）
Status            : ACCEPTED / NOT FROZEN / NOT EFFECTIVE / IMPLEMENTATION NOT AUTHORIZED
Accepted by       : R6ERR-AUTH-22（rev5 接受授权 · 独立事件 #1）
Frozen            : NO（冻结须另行签发独立授权 · 独立事件 #2）
Revised by        : R6ERR-AUTH-21（rev4 → rev5 合并修订）
Rev history       : rev1（AUTH-17 初稿）
                    → rev2（AUTH-18：R-1…R-5 + 输入域一致性 + 编号纪律）
                    → rev3（AUTH-19：A-1…A-4 + B-1 身份比较 + B-2 L5 条件式）
                    → rev4（AUTH-20：D-1 校验优先 + D-2 branch_input_missing + P0-1 knownFacts/notEvaluated[]）
                    → **rev5（AUTH-21：E-1 L4 映射责任归判定器 + E-2 不变式分情况适用
                        + E-3 阶段内/条件式错误唯一顺序）—— 修复 IC-REVIEW-04 的 P0-1…P0-3**）
Bound Amendment   : docs/phaseC/r6err-proposal-v1.2-amendment.md
                    · rev6 · EFFECTIVE（2026-10-09T14:20:40Z，凭证依赖型）
                    · 生效范围 = N1–N9（§3 / §3.1 / §4 / 命名约定）
Bound base v1.1   : docs/phaseC/r6err-proposal-refinement-record.md
                    · commit=1435a7c7d66acdb19cf2c3babbe2e3e7c7ec83e0
                    · blob=d7cd3c2ff28ff0e5713035df7f5018ac9aecc373
                    · status = PROPOSED / NOT FROZEN（不因 rev6 生效而改变）
Orig freeze object: commit=7f31bb8bbd6174005fdf0c41a1f7a6d5e9029308
                    blob=67923f368af7dc1378390273b36ebdab88e79abc
Publish baseline  : origin/main = 14db873f6d8c680fa6dc476e70de3b2e4d3df147
Effectivity event : EFF-01（授权 R6ERR-AUTH-15 · 发布 R6ERR-AUTH-16）
SC-EX-01          : REGISTERED / NOT RATIFIED（本契约不追认）
Does NOT Authorize: Implementation · Preflight · 任何代码/测试/schema/Methodology 修改 ·
                    冻结（FROZEN）· Effectivity · Commit · Push · Tag · Release ·
                    创建实现文件
```

---

## §1 对象身份与依据

### §1.1 本契约的对象（承 R-2 收窄）

```text
对象（收窄后）=
    接收【已确定的判定输入】，按 N1–N9 执行【确定性单次判定】，
    并报告【规范允许的诊断属性】的纯判定组件。

⇒ 本契约的实施对象是【纯判定器】（pure adjudicator），不是采集器、不是服务、
  不是集成组件、不是审查流程本体。
```

### §1.2 依据清单

| 依据 | 出处 | 用途 |
|---|---|---|
| Amendment rev6（EFFECTIVE） | `docs/phaseC/r6err-proposal-v1.2-amendment.md` · blob `39e098df…` | 规范来源 |
| 生效事件 EFF-01 | 同上 §10 · L1069–L1208 | 生效范围与效力边界 |
| Effectivity 定义（D-9-7） | 同上 §10 · AUTH-10 记录块 | 生效语义 |
| 生命周期规则 R-STATE-1′…5 | 同上 §10 · AUTH-10 记录块 | 状态与冻结纪律 |
| Gate 裁定 AUTH-14 | 同上 §10 + AUTH-14 审阅记录 | PASS WITH CONDITIONS 与 C-1 解释性裁定 |
| 审阅裁定 IC-REVIEW-01 / 02 / 03 / 04 | 对话记录 | 退回修订；接口与一致性缺口 |
| 架构裁定 AUTH-19 | `AUTH-19` §2/§3/§4 | **A-1…A-4**（架构）与 **B-1/B-2**（数据契约） |
| 缺口修订裁定 AUTH-20 | `AUTH-20` §0 | D-1 · D-2 · P0-1 形状 |
| 合并修订裁定 AUTH-21 | `AUTH-21` §一 | **E-1**（L4 映射归判定器）· **E-2**（不变式分情况）· **E-3**（错误顺序） |
| 修订授权 | `R6ERR-AUTH-21`（前置 AUTH-17 / 18 / 19 / 20） | rev4 → rev5 修订与落盘边界 |
| **接受授权** | `R6ERR-AUTH-22` | rev5 接受（**不含**冻结） |
| 接受裁定 Q1–Q7 | `AUTH-22` §一 | 接受/冻结分离 · 对象身份 · 独立版本轴 · Effectivity 不适用 |

### §1.3 效力边界（承接 rev6）

```text
· 本契约【不】修改 Amendment rev6、原始 v1.1、AD-R6-1、H-1～H-6 或任何冻结记录
· 本契约【不】改变 §9 的 26 项计数、§7.2 的 40 项口径
· 本契约【不】追认 SC-EX-01
· 本契约【不】改变原始 v1.1 的 PROPOSED / NOT FROZEN 状态
· 本契约【不】授权 Implementation、Preflight 或任何仓库写操作（除本文件自身落盘）
· 本契约【不】扩大 N1–N9 的规范性范围
· 本契约中的【接口与错误处理形状】（A-3 / B-1 / B-2 / D-1 / D-2 / P0-1 / E-1 / E-2 / E-3）为
  **架构裁定确定的接口与错误处理设计**，**不是**对 N1–N9 新增规范性决策规则
  （承 AUTH-19 §二 1 末段 + AUTH-20 §0 D-1 + AUTH-21 §三 1）

★ 接受（ACCEPTED · R6ERR-AUTH-22）的效力边界：
  · 仅表示 rev5 的**内容**被接受为【候选实施形式基线】
  · **不**表示已冻结（NOT FROZEN）· **不**表示已生效（NOT EFFECTIVE）
  · **不**表示 Implementation 已获授权（IMPLEMENTATION NOT AUTHORIZED）
  · 接受与冻结是两个**独立事件**，必须分别授权、分别记录（AUTH-22 §一 Q1）
  · Effectivity 概念**不适用**于 Implementation Contract（AUTH-22 §一 Q6）
  · 冻结后禁止原位重写；修订仅经 `IC-A*`（Amendment）/ `IC-E*`（Erratum）append-only
    （AUTH-22 §一 Q5；当前**未**创建任何此类文件）
```

---

## §2 规范范围映射（N1–N9 → 实施要求）

> 说明：`§3` / `§3.1` / `§4` 为 **Amendment 内部章节号**（对应 v1.1 的同名章节），
> 依 rev6「命名约定」（N9）的引用纪律，本文件引用规则时使用 `R1`–`R6`。

| # | 规范增量（已生效） | 规范出处 | 实施要求（契约条款） |
|---|---|---|---|
| **N1** | 节点类别与优先级规范原则：GATE 类节点（L1/L3/L6）的判定**必须一致地先于** RESOLVER（L5） | rev6 §1 · L66–L69 | §4.1 |
| **N2** | L3 / L6 的许可维度差异（契约维度 vs 审查范围维度） | rev6 §1 · L70 起 | §4.2 |
| **N3** | L5 职责限定：RESOLVER 不承担阻断；其 `UNCLEAR` 不得遮蔽 GATE 的 `deny` | rev6 §1 · 同段 | §4.3 |
| **N4** | 确定性短路顺序 `R1 → R2(L3) → R4(L6) → R3(L5) → R5 → R6` | rev6 §2 · L118–L124 | §4.4 |
| **N5** | SoT Decision 三值规范语义定义（含 `ILLEGAL` 的**当前范围限定**） | rev6 §2 · L126 起 | §4.5 |
| **N6** | `INV-AXIS-1`：决策轴与诊断轴分离（四条） | rev6 §2 · L137–L142 | §4.6 |
| **N7** | CF-2：`unspecified ≠ allow`（既不构成明确许可，也不构成阻断） | rev6 §2 · L144–L158 | §4.7 |
| **N8** | 两轴独立性与完整性声明（对应 `INV-AXIS-1`） | rev6 §3 · L216–L221 | §4.6a / §4.8 |
| **N9** | 命名约定：`L1–L6`（Layers）/ `R1–R6`（Rules）/ `§Rx`（外部章节）区分与引用纪律 | rev6 §4 · L287–L297 | §4.9 |

### §2.1 明确排除（不在本契约的实施范围）

```text
· 原始 v1.1 的**全部条款**（其为 PROPOSED / NOT FROZEN；不因 rev6 生效而生效）
  ★ v1.1 §10 的「Implementation / runtime / SoT checker / CLI / Repository API」
    条目 —— 其解释性裁定见 §7 OI-1（状态：**已裁定关闭**）
· rev6 的 §6（CF 闭合对照）· §7（兼容性影响，含 §7.1/§7.2/§7.2.1/§7.2.2/§7.3）·
  §8（明确不授权）· §9（逐条对照总表）· §10（修订与治理记录）
  ⇒ 上述均为说明性/边界性/审计性内容，**不构成规范增量**
· 任何代码 / 测试 / schema / Methodology / Version / Human Gate 机制的变更
· Implementation 本身（须独立授权）
```

### §2.2 本节状态说明（编号纪律 · rev5 同步）

```text
依 AUTH-18 §3 末段与 §6：凡不能在不扩大授权范围的前提下直接映射为可执行行为者，
列为开放问题并给出证据；**不得私自补充规则**。

★ 本契约的开放问题采用【稳定编号】：OI-1 … OI-6。编号一经分配即不重编。

   OI-1  v1.1 §10「❌ … SoT checker …」是否构成实施障碍   → 已裁定关闭（解释性裁定）
   OI-2  L1–L6 属性的【采集】是否在实现范围内              → 已确定范围边界（收窄为不采集）
   OI-3  形态 / 落点 / 消费者 / 错误表示 / 身份输入 / L5 条件式 → 已裁定关闭（AUTH-19）
   OI-4  INV-AXIS-1 第四条的确切表述                       → 已解决（已逐字搬运）
   OI-5  NOT_EVALUATED 与 L5 → competing 映射表的完整条文   → 已解决（已逐字搬运）
   OI-6  多次判定之间的冲突消解                            → 已明确列为【非目标】

   ⇒ 计数（rev5）：共 6 个稳定编号；其中
        已解决并依据既有裁定关闭 = 4（OI-1 / OI-3 / OI-4 / OI-5）
        已确定范围边界           = 1（OI-2）
        仍待架构选择或证据支持   = 0
        被明确列为非目标         = 1（OI-6）
     合计 4 + 1 + 0 + 1 = 6 ✔
   ⇒ **当前无"仍待架构选择"的编号** ⇒ §9 S-1 不触发。
★ rev5 的修订（P0-1…P0-3 / E-1…E-3）属【已裁定事项的精确表达】，
  **不**新增开放问题编号、**不**重编 OI-1…OI-6、**不**重开 OI-3 或 A-1…A-4 / B-1 / B-2
  （承 AUTH-21 §二 明确不授权）。
```

---

## §3 只读代码调查（实测 · 证据可复核）

### §3.1 调查方法与范围

```text
检索范围：packages/research/src/** 与 src/**（共 239 个 .ts 文件）
方法    ：字符串精确检索 + 关键文件逐行阅读
纪律    ：所有判断均有路径与行号证据；不以文件名推测代码行为
限制    ：未做全仓扫描；tools/ config/ web/ vendor/ 未纳入；未运行测试；未做类型检查
```

### §3.2 核心发现：R6-ERR 在代码库中**零实现**

| 检索项 | 命中数 | 结论 |
|---|---|---|
| `SoTDecision` | **0** | 无该类型 |
| `SoT Decision` | **0** | 无该概念 |
| `INV-AXIS` | **0** | 无该不变量 |
| `R6-ERR` / `R6ERR` | **0** | 无任何引用 |
| `legality` / `Legality` | **0** | 无该语义 |

```text
⇒ ★ 结论：R6-ERR（N1–N9）在代码库中【无任何实现、无同名类型、无同名语义】。
  ⇒ 本契约将定义一个【全新组件】，不存在可继承的既有载体。
```

### §3.3 同名异义检索（命名冲突风险实测）

| 词 | 命中 | 实际语境（抽样证据） | 是否与 rev6 同义 |
|---|---|---|---|
| `LEGAL` | 36 | `candidate-extraction-service.ts:540`「An empty `candidates` list is LEGAL」；`evolution-target.ts:3`「(`REVISE`/`SUPERSEDE`) is legal」 | **否**（英文形容词"合法的"） |
| `AMBIGUOUS` | 23 | `material-ingest-service.ts:86` `class OrphanClaimAmbiguous`；`:456`「AMBIGUOUS overlap must stay IDENTIFIABLE as a 残骸」 | **否**（C-MVP-R1 材料导入重叠歧义） |
| `GATE` | 273 | `critic.ts:1`「quality gate」；`candidate-extraction-service.ts:281`「FENCING GATE」；`:619`「hard gate #11」 | **否**（业务闸门） |
| `RESOLVER` | 62 | `question-target-fit-service.ts:14` `ActiveRequirementResolver`；`chain-projection-service.ts:92`「shared resolver」 | **否**（业务解析器函数） |
| `currentKnowledgeId` | 6 | 见 §3.6 AF-6 | **相关**（H-1 的 DEPRECATED 字段，R6-ERR 的起源） |

```text
⇒ 结论：上述四词在代码库中**已用于其他语义** ⇒ 新组件须在命名上显式消歧（见 §4.9）。
```

### §3.5 调查边界声明

```text
· 本次为【只读】调查；未修改任何文件
· 未做全仓扫描（仅 packages/research/src 与 src）；tools/ config/ web/ vendor/ 未纳入
· 未运行任何测试；未做类型检查
· 未评估性能、可达性、测试覆盖等（v1.1 §2 明确排除这些维度）
· rev3 / rev4 / rev5 未新增代码调查（只读复核已有证据）
★ 独立性边界：IC-REVIEW-02 独立核查了 AF-1 / AF-2 / AF-3 / AF-6；
  其余项（239 文件计数、全部命中数、"全仓零消费者"）以本地调查报告为依据。
```

### §3.6 架构证据与接口方案（R-3 · rev3 落实 A-1…A-4 · rev4 落实 D-1/D-2/P0-1 · rev5 落实 E-1…E-3）

#### AF-1 ★ 同构先例：`domain/sufficiency.ts`（pure value object + pure function）

```text
实测路径：packages/research/src/domain/sufficiency.ts（104 行）
★ 头注（L5–L6，逐字）："This is a pure value object + pure function, NOT a service."
★ 结构：SufficiencyPolicy / SufficiencyFacts / sufficiencyFacts(...) / SUFFICIENCY_POLICY_V1 /
        isSufficient(facts, policy): boolean / sufficiencyPolicies = new PolicyRegistry(...) /
        resolveSufficiencyPolicy(req)
★ 纪律（L87，逐字）："纯函数：不访问 DB、不依赖任何 Service、无副作用、不改 PolicyRegistry / 版本语义。"
★ 来源合法性（L79–L89）：依据 H-1 的 H1-7-10「允许纯 resolver 下沉到既有 domain 语义位置」。
⇒ ⇒ **本项目【已接受】的"纯判定逻辑落 domain"先例，与 R-2 收窄后的对象同构。**
```

#### AF-2 出口惯例

```text
实测：packages/research/src/index.ts（41 行）逐层 re-export（`export * from "./domain/index.js"; …`）
⇒ domain 层有统一出口 `domain/index.ts`。
```

#### AF-3 测试放置惯例

```text
实测：packages/research/src/（根）= 55 · src/cli = 19 · src/agent = 8 ·
     packages/research/src/{runtime,storage,providers} = 1/1/3
★ 实例：`packages/research/src/h1-sufficiency-semantics.test.ts`（domain 语义测试位于 src 根）
```

#### AF-4 `ports/` 为纯接口层

```text
实测：packages/research/src/ports/ 含 10 个 `*.port.ts`（纯接口，无运行时行为）
★ 依 A-1：本契约【不】在 ports/ 新增接口。
```

#### AF-5 无任何审查 / 诊断 / 合规类入口

```text
实测：src/cli/ = research-commands.ts · tiancha.ts · research-format.ts；
     src/tools/ = material_ingest · memory_search · pool_list · profile_read · profile_write · wind_query；
     src/agent/ = host.ts · pi-session-capability-adapter.ts 等
⇒ **未发现**任何"审查 / 诊断 / 合规"类 CLI 子命令或 agent tool。
```

#### AF-6 `currentKnowledgeId` 的真实读写点（R6-ERR 起源场景）

```text
实测（共 6 处）：
  1. domain/industry.ts:23（字段定义）  2. storage/research-repository.ts:91（写入）
  3. storage/research-repository.ts:1709（读回）  4-5. knowledge.test.ts:151/153（测试）
  6. src/cli/research-commands.ts:239（禁令注释：「**不得**读 Industry.currentKnowledgeId」）
★ 第 6 处是 R6-ERR（H-1）场景的痕迹，但**不是代码消费者**。
⇒ ⇒ **代码库中不存在 R6-ERR 判定结果的代码消费者。**
```

#### AF-7 输入提供者：无现成组件

```text
规范层面（v1.1 §5）：默认 Scoped SoT Legality —— 由【人类审查者】按 Slice 产出属性。
代码层面：实测**未发现**任何会产出 L1–L6 属性的组件。
⇒ ⇒ **代码库中不存在 L1–L6 属性的自动提供者。**
```

#### §3.6.1 责任边界（A-1 / A-2 已裁定）

```text
┌────────────────────┬────────────────────────────────────────────────────────┐
│ 判定器（本契约对象） │ 输入有效性校验（§4.4a）⇒ 确定性单次判定（§4.4b）⇒          │
│                    │ 返回三类结果之一（§5.7）                                │
│                    │ ★ 不采集、不访问 DB / 文件、无副作用                     │
│                    │ ★ **不**负责身份发现 / DB 查找 / 别名解析 / 身份规范化     │
│                    │ ★ **负责** L4 → 轴 2 `deprecated` 的规范化映射（E-1）     │
│ 输入提供者          │ 【规范层面】人类审查者按 Slice 逐源产出属性（含 L4 原始状态、身份值） │
│                    │ 【代码层面】实测不存在（AF-7）                          │
│ 输出消费者          │ 【A-2 裁定】**初始实现不接入任何消费者**；仅提供纯函数出口 │
│ 潜在调用者          │ 无现成调用者 ⇒ **不得虚构**                            │
└────────────────────┴────────────────────────────────────────────────────────┘
```

#### §3.6.2 实现落点 —— **A-1 已裁定：方案 A**

```text
⇒ 落点：packages/research/src/domain/r6err-legality.ts（单文件纯判定组件）
   依据：AF-1（同构先例）+ AF-2（出口惯例）+ AF-3（测试惯例）
   限定：不新增包、不设子目录、不引入服务层
⇒ 导出：经 `domain/index.ts` ⇒ 测试：置于 `packages/research/src/` 根
⇒ 被否决候选：B（子目录）· C（独立包）
★ 本契约【不】创建该文件（创建属 Implementation，须独立授权）。
```

#### §3.6.3 接口形状 —— **A-3 / B-1 / B-2 / D-1 / D-2 / P0-1 / E-1…E-3 已裁定**

```text
★ 以下为架构裁定确定的【接口与错误处理设计】（非 N1–N9 的新规范决策规则）。

────────── 【输入】 ──────────
interface LegalityInput {
  // ── 无条件必需（§5.2 A）：缺失 ⇒ IE-1；超域 ⇒ IE-2
  presence                : boolean;                            // L1（GATE）
  contractPermission       : "deny" | "allow" | "unspecified";   // L3（GATE）
  sliceDependencyLegality  : "deny" | "allow";                  // L6（GATE）

  // ── 无条件必需【结构】（§5.2 B）：结构缺失 ⇒ IE-1；其值可为 not_evaluated
  l5Evaluation :
      | { status: "evaluated";
          value: "NONE" | "EXISTS_AND_AUTHORITY_IDENTIFIED" | "EXISTS_BUT_AUTHORITY_UNCLEAR" }
      | { status: "not_evaluated" };

  // ── 条件式必需（§5.2 C）：仅在实际需要身份比较时被要求（见 C-4d.*）
  //    ★ E-3：子字段**可独立缺失**，以便表达"只缺一个"
  identity? : {
    sourceIdentity?              : string;   // 非空标识
    designatedAuthorityIdentity? : string;   // 非空标识
  };

  // ── 诊断属性（轴 2；独立报告，不参与轴 1；可选提供）
  observed? : {
    ownership?      : "single" | "multi" | "undefined";
    l4Deprecation?  : "deprecated" | "active";   // ★ E-1：L4 **原始层属性**（非规范化布尔）
    reachability?   : "WIRED" | "TEST_ONLY" | "UNREACHABLE";
  };
}
★ ★ `l5Evaluation` **结构本身**缺失 ≠ `{ status: "not_evaluated" }`（D-1 + C-4e.*）。
★ ★ `l4Deprecation` 是**输入层的原始状态**；`deprecated` 是**规范化后的诊断事实** ⇒
    两者**不得混用**（E-1 约束 1）；映射由**判定器**在通过合法性检查后执行（E-1 约束 2）。
★ `observed` 中**合法省略**的属性 ⇒ 输出列入 `notEvaluated`（C-8.7）；**不得**默认补值。

────────── 【诊断事实的分离表示（P0-1 裁定 + E-2 分情况适用）】 ──────────
type DiagnosticAttributeKey = "ownership" | "deprecated" | "competing" | "reachability";

interface DiagnosticFacts {
  knownFacts : {                      // ★ 只包含【已经确定、有效、可安全报告】的事实
    ownership?    : "single" | "multi" | "undefined";
    deprecated?   : true | false;     // ★ 由 `l4Deprecation` 规范化而来（E-1）
    competing?    : "NONE" | "IDENTIFIED" | "UNCLEAR";
    reachability? : "WIRED" | "TEST_ONLY" | "UNREACHABLE";
  };
  notEvaluated : DiagnosticAttributeKey[];   // ★ 只列出【确实尚未评估】的属性
}
★ 不变式 I-1：同一属性**不得**同时出现在 `knownFacts` 与 `notEvaluated`。
★ 不变式 I-2（E-2 修订后的精确表述）：
    · **合法可选属性被「有意省略」** ⇒ 列入 `notEvaluated`（这是【正常】的未评估表达）
    · **字段缺失属必需结构缺失** ⇒ 报 IE-1（**不得**列入 `notEvaluated`）
    · **字段值非法** ⇒ 报 IE-2（**不得**列入 `notEvaluated`）
    ⇒ 即："未评估"只能来自【契约允许的可选输入被省略】，
      **不得**由"必需字段缺失"或"非法值"自动转换而来。
★ 不变式 I-3（E-2 修订后的**适用范围**）：
    · **仅** `decision` 与 `precondition_failed` 分支**必须**满足"两态完整性"
      （每个诊断属性恰好处于 `knownFacts` 或 `notEvaluated` 之一）
    · `input_error` 分支**不声称**满足该不变式（见 I-4）
★ 不变式 I-4（E-2）：
    `input_error` 时 ——
    · `facts` **只保留**其他**已确认且有效**的事实；
    · **出错字段**由既定的 `reason` + `field` 表达，**不进入** `knownFacts`，**也不进入** `notEvaluated`；
    · **因该错误输入而无法确定的事实**（例：整个必需 `l5Evaluation` 缺失 ⇒ 无法派生 `competing`）
      同样**不进入**这两个集合，其"不可确定的原因"由 `reason` + `field` 承载
      ⇒ ★ **不得**把无法派生的事实塞进 `notEvaluated` 以掩盖输入错误。
★ 不变式 I-5：`ownership = "undefined"` 是**既有业务取值**，
   必须与"字段缺失"以及"`NOT_EVALUATED`"三者**可区分**。
★ 说明：「`NOT_EVALUATED`」是 `notEvaluated[]` 中出现的语义（= 未评估），
   而不是 `knownFacts` 的取值；`knownFacts` 只承载已确定值。

────────── 【输出（A-3 三类结果 + P0-2 必填字段）】 ──────────
type LegalityResult =
  | { kind: "decision";
      decision : "LEGAL" | "ILLEGAL" | "AMBIGUOUS";
      facts    : DiagnosticFacts }
  | { kind: "precondition_failed";
      state    : "INVALID";
      facts    : DiagnosticFacts }
  | { kind: "input_error";
      reason   : InputErrorReason;     // ★ 必填，可独立区分全部子类（P0-2）
      field    : FieldPath;            // ★ **必填**
      facts    : DiagnosticFacts };    // ★ 保留已确认事实（P0-1 + I-4）
★ 纯判定函数**不以异常作为正常判定失败的传输方式**（A-3）。
★ `INVALID` 是【独立前置状态】，不并入三值 Decision（A-3 + rev6 L118 / C-5.2）。
```

---

## §4 行为契约

> 本章为**规范的行为要求**，逐条对应 N1–N9。凡规范未定义者，本契约**不补充**，改列 §7 开放问题。

### §4.1 节点类别与优先级（N1）

```text
要求 C-1.1：六个维度归类为三类节点，分类固定为：
    L1 Presence〔GATE〕· L2 Ownership〔ASSESSMENT〕· L3 Contract Permission〔GATE〕·
    L4 Deprecation〔ASSESSMENT〕· L5 Competition / Authority Resolution〔RESOLVER〕·
    L6 Slice Dependency Legality〔GATE〕
要求 C-1.2：GATE 类节点（L1 / L3 / L6）承担【可终止的阻断判定】，
            其判定顺序必须【一致地先于】RESOLVER（L5）的消解尝试。
            ⇒ 不得出现「同类 GATE 之中，一个先于 RESOLVER、另一个后于 RESOLVER」。
要求 C-1.3：ASSESSMENT 类节点（L2 / L4）**不影响** Decision 的取值。
```

### §4.2 L3 / L6 许可维度差异（N2）

```text
要求 C-2.1：L3 = 【契约维度】的许可 · L6 = 【当前审查范围维度】的许可（同为 GATE，维度不同）。
要求 C-2.2：二者【各自独立】参与短路判定（R2 与 R4），
            不得合并为单一"许可"布尔值，也不得由一方推导另一方。
```

### §4.3 L5 职责限定（N3）

```text
要求 C-3.1：L5（RESOLVER）**不承担阻断职责**。
要求 C-3.2：L5 = `EXISTS_BUT_AUTHORITY_UNCLEAR`（`UNCLEAR`）时，
            **不得遮蔽** GATE 类节点的 `deny`。
```

### §4.4 两阶段处理 + 确定性短路顺序（N4 + D-1 + B-1 + B-2 + E-3）

```text
★★ 依 AUTH-20 §0 D-1：本契约明确区分【输入有效性阶段】与【判定阶段】，
   且**输入有效性优先于 R1–R6 的判定**。
★★ 依 AUTH-21 E-3：**阶段之间**按 S1→S2→S3→S4；**阶段内部**按下方固定字段顺序
   取第一个错误 ⇒ 同一输入必然产生**唯一** `reason` + `field`。

### §4.4a 第一阶段 · 输入有效性（Input Validity）—— 先于 R1–R6

要求 C-4a.1：本阶段按**确定性顺序** S1 → S2 → S3 → S4 执行（阶段间）；
             **每一阶段内部再按下方固定字段顺序检查**；
             **首个命中的错误即为最终结果**（不得由实现方自行选择，承 D-1 + E-3）。

  S1 · 无条件必需【字段与结构】的存在性（阶段内顺序固定）：
      1. `presence`
      2. `contractPermission`
      3. `sliceDependencyLegality`
      4. `l5Evaluation`（**结构**必须存在；其值可为 `not_evaluated`）
      ⇒ 首个缺失项 ⇒ `input_error` / **IE-1**（`required_input_missing`），`field` = 该字段路径

  S2 · 无条件必需字段的【定义域】（阶段内顺序固定）：
      1. `presence` ∈ {true,false}
      2. `contractPermission` ∈ {deny,allow,unspecified}
      3. `sliceDependencyLegality` ∈ {deny,allow}
      ⇒ 首个超域项 ⇒ `input_error` / **IE-2**（`value_out_of_domain`），`field` = 该字段路径

  S3 · `l5Evaluation` 的【结构合法性】（阶段内单项）：
      1. `l5Evaluation`
         · `status` 必须 ∈ {`evaluated`, `not_evaluated`}
         · 当 `status = evaluated` 时，`value` 必须在定义域
           {`NONE`, `EXISTS_AND_AUTHORITY_IDENTIFIED`, `EXISTS_BUT_AUTHORITY_UNCLEAR`}
      ⇒ 违反 ⇒ `input_error` / **IE-2**，`field` = `"l5Evaluation"`

  S4 · 【已提供】的可选值之定义域（阶段内顺序固定）：
      1. `observed.ownership`      ∈ {single, multi, undefined}
      2. `observed.l4Deprecation`  ∈ {deprecated, active}
      3. `observed.reachability`   ∈ {WIRED, TEST_ONLY, UNREACHABLE}
      4. `identity.sourceIdentity`（若该键**已提供**）：必须为**非空字符串**
      5. `identity.designatedAuthorityIdentity`（若该键**已提供**）：必须为**非空字符串**
      ⇒ 首个超域/违规项 ⇒ `input_error` / **IE-2**，`field` = 该字段路径

  ★ 多错误并存时：
      · **阶段之间**：严格按 S1 → S2 → S3 → S4 取首个命中的阶段；
      · **阶段内部**：严格按该阶段的上述字段顺序取首个。
      ⇒ 二者共同保证**唯一结果**（确定性，无实现自由度）。
  ★ 本阶段的豁免范围（承 D-1）：
      · 【不】要求 `l5Evaluation.status = evaluated`（只要求结构存在）
      · 【不】要求 `identity`（或其子字段）必须提供
    ⇒ 即：**早期规则终止后不得强制获取 L5 评估或身份值**；
      但**不得**因此豁免【无条件必需字段】的校验。

### §4.4b 第二阶段 · 判定（Decision Resolution）—— 仅对【通过第一阶段的有效输入】

要求 C-4b.1：严格按【确定性短路顺序】执行，首个命中即为最终 SoT Decision：

    R1  L1 Presence = false                        ⇒ INVALID（前置状态，不入三值枚举）
    R2  L3 Contract Permission = deny              ⇒ ILLEGAL
    R4  L6 Slice Dependency Legality = deny        ⇒ ILLEGAL
    R3  L5 = EXISTS_BUT_AUTHORITY_UNCLEAR          ⇒ AMBIGUOUS
    R5  L5 = EXISTS_AND_AUTHORITY_IDENTIFIED
        且当前来源【非】被指定的权威                ⇒ ILLEGAL（as-SoT）
    R6  以上皆未命中，且（L5 = NONE，或当前来源即被指定权威） ⇒ LEGAL

要求 C-4b.2：顺序必须【严格】为 R1 → R2 → R4 → R3 → R5 → R6
            （注意：R4 在 R3 之前 —— rev6 的语义变更点）。
要求 C-4b.3：实现必须为【确定性】的：同一组输入恒得同一输出，无随机、无副作用。

### §4.4c 第一阶段的预期结果示例（承 D-1，逐条）

| 输入情况                                          | 预期结果                                          |
|--------------------------------------------------|--------------------------------------------------|
| `L1 = false`，且 `L3` 缺失                          | `input_error` / **IE-1**                         |
| `L1 = false`，且 `L3` 超出定义域                     | `input_error` / **IE-2**                         |
| 无条件必需输入全部有效，且 `L1 = false`                | `precondition_failed` / **INVALID**              |
| `L6 = deny`，且 `l5Evaluation = { status:"not_evaluated" }` | `decision` / **ILLEGAL**，`competing = NOT_EVALUATED` |
| `L6 = deny`，但整个 `l5Evaluation` **结构缺失**        | `input_error` / **IE-1**                         |

### §4.4d 身份比较前提与执行条件（B-1 · P0-4 · E-3）

要求 C-4d.1（精确条件）：
    「**仅当** `l5Evaluation.status = evaluated` 且其 `value = EXISTS_AND_AUTHORITY_IDENTIFIED`，
      **并且**判定流程到达需要执行 R5/R6 身份比较的分支时，
      才要求并比较 `identity.sourceIdentity` 与 `identity.designatedAuthorityIdentity`。
      ★ **若 `L5 = NONE`，R6 可直接成立，不需要身份比较，也不得要求身份值。**」
    ★ 澄清：R5/R6 **不等价于**「L5 已识别」—— R6 的另一条路径是 `L5 = NONE`。

要求 C-4d.2：比较规则 = 标识值【精确相等性】比较。
要求 C-4d.3：判定器**不**负责：身份发现 / DB 查找 / 别名解析 / 身份规范化（B-1）。

★ 要求 C-4d.4（**E-3 修订** · 条件式错误的唯一顺序与身份三种结果）：
    需要身份比较而身份不可用时，按**固定顺序**取首个：
      ① **IE-3(a)** `l5_evaluation_required_but_not_evaluated`
         （先判"L5 必要评估是否完成"）
      ② **IE-3(b1)** `source_identity_missing`
      ③ **IE-3(b2)** `designated_authority_identity_missing`

    身份三种结果（明确）：
      · **整个 `identity` 对象缺失**且需要比较 ⇒ 按上述顺序 ⇒ **IE-3(b1)**
        （`sourceIdentity` 的检查顺序在 `designatedAuthorityIdentity` 之前）
      · **仅缺 `sourceIdentity`** ⇒ IE-3(b1)
      · **仅缺 `designatedAuthorityIdentity`** ⇒ IE-3(b2)
      · **已提供但为空字符串/非字符串** ⇒ 属 **S4** 的 **IE-2**（**不是** IE-3）

    ★ **不得越级**：若更高优先级的错误已成立（如 S1–S4 的 IE-1 / IE-2，
      或 IE-3(a)），**必须**先返回该错误，不得返回更低优先级的 IE-3(b1)/(b2)。
    ★ **不得**猜测身份，**不得**用 `AMBIGUOUS` / `LEGAL` / `INVALID` 代替。

要求 C-4d.5：输入结构必须能表达以下四种情况（P0-4；E-3 使子字段可独立缺失）：
    ① R1 / R2 / R4 已终止 ⇒ 两个身份值**未提供**（合法）
    ② `L5 = NONE` ⇒ 直接走 R6 ⇒ **未提供**身份值（合法）
    ③ `L5 = IDENTIFIED` 且到达比较分支 ⇒ 两个身份值**均存在**
    ④ 实际需要比较但缺任一身份值 ⇒ 明确 `input_error`（IE-3(b1)/(b2)），不猜测

### §4.4e L5 条件式必需性的执行点（B-2）

要求 C-4e.1：`l5Evaluation` 的【结构】属无条件必需（S1）；
            其【值为 `evaluated`】为**条件式必需**——仅当流程必须继续区分 R3/R5/R6 时。
要求 C-4e.2：若流程到达 R3/R5/R6 而 `l5Evaluation.status = not_evaluated`
            ⇒ `input_error` / **IE-3(a)** `l5_evaluation_required_but_not_evaluated`；
            **不得**转为 `AMBIGUOUS` / `LEGAL` / `ILLEGAL` / `INVALID`。
要求 C-4e.3：R1 / R2 / R4 已终止 ⇒ **不**因该次决策强制补算 L5；
            已评估则保留其诊断事实（映射为 `competing`，见 C-8.2）。
```

### §4.5 SoT Decision 三值规范语义（N5）

```text
要求 C-5.1：三值语义（实现必须完整搬运，不得改写）：
    LEGAL     = 依据本规则及【当前审查范围】，允许该来源作为所审查语义的权威来源。
    ILLEGAL   = 不允许。
                ★ 依 rev6：**不得扩张为「所有场景均非法」**（当前范围限定）。
    AMBIGUOUS = 事实不足以确定，须人工裁定；既不许可也不禁止。
要求 C-5.2：INVALID 是【未满足前置条件】的表示，
            **不是第四种合法性结论**；不得并入三值枚举。
```

### §4.6 轴分离不变量 INV-AXIS-1（N6）· **已逐字核实**

```text
★ rev6 §3.1 原文（L137–L142，逐字）：
     ① 轴 1（SoT Decision）的短路决策：【只】决定最终结论。
     ② 轴 2（Runtime Attributes）【独立】报告诊断事实。
     ③ 轴 1 的短路决策【不得】删除、覆盖或降低轴 2 已确定的诊断事实。
     ④ 轴 2 的属性【不得】反向改变轴 1 的决策。
     ⇒ 例：L6 = deny 且 L5 = UNCLEAR 时 ⇒ 轴 1 = ILLEGAL；轴 2 仍保留 competing = UNCLEAR。

要求 C-6.1：逐条对应实现：C-6.1a ↔ ① · C-6.1b ↔ ② · C-6.2 ↔ ③ · C-6.3 ↔ ④
要求 C-6.4：必须实现原文示例：L6 = deny 且 L5 = UNCLEAR ⇒ 轴 1 = ILLEGAL 且
            轴 2 保留 competing = UNCLEAR。
★ 要求 C-6.5（P0-1 关联）：③ 的"已确定的诊断事实"**必须**能通过结果接口传递
   （`knownFacts`）；对 `decision` 与 `precondition_failed` 同样适用（不变式 I-3）；
   对 `input_error` 则按 I-4（只保留其他已确认事实）。
```

### §4.6a 两轴独立性与完整性（N8）· **已逐字核实**

```text
★ rev6 §4 原文（L216–L221，逐字）：
      ① 轴 1 与轴 2 【相互独立】—— 轴 2 不参与、不覆盖轴 1；轴 1 不删减、不降级轴 2。
      ② 轴 1 的短路决策【不减少】轴 2 的记录：即使轴 1 = ILLEGAL，
         轴 2 中已确定的诊断事实（如 competing = UNCLEAR、reachability = TEST_ONLY）仍完整保留。
      ③ 反向亦然：保留或补充轴 2 的诊断属性，【不得改变】轴 1 的决策。
      ⇒ 设计意图：既不让「权威归属不明确」遮蔽「硬性禁止」，也不丢失该事实本身。

要求 C-8a.1：上述三条须逐条实现，且与 C-6.1…C-6.5 保持一致。
```

### §4.7 CF-2：`unspecified ≠ allow`（N7）

```text
要求 C-7.1：`unspecified` 本身**既不构成明确许可，也不构成阻断**；
            不得自动并入 `missing` / `unknown` / `unavailable`。
要求 C-7.2：若最终结论为 LEGAL，**不得**解释为"L3 已提供明确许可"。
要求 C-7.3：若判定路径显示 `unspecified`，不得据此短路为 allow 路径。
要求 C-7.4：`unspecified` 不命中 R2 后，继续执行【剩余适用的判定规则】；
            剩余规则 = 按既定顺序的 R4 → R3 → R5 → R6（【规则编号】，非层编号），
            **不含 L4**（L4 为 ASSESSMENT，仅作属性记录）。★ 依据：rev6 §2 · L154–L158。
要求 C-7.5：`unspecified` 不阻断后流程【会继续到达 R3/R5/R6】⇒ 此时 **L5 必须为 `evaluated`**；
            若为 `not_evaluated` ⇒ IE-3(a) 输入错误（见 C-4e.2 / §5.3）。
            ⇒ 即：`unspecified` 的存在【不】豁免 L5 的必要评估。
```

### §4.8 轴 2 属性域 / 诊断事实 / L4 映射（N8 + B-2 + A-4 + P0-1 + E-1 + E-2）

```text
★ rev6 §4 原文（L211–L214，逐字）—— 轴 2 取值域：
     ownership     = single | multi | undefined | NOT_EVALUATED
     deprecated    = true | false | NOT_EVALUATED
     competing     = NONE | IDENTIFIED | UNCLEAR | NOT_EVALUATED
     reachability  = WIRED | TEST_ONLY | UNREACHABLE | NOT_EVALUATED

要求 C-8.1：实现必须接受上述四类属性的完整取值域（含 `NOT_EVALUATED`）。
★ 要求 C-8.1a（P0-1）：在结果接口中，`NOT_EVALUATED` **不出现于** `knownFacts` 的取值域；
    未评估由 `notEvaluated[]`（受约束键列表）表达（不变式 I-1 / I-2）。

要求 C-8.2：`L5 → competing` 映射（rev6 §4 L225–L233 逐字）：
    NONE → NONE · EXISTS_AND_AUTHORITY_IDENTIFIED → IDENTIFIED ·
    EXISTS_BUT_AUTHORITY_UNCLEAR → UNCLEAR
    ★ `competing = IDENTIFIED` 仅表示【竞争来源已被识别】，
      **不等同于**「当前来源是权威」；不得由轴 2 的 `IDENTIFIED` 反推 R5/R6。

★ 要求 C-8.2a（B-2 · `competing` 的派生角色）：
    `competing` 是【由 L5 状态映射得到的轴 2 诊断输出】，
    **不是**另一个可反向覆盖 L5、或改变轴 1 决策的独立输入。
    ⇒ 实现不得接受外部传入的 `competing` 作为判定输入，也不得由其反推 L5 或 Decision。

要求 C-8.3：已知事实 vs 未评估事实（rev6 §4 L235–L240 逐字要义）：
    · 轴 1 短路后【必须保留】的是【已经获得、已经确定】的诊断事实
    · 轴 1 短路【不要求】继续执行全部昂贵或不适用的诊断计算
    · 【不得】把【尚未评估】的属性伪造成"已确定值"
    · 未评估的属性应显式标记为【未评估】

要求 C-8.4：`NOT_EVALUATED` 的规范语义与四条边界（rev6 §4 L244–L258 逐字）：
    ① 表示【评估状态】，不是业务结论
    ② `ownership = undefined` 与 `ownership = NOT_EVALUATED` **必须可区分**；
       两者**不得互相转换或合并**
    ③ 诊断短路时【保留已知事实】、但【不强制补算】全部属性：
         已知 L6=deny · L5 已评估为 UNCLEAR ⇒ Decision = ILLEGAL，competing = UNCLEAR
         已知 L6=deny · L5 尚未评估         ⇒ Decision = ILLEGAL，competing = NOT_EVALUATED
       ★ 限制：若流程【必须】依赖 L5 才能区分 R3/R5/R6，则不得以 `NOT_EVALUATED` 代替必要评估
    ④ `NOT_EVALUATED` **不得反向影响轴 1**
    ★ 且 `NOT_EVALUATED` **不是**「必要决策输入缺失」的通用豁免

★ 要求 C-8.5（B-2 · L5 条件式必需性）：
    · R1 / R2 / R4 已终止 ⇒ 不强制补算 L5；此时可为 `not_evaluated`，
      且 `competing ∈ notEvaluated`
    · L5 已评估 ⇒ **必须保留**其诊断事实（映射入 `knownFacts.competing`）
    · 流程须继续区分 R3/R5/R6 而仍 `not_evaluated` ⇒ IE-3(a)（见 C-4e.2）

★ 要求 C-8.6（**E-1 修订** · L4 → 轴 2 `deprecated` 的规范化映射 · 责任归【判定器】）：
    输入层：`observed.l4Deprecation? : "deprecated" | "active"`（**L4 的原始层属性**）
    输出层：`knownFacts.deprecated : true | false`（**规范化后的诊断事实**）

    确定性映射表：
    ┌──────────────────────────────────┬──────────────────────────┬────────────────────────┐
    │ 输入                              │ `knownFacts.deprecated`  │ `notEvaluated`         │
    ├──────────────────────────────────┼──────────────────────────┼────────────────────────┤
    │ `"deprecated"`                    │ `true`                   │ 不包含 `deprecated`     │
    │ `"active"`                        │ `false`                  │ 不包含 `deprecated`     │
    │ 属性**有意省略**（合法可选输入）    │ 不包含 `deprecated`       │ **包含** `deprecated`   │
    │ 属性存在但**值非法**               │ 不产生该字段的有效事实      │ **不得**将错误伪装成未评估 │
    └──────────────────────────────────┴──────────────────────────┴────────────────────────┘

    ★ 约束 1：`l4Deprecation`（输入原始状态）与 `deprecated`（规范化事实）**不得混用**。
    ★ 约束 2：该映射**只能**在输入通过相应合法性检查（S4 对 `observed.l4Deprecation`）**之后**执行。
    ★ 约束 3：§3.6.3 · §4.4a S4 · 本 C-8.6 · §5.2 D · §6.4 T-6 **必须使用同一套定义**。
    ★ 约束 4：该映射**仅用于诊断属性表达**，**不参与** Decision 判定，
      不得据其推导 `LEGAL` / `ILLEGAL`；**不得**扩大为其他未定义的业务规则。

★ 要求 C-8.7（**E-2 修订** · 诊断事实完整性不变式的**分情况适用**）：

    ┌──────────────────────┬──────────────────────────────────────────────────────┐
    │ Result 情况           │ `facts` 规则                                          │
    ├──────────────────────┼──────────────────────────────────────────────────────┤
    │ `decision`           │ 每个诊断属性**恰好**处于 `knownFacts` 或 `notEvaluated` 之一 │
    │ `precondition_failed`│ 每个诊断属性**恰好**处于 `knownFacts` 或 `notEvaluated` 之一 │
    │ `input_error`        │ **只保留**其他已确认且有效的事实；出错字段及**因该错误无法确定的事实**   │
    │                      │ **不进入**这两个集合                                      │
    └──────────────────────┴──────────────────────────────────────────────────────┘

    对 `input_error` 的具体约束（承 E-2）：
      · **出错字段**由既定的 `reason` 与 `field` 表达；
      · **因错误输入而无法确定的事实**，**不得**伪装成已知事实，也**不得**伪装成正常的未评估事实；
      · 例如：整个必需的 `l5Evaluation` 缺失（`reason = required_input_missing`、
        `field = "l5Evaluation"`）⇒ **不能**把无法派生的 `competing` 塞入 `notEvaluated`
        来掩盖输入错误；
      · **合法可选属性被有意省略**、**必需字段缺失**、**字段值非法** 三者必须**严格区分**
        （分别对应：`notEvaluated` / IE-1 / IE-2）；
      · 不得借此改变既有 Result 分类、`reason` 枚举、`field` 必填要求或已裁定的 L5 条件规则。

    ★ 不变式 I-3 的适用范围**仅**为 `decision` 与 `precondition_failed`；
      `input_error` 分支由 I-4 规范（**不声称**两态完整性）。
```

### §4.9 命名与引用纪律（N9）

```text
要求 C-9.1：不得以裸 `LEGAL` / `ILLEGAL` / `AMBIGUOUS` / `GATE` / `RESOLVER`
            作为全局标识符或类型名 ⇒ 须采用可消歧前缀（如 `R6Err*` / `SotLegality*`）。
要求 C-9.2：代码注释引用规则时使用 `R1`–`R6`；引用外部审计记录章节时
            必须带文档标识与章节符号（如 `H-2 §R1`）。
★ 实测同类冲突词（§3.3）：`LEGAL`(36) · `AMBIGUOUS`(23) · `GATE`(273) · `RESOLVER`(62)。
```

---

## §5 输入、输出与边界条件

### §5.1 输入的规范界定与收窄（R-2）

```text
【检查对象】四类载体之一（v1.1 §2 逐字）：
    domain 类型字段 · Repository accessor · application 语义入口 · DB projection
【检查】仅一个问题：该来源是否具有【合法语义权威】
【明确排除（一律出界）】：代码质量 · 性能 · API 好用度 · 是否有测试 ·
    是否 reachable · 是否该删除 · 是否该重构 · 个人编码偏好

★ 依 AUTH-18 §3 收窄：判定器**只接收【已确定的判定输入】**。
  以下能力**明确不在默认实施范围**：
    ❌ 资料抓取或文件发现    ❌ 语义来源自动识别
    ❌ L1–L6 属性的自动采集或抽取    ❌ 自动访问数据库以推断缺失属性
    ❌ 跨来源的自动权威消解    ❌ 身份发现 / 别名解析 / 身份规范化
    ❌ rev6 未定义的额外业务规则
★ 但：**L4 原始状态 → 轴 2 `deprecated` 的规范化映射属【判定器】职责**（E-1），
  不属于上述被排除的"属性采集"。
```

### §5.2 输入契约（rev5 · D-1 两阶段 · B-1 身份 · B-2 L5 · A-4/E-1 L4 · E-3 顺序）

```text
★ 权威来源：rev6 §3.1 与 §4 的【已生效】规范文本（本表为搬运，非新规范）；
  接口形状依 AUTH-19 / AUTH-20 / AUTH-21 的裁定（**接口与错误处理设计**）。

【A. 无条件必需（缺 ⇒ IE-1；超域 ⇒ IE-2）】
    L1 presence              ∈ { true, false }
    L3 contractPermission    ∈ { deny, allow, unspecified }
    L6 sliceDependencyLegality ∈ { deny, allow }

【B. 无条件必需【结构】；值为条件式必需（D-1）】
    l5Evaluation : 显式评估状态
        · 结构必须存在（缺失 ⇒ IE-1）
        · status ∈ { evaluated, not_evaluated }
        · status = evaluated 时 value ∈ { NONE,
                                          EXISTS_AND_AUTHORITY_IDENTIFIED,
                                          EXISTS_BUT_AUTHORITY_UNCLEAR }
    ★ ★ 整个字段缺失 ≠ `{ status: "not_evaluated" }`：
        前者是缺少输入结构（IE-1）；后者是**合法的未评估状态**。
    ★ 值的"必须已评估"为【条件式必需】——仅当流程须继续区分 R3/R5/R6 时要求（C-4e.1）。

【C. 条件式必需：身份比较（B-1 · P0-4 · E-3）】
    identity.sourceIdentity?              : 非空字符串（子字段**可独立缺失**）
    identity.designatedAuthorityIdentity? : 非空字符串（子字段**可独立缺失**）
    ★ 触发条件（精确）：仅当 `l5Evaluation.status = evaluated` 且
      `value = EXISTS_AND_AUTHORITY_IDENTIFIED`，**并且**流程到达需执行 R5/R6 身份比较的分支时。
    ★ `L5 = NONE` ⇒ R6 可直接成立 ⇒ **不需要**身份比较（也不得要求身份值）。
    ★ 结果分派：整个 identity 缺失或仅缺 sourceIdentity ⇒ IE-3(b1)；
      仅缺 designatedAuthorityIdentity ⇒ IE-3(b2)；
      已提供但为空/非字符串 ⇒ **S4 的 IE-2**（承 E-3）。

【D. 诊断属性（轴 2；独立报告；**可选提供**）】
    observed.ownership?      ∈ { single, multi, undefined }
    observed.l4Deprecation?  ∈ { deprecated, active }   ★ E-1：**L4 原始层属性**（非布尔）
    observed.reachability?   ∈ { WIRED, TEST_ONLY, UNREACHABLE }
    ★ `competing` **不是**输入，而是由 L5 状态【派生】的输出（C-8.2 / C-8.2a）。
    ★ **合法省略**（有意不提供）⇒ 输出列入 `notEvaluated`（**不得**默认补值）。
    ★ 映射归属：`l4Deprecation` → `knownFacts.deprecated` 由**判定器**执行（C-8.6 / E-1）。

★ 修正记录：
    rev1 → rev2：补齐 `NOT_EVALUATED`；`deprecated` 以 rev6 原文为准
    rev2 → rev3：L5 改条件式必需；新增身份比较输入；新增 L4 映射；competing 明确为派生
    rev3 → rev4：明确两阶段与"校验优先"（D-1）；l5Evaluation 结构必需性区分；
                身份触发条件精确化；身份"非法"（IE-2）与"缺失"（IE-3）分离；
                诊断属性输入 `observed` + 输出 `knownFacts + notEvaluated[]`（P0-1）
    rev4 → rev5（E-1/E-2/E-3）：
      ① **E-1**：输入改为 `observed.l4Deprecation`（L4 原始状态），
         映射责任明确归【判定器】，并给出四行确定性映射表；
      ② **E-2**：不变式 I-2 / I-3 / I-4 精确化，C-8.7 改为**分情况适用**表
         （`decision` / `precondition_failed` 适用两态完整性；`input_error` 不适用）；
      ③ **E-3**：补齐 S1–S4 **阶段内**字段顺序 + IE-3 条件式唯一顺序 +
         身份三种结果 + `identity` 子字段可独立缺失。
```

### §5.3 错误分类与字段契约（rev5 · D-2 + P0-2 + E-3）

```text
★ 错误族与具体原因**不合并**，且必须能从结果本身识别（D-2 / P0-2）。

【错误族】
    IE-1  `required_input_missing`      无条件必需字段或结构缺失
    IE-2  `value_out_of_domain`         值超出【已生效定义域】（含身份字段非空标识违规）
    IE-3  `branch_input_missing`        【条件分支所需输入或评估状态未满足】

【完整映射表（P0-2 / E-3）】
┌─────────┬─────────────────────────────────────────────┬───────────────────────────────┬──────────────────────────────┐
│ 编号     │ reason 标识（机器可识别）                      │ 触发条件                        │ field（必填结构化路径）示例      │
├─────────┼─────────────────────────────────────────────┼───────────────────────────────┼──────────────────────────────┤
│ IE-1    │ `required_input_missing`                     │ S1：无条件必需字段/结构缺失        │ "presence" · "contractPermission"│
│         │                                             │                               │ · "sliceDependencyLegality"   │
│         │                                             │                               │ · "l5Evaluation"              │
│ IE-2    │ `value_out_of_domain`                        │ S2 / S3 / S4：值超域             │ S2/S3 同 IE-1 的字段；          │
│         │                                             │ （含身份标识为空/非法）            │ S4："observed.ownership" ·      │
│         │                                             │                               │ "observed.l4Deprecation" ·     │
│         │                                             │                               │ "observed.reachability" ·      │
│         │                                             │                               │ "identity.sourceIdentity" ·    │
│         │                                             │                               │ "identity.designatedAuthority…"│
│ IE-3(a) │ `l5_evaluation_required_but_not_evaluated`   │ 流程须继续而 l5Evaluation.status │ "l5Evaluation"                │
│         │                                             │ = not_evaluated               │                               │
│ IE-3(b1)│ `source_identity_missing`                    │ 需身份比较而缺 sourceIdentity    │ "identity.sourceIdentity"     │
│ IE-3(b2)│ `designated_authority_identity_missing`      │ 需身份比较而缺 designated…       │ "identity.designatedAuthority…"│
└─────────┴─────────────────────────────────────────────┴───────────────────────────────┴──────────────────────────────┘

★ **唯一性保证（E-3）**：同一输入必然产生**唯一**的 `reason` + `field`，因为
    · 阶段之间：S1 → S2 → S3 → S4 固定顺序；
    · 阶段内部：§4.4a 规定的字段顺序固定；
    · 条件式（IE-3）：IE-3(a) → IE-3(b1) → IE-3(b2) 固定顺序；
    · 且**不得越级**（高优先级错误先返回）。
★ `reason` **必须**为具体子类标识（不是顶层 IE 编号），**不得**要求调用者依据 `field` 反推原因。
★ `field` **必填**（`FieldPath`）；整体结构错误使用契约定义的根路径（如 `"l5Evaluation"`）。
★ `InputErrorReason` 的取值集合 = 上表全部 reason 标识（5 个）。

【`input_error` 时的 `facts` 规则（E-2 · I-4）】
    · **只保留**其他已确认且有效的事实；
    · **出错字段**与**因该错误无法确定的事实**均**不进入** `knownFacts` / `notEvaluated`；
    · 其"不可确定的原因"由 `reason` + `field` 承载。

【不可混同的关系（必须同时满足）】
    · `NOT_EVALUATED`（= `notEvaluated[]` 中的项）≠ 字段缺失 ≠ 非法值 ≠ INVALID
    · 「合法可选属性**有意省略**」≠「必需字段**缺失**」≠「字段**值非法**」
      （分别对应 `notEvaluated` / IE-1 / IE-2）
    · `ownership = "undefined"`（既有业务取值）≠ 缺失 ≠ `NOT_EVALUATED`
    · `INVALID`（R1 命中的前置失败）**不是**输入错误
```

### §5.4 跨次判定状态 = **明确非目标**（R-4）

```text
★ 以下事项明确列为本契约的【非目标】：
    N-1 跨次判定持久化 · N-2 缓存及失效 · N-3 多轮结果自动合并 ·
    N-4 历史状态推导 · N-5 多次判定冲突后的自动裁决
★ 对应稳定编号 OI-6 的状态为【已明确列为非目标】。
★ 本项**不得**用于削弱单次判定契约（见 §5.7）。
```

### §5.5 确定性要求

```text
· 同一（有效）输入恒得同一（唯一）输出；
  **错误结果亦具确定性**：阶段间 S1→S4 + 阶段内固定字段顺序 + IE-3 固定顺序
  ⇒ 任一输入组合必然产生唯一的 `reason` 与 `field`（§4.4a / §4.4d / §5.3）
· 判定过程不得产生副作用（不得写库、不得改状态、不得访问网络/文件）
· 轴 2 的报告必须完整（`decision` / `precondition_failed` 适用两态完整性 I-3；
  `input_error` 适用 I-4）
```

### §5.6 输出（单次判定 · A-2 / A-3 / P0-1）

```text
★ A-2 裁定：初始实现**只提供纯函数出口**（纯判定函数 + 输入/输出类型），
  经 `domain/index.ts` 按现有惯例导出。不接入 CLI / agent tool / 服务 /
  Repository API / 现有业务调用链；不虚构调用者或输出消费者。

接口形状（rev5）：
    export function adjudicateLegality(input: LegalityInput): LegalityResult
    · `LegalityResult` = 三类之一（§3.6.3），**每类均携带 `facts: DiagnosticFacts`**
★ 输出消费者的【规范定义】不存在（实测亦无代码消费者，§3.6 AF-6）⇒ 依 A-2 不接入。
```

### §5.7 单次判定契约的完整性与三类结果（R-4 + A-3 + P0-1 / P0-2 + E-1…E-3）

```text
★ 非目标声明不得削弱单次判定契约。单次判定仍必须明确：
    (a) 输入结构及字段合法性              → §5.2 / §5.3
    (b) **两阶段处理**（输入有效性优先）    → §4.4a / §4.4b（D-1）
    (c) 确定性短路顺序                    → §4.4b
    (d) Decision 与 Runtime Attributes 的分离 → §4.6 / §4.6a
    (e) 已确定诊断事实的保留（分情况）      → §4.8 C-8.7 + I-3 / I-4（E-2）
    (f) `NOT_EVALUATED` 的含义及边界       → §4.8 C-8.4 / C-8.1a
    (g) L5 的【条件式必需性】             → §4.4e / §4.8 C-8.5（B-2）
    (h) 身份比较所需的两个身份输入         → §4.4d（B-1 · P0-4 · E-3）
    (i) **三类结果必须可区分**（A-3）：
          R-1 正常判定：`kind:"decision"` + Decision + `facts`
          R-2 前置失败：`kind:"precondition_failed"` + `state:"INVALID"` + `facts`
          R-3 输入错误：`kind:"input_error"` + `reason`（5 个具体子类之一）
                        + **必填** `field` + `facts`
    (j) 错误传输形式：Result 联合体（不以异常作为正常判定失败的传输方式）
    (k) **错误的唯一性**：阶段间 + 阶段内 + 条件式三层固定顺序
        ⇒ 任一输入唯一确定 `reason` 与 `field`（E-3）
    (l) **L4 映射归属**：`l4Deprecation`（输入原始状态）→ `knownFacts.deprecated`（规范事实）
        由**判定器**在合法性检查后执行（E-1 · C-8.6）
```

---

## §6 测试设计与验收标准

> **本契约的测试设计为"待实现后执行"的规格，不声称任何测试已经执行或通过。**
> ★ 依 AUTH-21 §二：本授权**不允许执行测试**。

### §6.1 N1–N9 → 测试映射

| 规范 | 测试族 | 正常路径 | 边界 / 冲突 | 预期结果 |
|---|---|---|---|---|
| N1 | T-N1 | 三类节点分类正确；GATE 判定先于 RESOLVER | "L6=deny 且 L5=UNCLEAR" | R4 命中，`ILLEGAL`（不得被 L5 遮蔽） |
| N2 | T-N2 | L3 与 L6 独立参与 | L3=allow 且 L6=deny | R4 命中 ⇒ `ILLEGAL` |
| N3 | T-N3 | L5 不阻断 | L5=UNCLEAR 且任一 GATE=deny | 直接 `ILLEGAL`，不产出 `AMBIGUOUS` |
| N4 | T-N4 | 六条规则按序短路 | 逐条构造"仅第 k 条命中" | 结论与命中规则一致（k = R1…R6） |
| N5 | T-N5 | 三值语义边界 | `ILLEGAL` 的范围限定 | 与 rev6 §2 逐字一致 |
| N6 | T-N6 | 轴 1 / 轴 2 分离 | 轴 2 取极值不影响轴 1 | 轴 1 结论不变；轴 2 完整报告 |
| N7 | T-N7 | `unspecified` 行为 | L3=unspecified 且其余为 allow | 不得短路为 allow；继续 R4→R3→R5→R6；L5 必须已评估（C-7.5） |
| N8 | T-N8 | 四属性枚举含 `NOT_EVALUATED` | `NOT_EVALUATED` vs `ownership=undefined` | 可区分；不改轴 1（I-5） |
| N9 | T-N9 | 命名与引用纪律 | 静态检查无裸标识符 | 消歧命名生效 |
| B-1 | T-N10 | R5/R6 身份比较 | 相等 / 不相等 / 缺身份 | §6.4 T-1 / T-2 / T-14 / T-15 / T-19 / T-20 |
| B-2 | T-N11 | L5 条件式评估 | 不强制补算 / 必须评估 | §6.4 T-3 / T-4 / T-5 |
| A-4 / **E-1** | T-N12 | L4 映射（输入原始状态 → 输出布尔） | deprecated / active / 合法省略 | §6.4 **T-6（双侧 + 省略）** |
| A-3 | T-N13 | 三类结果可区分 | decision / precondition_failed / input_error | §6.4 T-7 / T-8 |
| P0-1 / **E-2** | T-N14 | 诊断事实分离与分情况不变式 | 两态完整性适用 vs 不适用 | §6.4 T-11 |
| P0-2 | T-N15 | 字段必填与原因可辨 | 每类错误均带 `field`；5 个子类可自辨 | §6.4 T-12 / T-17 |
| P0-3 / **E-3** | T-N16 | 两阶段与**阶段内**错误顺序 | 唯一结果（含多错误并存） | §6.4 T-13 / **T-18** |

### §6.2 §7.1 矩阵的回归使用 —— 权威性边界（AUTH-18 §7.2）

```text
★ rev6 §7.1 的 18 组矩阵（#1–#18）属 rev6 的 §7（兼容性影响），
  该章节**不在 N1–N9 的规范性生效范围内**。
⇒ 若以该矩阵作为回归用例候选，必须满足：
   ① 每组预期结果必须能由【已生效的 N1–N9】**独立推导**；
   ② 不得仅因矩阵文字而创造新的规范要求；
   ③ 若与 N1–N9 的可推导结果**冲突** ⇒ **记录并停止**，不得提升其权威。
★ 矩阵概要（仅定位）：#1–#6 L3=deny ⇒ R2 ⇒ ILLEGAL；
   #10/#16 R5 两分支（对应 T-N10）；#11/#17 变化组（AMBIGUOUS → ILLEGAL）。
```

### §6.3 验收标准

```text
A-1  行为契约 §4.1–§4.9 每条"要求"有对应实现点与测试
A-2  18 组矩阵逐组通过（每组结论可由 N1–N9 独立推导）；#11 / #17 结论为 ILLEGAL
A-3  轴分离不变量（C-6.1a/6.1b/6.2/6.3）有反向探针（mutation）证明
A-4  确定性：同一输入重复执行结果一致；无副作用
A-5  三类结果可区分：正常判定 / 前置失败（INVALID）/ 输入错误
A-6  命名消歧检查通过（无裸 LEGAL / GATE / RESOLVER 标识符）
A-7  输入值域与 §4.8 / §5.2 逐字一致
A-8  R5/R6 身份比较（B-1）：相等 / 不相等 / 缺身份 ⇒ 输入错误，三路径均通过
A-9  L5 条件式必需性（B-2）：R1/R2/R4 终止时可为 not_evaluated；
     必须依赖 L5 而 not_evaluated ⇒ 输入错误（不得转为任何 Decision）
A-10 L4 映射（A-4 / **E-1**）：`deprecated`→true / `active`→false / 合法省略→notEvaluated，
     且不参与 Decision                                          ← rev5 修订
A-11 `NOT_EVALUATED`、`undefined`、缺失字段、非法值四者不可混同
A-12 两阶段优先关系：无条件必需缺失/超域 ⇒ IE-1/IE-2，优先于 R1 的 INVALID
A-13 每个 input_error 均携带必填 `field`，且 5 个 reason 子类可自辨
A-14 三类结果均携带 `facts`；**分情况**适用不变式（decision / precondition_failed 两态完整；
     input_error 适用 I-4）                                        ← rev5 修订（E-2）
A-15 **唯一性**：任一输入组合必然产生**唯一**的 `reason` 与 `field`
     （阶段间 + 阶段内 + 条件式三层固定顺序）                        ← rev5 新增（E-3）
A-16 **L4 映射可完整追踪**：输入 `l4Deprecation` → 输出 `knownFacts.deprecated` 可逐例验证 ← rev5 新增（E-1）
★ 以上均为【设计目标】，其达成与否须在 Implementation 阶段由实际执行证明。
```

### §6.4 测试规格（T-1…T-20 · 仅规格，不执行）

```text
【rev3 已含（T-1…T-10）】
T-1  R5/R6 身份【相等】：L5=evaluated(IDENTIFIED) 且 sourceIdentity == designated… ⇒ R6 ⇒ LEGAL
T-2  R5/R6 身份【不相等】：⇒ R5 ⇒ ILLEGAL
T-3  L6 = deny 且 l5Evaluation = not_evaluated ⇒ decision/ILLEGAL 且 competing ∈ notEvaluated
T-4  L6 不阻断且须继续判定而 L5 = not_evaluated ⇒ input_error / IE-3(a)
T-5  L5 已评估（三取值）⇒ knownFacts.competing 依 C-8.2 映射；已评估事实被保留
T-6  ★ rev5 修订（E-1）：L4 映射**双侧 + 省略**全覆盖 ——
       · `observed.l4Deprecation = "deprecated"` ⇒ `knownFacts.deprecated === true`
         （且 `notEvaluated` **不含** `deprecated`）
       · `observed.l4Deprecation = "active"`     ⇒ `knownFacts.deprecated === false`
         （且 `notEvaluated` **不含** `deprecated`）
       · `observed.l4Deprecation` **合法省略**   ⇒ `knownFacts` **不含** `deprecated`
         且 `notEvaluated` **包含** `deprecated`
       · `observed.l4Deprecation` **值非法**     ⇒ IE-2，`field = "observed.l4Deprecation"`
         （**不得**伪装成 knownFacts 或 notEvaluated）
       · 该映射**不改变** Decision
T-7  `kind` 三类可区分；`INVALID` 不出现在三值 decision 中
T-8  IE-1 / IE-2 / IE-3 可区分，并各带 `field`
T-9  轴 2 属性不能反向改变轴 1
T-10 所有期望值可由已生效 N1–N9 推导；与 §7.1 矩阵冲突 ⇒ 停止

【rev4 已含（T-11…T-17）】
T-11 错误结果保留已知诊断事实（`precondition_failed` / `input_error` 两例 + 不制造未知值）
      ★ rev5 修订：`input_error` 分支**只保留**其他已确认事实；
        出错字段与因错误无法确定的事实**均不进入**两集合（I-4）
T-12 错误字段必填（含"整体结构缺失"用根路径表示）
T-13 校验与短路的优先关系（唯一结果；含多错误并存的确定性）
T-14 早期终止与身份缺失：R1/R2/R4 先终止 ⇒ 不报输入错误
T-15 L5 = NONE 且不提供 identity ⇒ 仍得 `decision / LEGAL`（R6 路径）
T-16 身份值缺失 vs 值非法（IE-3(b1)/(b2) vs IE-2）
T-17 IE-3(a) / IE-3(b1) / IE-3(b2) 可从结果本身区分（依据 `reason`）

【rev5 新增（T-18…T-20，依 AUTH-21 E-3）】
T-18 **同阶段多错误并存 ⇒ 唯一 `reason` + `field`**（按 §4.4a 阶段内字段顺序）：
       · S1 同时缺 `presence` 与 `contractPermission`
         ⇒ 唯一结果 IE-1，`field = "presence"`（顺序在前）
       · S1 同时缺 `contractPermission` 与 `l5Evaluation`
         ⇒ 唯一结果 IE-1，`field = "contractPermission"`
       · S2 同时 `presence` 超域 与 `contractPermission` 超域
         ⇒ 唯一结果 IE-2，`field = "presence"`
       · S4 同时非法 `observed.ownership` 与空 `identity.sourceIdentity`
         ⇒ 唯一结果 IE-2，`field = "observed.ownership"`（S4 内顺序在前）
       · S1 与 S4 同时存在错误 ⇒ 取 **S1**（阶段间顺序在前的阶段）
T-19 **两个身份值同时缺失 ⇒ 唯一结果**：
       · 需要身份比较而整个 `identity` 未提供 ⇒ 唯一结果 **IE-3(b1)**
         （`field = "identity.sourceIdentity"`），**不得**返回 IE-3(b2)
T-20 **身份三种结果可区分**（与 S4 的关系）：
       · 整个 `identity` 缺失（需要比较） ⇒ IE-3(b1)
       · 仅缺 `sourceIdentity`           ⇒ IE-3(b1)
       · 仅缺 `designatedAuthorityIdentity` ⇒ IE-3(b2)
       · 已提供但为空字符串/非字符串      ⇒ **S4 的 IE-2**（`field` 指向该字段）
       · 更高优先级错误已成立（如 IE-1/IE-2/IE-3(a)）⇒ 先返回该错误，**不得越级**
★ 本授权不允许执行上述测试；上列仅为**测试规格**。
```

---

## §7 开放问题（稳定编号 OI-1 … OI-6）

> **编号纪律**：编号一经分配即不重编。即使某编号的状态由"开放"转为
> "已裁定关闭 / 已定边界 / 非目标"，其**身份保持不变**，仅在状态列中体现。

### OI-1 v1.1 §10 的「❌ … SoT checker …」是否构成实施障碍？ — **状态：已裁定关闭（解释性裁定）**

```text
原始证据：v1.1 §10（L238，逐字）
      ❌ Implementation / runtime / SoT checker / CLI / Repository API
背景：rev6 的 Non-Changes 声明「【原始 v1.1】的 §1/§2/§5/§6/§7/§8/§9/§10 与 AD-R6-1 全文不动」
      ⇒ v1.1 §10 的文字**未变**。
★ 解释性裁定（依 R6ERR-IC-REVIEW-01，已作出）：
   ① 该条目是【原提案本身的授权边界声明】，**不授予任何实际实施权限**。
   ② 该条目**不构成对未来独立授权的永久禁止**。
   ③ Amendment rev6 §8 明确规定实施及相关活动仍须**独立授权**。
   ④ Implementation Contract 的【设计】与【实际实施】是不同活动；
      AUTH-17 / 18 / 19 / 20 / 21 均**不构成** Implementation 授权。
   ⑤ **不修改、不删除、不弱化**原始 v1.1 §10、Amendment §8 或其他冻结文字。
   ⑥ 本解释**不构成**对 SC-EX-01 的追认，也**不是** Amendment 的新规范内容。
★ 本项关闭的是"原文是否构成永久禁止"的**解释疑问**；**不意味着**后续 Implementation 已获准。
```

### OI-2 L1–L6 属性的【采集】是否在实现范围内？ — **状态：已确定范围边界（不在范围内）**

```text
证据：v1.1 §5（L144–L152，逐字）
      默认：Scoped SoT Legality —— Slice → 识别【本 Slice 实际读取/新引入】的语义来源 → 逐源判定
★ 范围边界裁定（依 AUTH-18 §3）：实施对象**限定为纯判定器**（§1.1）。
   ❌ 不负责：资料抓取 / 语义来源发现 / 属性抽取 / DB 推断 / 跨来源权威消解 /
              身份发现与规范化 / rev6 未定义的额外规则（完整清单见 §5.1）。
★ 但 L4 原始状态 → 轴 2 `deprecated` 的**规范化映射属判定器**（E-1），不属被排除的"采集"。
```

### OI-3 实现形态 / 落点 / 输出消费者 / 错误表示 / 权威身份输入 / L5 条件式评估 — **状态：已裁定关闭（AUTH-19）**

```text
★ 架构裁定（依 AUTH-19 §2 / §3 / §4，已作出）：
  A-1 落点 = 方案 A：`packages/research/src/domain/r6err-legality.ts`（单文件纯判定组件）；
      不新增包、不设子目录、不引入服务层。
  A-2 输出边界 = 初始实现**只提供纯函数出口**（经 `domain/index.ts`）；不虚构调用者或消费者。
  A-3 错误与结果表示 = Result 联合体（三类）；不以异常作为正常判定失败的传输方式。
  A-4 L4 属性映射：`deprecated → true` · `active → false` · 未评估 → NOT_EVALUATED；
      仅诊断表达，不参与 Decision。
  B-1 权威身份比较：`sourceIdentity` + `designatedAuthorityIdentity`（非空、调用方提供）；
      仅在实际需要比较时要求；精确相等比较；判定器不负责身份发现/DB/别名/规范化。
  B-2 L5 条件式必需性：R1/R2/R4 终止 ⇒ 不强制补算；已评估 ⇒ 保留事实；
      须继续区分 R3/R5/R6 而未评估 ⇒ 输入错误；`competing` 为派生输出。
★ **rev4 / rev5 对已裁定事项的精确化（不改变裁定本身）**：
    rev4：D-1（两阶段校验优先）· D-2（`branch_input_missing`）·
          P0-1（`knownFacts + notEvaluated[]`）· P0-2（`field` 必填 + reason 映射表）·
          P0-4（身份触发条件精确化）
    rev5：**E-1**（L4 映射责任归判定器 + 四行映射表）·
          **E-2**（不变式分情况适用：I-2 / I-3 / I-4 精确化 + C-8.7 三行表）·
          **E-3**（阶段内字段顺序 + IE-3 固定顺序 + 身份三种结果 + identity 子字段可独立缺失）
★ 落实位置：A-1 → §3.6.2；A-2 → §3.6.1 / §5.6；A-3 → §3.6.3 / §5.3 / §5.7；
  A-4/E-1 → §4.8 C-8.6 / §5.2 D / §6.4 T-6；
  B-1/E-3 → §4.4d C-4d.4 / §5.2 C / §5.3；
  B-2 → §4.4e / §4.8 C-8.5 / §5.2 B；
  D-1/E-3 → §4.4a（S1–S4 + 阶段内顺序）/ §4.4c / §5.3；
  P0-1/E-2 → §3.6.3（I-3/I-4）/ §4.8 C-8.7；
  P0-2 → §3.6.3 / §5.3 映射表。
★ 本项**已裁定关闭**；编号 OI-3 予以保留。本项关闭不改变任何规范内容。
```

### OI-4 INV-AXIS-1 第四条的确切表述 — **状态：已解决（已逐字搬运）**

```text
★ rev6 §3.1 L137–L142 四条原文已逐字搬运至 §4.6（C-6.1a/6.1b/6.2/6.3 + C-6.4 示例）；
  rev6 §4 L216–L221 对应三条已搬运至 §4.6a（C-8a.1）。
⇒ 本项**已关闭**。编号 OI-4 予以保留。
```

### OI-5 NOT_EVALUATED 与 L5 → competing 映射表的完整条文 — **状态：已解决（已逐字搬运）**

```text
★ rev6 §4 L211–L214 / L225–L233 / L235–L240 / L244–L258 均已逐字搬运至 §4.8（C-8.1…C-8.7）。
⇒ 本项**已关闭**。编号 OI-5 予以保留。
```

### OI-6 多次判定之间的冲突消解 — **状态：已明确列为【非目标】**

```text
★ 处置（依 AUTH-18 §5）：连同 N-1…N-5 一并列为**非目标**（见 §5.4）。
★ **本编号 OI-6 予以保留**（不得改名或复用于其他问题）。
★ 非目标声明不得削弱单次判定契约（§5.7）。
```

---

### §7.1 状态汇总表（rev5）

| 编号 | 问题 | 状态类别 | 依据 / 去向 |
|---|---|---|---|
| **OI-1** | v1.1 §10「❌ SoT checker」是否构成障碍 | **① 已裁定关闭** | IC-REVIEW-01 解释性裁定 ①–⑥ |
| **OI-2** | L1–L6 属性采集是否在实现范围内 | **② 已确定范围边界** | AUTH-18 §3；收窄为纯判定器（§1.1 / §5.1） |
| **OI-3** | 形态/落点/消费者/错误表示/身份输入/L5 条件式 | **① 已裁定关闭（AUTH-19）** | A-1…A-4 + B-1/B-2；rev4/rev5 精确化 |
| **OI-4** | INV-AXIS-1 第四条的确切表述 | **① 已解决（逐字搬运）** | → §4.6 / §4.6a |
| **OI-5** | NOT_EVALUATED 与 L5→competing 映射表 | **① 已解决（逐字搬运）** | → §4.8（C-8.1…C-8.7） |
| **OI-6** | 多次判定之间的冲突消解 | **④ 被明确列为非目标** | → §5.4（N-1…N-5） |

```text
★ 计数核验（rev5）：
    ① 已解决并依据既有裁定关闭 = OI-1 · OI-3 · OI-4 · OI-5  → 4 项
    ② 已确定范围边界           = OI-2                     → 1 项
    ③ 仍待架构选择或证据支持   =（无）                      → 0 项
    ④ 被明确列为非目标         = OI-6                     → 1 项
    合计 = 4 + 1 + 0 + 1 = 6 ✔（与 §2.2 一致；全篇无重复 ID）
★ rev5 **未新增**开放问题编号、**未重编** OI-1…OI-6（承 AUTH-21 §二 明确不授权）。
```

---

## §8 Non-Changes 与未授权事项

```text
Non-Changes：
  · 不修改 Amendment rev6（含 §0–§10 任何文字）
  · 不修改原始 v1.1（保持 PROPOSED / NOT FROZEN）、AD-R6-1、H-1～H-6
  · 不改变 §9 的 26 项计数、§7.2 的 40 项口径
  · 不改变原冻结 Commit `7f31bb8` 及其 blob `67923f36…`
  · 不追认 SC-EX-01（保持 REGISTERED / NOT RATIFIED）
  · 不改变 Effectivity 状态（保持 EFFECTIVE，生效时点不变）
  · 不修改代码 / 测试 / schema / Methodology / 运行时行为
  · 不扩大 N1–N9 的规范性范围
  · 本契约的接口与错误处理形状（A-3 / B-1 / B-2 / D-1 / D-2 / P0-1 / E-1 / E-2 / E-3）
    为**架构裁定确定的设计**，**不是** N1–N9 的新规范决策规则

未授权（本契约与 AUTH-17 / 18 / 19 / 20 / 21 均不授权）：
  · Implementation · Implementation Preflight · 本契约的**冻结**（FROZEN）/ **生效**（Effectivity）
  · **实际创建实现文件**（如 `domain/r6err-legality.ts`）· 接线 · 消费者集成 · 服务
  · 执行任何测试 / 类型检查 / lint
  · Stage · Commit · Push · 标签 · 发布
  · 清理 / 覆盖 / 暂存协作者的四项工作区改动
  · 重开 A-1…A-4 / B-1 / B-2 或 OI-3；重编 OI-1…OI-6；新增开放问题编号
```

---

## §9 失败与停止规则

```text
S-1 契约不完整：若 §7 中存在"仍待架构选择或证据支持"的编号且在 Preflight 前未获裁定
    ⇒ 不得进入 Implementation
    ★ 当前状态（rev5）：该类编号 = **0** ⇒ S-1 **不触发**。
      但契约现为 ACCEPTED / NOT FROZEN / NOT EFFECTIVE / IMPLEMENTATION NOT AUTHORIZED（§8），
      故仍不得进入 Implementation —— 依据是 §8 的未授权条款。
S-2 现有代码行为冲突 ⇒ 报告并停止，不自行修改
S-3 需求缺口 / 规范歧义 ⇒ 报告并等待裁定，不得自行改变规范
S-4 基线不符 ⇒ 停止并报告
S-5 矩阵冲突：若 §7.1 矩阵的预期与已生效 N1–N9 的可推导结果冲突 ⇒ **记录并停止**
S-6 任何超出 AUTH-21 授权范围的操作需求 ⇒ 停止并申请新授权
S-7 若在实现中发现存在**两个都符合本契约文本**却对同一输入给出不同结果的
    可能路径（即契约仍未闭合）⇒ 停止并报告，不得由其自行择一
    ★ rev5 说明：E-3 已把"唯一性"落实到阶段间 / 阶段内 / 条件式三层；
      若仍能构造出反例，即触发本条。
```

---

## §10 本契约的边界、修订史与状态记录（rev5 · ACCEPTED）

```text
本文件 = Implementation Contract（rev5 · ACCEPTED / NOT FROZEN / NOT EFFECTIVE /
         IMPLEMENTATION NOT AUTHORIZED）
· 不构成对 Amendment rev6 的任何修改
· **已接受**（ACCEPTED · R6ERR-AUTH-22）
  —— 但**不构成冻结 / 不构成生效 / 不构成实施授权**
· 不构成 Implementation 或 Preflight 的授权

修订史：
   rev1（AUTH-17 初稿）：607 行 / 29770 B / sha256 c860fc1cd72849886f45e14b3ff45e3c862de34e57803522b9429cb35c92a9f7
   rev2（AUTH-18 修订）：862 行 / 48167 B / sha256 b578ad4c2a77f044a336b9b92101152a31efa615204bbdb4dac2c060e4a5c15b
   rev3（AUTH-19 修订）：1044 行 / 60909 B / sha256 dda837ccfa3361bb2432ebbc43091f2818fcbbdc3e623eaaca409b716383cc04
   rev4（AUTH-20 修订）：1104 行 / 68472 B / sha256 7f191a94903ae34228e2bd4ca2a78c765611eb0e7855c4d44c21703bd7359468
   rev5（AUTH-21 修订）：E-1 / E-2 / E-3 + T-18…T-20
                        · 内容指纹（接受前）= 1192 行 / 75670 B /
                          sha256 695187ce247a33f3273bfc2a989ff5abbe341a3dfd940c2135022ae0b3ac5f20
   （本块的追加不改变 rev5 的【规范内容】；仅变更状态记录与效力边界文字）

后续（均须独立授权）：
  ① 本契约 rev5 的审阅（Review）—— **已完成**：IC-REVIEW-05 = PASS（设计层）
  ② **当前无待裁定的开放编号**（§7.1：4 已关闭 / 1 已定边界 / 0 待架构选择 / 1 非目标）
  ③ 契约接受 —— **已完成**（R6ERR-AUTH-22）
     契约冻结 —— **待独立授权**（NOT FROZEN；接受不产生冻结授权）
  ④ Commit（独立授权）—— 冻结前须先建立 Git 对象身份（AUTH-22 §一 Q3）
  ⑤ Implementation Preflight（独立授权）
  ⑥ Implementation（独立授权）—— 含实际创建 `domain/r6err-legality.ts`、
     接线、测试执行等，均须另行授权
```

---

### §10.1 ACCEPTANCE RECORD（接受事件记录 · append-only）

```text
──────────────────────────────── ACKNOWLEDGEMENT ────────────────────────────────
Record type      : ACCEPTANCE RECORD（接受事件）
Record id        : IC-ACC-01
Status           : ACCEPTED（**NOT FROZEN** · NOT EFFECTIVE · IMPLEMENTATION NOT AUTHORIZED）
Authorization    : R6ERR-AUTH-22（rev5 接受授权 · **不含**冻结授权）
Event kind       : 独立事件 #1（接受）；独立事件 #2（冻结）为**另一次独立授权**
─────────────────────────────────────────────────────────────────────────────────

Bound object（对象绑定 · 承 Q2 = (i)+(ii)+(iv)）
  File           : docs/phaseC/r6err-implementation-contract.md
  Revision       : rev5
  (i)   SHA-256  : 695187ce247a33f3273bfc2a989ff5abbe341a3dfd940c2135022ae0b3ac5f20
  (ii)  Size     : 1192 行 / 75670 字节（接受前的内容指纹；行数以 ReadAllLines-UTF8 口径计）
  (iv)  Baseline : HEAD = origin/main = 14db873f6d8c680fa6dc476e70de3b2e4d3df147（接受前）
  ★ (iii) Git 身份（commit / blob）**当时不存在** —— 该文件在接受时仍为 untracked；
    依 AUTH-22 §一 Q3，须先经**独立 Commit 授权**建立 Git 对象身份，
    再行冻结授权。本记录**不**声称任何 Git 身份。

Acceptance scope（本次接受的效力）
  · rev5 的【内容】被接受为**候选实施形式基线**
  · 接受与冻结分离：接受**不产生**冻结授权；冻结**不追溯替代**接受事件（AUTH-22 §一 Q1）
  · Effectivity 概念**不适用**于本契约（AUTH-22 §一 Q6）

Explicit NON-effects（本记录**不**产生以下任何效力）
  ✗ FROZEN（未冻结）                ✗ Effectivity（未生效）
  ✗ Implementation Authorization（未授权实施）
  ✗ Preflight Authorization（未授权预检）
  ✗ Commit / Push / Tag / Release（均未授权）
  ✗ 创建实现文件（如 domain/r6err-legality.ts）
  ✗ 修改 Amendment rev6 / 原始 v1.1 / AD-R6-1 / H-1～H-6 / 任何其他文件
  ✗ 改变 N1–N9 的规范性范围；重开既有裁定；重编 OI 编号

Freeze prerequisites（冻结的前置条件 · 尚未满足）
  1. 目标文件须先经**独立 Commit 授权**取得 Git 对象身份（AUTH-22 §一 Q3）
  2. Commit 后须重新核验 commit / blob / 内容指纹，并与本记录的接受指纹比对一致
  3. 冻结须**另行签发独立授权**，并将冻结对象绑定到 commit / blob / SHA-256 / 行数 / 字节
  4. Push **不**随之自动授权

Revision policy after freeze（冻结后的修订机制 · 仅为规则声明，当前**未**创建任何文件）
  · 冻结后**禁止原位重写**，无默许解冻
  · 修订仅经独立版本轴 append-only 追加：
      IC-A1 · IC-A2 · …（Implementation Contract Amendment）
      IC-E1 · IC-E2 · …（Implementation Contract Erratum）
  · 编号规则 / 适用范围 / 两类修订的区别，须在后续修订管理规则中另行明确（AUTH-22 §一 Q5）
─────────────────────────────────────────────────────────────────────────────────
```

---

**End of contract（rev5 · Implementation Contract · ACCEPTED / NOT FROZEN / NOT EFFECTIVE /
IMPLEMENTATION NOT AUTHORIZED · 接受依 R6ERR-AUTH-22；冻结须另行授权）**
