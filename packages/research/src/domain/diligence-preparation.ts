/**
 * DiligencePreparation (Phase B v1 · Step B4) — "研究什么".
 *
 * For ONE human-confirmed target it answers: what is the purpose, what do we already
 * understand, why this target, what should we ask, and what cautions apply.
 *
 * B4 red lines:
 *  - **every question traces back** to a Requirement or a Fit (`fromRequirementRef` /
 *    `fromFitRef`); there are NO free-floating questions (I-B5);
 *  - the three `source`s are explicit and distinguishable: `common` / `target_specific` /
 *    `fit_derived` (so "行业通用 + 对象定制 + fit 派生" can be told apart structurally);
 *  - **no LLM and no report generation**: this assembles from persisted state only;
 *  - it READS Priority / Knowledge / Fit; it writes **only its own preparation row**.
 *
 * `canAnswer` from B3 is NOT used as a decision input here: we use `answerability`,
 * `confidence`, `limitations` and `requiresFallback` (B3 reviewer note).
 */

export type QuestionSource = "common" | "target_specific" | "fit_derived";
export type PreparationStatus = "draft" | "ready" | "used";

export interface DiligenceQuestion {
  /** Deterministic within a preparation: `dq-<preparationRef>-<n>`. */
  questionRef: string;
  text: string;
  source: QuestionSource;
  /** ★ Traceability: at least one of these is non-null (I-B5). */
  fromRequirementRef: string | null;
  fromFitRef: string | null;
  /** True when the question exists BECAUSE a fallback is needed (I-B4 ⇒ caveat non-null). */
  isFallbackSource: boolean;
  caveat: string | null;
  expectedAnswerType: string;
  priority: number;
}

/** A read-only projection of what we already understand about the industry. */
export interface CurrentUnderstanding {
  beliefs: Array<{ dimension: string; state: string; claimRef: string }>;
  conflictCount: number;
  knowledgeVersion: number;
}

export interface DiligencePreparation {
  /** Deterministic: `dp-<targetRef>`. */
  preparationRef: string;
  targetRef: string;
  industryRef: string;
  purpose: string;
  targetBrief: string;
  currentUnderstanding: CurrentUnderstanding;
  whyThisTarget: string;
  requestedData: string[];
  requestedMaterials: string[];
  /** ★ fit-derived caveats (never a silent downgrade). */
  cautions: string[];
  risks: string[];
  limitations: string[];
  methodologyVersionRef: string;
  questions: DiligenceQuestion[];
  status: PreparationStatus;
  createdAt: string;
}
