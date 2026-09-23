# Tiancha Business & Intelligence Architecture v3.1（Final Business Model）

> **2026-09-23 · 顶层业务模型最终锁定版（无代码、无 interface、无表结构）。**
> 基于 v3（`05-business-intelligence-architecture-v3.md`），**只修正 7 处**，其余部分（分层思路、ResearchChain=观察结构、ResearchTarget 泛化、QuestionTargetFit、Fallback 纪律、证据驱动评分、Phase 按闭环排）**保持 v3 不动**。
>
> 本文件确认后，方可进入领域模型与代码设计。

---

## 0. v3 → v3.1 的 7 处锁定（diff 清单）

| # | v3 状态 | v3.1 锁定 |
|---|---|---|
| 1 | Research Experience 埋在 §F 里 | **提升为独立一等概念**，成为 `Methodology ↔ Industry Knowledge` 之间的**缓冲层** |
| 2 | Pool = "结构化框架 + 已掌握内容"（表述含糊） | **钉死：Pool 是信息组织层，不是第二套 SoT**；槽位内的每条内容**必须指向 Claim/Evidence** |
| 3 | Priority 缺席（Gap → Question 直连） | **Research Priority 进入核心内环**：Gap → **Priority** → Question |
| 4 | Evaluation 隐含"要给总分" | **总分算法不在此拍死**，留给 Methodology 定义；模型只确定必须同时存在 Quality / Coverage / Sufficiency / Critical |
| 5 | Report 是 Phase F（末端） | **Report = Projection（横向能力）**，任何时刻可生成，不是生命周期末端 |
| 6 | 自动发现行业写在 G 的入口里、Phase E | **入口能力**：工程实施可后置，**业务架构不可后置** |
| 7 | 双向闭环图分散在多处 | **重画一张完整的 Investment Knowledge ↔ Industry Knowledge 双向闭环图** |

---

## 1. 顶层：四类知识（v3.1 的基本分类）

天查内部至少存在**四类知识**。它们回答四个不同的问题，**不能混为一谈**：

| # | 类型 | 回答 | 例子 |
|---|---|---|---|
| **①** | **投资方法论知识**<br>Investment Methodology | 「**应该怎么研究？**」 | 平台型行业需要重点观察网络效应 |
| **②** | **行业事实 / 信息**<br>Industry Facts / Information | 「**这个行业现在发生了什么？**」 | 某 AI Agent 平台 2026 年企业客户增长 80% |
| **③** | **行业认知**<br>Industry Cognition | 「**据这些信息，我们现在怎么理解这个行业？**」 | 企业级 Agent 当前增长主要由客服、营销、知识管理场景驱动 |
| **④** | **研究经验**<br>Research Experience | 「**我们从研究过程中发现，以后应该怎么研究？**」 | 过去 10 个 Agent 项目里，只看厂商披露的客户数无法判断真实需求，必须加下游客户访谈 |

**关键区分**：
- ② 是**事实层**（且是散落的，需被组织）；
- ③ 是**对该行业下的判断**（只对本行业有效）；
- ④ 是**对"研究方法"下的判断**（跨行业有效，可能改变方法论）；
- ① 是**跨行业通用的研究方法本身**。

> **② 与 ④ 的区别是天查最容易做错的地方**："这个行业的需求被高估了" 是 ③；"**用厂商披露客户数判断需求，在这类行业普遍无效**" 才是 ④。

---

## 2. 四类知识与信息流分层的关系（避免两套模型打架）

v3 里的"五层信息流"与上面的"四类知识"是**两个视角**，不冲突：

| 信息流层（数据怎么流） | 对应到哪类知识 |
|---|---|
| 材料 → 片段 → 证据 → **断言（SoT）** | ② 的**原子来源**（事实的最底层，不可再分） |
| **信息槽位（Information Pool）** | ② 的**组织形态**（按"该看什么"把断言整理成"现在知道什么"） |
| **认知（Knowledge）** | ③ 行业认知 |
| **研究经验（Research Experience）** | ④ 研究经验 |
| **方法论维度（Methodology）** | ① 投资方法论 |

**一句话**：信息流回答「**东西放在哪、怎么流**」；四类知识回答「**哪些是行业事实、哪些是行业判断、哪些是方法判断**」。

---

## 3. 最终锁定图（双向闭环）

