# 01 · Architecture Gap Report v2（最终架构校准审计）

> v2 · 对齐最终架构校准总指令 · 基于 Phase 1 实际代码 · 2026-09-22
>
> 本文件是 v1（`01-architecture-gap-report.md`）的升级。v1 已覆盖：Runtime 骨架可用、ResearchState 缺位、Industry/Company 非聚合根、评价未版本化、无 DataProvider、无 FragmentInput、跨层 Claim 无归属、Run/Round/Task 内存化、legacy host 并行、application 层缺失。v2 在 v1 基础上**补充**：Local-first 知识三资产、ResearchQuestion/ResearchTarget/ResearchChain、Diligence Preparation、Field Research 回流、Report=Snapshot、NL 交互层、Retrieval 六式、legacy host 退出路线、Phase 2–8 划分，并对每项给出 KEEP / MODIFY / MOVE / DEPRECATE / DELETE LATER 处置。

---

## 0. Phase 1 实际验证结果（本次真实跑）

| 验证项 | 命令 | 实际输出 | 结论 |
|---|---|---|---|
| 版本 | `node --import tsx src/cli/tiancha.ts --version` | `tiancha 0.1.0` | ✅ |
| Pi 底层版本 | `node --import tsx src/cli/tiancha.ts pi --version` | `0.86.1` | ✅ |
| 单元测试 | `node --import tsx --test packages/research/src/*.test.ts` | `# tests 9 / # pass 9 / # fail 0`（含 ResearchEventStore close/reopen、DAG 线性/成环/未知依赖） | ✅ |
| 构建 | `npm run build:cli` | `dist\cli\tiancha.js 28.3kb`，Done in 20ms | ✅ |
| Smoke | `node dist/cli/tiancha.js research smoke` | `[ok] Runtime assembled` / `[ok] Run created` / `[ok] Round created tasks=1` / `[ok] child session opened (real)` / `[ok] ArtifactStore round-trip` / `[ok] durable SQLite: 3 events` / **`PASS (child-session=real)`** | ✅ |

> 说明：smoke 命令在 PowerShell 下退出码报 1，是因为 `node:sqlite` 打了 `ExperimentalWarning` 到 stderr，PowerShell 把它当 NativeCommandError；stdout 明确 `PASS (child-session=real)`，Phase 1 未被破坏。v1 之后代码未改（本次仅新增文档、未触碰 src/ 与 packages/research/）。

---

## 1. 产品定位对照（Product）

| 要求 | 现状 | 处置 |
|---|---|---|
| Local-first、长期记忆、NL 为入口 | 当前 CLI 只有 `research smoke` / `session readonly`，默认 `piMain(args)` 进 Pi TUI；无 NL 意图路由 | **MODIFY**：新增 Agent Interaction Layer（见 Blueprint v2 §18） |
| 不暴露内部模型给用户 | 旧 `invest-extension.ts` 把「评分/提纲/报告/规划」写成显式意图词，且用户得说"打分/写报告"；无 `/createResearchQuestion` 之类但同样命令式 | **MODIFY**：意图路由隐式化；Domain Model 不进 prompt 给用户 |
| 核心飞轮 Research→Evidence→Knowledge→Gap→Target→Diligence→Field→Evidence | 新包只有 Run/Round/Task，无 Knowledge/Pool/Gap/Target/Diligence 任何一环 | **DELETE LATER / 重建**：见 §4–§9 |
| Chat History ≠ Knowledge Base | 旧 `src/store.ts memorySearch` 把 pool + material 正文当检索库，chat 与知识未分 | **DEPRECATE**：见 §11 |

---

## 2. Domain 层审计（packages/research/src/domain/，14 文件）

