/**
 * C6 slice ③ — HUMAN REVIEW of claim candidates (contract §C6.4 / §C6.16.9 / I-C6-8).
 *
 * This is the human gate. It records WHAT a person decided — and nothing else:
 *
 *  - `confirm` REQUIRES an explicit evolution relation (I-C6-8). It marks the candidate
 *    `confirmed` + stores the relation. It does NOT write a Claim: the projection into the
 *    existing `ingestClaims()` path is slice ④ and is still unauthorized. A confirmed candidate
 *    only becomes *projectable* here.
 *  - `revise` edits the candidate CONTENT and KEEPS it `draft`. Editing is not confirming:
 *    a revised candidate still has no relation and is therefore not projectable (I-C6-8).
 *  - `reject` marks it `rejected` with a reason.
 *
 * Every action appends ONE `candidate_review` row carrying before/after (append-only audit).
 * Nothing in this module writes a Claim / Belief / Pool / Gap / Evaluation (I-C6-1).
 */

import {
  candidateReviewIdFor,
  type CandidateContentKind,
  type CandidateRelation,
  type CandidateReview,
  type CandidateReviewAction,
  type ClaimCandidate,
} from "../domain/claim-candidate.js";
import type { ResearchRepository } from "../storage/research-repository.js";

export class CandidateReviewError extends Error {}

export interface ReviewContext {
  /** ★ Required and non-empty: every human decision must be attributable (§C6.16.9). */
  operator: string;
  comment?: string;
  at?: string;
}

export interface ConfirmInput extends ReviewContext {
  /** ★ I-C6-8: no relation ⇒ no confirmation. */
  relation: CandidateRelation;
  /**
   * ★ Required when — and only meaningful for — `SUPERSEDE`. It is stored WITH the decision so a
   * later retry can never quietly pick a different target.
   */
  supersedesClaimRef?: string;
}

export interface ReviseInput extends ReviewContext {
  statement?: string;
  contentKind?: CandidateContentKind;
  confidence?: number;
}

export interface ListCandidatesInput {
  materialVersionId?: string;
  subjectKind?: string;
  subjectId?: string;
  reviewStatus?: string;
}

const RELATIONS: CandidateRelation[] = ["SUPPORT", "REVISE", "CONFLICT", "SUPERSEDE"];