```
                    ┌──────────────────────────┐
                    │   ① 专业投资知识体系       │
                    │ Investment Methodology   │
                    └────────────┬─────────────┘
                                 │  应该如何研究
                                 ↓
                         Research Framework
                                 │
                ┌────────────────┼────────────────┐
                ↓                ↓                ↓
           Dimension        Requirement      Evaluation
                │                │                │
                └────────┬───────┘                │
                         ↓                        │
                   Information Pool               │   ← ② 的组织形态
                         │  （信息组织层，非 SoT）  │
                         ↓                        │
              Evidence / Claim  （SoT）           │
                         ↓                        │
                  Industry Knowledge              │   ← ③ 行业认知
                         │                        │
                         ↓                        │
                     Research Gap                 │
                         ↓                        │
                 Research Priority     ← 新增内环步骤
                         ↓                        │
                  Research Question               │
                         ↓                        │
                  Research Strategy               │
                         ↓                        │
                 Research Chain                   │
                         ↓                        │
                 Research Position                │
                         ↓                        │
                  Research Target                 │
                         ↓                        │
                 QuestionTargetFit                │
                         ↓                        │
                Diligence Preparation             │
                         ↓                        │
                      Research                    │
                         ↓                        │
              Material → Fragment                 │
                         ↓                        │
                     Evidence                     │
                         ↓                        │
                       Claim                      │
                         ↓                        │
              ┌──────────┴──────────┐             │
              ↓                     ↓             │
       Information Pool       Industry Knowledge  │
              │                     │             │
              └──────────┬──────────┘             │
                         ↓                        │
                 Investment Evaluation ←──────────┘
                         ↓
                  Score / Coverage / Sufficiency / Critical
                         ↓
                     Decision
                         │
                         ↓
               Research Experience      ← ④ 独立一等概念（缓冲层）
                         ↓
                  Experience Pattern
                         ↓
              Methodology Candidate
                         ↓
                    Human Gate
                         ↓
              新 Methodology Version
                         │
                         └──────────────→ 下一轮研究
```

**图中三条必须记住的线**：

1. **左边那条长链**是**内环**（行业研究）；
2. **底部往左上的箭头**（Experience → Pattern → Candidate → Gate → Methodology）是**外环**（方法论进化）；
3. **Evaluation 的右侧回箭头**指向 Methodology —— 因为**评估标准本身由方法论定义**，而评估结果又是方法论进化的证据来源。**这条回箭头就是两个知识体系"相互反馈"的具体位置。**

---

## 4. 锁定 1：Research Experience 是一等概念（缓冲层）

### 4.1 堆叠关系（v3.1 的核心修正）

```
Investment Methodology        ← ① 应该怎么研究
        ↑
Research Experience           ← ④ 从研究中提炼的"研究方法"经验（缓冲层）
        ↑
Industry Knowledge            ← ③ 这个行业我们现在怎么理解
        ↑
Information / Evidence        ← ② 事实与证据
```

**不是** `Industry Knowledge → Methodology` 直连。中间必须有 **Research Experience**。

### 4.2 它负责回答的问题（防过拟合的核心）

> **「这是我们研究方法本身出了问题，还是这个行业太特殊？」**

- 若判定为**行业特殊性** → 只更新 **③ 行业认知**，**不动方法论**。
- 若判定为**方法问题**（且跨案例重复） → 产生 **④ 研究经验** → 走向方法论修订。

### 4.3 生命周期

```
一次研究过程（Research）
   ↓ 出现方法层信号（见 §4.4）
Research Experience（一条"如何研究"的经验记录）
   ↓ 同类经验累积
Experience Pattern（模式：跨 N 个行业/项目反复出现）
   ↓
Methodology Candidate（方法论修订提案）
   ↓
Human Gate（人工确认）
   ↓
新 Methodology Version
```

### 4.4 什么信号会生成 Research Experience

（沿用 v3 §F.3 的五类触发，v3.1 正式把它们**归属到 ④**）

| # | 触发 | 说明 |
|---|---|---|
| T1 | **预测失准** | 方法论给出的评分/判断被后续证据证伪 |
| T2 | **关键遗漏** | 方法论未列或低权重的因素，被证据证明是关键驱动 |
| T3 | **重复无效** | 方法论要求的信息，多次研究都拿不到或证实无判断价值 |
| T4 | **口径陷阱** | 方法论假设可比的指标，实际口径不可比 |
| T5 | **结构变化** | 行业结构/规则变化使原方法假设失效 |