| 文件 | 现状 | 处置 |
|---|---|---|
| `research-context.ts` | 传给 Child Session 的切片契约；无 ResearchState | **KEEP**（冻结契约）+ **MODIFY**：后续把 ResearchState 引用注入 |
| `run.ts` / `round.ts` / `task.ts` / `task-graph.ts` / `task-attempt.ts` | 三层状态机、DAG、Attempt，与 04 一致 | **KEEP**（冻结） |
| `artifact.ts` | Artifact Contract（fact/claim/evidence/score/report/dossier） | **KEEP**；**MODIFY**：kind 增补 `fragment/source/document/report_snapshot/question/target/chain/diligence/methodology` |
| `research-event.ts` | runtime 事件 11 类 | **KEEP** |
| `human-gate.ts` | 实体契约 | **KEEP** |
| `evidence.ts` / `claim.ts` / `fact.ts` | Evidence/Claim/Fact + EvidenceAssertion 立场 | **KEEP**；**MODIFY**：`Claim.subjectKind/subjectId`、`Claim.temporalRelation`（old/new/conflict/supersede） |
| `company-industry-relation.ts` | 边表 | **KEEP** |
| `target-candidate.ts` | ScreeningRun/Rule/Candidate/Decision | **KEEP**，但**不等于**新要求的 `ResearchTarget`（见 §7） |

**缺失（v2 新增）**：

| 应新增 domain 对象 | 对应总指令条款 | 说明 |
|---|---|---|
| `research-state.ts` | §2 | Known/Confirmed/Uncertain/Conflicting/Unknown/KeyQuestions/Gaps/NextActions，持久化 |
| `industry.ts` / `company.ts` | §3 | 真 Aggregate Root |
| `research-question.ts` | §4 | 一等公民 |
| `research-target.ts` | §5 | ≠ Company，含 capability/rationale/fallback |
| `research-chain.ts` | §6 | 产业链节点图 |
| `information-pool.ts` | §1 | 研究所需信息的结构化状态 |
| `knowledge/methodology.ts` / `knowledge-industry.ts` / `knowledge-company.ts` | §1 | 三资产 |
| `fragment-input.ts` | §8 | 含 kind/sourceType/classification(NEW/CONFIRM/UPDATE/CONFLICT/SUPERSEDE) |
| `evidence-classification.ts` | §8 | 新旧信息关系 |
| `diligence-plan.ts` / `field-outline.ts` | §7 | |
| `report.ts` / `report-snapshot.ts` | §9 | Report 是 Snapshot，Evidence-linked |
| `evaluation.ts`（Framework/Version/Run/Result） | §10 | |
| `source.ts` / `document.ts` / `document-fragment.ts` / `citation.ts` | §9 | 溯源链 |

---

## 3. Runtime 审计（packages/research/src/runtime/，7 文件）

| 文件 | 现状 | 处置 |
|---|---|---|
| `tiancha-runtime.ts` | 装配 events/engine/orchestrator/stores | **KEEP** |
| `task-engine.ts` | 内存 Map；start 开 child session 但 `noTools:true` 不跑 LLM | **KEEP** 骨架 + **MODIFY**：Run/Round/Task 落库；加 DAG 驱动 |
| `orchestrator.ts` | 内存 Map；只 startRound/finishRound | **KEEP** + **MODIFY**：加 `runRoundUntilSettled`，critic rejected→新建 Round |
| `child-session.ts` | buildChildSessionOptions + noop | **KEEP** |
| `human-gate.ts` | SHA-256/timingSafe/single-use | **KEEP**（方法论版本化也要 Human-Gated，复用此原语） |
| `model-router.ts` / `research-event-adapter.ts` | 薄壳/双写 | **KEEP** |

**Runtime 红线核对**（总指令 §13）：
- ✅ 未建第二套 Agent Loop/Session/Reducer；
- ✅ `packages/research` 不 import `pi-coding-agent`（仅 `src/cli/tiancha.ts` 导入）；
- ✅ LLM 必经 `AgentSessionFactoryPort`；
- ✅ Artifact/Event Contract 未破；
- ✅ ResearchEventStore（SQLite）≠ Pi EventBus（transient）；
- ⚠️ 旧 `src/invest-extension.ts` 自建 `offline-mock` provider + streamSimple，**事实上是第二个 LLM 执行路径**——见 §11 legacy host。

---

## 4. Knowledge 三资产审计

