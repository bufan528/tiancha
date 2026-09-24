/**
 * S7 presentation formatters — **PURE functions** (no IO, no DB, no business rules).
 *
 * R2: ONE service result, TWO renderers (`human` / `toJson`). Both consume the SAME
 * result object; `--json` is an output-format switch, NOT a second code path.
 *
 * I16 / "证据不足" (S7 red line): `insufficient_evidence` renders as "证据不足" and must
 * NEVER be turned into a bullish/bearish judgement. The forbidden wording
 * (不看好 / 值得投 / 建议投资 / 不值得投 / 看好 / 不看好该行业) is asserted absent by tests.
 */

import type {
  IndustryDossier,
  InformationPoolItem,
  InformationPoolSlot,
  InvestmentEvaluation,
  ResearchPriority,
} from "@tiancha/research";

/** The one and only rendering of the `insufficient_evidence` state. */
export const EVIDENCE_INSUFFICIENT = "证据不足";

const DIMENSION_STATUS_LABEL: Record<string, string> = {
  evaluated: "已评估",
  insufficient_evidence: EVIDENCE_INSUFFICIENT,
  conflicting: "存在冲突",
  not_applicable: "不适用",
};

const DECISION_LABEL: Record<string, string> = {
  reserve: "可储备",
  watch: "观察",
  park: "暂缓",
  pending: "暂不判断",
};

const GAP_TYPE_LABEL: Record<string, string> = {
  unknown: "未知",
  insufficient: EVIDENCE_INSUFFICIENT,
  conflict: "存在冲突",
};

export function dimensionStatusLabel(status: string): string {
  return DIMENSION_STATUS_LABEL[status] ?? status;
}

export function decisionLabel(status: string): string {
  return DECISION_LABEL[status] ?? status;
}

export function gapTypeLabel(gapType: string): string {
  return GAP_TYPE_LABEL[gapType] ?? gapType;
}

/** The json renderer. Round-trips: `JSON.parse(toJson(v))` deep-equals `v`. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export interface PoolSlotView {
  slot: InformationPoolSlot;
  items: InformationPoolItem[];
}

function dimensionLabel(key: string, names: Record<string, string>): string {
  return names[key] ? `${names[key]}（${key}）` : key;
}

export function formatEvaluationHuman(ev: InvestmentEvaluation, names: Record<string, string> = {}): string {
  const lines: string[] = [];
  lines.push(
    `投资评估 · 方法论 ${ev.methodologyVersionId} / 评估规则 ${ev.evaluationPolicyVersionId} / 汇总规则 ${ev.aggregationPolicyVersionId}`,
  );
  lines.push(
    `覆盖度：已评估 ${ev.coverage.evaluated}，${EVIDENCE_INSUFFICIENT} ${ev.coverage.insufficient}，存在冲突 ${ev.coverage.conflicting}，不适用 ${ev.coverage.notApplicable}（共 ${ev.coverage.total}）`,
  );
  lines.push("各维度：");
  for (const d of ev.dimensionEvaluations) {
    const score = typeof d.score === "number" ? ` 分值 ${d.score}` : " 无分值";
    lines.push(`  - ${dimensionLabel(d.dimension, names)}：${dimensionStatusLabel(d.status)}${score}`);
  }
  lines.push(`决策：${decisionLabel(ev.decision.decisionStatus)} —— ${ev.decision.decisionReason}`);
  return lines.join("\n");
}

export function formatPoolHuman(views: PoolSlotView[], names: Record<string, string> = {}): string {
  if (views.length === 0) return "信息池：暂无槽位。";
  const lines: string[] = ["信息池（槽位 + 条目）"];
  for (const v of views) {
    lines.push(`  - ${dimensionLabel(v.slot.dimension, names)}：${v.slot.status} —— ${v.slot.coverageJudgement}`);
    for (const it of v.items) {
      const relation = it.relation === "consistent" ? "" : ` [${it.relation}]`;
      lines.push(`      · ${it.claimRef}${relation}`);
    }
  }
  return lines.join("\n");
}

export function formatPriorityHuman(ps: ResearchPriority[], names: Record<string, string> = {}): string {
  if (ps.length === 0) return "研究优先级：暂无（尚未产生可读取的优先级）。";
  const lines: string[] = ["研究优先级（分数高者先做）"];
  ps.forEach((p, i) => {
    lines.push(`  ${i + 1}. ${p.gapId}  优先级 ${p.score}/100  （规则 ${p.policyVersionId}）`);
    lines.push(`     依据：${p.rationale}`);
  });
  void names;
  return lines.join("\n");
}

export function formatReportHuman(d: IndustryDossier, markdownPath: string): string {
  const s = d.sections;
  const priority = s.priority.length > 0 ? s.priority.map((p) => `${p.gapId}=${p.score}`).join(", ") : "暂无";
  const evaluation = s.evaluation
    ? `${decisionLabel(s.evaluation.decisionStatus)}（${s.evaluation.decisionReason}）`
    : "暂无";
  return [
    "研究报告（只读投影，不是事实来源）",
    `  行业：${d.industryId}`,
    `  快照：${d.dossierId}（知识版本 v${d.knowledgeVersion}）`,
    `  内容：当前认知 ${s.currentKnowledge.length} · 关键事实 ${s.keyFacts.length} · 主要判断 ${s.mainJudgments.length} · 主要冲突 ${s.conflicts.length} · 缺口 ${s.gaps.length} · 下一步 ${s.nextActions.length}`,
    `  当前评价：${evaluation}`,
    `  优先级：${priority}`,
    `  Markdown：${markdownPath}`,
  ].join("\n");
}
