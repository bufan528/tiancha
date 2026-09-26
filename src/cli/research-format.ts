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
  ResearchPlanView,
  ResearchPlanProposal,
  ResearchPriority,
  ResearchTarget,
  Company,
  TargetProposal,
  TargetProposalDraft,
} from "@tiancha/research";
import type { DecisionOutcome } from "@tiancha/research";
// ★ C2: the current/retired question predicates live in the domain (single source of truth).
import { currentQuestions, retiredQuestions } from "@tiancha/research";
// ★ C2 Step 2-A: read-only position coverage (capability vs current research state).
import type { PositionCoverage } from "@tiancha/research";

/** The one and only rendering of the `insufficient_evidence` state. */
export const EVIDENCE_INSUFFICIENT = "证据不足";

// ---- C5-B: decision rendering -----------------------------------------------

/** `research confirm|reject` — renders the DETERMINISTIC outcome (never a raw SQLite error). */
export function formatDecisionHuman(outcome: DecisionOutcome): string {
  switch (outcome.status) {
    case "confirmed":
      return [
        `已确认调研：${outcome.proposalRef}`,
        `  正式研究对象：${outcome.targetRef}`,
        `  决策时间：${outcome.decidedAt}`,
        "（由人工决策触发，已物化为正式研究对象）",
      ].join("\n");
    case "rejected":
      return [
        `已拒绝调研：${outcome.proposalRef}`,
        `  决策时间：${outcome.decidedAt}`,
        "（仅记录人工决策，未创建研究对象，也未改动任何研究事实）",
      ].join("\n");
    case "already_decided":
      return `该研究建议已处于终态：${outcome.proposalRef}（当前状态 ${outcome.proposalStatus}）——终态不可反转`;
    case "target_already_exists":
      return `该企业已存在正式研究对象：${outcome.targetRef}——未重复创建；建议 ${outcome.proposalRef} 保持未决`;
    case "not_found":
      return `未找到研究建议：${outcome.proposalRef}`;
  }
}

// ---- C5-A: Company Universe + TargetProposal --------------------------------

/** `research company add` / `research company get` — one candidate-enterprise fact. */
export function formatCompanyHuman(c: Company, industryName?: string): string {
  const lines = [
    `候选企业：${c.canonicalName}`,
    `  编号：${c.companyId}`,
    `  行业：${industryName ?? c.primaryIndustryId ?? "（未归属行业）"}`,
    `  类型：${c.targetKinds.length > 0 ? c.targetKinds.join(" / ") : "（无）"}`,
  ];
  if (c.aliases.length > 0) lines.push(`  别名：${c.aliases.join(" / ")}`);
  return lines.join("\n");
}

/** `research company list` — the Company Universe of one industry (§10.2). */
export function formatCompanyListHuman(rows: Company[], industryName: string): string {
  if (rows.length === 0) {
    return `候选企业（${industryName}）：暂无。请先执行 tiancha research company add …。`;
  }
  return [
    `候选企业（${industryName}，共 ${rows.length}）`,
    ...rows.map(
      (c) => `  - ${c.canonicalName} · ${c.targetKinds.join("/") || "（无类型）"} · ${c.companyId}`,
    ),
    "（候选企业池只用于推荐：它本身不是研究对象，也不代表任何研究结论）",
  ].join("\n");
}

/** `research proposal generate` — what the engine drafted and what was actually persisted. */
export function formatProposalGenerateHuman(
  industryName: string,
  drafts: TargetProposalDraft[],
  result: { created: number; skippedSameRef: number; skippedActiveExists: number },
  stored: TargetProposal[],
): string {
  const lines = [
    `研究建议（${industryName}，只读投影 + 本次持久化）`,
    `  本次计算：${drafts.length} 条候选建议`,
    `  新增：${result.created} · 已存在同一建议：${result.skippedSameRef} · 该企业已有活跃建议：${result.skippedActiveExists}`,
  ];
  if (stored.length === 0) {
    lines.push("  当前暂无研究建议：没有匹配的候选企业，或研究状态尚未形成缺口。");
  } else {
    lines.push(`  当前研究建议（共 ${stored.length}）`);
    for (const p of stored) {
      lines.push(`  - [${p.status}] ${p.companyRef} · ${p.selectionReason}`);
      lines.push(
        `      依据：Position 重要度 ${p.positionImportance} · 覆盖 ${p.coveredRequirementRefs.length} 项 · 未解决 ${p.unresolvedRequirementRefs.length} 项 · 评分 ${p.score}（${p.scoreVersion}）`,
      );
    }
  }
  lines.push(
    "（研究建议不是研究事实：它是系统基于当前持久化研究状态提出的待人工决策建议，尚未成为正式研究对象）",
  );
  return lines.join("\n");
}

/** `research proposal list` — persisted proposals only. */
export function formatProposalListHuman(rows: TargetProposal[], industryName: string): string {
  if (rows.length === 0) {
    return `研究建议（${industryName}）：暂无。请先执行 tiancha research proposal generate ${industryName}。`;
  }
  return [
    `研究建议（${industryName}，共 ${rows.length}）`,
    ...rows.map((p) => `  - [${p.status}] ${p.proposalRef} · 评分 ${p.score}`),
  ].join("\n");
}