| 资产 | 现状 | 处置 |
|---|---|---|
| **Methodology Knowledge**（如何研究） | 完全不存在。`config/scoring.json` 只有 7 维权重，无方法论版本、无 Human-Review 流程 | **NEW**：`knowledge/methodology.ts` + Methodology Candidate→Review→Version→Activate 流水线；复用 HumanGate |
| **Industry/Company Knowledge**（已知什么） | `src/store.ts` flat JSON（`data/pool/industries.json` seeded 人形机器人 A/84、固态电池 C/58；`data/profiles.json` markdown 全文）。无时间/来源/Evidence/冲突/版本 | **DEPRECATE 旧 flat JSON**；**NEW** `knowledge-industry.ts`/`knowledge-company.ts`，Evidence/Claim 为 SoT |
| **Research Information Pool**（需要什么/已有/缺失） | 完全不存在。`ResearchContextScope.openQuestions?: string[]` 只是临时切片 | **NEW** `information-pool.ts` |

**关键区分**（总指令 §1）：Information Pool ≠ Knowledge Base。Knowledge 是认知，Pool 是「研究所需信息的结构化状态」。v1 Blueprint 未把二者分开——v2 修正。

---

## 5. Research Loop / Diligence Loop / Field Research Loop 审计

| 闭环环节 | 现状 | 处置 |
|---|---|---|
| 发现机会 | 旧 `invest-extension.extractIndustry` 是 `text.includes(poolName)` 子串匹配（`src/invest-extension.ts:67-75`）；新包无 | **DEPRECATE 子串匹配**；NEW LLM extract + 标准化 |
| Research Gap 分析 | 无 | **NEW** |
| Research Question | 无（只有 `openQuestions: string[]`） | **NEW** 一等公民 |
| Research Target | `target-candidate.ts` 是「公司筛选打分」，非「问题驱动选谁能回答」 | **KEEP** 旧实体用于 screening；**NEW** `ResearchTarget` 独立（含 fallback） |
| Research Chain | 无 | **NEW** |
| Diligence Preparation | 旧 `tplOutline` 硬编码七模块 28 问（`invest-extension.ts:150-205`），与当前研究状态无关 | **DEPRECATE**；NEW 结合 State/Question/Gap/Target Capability 个性化生成 |
| Field Research Ingestion | 旧 `src/tools/material_ingest.ts` 只是入库；无 NEW/CONFIRM/UPDATE/CONFLICT/SUPERSEDE 分类、无回灌 Loop | **DEPRECATE**；NEW Fragment 流水线（重点测试期） |
| Evidence→Knowledge→Pool→State 更新 | 无 | **NEW** |

---

## 6. Persistence / Retrieval 审计

| 项 | 现状 | 处置 |
|---|---|---|
| SQLite 表 | 仅 `research_artifact`、`research_event`（`storage/artifact-store.ts:41`、`storage/research-event-store.ts:35`） | **KEEP** + **MODIFY**：新增 ~20 张表（见 Blueprint v2 §15） |
| 文件系统原始材料 | 无（旧材料塞 `data/materials.json` 一个 JSON） | **NEW**：`~/.tiancha/knowledge/sources/`、`runs/` |
| 目录结构 | 无统一 `~/.tiancha/knowledge/{methodology,industries,companies,sources}` | **NEW** |
| 检索 | 旧 `memorySearch` 是子串计数（`src/store.ts:161-178`）；无 fulltext/vector/hybrid/temporal/entity-aware | **DEPRECATE 子串**；**NEW** 六式检索（structured/fulltext/vector/hybrid/metadata/temporal/entity-aware） |
| Run/Round/Task 落库 | 内存 Map | **MODIFY**：补 `research-run/round/task` 表 |

---

## 7. Legacy Host 审计（src/，总指令 §14）

