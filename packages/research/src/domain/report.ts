/**
 * Report / Dossier (S6) — **read-only projections** (07 §3.10 J1/J2, 08 §4.6).
 *
 * I14: a report is a PROJECTION. Generating one NEVER writes a Claim / Belief / Pool /
 * Evaluation / Gap / State row — it only READS the current research state and freezes a
 * structured snapshot. Re-running produces a NEW snapshot; nothing is updated in place.
 *
 * S6 red lines:
 *  - it must not become a new source of truth: every line keeps its refs (claimRef /
 *    beliefId / gapId ...) — REFERENCE, never a copy of the content;
 *  - no Evidence / Target / Research Strategy / LLM extraction is smuggled in;
 *  - `ResearchPriority` is READ and presented as part of the current state; it is never
 *    recomputed or modified here.
 */

export type ReportKind = "report" | "dossier";

/** 当前认知 / 主要判断 — one belief, referenced by id (content lives in Knowledge). */
export interface KnowledgeLine {
  beliefId: string;
  dimension: string;
  state: string;
  claimRef: string;
  sourceRef?: string;
}

/** 主要冲突 — an open KnowledgeConflict; both sides retained (Invariant 3). */
export interface ConflictLine {
  conflictId: string;
  dimension: string;
  claimARef: string;
  claimBRef: string;
  status: string;
}

/** 缺口 — an open ResearchGap (S4.5: carries gapType + the S5 attributes). */
export interface GapLine {
  gapId: string;
  dimension: string;
  gapType: string;
  status: string;
  importance: number;
  uncertainty: number;
}

/** 关键事实 — a PoolItem; it references a Claim, it is NOT the fact itself (I15). */
export interface FactLine {
  slotId: string;
  dimension: string;
  claimRef: string;
  relation: string;
}

/** 最近变化 — a belief's historical relation (SUPPORT/REVISE/CONFLICT/SUPERSEDE). */
export interface ChangeLine {
  beliefId: string;
  relation: string;
  otherBeliefId: string;
  at: string;
}

/** 优先级 — a READ-ONLY view of the S5 ResearchPriority (facts only, no recompute). */
export interface PriorityLine {
  gapId: string;
  score: number;
  rationale: string;
  policyVersionId: string;
}

/** 下一步 — an open NextAction (S5: priority decides order, gap state decides kind). */
export interface NextActionLine {
  actionId: string;
  kind: string;
  priority: number;
  rationale: string;
  gapId?: string;
}

/** 当前评价 — a summary of the latest InvestmentEvaluation, if any. */
export interface EvaluationSummary {
  evaluationId: string;
  methodologyVersionId: string;
  evaluated: number;
  insufficient: number;
  conflicting: number;
  total: number;
  decisionStatus: string;
  decisionReason: string;
}

/**
 * The structured sections of a projection (08 §4.6):
 * 当前认知 / 关键事实 / 主要判断 / 主要冲突 / 缺口 / 最近变化 / 最近证据 / 当前评价 /
 * 优先级 / 下一步.
 */
export interface ReportSections {
  currentKnowledge: KnowledgeLine[];
  keyFacts: FactLine[];
  mainJudgments: KnowledgeLine[];
  conflicts: ConflictLine[];
  gaps: GapLine[];
  recentChanges: ChangeLine[];
  /** 最近证据 — claim refs only (the evidence itself is not copied). */
  recentEvidence: string[];
  evaluation: EvaluationSummary | null;
  priority: PriorityLine[];
  nextActions: NextActionLine[];
}

interface ProjectionBase {
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  methodologyVersionId: string;
  generatedAt: string;
  sections: ReportSections;
}

/** J1 ReportSnapshot — a projection for any subject (not an aggregate root). */
export interface ReportSnapshot extends ProjectionBase {
  reportId: string;
  reportKind: "report";
}

/** J2 IndustryDossier — the same projection, specialised for an industry. */
export interface IndustryDossier extends ProjectionBase {
  dossierId: string;
  reportKind: "dossier";
  industryId: string;
  /** The IndustryKnowledge projection version this dossier was taken from. */
  knowledgeVersion: number;
}

export type AnyProjection = ReportSnapshot | IndustryDossier;

/** Common identity helpers (used by the repository + service). */
export function projectionId(p: AnyProjection): string {
  return p.reportKind === "report" ? p.reportId : p.dossierId;
}
