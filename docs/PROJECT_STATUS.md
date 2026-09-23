# 项目状态报告 · Tiancha 天查

> ⚠️ **部分过时（2026-09-23 注）**：本文撰写于 2C 接线**之前**。此后 2C 已接线、P0（知识沉淀/回填接线）与 P1（方法论版本化演进）已完成，且 `tiancha industry ingest` 的输出已从 `gaps=0/nextActions=0` 变为 `gaps=12/nextActions=12`。**请以 `docs/HANDOFF.md` 为准。**
> 生成日期：2026-09-22 · 基于 Phase 2A/2B 实际代码与本次全量验证。

## 1. 产品定位

天查是 **Local-first、长期记忆、自然语言为入口** 的个人投资研究 Agent（Research Operating System），面向一级市场。不是通用聊天 Agent、不是 Pi 改版、不是 PDF/RAG/自动报告工具。核心飞轮：

```
发现机会 → 当前研究状态 → 信息缺口 → 研究问题 → 调研目标 → 尽调准备
→ 人工调研 → 碎片输入 → Evidence → Fact/Claim/Event → 知识与信息池更新
→ ResearchState 更新 → 新缺口 → 下一轮规划
```

## 2. 已完成 Phase 与交付物

| Phase | 状态 | 交付物 |
|---|---|---|
| 0 | ✅ | 架构审计、Gap Report/Blueprint v1/v2、v2.1 final-lock（8 项锁定修订） |
| 1 | ✅ | tiancha CLI、TianchaRuntime、ResearchContext、Run/Round/Task/TaskGraph、TaskAttempt、Artifact Contract、ArtifactStore、Durable Research Event Store(SQLite)、标准 Child Session、Pi Runtime 复用 |
| 2A | ✅ | Research Memory Foundation：11 张业务表、Methodology v1（12 维 Human-approved baseline）、Echo Provider、OpportunityDiscoveryService；CLI `industry ingest/show`、`state show` |
| 2B | ✅ | TianchaAgentHost（交互 REPL + `askOneShot` 共享装配）、6 个研究 customTools、无参数进 Agent 主入口、语义工具路由（无关键词分类器） |

## 3. 当前真实能力（能 / 不能）

**能：**
- 无参数 `tiancha` 进入天查 Agent 交互 REPL；`tiancha ask "..."` 非交互单轮（同一装配）。
- 把行业材料 ingest 进研究系统，自动建立 Industry、12 个 ResearchQuestion/InformationRequirement、InformationPool、Evidence/Claim、ResearchState、NextAction，并持久化到 `~/.tiancha/db/`。
- 研究工具（industry_show/state_show/question_list/gap_list/next_action_list/ingest）由主模型语义选择调用。
- 旧 Claim 不被新 Evidence 覆盖（T9：标记 temporalRelation=old，并存新 Claim）。
- Phase 1 运行时完整可自检（`research smoke`）。

**不能 / 边界：**
- 当前数据源是 **Echo 占位**（`isRealExternalData=false`），**不做真实投资判断、不打分**。
- 未实现：ResearchTarget / ResearchChain / Diligence / Field Research / Evidence-linked Report / Research Planning。
- 交互 Session 用 `SessionManager.inMemory`，**对话历史不跨进程**（重启即新会话）。
- 回复为 turn 完成后一次性输出，**未接流式 delta**。
- 无可用模型凭据时，`ask` 真实语义路由未在真实模型端到端验收。

## 4. 架构与目录现状

- 分层：`src/cli/tiancha.ts`（Composition Root，唯一 import coding-agent）→ `src/agent/`（TianchaAgentHost + research-tools）→ `packages/research/src/application/`（OpportunityDiscoveryService）→ `domain/` `ports/` `storage/` `runtime/` `providers/` `methodology/`。
- 依赖方向：`packages/research/src` 全树无 `@earendil-works/pi-coding-agent` 真实 import（唯一命中是 `index.ts:3` 注释）。
- 关键文件：`src/agent/tiancha-agent-host.ts`、`src/agent/research-tools.ts`、`packages/research/src/application/opportunity-discovery-service.ts`、`packages/research/src/storage/research-db.ts`、`packages/research/src/providers/echo-data-provider.ts`、`config/methodology-v1.json`。

## 5. 本次验证结果（实际运行）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit`（根） | exit 0 |
| `npm --prefix packages/research run typecheck` | exit 0 |
| `npm run build:cli` | 成功（esbuild） |
| 研究包测试 | `# tests 15 / # pass 15 / # fail 0` |
| Agent host 测试 | `# tests 2 / # pass 2 / # fail 0` |
| `research smoke` | `PASS (child-session=real)` |
| 依赖门 grep | 0 真实 import（1 注释命中） |
| `echo exit \| node dist/cli/tiancha.js` | 显示「天查>」提示符，exit 0，未进旧 host |

## 6. 本次 Review 发现与修复

**Git 卫生：**
- 停止跟踪 `.pi/auth.json`、`.pi/models-store.json`（内容为 `{}`，无泄露；防止将来 /login 写入真实 token）。
- 停止跟踪 `.tiancha/`（含迁移 marker 与 skills 拷贝）。
- `.gitignore` 新增 `.tiancha/`、`.pi/auth.json`、`.pi/models-store.json`、`**/auth.json`。
- 全仓密钥扫描：仅 human-gate resumeToken 哈希相关正当代码，无真实密钥。
- `.pi/skills/**` 保留跟踪（legacy t1）；`.tiancha/skills/**` 为迁移拷贝，已随 `.tiancha/` 停止跟踪，无重复问题。

**文档：**
- README 从 Phase 1 描述重写为反映 2A/2B：主入口、`ask`、能力边界、Phase 表、配置目录、依赖红线。

**代码（未做大改，仅记录）：** 未发现需立即修的架构性问题；CLI 保持极薄（不判意图、不直连 SQL、不自生成回答）。

## 7. 提交与远端状态

见下方回报中的 commit hash 与 push 确认。

## 8. 已知技术债 / 风险（建议归属 Phase）

| 技术债 | 影响 | 建议 Phase |
|---|---|---|
| ingest 非幂等（重复 ingest 同行业会新建一套 Question/Requirement/Pool） | 重复数据 | 2C/3 |
| SessionManager.inMemory，对话历史不跨进程 | 重启失忆 | 2D |
| Echo 覆盖全部 12 维 → 首次 gaps/nextActions=0 | 链路演示无缺口 | 3（真实数据源接入后自然消失） |
| 回复非流式（agent_end 一次性取文本） | 体验 | 2B 后续优化 |
| 无模型凭据时语义路由未端到端验收 | T6/T7 为契约级 | 有模型环境后补 |
| legacy host（src/store.ts、invest-extension、wind-bridge）仍在仓库 | 维护负担 | 后续退出路线 |

## 9. 后续 Phase 计划与成功标准

- **2C**：Knowledge Projection（Evidence→Claim→Industry Knowledge，provenance/source/time/conflict）、T5 Methodology Human Gate、T10 Conflict 双 Evidence 保留。成功标准：新证据不静默覆盖，冲突并存。
- **2D**：T11 kill→restart 数据/材料/State 可恢复；全量回归。
- **3–8**：见 README 路线表。