/** `research proposal get` — the full structured provenance of one proposal (§11.1). */
export function formatProposalHuman(p: TargetProposal): string {
  return [
    `研究建议：${p.proposalRef}`,
    `  状态：${p.status}`,
    `  行业：${p.industryRef} · 缺口：${p.gapRef} · 位置：${p.positionRef} · 企业：${p.companyRef}`,
    `  匹配类型：${p.matchedTargetKinds.join(" / ")}`,
    `  Position 重要度：${p.positionImportance}`,
    `  覆盖的信息需求（${p.coveredRequirementRefs.length}）：${p.coveredRequirementRefs.join(", ") || "（无）"}`,
    `  其中未解决（${p.unresolvedRequirementRefs.length}）：${p.unresolvedRequirementRefs.join(", ") || "（无）"}`,
    `  评分：${p.score}（${p.scoreVersion}）· 词表版本：${p.kindVocabularyVersion}`,
    `  推荐版本：${p.recommendationRevision}`,
    `  推荐依据：${p.selectionReason}`,
  ].join("\n");
}

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
  /**
   * ★ C2 Step 2-B: the requirements this target is used to fill — `{ ref, label }`, where the
   * label is the requirement's dimension name (deterministically derived from the existing row;
   * it falls back to the ref when the requirement row is missing). Never rewritten by a model.
   */
  requirementLabels?: Array<{ ref: string; label: string }>;
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
    // ★ C2 Step 2-B: link visibility — dimension summary + ref (a read-only projection).
    const labels = v.requirementLabels ?? [];
    if (labels.length > 0) {
      lines.push("     用于补充 Requirement：");
      for (const l of labels) {
        lines.push(`       • ${l.label && l.label !== l.ref ? `${l.label}（${l.ref}）` : l.ref}`);
      }
    }
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

/**
 * ★ C2 Step 2-C: the research plan — the deterministic HUMAN formatter over the ONE
 * `ResearchPlanView` the CLI and the Agent share. It adds no data and re-orders nothing:
 * every list below arrives already ordered by §4.3.2.
 */
/**
 * ★ C5-C §20.6: one proposal line — status, the read-only decision and the target relation.
 * `decision === null` is rendered as 「尚无决策」 (never fabricated); a `confirmed` proposal whose
 * target cannot be found says so out loud instead of implying materialisation.
 */
function formatProposalLine(p: ResearchPlanProposal): string {
  const state =
    p.status === "confirmed"
      ? p.targetRef
        ? `已确认 → 研究对象 ${p.targetRef}`
        : "已确认（未找到对应研究对象）"
      : p.status === "rejected"
        ? "已拒绝"
        : "待人工决策";
  const decision = p.decision
    ? ` · 决策${p.decision.kind === "confirmed" ? "确认" : "拒绝"} by ${p.decision.operator}（${p.decision.decidedAt}）${
        p.decision.comment ? `：${p.decision.comment}` : ""
      }`
    : " · 尚无决策";
  // ★ C5-D §21.5: the summary is consumed STRAIGHT from the plan projection — the formatter never
  //   re-reads the Preparation SoT. `null` omits the suffix entirely (no "调研准备：无" noise).
  const preparation = p.preparation
    ? ` · 调研准备 ${p.preparation.status}（${p.preparation.questionCount} 问）`
    : "";
  return `            · ${p.companyName}（${p.matchedTargetKinds.join("/")}）· ${state} · 评分 ${p.score} · ${p.proposalRef}${decision}${preparation}`;
}

