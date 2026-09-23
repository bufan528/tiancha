# Tiancha · 天查 — 项目交接文档（HANDOFF）

> 2026-09-23 · 基于真实代码状态，目标：另一位开发者/agent 无需口头交接即可接手。
> 远端：https://github.com/bufan528/tiancha · main · 当前 HEAD `5375000`。

---

## 1. 项目定位、产品愿景与设计原则

Tiancha 是 **local-first、长期记忆、自然语言为入口的一级市场 Research Intelligence Agent**。不是通用聊天 Agent、不是 Pi 改版、不是 PDF/RAG/自动报告工具。用户在和"天查"聊天，研究系统藏在 Agent 后面。

核心飞轮（长期 Research Loop）：
```
发现机会 → 当前状态 → Research Gap → Research Question → Research Target
→ Diligence 准备 → 人工调研 → 碎片输入 → Evidence/Claim/Event
→ Knowledge / Information Pool 更新 → ResearchState 更新 → 新 Gap → 下一轮
```

设计原则（不可违背）：
- **自然语言优先**：不向普通用户暴露 ResearchState / Pool / TaskGraph / Agent 名 / service 名。
- **local-first**：结构化实体、状态、事件、Claims、Evidence metadata 存 SQLite；原始材料/报告/录音/Artifact 存文件系统。
- **evidence-first**：Evidence/Claim/Fact/Event 是 Source of Truth；Report/Profile/Dossier 是 Snapshot。
- **单向链路**：Knowledge → InformationPool → ResearchState → Gap；**State 永不回写 Pool**，禁止 Pool→State→Pool 循环。
- **历史永不覆盖**：新旧 Evidence/Claim/Belief 并存并比较（SUPPORT/REVISE/CONFLICT/SUPERSEDE）。
- **Conflict 不选边**：冲突双方全保留，状态=open，不自动判对错。
- **Methodology Human Gate**：v1 是 Human-approved baseline，模型不得自动改方法论。

---

## 2. 整体架构

```
Composition Root: src/cli/tiancha.ts   ← 唯一装配点，唯一 import coding-agent
        │
TianchaAgentHost (src/agent/tiancha-agent-host.ts)
   ├─ 交互 REPL / askOneShot（共享同一套 Agent 装配）
   ├─ 天查系统提示 + 6 个研究 customTools（src/agent/research-tools.ts）
   └─ 经 TianchaAgentSessionFactory → Pi Runtime（复用，不重写 Loop/Session）
        └─ Research Core (packages/research) 仅依赖 Port，绝不 import coding-agent
```

依赖方向（dependency gate 强制）：`pi-ai ← agent-core(coding-agent) ← research-core ← composition-root`。
`packages/research/src` 全树 grep `@earendil|coding-agent|pi-coding` 真实 import = 0（命中均为注释）。

---

## 3. 目录结构

```
src/
  cli/tiancha.ts                Composition Root；无参数进 Agent REPL，ask/industry/state/smoke 子命令
  agent/tiancha-agent-host.ts   TianchaAgentHost（startInteractive / askOneShot）
  agent/research-tools.ts       6 个研究工具（语义工具选择，无关键词分类器）
  agent/host.test.ts            T6/T7
  tools/                        旧 host 工具（material_ingest/memory_search/wind_query 等，legacy）
  store.ts / invest-extension.ts / wind-bridge.ts / server.ts  旧 root host（legacy t1，非默认入口）

packages/research/src/
  domain/           领域对象（Industry/Company/Question/Requirement/Gap/Pool/State/
                    Claim/Evidence/Fact/Methodology/IndustryKnowledge/KnowledgeBelief/KnowledgeConflict）
  ports/            Port 抽象（AgentSessionFactory/EventBus/Session/DataProvider…）
  storage/          research-db.ts（建表+PRAGMA 迁移）、research-repository.ts、
                    knowledge-repository.ts、artifact-store.ts、research-event-store.ts
  application/      opportunity-discovery-service.ts（2A）、knowledge-projection-service.ts（2C）
  providers/        echo-data-provider.ts（占位）、ports/data-provider.port.ts
  runtime/          tiancha-runtime/task-engine/orchestrator/child-session/human-gate/model-router/event-adapter
  migration/        pi-to-tiancha、readonly-session-manager
  methodology/      methodology-v1.ts（12 维 baseline）
  agents/ planning/ scheduler/ evidence/ dossier/ scoring/   Phase 1 占位
  *.test.ts         研究包测试（foundation / knowledge / knowledge-projection / knowledge-pool-reconcile / knowledge-state-refresh / knowledge-gap-refresh）

config/methodology-v1.json      12 维 Human-approved baseline
docs/phase0/                    P0 设计（01–09）
docs/architecture-review/       Gap Report / Blueprint v1/v2/v2.1-final-lock / rebaseline v3.1
docs/phase2c/implementation-design.md
docs/PROJECT_STATUS.md
vendor/pi/                      Pi 源码快照（MIT）
samples/                        示例材料
```