**纪律**：单例只记 **④ 经验**；**模式**（Pattern）才进 **Candidate**；**Candidate 必须过 Human Gate**。

---

## 5. 锁定 2：Information Pool 是信息组织层，不是第二套 SoT

### 5.1 钉死的定义

```
Raw Material
    ↓ Fragment
    ↓ Evidence
    ↓ Claim          ← Source of Truth（唯一）
    ↓
┌──────────────────────────────┐
│      Information Pool        │
│  按 Requirement / Slot 组织  │
│  指向 Claim / Evidence       │
│  （不复制内容、不成为真相源）  │
└──────────────────────────────┘
    ↓
Knowledge（认知）
```

> **Information Pool 是信息组织层，不是新的 Source of Truth。**
> 槽位可以"承载信息"，但**每条信息都必须有来源指向**（Claim → Evidence → Fragment → Material）。

### 5.2 正确的槽位形态

```
Pool Slot：2026 年市场规模
├─ 条目 A：500 亿元
│    → Claim C1 → Evidence E1 → Fragment F1
├─ 条目 B：320 亿元（不同口径）
│    → Claim C2 → Evidence E2 → Fragment F2
└─ 条目 C：450 亿元
     → Claim C3 → Evidence E3 → Fragment F3
```

**Slot 回答**：「针对某个研究需求，**目前所有相关信息被组织成什么样**。」
**Slot 不回答**：「系统又保存了一份信息。」

### 5.3 为什么这条必须写死（防漂移）

- 若 Pool 自己存内容 → 出现"事实漂移"（Pool 里的数改了，Claim 没改）；
- 若 Pool 自己存内容 → 与 Claim 成为**两套事实**，冲突时无法判断谁对；
- 一旦 Slot 只能"引用"，**所有事实的唯一真相永远是 Evidence/Claim**，Pool 只是视图。

---

## 6. 锁定 3：Research Priority 进入核心内环

### 6.1 修改后的内环链路

```
Knowledge
   ↓
Research Gap
   ↓
Research Priority      ← 新增（v3.1 的关键补充）
   ↓
Research Question
   ↓
Research Strategy → Chain → Position → Target → Fit → Diligence
   ↓
Research
   ↓
Evidence
   ↓
Knowledge（回流）
```

### 6.2 Priority 必须综合三类东西（不是人工随手排）

| 因素 | 含义 | 方向 |
|---|---|---|
| **① 对投资判断的重要程度** | 这个信息如果变了，会不会改变最终投资判断？ | 越能改变判断 → 优先级越高 |
| **② 当前不确定程度** | 我们到底有多不知道（覆盖不足 / 冲突未解）？ | 越不确定 → 优先级越高 |
| **③ 获取价值 / 研究成本** | 拿到这个答案要付出多大代价（能不能约到、要不要花钱）？ | 性价比越高 → 优先级越高 |

### 6.3 它回答的问题（用户最初的诉求）

> **「下一步最值得研究什么？」** —— 这正是用户第一条需求里的"根据信息池生成研究规划建议"。

**因此**：Research Planning **不是末端功能**，它是**内环的必经环节**；报告可以随时生成（§8），但**规划必须在线**。

---

## 7. 锁定 4：Investment Evaluation —— 结构已定，总分规则留给 Methodology

### 7.1 保留的（v3 已有，v3.1 确认）
- **要评分**（不是取消评分）；
- **可解释、可追溯**（分数 → 评估理由 → 证据/断言 → 原始材料）；
- **证据不足 → 不可计算，不是 0 分**；
- **覆盖度与质量分开报告**。

### 7.2 v3.1 新增要求：必须同时存在四个面

| 面 | 含义 |
|---|---|
| **Quality** | 各维度的**得分**（仅"已评"维度有分） |
| **Coverage** | N 个维度中，多少已评 / 多少证据不足 / 多少冲突 |
| **Confidence / Evidence Sufficiency** | 每个分数的**证据充分程度**（几条独立来源、几手） |
| **Critical Dimension** | **关键维度**（可能"一票否决"）：某维度权重虽低，但证据不足时**不得**给出"整体高分、建议储备"的结论 |

### 7.3 v3.1 明确**不在此拍死**的东西（留给 Methodology）