export class CandidateReviewService {
  constructor(
    private readonly repo: ResearchRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  list(input: ListCandidatesInput = {}): ClaimCandidate[] {
    let rows: ClaimCandidate[];
    if (input.materialVersionId !== undefined) {
      rows = this.repo.listClaimCandidates(input.materialVersionId);
    } else if (input.subjectKind !== undefined && input.subjectId !== undefined) {
      rows = this.repo.listClaimCandidatesBySubject(input.subjectKind, input.subjectId);
    } else {
      throw new CandidateReviewError("provide either materialVersionId or (subjectKind + subjectId)");
    }
    return input.reviewStatus === undefined ? rows : rows.filter((c) => c.reviewStatus === input.reviewStatus);
  }

  show(candidateId: string): { candidate: ClaimCandidate; reviews: CandidateReview[] } {
    const candidate = this.requireCandidate(candidateId);
    return { candidate, reviews: this.repo.listCandidateReviews(candidateId) };
  }

  /**
   * Record a human confirmation WITH its relation. The candidate becomes `confirmed` + carries
   * `decisionRelation` ⇒ `isProjectable()` turns true. ★ No Claim is written here (slice ④).
   */
  confirm(candidateId: string, input: ConfirmInput): ClaimCandidate {
    this.requireOperator(input.operator);
    if (!RELATIONS.includes(input.relation)) {
      throw new CandidateReviewError(
        `--relation must be one of ${RELATIONS.join(" | ")} (I-C6-8: a confirmation without an explicit relation is not a confirmation)`,
      );
    }
    // ★ validate BEFORE touching the row: a SUPERSEDE without a target is not a decision, and it
    // must fail here rather than half-way through a projection.
    if (input.relation === "SUPERSEDE" && (input.supersedesClaimRef ?? "").trim().length === 0) {
      throw new CandidateReviewError(
        "relation SUPERSEDE requires --supersedes-claim <claimRef> — the target is part of the decision",
      );
    }
    const before = this.requireDraft(candidateId, "confirm");
    const at = input.at ?? this.now();
    const after: ClaimCandidate = {
      ...before,
      reviewStatus: "confirmed",
      decisionRelation: input.relation,
      ...(input.relation === "SUPERSEDE" && input.supersedesClaimRef !== undefined
        ? { supersededClaimRef: input.supersedesClaimRef }
        : {}),
      reviewedBy: input.operator,
      reviewedAt: at,
    };
    this.apply(before, after, at);
    this.appendReview({
      candidateId,
      action: "confirm",
      operator: input.operator,
      at,
      comment: input.comment,
      before: {
        reviewStatus: before.reviewStatus,
        decisionRelation: before.decisionRelation ?? null,
        supersededClaimRef: before.supersededClaimRef ?? null,
      },
      after: {
        reviewStatus: after.reviewStatus,
        decisionRelation: after.decisionRelation ?? null,
        supersededClaimRef: after.supersededClaimRef ?? null,
      },
    });
    return this.requireCandidate(candidateId);
  }

  /**
   * ★ EDIT ONLY: update the content and KEEP `draft`. No relation is set, so the candidate stays
   * unprojectable — editing a candidate is not the same as accepting it (§C6.16.9).
   */
  revise(candidateId: string, input: ReviseInput): ClaimCandidate {
    this.requireOperator(input.operator);
    const hasEdit =
      input.statement !== undefined || input.contentKind !== undefined || input.confidence !== undefined;
    if (!hasEdit) throw new CandidateReviewError("revise needs at least one of --statement / --kind / --confidence");
    if (input.statement !== undefined && input.statement.trim().length === 0) {
      throw new CandidateReviewError("--statement must not be empty");
    }
    if (input.contentKind !== undefined && input.contentKind !== "fact" && input.contentKind !== "judgment") {
      throw new CandidateReviewError("--kind must be fact | judgment (§C6.5)");
    }
    const before = this.requireDraft(candidateId, "revise");
    const at = input.at ?? this.now();
    const after: ClaimCandidate = {
      ...before,
      statement: input.statement ?? before.statement,
      contentKind: input.contentKind ?? before.contentKind,
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
      // ★ stays `draft` — deliberately NOT `revised` (that status is for a projected revision)
      reviewStatus: "draft",
      reviewedBy: input.operator,
      reviewedAt: at,
    };
    this.apply(before, after, at);
    this.appendReview({
      candidateId,
      action: "edit",
      operator: input.operator,
      at,
      comment: input.comment,
      before: { statement: before.statement, contentKind: before.contentKind, confidence: before.confidence ?? null },
      after: { statement: after.statement, contentKind: after.contentKind, confidence: after.confidence ?? null },
    });
    return this.requireCandidate(candidateId);
  }

  /** Reject with a reason; a rejected candidate is never projectable. */
  reject(candidateId: string, input: ReviewContext): ClaimCandidate {
    this.requireOperator(input.operator);
    const before = this.requireDraft(candidateId, "reject");
    const at = input.at ?? this.now();
    const after: ClaimCandidate = {
      ...before,
      reviewStatus: "rejected",
      reviewedBy: input.operator,
      reviewedAt: at,
    };
    this.apply(before, after, at);
    this.appendReview({
      candidateId,
      action: "reject",
      operator: input.operator,
      at,
      comment: input.comment,
      before: { reviewStatus: before.reviewStatus },
      after: { reviewStatus: after.reviewStatus },
    });
    return this.requireCandidate(candidateId);
  }

  // ---- internals ----------------------------------------------------------

  private requireOperator(operator: string): void {
    if (typeof operator !== "string" || operator.trim().length === 0) {
      throw new CandidateReviewError("--operator is required and must be non-empty (§C6.16.9)");
    }
  }

  private requireCandidate(candidateId: string): ClaimCandidate {
    const found = this.repo.getClaimCandidate(candidateId);
    if (found === undefined) throw new CandidateReviewError(`candidate not found: ${candidateId}`);
    return found;
  }

  /** Only a `draft` can be acted on: confirmed / rejected are terminal here. */
  private requireDraft(candidateId: string, action: string): ClaimCandidate {
    const found = this.requireCandidate(candidateId);
    if (found.reviewStatus !== "draft") {
      throw new CandidateReviewError(
        `candidate ${candidateId} is "${found.reviewStatus}" — ${action} only applies to a draft candidate`,
      );
    }
    return found;
  }

  private apply(before: ClaimCandidate, after: ClaimCandidate, at: string): void {
    const changed = this.repo.updateClaimCandidateForReview(
      before.candidateId,
      {
        statement: after.statement,
        contentKind: after.contentKind,
        confidence: after.confidence,
        reviewStatus: after.reviewStatus,
        decisionRelation: after.decisionRelation,
        ...(after.supersededClaimRef === undefined ? {} : { supersededClaimRef: after.supersededClaimRef }),
        reviewedBy: after.reviewedBy,
        reviewedAt: at,
      },
      "draft",
    );
    if (!changed) {
      throw new CandidateReviewError(
        `candidate ${before.candidateId} changed underneath this review (concurrent update refused)`,
      );
    }
  }

  private appendReview(input: {
    candidateId: string;
    action: CandidateReviewAction;
    operator: string;
    at: string;
    comment?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }): void {
    this.repo.insertCandidateReview({
      reviewId: candidateReviewIdFor(input.candidateId, input.action, input.at),
      candidateId: input.candidateId,
      action: input.action,
      operator: input.operator,
      at: input.at,
      ...(input.comment === undefined ? {} : { comment: input.comment }),
      ...(input.before === undefined ? {} : { before: input.before }),
      ...(input.after === undefined ? {} : { after: input.after }),
    });
  }
}
