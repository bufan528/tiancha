/**
 * S7 Markdown materialisation — **PURE** rendering of a ReportSnapshot/IndustryDossier.
 *
 * The Markdown is the materialised VIEW of the very same snapshot stored in
 * `report_snapshot`; it is NOT a second source of truth and NOT a new id space:
 * `reportFileName()` takes the dossier id FROM the snapshot itself.
 *
 * Same "证据不足" discipline as the CLI formatters (no bullish/bearish wording).
 */

import type { IndustryDossier } from "@tiancha/research";
import { EVIDENCE_INSUFFICIENT, decisionLabel, gapTypeLabel } from "./research-format.js";

/** Filesystem-safe fragment for the industry name (deterministic, no timestamps). */
export function sanitizeForFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "industry";
}

/**
 * `<sanitized industry>__<dossierId>.md` — the dossier id comes from the snapshot,
 * so DB snapshot and Markdown materialisation stay 1:1 traceable.
 */
export function reportFileName(industryName: string, dossierId: string): string {
  return `${sanitizeForFileName(industryName)}__${dossierId}.md`;
}

function bullets(lines: string[]): string {
  return lines.length > 0 ? lines.map((l) => `- ${l}`).join("\n") : "_（暂无）_";
}

export function renderDossierMarkdown(d: IndustryDossier): string {
  const s = d.sections;
  const out: string[] = [];

  out.push(`# 行业研究报告 · ${d.industryId}`);
  out.push("");
  out.push(`> 只读投影（快照 \`${d.dossierId}\`，知识版本 v${d.knowledgeVersion}，方法论 ${d.methodologyVersionId}）。`);
  out.push(`> 生成时间：${d.generatedAt}。本报告不是事实来源，重新生成会产生新快照。`);
  out.push("");

  out.push("## 当前认知");
  out.push(
    bullets(
      s.currentKnowledge.map(
        (k) => `**${k.dimension}**（${k.state}）→ 依据 ${k.claimRef}${k.sourceRef ? `，来源 ${k.sourceRef}` : ""}`,
      ),
    ),
  );
  out.push("");

  out.push("## 关键事实");
  out.push(bullets(s.keyFacts.map((f) => `**${f.dimension}** → ${f.claimRef}${f.relation !== "consistent" ? `（${f.relation}）` : ""}`)));
  out.push("");

  out.push("## 主要判断（已确认）");
  out.push(bullets(s.mainJudgments.map((k) => `**${k.dimension}** → ${k.claimRef}`)));
  out.push("");

  out.push("## 主要冲突（双方并列保留）");
  out.push(bullets(s.conflicts.map((c) => `**${c.dimension}**：${c.claimARef} ⇄ ${c.claimBRef}（${c.status}）`)));
  out.push("");

  out.push("## 缺口");
  out.push(
    bullets(
      s.gaps.map(
        (g) => `**${g.dimension}**：${gapTypeLabel(g.gapType)}（重要度 ${g.importance}，不确定度 ${g.uncertainty}，${g.status}）`,
      ),
    ),
  );
  out.push("");

  out.push("## 最近变化");
  out.push(bullets(s.recentChanges.map((c) => `${c.relation} · ${c.beliefId} ← ${c.otherBeliefId}（${c.at}）`)));
  out.push("");

  out.push("## 最近证据");
  out.push(bullets(s.recentEvidence.map((r) => r)));
  out.push("");

  out.push("## 当前评价");
  if (s.evaluation) {
    out.push(
      `- 决策：**${decisionLabel(s.evaluation.decisionStatus)}** —— ${s.evaluation.decisionReason}`,
    );
    out.push(
      `- 覆盖度：已评估 ${s.evaluation.evaluated}，${EVIDENCE_INSUFFICIENT} ${s.evaluation.insufficient}，存在冲突 ${s.evaluation.conflicting}（共 ${s.evaluation.total}）`,
    );
  } else {
    out.push("_（暂无已落库的投资评估）_");
  }
  out.push("");

  out.push("## 优先级");
  out.push(bullets(s.priority.map((p) => `${p.gapId}：${p.score}/100 —— ${p.rationale}（规则 ${p.policyVersionId}）`)));
  out.push("");

  out.push("## 下一步");
  out.push(bullets(s.nextActions.map((a) => `${a.kind}（优先级 ${a.priority}）：${a.rationale}`)));
  out.push("");

  return out.join("\n");
}