export function formatPlanHuman(view: ResearchPlanView): string {
  const lines: string[] = [`研究计划（${view.industryName}）`];

  // ① current state — absent is a NORMAL state and is said out loud (never a fabricated 0)
  if (view.state) {
    const s = view.state;
    lines.push(
      `  当前认知（v${s.version}）：已知 ${s.known} · 确认 ${s.confirmed} · 不确定 ${s.uncertain} · 冲突 ${s.conflicting} · 未知 ${s.unknown} · 关键问题 ${s.keyQuestionCount}`,
    );
  } else {
    lines.push("  当前认知：暂无已落库的研究状态（这是正常状态，不是错误）");
  }

  // ② active gaps → suggested positions → confirmed targets
  if (view.gaps.length === 0) {
    lines.push("  开放缺口：无 —— 相关缺口已收敛（当前无需继续研究）");
  } else {
    lines.push(`  开放缺口（${view.gaps.length}，按优先级）：`);
    view.gaps.forEach((gap, index) => {
      const priority = gap.priorityPolicyVersionId
        ? `优先级 ${gap.priorityScore}/100 · 规则 ${gap.priorityPolicyVersionId}`
        : "暂无已落库优先级";
      lines.push(`   ${index + 1}. [${priority}] ${gap.dimensionLabel}（${gap.gapType} · ${gap.gapId}）`);
      lines.push(`      为什么需要调研：${gap.whyStudyNotJustFetch}`);
      if (gap.positions.length === 0) {
        lines.push("      建议研究位置：暂无（该缺口尚未匹配到可研究的位置）");
        return;
      }
      lines.push("      建议研究位置：");
      for (const position of gap.positions) {
        lines.push(
          `        · ${position.label}（${position.kind}）· 覆盖 active ${position.activeRequirementRefs.length} / all ${position.allRequirementRefs.length}`,
        );
        // ★ C5-C: research proposals (READ-ONLY) — shown before the confirmed targets, and shown
        //   even when there are none confirmable yet. Never implies materialisation (§20.6).
        if (position.proposals.length > 0) {
          lines.push(
            `          研究建议 ${position.proposals.length}（只读：未确认的建议尚未成为研究对象）：`,
          );
          for (const proposal of position.proposals) lines.push(formatProposalLine(proposal));
        }
        if (position.targets.length === 0) {
          lines.push(
            "          已确认对象 0 —— 下一步：请研究者选择并录入对象（tiancha research target add …）",
          );
          continue;
        }
        lines.push(`          已确认对象 ${position.targets.length}：`);
        for (const target of position.targets) {
          const flag = target.isFallback
            ? ` [备选→${target.fallbackForTargetRef}：需降低置信度、交叉验证]`
            : "";
          const preparation = target.preparation
            ? ` · 调研准备 ${target.preparation.preparationRef}（当前 ${target.preparation.currentQuestionCount}${
                target.preparation.retiredQuestionCount > 0
                  ? ` · 历史 ${target.preparation.retiredQuestionCount}`
                  : ""
              }）`
            : " · 暂无调研准备（tiancha research diligence … --target " + target.targetRef + "）";
          lines.push(
            `            · ${target.subjectKey}（${target.targetKind}）${flag} · 适配：强 ${target.fit.strong} / 部分 ${target.fit.partial} / 弱 ${target.fit.weak} / 无 ${target.fit.none}${preparation}`,
          );
          if (target.requirementLabels.length > 0) {
            const labels = target.requirementLabels
              .map((l) => (l.label && l.label !== l.ref ? `${l.label}（${l.ref}）` : l.ref))
              .join("、");
            lines.push(`              用于补充 Requirement：${labels}`);
          }
        }
      }
    });
  }

  // ③ industry-level targets — `unlinked ∪ non_currently_mapped`, never hidden
  lines.push("  行业级对象（不属于任何开放缺口）：");
  if (view.industryTargets.length === 0) {
    lines.push("    （无）");
  } else {
    for (const target of view.industryTargets) {
      const why =
        target.associationStatus === "unlinked"
          ? "尚未关联任何 Requirement"
          : "其关联 Requirement 的缺口已收敛";
      lines.push(`    · ${target.subjectKey}（${target.targetKind}）· ${target.associationStatus}（${why}）`);
    }
  }

  // ③′ ★ C5-C: proposals that could NOT attach to any emitted gap→position — NEVER hidden.
  lines.push("  悬空研究建议（不属于任何当前开放缺口/位置）：");
  if (view.orphanProposals.length === 0) {
    lines.push("    （无）");
  } else {
    for (const proposal of view.orphanProposals) lines.push(formatProposalLine(proposal));
  }

  // ④ next actions (read as-is: a stale plan is shown as stale, never repaired here)
  lines.push(`  下一步动作（${view.nextActions.length}）：`);
  if (view.nextActions.length === 0) {
    lines.push("    （无）");
  } else {
    for (const action of view.nextActions) {
      lines.push(`    · [${action.priority}] ${action.kind} · ${action.rationale}`);
    }
  }
  return lines.join("\n");
}

// ---- C4-B: report-snapshot history ---------------------------------------------------------

/** One persisted report/dossier snapshot, as METADATA only (sections are never re-expanded). */
export interface ReportHistoryRow {
  /** `reportId` (kind="report") or `dossierId` (kind="dossier"). */
  projectionRef: string;
  reportKind: string;
  generatedAt: string;
  methodologyVersionId: string;
  /** Only dossiers carry a knowledge version; `null` for plain reports (persisted field, not derived). */
  knowledgeVersion: number | null;
}

/** ★ C4-B: the read-only human formatter over PERSISTED snapshot metadata. */
export function formatReportHistoryHuman(rows: ReportHistoryRow[], industry: string): string {
  if (rows.length === 0) {
    return `研究报告历史（${industry}）：暂无。请先执行 tiancha research report ${industry}。`;
  }
  const lines: string[] = [`研究报告历史（${industry}，共 ${rows.length}，最新在前）`];
  for (const row of rows) {
    const knowledge = row.knowledgeVersion === null ? "" : ` · 知识 v${row.knowledgeVersion}`;
    lines.push(
      `  - ${row.generatedAt} · ${row.reportKind} · ${row.projectionRef} · 方法论 ${row.methodologyVersionId}${knowledge}`,
    );
  }
  lines.push("（只读历史：以上仅为已持久化的快照元数据，不会重新生成报告）");
  return lines.join("\n");
}
