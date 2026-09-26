/**
 * TargetProposalService (C5-A) — the ONLY writer of `target_proposal`.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §4.1, §6, §7.3, §10.3, §15 (P11).
 *
 * ★ Persistence only. This service takes the pure engine's `TargetProposalDraft[]` and stores
 *   what is not already there. It owns no state-change and no decision concept: those arrive
 *   with C5-B, and their absence here is intentional (the code boundary mirrors the
 *   architecture boundary).
 *
 * ★ Two independent reasons a draft is NOT written (§7.3 P11 + §10.3 uniqueness):
 *   1. `proposal_ref` already exists ⇒ same research state ⇒ exact no-op (idempotent re-generate);
 *   2. the same `(industry, company)` already has an ACTIVE (`proposed`) proposal ⇒ a company
 *      never accumulates two competing proposals, whatever the `--gap` scope was.
 */

import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { INITIAL_PROPOSAL_STATUS } from "../domain/index.js";
import type { TargetProposal, TargetProposalDraft, TargetProposalStatus } from "../domain/index.js";

export interface PersistProposalsResult {
  /** Newly stored proposals. */
  created: number;
  /** Drafts skipped because the identical `proposal_ref` was already stored (P11 exact no-op). */
  skippedSameRef: number;
  /** Drafts skipped because the company already had an active proposal (§10.3). */
  skippedActiveExists: number;
}

export class TargetProposalService {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Idempotent, insert-if-absent persistence. Deterministic: the same drafts against the same
   * database produce the same rows, and re-running it creates nothing new.
   */
  persistDrafts(drafts: TargetProposalDraft[]): PersistProposalsResult {
    const repo = new ResearchRepository(this.db);
    const result: PersistProposalsResult = {
      created: 0,
      skippedSameRef: 0,
      skippedActiveExists: 0,
    };
    for (const draft of drafts) {
      if (repo.getTargetProposal(draft.proposalRef)) {
        result.skippedSameRef += 1;
        continue;
      }
      const active = repo
        .listTargetProposals(draft.industryRef, "proposed")
        .some((p) => p.companyRef === draft.companyRef);
      if (active) {
        result.skippedActiveExists += 1;
        continue;
      }
      const proposal: TargetProposal = {
        ...draft,
        status: INITIAL_PROPOSAL_STATUS,
        createdAt: new Date().toISOString(),
      };
      try {
        repo.insertTargetProposal(proposal);
      } catch (err) {
        // ★ C5-B: the ONLY conflict we may absorb is the active-subject race. Anything else is a
        //   real error and must propagate (contract §19.5③) — never blanket-catch.
        if (!isActiveSubjectConflict(err, repo, draft.industryRef, draft.companyRef)) throw err;
        result.skippedActiveExists += 1;
        continue;
      }
      result.created += 1;
    }
    return result;
  }

  list(industryRef: string, status?: TargetProposalStatus): TargetProposal[] {
    return new ResearchRepository(this.db).listTargetProposals(industryRef, status);
  }

  get(proposalRef: string): TargetProposal | undefined {
    return new ResearchRepository(this.db).getTargetProposal(proposalRef);
  }

  /**
   * C5-B: the ONLY state-change entry for a proposal, and a compare-and-set (§19.6). It is the
   * single place `target_proposal.status` may change; `ProposalDecisionService` orchestrates it
   * from inside its own transaction. Returns the number of rows changed (1 = transitioned).
   */
  transition(proposalRef: string, from: TargetProposalStatus, to: TargetProposalStatus): number {
    return new ResearchRepository(this.db).casTransitionTargetProposal(proposalRef, from, to);
  }
}

/**
 * Double-checked identification of the ONE conflict `persistDrafts` may absorb: the partial unique
 * index `idx_proposal_active_subject`. We deliberately never decide on a brittle error string
 * alone — we ALSO re-read the conflicting subject and require that an ACTIVE proposal exists now
 * (contract §19.5③). Every other SQLite error stays fatal.
 */
function isActiveSubjectConflict(
  err: unknown,
  repo: ResearchRepository,
  industryRef: string,
  companyRef: string,
): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (!/UNIQUE constraint failed/i.test(message)) return false;
  if (!message.includes("target_proposal")) return false;
  if (!/idx_proposal_active_subject|industry_ref, ?company_ref/i.test(message)) return false;
  return repo
    .listTargetProposals(industryRef, "proposed")
    .some((p) => p.companyRef === companyRef);
}
