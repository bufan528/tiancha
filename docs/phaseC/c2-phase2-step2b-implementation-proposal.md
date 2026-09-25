# Tiancha Phase C · C2 Phase 2 · Step 2-B — Implementation Proposal

> **状态：PROPOSAL（实施前方案；**不是**契约修订）**
> **基线：`57789e5`（C2 Contract Final Lock）· `8029f52`（Phase 1）· `69d2b1d`（Phase 2 Contract FINAL LOCK）· `91bba15`（Step 2-A，验收 PASS）**
> 本文件**不含任何实现**，也不修改 FINAL LOCK 契约。目的：把 Step 2-B 的契约边界、现有代码事实与测试矩阵先锁死，供 contract-level gate。
> 契约依据：`docs/phaseC/c2-phase2-implementation-contract.md` §4.2 / §1.4 / §5 / §9(Q3) / §11（实现阶段验收点）/ §12（Step 2-B）。

---

## 0. 目标与范围

**IN（Step 2-B 的全部）**

```text
Gap ──(读)──► gap.relatedRequirementIds ──► Target.relatedRequirementRefs
CLI: tiancha research target add <行业> ... [--for-gap <gapId>]...
展示: target list 增加「用于补充 Requirement」
```

**OUT（一律不做）**：Target recommendation / Company / Chain / LLM / Web / 外部数据 / Research Plan（Step 2-C）/ ResearchPlanBuilder / `research_plan_show` / Knowledge / Experience / Report / Gap 新字段 / 新关系表 / 新表 / Target identity 变更 / 顺手重构。

---

## 1. 唯一写入口（审点 1）

| 项 | 事实 / 计划 |
|---|---|
| 写入路径 | **只有** CLI `target add`（`src/cli/research-commands.ts` 的 `runTargetAdd`）→ `TargetService.add()` 内的**唯一一次** `repo.upsertTarget()`（`target-service.ts:92`） |
| 本阶段新增的写入触发 | **只有** `--for-gap <gapId>`（可重复）；无第二入口 |
| 允许写入的字段 | **只有** `ResearchTarget.relatedRequirementRefs`（其余字段的处置见 §4 与 Q1） |
| **不存 `gapId`** | ✅ `ResearchTarget` 无 gap 字段（`research-target.ts:47` 仅 `relatedRequirementRefs: string[]`；持久化列 `related_requirement_refs_json`，`research-repository.ts:676/1072`）。写入的是 **requirement ref**，不是 gapId ✓ |
| Agent 侧 | **零改动**：Agent 无 target 写工具（Q1/B2 治理长期有效）；`research_target_list` 仍只读（是否顺带暴露 refs 见 Q3） |
| 其它路径 | plan / need / chain / fit / preparation / report **都不得**写 `relatedRequirementRefs`（I-C2-14） |

---

## 2. Gap → Target 的唯一映射规则（审点 2）

FINAL LOCK §1.4 已冻结：

```text
TargetsForGap(G) = { T | T.relatedRequirementRefs ∩ G.relatedRequirementIds ≠ ∅ }
```

**Step 2-B 的职责不是实现这个派生**（它属于 Step 2-C 的 ResearchPlanView），而是**保证写入的数据足以支撑它**：

1. 写入的必须是 **requirement ref**（不是 gapId、不是展示文本）——见 §1；
2. 并集语义 ⇒ 同一 Target 可同时归属多个 Gap（跨 Gap 重复出现是**合法**的，`rev4 §4.3.1`）；
3. **不新增**任何映射实现、缓存、字段或表 ✓（Step 2-B 期间 `TargetsForGap` 只存在于契约文字里）。

---

## 3. 单次 mutation 的原子性（审点 3）

**写死的行为边界**（CLI 层结构性保证）：

```text
① 解析全部 --for-gap 参数
② 完整校验每一个 gap（存在 + gap.subjectId === industryId）   ← 任一失败 ⇒ deps.err + return 1
③ 派生 requirement refs（并集 + §4.2 顺序规则）
④ 唯一一次 deps.targets.add(...)  →  内部唯一一次 repo.upsertTarget()
```

- ②失败时**根本不进入 ④** ⇒ 零写入（不是"写完再回滚"）✓
- ④内部只有**一条** `upsertTarget` SQL（`target-service.ts:92`）⇒ 单行 upsert 本身是原子的，**不会出现"半个 target 行"**；
- **不引入事务抽象、不做多次独立 upsert 模拟原子**（I-C2-14）。是否需要显式 `BEGIN/COMMIT` 见 Q4（我的建议：**不需要**）。

**注意**：本方案**不会**为了"原子"而新增写路径或中间表 —— 原子性来自"校验全部前置 + 只写一次"。

---

## 4. Existing / New Target 语义（审点 4）—— 已裁决：**C′**

