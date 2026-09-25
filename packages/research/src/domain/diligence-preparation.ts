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
 * Phase C2 (Gap-driven Research Planning) changes IDENTITY + LIFECYCLE only:
 *  - `questionRef` is now **deterministic in stable refs** (never in display text);
 *  - a question is `current` (in the current projection) or `retired` (history only);
 *  - `questions[]` is **append + retire**, never delete (§4.4 / I-C2-6).
 *
 * `canAnswer` from B3 is NOT used as a decision input here: we use `answerability`,
 * `confidence`, `limitations` and `requiresFallback` (B3 reviewer note).
 */

export type QuestionSource = "common" | "target_specific" | "fit_derived";
export type PreparationStatus = "draft" | "ready" | "used";

/** ★ C2: `current` = part of the current projection; `retired` = history only. */
export type DiligenceQuestionState = "current" | "retired";

export interface DiligenceQuestion {
  /**
   * ★ C2 deterministic identity — built from STABLE REFS only:
   *
   *     questionRef = dq-<preparationRef>-<source>-<canonicalRef>
   *     canonicalRef = fromRequirementRef ?? fromFitRef      (requirement wins)
   *
   * Display text / description / readable slug NEVER participate: the same stable refs
   * always map to the same question, even if the wording changes (T-C2-24 / T-C2-25).
   */
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
  /** ★ C2 lifecycle state (see `isCurrentQuestion`). */
  state: DiligenceQuestionState;
  /** ★ C2: when this question FIRST entered a preparation — never changes afterwards. */
  firstAskedAt: string;
  /** ★ C2: the last time it left the current projection (kept as history). */
  retiredAt?: string;
}

/**
 * ★ C2 canonical ref — the ONLY identity source, used **verbatim** (lossless).
 *
 * Deliberately NO `normalize` / `slug` / `hash` / `trim` / `lowercase` / `generateId`:
 * any such transformation would let two different refs collide on one identity.
 * `fromRequirementRef` wins when both exist; `fromFitRef` is the fallback only.
 */
export function canonicalQuestionRef(
  question: Pick<DiligenceQuestion, "fromRequirementRef" | "fromFitRef">,
): string | null {
  return question.fromRequirementRef ?? question.fromFitRef ?? null;
}

/** ★ C2 identity: `dq-<preparationRef>-<source>-<canonicalRef>` (raw refs, no transformation). */
export function questionRefFor(
  preparationRef: string,
  source: QuestionSource,
  canonicalRef: string,
): string {
  return `dq-${preparationRef}-${source}-${canonicalRef}`;
}

/** ★ C2 / I-C2-12: the ONLY current predicate for questions. */
export function isCurrentQuestion(question: DiligenceQuestion): boolean {
  return question.state === "current";
}

/** The current projection's questions — every "current" output/count must derive from this. */
export function currentQuestions(questions: DiligenceQuestion[]): DiligenceQuestion[] {
  return questions.filter(isCurrentQuestion);
}

/** History only: questions that used to be part of a preparation. Never deleted. */
export function retiredQuestions(questions: DiligenceQuestion[]): DiligenceQuestion[] {
  return questions.filter((q) => q.state === "retired");
}

/**
 * ★ C2 / I-C2-12: the CURRENT view of a preparation.
 *
 * `questions` holds ONLY the current ones and the retired ones are reduced to a count, so that
 * no CLI / Agent "current" output (outline, list, JSON export, statistics) can accidentally
 * count history. Callers that need the full history read the persisted row directly.
 */
export function currentPreparationView(preparation: DiligencePreparation): DiligencePreparation & {
  currentQuestionCount: number;
  retiredQuestionCount: number;
} {
  const current = currentQuestions(preparation.questions);
  return {
    ...preparation,
    questions: current,
    currentQuestionCount: current.length,
    retiredQuestionCount: preparation.questions.length - current.length,
  };
}

/** A read-only projection of what we already understand about the industry. */
export interface CurrentUnderstanding {
  beliefs: Array<{ dimension: string; state: string; claimRef: string }>;
  conflictCount: number;
  knowledgeVersion: number;
  /** ★ C2: gaps of this industry that are currently `resolved` (read-only projection). */
  convergedGapCount: number;
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
  /** ★ C2: current + retired — append/retire only, never deleted (I-C2-6). */
  questions: DiligenceQuestion[];
  status: PreparationStatus;
  createdAt: string;
}
