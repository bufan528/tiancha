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
  DiligencePreparation,
  FitSummary,
  IndustryDossier,
  InformationPoolItem,
  InformationPoolSlot,
  InvestmentEvaluation,
  PositionProjectionResult,
  ResearchNeed,
  ResearchPriority,
  ResearchTarget,
} from "@tiancha/research";
// ★ C2: the current/retired question predicates live in the domain (single source of truth).
import { currentQuestions, retiredQuestions } from "@tiancha/research";
// ★ C2 Step 2-A: read-only position coverage (capability vs current research state).
import type { PositionCoverage } from "@tiancha/research";

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

/** C-MVP: the before/after view of one material ingestion (so a user SEES the effect). */export interface MaterialAddView {
  industry: string;
  title: string;
  materialId: string;
  created: boolean;
  parsedClaims: number;
  parseErrors: string[];
  before: { openGaps: number; priorities: number; slotStatuses: Record<string, string> };
  after: { openGaps: number; priorities: number; slotStatuses: Record<string, string> };
}

export function formatMaterialAddHuman(v: MaterialAddView): string {
  const changed = Object.keys(v.after.slotStatuses).filter(
    (k) => v.before.slotStatuses[k] !== v.after.slotStatuses[k],
  );
  const lines: string[] = [
    `材料入库${v.created ? "" : "（相同材料已存在，本次跳过）"}：${v.title}`,
    `  行业：${v.industry} · material ${v.materialId} · 解析出 ${v.parsedClaims} 条 claim`,
  ];
  if (v.parseErrors.length > 0) lines.push(`  解析提示：${v.parseErrors.join("；")}`);
  lines.push(`  开放缺口：${v.before.openGaps} → ${v.after.openGaps}`);
  lines.push(`  优先级条目：${v.before.priorities} → ${v.after.priorities}`);
  lines.push(
    changed.length > 0
      ? `  槽位变化：${changed.map((k) => `${k} ${v.before.slotStatuses[k]}→${v.after.slotStatuses[k]}`).join("，")}`
      : "  槽位变化：（无）",
  );
  return lines.join("\n");
}

/** B2: one human-confirmed research target. */
export function formatTargetHuman(t: ResearchTarget): string {
  const lines: string[] = [
    `研究对象已确认：${t.subjectKey}（${t.targetKind}）`,
    `  ${t.targetRef} · 位置 ${t.positionRef} · 状态 ${t.status} · 确认人 ${t.createdBy}`,
    `  研究目的：${t.researchPurpose}`,
    `  选择理由：${t.selectionReason}`,
    `  预期信息价值 ${t.expectedInformationValue.toFixed(2)} · 可接触性 ${t.accessibility}`,
  ];
  if (t.isFallback) {
    lines.push(`  ⚠ 备选对象（替代 ${t.fallbackForTargetRef}）：${t.limitations.join("；")}`);
  } else {
    lines.push(`  局限：${t.limitations.join("；") || "（无）"}`);
  }
  return lines.join("\n");
}

// ---- B5: chain / need / target-with-fit / diligence exposure ----------------

/** One B5 chain view: the projection result (positions + reported empty nodes). */
export function formatChainHuman(
  result: PositionProjectionResult,
  coverage: PositionCoverage[] = [],
): string {
  const head = result.positions[0];
  const version = head ? `${head.chainTemplateId}@${head.chainVersion}` : "（尚未生成）";
  const lines: string[] = [
    `调研链条（模板实例 ${version}，共 ${result.positions.length} 个位置）`,
    "  说明：这是「当前方法论建议从哪里获取信息」，不是该行业客观存在的链条节点。",
  ];
  if (result.positions.length === 0) {
    lines.push("  暂无位置：该行业尚无信息需求（先执行 tiancha industry ingest 建立行业）。");
  }
  const coverageByRef = new Map(coverage.map((c) => [c.positionRef, c]));
  result.positions.forEach((p, i) => {
    lines.push(`  ${i + 1}. ${p.label}（${p.kind}）· 重要度 ${p.importance.toFixed(2)}`);
    lines.push(`     ${p.positionRef}`);
    lines.push(`     为什么重要：${p.whyImportant}`);
    lines.push(`     建议研究哪类对象：${p.suggestedTargetKinds.join("、") || "（无）"}`);
    lines.push(`     适合提供的证据：${p.suitableEvidenceKinds.join("、") || "（无）"}`);
    lines.push(
      `     服务问题数：${p.satisfiesRequirementRefs.length} · 固有局限：${p.limitations.join("；") || "（无）"}`,
    );
    // ★ C2 Step 2-A: capability (all) vs CURRENT coverage (active) — read-only derivation.
    const cov = coverageByRef.get(p.positionRef);
    if (cov) {
      lines.push(
        `     服务缺口：active ${cov.activeRequirementRefs.length} / all ${cov.allRequirementRefs.length}`,
      );
    }
  });
  for (const s of result.skipped) lines.push(`  （跳过空节点 ${s.positionKey}：${s.reason}）`);
  lines.push(
    "  下一步：具体对象由人确认后录入 —— tiancha research target add <行业> --kind <k> --name <主体> --position <posRef> --purpose <…> --reason <…>",
  );
  return lines.join("\n");
}