### 4.1 事实（`TargetService.add()` 现状，`target-service.ts:41-94`）

`add()` 是 **"同一 (industry, subject) ⇒ 同一 targetRef 的 upsert"**，且**整字段重建**：

| 字段 | 现状（existing target 重跑时） |
|---|---|
| `relatedRequirementRefs` | `input.relatedRequirementRefs ?? []` ⇒ **未传就清空** |
| `relatedQuestionRefs` | 同上 ⇒ 未传就清空 |
| `limitations` | `input.limitations ?? []` ⇒ 未传就清空 |
| `accessibility` | `input.accessibility ?? "unknown"` ⇒ 未传就重置 |
| `isFallback` / `fallbackForTargetRef` | 未传 ⇒ `false` / `null` |
| `expectedInformationValue` | 未传 ⇒ 回落到 `position.importance`（**不是**既有值） |
| `kindSubject` | 未传 ⇒ `{ displayName: subjectKey }`（覆盖既有） |
| `status` | `existing?.status ?? "proposed"` ⇒ **保留** ✅ |
| `createdAt` | `existing?.createdAt ?? now` ⇒ **保留** ✅ |

### 4.2 已裁决：**C′**（CLI 层 + "existing 只允许改 refs"的硬约束）

**Gate 裁决**：采用 CLI 层方案，但**不是**简单的"未提供就回填"—— 在 `existing Target + --for-gap` 模式下，允许变化的字段**只有** `relatedRequirementRefs`。

```text
Existing Target + --for-gap（link-only 模式）：
  ① relatedRequirementRefs 是本次【唯一】允许变化的字段；
  ② 所有其它既有字段必须保持原值；
  ③ 若用户显式提供其它【会产生字段变化】的参数 ⇒ 命令失败；
  ④ 不得静默忽略用户输入（禁止"用户以为改了、其实被忽略"）；
  ⑤ validation failure 必须发生在【唯一一次 upsert 之前】（零写入）。
```

**行为判定（写死）**：

```text
mode = (existing target 存在) && (至少一个 --for-gap)
  ├── link-only : 只允许 refs 变化；其它字段一律取 existing 值；
  │               显式提供的非 refs 参数必须与 existing 一致，否则【报错】
  └── normal    : 无 --for-gap ⇒ 其它字段按 B2 既有 upsert 语义；
                  relatedRequirementRefs 保持既有值（FINAL LOCK §4.2；新对象为 `[]`）
                  ↑ Step 2-B 实现期与 FINAL LOCK 对齐后的表述（原措辞"完全不变（不碰）"过宽）
```

**为什么不是"静默回填"**：若用户输入 `--accessibility public` 而 existing 是 `warm`，静默忽略会让用户以为已修改成功 —— 这是很差的 CLI 语义；因此按 ③ **显式报错**。

**`TargetService.add()` 保持不动**（零 service 语义变更）：CLI 组装完整对象后仍调用它**一次**。

### 4.2.1 link-only 的参数语义（C′ 的必要推论 —— 需你确认，见 §10 Q7）

"只允许 refs 变化"要求 link-only 模式**不能**强迫用户重新提供创建参数，否则"只改 refs"无法成立：

```text
link-only 用法：
    tiancha research target add <行业> --name <主体> --for-gap <gapId>... [--json]
        （创建参数可省略：target 已存在 ⇒ 字段取 existing 值）

若仍然显式提供了创建参数 ⇒ 必须与 existing 一致（幂等重复），否则【报错】。
```

⇒ 这需要把 `runTargetAdd` 的必填校验从"五个参数全必填"放宽为
`--name` **且**（`--for-gap` 非空 **或** 五个创建参数齐全）。取舍见 §10 Q7。

### 4.3 其余规则（C′ 下依然成立）

- **new target**：一次性创建（`relatedRequirementRefs` 起点 `[]`）；创建参数照常必填；
- **persistence failure**：`add()` 抛错 ⇒ 新对象**不产生**、既有对象**保持原值**（写入只发生在那一次 upsert；且 link-only 模式本来就不触碰其它字段）；
- **Target identity 不变**：`targetRef = targetRefFor(industryId, subjectKey)`（`research-target.ts`）；`--for-gap` **不参与** identity 计算，`--for-gap` × `--fallback-for` 组合也**不得**改变 identity（I-C2-15）；
- **Gap 零 mutation**：本阶段对 gap 只有**读**（`listGaps` / `find`），无任何 `upsertGap`；
- **重复 `--for-gap` 同一 gapId**：按集合语义合并（等价于只出现一次）⇒ **不得**产生重复 ref，也**不得**改变最终顺序（见 §5 #7）。

---

## 5. 边界矩阵（审点 5）→ 测试映射

