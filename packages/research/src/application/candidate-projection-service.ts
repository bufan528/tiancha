/**
 * C6 slice ④ — PROJECTION of a confirmed candidate into the EXISTING cognition path.
 *
 * This is the first slice that writes Claims / Knowledge, and it does so by calling the SAME
 * entry point field research already uses: `OpportunityDiscoveryService.ingestClaims()`. Nothing
 * here re-implements claim writing, projection or the refresh — and `ingestClaims`'s signature and
 * semantics are untouched (§C6.10).
 *
 * Guards:
 *  - I-C6-8: only a candidate with a NON-draft status AND an explicit relation can be projected;
 *  - I-C6-1: an unconfirmed candidate has NO path here at all;
 *  - §C6.17: the candidate row itself carries progress — `projectionStatus` goes
 *      none → reserved → claim_written → projected → finalized, and `reservedClaimId` is persisted
 *      in P1 so a crash anywhere can be recovered by simply re-running (the id is stable, the
 *      artifact `put` is idempotent by artifactId, and the belief id is deterministic).
 */

import { randomUUID } from "node:crypto";
import {
  isProjectable,
  type CandidateRelation,
  type ClaimCandidate,
} from "../domain/claim-candidate.js";
import type { OpportunityDiscoveryService } from "./opportunity-discovery-service.js";
import type { ResearchRepository } from "../storage/research-repository.js";
import type { KnowledgeRepository } from "../storage/knowledge-repository.js";
import { checkEvolutionTarget, evolutionTargetRefusalMessage } from "./evolution-target.js";
import { normalizeClaimRef } from "./knowledge-projection-service.js";

export class CandidateProjectionError extends Error {}

/** The project-wide claim REFERENCE shape (the same prefix the C-MVP pipeline uses). */
const CLAIM_REF_PREFIX = "artifact:claim/";

export interface ProjectInput {
  /** ★ Required: bypassing the gate must stay attributable. */
  operator: string;
  at?: string;
}

export interface ProjectionResult {
  /** `projected` = done now · `already_projected` = it was already finalized (idempotent). */
  status: "projected" | "already_projected" | "failed";
  claimRef?: string;
  error?: string;
  candidate: ClaimCandidate;
}

/** `decisionRelation` → the `relationHint` the existing projection understands. */
function relationHintFor(
  relation: CandidateRelation,
  supersedesClaimRef: string | undefined,
): { kind: "SUPPORT" } | { kind: "REVISE" } | { kind: "CONFLICT" } | { kind: "SUPERSEDE"; supersedesClaimRef: string } {
  switch (relation) {
    case "SUPPORT":
      return { kind: "SUPPORT" };
    case "REVISE":
      return { kind: "REVISE" };
    case "CONFLICT":
      return { kind: "CONFLICT" };
    case "SUPERSEDE":
      if (supersedesClaimRef === undefined || supersedesClaimRef.trim().length === 0) {
        throw new CandidateProjectionError(
          "relation SUPERSEDE needs an explicit supersedesClaimRef — refusing to guess which claim is superseded",
        );
      }
      return { kind: "SUPERSEDE", supersedesClaimRef };
  }
}

