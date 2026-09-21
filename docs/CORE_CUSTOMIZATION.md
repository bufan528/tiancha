# 内核定制说明（CORE_CUSTOMIZATION）

## 1. Vendor 状态（已完成）

- 上游仓库：https://github.com/earendil-works/pi （MIT，作者 badlogic / Mario Zechner）
- 落地位置：`vendor\pi`
- 上游 commit：`19451accdeec671c1f4da9eafac8fc270f510ef4`（HEAD，clone 于 2026-09-20）
- 同步方式：`git -C vendor\pi remote add upstream https://github.com/earendil-works/pi`；升级时 `git fetch upstream && git merge upstream/main`，冲突以本文件记录的定制点为界
- 版权：`vendor\pi\LICENSE` 保留；根目录 `ATTRIBUTION.md` 声明本工程包含 earendil-works/pi 的 MIT 代码

## 2. 分工原则

- 能用 Pi 扩展点（extension / customTool / SKILL / systemPromptOverride）干净实现的业务逻辑 → 放宿主工程（`.pi\extensions`、`.pi\skills`、`src\tools`）
- 属于运行时循环、上下文压缩、记忆注入、调度层面、扩展点够不着的 → 直接改 `vendor\pi` 源码，并在本文件第 3 节登记

## 3. 内核定制点（实现登记）

> 本轮（2026-09-20）实际落地项见下。上游 commit 仍为 `19451accdeec671c1f4da9eafac8fc270f510ef4`；冲突以本表登记点为界。

| # | 定制方向 | 落点（vendor/pi 内） | 方式 | 状态 |
|---|---|---|---|---|
| 1 | 投研深度研究循环骨架（规划→假设→多源→交叉验证→评分→结论→自检） | `packages/agent/src/harness/research/research-prompt.ts`（新增）+ 经 `index.ts` 公开导出 | 可配置注入（扩展层把返回文本放进 system prompt 的 `research_loop` section） | ✅ 内核骨架已出 |
| 2 | 上下文压缩面向投研：保留数据/结论/来源/评分依据 | `packages/agent/src/harness/compaction/compaction.ts` | 内核小改（替换提示词模板） | ✅ 已改 |
| 3 | 记忆一等公民：信息池注入/档案更新/冲突处理 | 宿主 extension 在 `session_start`/`before_provider_request` 注入 | 扩展优先，内核兜底 | ⬜ 本轮未动 |
| 4 | 质量门：交付前事实核查/逻辑自检 review 循环 | `packages/agent/src/harness/research/quality-gate.ts`（新增），挂现有 `before_run_end` hook | 内核新增模块，最小侵入 | ✅ 已出 |
| 5 | 人机协同：入储备库/重大结论节点确认与纠偏 | extension UI + 宿主写回 | 扩展 | ⬜ 本轮未动 |
| 6 | 并行工具/子 agent 多源交叉验证 | 复用 pi-agent-core 并行 tool calling，编排归宿主 | 复用为主 | ⬜ 本轮未动 |

### 3.1 本轮实际改动清单

构建基线：`vendor\pi` 根目录 `npm install`（333 包）；按上游依赖序 `npm run build:offline` 全量构建 chord→tui→telemetry→ai→durable→agent→sqlite-node→protocol→client→server→coding-agent，**退出码 0**，`node packages/coding-agent/dist/bundle/cli.js --version` 输出 `0.86.1`。
（首次构建卡在 `ai` 的 `check:model-data`，原因是 `src/providers/data/*.json` 为生成文件未提交；已按提示跑 `npm run hydrate:model-data` 拉取 1443 个模型后续建通过。生成的 data 文件不入 git，非内核定制。）

**改动文件（仅 3 处，均在 `packages/agent`，未触碰 `src\web\.pi`）：**

