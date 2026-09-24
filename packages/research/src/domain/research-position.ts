/**
 * ResearchPosition (Phase B v1) — a **template INSTANCE**, not chain truth.
 *
 * It means: "under the CURRENT methodology (template vN), this is a position we should
 * get information from". It is NOT the claim "this industry objectively has this supply
 * chain node" (contract §2.3 / I-B7).
 */

export interface ResearchPosition {
  /** Deterministic: `pos-<industryId>-<templateId>-<chainVersion>-<positionKey>`.
   *  The template VERSION is part of the identity (I-B7), so a template upgrade yields
   *  new refs and never rewrites the historical positions. */
  positionRef: string;
  industryId: string;
  /** Provenance: which template produced it (I-B7). */
  chainTemplateId: string;
  /** Provenance: which template version (a version change yields NEW refs). */
  chainVersion: string;
  kind: string;
  label: string;
  /** REQUIRED — I-B1 forbids empty nodes. */
  whyImportant: string;
  /** Questions this position can answer (mapped from dimensionKeys × Requirements). */
  answersQuestionRefs: string[];
  /** Requirements this position satisfies (same mapping). */
  satisfiesRequirementRefs: string[];
  /** 「建议研究哪类对象」— TYPE level only. */
  suggestedTargetKinds: string[];
  suitableEvidenceKinds: string[];
  limitations: string[];
  /** Derived from the weights of the dimensions it serves (never hand-waved). */
  importance: number;
  createdAt: string;
}

/** Result of a projection run (skipped positions are reported, never written). */
export interface PositionProjectionResult {
  positions: ResearchPosition[];
  /** Template positions that would have been EMPTY NODES (no serving requirement). */
  skipped: Array<{ positionKey: string; reason: string }>;
}
