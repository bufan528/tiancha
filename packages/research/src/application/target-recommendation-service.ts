/**
 * TargetRecommendationService (C5-A) — the **pure** Recommendation Engine.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §4.4 (R2), §7, §10, §11, §15 (P12/R2).
 *
 * ★ ZERO WRITE. This class only reads (needs / positions / coverage / companies / existing
 *   targets) and returns `TargetProposalDraft[]`. It performs no persistence of any kind.
 *   Storing drafts is `TargetProposalService`'s job — keeping the two apart is C5-R2, and it is
 *   what makes P12 ("engine is write-free") testable by fingerprinting every table around a
 *   `build()` call.
 *
 * ★ Deliberately ABSENT here: any notion of confirm/reject/transition/target creation (§4.4
 *   red lines 1 and 3, §14 C5-A scope), any LLM judgement (`行业龙头` / `值得调研` …), and any
 *   external discovery. The only inputs are persisted structured facts.
 */

import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { ResearchRepository } from "../storage/research-repository.js";
import { ResearchNeedService } from "./research-need-service.js";
import { ChainProjectionService } from "./chain-projection-service.js";
import { TargetService } from "./target-service.js";
import { CompanyService } from "./company-service.js";
import {
  KIND_VOCABULARY_VERSION,
  RECOMMENDATION_SCORE_V1,
  recommendationScoreV1,
  subjectKeyForCompany,
  targetRefFor,
} from "../domain/index.js";
import type { Company, ResearchPosition, TargetProposalDraft } from "../domain/index.js";

/**
 * Deterministic serialisation for identity hashing (§7.6). Object keys are sorted, numbers use
 * their plain persisted representation (never re-derived), booleans/null are explicit, and
 * strings are used as-is (no Unicode normalisation). Array order is PRESERVED here — callers
 * decide which arrays carry meaning through their own ordering (see `revisionInputFor`).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

function stableHash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export interface BuildOptions {
  /** Optional Gap-scoped computation (`generate --gap <gapRef>`). It only narrows the input. */
  gapRef?: string;
}

