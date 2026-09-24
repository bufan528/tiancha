# docs 文档地图（权威性排序）

> **2026-09-24** · 当本文与其他文档冲突时，按下面的顺序取信。
> 一句话：**只有第一组与代码同步**；其余是设计演进记录、已归档内容或 legacy 工作台文档。

---

## ✅ 权威（与当前代码逐项核对）

| 文档 | 内容 |
|---|---|
| [`HANDOFF.md`](./HANDOFF.md) | **总入口**：完整需求（25 步链路 / 两个知识体系 / 两个 Loop / 四类知识 / 红线）、真实状态、架构、路线、踩坑 |
| [`architecture-review/06-business-intelligence-architecture-v3.1-final.md`](./architecture-review/06-business-intelligence-architecture-v3.1-final.md) | **业务与知识模型（最终锁定）**：四类知识、两个 Loop、Pool=组织层、Priority 内环、Evaluation 四面、Report=Projection、入口能力 |
| [`architecture-review/07-domain-model-design.md`](./architecture-review/07-domain-model-design.md) | **领域模型**：10 限界上下文、聚合与不变量（I1–I16）、identity、生命周期、**§3.8a 评分口径（12→7 两层映射）** |
| [`architecture-review/08-code-design.md`](./architecture-review/08-code-design.md) | **代码设计**：Phase A 详细设计 + S1–S7 小步拆分、表 / 接口 / 工具 |

## 🕘 历史（设计演进记录；部分内容已被 06/07/08 取代）

| 文档 | 说明 |
|---|---|
| [`architecture-review/05-business-intelligence-architecture-v3.md`](./architecture-review/05-business-intelligence-architecture-v3.md) | v3（v3.1 的前身） |
| [`architecture-review/04-research-intelligence-architecture-review.md`](./architecture-review/04-research-intelligence-architecture-review.md) | 实现状态盘点 + 需求→能力映射；其**设计部分**已被 06 取代 |
| [`architecture-review/01-architecture-gap-report*.md`](./architecture-review/) | 早期 Gap Report（v1 / v2） |
| [`architecture-review/02-architecture-blueprint*.md`](./architecture-review/) | Blueprint v1 / v2 / **v2.1-final-lock**（历史最高权威，但早于天查三体系重定义） |
| [`architecture-review/03-rebaseline-research-knowledge-coevolution.md`](./architecture-review/03-rebaseline-research-knowledge-coevolution.md) | Re-baseline v3 / v3.1（箭头判定表；2C 已完成，表已过时） |
| [`phase0/`](./phase0/) | Phase 0 架构审计、Research Kernel / Runtime / DataModel / Migration 设计（Phase 0 时代） |
| [`phase2c/implementation-design.md`](./phase2c/implementation-design.md) | Phase 2C 实施设计（**已实现**；其中"2C 边界"部分仍可参考） |

## 🗄 已归档 / 已被取代（不要据此判断当前状态）

| 文档 | 说明 |
|---|---|
| [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) | **已归档**：描述 Phase 2A/2B 时代状态 |
| [`SCORING_MODEL.md`](./SCORING_MODEL.md) | **已被"两层映射"取代**：7 维 0–100 现为上层投资汇总维度；`config/scoring.json` 不接线 |

## 🚫 LEGACY（旧 Pi 工作台文档，与当前天查架构无关）

| 文档 | 说明 |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | legacy 工作台 v2.0 架构（路径仍写旧的 `D:\diaoyan-agent`） |
| [`CORE_CUSTOMIZATION.md`](./CORE_CUSTOMIZATION.md) | 早期对 `vendor/pi` 的内核定制记录（compaction / research-prompt / quality-gate），不在当前主路径上 |

---

## 相关根文件

- [`../README.md`](../README.md) — 项目门面：快速开始 / 命令 / 路线（已与代码对齐）
- `../config/methodology-v1.json` — 12 维 Human-approved baseline（含 weight / criticality）
- `../config/scoring.json` — legacy 评分配置（**不接线**）