> **总分算法、关键维度（Critical）的判定、证据充分性规则 —— 全部由 Methodology 定义，不在业务模型层定死。**

理由（用户的例子）：
```
商业模式 90 / 增长 92 / 竞争 85 / 技术 88
但「关键监管风险」证据不足
```
→ **不能**因为平均分高就得出"95 分，进储备"。这类规则属于**方法论**，应随方法论版本演进，而不是写死在业务模型里。

**模型层只保证**：评估结果**必须同时给出** Quality / Coverage / Sufficiency / Critical 四个面，且必须有**"证据不足"的一等决策**（不伪装成"暂缓"或"不看好"）。

---

## 8. 锁定 5：Report = Projection（横向能力，不是末端 Phase）

### 8.1 定位

```
                   ┌──→ Report（任何时刻可生成）
                   │
Knowledge → Gap → Priority → Planning → Strategy → Research
     ↑                                                │
     └────────── Evidence ← Material ←────────────────┘
```

- **Report 是整个系统当前状态的投影**，可以随时生成；
- **不是**"所有能力做完之后才有的最终产物"；
- Report 由 `Industry Knowledge + Evidence + Claim + Conflict + State + Methodology + ResearchTarget` 共同生成；
- **Report 不改 SoT**：重算产出新快照，不产生新真相。

### 8.2 纪律（沿用）
- 每条判断可下钻到证据；
- 标注不确定 / 冲突 / 证据不足；
- 记录当时的方法论版本与研究时间。

---

## 9. 锁定 6：自动发现行业 = 入口能力

### 9.1 定位（业务上不可后置）

```
外部信息（研报 / 新闻 / 数据）
   ↓
高价值材料发现
   ↓
行业 / 赛道识别
   ↓
行业标准化
   ↓
是否进入研究池
   ↓
建立研究框架
```

### 9.2 它和方法论的**第一次接触**

```
发现一个新行业
   ↓
Methodology（快速初筛）
   ↓
是否值得深入研究
```

**这是天查与"手动录入行业名"的工具的本质区别**：入口自动发现后，**第一次筛选就用方法论**。

### 9.3 工程 vs 业务（用户明确的区分）
- **工程实施顺序**：可以后置（先打通研究闭环）；
- **业务架构**：**不可后置** —— 它是天查的**入口**，必须画在顶层模型里（本文件已画）。

---

## 10. 两个 Loop（正式定义）

### 内环：把行业研究得越来越透
```
Knowledge → Gap → Priority → Question → Strategy → Chain → Position
   → Target → Fit → Diligence → Research → Evidence → Knowledge
```
回答：**「这个行业，我还能研究得多深？」**

### 外环：把研究方法变得越来越好
```
Research → Research Experience → Experience Pattern
   → Methodology Candidate → Human Gate → Methodology → 下一轮 Research
```
回答：**「以后研究类似行业，我能不能比过去研究得更好？」**

> **天查与普通 Research Agent 的根本区别，就在这个外环。**

---

## 11. 与 v3 其余部分的衔接（保持不动）

以下内容 v3 已定，**v3.1 不改**：

- ResearchChain = **行业研究观察结构**（不是枚举、不是自由标签；由 Methodology 的"为什么看产业链" + Industry Knowledge 的"这个行业有哪些角色"共同生成）；
- Research Position（类型级）与 Research Target（实例级）分离；
- **ResearchTarget 泛化**为"可被选择、访问、引用并提供某类信息的研究对象"，Company 只是其一；
- **QuestionTargetFit**（问题 × 对象适配）与 **Fallback 显式标注**纪律；
- **Diligence Preparation** 每条问题可溯源、禁止通用模板；
- **证据驱动评分**（保留评分 + 证据不足不可计算）；
- **Phase 划分按业务闭环**（v3 §H 的 A–F 顺序仍然成立，但按本轮 7 点微调，见 §12）。

---

## 11.5 一致性锁定（Consistency Lock：B1 / B2 / B3 / C5）

> 本轮只锁 **4 个语义边界**，**不改变 v3.1 的任何结论**。落地细节见 `07 §3.1 / §3.7 / §3.8 / §7` 与 `08 §4`。

**B1 · 三层语义**：`Evidence（原始证据）→ Claim/Fact（原子事实）→ Belief（认知）`；**PoolItem 只是 Claim 的组织引用，不是第四种事实**；`Fact` = "结构化数值型的 Claim"，与 Claim 同层。

