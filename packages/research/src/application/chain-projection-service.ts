/**
 * ChainProjectionService (Phase B v1 · Step B1) — projects a `ChainTemplate` into
 * `ResearchPosition` rows for one industry.
 *
 * Contract §2.3:
 *  - **idempotent**: deterministic `positionRef`, so re-projecting updates in place;
 *  - **I-B1 no empty nodes**: a template position serving NO requirement is NOT written,
 *    and it is REPORTED in `skipped` (never silently dropped);
 *  - **I-B7 template instance**: `chainTemplateId` + `chainVersion` are stored, so a
 *    template version change yields NEW refs and leaves the old rows untouched.
 *
 * It reads Requirements + Methodology only — it writes nothing else.
 */

import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { MethodologyService } from "./methodology-service.js";
import { CHAIN_TEMPLATE_GENERAL_V1, type ChainTemplate } from "../domain/chain-template.js";
import { positionCoverages } from "../domain/index.js";
import type { PositionCoverage, PositionProjectionResult, ResearchPosition } from "../domain/index.js";

export class ChainProjectionService {
  constructor(
    private readonly db: DatabaseSync,
    /** The ACTIVE template. `chainVersion` on every position comes from here. */
    private readonly template: ChainTemplate = CHAIN_TEMPLATE_GENERAL_V1,
  ) {}

  project(industryId: string): PositionProjectionResult {
    const repo = new ResearchRepository(this.db);
    const methodology = new MethodologyService(repo).getActive();
    const weightByDimension = new Map(methodology.dimensions.map((d) => [d.key, d.weight]));
    const requirements = repo.listRequirements(industryId);
    const now = new Date().toISOString();

    const positions: ResearchPosition[] = [];
    const skipped: PositionProjectionResult["skipped"] = [];

    for (const templatePosition of this.template.positions) {
      const serving = requirements.filter((r) => templatePosition.dimensionKeys.includes(r.dimension));
      const answersQuestionRefs = serving.map((r) => r.questionId);
      const satisfiesRequirementRefs = serving.map((r) => r.requirementId);

      // I-B1: a position must explain WHY and reference at least one Question/Requirement.
      if (
        templatePosition.whyImportant.trim().length === 0 ||
        (answersQuestionRefs.length === 0 && satisfiesRequirementRefs.length === 0)
      ) {
        skipped.push({
          positionKey: templatePosition.key,
          reason: "no serving requirement — would be an empty node (I-B1)",
        });
        continue;
      }

      // Derived, never hand-waved: the weights of the dimensions it serves (clamped).
      const importance = Math.min(
        1,
        serving.reduce((sum, r) => sum + (weightByDimension.get(r.dimension) ?? 0), 0),
      );

      const position: ResearchPosition = {
        // I-B7: the template VERSION is part of the identity, so upgrading a template
        // produces NEW refs and can never rewrite the historical plan.
        positionRef: `pos-${industryId}-${this.template.templateId}-${this.template.version}-${templatePosition.key}`,
        industryId,
        chainTemplateId: this.template.templateId,
        chainVersion: this.template.version,
        kind: templatePosition.kind,
        label: templatePosition.label,
        whyImportant: templatePosition.whyImportant,
        answersQuestionRefs,
        satisfiesRequirementRefs,
        suggestedTargetKinds: templatePosition.suggestedTargetKinds,
        suitableEvidenceKinds: templatePosition.suitableEvidenceKinds,
        limitations: templatePosition.limitations,
        importance,
        createdAt: now,
      };

      repo.upsertPosition(position);
      positions.push(position);
    }

    return { positions, skipped };
  }

  /**
   * ★ C2 Phase 2 · Step 2-A: READ-ONLY coverage of the ALREADY-projected positions.
   *
   * `allRequirementRefs` ≡ `satisfiesRequirementRefs` (capability); `activeRequirementRefs` =
   * all ∩ the industry's active requirements (shared resolver, §4.1). It READS ONLY — it never
   * projects a chain, never writes, and never mutates a position (I-C2-16: a position never
   * "converges"; `positionRef` and capability refs stay stable across the Gap lifecycle).
   *
   * The derivation itself lives in the domain (`positionCoverages`) so the CLI and the Agent
   * (which deliberately has no ChainProjectionService injected) share ONE implementation.
   */
  positionCoverage(industryId: string): PositionCoverage[] {
    const repo = new ResearchRepository(this.db);
    return positionCoverages(
      repo.listPositions(industryId),
      repo.listGaps(industryId),
      repo.listRequirements(industryId),
    );
  }

  /**
   * ★ C2 Step 2-C: READ-ONLY access to the ALREADY projected positions, so a read-model consumer
   * (the research plan) can read a position's `label` / `kind` without touching the storage layer
   * itself. Unlike `project()` it never projects and never writes.
   */
  listProjectedPositions(industryId: string): ResearchPosition[] {
    return new ResearchRepository(this.db).listPositions(industryId);
  }
}
