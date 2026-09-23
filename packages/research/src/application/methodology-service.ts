/**
 * MethodologyService (Phase P1) — versioned, Human-gated methodology evolution.
 *
 * Invariant 6: a methodology version can only become ACTIVE after a human
 * decision. The model may PROPOSE a candidate; it can never activate one.
 *
 * Flow (per domain/methodology.ts):
 *   Material → MethodologyCandidate → Agent Explanation → Human Review
 *   → New Version → Activate
 *
 * History is never overwritten: activating a new version keeps every prior
 * version row; getActive() returns the latest ACTIVATED version.
 */

import { randomUUID } from "node:crypto";
import type {
  MethodologyCandidate,
  MethodologyDimension,
  MethodologyVersion,
} from "../domain/index.js";
import type { ResearchRepository } from "../storage/research-repository.js";
import { METHODOLOGY_V1 } from "../methodology/methodology-v1.js";

export interface ProposeMethodologyInput {
  /** Version this proposal is based on; defaults to the active version. */
  baseVersionId?: string;
  proposedDimensions: MethodologyDimension[];
  /** Why this change is proposed (material or field-research counterexamples). */
  rationale: string;
  evidenceRefs?: string[];
  createdBy?: "agent" | "user";
  now?: Date;
}

export interface DecideMethodologyInput {
  candidateId: string;
  decision: "approved" | "rejected";
  /** Human operator. Required: without it there is no human gate (Invariant 6). */
  operator: string;
  comment?: string;
  /** Explicit tag for the new version; defaults to the next vN. */
  nextVersionTag?: string;
  now?: Date;
}

export interface DecideMethodologyResult {
  candidate: MethodologyCandidate;
  /** Present only when a candidate was approved (a new active version). */
  activatedVersion?: MethodologyVersion;
}

export class MethodologyService {
  constructor(private readonly repo: ResearchRepository) {}

  /** Idempotently seed the frozen v1 baseline into the DB; returns that row. */
  bootstrap(baseline: MethodologyVersion = METHODOLOGY_V1): MethodologyVersion {
    const existing = this.repo.getMethodology(baseline.versionId);
    if (existing) return existing;
    this.repo.upsertMethodology(baseline);
    return baseline;
  }

  /** The active version, bootstrapping the frozen v1 baseline if none exists. */
  getActive(baseline: MethodologyVersion = METHODOLOGY_V1): MethodologyVersion {
    return this.repo.getActiveMethodology() ?? this.bootstrap(baseline);
  }

  /** Propose a change. Never activates anything by itself. */
  propose(input: ProposeMethodologyInput): MethodologyCandidate {
    const now = (input.now ?? new Date()).toISOString();
    const candidate: MethodologyCandidate = {
      candidateId: `mwc-${randomUUID()}`,
      baseVersionId: input.baseVersionId ?? this.getActive().versionId,
      proposedDimensions: input.proposedDimensions,
      rationale: input.rationale,
      evidenceRefs: input.evidenceRefs ?? [],
      status: "pending",
      createdBy: input.createdBy ?? "agent",
      createdAt: now,
    };
    this.repo.upsertMethodologyCandidate(candidate);
    return candidate;
  }

  /**
   * Decide a pending candidate. Approval activates a NEW version derived from
   * the candidate; the previous version is retained. Rejection never activates.
   * An operator (human gate) is mandatory.
   */
  decide(input: DecideMethodologyInput): DecideMethodologyResult {
    if (!input.operator) {
      throw new Error("operator is required: methodology cannot activate without a human gate (Invariant 6)");
    }
    // Check-then-write must be atomic: two concurrent decisions on the same
    // candidate must not both pass the pending check and activate.
    return this.repo.transaction(() => {
      const candidate = this.repo.getMethodologyCandidate(input.candidateId);
      if (!candidate) throw new Error(`MethodologyCandidate ${input.candidateId} not found`);
      if (candidate.status !== "pending") {
        throw new Error(`MethodologyCandidate ${input.candidateId} is not pending (status=${candidate.status})`);
      }

      const now = (input.now ?? new Date()).toISOString();
      const decided: MethodologyCandidate = {
        ...candidate,
        status: input.decision,
        decidedAt: now,
        operator: input.operator,
        comment: input.comment,
      };
      this.repo.upsertMethodologyCandidate(decided);

      if (input.decision === "rejected") return { candidate: decided };

      const nextTag = input.nextVersionTag ?? this.nextVersionTag();
      const activatedVersion: MethodologyVersion = {
        versionId: `mw-${nextTag}`,
        versionTag: nextTag,
        dimensions: candidate.proposedDimensions,
        isHumanApprovedBaseline: true,
        createdAt: now,
        activatedAt: now,
      };
      this.repo.upsertMethodology(activatedVersion);
      return { candidate: decided, activatedVersion };
    });
  }

  /** Version history, oldest first (never overwritten). */
  history(): MethodologyVersion[] {
    return this.repo.listMethodologies();
  }

  /** Pending proposals awaiting a human decision. */
  pendingCandidates(): MethodologyCandidate[] {
    return this.repo.listMethodologyCandidates("pending");
  }

  private nextVersionTag(): string {
    // version rows are append-only, so count is monotonic
    return `v${this.repo.listMethodologies().length + 1}`;
  }
}
