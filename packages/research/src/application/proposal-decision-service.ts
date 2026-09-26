/**
 * ProposalDecisionService (C5-B) — the HUMAN Gate over proposals.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §19 (rev5.1): §19.2 / §19.6 / §19.7 / §19.9.
 *
 * ★ It ORCHESTRATES; it is NOT a writer of `target_proposal`. The status changes through
 *   `TargetProposalService.transition()` (a CAS) and the audit row through the repository.
 * ★ confirm()/reject() each run in ONE transaction over ONE Repository / ONE DatabaseSync
 *   (§19.6): CAS → decision INSERT → (confirm ONLY) TargetService.add(). Any failure rolls the
 *   whole thing back, so the end state is Proposal=proposed / decision=0 rows / Target untouched.
 * ★ `TargetService.add()` is reachable from confirm ONLY (§19.9): never from reject, never from
 *   the generate/persist path, never from the Agent. `createdBy` stays hard-coded "user".
 * ★ Outcomes are DETERMINISTIC business results, never a raw SQLite exception.
 */

import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { CompanyService } from "./company-service.js";
import { TargetProposalService } from "./target-proposal-service.js";
import { TargetService } from "./target-service.js";
import { subjectKeyForCompany, targetRefFor } from "../domain/index.js";
import type { ProposalDecision } from "../domain/index.js";

/** Sentinels used to unwind a transaction into a deterministic result (they never escape). */
class AlreadyDecidedError extends Error {}
class TargetAlreadyExistsError extends Error {
  constructor(readonly targetRef: string) {
    super(`target '${targetRef}' already exists`);
  }
}

export type DecisionOutcome =
  | { status: "confirmed"; proposalRef: string; targetRef: string; decidedAt: string }
  | { status: "rejected"; proposalRef: string; decidedAt: string }
  | { status: "already_decided"; proposalRef: string; proposalStatus: string }
  | { status: "target_already_exists"; proposalRef: string; targetRef: string }
  | { status: "not_found"; proposalRef: string };

export class ProposalDecisionService {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Confirm a proposal → materialise a ResearchTarget.
   *
   * Pipeline (contract §19.6): read → CAS(proposed→confirmed) → Target existence check →
   * decision INSERT → TargetService.add() → COMMIT. Steps 2–5 share ONE transaction and ONE
   * connection, so a failure can never leave a "confirmed proposal without a target".
   */
  confirm(proposalRef: string, operator: string, comment?: string): DecisionOutcome {
    const op = normaliseOperator(operator);
    const repo = new ResearchRepository(this.db);
    const existing = repo.getTargetProposal(proposalRef);
    if (!existing) return { status: "not_found", proposalRef };
    if (existing.status !== "proposed") {
      return { status: "already_decided", proposalRef, proposalStatus: existing.status };
    }

    const proposals = new TargetProposalService(this.db);
    const companies = new CompanyService(this.db);
    const targets = new TargetService(this.db); // ★ same db ⇒ same connection ⇒ same transaction

    try {
      return repo.transaction(() => {
        if (proposals.transition(proposalRef, "proposed", "confirmed") !== 1) {
          throw new AlreadyDecidedError();
        }
        const company = companies
          .list(existing.industryRef)
          .find((c) => c.companyId === existing.companyRef);
        if (!company) {
          throw new Error(
            `proposal '${proposalRef}' references unknown company '${existing.companyRef}'`,
          );
        }
        const targetRef = targetRefFor(existing.industryRef, subjectKeyForCompany(company));
        if (targets.get(targetRef)) throw new TargetAlreadyExistsError(targetRef);

        const decidedAt = new Date().toISOString();
        repo.insertTargetProposalDecision({
          proposalRef,
          kind: "confirmed",
          operator: op,
          comment,
          decidedAt,
        });
        targets.add({
          industryId: existing.industryRef,
          subjectKey: subjectKeyForCompany(company),
          targetKind: existing.matchedTargetKinds[0]!,
          positionRef: existing.positionRef,
          researchPurpose: existing.selectionReason,
          selectionReason: existing.selectionReason,
          relatedRequirementRefs: existing.coveredRequirementRefs,
        });
        return { status: "confirmed" as const, proposalRef, targetRef, decidedAt };
      });
    } catch (err) {
      if (err instanceof AlreadyDecidedError) {
        const now = repo.getTargetProposal(proposalRef);
        return { status: "already_decided", proposalRef, proposalStatus: now?.status ?? "unknown" };
      }
      if (err instanceof TargetAlreadyExistsError) {
        return { status: "target_already_exists", proposalRef, targetRef: err.targetRef };
      }
      throw err; // every other error is real: the transaction already rolled back
    }
  }

  /**
   * Reject a proposal → record the decision. **Never** touches ResearchTarget (contract §19.9).
   */
  reject(proposalRef: string, operator: string, comment?: string): DecisionOutcome {
    const op = normaliseOperator(operator);
    const repo = new ResearchRepository(this.db);
    const existing = repo.getTargetProposal(proposalRef);
    if (!existing) return { status: "not_found", proposalRef };
    if (existing.status !== "proposed") {
      return { status: "already_decided", proposalRef, proposalStatus: existing.status };
    }

    const proposals = new TargetProposalService(this.db);
    try {
      return repo.transaction(() => {
        if (proposals.transition(proposalRef, "proposed", "rejected") !== 1) {
          throw new AlreadyDecidedError();
        }
        const decidedAt = new Date().toISOString();
        repo.insertTargetProposalDecision({
          proposalRef,
          kind: "rejected",
          operator: op,
          comment,
          decidedAt,
        });
        return { status: "rejected" as const, proposalRef, decidedAt };
      });
    } catch (err) {
      if (err instanceof AlreadyDecidedError) {
        const now = repo.getTargetProposal(proposalRef);
        return { status: "already_decided", proposalRef, proposalStatus: now?.status ?? "unknown" };
      }
      throw err;
    }
  }

  /** Read-only audit view (never used to derive `proposal.status`). */
  getDecision(proposalRef: string): ProposalDecision | undefined {
    return new ResearchRepository(this.db).getTargetProposalDecision(proposalRef);
  }
}

/** §19.7: `operator` is required for BOTH verbs, trimmed, and never defaulted. */
function normaliseOperator(operator: string): string {
  const op = operator?.trim();
  if (!op) {
    throw new Error("operator is required — a human decision must name who made it (contract §19.7)");
  }
  return op;
}
