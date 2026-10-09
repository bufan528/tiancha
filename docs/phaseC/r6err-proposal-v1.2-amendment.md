# R6-ERR — SoT Legality Check · Proposal v1.2 Amendment

```text
Kind              : AMENDMENT（限定性规范修订）
Status            : FROZEN — rev6 / ACCEPTED / NOT EFFECTIVE / IMPLEMENTATION NOT AUTHORIZED
Frozen            : YES — rev6 · AUTH=R6ERR-AUTH-06
                    · Bound v1.1: commit=1435a7c7d66acdb19cf2c3babbe2e3e7c7ec83e0
                    · blob=d7cd3c2ff28ff0e5713035df7f5018ac9aecc373
                    · Pre-freeze HEAD=2e0451c5ca33b2a28cba590b0858964e0d4047ac
Acceptance        : R6ERR-AUTH-01（Amendment Acceptance，已签发）—— 内容已正式接受；
                    ★ Acceptance ≠ Amendment 生效；≠ Formal Freeze；≠ Implementation 授权
Amends            : docs/phaseC/r6err-proposal-refinement-record.md（v1.1 · PROPOSED / NOT FROZEN）
Reason            : CF-1（规范优先级未定义）· CF-2（unspecified 语义未澄清）· CF-3（编号歧义）
Scope             : 仅 §3 / §3.1 / §4 / §11 + 命名约定（共 5 项）
Non-Changes       : 【原始 v1.1】的 §1 / §2 / §5 / §6 / §7 / §8 / §9 / §10 与 AD-R6-1 全文不动
Baseline          : HEAD = origin/main = ls-remote = 1435a7c7d66acdb19cf2c3babbe2e3e7c7ec83e0
Does NOT Authorize: Amendment 生效 · Formal Freeze · Implementation · 代码 / 测试 / schema / Methodology 修改
Compatibility     : 对已发布记录的结论【零影响】（§7.1 完整矩阵 + §7.2 逐项依据）
Revision identity : 本文件为【独立新文件】；不替换、不覆盖、不追加进原始 v1.1 原文
Revision history  : rev1（首稿）→ rev2（依第二层审查 REVISE 补严四组）
                    → rev3（依终审 REVISE 闭合 C / D / E，不重开 B）
                    → rev4（依针对性复审闭合 E 项三项 + C/D 附带项）
                    → rev5（依 E 项复审补齐 §7.2 的 E-3 证据覆盖）
                    → **rev6（依 E-3 复审统一原子计数 + 补间接依赖证明）** —— 见 §10
Acceptance history: rev6 经 A–E 审查全部 PASS；经 **R6ERR-AUTH-01** 正式接受（Amendment Acceptance）
                    ⇒ 当前有效状态 = ACCEPTED — rev6 / NOT EFFECTIVE / NOT FROZEN
```

---

## §1 修改 A —— §3 六层模型（GATE / RESOLVER 职责 + L3/L6 许可维度差异）

### 前置（v1.1 【节选】，L52-80）

★ 节选说明：本段为 v1.1 §3 的【节选】，省略了 L2 / L4 的行尾注释
  （v1.1 原文为：`… single | multi | undefined   ← 质量属性，非通过/不通过` 与
   `… deprecated | active         ← 属性，不单独判死`）。
  这些注释在下方「修改后」中保留，**不构成本 Amendment 的新增语义**。
  逐字全文见 `docs/phaseC/r6err-proposal-refinement-record.md` 的 L52-80。

```text
## §3 六层模型（非等价 Gate）
L1 Presence                   〔GATE〕       false ⇒ INVALID（终止）
L2 Ownership                  〔ASSESSMENT〕 single | multi | undefined
L3 Contract Permission        〔GATE〕       deny ⇒ ILLEGAL
L4 Deprecation                〔ASSESSMENT〕 deprecated | active
L5 Competition / Authority Resolution 〔RESOLVER〕
       NONE | EXISTS_AND_AUTHORITY_IDENTIFIED | EXISTS_BUT_AUTHORITY_UNCLEAR
L6 Slice Dependency Legality  〔GATE〕       deny ⇒ ILLEGAL
★ 三类节点语义不同：GATE（可终止）· ASSESSMENT（记录属性）· RESOLVER（消解竞争）
```

### 修改后（v1.2）

```text
## §3 六层模型（非等价 Gate）
L1 Presence                   〔GATE〕       false ⇒ INVALID（终止）
L2 Ownership                  〔ASSESSMENT〕 single | multi | undefined   ← 质量属性，非通过/不通过
L3 Contract Permission        〔GATE〕       deny ⇒ ILLEGAL
L4 Deprecation                〔ASSESSMENT〕 deprecated | active         ← 属性，不单独判死
L5 Competition / Authority Resolution 〔RESOLVER〕
       NONE | EXISTS_AND_AUTHORITY_IDENTIFIED | EXISTS_BUT_AUTHORITY_UNCLEAR
L6 Slice Dependency Legality  〔GATE〕       deny ⇒ ILLEGAL

★ 三类节点语义不同：GATE（可终止）· ASSESSMENT（记录属性）· RESOLVER（消解竞争）
★ 【v1.2 新增】节点类别与优先级的规范原则：
   GATE 类节点（L1 / L3 / L6）承担【可终止的阻断判定】，其判定顺序
   必须【一致地先于】RESOLVER（L5）的消解尝试 ——
   即：不得出现「同类 GATE 之中，一个先于 RESOLVER、另一个后于 RESOLVER」的不一致。
★ 【v1.2 新增】L3 与 L6 的许可维度差异（二者同为 GATE，但维度不同）：
   · L3 = 【契约维度】许可：该来源是否被其契约【允许】作为权威来源
   · L6 = 【审查范围维度】许可：该来源在【当前 Slice】是否被允许依赖
   ⇒ 两者 deny 的处置相同（⇒ ILLEGAL），但语义维度不同；
     任一 deny 均构成阻断，且【不因另一维度的不明确而失效】。
★ 【v1.2 新增】L5 的职责限定：
   L5 是 RESOLVER，职责为【识别竞争权威并尝试消解】；
   它【不】承担阻断职责 —— 其 UNCLEAR 结果表示「无法消解 ⇒ 交人工裁定」，
   而非「禁止」。故 L5 的结果【不得遮蔽】任何 GATE 的 deny。
```

---

## §2 修改 B —— §3.1 Decision Resolution（优先级 + 三值定义 + INVALID 前置 + 轴 2 保留）

### 前置（v1.1 【节选】，L84-108）

★ 节选说明：本段为 v1.1 §3.1 的【节选】，其中
  · 「【属性不判死】……ASSESSMENT 层不单独决定 Decision：」之后的三条子项
    （L2 / L4 / reachability）以 `…` 省略；
  · 「【确定性保证】」一行保留。
  **完整原文**见 `docs/phaseC/r6err-proposal-refinement-record.md` 的 L84-108。
  下方「修改后」给出完整内容（含被省略的三条子项）。

```text
## §3.1 Decision Resolution（属性 → 决定的转换规则）
判定按【确定性短路顺序】执行，首个命中即为最终 SoT Decision：

  R1  L1 Presence = false                        ⇒ INVALID（不入 SoT Decision 枚举）
  R2  L3 Contract Permission = deny              ⇒ ILLEGAL
  R3  L5 = EXISTS_BUT_AUTHORITY_UNCLEAR          ⇒ AMBIGUOUS
  R4  L6 Slice Dependency Legality = deny        ⇒ ILLEGAL
  R5  L5 = EXISTS_AND_AUTHORITY_IDENTIFIED
      且当前来源【非】被指定的权威                ⇒ ILLEGAL（as-SoT）
  R6  以上皆未命中，且（L5 = NONE，或当前来源即被指定权威）⇒ LEGAL

【属性不判死】—— ASSESSMENT 层不单独决定 Decision：…
【确定性保证】同一组六层输入 ⇒ 唯一 Decision（短路顺序固定，无 reviewer 主观空间）
```

### 修改后（v1.2）

```text
## §3.1 Decision Resolution（属性 → 决定的转换规则）

【v1.2 调整】判定按【确定性短路顺序】执行，首个命中即为最终 SoT Decision。
顺序已调整为：**全部 GATE 先于 RESOLVER**（详见 §1 的节点类别原则）：

  R1  L1 Presence = false                        ⇒ INVALID（前置状态，不入三值枚举）
  R2  L3 Contract Permission = deny              ⇒ ILLEGAL
  R4  L6 Slice Dependency Legality = deny        ⇒ ILLEGAL      ← 【v1.2 前移】
  R3  L5 = EXISTS_BUT_AUTHORITY_UNCLEAR          ⇒ AMBIGUOUS    ← 【v1.2 后移】
  R5  L5 = EXISTS_AND_AUTHORITY_IDENTIFIED
      且当前来源【非】被指定的权威                ⇒ ILLEGAL（as-SoT）
  R6  以上皆未命中，且（L5 = NONE，或当前来源即被指定权威）⇒ LEGAL

【v1.2 新增】SoT Decision 三值的规范语义定义（含范围限定）：

  LEGAL     = 依据本规则及【当前审查范围】，允许该来源作为所审查语义的权威来源。
  ILLEGAL   = 依据本规则及【当前审查范围】，不允许该来源作为所审查语义的权威来源。
              ★ 范围限定：本结论限于【当前被审查的语义与 Slice 范围】，
                不得扩张为「该来源在所有场景中均非法」。
  AMBIGUOUS = 现有事实不足以确定该来源是否符合规范，须进入规定的人工裁定流程；
              它【既不代表许可，也不代表禁止】。
  INVALID   = 输入不满足判定前置条件（L1 = false），不能进入上述三值决策；
              它【不是第四种合法性结论】，而是前置状态。

【v1.2 新增】决策与诊断分离（独立不变量 INV-AXIS-1）：
  ① 轴 1（SoT Decision）的短路决策：【只】决定最终结论。
  ② 轴 2（Runtime Attributes）【独立】报告诊断事实。
  ③ 轴 1 的短路决策【不得】删除、覆盖或降低轴 2 已确定的诊断事实。
  ④ 轴 2 的属性【不得】反向改变轴 1 的决策。
  ⇒ 例：L6 = deny 且 L5 = UNCLEAR 时 ⇒ 轴 1 = ILLEGAL；轴 2 仍保留 competing = UNCLEAR。

【v1.2 新增】CF-2 —— Contract Permission 取值语义（unspecified ≠ allow）：
  · allow        = 契约【明确允许】。
  · deny         = 契约【明确禁止】⇒ 阻断（R2 ⇒ ILLEGAL）。
  · unspecified  = 契约【未作出明确许可或禁止】。
      ⇒ 它【不构成 deny】，因此不阻断；
      ⇒ 但【不得被表述或实现为 allow】；它只表示「该层未提供阻断或放行的依据」，
        允许【后续适用的判定规则】继续判断
        （判定规则 = L5 / L6 及其对应规则；**不含 L4** —— L4 仅作属性记录，见下方 rev3 修正）。
  ★ 【v1.2-rev2 补严】unspecified 的规范地位（区分「未阻断」与「已明确许可」）：
      `unspecified` 本身【既不构成明确许可，也不构成阻断】。
      【v1.2-rev3 修正】`unspecified` 不命中 R2 后，【继续执行剩余适用的判定规则】；
      最终 Decision 由【整套判定规则】得出。
      ★ 注意（避免与 ASSESSMENT 定义冲突）：L4 是 ASSESSMENT，【仅作属性记录】，
        **不参与 Decision 的判定**；上述「剩余适用的判定规则」指
        **按既定顺序适用的 R4 → R3 → R5 → R6**（【规则编号】，非层编号），**不含 L4**。
        ⇒ 表述纪律：此处用【规则编号 R4/R3/R5/R6】而非【层编号 L5/L6】，
          以免把「层」与「规则」混为同一对象（详见 §4 命名约定）。
      但若最终结果为 LEGAL，【不得】将该结果解释为「L3 已提供明确许可」——
      LEGAL 的来源是【整套判定规则】，而非 L3 的许可。
      ⇒ 反例（须避免的实现误读）：L3=unspecified · L5=NONE · L6=allow ⇒ R6 ⇒ LEGAL
        该 LEGAL 表示「在当前范围内未发现阻断且无竞争」，
        【不表示】「契约已明确允许该来源作为权威来源」。
  · missing / unknown / unavailable 是否归入 unspecified，
      【必须由输入契约明确定义】，不得自动合并。
  ⇒ 与 H-1 INV-6 的区别（不得混同）：
     H-1 的 policy ref 缺失 = 【配置完整性】问题（⇒ THROW）；
     R6-ERR 的 unspecified = 【契约许可维度】的一种状态（⇒ 不阻断、不放行）。

【属性不判死】—— ASSESSMENT 层不单独决定 Decision：
  · L2 Ownership = undefined / multi   ⇒ 仅作属性输出；仅在 L5 无法消解 authority 时【经 R3】转 AMBIGUOUS
  · L4 Deprecation = deprecated        ⇒ 仅作属性输出，不单独判 ILLEGAL（deprecation 是【证据】而非【判据】）
  · reachability                       ⇒ 不入本判定（属轴 2，独立报告）

【确定性保证】同一组六层输入 ⇒ 唯一 Decision（短路顺序固定，无 reviewer 主观空间）
```