1. `packages/agent/src/harness/compaction/compaction.ts`（`git diff --stat`：+17/-3 行）
   - **改了什么**：`SUMMARIZATION_PROMPT` 与 `UPDATE_SUMMARIZATION_PROMPT` 各新增一节 `## Key Evidence & Scoring`，并在结尾补“绝不丢弃数字/引用/评分理由”的硬约束；`TURN_PREFIX_SUMMARIZATION_PROMPT` 追加一句证据保留要求。
   - **原因**：原模板面向编码场景，压缩后常把 TAM/CAGR/估值/评分理由与出处一并糊掉，投研长对话一压缩就丢证据链。
   - **效果**：压缩 checkpoint 显式保留①关键数据点（含单位/时点）②结论与置信度③信息来源（名称/日期/定位）④各维子分/权重/锚点/总分与入池阈值判定⑤未决矛盾。纯字符串改动，零运行时风险；已在 `dist/harness/compaction/compaction.js` 校验新节存在。

2. `packages/agent/src/harness/research/quality-gate.ts`（新增，唯一新增内核模块）
   - **改了什么**：导出 `QualityGateConfig`/`QualityGateReviewer`/`QualityGateResult`、`heuristicReviewer`、`createQualityGateHook`、`registerQualityGate(hooks, config)`。
   - **接入方式（最小侵入）**：复用现有 `before_run_end` hook。该 hook 返回 `{ followUp }` 时，runtime（`runtime/drive/boundary.ts`）会把它作为新 user 消息追加并继续 run——天然形成 review 循环。模块**不改任何 runtime/reducer/drive 代码**。
   - **默认关闭**：`enabled` 缺省 `false`，即不接线时无任何额外 provider 调用、不影响启动；host 用 `registerQualityGate(hooks,{enabled:process.env.PI_RESEARCH_MODE==="1",reviewer:模型实现})` 一行开启。内置 `heuristicReviewer` 离线保守兜底（只在“像投研结论却缺分数/缺出处”时打回），reviewer 抛错时 fail-open 不阻断交付；内置 per-run 计数上限（默认 2 次）防死循环。
   - **效果**：交付前事实核查/逻辑自检循环能力就绪；离线冒烟验证：缺分数+缺出处→返回 followUp 打回，齐全→放行，关闭→no-op。

3. `packages/agent/src/harness/research/research-prompt.ts`（新增）+ `packages/agent/src/harness/research/index.ts`（新增 barrel）+ `packages/agent/src/index.ts`（+1 行 re-export）
   - **改了什么**：导出 `DEFAULT_RESEARCH_LOOP_PROMPT`、`RESEARCH_LOOP_SECTION_NAME="research_loop"`、`buildResearchLoopSection({enabled, scoringConfig, prompt})`。
   - **注入方式（可配置）**：`enabled` 缺省 false 返回 `undefined`（默认行为不变）；开启时返回七步循环骨架（规划→假设→多源采集→交叉验证→评分→结论→自检），并可把 `config/scoring.json` 内容以 `<scoring_config>` 原样拼入，使“改配置即改打分口径”与 `docs/SCORING_MODEL.md` 一致。由扩展层放进 system prompt 的 `research_loop` section（沿用 `buildSystemPromptSections` 的既有 section 机制）。
   - **效果**：内核提供骨架与拼接器，宿主/扩展层决定何时启用；已在构建产物中校验可被 `import`。

**回归验证**：
- `tsgo` 全量类型检查通过（新增文件无类型错误）；
- `node packages/coding-agent/dist/bundle/cli.js --version` → `0.86.1`；
- 从构建产物 `@earendil-works/pi-agent-core` 可 `import` 全部 6 个新符号；
- 离线冒烟脚本（已清理）验证研究骨架构造与质量门打回/放行/关闭三态。

**未做/卡点**：质量门的“模型 backed reviewer”具体提示词与多轮打回文案留待宿主接入时按真实模型调优；记忆注入（#3）、人机协同（#5）、并行编排（#6）按分工归宿主工程，本轮未动。
