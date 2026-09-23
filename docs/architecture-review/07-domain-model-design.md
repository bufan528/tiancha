# Tiancha Domain Model Design（v1）

> **2026-09-23 · 领域模型设计。** 上游依据：`06-business-intelligence-architecture-v3.1-final.md`（已确认）。
> 本文把 v3.1 的业务模型落成**实体 / 聚合 / 值对象 / 不变量 / 生命周期 / 事件 / identity**，并给出与现有代码的映射。
> **范围说明**：本文是**领域设计**，不是实现；不含 TS 代码、不含建表 DDL、不改仓库源码。字段以"要素表"形式给出，供后续代码设计直接承接。

---

## 0. 本文的位置

```
业务模型 v3.1（是什么、怎么长大）
      ↓  本文
领域模型（有哪些实体/聚合、它们的不变量与生命周期）
      ↓  下一步
代码设计（interface、表、服务、工具、迁移）
```

**本文要解决的问题**：把 v3.1 的四类知识、两个 Loop、五个分层，翻译成**可被代码直接承接的领域对象**，并提前钉死那些"一旦建错就要大改"的地方（identity、聚合边界、不可变历史、Pool 的组织层语义）。

---

## 1. 建模原则（从 v3.1 推导）

| # | 原则 | 来源 |
|---|---|---|
| P1 | **SoT 唯一**：事实的唯一真相是 `Claim/Evidence`；其它一切（Pool、Knowledge、State、Dossier、Report）都是组织层或投影 | v3.1 §5 |
| P2 | **历史不可变**：认知类对象（Belief、Claim、Evaluation、MethodologyVersion）只增不改，演化用"新行 + 关系"表达 | 既有 Invariant 2 |
| P3 | **两个知识体系分离**：`Methodology`（跨行业，方法）与 `IndustryKnowledge`（单行业，事实+认知）不得同表同质 | v3.1 §1 |
| P4 | **Experience 是缓冲层**：行业发现不能直连方法论；必须经 `Experience → Pattern → Candidate → HumanGate` | v3.1 §4 |
| P5 | **对象泛化**：`ResearchTarget` 是"信息源"抽象，`Company` 只是一种类型 | v3.1 §11 |
| P6 | **不建空壳**：任何实体只有在**有真实数据来源**时才落地（尤其 Experience） | 用户明令 |
| P7 | **引用而非复制**：Pool 槽位引用 Claim，不复制内容；任何"摘要层"必须能回溯 | v3.1 §5.1 |
| P8 | **证据不足是一等状态**：`insufficient_evidence` 在 Evaluation/Gap/Pool 都必须可表达 | v3.1 §7.3 |
| P9 | **幂等**：重复投喂同一材料，不得产生重复的研究骨架 | 用户 §12 原话 |

---

## 2. 限界上下文（Bounded Contexts）

```
┌────────────────────────── 天查 Research Core ──────────────────────────┐
│                                                                        │
│  [1] Methodology Context        ① 投资方法论（跨行业）                  │
│       MethodologyVersion · Dimension · Candidate · HumanGate           │
│                                                                        │
│  [2] Industry Context           行业身份 + 观察结构                     │
│       Industry · Company · Chain · Position                            │
│                                                                        │
│  [3] Inquiry Context            该问什么 / 缺什么 / 先做什么            │
│       Question · Requirement · Gap · Priority · NextAction             │
│                                                                        │
│  [4] Information Context        ② 信息（组织层）                        │
│       PoolSlot · PoolItem · State                                      │
│                                                                        │
│  [5] Knowledge Context          ③ 行业认知（判断）                      │
│       IndustryKnowledge · Belief · Conflict                            │
│                                                                        │
│  [6] Evidence Context           SoT：事实与来源                         │
│       Source · Material · Fragment · Evidence · Claim · Fact           │
│                                                                        │
│  [7] Strategy Context           去哪找 / 问谁 / 怎么准备                │
│       ResearchTarget · QuestionTargetFit · DiligencePreparation        │
│                                                                        │
│  [8] Evaluation Context         判断与决策                              │
│       InvestmentEvaluation · DimensionEvaluation · Decision            │
│                                                                        │
│  [9] Experience Context         ④ 研究经验（外环缓冲层）                │
│       ResearchExperience · ExperiencePattern · MethodologyCandidate    │
│                                                                        │
│  [10] Discovery Context         入口                                    │
│       MaterialSource · DiscoveryCandidate                              │
│                                                                        │
│  （横向）Reporting：Report 是 [2]–[8] 的只读投影，不属任何上下文       │
└────────────────────────────────────────────────────────────────────────┘
```

**上下文间只允许单向依赖**（避免环）：
```
Discovery ─→ Industry ─→ Inquiry ─→ Information ─→ Knowledge ─→ Evaluation
                 ↑              ↑                            │
                 │              └──── Strategy ◄─────────────┘
                 │                     ▲  （Strategy 读 Inquiry 的 Question/Requirement + Knowledge 的认知）
                 │                     │
                 │              Evidence（SoT，被 Knowledge/Evaluation 引用）
                 │
             Experience（读 Knowledge + Evaluation + Strategy 的"方法层信号" → 产 Candidate）
                 ↓
             Methodology（Human Gated）
```
**读图要点**：
- `Strategy` 依赖 **Inquiry（Question/Requirement）** 与 **Knowledge**（共同决定"该问谁"）；
- `Experience` 依赖 **Knowledge + Evaluation + Strategy**（三处产生的"方法层信号"）；
- `Methodology` **只**由 `Experience → Candidate → HumanGate` 进入，不被任何上游直接修改。