---

## §3 修改 C —— §4 输出模型（两轴独立 + 诊断事实完整保留）

### 前置（v1.1 【节选】，L128-140）

★ 节选说明：本段为 v1.1 §4 的【节选】—— 省略了轴 2 四个属性的取值枚举展开
  （v1.1 原文为：`ownership · deprecated · competing · reachability`，未展开取值）。
  下方「修改后」给出展开后的完整取值枚举（**取值本身取自 v1.1 的别处表述，非新增语义**）。
  逐字全文见 `docs/phaseC/r6err-proposal-refinement-record.md` 的 L128-140。

```text
## §4 输出模型（双轴，G-4）
【轴 1】SoT Decision          LEGAL | ILLEGAL | AMBIGUOUS
    （INVALID 属前置状态，非 Decision 值）
    · LEGACY / UNREACHABLE 不进入本枚举
【轴 2】Runtime Attributes（独立报告，不参与轴 1 判定）
    ownership · deprecated · competing · reachability
```

### 修改后（v1.2）

```text
## §4 输出模型（双轴，G-4）

【轴 1】SoT Decision          LEGAL | ILLEGAL | AMBIGUOUS
    （INVALID 属前置状态，非 Decision 值）
    · LEGACY / UNREACHABLE 不进入本枚举
    · 【v1.2】三值的规范语义定义见 §3.1

【轴 2】Runtime Attributes（独立报告，不参与轴 1 判定）
    ownership     = single | multi | undefined | NOT_EVALUATED
    deprecated    = true | false | NOT_EVALUATED
    competing     = NONE | IDENTIFIED | UNCLEAR | NOT_EVALUATED
    reachability  = WIRED | TEST_ONLY | UNREACHABLE | NOT_EVALUATED

★ 【v1.2 新增】两轴的独立性与完整性（对应 §3.1 的 INV-AXIS-1）：
   ① 轴 1 与轴 2 【相互独立】—— 轴 2 不参与、不覆盖轴 1；轴 1 不删减、不降级轴 2。
   ② 轴 1 的短路决策【不减少】轴 2 的记录：即使轴 1 = ILLEGAL，
      轴 2 中已确定的诊断事实（如 competing = UNCLEAR、reachability = TEST_ONLY）仍完整保留。
   ③ 反向亦然：保留或补充轴 2 的诊断属性，【不得改变】轴 1 的决策。
   ⇒ 设计意图：既不让「权威归属不明确」遮蔽「硬性禁止」，也不丢失该事实本身。

★ 【v1.2-rev2 补严 ①】L5 → 轴 2 `competing` 的映射（须明确，防实现分歧）：

    L5 取值（§3）                                  → 轴 2 `competing`
    ────────────────────────────────────────────────────────────────
    NONE                                          → NONE
    EXISTS_AND_AUTHORITY_IDENTIFIED               → IDENTIFIED
    EXISTS_BUT_AUTHORITY_UNCLEAR                  → UNCLEAR

    ★ 语义限定：`competing = IDENTIFIED` 仅表示【竞争来源已被识别】（且权威已在 L5 中消解），
      **不等同于**「当前来源是权威」。当前来源是否为权威，由 R5 / R6 判定（见 §3.1），
      不得由轴 2 的 `IDENTIFIED` 反推。

★ 【v1.2-rev2 补严 ②】已知事实 vs 未评估事实（防「短路后必须补算全部诊断」的误解）：
    · 轴 1 短路后【必须保留】的是：【已经获得、已经确定】的诊断事实。
    · 轴 1 短路【不要求】继续执行全部昂贵或不适用的诊断计算。
    · 【不得】把【尚未评估】的属性伪造成「已确定值」（例如：未评估 reachability 时，
      不得默认写 WIRED / TEST_ONLY / UNREACHABLE 中的任一项）。
    · 若某属性未评估，应显式标记为【未评估】，而非赋予一个看似确定的取值。

★ 【v1.2-rev3 新增】`NOT_EVALUATED` 的规范语义与四条边界（闭合 D 项）：

    ① `NOT_EVALUATED` 表示【评估状态】，不是业务结论。
       它表示本次审查【尚未对该属性完成评估】，**不代表**「没有竞争」「没有弃用」
       「不可达」或任何其他确定事实。

    ② `ownership = undefined` 与 `ownership = NOT_EVALUATED` **必须可区分**。
       前者保留原有的【所有权属性语义】（单/多/未声明）；
       后者表示【本次尚未评估】。两者**不得互相转换或合并**。

    ③ 诊断短路时【保留已知事实】，但【不强制补算】全部属性：
         已知 L6=deny · L5 已评估为 UNCLEAR  ⇒ Decision = ILLEGAL，competing = UNCLEAR
         已知 L6=deny · L5 尚未评估          ⇒ Decision = ILLEGAL，competing = NOT_EVALUATED
       ★ 限制：若当前决策流程【必须】依赖 L5 才能区分 R3 / R5 / R6，
         则**不得**以 `NOT_EVALUATED` 代替 L5 的必要评估（必须完成该评估）。

    ④ `NOT_EVALUATED` **不得反向影响轴 1**。
       它只是轴 2 的状态标记 ——
       · 不得因某项诊断未评估，就把已确定的 LEGAL / ILLEGAL 擅自改为 AMBIGUOUS；
       · 也不得让一个尚未计算的属性被当作「已确定的放行依据」。

    ★ 【v1.2-rev4 新增】实现前约束（保留项，不得在后续实现中弱化）：
       `NOT_EVALUATED` 是【轴 2 的显式状态标记】，
       **不是**对「必要决策输入缺失」的通用豁免。
       ⇒ 若某属性是当前决策【必需】的输入（如判定 R3 / R5 / R6 需要 L5），
         则必须先完成该评估，不得以 `NOT_EVALUATED` 规避。
```

---

## §4 修改 D —— 命名约定（新增，闭合 CF-3）

### 前置（v1.1 ——【无对应条款】）

★ 说明：v1.1 【不存在】命名约定段，故本项无「节选」可标。
  以下内容为对本 Amendment 写作过程中的编号使用事实的【描述】，不是 v1.1 的原文引用。

```text
（无命名约定；§3 用 L1–L6 表示层，§3.1 用 R1–R6 表示规则；
  且 R1–R6 与 H-2 审计记录中的 §R1–R10（章节编号）形式相同 ⇒ 跨文档误引风险）
```

### 修改后（v1.2 · 新增命名约定段）

```text
## 命名约定（v1.2 新增）

  L1–L6   = 六个【审查维度】（Layers）        —— 仅用于 §3 的层级模型
  R1–R6   = R6-ERR 内部的六条【判定规则】（Rules）—— 仅用于 §3.1 与 §4
  §Rx     = 外部文档的【章节编号】（如 H-2 §R1–R10）

★ 引用纪律：
   · 在本方法内部引用规则时，使用 `R1`–`R6`（可加前缀 `R6-ERR` 以消歧）。
   · 引用其它审计记录的章节时，【必须】带上文档标识与章节符号
     （例：`H-2 §R1`、`H-3 §R3`），不得仅写裸编号 `R1`、`R2`。
★ 若未来调整规则编号，必须同步更新：§3.1 的规则表、§4 的引用、以及情形对照表中的「命中规则」列。
```

---

## §5 修改 E —— §11 修订历史（追加，不覆盖原始历史）

### 前置（v1.1 【逐字全文】，L248-259）

★ 说明：本段为 v1.1 §11 修订历史的【逐字全文】（该节仅 12 行，无需节选）。
  下方「追加」为 append-only，**不修改上述任何一行**。

```text
## §11 修订历史
v1    L6 Slice Legality → L6 Slice Dependency Legality
      新增 §3.1 Decision Resolution（R1–R6 确定性短路 + 属性不判死 + 情形对照表）
      §1 措辞：读取…的合法权威性 → 作为…的合法权威来源

v1.1  §7 G-3 措辞收紧：Architecture-authoritative by existing repository architecture
        → Architecturally treated as the current authority by the existing KnowledgeRepository
          architecture and production usage, but LACKING an explicit normative authority clause
      §8 Case 2 更名：current predicate 反例 → current predicate 权威示例
```

### 追加（v1.2 · append-only，不修改上述两行）

```text
v1.2  【规范性修订 —— 本 Amendment 文件，v1.1 原文不动】
      ① §3    新增节点类别与优先级原则（GATE 应一致地先于 RESOLVER）；
              新增 L3 / L6 的许可维度差异（契约维度 vs 审查范围维度）；
              新增 L5 的职责限定（RESOLVER 不承担阻断，其 UNCLEAR 不得遮蔽 GATE 的 deny）
      ② §3.1  调整短路顺序：R1 → R2(L3 GATE) → R4(L6 GATE) → R3(L5 RESOLVER) → R5 → R6
              新增 SoT Decision 三值规范语义定义（含 ILLEGAL 的当前范围限定）
              新增 INV-AXIS-1（决策与诊断分离，四条）
              新增 CF-2 条款（Contract Permission 取值语义；unspecified ≠ allow）
      ③ §4    新增两轴独立性与完整性声明（对应 INV-AXIS-1）
      ④ 命名约定  新增 L / R / §R 三类编号的区分与引用纪律
      ★ 未改动【原始 v1.1】的 §1 / §2 / §5 / §6 / §7 / §8 / §9 / §10 与 AD-R6-1
```

---

## §6 CF 闭合对照

| CF | 原问题 | 本 Amendment 的闭合位置 | 闭合方式 |
|---|---|---|---|
| **CF-1** | 规范优先级未定义（A↔D 不一致；L6 被 R3 遮蔽；缺三值语义） | §1（节点类别原则）· §2（顺序调整 R2→R4→R3）· §2（三值定义） | 顺序调整 + 语义定义（**非**纯文本） |
| **CF-2** | `unspecified` 语义未澄清；不得误读为 allow | §2（CF-2 条款段） | 显式条款（**不**仅在修订历史提及） |
| **CF-3** | L / R / §R 编号歧义 | §4（命名约定段）· §5（引用纪律） | 显式命名约定 |

---

## §7 兼容性影响

### §7.1 完整的新旧决策差异矩阵（输入域 = L1=true 下 L3 × L5 × L6 全 18 组）

```text
输入域：L3 ∈ { deny, allow, unspecified }（3）· L5 ∈ { NONE, IDENTIFIED, UNCLEAR }（3）· L6 ∈ { deny, allow }（2）
⇒ 3 × 3 × 2 = 18 组（L2 / L4 为 ASSESSMENT，不影响 Decision）
★ 矩阵适用范围限定：本矩阵仅在【L1 = true】且按上述 L3 / L5 / L6 取值组合计算；
  依赖「当前来源是否为被指定权威」的 R5 分支，**已在 #10 / #16 行内显示**（见下）。
★ 【v1.2-rev4 新增】矩阵标签与 §3 规范值的映射声明（防实现者误读）：
    本矩阵中的 `IDENTIFIED` 是 §3 规范值 **`EXISTS_AND_AUTHORITY_IDENTIFIED`** 的【展示简称】；
    本矩阵中的 `UNCLEAR`    是 §3 规范值 **`EXISTS_BUT_AUTHORITY_UNCLEAR`** 的【展示简称】；
    本矩阵中的 `NONE`       即 §3 规范值 `NONE`（无简称）。
    ⇒ 这些简称【仅为本矩阵的展示形式】，**不构成新增的 L5 规范取值**。
    ⇒ 不得将它们与【轴 2 的 `competing` 枚举】混同 ——
      轴 2 的 `competing = NONE | IDENTIFIED | UNCLEAR` 是【诊断属性输出】，
      而本矩阵的 L5 是【输入维度】；二者由 §4 的映射表（L5 → competing）关联，但**不是同一对象**。
```