| # | 场景 | 必须断言 | 计划用例 |
|---|---|---|---|
| 1 | 单 Gap | refs = 既有 ∪ gap.relatedRequirementIds | T-C2-4 |
| 2 | 多 Gap | 顺序 = CLI 参数顺序 × gap 内原顺序，首次出现优先（FINAL LOCK §4.2） | T-C2-37 |
| 3 | 空 `relatedRequirementIds` 的 Gap | **合法**：不增加 ref，Target 仍创建（FINAL LOCK §4.2） | T-C2-4（子断言） |
| 4 | invalid Gap（不存在） | 报错 `未找到研究缺口「…」` + **零写入**（`add()` 根本不被调用） | T-C2-40① |
| 5 | cross-industry Gap | 报错 `…不属于行业「…」` + **零写入** | T-C2-40① |
| 6 | repeated / idempotence | 重复执行 refs **完全相同**；Gap 指纹不变 | T-C2-37 |
| 7 | deterministic ordering（**含重复 gapId**） | 同参数顺序 ⇒ 结果逐步相同；`--for-gap A --for-gap A --for-gap B` ≡ `--for-gap A --for-gap B`；若 A→[a,b]、B→[c]，则结果必须是 `[a,b,c]`，**不得** `[a,b,a,c]` | T-C2-37 |
| 8 | persistence failure | **零部分更新**（既有 Target 保持原值；新 Target 不产生） | T-C2-40②（注入 stub） |
| 9 | Gap 零 mutation | 操作前后 `research_gap` 指纹（status/gapType/updatedAt）一致 | T-C2-5 |
| 10 | **Target identity**（分层 ①） | 操作前后 `targetRef` + `subjectKey` **不变** | I-C2-15 断言（并入 T-C2-39/T-C2-5） |
| 11 | **creation metadata**（分层 ②） | 操作前后 `createdAt` 不变 | **单独断言**，不并入 ② 的 identity 不变量（避免未来把 metadata 生命周期调整误读为 identity 变化） |
| 12 | existing Target：非 refs 字段（C′） | link-only 模式下**只有** `relatedRequirementRefs` 变化；其它字段逐字段 == existing | T-C2-4（子断言） |
| 13 | existing Target + 显式非 refs 参数（C′） | 与 existing **不一致** ⇒ **报错**；与 existing **一致** ⇒ 允许（幂等） | T-C2-40③（新增子断言） |
| 14 | link-only 的参数放宽 | 省略创建参数 ⇒ 正常（取 existing 值）；**new** target 省略创建参数 ⇒ 仍报错 | T-C2-4 / T-C2-40（措辞由 Q7 定稿） |
| 15 | `--for-gap` × `--fallback-for` | 允许组合；identity（`targetRef` / `subjectKey`）不变；existing 时仍按 C′（只改 refs） | T-C2-39（补断言） |
| 16 | 不生成对象名 | 输出中无公司/专家/机构名（I-C2-8/I-C2-21） | T-C2-15 的延续断言 |

---

## 6. 严格禁止扩张（审点 6）

```text
Target recommendation / Company recommendation / Chain recommendation
LLM / Web / external research
Research Plan / ResearchPlanBuilder / research_plan_show / TargetsForGap 实现
Knowledge / Experience / Report
Gap 新字段 / 新关系表 / 新表 / schema 改动
Target identity 变更
Step 2-C 的任何内容
顺手重构 / 顺手优化 / 修 C1 flaky
```

---

## 7. 测试必须证明的核心不变量（审点 7）

```text
① Gap unchanged                 → 前后 research_gap 指纹一致（T-C2-5）
② Target IDENTITY stable        → targetRef / subjectKey 不变（I-C2-15）
   └ creation metadata（createdAt）单独断言，【不】并入 identity —— 按 Gate 要求分层
③ relatedRequirementRefs deterministic → 同输入 ⇒ 完全相同的数组（含顺序）；
                                   重复 gapId 不产生重复项、不改变顺序（T-C2-37）
④ repeated operation idempotent → 重复执行 ⇒ refs 逐元素相同（T-C2-37）
⑤ invalid input ⇒ zero mutation → 非法 / 跨行业 gap ⇒ add() 不被调用，零写入（T-C2-40①）
⑥ persistence failure ⇒ zero partial mutation → 注入失败 ⇒ 既有值不变 / 新对象不产生（T-C2-40②）
⑦ link-only 只改 refs（C′）      → existing + --for-gap ⇒ 非 refs 字段逐字段 == existing
⑧ 显式冲突输入 ⇒ 失败（C′）       → 非 refs 参数与 existing 不一致 ⇒ 报错，绝不静默忽略
```

---

## 8. 文件级实施计划