---

## 4. 环境、安装、构建、运行

- Node ≥ 22（当前 22.23）。
```powershell
npm install
npx tsc --noEmit                                  # 根类型检查
npm --prefix packages/research run typecheck      # 研究包类型检查
npm run build:cli                                 # esbuild → dist/cli/tiancha.js
node --import tsx --test packages/research/src/*.test.ts
node --import tsx --test src/agent/*.test.ts
node dist/cli/tiancha.js research smoke           # 预期 PASS (child-session=real)
```
- `npm run tiancha` = `node --import tsx src/cli/tiancha.ts`。
- 配置目录 `~/.tiancha/`：`agent/`（Pi 会话/扩展）、`db/tiancha.sqlite`（研究库）、`db/artifacts.sqlite`（Claim/Evidence blob）。
- 凭据 `.pi/auth.json`、`.pi/models-store.json`、`.tiancha/`、`*.sqlite`、`dist`、`node_modules` 均 gitignore。

---

## 5. CLI 与研究工具

| 命令 | 说明 |
| --- | --- |
| `tiancha`（无参数） | 天查 Agent 交互 REPL（主入口） |
| `tiancha ask "<NL>"` | 非交互单轮（同一装配） |
| `tiancha industry ingest <file> --name <行业>` | 行业材料入库（2A 骨架） |
| `tiancha industry show <行业>` / `state show <行业>` | 查看行业/状态 |
| `tiancha research smoke` | 运行时自检 |
| `tiancha session readonly <path>` | 只读恢复会话 |

研究 customTools（6 个，主模型语义选择）：`research_industry_ingest / research_industry_show / research_state_show / research_question_list / research_gap_list / research_next_action_list`。

---

## 6. 数据模型

**四类长期资产：**
1. **Investment Methodology**（如何研究）：`methodology` 表 + 12 维 baseline；Human-gated。
2. **Industry/Company Knowledge**（知道什么）：`industry_knowledge` + `knowledge_belief` + `knowledge_conflict`。
3. **Information Pool / State**（需要什么·已知多少）：`information_pool_entry` + `research_state`。
4. **Research Experience**（未来一等概念，本阶段不实现）：未来由 Research Event 派生。

**追溯链**：IndustryKnowledge → Belief(claimRef/sourceRef/evidenceRef) → Claim(Artifact) → Evidence(占位) → Source → Document。
**四种 Evolution**：SUPPORT（同向支持）/ REVISE（修正，旧 revised）/ CONFLICT（显式互斥，双方 conflicting + open conflict 行）/ SUPERSEDE（旧 superseded）。

**SQLite 表（同库 tiancha.sqlite）**：industry、company、research_question、information_requirement、research_gap、information_pool_entry、research_state、research_source、research_document、next_action、methodology（2A 11 张）+ industry_knowledge、knowledge_belief、knowledge_conflict（2C）+ industry.current_knowledge_id 列。Claim/Evidence blob 存 artifacts.sqlite。

---

## 7. 数据源