**B2 · Evaluation 四层**：`Evidence Assessment（够不够）→ Dimension Evaluation（够则给分）→ Investment Aggregation（12→7）→ Decision（是否储备）`。**禁止**把四层揉成一个巨型 Service。

**B3 · Methodology 三类职责**（同一聚合内语义分层）：`Research Framework（该研究什么）` / `Evaluation Policy（怎么评）` / `Aggregation Policy（怎么汇总 12→7）`。**改研究重点不得误伤评分算法**。

**C5 · Decision 与"证据不足"分离**：
- `insufficient_evidence` 是 **Evaluation 的知识状态**；
- `reserve / watch / park / pending` 是 **Decision 的决策状态**；
- **证据不足 ⇒ `decisionStatus = pending`**，绝不把 `insufficient_evidence` 当作决策枚举值。

**（同列为纪律，暂不阻塞 S1）**：JSON 列只承载值对象/快照（C4）；ResearchTarget 与 TargetSelection 分离（C1）；ResearchChain 是投影而非 SoT（C2）；Claim 的时间语义 `asOf/observedAt` vs `recordedAt`（C3）——这四项在 **Phase B/C 前**锁死。

## 12. Phase 微调（按本轮 7 点）

| Phase | 名字 | 变化 |
|---|---|---|
| **A** | 单行业研究闭环（框架驱动） | **+ Research Priority**（内环必经环节，不放到最后）；**+ Evaluation 四面结构**（Quality/Coverage/Sufficiency/Critical，总分规则待 Methodology） |
| **B** | 研究策略闭环 | 不变 |
| **C** | 调研回填闭环 | 不变 |
| **D** | 双体系协同闭环（外环） | **Research Experience 作为一等概念在此正式落地** |
| **E** | 自动化与规模化 | **自动发现行业（入口能力）在此实现**，但**架构上早已存在** |
| （横向） | **Report（Projection）** | **不再是 Phase**：任何阶段都可生成；随 A 阶段就应具备最小形态 |
| （横向） | **Research Planning** | **不再是末端 Phase**：属内环，Phase A 起就在线 |

**唯一顺序结论**：`A（含 Priority + Evaluation 四面）→ B → C → D（含 Experience）→ E`，**Report 与 Planning 不占 Phase，是横向能力**。

---

## 13. 自检：v3.1 是否支持"越研究越懂行业、越研究越懂投资"？

| 检验 | 支持 | 靠什么 |
|---|---|---|
| 越来越懂**这个**行业 | ✅ | 信息槽位持续填充（②）+ 认知历史累积（③） |
| 越来越懂**如何研究** | ✅ | **④ Research Experience 一等概念** → Pattern → Candidate → Gate |
| 会不会把"行业特殊性"误当成"方法问题" | ✅ | **④ 缓冲层专门回答这个问题**（防过拟合） |
| 会不会出现两套事实 | ✅ 已封死 | Pool 是组织层，**不复制内容**（§5） |
| 会不会"挑着有数据的维度算平均分" | ✅ 已封死 | Quality / Coverage / Sufficiency / **Critical** 四面并存（§7） |
| 会不会"下一步研究什么"没人管 | ✅ 已补上 | **Research Priority 进内环**（§6） |
| 报告会不会成为第二套真相 | ✅ | Report = Projection（§8） |
| 入口是不是只能手动 | ✅ 已定义 | 自动发现行业 = **入口能力**（§9） |
| 两个知识体系是不是真在互相反馈 | ✅ | 图中 Evaluation↔Methodology 的回箭头 + 外环（§3/§10） |

---

## 14. 结论

本版相对 v3 的**净变化**只有 7 处，且**没有引入新的冲突**：

1. Research Experience 独立一等概念（Methodology 与 Industry Knowledge 之间的缓冲层）；
2. Pool 钉死为信息组织层（非第二套 SoT）；
3. Research Priority 进入内环；
4. Evaluation 总分规则留给 Methodology（模型只保证四个面 + "证据不足"一等决策）；
5. Report = Projection（横向能力）；
6. 自动发现行业 = 入口能力（业务不可后置）；
7. 双向闭环图重画（§3）。

**请确认 §1–§13 是否正确。** 确认后，再进入**领域模型与代码设计**（届时才出现 interface、表、服务、工具）。