★ 【v1.2-rev3 新增】关于 **`L3 = unspecified`** 的旧版结果（适用假设声明）：

```text
原始 v1.1 已在 §3 列出 `unspecified` 这一取值（`↓ allow / unspecified`），
但【未完整定义其规范语义】。

因此，本矩阵中 #13–#18 的「v1.1 结果」，是在以下【适用假设】下机械应用 v1.1 规则所得：
    将 `unspecified` 视为【不匹配 R2 的 deny 条件】，继而按 v1.1 的原有规则顺序继续执行。

★ 这些结果仅用于与 v1.2 作【条件一致的规则比较】，
  **不代表原始 v1.1 已明确规定了 `unspecified` 的完整规范语义**。

★ 本矩阵的【唯一决策顺序变化】仍为 #11 与 #17：
    当 L5 = UNCLEAR 且 L6 = deny 时，v1.1 的规则顺序得出 AMBIGUOUS，v1.2 的规则顺序得出 ILLEGAL。
```

| # | L3 | L5 | L6 | v1.1 顺序命中 | v1.1 结果 | v1.2 顺序命中 | v1.2 结果 | 是否变化 |
|---|---|---|---|---|---|---|---|---|
| 1 | deny | NONE | deny | R2 | ILLEGAL | R2 | ILLEGAL | — |
| 2 | deny | NONE | allow | R2 | ILLEGAL | R2 | ILLEGAL | — |
| 3 | deny | IDENTIFIED | deny | R2 | ILLEGAL | R2 | ILLEGAL | — |
| 4 | deny | IDENTIFIED | allow | R2 | ILLEGAL | R2 | ILLEGAL | — |
| 5 | deny | UNCLEAR | deny | R2 | ILLEGAL | R2 | ILLEGAL | — |
| 6 | deny | UNCLEAR | allow | R2 | ILLEGAL | R2 | ILLEGAL | — |
| 7 | allow | NONE | deny | R4 | ILLEGAL | R4 | ILLEGAL | — |
| 8 | allow | NONE | allow | R6 | LEGAL | R6 | LEGAL | — |
| 9 | allow | IDENTIFIED | deny | R4 | ILLEGAL | R4 | ILLEGAL | — |
| 10 | allow | IDENTIFIED | allow | **两分支**：<br>· 当前来源【非】指定权威 → **R5 → ILLEGAL**<br>· 当前来源【即】指定权威 → **R6 → LEGAL** | 同左（两分支均**不变**） | 同左 | 同左 | —（两分支均不变） |
| **11** | **allow** | **UNCLEAR** | **deny** | **R3** | **AMBIGUOUS** | **R4** | **ILLEGAL** | **★ 变化** |
| 12 | allow | UNCLEAR | allow | R3 | AMBIGUOUS | R3 | AMBIGUOUS | — |
| 13 | unspecified | NONE | deny | R4 | ILLEGAL | R4 | ILLEGAL | — |
| 14 | unspecified | NONE | allow | R6 | LEGAL | R6 | LEGAL | — |
| 15 | unspecified | IDENTIFIED | deny | R4 | ILLEGAL | R4 | ILLEGAL | — |
| 16 | unspecified | IDENTIFIED | allow | **两分支**：<br>· 当前来源【非】指定权威 → **R5 → ILLEGAL**<br>· 当前来源【即】指定权威 → **R6 → LEGAL** | 同左（两分支均**不变**） | 同左 | 同左 | —（两分支均不变） |
| **17** | **unspecified** | **UNCLEAR** | **deny** | **R3** | **AMBIGUOUS** | **R4** | **ILLEGAL** | **★ 变化** |
| 18 | unspecified | UNCLEAR | allow | R3 | AMBIGUOUS | R3 | AMBIGUOUS | — |

```text
★ 「完整矩阵」的精确定义（v1.2-rev4 收紧）：
    ① 完整枚举【三个输入维度】的 18 组组合（L3 × L5 × L6）；
    ② 对依赖 R5 的行（#10 / #16），额外列出【当前来源权威身份】这一条件分支（两分支）。
  ⇒ 因此本矩阵【不】宣称「三维输入值足以唯一决定所有行的结果」；
     除 #10 / #16 外的其余 16 行，确由三维输入唯一决定。

★ 精确结论（不再使用示例式表述）：
    变化组数 = **2 / 18**（#11 与 #17）
    组合特征 = 「L3 ≠ deny · L5 = UNCLEAR · L6 = deny」
    变化方向 = AMBIGUOUS（R3 先命中） → ILLEGAL（R4 前移命中）
    不变组数 = **16 / 18**（含 L3=deny 全部 6 组、L6=allow 全部 9 组、
                L5=NONE/IDENTIFIED 全部 12 组中的非 UNCLEAR 部分）
    ★ #10 / #16 的 R5 两分支在 v1.1 与 v1.2 中【均不变】，故不进入变化组统计。

★ 说明（回应第二层审查 E 项 · rev4 修正）：
    · rev2/rev3 曾把 R5 分支仅写在【表外注释】；rev4 已将其【纳入矩阵本身】（#10 / #16 行内）。
```

### §7.2 对已发布记录「零影响」的逐项可追踪依据

```text
核验范围：H-1 / H-2（含 §R1–R10 与 E-1 Erratum）/ H-3（含 H3-01…H3-05 与 F-1 / F-2）/
          H-4（H4-01…H4-04）/ H-5（H5-01…H5-03）/ H-6（G1–G6）

核验方法（v1.2-rev3 收紧措辞）：【定向核查及逐项依据】——
  对每条记录的【具体断言】，定位其【实际依据】，判断该依据是否落在 §7.1 的变化组
  （#11 / #17 = 「L3 ≠ deny · L5 = UNCLEAR · L6 = deny」）之内。
  ★ 本项为定向核查，非可复现的自动统计（故不使用「自动统计」措辞）。
```

### §7.2.1 逐项核验覆盖与直接依赖（原子断言口径）

| 记录 | 核验项（**覆盖该记录声明的全部范围 · 原子断言口径**） | 断言的实际依据 | 是否依赖 #11/#17 | 核验结论 |
|---|---|---|---|---|
| **H-1** | **INV-1…INV-6（6 项）**：current 唯一来源 · policy 唯一解析链 · 非 current 不计入 · facts/score/evidenceRefs 同源 · provenance 独立 · 不 silently fallback | Evaluation 的 sufficiency 输入集合与 `Requirement → sufficiencyPolicyRef → PolicyRegistry` 解析链；`evaluation-service.ts:174` 经 `listCurrentBeliefs` 取 current | **不适用**（6/6）—— 该记录全程**不引入** L3 / L5 / L6 中任一输入维度；其判定对象为「current belief 过滤」与「policy version 解析」 | 不受影响 |
| **H-2** | **§R1 / §R2 / §R3 / §R4 / §R5 / §R6 / §R7 / §R8 / §R9（9 项）· H2-01 / H2-02 / H2-03 / H2-04（4 项）· E-1 Erratum（1 项）＝ 14 项** | **仅 H2-01** 涉及 L3/L5/L6：其 ILLEGAL 依据 **R2**（`L3 = deny`）⇒ 落在 §7.1 **#1–#6** 范围。<br>其余 13 项均为**结构性事实**（SoT 唯一性 / 写入路径 / 读取入口与其返回语义 / 状态矩阵 / version 归属 / legacy 列零读取 / 边界分类 / 事实勘误）—— **均不引入 L3/L5/L6 输入**（间接依赖另见 §7.2.2） | · **H2-01 = 否**（`L3 = deny` 组；两版结果**均为 ILLEGAL**）<br>· §R1–§R9（9）+ H2-02 / H2-03 / H2-04（3）+ E-1（1）= **不适用（13）** | 不受影响 |
| **H-3** | **H3-01 / H3-02 / H3-03 / H3-04 / H3-05 / F-1 / F-2（7 项）** | H3-03 属 **Runtime Reachability（轴 2）**；H3-01 / H3-04 = authority 归属（见 §7.2.2）；H3-02 / H3-05 = 类型与 version 事实；F-1 / F-2 = 否证过程<br>⇒ 均**不引入 L3/L5/L6 输入** | **不适用**（7/7）—— 见 §7.2.2 对 H3-01 / H3-04 的间接依赖补证 | 不受影响 |
| **H-4** | **H4-01 / H4-02 / H4-03 / H4-04（4 项）** | H4-01 的未知量为**运行可达性**（Reachability 轴 2），依据 **Transition Legality ≠ Runtime Reachability**；H4-03 为**状态单向映射语义**（见 §7.2.2）；H4-02 / H4-04 为类型与跨层耦合的**设计声明** | **不适用**（4/4）—— 见 §7.2.2 | 不受影响 |
| **H-5** | **H5-01 / H5-02 / H5-03（3 项）** | H5-03 的 LEGAL 依据 H-5 §6 的 **Semantic Authority ⟂ Runtime Reachability** 与逐字理由（独立于 R6-ERR Decision，见 §7.2.2）；H5-01 / H5-02 = version 分层与类型事实 | **不适用**（3/3）—— 见 §7.2.2 | 不受影响 |
| **H-6** | **G1 / G2 / G3 / G4 / G5 / G6（6 项）** | **仅 G1** 产生 L3/L5/L6 输入：其 ILLEGAL 结论（`currentKnowledgeId`）依据 **R2**（`L3 = deny`；`research-commands.ts:239` 禁令 + `knowledge-repository.ts:44` 竞争源）⇒ 落在 §7.1 **#1–#6**。<br>G2 = 四列 authority 分离；G3 = 六者不混且反向映射 = 0；G4 = version 语义分层；G5 = 三场景 Extension Safe；G6 = contradiction / combined risk = 0 | · **G1 = 否**（`L3 = deny` 组；两版**均为 ILLEGAL**）<br>· G2 / G3 / G4 / G5 / G6 = **不适用（5）** | 不受影响 |

### §7.2.2 间接依赖补证（回应「不引入输入维度 ≠ 无间接依赖」）

```text
问题：某项断言可能【消费轴 1 的既有判定结果】或【依赖 L5 的权威消解结果】，
      即使其不直接引入 L3/L5/L6 输入，仍可能间接受影响。
补证字段：① 是否消费轴 1 Decision ② 是否消费 L5 消解结果 ③ 依赖路径 ④ 变更影响
覆盖范围：你点名的 H3-01 / H3-04 / H5-03，以及 H-2 / H-4 中可能「先使用 SoT 或 authority 结论」的项。
```