| 文件 | 作用 | 处置 |
|---|---|---|
| `src/store.ts` | flat JSON SoT（pool/profiles/materials/research/plans） | **DEPRECATE → DELETE LATER**：仅作种子迁移源；运行时不再读写 |
| `src/invest-extension.ts` | offline-mock provider，硬编码 71/B、模板提纲/报告/规划 | **DEPRECATE → DELETE LATER**：Vertical Slice 跑通后从加载链移除 |
| `src/wind-bridge.ts` + `tools/wind_query.py` | 双层静默 mock，5 字段 | **MOVE**：作为未来 `WindProvider` 后端；消除静默 mock，失败显式报错 |
| `src/tools/*.ts`（memory_search/wind_query/profile_read/profile_write/pool_list/material_ingest） | Pi tools 绑 flat JSON | **DEPRECATE → DELETE LATER** |
| `src/cli/tiancha.ts:260-261` | 默认 `await piMain(args)` | **MODIFY**：t1 阶段保留 delegate；t2 起 `tiancha` 进 Research 模式；Pi 仅底层 |
| `src/server.ts` / `src/agent-factory.ts` | web 宿主 | **MOVE/REVIEW**：Phase 7 后再定 |

**退出路线图**（详见 Blueprint v2 §19）：
- **t1（Phase 2 并行）**：新系统写 SQLite；旧 flat JSON 只读；invest-extension 标 legacy demo。
- **t2（Phase 3 末）**：新 `tiancha industry/company/fragment` 子命令接管；旧 tools 不注册。
- **t3（Phase 6 末）**：删除 `src/store.ts`、`invest-extension.ts`、旧 tools；wind-bridge 转为 WindProvider 实现。
- **t4（Phase 8）**：`tiancha` 默认 Research 模式，Pi 仅 runtime/migration/compatibility。

---

## 8. User Experience / Agent Interaction Layer 审计

| 要求 | 现状 | 处置 |
|---|---|---|
| NL 隐式意图路由 | 无 | **NEW**：`interaction/intent-router.ts`，把"机器人值得研究吗/下一步调研谁/帮我准备科大讯飞/这是会议稿/下一步研究什么"映射到 Service |
| 上下文连贯对话 | Pi TUI 自带 session；但 Research State 与 chat history 未打通 | **NEW**：Session Context ⊥ Research State ⊥ Knowledge ⊥ Pool ⊥ Evidence 五层分开 |
| 用户纠正（"这判断不对"） | 无 | **NEW**：找 Claim 标 disputed/corrected，不静默删；方法论层面→Methodology Candidate 等确认 |
| 不暴露内部模型 | 旧 extension 把任务类型写在回复里 | **MODIFY** |

---

## 9. Testing 审计

| 现状 | 处置 |
|---|---|
| 现有 9 个测试覆盖 EventStore close/reopen、DAG | **KEEP** |
| 无 E2E 测试覆盖任何业务闭环 | **NEW**：7 个 E2E 验收场景（§12） |
| 无重启恢复测试 | **NEW**：Phase 2 必测「kill 进程→重开→Industry/Knowledge/Pool/Evidence/Claims/State/原始材料都在」 |

---

## 10. 红线核对（v2 增补）

| 红线 | 状态 |
|---|---|
| 不创建第二个 Agent Loop | ⚠️ 旧 invest-extension 违反，见 §7 |
| Evidence/Claim/Fact/Event = SoT，Report=Snapshot | ❌ 当前无 Report 实体；旧 profiles.json 把 markdown 当 SoT |
| 禁止覆盖旧信息（时间维度+来源追踪） | ❌ 旧 `upsertIndustry`/`writeProfile` 直接覆盖 |
| 评分不硬编码 | ❌ `scoring/index.ts:14` `ENTER_POOL_THRESHOLD=65`；处置：**DELETE LATER**，改由 FrameworkVersion 持有 |
| DataProvider 不硬编码 Wind | ⚠️ locator 有 wind_field，端口缺失 |
| Local-first | ❌ 无 ~/.tiancha/knowledge 结构 |
| NL 入口 | ❌ 无 Intent Router |

---

## 11. 10 个业务闭环问题逐条答案