---

## 3. 聚合清单（Root / 不变量 / 生命周期）

### 3.1 Methodology Context

#### A1 `MethodologyVersion`（聚合根）
| 项 | 内容 |
|---|---|
| Root | MethodologyVersion |
| 内部实体 | Dimension（值对象集合） |
| **语义分层（B3）** | **同一个聚合，三类职责必须语义分开**（可物理同存，但字段分组与访问入口必须分开）：<br>① **Research Framework** —— Dimension / Requirement / research rationale：**该研究什么**<br>② **Evaluation Policy** —— weight / criticality / sufficiency 规则 / scoring 规则 / decision 规则：**怎么评**<br>③ **Aggregation Policy** —— 12→7 贡献矩阵：**怎么汇总成投资判断**<br>**纪律**：改①不应误伤②③（"研究重点变了" ≠ "评分算法变了"）；三者演进节奏不同，变更时必须能分别识别。 |
| 关键要素 | versionTag、dimensions（每维含：key/name/whyNeeded/requiredInfo/confirmedCondition/uncertainCondition/unknownCondition/**weight**/**industryTypeRules**/**criticality**）、isHumanApproved、activatedAt |
| 不变量 | ①已激活版本不可修改；②同一时刻只有一个"当前激活"版本；③任何版本必须经 HumanGate 批准 |
| 生命周期 | `draft → approved → activated`（旧版本永久保留） |

> **与 §7 状态机一致**：MethodologyVersion **没有** `candidate` 态——"候选"是**独立聚合 `MethodologyCandidate`** 的状态（见 A2）。本聚合一旦存在即为已批准版本。
| 现状 | **已实现**（缺 weight / industryTypeRules / criticality，需扩展） |

> **注意**：`criticality`（关键维度）与"总分算法"按 v3.1 §7.3 **属于方法论**，因此它们是 Dimension 的属性，不是 Evaluation 里写死的常量。

#### A2 `MethodologyCandidate`（聚合根，独立生命周期）
| 项 | 内容 |
|---|---|
| 关键要素 | candidateId、baseVersionId、proposedDimensions、**rationale**、**evidenceRefs**、**sourceExperienceIds**（新增：来自哪些研究经验）、status、operator、decidedAt |
| 不变量 | ①未批准不得影响激活版本；②必须有 rationale；③**必须能从 sourceExperienceIds 追溯到经验**（否则是凭空改方法论） |
| 生命周期 | `pending → approved/rejected`（→ 若是 approved，生成新 MethodologyVersion） |
| 现状 | **已实现**（缺 sourceExperienceIds） |

#### A3 `HumanGate`（聚合根）
现状**已实现**（token 哈希、限域、一次性、过期）。唯一需扩展：`type` 已加 `methodology_activate`；未来可加 `reserve_decision` / `report_release`。

---

### 3.2 Industry Context

#### B1 `Industry`（聚合根）
| 项 | 内容 |
|---|---|
| 关键要素 | industryId、canonicalName、aliases、reserveStatus、currentStateId、currentKnowledgeId、currentEvaluationId |
| 不变量 | ①canonicalName 唯一（大小写/别名归一后）；②reserveStatus 变更必须留历史 |
| 现状 | **已实现**（缺 currentEvaluationId、reserve 变更历史） |

#### B2 `Company`（聚合根）
| 项 | 内容 |
|---|---|
| 关键要素 | companyId、canonicalName、aliases、primaryIndustryId、**positionRefs[]（指向 `ResearchPosition` 的引用）** |
| 术语统一 | 原 `chainPosition`（自由字符串）**废弃**，统一为 `positionRef → ResearchPosition`（见 B3） |
| 不变量 | canonicalName 唯一 |
| 现状 | 表与 CRUD 已实现但**零调用**（Phase B 接上） |

> **重要（P5）**：Company 只是 `ResearchTarget` 的一种来源实体，**不是** ResearchTarget 的父类。

#### B3 `ResearchChain` + `ResearchPosition`（聚合根 = Chain）
| 项 | 内容 |
|---|---|
| Root | ResearchChain |
| 内部实体 | ResearchPosition（**类型级**观察位置：如"下游头部客户"） |
| Position 关键要素 | positionRef、kind（**开放枚举**）、label（行业化命名）、whyImportant、answersQuestionRefs、satisfiesRequirementRefs、suitableEvidenceKinds、limitations、importance、dependsOnPositionRefs |
| 不变量 | ①每个 Position 必须说明"为什么重要"且至少关联一个 Question 或 Requirement（禁止空节点）；②Chain 属于某个 Industry 且版本化（结构变化不覆盖） |
| 生命周期 | Chain 随认知演进产生新版本 |
| 现状 | **新建** |

> **v3.1 §11 的落实**：Chain 不是枚举、不是标签集合，而是"该行业的观察结构"，由 Methodology 的"为什么要看产业链" + IndustryKnowledge 的"这个行业有哪些角色"共同生成。

---

### 3.3 Knowledge Context

#### C1 `IndustryKnowledge`（聚合根，每个 subject 一个当前投影）
| 项 | 内容 |
|---|---|
| Root | IndustryKnowledge（header，含 version） |
| 内部实体 | Belief（认知条目）、Conflict（冲突对） |
| Belief 关键要素 | beliefRef、dimension、**statement（认知内容）**、claimRefs[]、sourceRefs[]、confidence、state（confirmed/revised/conflicting/superseded）、historicalRelations[]、createdAt |
| Conflict 关键要素 | conflictRef、claimARef、claimBRef、dimension、status(open/resolved/accepted)、relatedGapRef |
| 不变量 | ①历史不覆盖（四态并存）；②Conflict 不选边；③belief 必须能回溯到 claim |
| 现状 | **已实现**（三表 + 四种 Evolution） |

#### C2 `ResearchExperience`（聚合根）— ④ 一等概念
| 项 | 内容 |
|---|---|
| 关键要素 | experienceRef、**kind**（T1 预测失准 / T2 关键遗漏 / T3 重复无效 / T4 口径陷阱 / T5 结构变化）、**observation**（观察到的"方法层面"问题）、**scope**（适用于哪些行业类型/情境）、evidenceRefs、**judgement**（判定：是行业特殊，还是方法问题）、industryRefs、createdAt |
| 不变量 | ①必须区分"这是行业特殊性还是方法问题"（judgement 必填）；②**不得直接修改 Methodology**；③必须有 evidence/source 引用（禁止凭空总结） |
| 生命周期 | `recorded → (累积) → partOfPattern → promotedToCandidate` |
| 现状 | **新建** |

#### C3 `ExperiencePattern`（聚合根）
| 项 | 内容 |
|---|---|
| 关键要素 | patternRef、memberExperienceRefs[]、**recurrenceCount**、scope（适用情境）、statement、firstSeenAt、lastSeenAt |
| 不变量 | ①**至少 N 条同类经验**才成为 Pattern（N 由方法论/配置定义，默认 ≥3）；②单例永不构成 Pattern |
| 现状 | **新建**（防过拟合的关键闸口） |

---

### 3.4 Inquiry Context

#### D1 `ResearchQuestion`（聚合根）
| 项 | 内容 |
|---|---|
| Root | ResearchQuestion |
| 内部实体 | InformationRequirement |
| Question 关键要素 | questionRef、subject、statement、origin(user/planner/material/**gap**)、status、**priority**、answerClaimRefs[] |
| Requirement 关键要素 | requirementRef、questionRef、dimension、description、**importance**（来自 Methodology，禁止硬编码）、requiredEvidenceType、**confirmedCondition / uncertainCondition / unknownCondition**（继承自 Methodology Dimension）、**preferredPositionKinds**（去哪类位置找）、status |
| 不变量 | ①Requirement 的 importance 与三个 condition **必须来自当前激活方法论**；②同一 subject 同一 dimension **唯一**（幂等，见 §8） |
| 现状 | **已实现**，但需扩展三个 condition + preferredPositionKinds，并修 importance 硬编码 |

#### D2 `ResearchGap`（聚合根）
| 项 | 内容 |
|---|---|
| 关键要素 | gapRef、subject、description、dimension、importance、uncertainty、**gapType**（unknown/conflict/insufficient）、relatedRequirementRefs、relatedQuestionRefs、status(open/mitigating/resolved/accepted) |
| 不变量 | ①以 **Requirement** 为中心（不是每个 unknown 一个 gap）；②stable identity = `gap-<requirementRef>`（幂等）；③subject 隔离 |
| 现状 | **已实现**（需补 gapType） |

#### D3 `ResearchPriority`（**值对象**，不是实体）
| 项 | 内容 |
|---|---|
| 形态 | 由 Gap/Requirement 派生的**排序依据**，不必单独持久化为独立聚合；可作为 Gap 上的派生属性或 `next_action` 的排序输入 |
| 构成 | ①对投资判断的重要程度（`importance` + `criticality`）②当前不确定程度（`uncertainty`/coverage）③获取价值/成本（可得性 proxy） |
| 不变量 | 计算输入必须可追溯（不能是拍脑袋的优先级） |
| 现状 | **新建（派生）** |

#### D4 `NextAction`（聚合根）
| 项 | 内容 |
|---|---|
| 关键要素 | actionRef、subject、kind（已有 9 种枚举：`retrieve_data/read_material/research_company/interview/field_visit/wait_evidence/request_manual_input/reevaluate/escalate_gap`）、params（可含 gapRef/**targetRef**）、priority、rationale、status、createdBy |
| 不变量 | ①stable identity = `act-<gapRef>`（幂等）；②gap 关闭时对应 action 置 cancelled；③rationale 必填 |
| 现状 | **已实现**（需支持 params.targetRef） |

---

### 3.5 Information Context

#### E1 `InformationPool`（聚合根，subject-scoped）
| 项 | 内容 |
|---|---|
| Root | InformationPool（以 subject 为界） |
| 内部实体 | **PoolSlot**（信息槽位，按 dimension/子维度）、**PoolItem**（槽位内的具体信息条目） |
| PoolSlot 关键要素 | slotRef、subject、dimension/子维度、status（**`unknown` / `partial` / `sufficient` / `conflicting`**）、**coverageJudgement**（依据 Requirement 的 confirmed 条件判定的结果） |
| PoolItem 关键要素 | itemRef、slotRef、**value/statement**、**caliber（口径）**、asOf、**claimRef**（必需）、sourceRef、relation-to-others（consistent/caliber_differs/contradicts/complements） |
| 不变量 | ①**PoolItem 必须指向 claimRef**（P1/P7：不复制内容）；②Slot 与 Item 不构成新的事实来源；③同一槽位多口径**并列保留**（不取平均、不覆盖） |
| 现状 | **需重定义**：现有 `information_pool_entry` 只有 topic/status/evidenceRefs，**没有 Item 层与口径** |

> **状态词统一（消除同义双枚举）**：旧 PoolEntry 的 `confirmed` → 新 Slot 的 **`sufficient`**；旧 `conflict` → 新 **`conflicting`**；`unknown`/`partial` 不变。**迁移时必须做词映射**，不允许新旧两套枚举并存。

> **⚠️ 破坏性变更声明（必须显式处理，不能只在映射表里写"重定义"）**：
> 现有 `reconcilePool()`、`refreshState()` 及其**已验收测试**（`knowledge-pool-reconcile.test.ts`、`knowledge-state-refresh.test.ts`）**直接建立在旧 `information_pool_entry` 单层结构上**。重定义为 Slot + Item 会**直接打破这两条已通过的链路**，因此本变更必须连带：
> 1. 重写 `reconcilePool`（写 Slot.status + 生成/更新 Item）；
> 2. 重写 `refreshState` 的输入（改读 Slot）；
> 3. 改写上述两个测试文件（断言目标从 entry 变为 slot/item）；
> 4. 提供**数据迁移**：旧 entry → 一个 Slot（含状态词映射）+ 由 `evidence_refs_json` 尝试解析出 Item（解析不到 claim 的留空，并在 `coverageJudgement` 标注"历史数据无来源"）；
> 5. 迁移期**双读**（新 Slot 优先、旧 entry 兜底），迁移完成后删除旧列/表。
> **顺序约束**：本变更应在 Code Design（08）中作为**独立小步**，且**必须在 E2 幂等修复之后**（否则重复 ingest 会把 Slot 也搞乱）。

> **这是 v3.1 §5 的落地点**：`Slot` 回答"针对某需求，目前信息被组织成什么样"，`Item` 是"组织后的一条可回溯信息"。

#### E2 `ResearchState`（聚合根，subject-scoped 单例）
| 项 | 内容 |
|---|---|
| 关键要素 | known / confirmed / uncertain / conflicting / unknown（引用）、keyQuestionRefs、gapRefs、nextActionRefs、version |
| 不变量 | ①由 Pool **单向投影**（State 永不回写 Pool）；②每次刷新 version+1，历史由事件保留 |
| 现状 | **已实现**（单向链路 + one-way 测试） |

---

### 3.6 Strategy Context

#### F1 `ResearchTarget`（聚合根）— **泛化，不只 Company**
| 项 | 内容 |
|---|---|
| 关键要素 | targetRef、**targetKind**（company/expert/consulting_institution/association/research_institution/customer/supplier/trader/service_provider/investor/government/**abstract**…）、**kindSubject**（类型特定的身份/画像，开放扩展）、industryRef、**positionRef**（落在 Chain 的哪个位置）、**researchPurpose**、selectionReason、expectedInformationValue、**accessibility**、priority、risks、limitations、relatedQuestionRefs、relatedRequirementRefs、fallbackTargetRefs、**isFallback**、fallbackForTargetRef、status(proposed/selected/contacted/scheduled/visited/completed/dropped) |
| 不变量 | ①`isFallback=true` ⇒ 必须有 `fallbackForTargetRef` 且 `limitations` 非空；②researchPurpose 与 selectionReason 必填（禁止"了解公司"式空泛）；③targetKind 为 `abstract` 时必须有可识别的描述性身份 |
| 现状 | **新建**（现有 `TargetCandidate` 是 investment screening 语义，**不等于**它） |

#### F2 `TargetCandidate`（聚合根）— investment 与 research 的分流
| 项 | 内容 |
|---|---|
| 关键要素 | candidateRef、**purpose**（investment / research）、industryRef、companyRef 或 targetKindSubject、status、selectionReason、evidenceRefs、createdAt |
| investment 专有 | screeningScore、whyNow、risks |
| research 专有 | positionRef、relatedQuestionRefs、accessibility、expectedInformationValue、limitations |
| 不变量 | ①**用 `purpose` 强制区分**；②investment candidate **禁止**用 research 的适配度排序，反之亦然 |
| 现状 | **需改造**（现有 `target-candidate.ts` 只有 screening 语义 → 归入 `purpose=investment`） |
| 命名澄清（避免同名混淆） | 本处 **F2 `TargetCandidate`** 是现有 `domain/target-candidate.ts` 中 `TargetCandidate` 的**原地超集**：现有类 = `purpose="investment"` 的那一支。**不新建第二个同名类型**；`ScreeningRun/ScreeningRule/TargetDecision` 保持不动，仅归属 investment 分支 |

> **v3.1 §11 的落实**：「最值得投资的企业」与「最适合回答某问题的对象」是两条独立的候选池，**永远不混排**。

#### F3 `QuestionTargetFit`（聚合根）
| 项 | 内容 |
|---|---|
| 关键要素 | fitRef、questionRef、targetRef、canAnswer、**answerability**（strong/partial/weak/none）、fitReason、evidenceBasisRefs、confidence、limitations、priority |
| 不变量 | ①必须说明 fitReason；②`answerability=weak` 且问题 importance 高时，**必须走 fallback 并标注 caveat**（不得静默降级） |
| 现状 | **新建** |

#### F4 `DiligencePreparation`（聚合根）
| 项 | 内容 |
|---|---|
| Root | DiligencePreparation |
| 内部实体 | DiligenceQuestion |
| 关键要素 | preparationRef、targetRef、industryRef、purpose、targetBrief、currentUnderstanding（**来自 Knowledge 投影**）、whyThisTarget、requestedData、requestedMaterials、cautions、risks、limitations、methodologyVersionRef、status(draft/ready/used) |
| DiligenceQuestion 关键要素 | questionRef、text、**fromRequirementRef**、**fromFitRef**、**isFallbackSource**、**caveat**、expectedAnswerType、priority |
| 不变量 | ①**每条问题必须可溯源到 Requirement/Fit**；②isFallbackSource=true ⇒ caveat 非空；③**禁止通用模板**（不同 target 的提纲必须不同，测试可断言） |
| 现状 | **新建** |

---

### 3.7 Evidence Context（SoT）

> **B1 · 三层语义（必须严格锁死，实现时不得含糊）**
>
> | 层 | 回答 | 例 | 是否 SoT |
> |---|---|---|---|
> | **Evidence** | 「原始材料里有什么证据？」 | 财报第 37 页写着：2026 年企业客户数 1,200 家 | 是（原始证据） |
> | **Claim** | 「天查可引用的**原子事实/断言**是什么？」 | "A 公司 2026 年企业客户数为 1,200 家" | 是（原子事实） |
> | **Belief** | 「基于多个 Claim，我们现在怎么理解这个行业？」 | "企业级 Agent 的商业化目前集中在头部客户" | **否**（认知判断，属 C1 IndustryKnowledge） |
> | **PoolItem** | —— | —— | **否**：它只是 **Claim 的组织引用**，**不是第四种事实** |
>
> **Fact 的定位（此前未讲清，现锁死）**：`Fact` 是**原子事实层内"结构化数值型"的 Claim**（`metric + value + unit + asOf + caliber`），用于可比较的数值断言；`Claim` 承载陈述型断言。**二者同层，Fact 不是独立于 Claim 的第三层**。PoolItem 可引用 Claim 或 Fact。
>
> 一句话：`Evidence（证据）→ Claim/Fact（原子事实）→ Belief（认知）`；**PoolItem 只是把原子事实按槽位组织起来的引用**。

#### G1 `Source` / `Material` / `Fragment`（聚合根 = Material）
| 项 | 内容 |
|---|---|
| Material 关键要素 | materialRef、subject、kind（meeting_transcript/report/news/filing/note/…）、sourceRef、rawLocator、receivedAt、**targetRef?**（来自哪次调研） |
| Fragment 关键要素 | fragmentRef、materialRef、sequence、speaker?、timestamp?、text、context? |
| 不变量 | Fragment 不可脱离 Material 存在；Material 不可无 Source |
| 现状 | Source/Document 已实现；**Material / Fragment 新建** |

#### G2 `Evidence`（聚合根）
| 项 | 内容 |
|---|---|
| 关键要素 | evidenceRef、claimRef、**fragmentRef（新增，指回片段）**、sourceRef、locator、stance（support/contradict/contextualize/weaken）、strength、confidence、verificationStatus |
| 不变量 | **`claimRef → Evidence → Fragment → Material → Source` 追溯链必须完整** |
| 现状 | 域对象已定义，**无表无写入路径**（Phase C/E 落地） |

#### G3 `Claim`（聚合根，SoT）
| 项 | 内容 |
|---|---|
| 关键要素 | claimRef、statement、claimType、provenance、conflictOfInterest、subject、temporalRelation（current/old/superseded）、**isRealExternalData** |
| 不变量 | ①永不覆盖（T9）；②占位数据不得进入 Knowledge；③是 Pool/Knowledge/Evaluation 的唯一事实来源 |
| 现状 | **已实现**（含 isRealExternalData） |

---

### 3.8 Evaluation Context

#### H1 `InvestmentEvaluation`（聚合根）
| 项 | 内容 |
|---|---|
| Root | InvestmentEvaluation |
| **四层结构（B2）** | 评估必须**逻辑分层**，禁止揉成一个巨型 Service：<br>① **Evidence Assessment** —— 够不够？（`sufficient / insufficient / conflicting / not_applicable`）<br>② **Dimension Evaluation** —— 够的话是多少？（`score / rationale / evidenceRefs`）<br>③ **Investment Aggregation** —— 12 → 7 汇总<br>④ **Decision** —— 是否满足方法论储备条件 |
| 内部实体 | DimensionEvaluation（②层） |
| 关键要素 | evaluationRef、subject、**methodologyVersionRef**、dimensionEvaluations[]、**coverage**（计数）、**sufficiency**（充分度汇总）、**criticalFlags**（关键维度是否达标）、createdAt |
| DimensionEvaluation 关键要素 | dimension、status（**evaluated / insufficient_evidence / conflicting / not_applicable**）、**score?（仅 evaluated 时有值）**、rationale、evidenceRefs、sufficiency、conflictingClaimRefs? |
| **Decision（C5：与"证据不足"分离）** | **Decision 不是 Evaluation 的一种状态**：`decisionStatus ∈ { reserve / watch / park / pending }` + `decisionReason` + `decidedAt`。<br>**证据不足 ⇒ `decisionStatus = pending`**（"我还不能决定"），**而不是**把 `insufficient_evidence` 塞进 decision 枚举。<br>即：**`insufficient_evidence` 是知识状态（属 Evaluation），`reserve/watch/park` 是投资决策状态（属 Decision）**。 |
| 不变量 | ①**未满足 confirmedCondition ⇒ DimensionEvaluation.status=insufficient_evidence 且 score 必须为空**（"不知道"≠"低分"）；②score 必须可回溯到 evidence；③**scoring / decision / aggregation 规则、critical 判定、sufficiency 阈值不在本聚合写死**——属 Methodology 的 Evaluation Policy / Aggregation Policy（v3.1 §7.3）；④**Decision 与 Evaluation 状态不得混用同一枚举** |
| 现状 | **新建**（现有 `scoring/` 是空壳 + 与 12 维冲突的 7 维 0–100 模型，**不废弃、改为上层**） |

#### 3.8a 评分口径裁决：**两层映射（不是二选一）**

> **背景（reviewer 指出）**：仓库里存在两套评分维度且互不引用——`Methodology v1` 的 **12 维**（研究维度）与 `docs/SCORING_MODEL.md` 的 **7 维 0–100**（投资汇总）。两者**分层并存**，不废弃任何一套；此前"废弃 scoring"的表述**作废**。

**层级关系**：

| 层 | 维度 | 回答 | 驱动什么 |
|---|---|---|---|
| **底层：研究维度** | Methodology 的 **12 维** | 「该查什么、查得怎么样」 | `Requirement / Pool / Evidence / Belief` |
| **上层：投资汇总维度** | SCORING_MODEL 的 **7 维** | 「值不值得投」 | `OverallScore / 评级 / 储备决策` |

**12 → 7 映射表（草稿，待过目）**：

| 上层 7 维（权重） | 聚合自哪些底层研究维度 | 聚合方式 |
|---|---|---|
| **market_growth** 市场空间与增速（20%） | `market` + `market_growth` | 加权合成 |
| **policy_env** 政策与监管环境（15%） | `policy` | 直通 |
| **competition** 竞争格局与壁垒（15%） | `competition` +（`technology` 的"壁垒"部分） | 加权合成 |
| **tech_maturity** 技术成熟度（15%） | `technology`（路线/迭代部分） | 直通 |
| **commercialization** 商业化与产业链（15%） | `demand` + `supply` + `industry_chain` + `business_model` + `profitability` | 加权合成 |
| **exit_env** 退出与资本环境（10%） | **⚠️ 缺口：12 维中无对应** | 见下 |
| **risk_level** 风险因素·逆向（10%） | `risk`（+ `key_validation` 作为不确定性参考） | 逆向合成 |

**`exit_env` 缺口处理（我建议 A）**：
- **方案 A（推荐）**：通过方法论演进机制**补一个维度** `exit_environment`（退出与资本环境），走 `MethodologyCandidate → Human Gate → v2`——这是**外环的第一次真实演练**；v1 阶段该维标 `insufficient_evidence`（不硬凑分）。
- 方案 B：不进方法论，改由**外部资本市场数据**单独提供（Wind 接入后）。
- 方案 C：v1 不输出该分，仅在报告中标注"退出环境未评估"。

**映射表归属**：`12→7` 的**贡献矩阵（含权重）必须写进方法论配置并版本化**（属 Methodology 属性）；**代码只做数学聚合** —— 于是"改评分口径 = 改方法论版本"，不改代码。

**与四面（v3.1 §7.3）的衔接**：7 维总分只在**足够底层维度已评**时给出；`insufficient_evidence` 的底层维度**不折算为低分**；`criticality` 定义为 12 维的属性（建议 `risk` / `key_validation` 为 critical）。

---

### 3.9 Discovery Context

#### I1 `DiscoveryCandidate`（聚合根，入口能力）
| 项 | 内容 |
|---|---|
| 关键要素 | discoveryRef、sourceMaterialRef（高价值研报/新闻）、**extractedIndustryName**、normalizedIndustryRef?（归一后的 Industry）、摘要、**quickScreenResult**（用方法论快速初筛）、status（new/standardized/promoted_to_industry/dismissed）、createdAt |
| 不变量 | ①行业名归一化后方可创建/匹配 Industry；②初筛必须使用当前激活方法论（"第一次接触方法论"发生在入口） |
| 现状 | **新建**（Phase E 实现，但架构上已是入口） |

---

### 3.10 Reporting（横向，非上下文）

#### J1 `ReportSnapshot`（**投影，非聚合根**）
| 项 | 内容 |
|---|---|
| 关键要素 | reportRef、subject、generatedAt、methodologyVersionRef、引用的 knowledge/evaluation/conflict 版本、内容（结构化 sections） |
| 不变量 | ①**只读投影**，重算产生新快照，不改任何 SoT；②每条判断可下钻到 Claim/Evidence |
| 现状 | **新建**（Phase 横向，Phase A 即可有最小形态） |

#### J2 `IndustryDossier`（**投影**，同 ReportSnapshot 性质）
现状：**新建**；性质与 Report 相同（投影、可重算、非 SoT）。

---

## 4. 关键值对象

| 值对象 | 说明 |
|---|---|
| `SubjectRef` | (subjectKind, subjectId)，几乎所有对象都挂在 subject 上 |
| `DimensionKey` | 方法论维度标识 |
| `Caliber` | 口径（PoolItem 必填项之一，解决 T4） |
| `Answerability` | strong/partial/weak/none |
| `TargetKind` | 开放枚举（含 `custom`/`abstract`），承载 P5 泛化 |
| `Accessibility` | contactable/likely/unlikely/unknown |
| `EvidenceStance` | support/contradict/contextualize/weaken（已实现） |
| `Coverage` | 覆盖度值对象（计数 + 明细） |
| `Sufficiency` | 证据充分度值对象 |
| `GapType` | unknown/conflict/insufficient |
| `ExperienceKind` | T1–T5 |
| `MethodologyScope` | 适用的行业类型（用于 industryTypeRules） |

---

## 5. 实体关系图（领域级）

```
MethodologyVersion ──< Dimension >──(派生)── InformationRequirement
      ▲                                              │
      │ HumanGate                                    │
MethodologyCandidate ◄── ExperiencePattern ◄── ResearchExperience
      ▲                                              ▲
      │                                              │ (读 Knowledge/Evaluation/Strategy)
      │                                              │
Industry ──< Company                    ┌───────────┘
   │                                    │
   ├──< ResearchChain ──< ResearchPosition ──┐
   │                                          │
   ├──< ResearchQuestion ──< InformationRequirement ──< ResearchGap
   │            │                                   │
   │            └──< QuestionTargetFit >── ResearchTarget ──< DiligencePreparation
   │                         ▲                  ▲
   │                         │                  │
   │                   TargetCandidate(purpose=research|investment)
   │
   ├──< InformationPool ──< PoolSlot ──< PoolItem ──→ Claim ──→ Evidence ──→ Fragment ──→ Material ──→ Source
   │                                                              │
   ├──< IndustryKnowledge ──< Belief / Conflict ─────────────────┘
   ├──< ResearchState（Pool 的投影）
   └──< InvestmentEvaluation ──< DimensionEvaluation ──→ Evidence
```

---

## 6. 全局不变量（必须由代码守护）

| # | 不变量 | 违反后果 |
|---|---|---|
| I1 | Claim/Evidence 是唯一 SoT；Pool/Slot/Item/Knowledge/State/Dossier/Report 都不得成为事实来源 | 事实漂移、两套真相 |
| I2 | 认知类对象历史不覆盖（Belief/Claim/Evaluation/MethodologyVersion） | 无法回溯判断演变 |
| I3 | Conflict 双方并列保留，永不静默选边 | 丢失真实分歧 |
| I4 | State 永不回写 Pool | 循环写入、覆盖度失控 |
| I5 | PoolItem 必须指向 Claim；无来源的"信息"不得入库 | 事实漂移 |
| I6 | Requirement 的 importance 与条件**来自当前激活方法论** | 分级失效（现状 bug） |
| I7 | Requirement/Question/PoolSlot 在同一 subject+dimension 上**唯一**（幂等） | 重复研究骨架 |
| I8 | Methodology 变更必须经 HumanGate；Experience **永不**直接改方法论 | 模型自学改方法 |
| I9 | Experience 必须带 judgement（行业特殊 vs 方法问题）；单例不构成 Pattern | 过拟合 |
| I10 | 未满足 confirmedCondition ⇒ Evaluation 该维 `insufficient_evidence` 且无分 | "不知道"被当成"差" |
| I11 | Evaluation 必须同时给出 Quality 与 Coverage（及 Sufficiency / Critical） | 挑着有数据的维度算平均 |
| I12 | ResearchTarget `isFallback=true` ⇒ caveat 必填；DiligenceQuestion 必须可溯源 | 静默降级、通用模板 |
| I13 | 占位数据（isRealExternalData=false）不得进入 Knowledge/Evaluation | 假证据污染判断 |
| I14 | Report/Dossier 是投影，重算不产生新真相 | 报告变 SoT |
| I15 | **Evidence / Claim（含 Fact）/ Belief 三层语义不得混用**；PoolItem 只是 Claim 的组织引用，**不是第四种事实** | 事实层与认知层串味 |
| I16 | **Decision 的决策状态（reserve/watch/park/pending）与 Evaluation 的知识状态（insufficient_evidence）不得混用同一枚举** | "不知道"被当成"已决定" |

---

## 7. 状态机

| 对象 | 状态流转 |
|---|---|
| `MethodologyCandidate` | pending → approved \| rejected（approved 生成新 Version） |
| `MethodologyVersion` | draft → approved → activated（不可回退，旧版永久保留） |
| `ResearchGap` | open → mitigating → resolved \| accepted |
| `ResearchTarget` | proposed → selected → contacted → scheduled → visited → completed \| dropped |
| `TargetCandidate` | eligible → selected \| rejected |
| `InvestmentEvaluation` | 无状态机（不可变记录） |
| `DimensionEvaluation` | status ∈ {evaluated, insufficient_evidence, conflicting, not_applicable}（**知识状态**） |
| `ReserveDecision`（评估产物，**独立于** Evaluation 状态） | `decisionStatus ∈ {reserve, watch, park, pending}` + `decisionReason`；**证据不足 ⇒ pending**（**决策状态**，不得与 `insufficient_evidence` 混用） |
| `PoolSlot` | unknown → partial → sufficient（或 conflicting，可回退到 partial） |
| `ResearchExperience` | recorded → partOfPattern → promotedToCandidate |
| `DiscoveryCandidate` | new → standardized → promoted_to_industry \| dismissed |
| `DiligencePreparation` | draft → ready → used |

---

## 8. Identity 与幂等（修复"重复 ingest"）

| 实体 | Identity 策略 | stable key |
|---|---|---|
| Industry | 归一后 canonicalName 唯一 | `canonicalName` |
| ResearchQuestion | **natural key** | `q-<subjectId>-<dimensionKey>` |
| InformationRequirement | **natural key** | `ir-<subjectId>-<dimensionKey>` |
| PoolSlot | **natural key** | `slot-<subjectId>-<dimensionKey>` |
| ResearchGap | 已有 | `gap-<requirementRef>` |
| NextAction | 已有 | `act-<gapRef>` |
| Claim | **每次新行**（新信息就该是新行，演化由 Evolution 表达） | random |
| Evidence / Fragment / Material | **每次新行** | random |
| Belief | **每次新行 + 关系** | random |
| InvestmentEvaluation | **每次新行**（绑定 methodologyVersion + 时间） | random（但 semantic key = subject+version+时刻） |
| MethodologyVersion | 版本号 | `mw-v<N>` |

**幂等验收**：同一材料重复 ingest → Question/Requirement/PoolSlot 数量**不变**，只新增 Claim/Evidence。

---

## 9. 领域事件（供 EventStore 落库）

| 事件 | 触发 | 关心者 |
|---|---|---|
| `industry.discovered` | Discovery 归一化出新行业 | Industry / Inquiry |
| `material.ingested` | 材料入库 | Evidence / Knowledge |
| `evidence.added` | 新证据 | Knowledge / Pool / Evaluation |
| `belief.changed` | SUPPORT/REVISE/CONFLICT/SUPERSEDE | Pool / State / Evaluation / Experience |
| `conflict.opened` / `conflict.resolved` | 认知冲突 | State / Evaluation / Experience |
| `pool.slot.filled` / `pool.caliber.differs` | 槽位填充 / 口径差异 | Knowledge / Experience（T4 信号） |
| `gap.opened` / `gap.resolved` | 缺口 | Priority / NextAction |
| `target.selected` / `target.fallback_used` | 调研对象选定 / 降级 | Diligence / Experience（T1 信号来源） |
| `diligence.prepared` | 提纲生成 | Research |
| `evaluation.computed` | 评估产出 | Decision / Experience |
| `experience.recorded` | 记一条研究经验 | Experience Context |
| `pattern.formed` | 经验成模式 | Candidate |
| `methodology.candidate_proposed` / `methodology.activated` | 方法论演进 | 全局 |

> 观察：**`experience.*` 事件的触发源几乎都是"其他上下文异常"**（口径差异、结论被推翻、fallback 频繁）—— 这正是外环的输入面。

---

## 10. 与现有代码的映射

| 现有 | 处置 | 说明 |
|---|---|---|
| Runtime（Run/Round/Task/Artifact/EventStore/HumanGate） | **保留** | 冻结契约 |
| Industry / Company | **保留**（Company 待接上） | — |
| ResearchQuestion / InformationRequirement | **保留 + 扩展** | 加三个 condition + preferredPositionKinds；importance 接方法论 |
| ResearchGap / NextAction | **保留** | 加 gapType；支持 targetRef |
| ResearchState | **保留** | 单向投影 |
| `information_pool_entry` | **重定义** | 从"状态表"改为 Slot + Item（引用 Claim） |
| IndustryKnowledge / Belief / Conflict | **保留** | 已是正向链 |
| MethodologyVersion / Candidate / HumanGate | **保留 + 扩展** | Dimension 加 weight/criticality/industryTypeRules；Candidate 加 sourceExperienceIds |
| `Claim` | **保留** | 已含 isRealExternalData |
| `Evidence` / `EvidenceAssertion` | **保留 + 落地** | 加 fragmentRef |
| `Source` / `Document` | **保留** | 与 Material/Fragment 衔接 |
| `TargetCandidate` / `ScreeningRun` / `ScreeningRule` | **改造** | 归为 `purpose=investment` |
| `scoring/`（7 维 0–100） | **升级为上层汇总层**（不废弃） | 7 维作为投资汇总维度，由 12 维研究维度加权聚合（见 §3.8a） |
| `evidence/` 空壳 | **落地** | 变 Fragment→Evidence→Claim 抽取管线（Phase C/E） |
| `planning/` 空壳 | **落地** | 变 Priority + NextAction 生成 |
| `agents/` / `dossier/` / `scheduler/` 空壳 | **按需落地或删除** | 不为"未来"保留 |
| ResearchChain / Position / ResearchTarget / Fit / DiligencePreparation / Material / Fragment / InvestmentEvaluation / ResearchExperience / Pattern / DiscoveryCandidate | **全部新建** | 按 Phase A–E 落地，**不提前建空表** |

---

## 11. 开放问题（需你决策，进入代码设计前）

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | `experience.kind` 的 T1–T5 是否够？是否需要"行业类型不匹配"等第 6 类 | 先 T1–T5，运行中再增 |
| Q2 | Pattern 的"至少 N 条"阈值（默认 3？） | 放 Methodology/配置，默认 3，可调 |
| Q3 | PoolSlot 的粒度：按 12 个维度，还是允许维度下再分子槽位 | 允许子槽位（如"市场规模"下分 TAM/SAM/SOM），但**不强制** |
| Q4 | `ResearchTarget` 的 `kindSubject` 如何存储（同表 JSON 扩展 vs 分表） | 同表 JSON 扩展（避免表爆炸），关键类型（company）保留外键 |
| Q5 | Evaluation 的 `score` 量纲 | **已裁决（见 §3.8a）**：底层 12 维研究维度 → 上层 7 维投资汇总（两层映射）；量纲与聚合规则均由 Methodology 定义 |
| Q6 | 是否需要 `Industry.reserveStatus` 的**变更历史表** | 需要（否则无法回答"何时进的储备"） |
| Q7 | Report/Dossier 的产物形态（DB 快照 vs 文件） | DB 存结构化 sections + 可选物化 Markdown 文件 |

---

## 结语

本领域模型严格承接 v3.1，**没有引入新的业务概念**，只把已有概念落成可承接的对象，并提前钉死 14 条不变量与幂等策略。

**请确认 §3（聚合与不变量）、§6（全局不变量）、§8（identity）、§11（开放问题）**。确认后即可进入**代码设计**（interface / 表 / 服务 / 工具 / 迁移），届时才动仓库源码。