| 核验项 | ① 是否消费轴 1 Decision | ② 是否消费 L5 消解结果 | ③ 依赖路径（实际依据） | ④ 变更影响 |
|---|---|---|---|---|
| **H3-01** 三层分离（`ResearchState` / KPS / `current_state_id`） | **否** | **否** | 依据为 **静态结构事实**：`ResearchState` 是 domain 表示、KPS 是维护入口、`industry.current_state_id` 是 projection write；三者由【代码位置 + 三层分离头注】确立，**不涉及任何已计算的 SoT Decision** | 不命中 #11/#17（该断言不经过 §3.1 的规则链） |
| **H3-04** Requirement authority 分工 | **否** | **否** | 依据为 **两个 writer 的调用点**（creation = `opportunity-discovery-service.ts:167`；status sync = `knowledge-projection-service.ts:854`）及其语义差异；**不消费**任何 SoT Decision | 不命中（writer 分工事实与 §3.1 规则链正交） |
| **H5-03** `METHODOLOGY_V1` fallback = LEGAL | **否** | **否** | 该 LEGAL 由 **H-5 §6 的正交关系（Semantic Authority ⟂ Runtime Reachability）** 加上 `report-service.ts:88-92` / `research-plan-service.ts:87-93` 的**逐字设计理由**独立得出；**并非** R6-ERR 的 SoT Decision 输出 | 不命中（其 LEGAL 来源是设计理由，非 §3.1 判定） |
| **H-2 §R2** Requirement SoT | **否** | **否** | 依据为 `repo.listRequirements(subjectId)` 为**唯一入口**的结构事实（8 处调用点同入口）；不消费 SoT Decision | 不命中 |
| **H-2 §R4** Knowledge Read Path | **否** | **否** | 依据为读取入口（`listCurrentBeliefs` / `findKnowledgeBySubject`）**及其返回语义**；不消费 SoT Decision，也不依赖竞争权威消解 | 不命中 |
| **H-2 §R7** Policy Provenance | **否** | **否** | 依据为 policy `versionId` 的**持久化字段与解析链**（`Requirement → sufficiencyPolicyRef → PolicyRegistry`）；不消费 SoT Decision | 不命中 |
| **H-4 H4-03** PoolSlot→Gap→Requirement 映射链 | **否** | **否** | 依据为 **单向映射代码**（`knowledge-projection-service.ts:665-696` + `syncRequirementStatus`）；不消费 SoT Decision，也【无反向路径】（H-6 G3 已证反向映射 = 0） | 不命中 |
| **H-4 H4-01** `TaskStatus.cancelled` DECLARED-BUT-UNWIRED | **否** | **否** | 依据为 **Transition Legality ≠ Runtime Reachability**（H-4 既定正交关系）+ 生产赋值点 = 0；其未知量属**轴 2 的 Reachability**，而轴 2 不参与轴 1 判定（§3.1 INV-AXIS-1 ①） | 不命中 |
| **其余「不适用」项**（未在上表逐项列出者） | **否** | **否** | 均为静态结构事实 / 类型事实 / version 归属 / 否证证据 / 事实勘误，其依据**不经过 §3.1 的规则链**，故不消费轴 1 Decision 或 L5 消解结果 | 不命中 |

```text
★ 补证结论：
    · 上表【逐项列出】的 9 类高风险项，均为【否 / 否】——
      **不消费轴 1 Decision，也不消费 L5 消解结果**；
    · 其余「不适用」项依据同类（静态结构 / 类型 / version / 否证 / 勘误），
      亦不经过 §3.1 规则链 ⇒ 同样不消费上述判定结果；
    ⇒ 因此可就间接依赖层面确认：**无「不适用」项间接受 #11/#17 影响**。

★ 证据边界（诚实声明）：
    ① 上表逐项列出的是【间接依赖风险较高】的 9 类；其余项按【同类依据】归并说明。
    ② 若你要求【40 项全部逐一列出四字段】，可另行指示——本轮按你「不必为每项都编写完整流程图」的
       指示，仅对高风险项逐项补证。
```


```text
★ 覆盖核对（回应 E-3 的覆盖差距 · **原子断言口径**）：
    H-1  INV-1…INV-6                        ✔ 6 项
    H-2  §R1–§R9、H2-01…H2-04、E-1 Erratum   ✔ 14 项
    H-3  H3-01…H3-05、F-1、F-2               ✔ 7 项
    H-4  H4-01…H4-04                        ✔ 4 项
    H-5  H5-01…H5-03                        ✔ 3 项
    H-6  G1–G6                              ✔ 6 项
    ─────────────────────────────────────────────────
    合计                                     40 项

★ 逐项类别统计（共 **40** 项原子核验项）：
    「否」    = **2 项** —— H2-01（ILLEGAL · R2 · `L3 = deny`）· H6-G1（ILLEGAL · R2 · `L3 = deny`）
    「不适用」= **38 项**
    「待核」  = **0 项**
    ★ 计数校验：2 + 38 = 40 ✔
    ★ 口径说明：统计单位为【原子断言】——
      H-2 的 §R10 已按其原子子项展开为 H2-01…H2-04（而非计为 1 项），
      以保证【分母】与【分类】使用同一粒度（回应第二层审查的计数不一致问题）。

★ 间接依赖补证结果（§7.2.2）：
    逐项列出的 9 类高风险项均为【不消费轴 1 Decision / 不消费 L5 消解结果】；
    其余「不适用」项按同类依据归并说明，亦不经过 §3.1 规则链
    ⇒ 间接依赖层面同样确认：**无「不适用」项间接受 #11/#17 影响**。

★ 结论（范围已收敛至证据可支撑的程度）：
    在【上述 40 项原子核验项】这一【已声明范围内】，
    **无任何项**以 §7.1 的 #11 / #17 组合为判定输入，且**无任何项**间接受其影响；
    仅有的 2 项产生 L3/L5/L6 输入的（H2-01 / H6-G1）均落在 **#1–#6**，
    而该组在 v1.1 与 v1.2 中结果一致（均为 ILLEGAL）⇒ **零影响成立**。

★ 声明（证据边界 · 收紧表述）：
    ① 本 §7.2 为【定向核查及逐项依据】（非自动统计）。
    ② 核验范围为上列 **40 项**；本项**不宣称**超出该范围的任何结论。
    ③ 每项的依据均标注到【具体断言与其事实来源】；
       对「不适用」项，已说明其为何不以 L3/L5/L6 为输入（§7.2.1）
       以及为何不消费轴 1 / L5 的判定结果（§7.2.2）。
    ④ §7.2.2 对【高风险 9 类】逐项补证；其余项按同类依据归并说明
       （遵循「不必为每项都编写完整流程图」的指示）。

★ 定位说明（回应「不能仅以归类为由认定不受影响」）：
    对 H-2 §R4（Knowledge Read Path）等曾被简单归类为「读取路径」的项，
    §7.2.1 给出的理由是【该断言的判定对象是读取入口及其返回语义，
    **不引入** L3 / L5 / L6 三个输入维度中的任何一个】——
    即从【输入维度】而非【分类标签】说明其不适用；
    §7.2.2 进一步补充【不消费轴 1 Decision / 不消费 L5 消解结果】的间接依赖确认。
```

### §7.3 其余影响

```text
★ 对 R6-ERR 自身 Case 库的影响：零 ——
    Case 1（ILLEGAL · R2 · L3=deny）⇒ §7.1 #1–#6 范围，结果不变
    Case 4（AMBIGUOUS · currentStateId）⇒ 见 §7.1，L5=UNCLEAR 但 L6 ≠ deny ⇒ 仍 AMBIGUOUS
    Case 5（LEGAL · R6 · L5=NONE）⇒ #8/#14 范围，结果不变

★ 对实现的（未来）影响：无 —— 尚无任何实现。

★ 对确定性保证的影响：不变 —— 仍为「同一组输入 ⇒ 唯一输出」（§3.1 确定性保证）；
    且 §7.1 已穷举 18/18 组合，每组均有唯一结果。
```

---

## §8 明确不授权

```text
❌ 本 Amendment 生效（当前状态 = FROZEN — rev6 / ACCEPTED / NOT EFFECTIVE / IMPLEMENTATION NOT AUTHORIZED；
   R6ERR-AUTH-01 仅接受内容、R6ERR-AUTH-06 仅完成 Formal Freeze，均未使 Amendment 生效）
❌ 冻结快照的后续修改 / 解冻（依 D-4，须独立授权；FROZEN 标记不得删除或弱化）
❌ 任何超出 R6ERR-AUTH-06 范围的 Freeze 后续治理动作（须独立授权）
❌ Implementation Contract / Preflight / Implementation（仍须独立授权）
❌ 修改【原始 v1.1】的原文（本文件为独立新文件；原始 v1.1 不动，且不随本文件冻结）
❌ 修改代码 / 测试 / schema / Methodology / Version / Human Gate
❌ 修改 H-1 ～ H-6 任何已发布记录
❌ 任何 WATCH 修复 / legacy cleanup / subject-kind 重构 / AD-R6-1 实施
❌ push（本文件已按 R6ERR-AUTH-03 完成 Stage、按 R6ERR-AUTH-04 完成本地 Commit、
   按 R6ERR-AUTH-06 完成**本地** Formal Freeze；
   已完成 Stage / 本地 Commit / Formal Freeze ≠ 授权 Push；
   本地 Commit / Freeze ≠ 已发布；Freeze ≠ Amendment 生效；Freeze ≠ Implementation 授权）
```

---

## §9 逐条对照总表（旧版 → 新版）

| # | 位置 | v1.1 | v1.2 | 类型 |
|---|---|---|---|---|
| 1 | §3 | 无节点类别优先级原则 | 新增「GATE 应一致地先于 RESOLVER」原则 | 新增 |
| 2 | §3 | L3 / L6 未声明维度差异 | 新增「契约维度 vs 审查范围维度」 | 新增 |
| 3 | §3 | L5 无职责限定 | 新增「RESOLVER 不承担阻断；UNCLEAR 不得遮蔽 GATE 的 deny」 | 新增 |
| 4 | §3.1 | 顺序 R1→R2→**R3**→R4→R5→R6 | 顺序 R1→R2→**R4**→R3→R5→R6 | **语义变更** |
| 5 | §3.1 | 无三值语义定义 | 新增 LEGAL / ILLEGAL / AMBIGUOUS / INVALID 定义（含范围限定） | 新增 |
| 6 | §3.1 | 无轴分离不变量 | 新增 INV-AXIS-1（四条） | 新增 |
| 7 | §3.1 | 无 unspecified 条款 | 新增 CF-2 条款（unspecified ≠ allow；与 H-1 INV-6 的区别） | 新增 |
| 8 | §4 | 无两轴独立性声明 | 新增两轴独立性 + 诊断完整保留 | 新增 |
| 9 | （新） | 无命名约定 | 新增 L / R / §R 区分与引用纪律 | 新增 |
| 10 | §11 | 止于 v1.1 | 追加 v1.2 行（append-only） | 追加 |
| 11 | §1/§2/§3/§4/§5 的前置标题 | 「前置（v1.1 原文…）」 | 改为「前置（v1.1 **【节选】**…）」并加节选说明；无对应条款者标「【无对应条款】」 | rev2 补严（A） |
| 12 | 全文件术语 | 「未修改 v1.1 §x」 | 改为「未修改**【原始 v1.1】**的 §x」（4 处） | rev2 补严（A） |
| 13 | §3.1 CF-2 条款 | 仅「不构成 deny / 不得表述为 allow」 | 新增**【v1.2-rev2 补严】unspecified 的规范地位**段（区分「未阻断」与「已明确许可」+ 反例） | rev2 补严（C） |
| 14 | §4 修改后 | 仅两轴独立四原则 | 新增**补严 ①** L5 → `competing` 映射表（含 IDENTIFIED ≠ 当前来源是权威）；**补严 ②** 已知事实 vs 未评估事实 | rev2 补严（D） |
| 15 | §7 | 示例式「其余组合不变」+ 无依据的「零影响」 | 改为 **§7.1 完整 18 组差异矩阵** · **§7.2 零影响核验范围与逐项依据** · §7.3 其余影响 | rev2 补严（E） |
| 16 | §10（新） | 无 | 新增「本 Amendment 的修订记录（rev1 → rev2）」 | rev2 新增 |
| 17 | §3.1 CF-2 段 | 「依据其余适用规则（**L4** / L5 / L6 及其判定）得出」 | 改为「不命中 R2 后继续执行剩余适用的判定规则」，并显式声明 **L4 不参与 Decision 判定**（仅 L5 / L6 及其对应规则 R3/R4/R5/R6） | rev3 闭合（C） |
| 18 | §4 轴 2 + 补严 ③ | 四属性枚举无「未评估」表示；仅要求「显式标记」 | 四属性取值域各增 `NOT_EVALUATED`；新增补严 ③ 定义其规范语义与四条边界（评估状态非业务结论 · 与 `undefined` 可区分 · 不强制补算 + L5 必需评估例外 · 不得反向影响轴 1） | rev3 闭合（D） |
| 19 | §7.1 / §7.2 | §7.1 无适用假设声明；§7.2 为结论式逐项说明 | §7.1 新增「L3=unspecified 旧版适用假设」声明 + 矩阵输入域限定；§7.2 改为**六列可追踪证据表**（记录｜断言及定位｜实际依据｜是否依赖 #11/#17｜核验结论）并将「自动统计」收紧为「定向核查及逐项依据」 | rev3 闭合（E） |
| 20 | §7.1 矩阵 #10 / #16 行 | R5 分支仅写在【表外注释】 | **R5 条件分支纳入矩阵行内**（非指定权威 → R5 → ILLEGAL；即指定权威 → R6 → LEGAL）；并新增「完整矩阵」精确定义（三维 18 组 + R5 条件分支） | rev4 闭合（E-1） |
| 21 | §7.1 标签说明 | 矩阵用 `IDENTIFIED` / `UNCLEAR`，未说明与 §3 规范值的关系 | 新增**映射声明**：`IDENTIFIED` = `EXISTS_AND_AUTHORITY_IDENTIFIED` 的展示简称；`UNCLEAR` = `EXISTS_BUT_AUTHORITY_UNCLEAR` 的展示简称；不构成新增 L5 规范取值；并与轴 2 `competing` 枚举区分 | rev4 闭合（E-2） |
| 22 | §3.1 CF-2 段措辞 | 「剩余适用的判定规则（R3/R4/R5/R6）」 | 改为**「按既定顺序适用的 R4 → R3 → R5 → R6」（规则编号，非层编号）** + 表述纪律声明 | rev4 附带（C 建议） |
| 23 | §4 补严 ③ | 无实现前约束 | 新增**实现前约束**：`NOT_EVALUATED` 是轴 2 显式状态标记，**不是**「必要决策输入缺失」的通用豁免 | rev4 附带（D 约束） |
| 24 | §7.2 证据覆盖 | 仅列各记录的**选定子项**（H-2 缺 §R2/R4/R5/R6/R8/R10/E-1；H-3 缺 H3-02/H3-05；H-4 缺 H4-02/H4-04；H-6 缺 G3/G4/G5） | 补齐为**全部核验项**；新增覆盖核对、类别统计、定性说明（以【输入维度】而非【分类标签】论证） | rev5 闭合（E-3） |
| 25 | §7.2 计数口径 | H-2 计为 11 项（§R1–§R10 + E-1），但分类时把 §R10 拆成 H2-01…H2-04 ⇒ **分母与分类粒度不一致**；总数 37 | 统一为**原子断言口径**：H-2 = §R1–§R9、H2-01…H2-04、E-1 Erratum = **14 项**；总数 **40**；分类 **否 2 · 不适用 38 · 待核 0**（2+38=40 ✔）；新增计数校验与口径说明 | rev6 闭合（E-3①） |
| 26 | §7.2.2（新） | 无 —— 仅有「不引入输入维度」层面的论证，未证明**无间接依赖** | 新增 **§7.2.2 间接依赖补证**：四字段（是否消费轴 1 Decision｜是否消费 L5 消解结果｜依赖路径｜变更影响），逐项覆盖 **H3-01 / H3-04 / H5-03 / H-2 §R2 / §R4 / §R7 / H-4 H4-03 / H4-01** 等 9 类高风险项 + 其余项按同类依据归并；结论：**不消费轴 1 Decision / 不消费 L5 消解结果** | rev6 闭合（E-3②） |

