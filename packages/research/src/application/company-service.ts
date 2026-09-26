/**
 * CompanyService (C5-A) — the minimal, HUMAN-ONLY entry point for the Company Universe.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §4.1 / §5.1 / §5.2 / §10.2.
 *
 * ★ What a Company is here: a **candidate-enterprise fact** supplied by a human. It is NOT a
 *   research target (that is `ResearchTarget`, written only by `TargetService`), and it is NOT a
 *   proposal (that is `TargetProposal`). C5-R5 keeps the three strictly separate.
 *
 * ★ No discovery, no inference: nothing here searches the web, guesses an industry, or derives a
 *   `targetKind`. Names, the industry affiliation and the kinds are all human input (§4.4 red
 *   lines 6 / 9 / 11). `targetKinds` is validated against the STATIC versioned vocabulary
 *   (`domain/target-kind-vocabulary.ts`) — deliberately NOT against a per-industry chain
 *   projection, so a later template change can never make an existing company unreadable.
 */

import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { ResearchRepository } from "../storage/research-repository.js";
import { isKnownTargetKind, TARGET_KIND_VOCABULARY } from "../domain/index.js";
import type { Company } from "../domain/index.js";

export interface AddCompanyInput {
  /** Required: the industry this candidate belongs to (`primaryIndustryId`). */
  industryId: string;
  /** Required: the human-supplied canonical name. Empty / whitespace-only is rejected. */
  canonicalName: string;
  /** Required: one or more kinds from the frozen vocabulary. */
  targetKinds: string[];
  aliases?: string[];
}

export class CompanyService {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Deterministic id: the same `(industry, name)` is ALWAYS the same company, so re-adding the
   * same subject is an idempotent update rather than a duplicate row (mirrors the `tgt-` /
   * `dp-` discipline of the surrounding phases). Different industries get different ids, which
   * is what keeps universes isolated (§10.2).
   */
  static companyIdFor(industryId: string, canonicalName: string): string {
    const digest = createHash("sha1")
      .update(`${industryId}\u0000${canonicalName.trim()}`)
      .digest("hex")
      .slice(0, 16);
    return `com-${digest}`;
  }

  add(input: AddCompanyInput): Company {
    const repo = new ResearchRepository(this.db);
    if (!repo.getIndustry(input.industryId)) {
      throw new Error(`unknown industry '${input.industryId}'`);
    }
    const canonicalName = input.canonicalName?.trim();
    if (!canonicalName) throw new Error("canonicalName is required (a company is human-supplied)");

    const kinds = (input.targetKinds ?? []).map((k) => k?.trim()).filter((k) => k.length > 0);
    if (kinds.length === 0) throw new Error("targetKinds must contain at least one kind");
    const unknown = kinds.filter((k) => !isKnownTargetKind(k));
    if (unknown.length > 0) {
      throw new Error(
        `unknown target kind(s): ${unknown.join(", ")} — allowed: ${TARGET_KIND_VOCABULARY.join(", ")}`,
      );
    }
    const deduped = [...new Set(kinds)];
    if (deduped.length !== kinds.length) {
      throw new Error(`targetKinds contains duplicates: ${kinds.join(", ")}`);
    }

    const companyId = CompanyService.companyIdFor(input.industryId, canonicalName);
    const existing = repo.getCompany(companyId);
    const now = new Date().toISOString();

    const company: Company = {
      companyId,
      canonicalName,
      aliases: (input.aliases ?? []).map((a) => a.trim()).filter((a) => a.length > 0),
      primaryIndustryId: input.industryId,
      targetKinds: deduped,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    repo.upsertCompany(company);
    return company;
  }

  /** The Company Universe for one industry (§10.2) — `primaryIndustryId` scoped. */
  list(industryId: string): Company[] {
    return new ResearchRepository(this.db).listCompanies(industryId);
  }

  get(companyId: string): Company | undefined {
    return new ResearchRepository(this.db).getCompany(companyId);
  }
}