| # | 问题 | 现状答案 | 缺失点 |
|---|---|---|---|
| ① | 发现行业后能否知道当前最值得研究什么 | **不能**。无 ResearchState、无 Gap、无 Priority | 需 ResearchState + Gap Analysis + Priority 模型 |
| ② | 能否知道回答它需要什么信息 | **不能**。无 InformationPool、无 Information Requirements | 需 InformationPool + 由 Methodology/Framework 反推 |
| ③ | 能否知道谁最适合提供 | **不能**。无 ResearchChain、无 ResearchTarget/Capability | 需 ResearchChain + Target Capability 匹配 |
| ④ | 能否自动生成针对该对象的调研材料 | **不能**。旧 `tplOutline` 是通用模板，不结合 State/Target | 需 DiligencePreparation Service |
| ⑤ | 调研后输入零散会议稿能否真正进入研究系统 | **不能**。旧 material_ingest 只入库；无 Fragment→Evidence→Loop 回灌 | 需 FieldResearch Ingestion 流水线 |
| ⑥ | 能否判断新旧信息关系 | **不能**。无 NEW/CONFIRM/UPDATE/CONFLICT/SUPERSEDE；旧 upsert 直接覆盖 | 需 Evidence Classification + temporal 关系 |
| ⑦ | 能否更新 Information Pool | **不能**。Pool 实体不存在 | 需 InformationPool 实体 + 更新器 |
| ⑧ | 能否更新 Industry/Company Knowledge | **不能**。旧 flat JSON 是 markdown 覆盖，非 Evidence 聚合 | 需 Knowledge 实体 + 投影 |
| ⑨ | 能否更新 ResearchState | **不能**。State 实体不存在 | 需 ResearchState 持久化 |
| ⑩ | 能否据新 Gap 给下一步建议 | **不能**。`ResearchPlanner.plan(objective)` 是占位，无 NextAction 可执行 | 需 PlanningService + NextAction 枚举 |

**结论**：10 个闭环当前**全部不能**。Phase 1 只交付了 Runtime 骨架，业务闭环零实现。这正是 Phase 2 要补的。

---

## 12. 七个核心 E2E 验收场景（要点，详见 Blueprint v2 §22）

1. **"机器人值得研究吗"** → 意图路由→Industry 抽取/匹配→Information Requirements→补全→State→Next Action。
2. **"下一步调研谁"** → ResearchChain→候选 Target→Capability 匹配→推荐 + 理由 + 限制。
3. **"准备调研科大讯飞"** → DiligencePreparation 输出完整材料包（目的/认知/对象/能答/不能答/缺口/验证问题/追问/需索取材料/注意事项）。
4. **"这是会议文字稿"** → Fragment→Evidence→Claim 分类→与已有研究比较→更新 Pool/Knowledge/State→新 Gap→Next Action。
5. **无法确认主动询问** → "订单增长：待验证"，主动问用户要数字/材料，不编造。
6. **第二份材料交叉验证** → 两份 Fragment 对同一 Claim 的 stance=support/contradict 被识别，冲突并列保留。
7. **新缺口自动生成 Next Action** → State 更新后 PlanningService 产可执行 NextAction（含 kind/params/why）。

---

## 13. v1 → v2 差异清单

| v1 已覆盖 | v2 新增/修正 |
|---|---|
| Runtime 骨架 KEEP | 补「实际跑通验证输出」 |
| ResearchState 缺位 | 明确三资产中 ResearchState 与 Knowledge/Pool 的分离 |
| Industry/Company 非聚合根 | 增补 ResearchQuestion/ResearchTarget/ResearchChain/Diligence |
| 评价未版本化 | 增补 Methodology Knowledge 也需 Human-Gated + 版本化 |
| 无 DataProvider | Local-first 目录 + 六式检索 |
| 无 FragmentInput | Fragment 分类 NEW/CONFIRM/UPDATE/CONFLICT/SUPERSEDE + 禁止覆盖 |
| legacy host 并行 | 给出 t1–t4 退出路线图 |
| application 层缺失 | NL Intent Router（不暴露内部模型） |
| — | Report=Snapshot、Evidence-linked |
| — | Phase 2–8 重新划分、7 E2E 验收 |
| — | 10 闭环问题逐条答案 |