```text
★ 修改总数 = 26 项
   · 首稿 rev1 = #1–#10（其中【语义变更 1 项】= #4；其余为新增/追加）
   · rev2 补严 = #11–#16
   · rev3 闭合 = #17–#19（依终审 REVISE 的 C / D / E；**B 未重开**）
   · rev4 闭合 = #20–#23（E-1 / E-2 + C 建议 + D 约束；**B 未重开、A 未扩大**）
   · rev5 闭合 = #24（E-3 证据覆盖补齐）
   · rev6 闭合 = #25–#26（E-3 原子计数统一 + 间接依赖补证；**E-1/E-2 未动、A–D 未重开**）
   · 无新增语义变更（rev6 仅统一计数口径与补间接依赖证明，不改任何规则语义）
★ 未触及【原始 v1.1】的 §1 / §2 / §5 / §6 / §7 / §8 / §9 / §10 / AD-R6-1 / Case 库
```

---

## §10 本 Amendment 的修订记录

```text
rev1（首稿）  —— 依已裁定的方案 (b) 与 CF-1/CF-2/CF-3 编写：
                §3 / §3.1 / §4 / §11 四处修改 + 命名约定 + CF 闭合 + §7 兼容性（示例式）

rev2（本版）  —— 依【第二层审查 REVISE】的四组最小修订意见补严，**不改变任何规则语义**：

  修订组 A（修改范围对照）
    · 所有「前置（v1.1 原文…）」标题改为「前置（v1.1 【节选】…）」并加【节选说明】，
      明示省略范围（§3 省略 L2/L4 行尾注释；§3.1 省略属性不判死三条子项；§4 省略轴 2 取值展开）
    · 「前置（v1.1）」（命名约定）改为「前置（v1.1 ——【无对应条款】）」并说明该段非原文引用
    · 「前置（v1.1 原文，L248-259）」改为「前置（v1.1 【逐字全文】，L248-259）」并说明无需节选
    · 术语消歧：4 处「v1.1」改为「【原始 v1.1】」，避免与 Amendment 自身 §7/§8 混淆（§0/§5/§8/§9）

  修订组 B —— 保留（规则顺序 R1→R2→R4→R3→R5→R6 已 PASS，未改动）

  修订组 C（输入状态语义）
    · §3.1 CF-2 条款新增「unspecified 的规范地位」段：
      unspecified 本身既不构成明确许可、也不构成阻断；最终 Decision 可由其余规则得出；
      若结果为 LEGAL，不得解释为 L3 已提供明确许可（附 1 条反例）

  修订组 D（诊断映射与边界）
    · §4 新增补严 ①：L5 → 轴 2 `competing` 的映射表
      （NONE→NONE · EXISTS_AND_AUTHORITY_IDENTIFIED→IDENTIFIED ·
        EXISTS_BUT_AUTHORITY_UNCLEAR→UNCLEAR），并声明 IDENTIFIED ≠「当前来源是权威」
    · §4 新增补严 ②：已知事实 ≠ 未评估事实 ——
      保留【已确定】事实；不要求补算全部诊断；【不得】把未评估属性伪造为已确定值
      （未评估应显式标记为【未评估】）

  修订组 E（兼容性证据）
    · §7 重构为 §7.1 / §7.2 / §7.3：
      §7.1 完整 18 组新旧决策差异矩阵（变化组 = 2/18：L3≠deny · L5=UNCLEAR · L6=deny）
      §7.2 「零影响」的核验范围（H-1…H-6 六项）与逐项依据
      §7.3 其余影响（Case 库 / 未来实现 / 确定性保证）

rev3（本版）  —— 依【终审 REVISE】闭合 C / D / E 三项，**不重开 B，不扩大 A**：

  C（消除 L4 与 Decision 的表述冲突）★ 终审新发现
    · 问题：rev2 在 CF-2 补严段写「最终 Decision 可以依据其余适用规则（**L4** / L5 / L6
      及其判定）得出」，与同节「L4 是 ASSESSMENT、不单独决定 Decision」冲突
    · 修正：改为「`unspecified` 不命中 R2 后，【继续执行剩余适用的判定规则】；
      最终 Decision 由【整套判定规则】得出」，
      并显式声明：上述「剩余适用的判定规则」指 **L5 / L6 及其对应规则（R3/R4/R5/R6），不含 L4**；
      L4 仅作属性记录，不参与 Decision 的判定

  D（增加 `NOT_EVALUATED` 规范）
    · §4 轴 2 四属性取值域各增 `NOT_EVALUATED`：
      ownership = single | multi | undefined | NOT_EVALUATED
      deprecated = true | false | NOT_EVALUATED
      competing = NONE | IDENTIFIED | UNCLEAR | NOT_EVALUATED
      reachability = WIRED | TEST_ONLY | UNREACHABLE | NOT_EVALUATED
    · 新增「补严 ③」定义其规范语义与四条边界：
      ① 表示【评估状态】，非业务结论（不代表「没有竞争 / 没有弃用 / 不可达」）
      ② 与 `ownership = undefined` 必须可区分，不得互相转换或合并
      ③ 短路时保留已知事实、不强制补算；★ 若流程【必须】依赖 L5 才能区分 R3/R5/R6，
         则不得以 NOT_EVALUATED 代替 L5 的必要评估
      ④ 不得反向影响轴 1（不得因未评估把已确定结果改为 AMBIGUOUS；
         也不得把未计算属性当作已确定的放行依据）
    · **未采用** `null`；**未调整**轴 2 数据结构（未采用包装结构方案）

  E（补旧版假设及逐项证据）
    · §7.1 新增「关于 `L3 = unspecified` 的旧版结果（适用假设声明）」：
      v1.1 已列出该取值但未定义其规范语义；#13–#18 的 v1.1 结果是在
      「将 `unspecified` 视为不匹配 R2 的 deny 条件、继而按 v1.1 原顺序继续执行」
      这一【适用假设】下机械应用所得，**不代表原始 v1.1 已明确规定其完整规范语义**
    · §7.1 新增矩阵输入域限定（L1=true + 给定 L3/L5/L6 组合；R5 分支见注）
    · §7.2 改为【六列可追踪证据表】：记录｜具体断言及定位｜断言的实际依据｜
      是否依赖 #11/#17｜核验结论；6 条记录中「否」2 条（H-2 / H-6）、
      「不适用」4 条（H-1 / H-3 / H-4 / H-5）
    · §7.2 将「自动统计」措辞收紧为【定向核查及逐项依据】（不声称不可复现的证据过程）

★ 状态：本文件仍为 **DRAFT — rev3 / NOT ACCEPTED / NOT FROZEN**
★ 本修订记录本身【不构成】接受、生效、Freeze 或实现授权
★ rev3 未改变任何规则语义（仅闭合表述冲突、补诊断表示规范、补证据）

rev4（本版）  —— 依【针对性复审（仅 E 项阻塞）】闭合 E 项三项，并附带 C / D 两项：

  E-1（§7.1 的 R5 条件分支）★核心
    · 原状：R5 的两分支仅写在【表外注释】，与「三维输入唯一决定结果」的表述并存
    · 修正：#10 / #16 行【在矩阵内】展示两分支 ——
        当前来源【非】指定权威 → R5 → ILLEGAL
        当前来源【即】指定权威 → R6 → LEGAL
      （两分支在 v1.1 / v1.2 中【均不变】，不进入变化组统计）
    · 新增「完整矩阵」精确定义：
        ① 完整枚举三维（L3 × L5 × L6）18 组组合；
        ② 对依赖 R5 的行（#10 / #16），额外列出【当前来源权威身份】条件分支
      ⇒ 不再宣称「三维输入值足以唯一决定所有行」

  E-2（矩阵标签与 §3 规范值的映射声明）
    · 新增声明：`IDENTIFIED` = `EXISTS_AND_AUTHORITY_IDENTIFIED` 的展示简称；
                `UNCLEAR` = `EXISTS_BUT_AUTHORITY_UNCLEAR` 的展示简称；
                `NONE` 即规范值 `NONE`（无简称）
    · 并声明：这些简称【不构成新增的 L5 规范取值】；
      且【不得】与轴 2 的 `competing` 枚举混同（前者是【输入维度】，后者是【诊断属性输出】）

  E-3（§7.2 六行实际内容）
    · 六行证据表内容保持不变（已具备「具体断言及定位｜实际依据｜是否依赖 #11/#17｜核验结论」）
    · 本轮已将六行【实际单元格内容】完整呈交验收方核验（不再仅提供分类摘要）

  C 附带（第二层审查的非阻塞措辞建议）
    · §3.1 CF-2 段「剩余适用的判定规则」改为
      **「按既定顺序适用的 R4 → R3 → R5 → R6」（规则编号，非层编号）**，
      并加表述纪律声明，避免「层编号 L5/L6」与「规则编号 R3/R4/R5/R6」混为同一对象

  D 附带（保留的实现前约束）
    · §4 补严 ③ 新增：`NOT_EVALUATED` 是【轴 2 的显式状态标记】，
      **不是**对「必要决策输入缺失」的通用豁免；
      若某属性是当前决策必需输入（如判定 R3 / R5 / R6 需要 L5），必须先完成该评估

★ 状态：本文件仍为 **DRAFT — rev4 / NOT ACCEPTED / NOT FROZEN**
★ 本修订记录本身【不构成】接受、生效、Freeze 或实现授权
★ rev4 未改变任何规则语义（仅闭合 R5 分支展示、标签映射与两项附带约束）

rev5（本版）  —— 依【E 项复审（仅 E-3 阻塞）】补齐 §7.2 的证据覆盖：

  E-3（§7.2 证据覆盖）
    · 原状：§7.2 仅列出各记录的【选定子项】——
        H-2 缺 §R2 / §R4 / §R5 / §R6 / §R8 / §R10 / E-1 Erratum
        H-3 缺 H3-02 / H3-05；H-4 缺 H4-02 / H4-04；H-6 缺 G3 / G4 / G5
      ⇒ 当时只能得出「【已列出的】依据不显示对 #11/#17 的依赖」，
        不能严格推出「【声明范围内】无任何断言依赖 #11/#17」
    · 修正：补齐为【全部核验项】并逐项给三值之一（否 / 不适用 / 待核）：
        H-1 INV-1…INV-6                6/6
        H-2 §R1–§R10 + E-1 Erratum     11/11
        H-3 H3-01…H3-05 + F-1/F-2       7/7
        H-4 H4-01…H4-04                 4/4
        H-5 H5-01…H5-03                 3/3
        H-6 G1–G6                       6/6
        ─────────────────────────────────────
        合计 37 项；类别统计：「否」2（H2-01 / H6-G1，均落 #1–#6）·
                            「不适用」35 ·「待核」0
    · 新增三项辅助段落：
        ① 覆盖核对（逐记录列出 6/6 … 11/11 的覆盖比）
        ② 类别统计（否 2 · 不适用 35 · 待核 0）
        ③ 定性说明 —— 回应「不能仅以归类为由认定不受影响」：
           对曾被简单归类为「读取路径」的项（如 H-2 §R4），
           改以【输入维度】论证：该断言**不引入** L3 / L5 / L6 三个输入维度中的任何一个，
           而非仅以其「属读取路径 / 属事实层」的标签作为理由
    · 结论范围收紧：明确声明核验范围 = 上列 37 项，
      本项【不宣称】超出该范围的任何结论；「待核」为 0 项故无需进一步限制结论
    · 顺带修正：原表 H-3 行的笔误 `SSoT Legality` → `SoT Legality`

★ 状态：本文件仍为 **DRAFT — rev5 / NOT ACCEPTED / NOT FROZEN**
★ 本修订记录本身【不构成】接受、生效、Freeze 或实现授权
★ rev5 未改变任何规则语义（仅补齐证据覆盖与其定性说明）
★ rev5 未改动 §7.1 的 E-1 / E-2（E-1 的表内分支保留，未退回脚注形式）

rev6（本版）  —— 依【E-3 复审 REVISE】修订 §7.2 两项（**E-1 / E-2 未动；A–D 未重开**）：

  E-3① 统一原子断言计数（修正分母与分类粒度不一致）
    · 原状：H-2 计为 11 项（§R1–§R10 = 10 项 + E-1 Erratum = 1 项），
      但同一行内又把 §R10 拆成 H2-01…H2-04 并逐项分类
      ⇒ 【分母按 §R10 计 1 项，分类却按 4 项】⇒ 计数口径不一致；总数 37
    · 修正：统一为【原子断言】口径 ——
        H-2 = §R1–§R9（9）+ H2-01…H2-04（4）+ E-1 Erratum（1）= **14 项**
        总数 = 6 + 14 + 7 + 4 + 3 + 6 = **40 项**
        分类 = **否 2 · 不适用 38 · 待核 0**（计数校验：2 + 38 = 40 ✔）
    · 新增【计数校验】与【口径说明】（明示 §R10 已展开为原子子项）

  E-3② 新增 §7.2.2 间接依赖补证（回应「不引入输入维度 ≠ 无间接依赖」）
    · 新增四字段补证表：
        ① 是否消费轴 1 Decision  ② 是否消费 L5 消解结果
        ③ 依赖路径（实际依据）    ④ 变更影响（是否可能命中 #11/#17）
    · 逐项覆盖 9 类高风险项：
        H3-01 三层分离 · H3-04 authority 分工 · H5-03 fallback = LEGAL ·
        H-2 §R2 Requirement SoT · §R4 Knowledge Read Path · §R7 Policy Provenance ·
        H-4 H4-03 映射链 · H4-01 DECLARED-BUT-UNWIRED · 其余「不适用」项按同类依据归并
    · 补证结论：上列高风险项均为【否 / 否】（不消费轴 1 Decision、不消费 L5 消解结果）；
      其余项同类 ⇒ 间接依赖层面亦确认无双 #11/#17 影响
    · 特别澄清（你点名者）：
        · H3-01 / H3-04 = 静态结构事实（代码位置 + 三层分离头注 / 两个 writer 调用点），
          不涉及任何已计算的 SoT Decision
        · H5-03 的 LEGAL 由【H-5 §6 正交关系 + 逐字设计理由】独立得出，
          并非 R6-ERR 的 SoT Decision 输出

  ★ 顺带（结构性）：为 §7.2 增加子标题 §7.2.1（逐项核验覆盖与直接依赖）
     与 §7.2.2（间接依赖补证），以便引用。

★ 状态（当前有效状态）：**ACCEPTED — rev6 / NOT EFFECTIVE / NOT FROZEN**
   · 依据 **R6ERR-AUTH-01**（Amendment Acceptance，已签发）：Amendment 内容已正式接受
   · 依据 **R6ERR-AUTH-02**：保留独立文件；当前状态标记已更新为本行
   · 依据 **R6ERR-AUTH-03**（单文件 Stage）：已完成 —— 本文件已进入暂存区并完成暂存审计
   · 依据 **R6ERR-AUTH-04**（条件式本地 Commit）：已完成 —— 已建立本地 Git 历史
   ★ Acceptance ≠ Amendment 生效；≠ Formal Freeze；≠ Implementation 授权
   ★ Stage / 本地 Commit 的完成，同样 ≠ Push 授权、≠ Formal Freeze、≠ Amendment 生效、≠ Implementation 授权
   ★ 仍须【分别】独立授权：Push · Formal Freeze / Human Gate · Amendment 生效 ·
     Implementation Contract / Preflight / Implementation
★ 本修订记录本身【不构成】生效、Freeze 或实现授权
★ rev6 未改变任何规则语义（仅统一计数口径与补间接依赖证明）
★ rev6 未改动 §7.1 的 E-1 / E-2，亦未重开 A–D
★ 上述 rev1–rev5 各段中的「DRAFT / NOT ACCEPTED」状态为其【当时的历史事实】，不追溯改写

────────────────────────────────────────────────────────────────────
◆ 接受后的非规范性状态事实修正（POST-ACCEPTANCE STATUS FACT RECONCILIATION）
   依据授权：R6ERR-AUTH-05（Accepted Amendment 状态事实修正工作包）
   性质：**非规范性**修改 —— 不进入 Amendment 修订历史，不编号为 rev7，
         不构成新的规范内容，不改变任何决策规则 / 诊断语义 / 兼容性证据 / 统计口径
   原因：AUTH-03（Stage）与 AUTH-04（本地 Commit）执行后，
         §8 末行与 §10 原「下一阶段仍须…Git 固化」表述所描述的 Git 事实已过时
   范围：仅修正【当前状态陈述】两处（§8 末行 + §10 当前状态块）；
         rev1–rev5 历史记录与 §0 Baseline（制定时基线）作为历史事实保留
   修正内容：
     · §8 末行：删去「本文件当前仍为 untracked 工作树文件，未 stage、未 commit」的过时描述，
       改为「push 仍禁止；已完成 Stage / 本地 Commit ≠ 授权 Push / Freeze / Implementation」
     · §10 当前状态块：补记 AUTH-03（Stage 已完成）与 AUTH-04（本地 Commit 已完成），
       并将「仍须独立授权」清单收敛为 Push / Formal Freeze / 生效 / Implementation
   未改变：§7.1 矩阵与 R5 分支 · §7.2 的 40 项核验范围与分类 · §9 的 26 项内容修订计数 ·
           §0 的 `ACCEPTED — rev6 / NOT EFFECTIVE / NOT FROZEN` 状态标记
   ★ 本记录不构成生效、Freeze、Push 或实现授权

────────────────────────────────────────────────────────────────────
◆ FORMAL FREEZE RECORD（R6ERR-AUTH-06）
   授权编号：R6ERR-AUTH-06（Formal Freeze，已签发）
   冻结对象：本文件（docs/phaseC/r6err-proposal-v1.2-amendment.md）已接受的 rev6 规范内容
   冻结范围：§0 的 Status / Frozen 元数据 + §8 的状态一致性校准 + 本冻结记录；
             §1–§7 规范内容（含 §7.1 矩阵与 R5 分支）· §7.2 的 40 项与分类 ·
             §9 的 26 项规范内容修改计数 —— 均未改变
   冻结前基线（Pre-freeze，已实际核验）：
     · HEAD        = 2e0451c5ca33b2a28cba590b0858964e0d4047ac
     · 父提交       = aa120fa700e76a883b9b3fe296485d61f729a72f
     · 文件 SHA-256 = 9bbde65d9a539bd4ce13db70b28a34073d1bac4c3a62644313558240fe6df5ed
     · 文件 Git blob = 979109479233b6abc0541f49ec27001b37c0e19a
   Bound base v1.1（被修订的父文档；本冻结【不】传递到它）：
     commit = 1435a7c7d66acdb19cf2c3babbe2e3e7c7ec83e0
     path   = docs/phaseC/r6err-proposal-refinement-record.md
     blob   = d7cd3c2ff28ff0e5713035df7f5018ac9aecc373
     status = PROPOSED / NOT FROZEN（继续维持，不因本冻结而改变）
   发布状态：★ **尚未 Push** —— 本次 Freeze 仅在本地完成；Push 为独立 Gate，须另行授权
   效力边界：
     ★ Freeze ≠ Amendment 生效（当前 NOT EFFECTIVE；生效须独立授权）
     ★ Freeze ≠ Implementation 授权（当前 IMPLEMENTATION NOT AUTHORIZED）
     ★ 本地 Commit / Freeze ≠ 已发布
   快照性质说明：
     §10 的「接受后的非规范性状态事实修正」（R6ERR-AUTH-05）属于本次冻结的完整文件快照的一部分，
     但它**不是第 27 项规范变更**，也**不构成 rev7**；§9 的规范变更计数**仍为 26 项**。
   后续纪律（依 D-4）：
     · 冻结提交所标识的 rev6 内容不得被静默覆盖、删除或重写；
     · 规范修订必须以【独立编号的 Amendment 或 Erratum】追加，并载明原因 / 范围 /
       Non-Changes / 兼容性影响 / 所需的人审·接受·冻结授权；
     · 非规范性审计记录只可 append-only 追加，不得追溯改写历史；
     · 无默许解冻机制：如需撤销或纠正冻结决定，须另行明确授权并留痕，
       不得直接删除或弱化 FROZEN 标记。
   ★ 防自引用（依 D-3）：本记录**不**写入本次 Freeze 提交自身的 commit ID，
     也**不**写入冻结后的最终文件 SHA-256 —— 该二者仅记载于提交后的冻结凭证报告中。
   ★ 本记录不构成 Push、Amendment 生效或 Implementation 的授权。

────────────────────────────────────────────────────────────────────
◆ 授权范围符合性例外记录（SCOPE-CONFORMANCE EXCEPTION）· SC-EX-01
   依据授权：R6ERR-AUTH-07（本记录）
   相关授权：R6ERR-AUTH-06（Formal Freeze，执行中发生本例外）
   记录性质：**非规范性** —— 不构成规范内容变更，不构成 rev7，
             不改变 §9 的 26 项计数，不改变任何决策规则 / 诊断语义 / 兼容性证据

   【例外事实】
     R6ERR-AUTH-06 执行中，§8「明确不授权」的修改超出授权单所限
     「只允许修正因本次 Freeze 完成而变得不准确的当前状态事实」的范围：
       原文（1 条）：❌ Formal Freeze / Human Gate 冻结确认（仍须独立授权）
       改为（2 条）：❌ 冻结快照的后续修改 / 解冻（依 D-4，须独立授权；FROZEN 标记不得删除或弱化）
                    ❌ 任何超出 R6ERR-AUTH-06 范围的 Freeze 后续治理动作（须独立授权）

   【影响评估】
     · §1–§7 规范内容 · §7.1 矩阵 · §7.2 的 40 项与分类 · §9 的 26 项计数 —— 均无影响
     · §8 条目数由 8 条增至 9 条；该变化属于本次已认定的授权范围偏离。
       本记录只登记发生的事实，不追认该修改本身，也不以其与 D-4 治理方向一致作为授权依据。
     · 原始冻结提交 7f31bb8bbd6174005fdf0c41a1f7a6d5e9029308 及其对应文件 blob、SHA-256
       作为历史对象保持不变且可追溯。本次 append-only 追加将产生新的文件 blob 与新 Commit，
       不覆盖、不改写原冻结提交。

   【架构师裁定（已作出）】
     · 接受为「已发生的范围偏离」，append-only 登记；
     · 冻结快照保持不变；不得 amend / reset / revert / 清理 / Push；
     · 本例外不重开 A–E 审查，不重开 §7.2 或 §9 的规范内容审查。

   【承认】
     该改动属执行方（Reasonix）在授权边界上的范围偏离；
     不得以「与 D-4 方向一致」「内容更严格」作为事后追认依据。

   【记录纪律（依 D-4）】
     本记录只可 append-only；不得追溯改写任何既有记录原文；
     本追加形成新的文件 blob，原始冻结 commit 7f31bb8 与其 hash 仍须可追溯。

   ★ 防自引用：本记录不写入本次追加提交自身的 commit ID，
     也不写入追加后的最终文件 SHA-256。
   ★ 本记录不构成 Push、Amendment 生效、Implementation 或任何后续修改的授权。

────────────────────────────────────────────────────────────────────
◆ ARCHITECT GOVERNANCE RULING RECORD（R6ERR-AUTH-10）
   授权编号：R6ERR-AUTH-10（Governance Ruling Record）
   日期：2026-10-09
   记录性质：正式治理裁定及生命周期元规则（**非规范性**；不是新的 Amendment 规范内容版本）
   绑定对象：R6-ERR Proposal v1.2 Amendment rev6
   绑定原始 v1.1：commit=1435a7c7d66acdb19cf2c3babbe2e3e7c7ec83e0
                  path=docs/phaseC/r6err-proposal-refinement-record.md
                  blob=d7cd3c2ff28ff0e5713035df7f5018ac9aecc373
   原冻结对象：commit=7f31bb8bbd6174005fdf0c41a1f7a6d5e9029308
               blob=67923f368af7dc1378390273b36ebdab88e79abc

   【§3.2 D-9-1…D-9-9 正式结论】
    D-9-1  SC-EX-01 本身**不构成** Amendment 生效的自动或永久阻断条件；不妨碍后续进入
           独立 Effectivity Gate，但**不代表**该 Gate 已通过，更**不代表** Amendment 现已生效。
    D-9-2  必须明确声明（逐字）：
           「本裁定仅认定 SC-EX-01 不构成 Amendment 生效的阻断条件；
             不构成对 AUTH-06 期间 §8 超范围改动的追认，亦不改变 SC-EX-01 的登记性质。」
    D-9-3  §8 语义覆盖面复核结论：原「Formal Freeze 仍须独立授权」禁令指向当时尚未完成的
           冻结动作，该动作已在 AUTH-06 下完成；修改后的两条分别约束冻结快照的后续修改/解冻
           与超出 AUTH-06 范围的后续治理动作 ⇒ **未发现前瞻性禁令覆盖缺口**。
           ★ 但「一条改为两条」的编辑行为**确实超出** AUTH-06 允许的修改范围 ⇒
             SC-EX-01 **继续保留、不予追认**；覆盖面判断通过**不消除** SC-EX-01。
    D-9-4  后续生命周期事件**继续追加至本 Amendment 的 §10**（方案 ①：同一文档 append-only）。
           原冻结 commit / blob / SHA-256 必须**始终可追溯**；不得覆盖既有内容；
           **不新增独立生命周期记录文件**。
    D-9-5  **修订后采纳** R-STATE-1′…R-STATE-5；**不逐字采纳**原稿 R-STATE-1 与 R-STATE-4。
    D-9-6  生命周期事件的必填字段正式确定（见下方【生命周期事件记录结构】）。
    D-9-7  Effectivity / 生效的定义正式确定（见下方【Effectivity 正式定义】）。
    D-9-8  生命周期事件的顺序与冲突消解：以规范 `main` 的**线性 Git 提交祖先关系**
           和**经授权的事件序列**为依据；**不以**文件行号、时间戳或最后一次 Push 单独决定状态。
           分叉、冲突或授权不明时**停止转换**，交由 Human Gate 裁定。
    D-9-9  §0 `Acceptance history` 的「当前有效状态 = ACCEPTED …」解释为
           **该接受记录形成时的状态**，不覆盖后续冻结与生命周期记录所表达的当前状态。
           ⇒ **无需也不允许在本轮改写 §0**（此为解释规则，非修改原文的授权）。

   【§3.3 修订后的生命周期治理规则】
    R-STATE-1′  **当前状态的权威来源**：生命周期的当前状态由「经授权、满足前置条件、
                并已进入规范 `main` 提交链」的**最新有效状态转换记录**确定。
                 状态采用**完整向量**（而非某一条孤立状态文字）：
                   Acceptance                   = `ACCEPTED — rev6`
                   Freeze                       = `FROZEN — rev6`
                   Effectivity                  = `NOT EFFECTIVE`
                   Implementation Authorization = `NOT AUTHORIZED`
                   Publication                  = `PUBLISHED`，远端 `main = cb7d16d5c7dff933af65975edd58e9ca11db3595`
                   SC-EX-01                     = `REGISTERED / NOT RATIFIED`
                   原始 v1.1                     = `PROPOSED / NOT FROZEN`
                 ★ 以上为**当前基线状态的治理判定**，不表示各维度永久锁定；
                   未来任何维度变化均须通过对应的独立授权事件记录完成。
    R-STATE-2   **历史记录严格 append-only**：§10 中既有记录不得删除、覆盖、重排或追溯改写；
                后续事件**只能追加**新记录。原 Formal Freeze Commit `7f31bb8…`、
                原冻结 blob `67923f…` 及对应冻结前指纹**永久作为历史凭证保留**。
    R-STATE-3   **历史状态不等于当前状态**：§0 的 Acceptance history、历史 Acceptance 记录
                与 FORMAL FREEZE RECORD 中的状态陈述，一律解释为**各自事件发生时的状态**。
                特别是原有 Acceptance history 末句，**不得**作为覆盖后续冻结事件与
                生命周期记录的当前状态依据。（**解释规则**，不是修改原文的授权。）
    R-STATE-4   **状态转换只通过新增记录完成**（修订版）：
                 · 每次生命周期状态转换均通过 §10 中的**新记录**表达；
                 · 新记录必须说明**转换前的完整状态向量**、**目标状态向量**、
                   发生变化的维度与**明确不变的维度**；
                 · 既有 §0、§8 与历史 §10 记录**不因状态转换而被改写**；
                 · 一次状态转换必须有**独立授权**，并形成**独立、可追溯的提交**；
                 · 事件记录本身**不写入**包含该记录的 Commit ID 或最终文件 SHA-256，
                   相关凭证在提交后另行保存。
                 ★ 原稿「在同一次授权与提交中同时追加事件记录并修改 §0 的 Status/Frozen 行」
                   **不予采纳**（修改现存 §0 行会改写已冻结快照中的既有文字，
                   与 append-only 纪律冲突）。
    R-STATE-5   **冻结历史不可被静默撤销**：不得删除或弱化原冻结标记，
                也不得擦除"冻结曾经发生"的历史事实。未来如需解冻、撤销、暂停或替代某项状态，
                必须**另行明确授权**，并使用新的生命周期事件记录说明其效力与范围；
                即使获准解冻，**也只能改变当前状态向量，不得抹去原冻结记录**。

   【§3.4 Effectivity 正式定义】
    Effectivity / 生效是指：针对 `R6-ERR Proposal v1.2 Amendment rev6` 已接受、已冻结的
    规范增量，经**独立 Human Gate 授权**后，在**明确绑定的基线和适用范围**内，
    正式成为后续 R6-ERR 相关判断**应适用的规范规则**。
    五条约束：
      1. **独立授权**：只有明确指向本 Amendment、声明目标状态为 `EFFECTIVE` 的独立授权，
         才可能触发生效转换。Acceptance / Freeze / Commit / Push / 例外登记**均不能隐含生效**。
      2. **对象绑定**：生效仅针对已接受的 rev6 增量，并绑定原始 v1.1 的既定快照身份；
         **不自动**将原始 v1.1 从 `PROPOSED / NOT FROZEN` 转为已冻结或已生效。
      3. **适用范围**：生效事件必须明确适用范围、目标规则、起始时间或触发条件；
         **不得默认追溯既往**。
      4. **发布确认**：生命周期生效记录必须完成授权、Commit 与指定远端发布核验后，
         才能按记录中明确的有效时间开始生效；除非另有明确授权，**不能早于成功发布时点追溯生效**。
      5. **实施分离**：生效**不授权**代码、测试、schema、Methodology 或其他实现变更；
         Implementation 仍须通过单独的实施契约、Preflight 与 Implementation 授权。

   【生命周期事件记录结构（D-9-6）】今后的 Effectivity / Implementation Authorization /
    解冻 / 后续治理事件，均须遵循以下字段结构：
      身份      ：唯一记录编号 · 独立授权编号 · 事件类型 · 裁定日期
      对象      ：Amendment 版本 rev6 · 文件路径 · 原始 v1.1 绑定身份
      冻结凭证   ：原冻结 Commit · blob · 必要的历史指纹
      事件前状态 ：事件前完整状态向量 · 此前生效的生命周期记录编号
      目标与结果 ：目标状态向量 · 变化的维度 · 明确不变的维度
      适用范围   ：生效范围 · 前置条件 · 目标规则 · 有效时间或触发条件
      依据      ：Human Gate 裁定 · 证据位置 · 条件满足证据
      边界      ：Non-Changes · 明确不授权事项 · 非追认声明（适用时）
      提交与发布 ：预期父提交 · 发布要求 · 发布核验条件
      防自引用   ：声明不将本记录所在的 Commit ID 与最终 SHA-256 写回记录自身
    ★ 提交后凭证须**单独记录**：实际 Commit ID · 唯一父提交 · 提交路径 ·
      最终文件 SHA-256 · blob · 远端 ref 与验证结果。
    ★ 事件顺序以规范 `main` 的线性祖先关系为准；后一个有效事件必须能说明其前置状态
      与前一有效事件的关系。若出现分叉、相互矛盾的有效声明、缺少授权或前置条件不满足，
      **不得自动选择**一个状态继续推进；当前状态维持为**最后一个没有争议的有效状态**，
      等待新的 Human Gate 裁定。

   【§3.5 计数与 Non-Changes】
     · 本记录是**治理元规则裁定**，不是新的 Amendment 规范内容版本；**不构成 rev7**
     · **不改变** §9 的 26 项规范内容修改计数
     · **不修改** §1–§7 的规范决策规则
     · **不重新开启** A–E、§7.2 或 §9 的审查
     · **不追认** SC-EX-01
     · **不宣布** Amendment 生效
     · **不授权** Implementation
     · **不改变** 原冻结提交及其 blob
     · 后续生命周期状态转换仍须**独立授权**

   【§3.6 防自引用】
     本记录**不写入**本次 AUTH-10 Commit 自身的 ID、最终文件 SHA-256 或最终 blob；
     相关凭证仅记录在提交后的交付报告中。

   ★ 本记录本身**不构成** Effectivity 事件，**不改变**当前状态向量；
     **不构成** Push、Amendment 生效、Implementation 或任何后续修改的授权。

────────────────────────────────────────────────────────────────────
◆ AUTH-10 术语解释与效力澄清（R6ERR-AUTH-11）
   【记录身份】
     · 授权编号：R6ERR-AUTH-11
     · 相关裁定：R6ERR-AUTH-10
     · 记录性质：正式治理效力解释记录
     · 绑定对象：R6-ERR Proposal v1.2 Amendment rev6
     · 绑定原冻结提交：7f31bb8bbd6174005fdf0c41a1f7a6d5e9029308
     · 绑定原冻结 blob：67923f368af7dc1378390273b36ebdab88e79abc

   【一、对 AUTH-10 中「非规范性」的正式解释】
     AUTH-10 第 L902 行所使用的「非规范性」，**仅表示**该记录不构成新的 Amendment
     规范内容版本，不增加 §9 的规范内容修改计数，不构成 rev7。
     该用语**不表示** AUTH-10 所载正式治理裁定及生命周期元规则不具有治理约束力，
     也**不表示**这些规则仅供参考。

   【二、AUTH-10 的治理效力】
     AUTH-10 中经正式裁定的治理决定及 R-STATE-1′ 至 R-STATE-5，是后续 R6-ERR
     治理工作的**正式规则**。后续相关工作**必须遵循**；如需变更、替代或废止，
     必须通过独立、明确授权的治理裁定，并遵守 append-only、原始冻结对象可追溯
     及既有记录不得追溯改写的纪律。
     本记录澄清 AUTH-10 的既有意图，不创设 Amendment 新规范内容，不取代后续各项独立 Human Gate。

   【三、效力边界】
     本记录：
       · 不构成 Amendment rev7；
       · 不改变 §9 的 26 项规范内容修改计数；
       · 不修改 §1–§7 的规范决策规则；
       · 不追认 SC-EX-01；
       · 不宣布 Amendment 生效；
       · 不授权 Implementation；
       · 不修改 AUTH-10、§0、§1–§9 或任何既有历史记录；
       · 不改变原冻结提交、原冻结 blob 或现有状态向量。

   【四、当前状态向量保持不变】
     · Acceptance                   = `ACCEPTED — rev6`
     · Freeze                       = `FROZEN — rev6`
     · Effectivity                  = `NOT EFFECTIVE`
     · Implementation Authorization = `NOT AUTHORIZED`
     · Publication                  = 以已核实的远端 `main` 为准
     · SC-EX-01                     = `REGISTERED / NOT RATIFIED`
     · 原始 v1.1                     = `PROPOSED / NOT FROZEN`

   【五、防自引用】
     本记录**不写入**本次 AUTH-11 Commit 自身的 Commit ID、最终文件 SHA-256 或最终 blob。
     相关凭证只在提交后的交付报告中记录。

────────────────────────────────────────────────────────────────────
◆ EFFECTIVITY EVENT RECORD · EFF-01（授权：R6ERR-AUTH-15）
   【4.1 身份与前序关系】
     事件编号：EFF-01（唯一；追加前已只读查重，确认未占用）
     独立授权编号：R6ERR-AUTH-15（Effectivity Event Execution，已签发）
     事件类型：EFFECTIVITY
     记录日期：2026-10-09
     对象路径：docs/phaseC/r6err-proposal-v1.2-amendment.md
     对象版本：R6-ERR Proposal v1.2 Amendment **rev6**
     原始 v1.1 绑定身份：commit=1435a7c7d66acdb19cf2c3babbe2e3e7c7ec83e0 ·
                        path=docs/phaseC/r6err-proposal-refinement-record.md ·
                        blob=d7cd3c2ff28ff0e5713035df7f5018ac9aecc373
     原冻结对象：commit=7f31bb8bbd6174005fdf0c41a1f7a6d5e9029308 ·
                blob=67923f368af7dc1378390273b36ebdab88e79abc

     ★ 前序治理关系（本条事件的前置状态承接自以下有效治理记录）：
       · **R6ERR-AUTH-10** —— 前序**有效生命周期状态转换记录**来源：
         确立 R-STATE-1′…5 生命周期元规则、D-9-1…D-9-9 裁定，
         并载明当前状态向量（当时 Effectivity = NOT EFFECTIVE）。
       · **R6ERR-AUTH-11** —— AUTH-10 治理效力的**正式澄清规则**：
         明确 AUTH-10 的治理裁定与 R-STATE 规则具有治理约束力（非仅供参考）。
       · **R6ERR-AUTH-12** —— 当前已发布基线的**发布核验证据**：
         远端 `main` 经实测指向 `421011e8add4f128dc2b2626ba973a1709036108`。
       · **R6ERR-AUTH-14** —— 本次 `PASS WITH CONDITIONS` Gate 裁定
         及 C-1 解释性裁定的**依据**。
       ★ 本事件的事件前状态，即承接自 AUTH-10 所载状态向量，
         并依 AUTH-11 的效力澄清与 AUTH-12 的发布核验构成当前有效基线。
       ★ **AUTH-14 本身不是 Effectivity 状态转换事件**，仅为 Gate 审议与解释性裁定。

   【4.2 事件前状态与目标状态（完整向量）】
     事件前状态：
       Acceptance                   = `ACCEPTED — rev6`
       Freeze                       = `FROZEN — rev6`
       Effectivity                  = `NOT EFFECTIVE`
       Implementation Authorization = `NOT AUTHORIZED`
       Publication                  = `PUBLISHED`
       当前远端 main                 = `421011e8add4f128dc2b2626ba973a1709036108`
       SC-EX-01                     = `REGISTERED / NOT RATIFIED`
       原始 v1.1                     = `PROPOSED / NOT FROZEN`

     目标状态：
       Acceptance                   = `ACCEPTED — rev6`
       Freeze                       = `FROZEN — rev6`
       Effectivity                  = `EFFECTIVE`（**仅在本事件规定的发布核验条件满足后**）
       Implementation Authorization = `NOT AUTHORIZED`
       Publication                  = `PUBLISHED`
                                      （远端 ref **必须在本事件成功发布核验后**
                                        指向本事件 Commit）
       SC-EX-01                     = `REGISTERED / NOT RATIFIED`
       原始 v1.1                     = `PROPOSED / NOT FROZEN`

     ★ 状态变化：
       治理状态目标变化 = `Effectivity: NOT EFFECTIVE → EFFECTIVE`（条件满足后）
       Publication 状态仍为 `PUBLISHED`，但其**远端 `main` 指针会随本事件的成功发布而改变**；
       该 ref 指针的改变是本事件**发布凭证的组成部分**，
       **不得**将其错误写成"完全不变的值"。
       Acceptance / Freeze / Implementation Authorization / SC-EX-01 的登记性质
       及原始 v1.1 状态**均不发生变化**。

     ★ 防自引用：本记录**不预填**未来 Commit ID、最终 blob 或最终 SHA-256；
       实际凭证在提交之后**单独生成**。

   【4.3 C-1 · 解释性裁定的落实（引 AUTH-14，不扩大范围）】
     「对本 Amendment，§0 的 `Status` 与 `Frozen` 字段，以及 §8 中描述当前授权状态的
       相关文字，按其冻结时点的状态快照理解。它们不构成对独立 Human Gate 后续生效授权的
       永久禁止，也不覆盖其后依 AUTH-10/AUTH-11 形成的有效生命周期状态转换记录。
       当前 Effectivity 状态依 R-STATE-1′，以最新有效且已进入规范 `main` 提交链的
       状态转换记录为准。」
     ★ 该解释**不得**被描述为 R-STATE-3 原文已经逐字列举这些字段；
       R-STATE-3 原文列举的是「§0 的 Acceptance history、历史 Acceptance 记录与
       FORMAL FREEZE RECORD 中的状态陈述」三类。
     ★ 该解释**不改变** §0 / §8 或任何既有 R-STATE 条文，
       且**不追认** AUTH-06 期间的超范围修改。

   【4.4 C-2 · 权威来源声明及其生效边界】
     「本事件**仅在**完成授权、形成独立 Commit，并经指定远端 `main` 发布核验成功后生效。
       自该核验成功时点起，R6-ERR 的 Effectivity 当前状态以本记录为准。
       §0 的 `Status` 与 `Frozen` 字段，以及 §8 中描述当前授权状态的相关文字，
       按 R6ERR-AUTH-14 的解释性裁定理解为冻结时点的状态快照；
       它们不构成对独立 Human Gate 后续生效授权的永久禁止，
       也不覆盖其后有效的生命周期状态转换记录。
       当前 Effectivity 依 R-STATE-1′，以最新有效且已进入规范 `main` 提交链的
       状态转换记录为准。」
     ★ **不得**将本声明理解为「本地追加或本地 Commit 一完成，Amendment 就已经生效」。
       在**远端发布核验成功之前**，当前状态**仍是 `NOT EFFECTIVE`**。

   【4.5 C-3 · SC-EX-01 不追认声明（逐字）】
     「本裁定仅认定 SC-EX-01 不构成 Amendment 生效的阻断条件；不构成对 AUTH-06
       期间 §8 超范围改动的追认，亦不改变 SC-EX-01 的登记性质。」
     SC-EX-01 = `REGISTERED / NOT RATIFIED`
     ★ 不得将 SC-EX-01 描述为已解决、已追认、已消除或不再需要审计。

   【4.6 C-4 · 生效触发条件及非追溯约束】
     生效触发条件 =
       独立授权已签发
       + 本事件记录 append-only 追加并形成独立 Commit
       + 后续获得独立 Push 授权
       + 指定远端 `main` 经独立只读核验严格指向本事件 Commit
     实际生效时点 =
       约定发布核验成功的 **UTC 时点**
     ★ 本记录**只写上述触发条件，不预先填入实际生效 UTC 时间**。
     ★ **不得**将生效时间追溯到 Acceptance、Formal Freeze、此前 Push 或申请准备日期。
     ★ 实际核验成功后，由**独立发布凭证**记录实际 Commit ID、唯一父提交、文件路径、
       最终 SHA-256、最终 blob、远端 ref、核验结果及对应 UTC 时间。

   【4.7 C-5 · 范围绑定（逐项）】
     本次 Effectivity 的目标生效范围 = 已接受并冻结的 rev6 规范性增量，严格限于：
       N1  §3   节点类别与优先级原则（GATE 应一致地先于 RESOLVER）
       N2  §3   L3 / L6 的许可维度差异
       N3  §3   L5 职责限定（RESOLVER 不承担阻断；UNCLEAR 不得遮蔽 GATE 的 deny）
       N4  §3.1 确定性短路顺序 R1 → R2(L3) → R4(L6) → R3(L5) → R5 → R6
       N5  §3.1 SoT Decision 规范语义定义及 ILLEGAL 的当前范围限定
       N6  §3.1 INV-AXIS-1（决策与诊断分离）
       N7  §3.1 CF-2（`unspecified ≠ allow`）
       N8  §4   两轴独立性与完整性声明
       N9  命名约定 L1–L6 / R1–R6 / §Rx 编号区分及引用纪律
     明确排除：
       · 原始 v1.1 的**全部条款**（其状态继续为 `PROPOSED / NOT FROZEN`）
       · §6、§7（含 §7.1 / §7.2 / §7.2.1 / §7.2.2 / §7.3）、§8、§9、§10 的任何规范内容
       · 任何代码、测试、schema、Methodology、Version、Human Gate 机制或其他实现内容
       · 对 §9 的 26 项计数、§7.2 的 40 项口径的任何修改；不重开 A–E / §7.2 / §9 审查
     ★ 特别说明：本事件记录位于 §10 末尾，但它是**生命周期治理元数据**，
       **不代表**将 §10 纳入本次规范性生效范围，也**不代表**对 §10 既有内容作任何改写。

   【4.8 C-6 · Non-Changes】
     · **不改变** §9 的 26 项规范内容修改计数
     · **不改变** §7.2 的 40 项核验口径
     · **不改写** 任何既有冻结文字或历史 §10 记录
     · **不改变** 原冻结 Commit、blob 或冻结前指纹
     · **不改变** 原始 v1.1 的 `PROPOSED / NOT FROZEN` 状态
     · **不追认** SC-EX-01
     · **不授权** Implementation
     · **不重开** A–E、§7.2 或 §9 审查
     · **不修改** 代码、测试、schema、Methodology 或其他实现材料
     · **不授权** Push、标签、发布或其他额外仓库操作

   ★ 本记录不写入其自身 Commit ID、最终 blob 或最终 SHA-256（防自引用）。
   ★ 在独立 Push 授权并成功发布核验之前，当前 Effectivity **仍为 `NOT EFFECTIVE`**。
```