/** B5: the derived needs (read-only) — `whyStudyNotJustFetch` is a closed-enum phrase. */
export interface NeedListView {
  industry: string;
  /** Whether the chain was projected at all (without it, "which position serves it" is unknown). */
  chainProjected: boolean;
  needs: ResearchNeed[];
}

export function formatNeedHuman(view: NeedListView, names: Record<string, string> = {}): string {
  const lines: string[] = [`研究需求（按优先级降序，共 ${view.needs.length}）`];
  if (!view.chainProjected) {
    lines.push("  提示：该行业尚未生成调研链条，因此「可服务的位置」为空；先执行 tiancha research chain <行业>。");
  }
  if (view.needs.length === 0) lines.push("  暂无：当前没有开放的研究缺口。");
  view.needs.forEach((n, i) => {
    // Never render "no persisted priority" as a 0 score — that would read as "least important".
    const priority = n.priorityPolicyVersionId
      ? `优先级 ${n.priorityScore}/100（规则 ${n.priorityPolicyVersionId}）`
      : "暂无已落库优先级";
    lines.push(`  ${i + 1}. [${priority}] ${dimensionLabel(n.dimension, names)} · ${n.gapId}`);
    lines.push(`     问题：${n.question}`);
    lines.push(`     为什么需要调研：${n.whyStudyNotJustFetch}`);
    lines.push(`     可服务该需求的位置：${n.suggestedPositionRefs.join("、") || "（无）"}`);
  });
  return lines.join("\n");
}

/** B5: one target plus its read-only fit counts (B3 aggregation, not a new judgement). */
export interface TargetListView {
  target: ResearchTarget;
  fit: FitSummary;
}

export function formatTargetWithFitHuman(views: TargetListView[]): string {
  if (views.length === 0) return "研究对象：暂无（请用 tiancha research target add 录入）。";
  const lines: string[] = [`研究对象（${views.length}）`];
  for (const v of views) {
    const t = v.target;
    const flag = t.isFallback ? ` [备选→${t.fallbackForTargetRef}]` : "";
    lines.push(`  - ${t.subjectKey}（${t.targetKind}）${flag} · ${t.status} · 价值 ${t.expectedInformationValue.toFixed(2)}`);
    lines.push(
      `     位置 ${t.positionRef} · 适配：强 ${v.fit.strong} / 部分 ${v.fit.partial} / 弱 ${v.fit.weak} / 无 ${v.fit.none}（共 ${v.fit.questionCount} 问）· 需备选对象 ${v.fit.requiresFallback}`,
    );
  }
  return lines.join("\n");
}

/** B5/C2: one assembled preparation — CURRENT projection only (+ history count). */
export function formatDiligenceHuman(p: DiligencePreparation): string {
  const current = currentQuestions(p.questions);
  const retired = retiredQuestions(p.questions);
  const history = retired.length > 0 ? ` · 历史问题 ${retired.length}（已收敛）` : "";
  const lines: string[] = [
    `调研准备（${p.status}）：${p.targetBrief}`,
    `  编号 ${p.preparationRef} · 目标 ${p.targetRef} · 方法论 ${p.methodologyVersionRef}`,
    `  目的：${p.purpose}`,
    `  为什么是这个对象：${p.whyThisTarget}`,
    `  当前理解：认知 ${p.currentUnderstanding.beliefs.length} 条 · 冲突 ${p.currentUnderstanding.conflictCount} 处 · 已收敛缺口 ${p.currentUnderstanding.convergedGapCount} 处（知识版本 v${p.currentUnderstanding.knowledgeVersion}）`,
    `  需要的数据：${p.requestedData.join("、") || "（无）"}`,
    `  需要的材料：${p.requestedMaterials.join("、") || "（暂无来源，不臆造）"}`,
    `  已知局限：${p.limitations.join("；") || "（无）"}`,
    `  提醒：${p.cautions.join("；") || "（无）"}`,
    // ★ C2 / I-C2-12: only `current` questions are shown; retired ones are counted as history.
    `  问题清单（当前 ${current.length}${history}）：`,
  ];
  for (const q of current) {
    const mark = q.isFallbackSource ? " ⚠需备选对象" : "";
    // A question with no persisted priority shows none — "0" would read as "least important".
    const priority = q.priority > 0 ? `（优先级 ${q.priority}）` : "";
    lines.push(`    · [${q.source}] ${q.text}${mark}${priority}`);
  }
  if (current.length === 0) lines.push("    （当前无待问问题：相关缺口已收敛）");
  return lines.join("\n");
}

export function formatDiligenceListHuman(preparations: DiligencePreparation[], industry: string): string {
  if (preparations.length === 0) {
    return `调研准备（${industry}）：暂无。请先确认研究对象，再执行 tiancha research diligence <行业> --target <targetRef>。`;
  }
  const lines: string[] = [`调研准备（${industry}，共 ${preparations.length}）`];
  for (const p of preparations) {
    // ★ C2 / I-C2-12: the count is derived from `state === "current"` only.
    const current = currentQuestions(p.questions).length;
    const retired = retiredQuestions(p.questions).length;
    const history = retired > 0 ? `（历史问题 ${retired}）` : "";
    lines.push(`  - ${p.preparationRef} · ${p.targetBrief} · ${p.status} · 当前问题 ${current}${history}`);
  }
  return lines.join("\n");
}