export class CandidateProjectionService {
  constructor(
    private readonly repo: ResearchRepository,
    private readonly discovery: OpportunityDiscoveryService,
    /**
     * ★ P1 fix: the knowledge side of the SAME DB. Two uses:
     *   ① re-validate an explicit evolution target BEFORE reserving anything;
     *   ② after the write, VERIFY the belief really exists — `projectFromClaim` reports a refusal
     *      by RETURNING `SKIPPED` instead of throwing, so a missing check here used to close the
     *      candidate as `finalized` while nothing had evolved.
     */
    private readonly knowledge: KnowledgeRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Project ONE confirmed candidate. Safe to re-run at ANY point: the claim id is stable and both
   * the artifact write and the belief projection are idempotent.
   */
  async project(
    candidateId: string,
    input: ProjectInput & { supersedesClaimRef?: string },
  ): Promise<ProjectionResult> {
    if (typeof input.operator !== "string" || input.operator.trim().length === 0) {
      throw new CandidateProjectionError("--operator is required and must be non-empty");
    }
    const candidate = this.repo.getClaimCandidate(candidateId);
    if (candidate === undefined) throw new CandidateProjectionError(`candidate not found: ${candidateId}`);

    // ★ I-C6-8: a draft (or a relation-less) candidate can NEVER be projected.
    if (!isProjectable(candidate)) {
      throw new CandidateProjectionError(
        `candidate ${candidateId} is "${candidate.reviewStatus}"` +
          (candidate.decisionRelation === undefined ? " without a decision relation" : "") +
          " — only a confirmed/revised candidate WITH an explicit relation can be projected (I-C6-8)",
      );
    }
    if (candidate.projectionStatus === "finalized") {
      return { status: "already_projected", claimRef: candidate.confirmedClaimRef, candidate };
    }

    // ★ Resolve the relation BEFORE reserving anything: an invalid decision must not leave a
    // half-projected candidate behind (it may not even have a `projectionError` yet).
    const storedSupersedes = candidate.supersededClaimRef;
    if (
      input.supersedesClaimRef !== undefined &&
      storedSupersedes !== undefined &&
      input.supersedesClaimRef !== storedSupersedes
    ) {
      throw new CandidateProjectionError(
        `candidate ${candidateId} was decided with supersedes=${storedSupersedes}; a retry may not change the decision`,
      );
    }
    const hint = relationHintFor(
      candidate.decisionRelation as CandidateRelation,
      storedSupersedes ?? input.supersedesClaimRef,
    );

    // ★ P1 fix ①: re-validate an EXPLICIT evolution target against the LIVE knowledge. The decision
    // validated it too, but the knowledge may have moved since — and `projectFromClaim` reports a
    // bad target by RETURNING `SKIPPED / INVALID_EVOLUTION_TARGET`, which is not an exception, so a
    // stale target would otherwise be recorded as a successful projection.
    if (hint.kind === "SUPERSEDE") {
      const check = checkEvolutionTarget({
        knowledge: this.knowledge,
        subjectKind: candidate.subjectKind,
        subjectId: candidate.subjectId,
        dimension: candidate.dimension,
        targetClaimRef: hint.supersedesClaimRef,
      });
      if (!check.ok) {
        const message = `cannot project SUPERSEDE: ${evolutionTargetRefusalMessage(check.reason, hint.supersedesClaimRef)}`;
        // keep the reason on the row for the operator, but never close it as done
        this.repo.updateCandidateProjection(candidateId, { projectionError: message });
        throw new CandidateProjectionError(message);
      }
    }

    // P1 — reserve a STABLE claim id (persisted before any cross-DB write, §C6.17)
    let reserved = candidate.reservedClaimId;
    if (reserved === undefined) {
      reserved = `claim-${randomUUID()}`;
      const claimed = this.repo.updateCandidateProjection(
        candidateId,
        { projectionStatus: "reserved", reservedClaimId: reserved },
        candidate.projectionStatus,
      );
      if (!claimed) {
        // a concurrent projector won — re-read and continue from ITS reservation (never a second id)
        const fresh = this.repo.getClaimCandidate(candidateId);
        if (fresh?.reservedClaimId === undefined) {
          throw new CandidateProjectionError(`candidate ${candidateId} is being projected concurrently`);
        }
        reserved = fresh.reservedClaimId;
      }
    }

    try {
      // P2 + P3 — the EXISTING path does the artifact write and the projection; the callback is the
      // candidate-level progress ledger. Both steps are idempotent, so a resume re-does nothing.
      await this.discovery.ingestClaims({
        subjectKind: candidate.subjectKind,
        subjectId: candidate.subjectId,
        claims: [
          {
            statement: candidate.statement,
            dimension: candidate.dimension,
            ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
            // ★ `sourceRef` means a `research_source` ROW id — NOT an evidence id. The source is the
            // stable `src-c6-<candidateId>` row created below; the evidence stays on the candidate.
            relationHint: hint,
          },
        ],
        claimIds: [reserved],
        // stable source / run ids: a retry never creates a second Source or a second run
        sourceId: `src-c6-${candidate.candidateId}`,
        runId: `c6-${candidate.candidateId}`,
        onBlockCommitted: (_blockIndex, _claimId, phase) => {
          this.repo.updateCandidateProjection(candidateId, {
            projectionStatus: phase === "artifact_written" ? "claim_written" : "projected",
          });
        },
      });
      // P4 — backfill the claim ref and close the candidate
      // ★ the stored ref uses the project-wide claimRef SHAPE (artifact:claim/<id>) so downstream
      // consumers can use it as-is; `reservedClaimId` keeps the bare artifact id.
      const claimRef = `${CLAIM_REF_PREFIX}${reserved}`;

      // ★ P1 fix ②: VERIFY the projection really took effect before closing the candidate.
      // `projectFromClaim` reports a refusal by RETURNING `SKIPPED / INVALID_EVOLUTION_TARGET` (or
      // `SKIPPED / OPEN_CONFLICT_REQUIRES_REVIEW`) instead of throwing, and `ingestClaims` does not
      // propagate that result. The only proof of a real projection is a belief that carries THIS
      // candidate's claim ref — so a skip is surfaced as a failed projection and the candidate stops
      // at `claim_written` (never `finalized`). A genuine re-run still resolves to `ALREADY_PROJECTED`
      // and finds the belief ⇒ idempotent recovery is unaffected (§C6.17).
      if (this.findProjectedBelief(candidate.subjectKind, candidate.subjectId, reserved) === undefined) {
        const message =
          `${claimRef} produced no belief — the knowledge side refused the claim ` +
          `(decision relation ${String(candidate.decisionRelation)}); the candidate is NOT finalized`;
        this.repo.updateCandidateProjection(candidateId, {
          projectionStatus: "claim_written",
          projectionError: message,
        });
        return { status: "failed", error: message, candidate: this.requireCandidate(candidateId) };
      }

      this.repo.updateCandidateProjection(candidateId, {
        projectionStatus: "finalized",
        confirmedClaimRef: claimRef,
      });
      return { status: "projected", claimRef, candidate: this.requireCandidate(candidateId) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.repo.updateCandidateProjection(candidateId, { projectionError: message });
      return { status: "failed", error: message, candidate: this.requireCandidate(candidateId) };
    }
  }

  /** The real Claim ref this candidate became, if any (candidate → Claim traceability). */
  claimRefOf(candidateId: string): string | undefined {
    return this.repo.getClaimCandidate(candidateId)?.confirmedClaimRef;
  }

  /**
   * ★ P1 fix: is the claim actually IN knowledge? `projectFromClaim` returns a skip instead of
   * throwing, so the belief's existence — not the absence of an exception — is the evidence that a
   * projection took effect.
   */
  private findProjectedBelief(subjectKind: string, subjectId: string, claimId: string) {
    const knowledgeId = this.knowledge.findKnowledgeBySubject(subjectKind, subjectId)?.knowledgeId;
    if (knowledgeId === undefined) return undefined;
    return this.knowledge.findBeliefByKnowledgeAndClaim(knowledgeId, normalizeClaimRef(claimId));
  }

  private requireCandidate(candidateId: string): ClaimCandidate {
    const found = this.repo.getClaimCandidate(candidateId);
    if (found === undefined) throw new CandidateProjectionError(`candidate not found: ${candidateId}`);
    return found;
  }
}