- **EchoDataProvider**（`providers/echo-data-provider.ts`）：确定性占位，强制 `isRealExternalData=false`/`sourceType=echo_placeholder`，禁做真实投资判断。
- **DataProvider Port**（`ports/data-provider.port.ts`）：未来接 Wind/Web/公司官网/上传/MCP。
- 旧 `src/wind-bridge.ts` 为 mock/legacy，非当前路径。

---

## 8. 模型系统

复用 Pi：Provider/Auth/ModelRegistry/Model Policy/Router；经 composition root 注入。研究包不直接依赖。无 key 时语义路由未端到端验收（技术债）。

---

## 9. 已完成 Phase 与路线图

| Phase | 状态 |
|---|---|
| 0 架构审计/Lock | ✅ |
| 1 Runtime 契约（Run/Round/TaskGraph/TaskAttempt/Artifact/EventStore/Child Session） | ✅ |
| 2A 研究记忆底座 + 11 表 + Methodology v1 + Echo | ✅ |
| 2B Agent 主入口 + 语义工具路由 | ✅ |
| 2C Knowledge 投影 | 🚧 已落地 Domain/三表/四种 Evolution/Knowledge→Pool→State→Gap；待做 **Gap→NextAction 刷新（3-B）**、ingest 自动接线（3-C）、Methodology Human Gate 运行时 |
| 2D 重启恢复/持久化回归 | ⏳ |
| 3 Industry Research Engine | ⏳ |
| 4 Research Target/Chain/Recommendation | ⏳ |
| 5 Diligence Preparation | ⏳ |
| 6 Field Research Ingestion | ⏳ |
| 7 Evidence-linked Report | ⏳ |
| 8 Research Planning | ⏳ |

---

## 10. 已知技术债与边界

- `ingest` 非幂等（2A OpportunityDiscoveryService）。
- Agent Session 用 inMemory SessionManager，对话历史不跨进程。
- 回复非流式；无模型 key 时语义路由未端到端验收。
- legacy host（`src/store.ts`/`invest-extension.ts`/`wind-bridge.ts`）按 t1 保留，不可再发展为默认入口。
- Gap importance 高/低阈值暂用 `>=2`，未与 Methodology 12 维对齐。
- Gap 与 KnowledgeConflict 未做字段级关联（仅 dimension 间接对应）。

---

## 11. 开发规范

- **小步闸门式**：每步 build+typecheck+全量测试+smoke 全绿才进下一步；单一目的 commit、可回滚。
- **八条 Invariant**：Pool≠Knowledge；Evolution 不删历史；Conflict 不选边；State 不回写 Pool；Echo 不变真证据；Methodology 无 Human Gate 不 Activate；Knowledge 可回溯 Claim/Evidence/Source/Doc；Phase1/2A/2B 行为不变。
- **Scope Fence**：不重写 Pi Loop、不建第二套 Session、Research Core 不 import coding-agent、不裸调 agentLoop、Task 输出不绕过 Artifact、Dossier 非 SoT。

---

## 12. 关键决策记录

- v3.1 边界：Pool→State 单向；2C 不做真实 Material→Evidence 抽取；IndustryKnowledge 是长期 Cognition 非 Claim 列表；撤回 experienceRefs/空表；Research Event 本阶段不实现。
- Knowledge header = 当前投影（version 递增、无快照表）；历史由 Belief+Relation+Conflict 保留。
- industry 加列走 **PRAGMA table_info 预检查**，try/catch 仅兜底。
- Claim 无 dimension 字段 → `projectFromClaim` 显式传 dimension。

---

## 13. 接手第一步与踩坑

- **下一步**：Phase 2C 3-B（Gap→NextAction 刷新），再 3-C（ingest 接线：Echo Claim 后自动 project→reconcilePool→refreshState→refreshGaps）。
- git push 已配置好（origin https://github.com/bufan528/tiancha.git），直接 `git push origin main`。
- 改 industry 表加列务必走 PRAGMA 预检查，别裸 ALTER。
- legacy host（src/store.ts 等）不可再作为执行入口；`tiancha` 无参数必须进天查 Agent。
- PowerShell 下 stderr 的 NativeCommandError 是 esbuild/Smoke 写 stderr 的正常现象，不是失败。
