/**
 * C6 (§C6.4 / §C6.5 / §C6.7) — the CLAIM CANDIDATE layer.
 *
 * A candidate is NOT knowledge. It is a *proposal* that a human must confirm before anything
 * reaches the existing Claim → Knowledge path. Three properties are encoded here:
 *
 *  - I-C6-3: `reviewStatus` ("has a human looked at it") and `contentKind` ("what sort of
 *    statement is it") are ORTHOGONAL. `confirmed` never means "objective fact".
 *    `contentKind` is deliberately only `fact | judgment` — `candidate` / `conflict` /
 *    `open_question` belong to the review status and to domain objects (Conflict / Gap), not here.
 *  - I-C6-1: there is no path from a candidate to `ingestClaims()`. Nothing in this module writes
 *    a Claim, a Belief, a Pool item, a Gap or an Evaluation.
 *  - §C6.7: identities are DETERMINISTIC, including `extractionConfigKey` — so re-running the same
 *    extraction config reuses ids (no duplicates) while a NEW config produces NEW candidates and
 *    keeps `supersedesCandidateRef` as lineage.
 */

import { createHash } from "node:crypto";
import { deterministicId, sha256Hex } from "./material-source.js";

/** §C6.5 — the ONLY content kinds. Everything else is derived from status/domain objects. */
export type CandidateContentKind = "fact" | "judgment";

/** §C6.4 — the human review state. `confirmed` is a REVIEW state, never "objective truth". */
export type CandidateReviewStatus = "draft" | "confirmed" | "revised" | "rejected";

/** §C6.4 / §7 Human Gate — the evolution relation a human must choose when projecting (I-C6-8). */
export type CandidateRelation = "SUPPORT" | "REVISE" | "CONFLICT" | "SUPERSEDE";

/** §C6.17 — candidate-level projection progress (declared here, ACTUALLY USED in slice ④). */
export type CandidateProjectionStatus = "none" | "reserved" | "claim_written" | "projected" | "finalized";

/** §C6.7 — an extraction run's lifecycle. */
export type ExtractionStatus = "running" | "completed" | "failed";

export type CandidateReviewAction = "confirm" | "revise" | "reject" | "edit";

export interface ClaimCandidate {
  candidateId: string;
  materialVersionId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  dimension: string;
  /** Stable hash of the source block this candidate was extracted from (identity anchor). */
  blockHash: string;
  statement: string;
  /** `fact` | `judgment` ONLY (see I-C6-3). */
  contentKind: CandidateContentKind;
  confidence?: number;
  /** ≥ 1 `fragment_evidence` ids. A candidate is never evidence-free. */
  evidenceRefs: string[];
  extractionId: string;
  extractionConfigKey: string;
  reviewStatus: CandidateReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  /** Required before any projection (I-C6-8); `undefined` while `draft`. */
  decisionRelation?: CandidateRelation;
  /** The real Claim this candidate became (filled in slice ④). */
  confirmedClaimRef?: string;
  /** Lineage: the same (blockHash, dimension) under a PREVIOUS extraction config. */
  supersedesCandidateRef?: string;
  /** §C6.17 — progress anchor for slice ④ (stays `none` until then). */
  projectionStatus: CandidateProjectionStatus;
  reservedClaimId?: string;
  projectionError?: string;
  createdAt: string;
}

/**
 * §C6.4 — the append-only review trail. ONE row per action; rows are never updated or deleted
 * (this is what makes "a human edited this" durable against later re-runs — I-C6-5).
 */
export interface CandidateReview {
  reviewId: string;
  candidateId: string;
  action: CandidateReviewAction;
  operator: string;
  comment?: string;
  /** The candidate fields before / after the action (audit of a human edit). */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  at: string;
}

/** §C6.7 — one extraction run: model / prompt / parser / schema versions + its candidates. */
export interface ExtractionRun {
  extractionId: string;
  materialVersionId: string;
  modelVersion: string;
  promptVersion: string;
  parserVersion: string;
  schemaVersion: string;
  extractionConfigKey: string;
  startedAt: string;
  finishedAt?: string;
  status: ExtractionStatus;
  candidateIds: string[];
  error?: string;
}

// ---- deterministic identities (§C6.7) -----------------------------------

/**
 * ★ The extraction CONFIGURATION key. It is part of every candidate id, which is what removes the
 * rev1 contradiction: "a new model/prompt/parser version produces new candidates" AND "the same
 * config re-run is idempotent" can now both hold.
 */
export function extractionConfigKeyFor(parts: {
  modelVersion: string;
  promptVersion: string;
  parserVersion: string;
  schemaVersion: string;
}): string {
  const payload = [parts.modelVersion, parts.promptVersion, parts.parserVersion, parts.schemaVersion].join("|");
  return `xcfg-${sha256Hex(payload).slice(0, 24)}`;
}

export function claimCandidateIdFor(
  materialVersionId: string,
  blockHash: string,
  dimension: string,
  extractionConfigKey: string,
): string {
  return deterministicId("cand", `${materialVersionId}|${blockHash}|${dimension}|${extractionConfigKey}`);
}

export function extractionRunIdFor(materialVersionId: string, extractionConfigKey: string, startedAt: string): string {
  return deterministicId("xrun", `${materialVersionId}|${extractionConfigKey}|${startedAt}`);
}

export function candidateReviewIdFor(candidateId: string, action: CandidateReviewAction, at: string): string {
  return deterministicId("crev", `${candidateId}|${action}|${at}`);
}

/** Stable hash of a candidate's source block — the identity anchor shared by every config. */
export function candidateBlockHash(input: {
  dimension: string;
  statement: string;
  contentKind: CandidateContentKind;
}): string {
  return sha256Hex(`${input.dimension}|${input.contentKind}|${input.statement}`);
}

/** A candidate is projectable only with BOTH a non-draft status and an explicit relation (I-C6-8). */
export function isProjectable(candidate: ClaimCandidate): boolean {
  const statusOk = candidate.reviewStatus === "confirmed" || candidate.reviewStatus === "revised";
  return statusOk && candidate.decisionRelation !== undefined;
}