export class TargetRecommendationService {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Pipeline ①–⑭ of contract §11. Every step reads; nothing writes.
   */
  build(industryId: string, options: BuildOptions = {}): TargetProposalDraft[] {
    const repo = new ResearchRepository(this.db);
    const industry = repo.getIndustry(industryId);
    if (!industry) throw new Error(`unknown industry '${industryId}'`);

    // ① Industry scope (§10.2) — the universe is `primaryIndustryId`-scoped, never "all companies".
    const universe = new CompanyService(this.db).list(industryId);

    // ② Active needs (the shared Step 2-A resolver decides what "active" means — never a local
    //    predicate here), optionally narrowed to one gap.
    const needs = new ResearchNeedService(this.db)
      .list(industryId)
      .filter((n) => options.gapRef === undefined || n.gapId === options.gapRef);
    // ③ Positions (template instances) + their coverage.
    const positionByRef = new Map<string, ResearchPosition>(
      repo.listPositions(industryId).map((p) => [p.positionRef, p]),
    );
    const coverageByRef = new Map(
      new ChainProjectionService(this.db)
        .positionCoverage(industryId)
        .map((c) => [c.positionRef, c]),
    );
    // ⑥ Existing targets — used ONLY as an eligibility exclusion (§10.1), never mutated.
    const targetRefs = new Set(new TargetService(this.db).list(industryId).map((t) => t.targetRef));

    const drafts: TargetProposalDraft[] = [];
    for (const need of needs) {
      for (const positionRef of need.suggestedPositionRefs) {
        const position = positionByRef.get(positionRef);
        const coverage = coverageByRef.get(positionRef);
        if (!position || !coverage) continue; // defensive: a ref that is not projected

        const satisfy = new Set(position.satisfiesRequirementRefs);
        const active = new Set(coverage.activeRequirementRefs);

        // ⑦ covered / unresolved requirement refs (sorted; the sets are unordered).
        const covered = [...new Set(need.requirementRefs.filter((r) => satisfy.has(r)))].sort();
        const unresolved = covered.filter((r) => active.has(r));

        for (const company of universe) {
          if (this.isAlreadyTargeted(targetRefs, industryId, company)) continue; // §10.1
          const matchedTargetKinds = this.matchingKinds(company, position); // §5.2, position order
          if (matchedTargetKinds.length === 0) continue; // §10.1

          const importance = position.importance;
          const score = recommendationScoreV1({
            importance,
            coveredCount: covered.length,
            unresolvedCount: unresolved.length,
            alreadyTargeted: false, // by construction (see the eligibility filter above)
          });
          const revisionInput = {
            priorityScore: need.priorityScore,
            priorityPolicyVersionId: need.priorityPolicyVersionId,
            positionImportance: importance,
            // PRESERVE order: the vocabulary order is part of the recommendation's meaning.
            suggestedTargetKinds: [...position.suggestedTargetKinds],
            positionLabel: position.label,
            // SORT: kinds have no intrinsic order (contract §7.6).
            companyTargetKinds: [...company.targetKinds].sort(),
            coveredRequirementRefs: covered,
            unresolvedRequirementRefs: unresolved,
            kindVocabularyVersion: KIND_VOCABULARY_VERSION,
          };
          const recommendationRevision = stableHash(canonicalJson(revisionInput));
          const proposalRef = `prop-${stableHash(
            canonicalJson({
              industryRef: industryId,
              gapRef: need.gapId,
              positionRef,
              companyRef: company.companyId,
              recommendationRevision,
            }),
          ).slice(0, 24)}`;

          drafts.push({
            proposalRef,
            industryRef: industryId,
            gapRef: need.gapId,
            positionRef,
            companyRef: company.companyId,
            matchedTargetKinds,
            positionImportance: importance,
            coveredRequirementRefs: covered,
            unresolvedRequirementRefs: unresolved,
            score,
            scoreVersion: RECOMMENDATION_SCORE_V1.version,
            kindVocabularyVersion: KIND_VOCABULARY_VERSION,
            recommendationRevision,
            selectionReason: renderSelectionReason({
              positionLabel: position.label,
              matchedTargetKinds,
              importance,
              coveredCount: covered.length,
              unresolvedCount: unresolved.length,
            }),
          });
        }
      }
    }

    // §10.3 — one proposal per (industry, company): keep the best score, fully deterministic.
    // (Whether an ACTIVE proposal already exists is a persistence-layer concern; the engine
    //  deliberately does not read `target_proposal`, keeping P12 clean.)
    const bestByCompany = new Map<string, TargetProposalDraft>();
    for (const draft of drafts) {
      const current = bestByCompany.get(draft.companyRef);
      if (!current || compareDrafts(draft, current) < 0) bestByCompany.set(draft.companyRef, draft);
    }
    return [...bestByCompany.values()].sort(compareDrafts);
  }

  /** `targetRefFor(industryId, subjectKeyForCompany(company))` — the §7.4/§10.1 predicate. */
  private isAlreadyTargeted(targetRefs: Set<string>, industryId: string, company: Company): boolean {
    return targetRefs.has(targetRefFor(industryId, subjectKeyForCompany(company)));
  }

  /** Intersection in POSITION order (§5.2): the first element becomes the reason's main term. */
  private matchingKinds(company: Company, position: ResearchPosition): string[] {
    return position.suggestedTargetKinds.filter((k) => company.targetKinds.includes(k));
  }
}

/**
 * `selectionReason` is a deterministic rendering of the structured facts persisted alongside it
 * (§11.1) — every clause maps 1:1 to a stored field, so a future LLM could only re-word it.
 */
export function renderSelectionReason(input: {
  positionLabel: string;
  matchedTargetKinds: string[];
  importance: number;
  coveredCount: number;
  unresolvedCount: number;
}): string {
  return (
    `该企业属于 Position「${input.positionLabel}」要求的 ${input.matchedTargetKinds[0]} 类型；` +
    `该 Position 对当前行业研究的重要度为 ${input.importance}；` +
    `能够覆盖当前 Gap 对应的 ${input.coveredCount} 个 Information Requirements，` +
    `其中 ${input.unresolvedCount} 个尚未解决。`
  );
}

/** score DESC → positionRef ASC → companyRef ASC (total order, no randomness). */
function compareDrafts(a: TargetProposalDraft, b: TargetProposalDraft): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.positionRef !== b.positionRef) return a.positionRef < b.positionRef ? -1 : 1;
  if (a.companyRef !== b.companyRef) return a.companyRef < b.companyRef ? -1 : 1;
  return 0;
}