| 文件 | 计划改动 | 说明 |
|---|---|---|
| `src/cli/research-commands.ts` → `runTargetAdd` | 新增 `--for-gap`（可重复）解析；**前置全量校验**（先于任何写入）；按 FINAL LOCK §4.2 顺序派生 refs；**C′**：`existing + --for-gap` ⇒ 组装时非 refs 字段取 existing 值，且**显式冲突输入 ⇒ 报错**；必填校验按 Q7 放宽；usage 串更新 | 唯一写入口所在的接线层 |
| `src/cli/research-commands.ts` → `runTargetList` | 组装 requirement 摘要（维度标签 + ref）供展示 | 见下 |
| `src/cli/research-format.ts` | `TargetListView` 增 `requirementLabels?: Array<{ ref: string; label: string }>`；`formatTargetWithFitHuman` 输出「用于补充 Requirement」行 | 契约 §4.2：**维度摘要 + ref**；摘要由既有字段确定性派生（禁 LLM 改写） |
| `packages/research/src/application/target-service.ts` | **不改**（C′ 完全在 CLI 层完成；`add()` 的 B2 upsert 语义逐字保持不变） | |
| 测试（新） | `src/cli/phase-c2-step2b-cli.test.ts`（T-C2-4 / 5 / 37 / 40）+ `packages/research/src/phase-c2-step2b.test.ts`（T-C2-39 派生支撑 + target-service 语义） | 6 个不变量全覆盖（§7） |
| Agent / 其它 | **零改动**（除非 Q3 裁决要求暴露 refs） | |

**不新增**：表 / 列 / migration / repo 读方法（gap 校验用既有 `listGaps(industryId).find(g => g.gapId === id)`；`repo` 目前**没有** `getGap`，也不打算加）。

---

## 9. 门禁与交付（沿用 Step 2-A 的做法）

- 两处 `tsc` exit 0；
- 全量测试全绿（Step 2-A 基线 237 + 本步新增），C1 flaky 除外（**仍不修**，口径同 Step 2-A）；
- `research smoke` PASS（child-session=real）；
- 真实库演练（备份 → 演练 → **byte-identical 恢复**）；
- 送审：完整 patch + 文件清单 + 对象级 blob 对照 + 越界自检 + 独立复验结论；
- **一次只做 2-B**；不 push、不进入 2-C（除非另行授权）。

---

## 10. 裁决记录（Step 2-B Contract Gate；已定）

| # | 问题 | **裁决** |
|---|---|---|
| **Q1** | Existing Target 的其它字段语义 | **C′** —— CLI 层组装；`existing + --for-gap` 时**唯一**允许变化的是 `relatedRequirementRefs`；显式提供会产生变化的非 refs 参数 ⇒ **报错**（不静默忽略）；validation 先于唯一一次 upsert；`TargetService.add()` **保持不动**（见 §4.2） |
| Q2 | `--for-gap` × `--fallback-for` | **允许组合**（两者正交）；**不得**改变 identity；existing 时仍按 C′ |
| Q3 | Agent 是否暴露 refs | **NO** —— 2-B 只做 CLI `target list`；不扩大 Agent surface |
| Q4 | 显式事务（`BEGIN/COMMIT`） | **NO** —— 原子性来自"全部校验 → 全部派生 → 唯一一次 upsert"；不引入事务抽象 |
| Q5 | 重复的同一 gapId | **合并处理**（集合语义，等价一次）；**不得**产生重复 ref、**不得**改变最终顺序 |
| Q6 | 无效 gap 的报错 / 退出码 | **`deps.err(...)` + `return 1`**，两种文案分开：`未找到研究缺口「<gapId>」` / `研究缺口「<gapId>」不属于行业「<行业>」`；validation failure ⇒ `add()` 不被调用（T-C2-40① 的核心断言） |

### 10.1 新增待你确认（C′ 落地的必要推论）

| # | 问题 | 我的建议 |
|---|---|---|
| **Q7** | **link-only 模式的参数要求**（见 §4.2.1）："只允许改 refs" 与 "五个创建参数必填" 不能同时成立 —— 必须放宽其一 | **Q7a（建议）**：`target add <行业> --name <主体> --for-gap <gapId>...`，创建参数**可省略**（取 existing 值）；若提供则必须与 existing 一致，否则报错。<br>备选 **Q7b**：仍要求全部创建参数，且必须与 existing 逐字段一致，否则报错（更保守、更啰嗦）。 |

---

**PROPOSAL rev2 结束** —— Step 2-B Contract Gate 已给出 **CONDITIONAL PASS**；其裁决（**C′** + Q2–Q6）已写入 §4 与 §10。仅剩 **§10.1 Q7**（link-only 模式的参数放宽）待你确认；在收到 Q7 裁决与 **Step 2-B Implementation Authorized** 之前：**不写任何 Step 2-B 代码**、不 push、不进入 Step 2-C。
