/**
 * ResearchNeedService (Phase B v1 · Step B1) — derives the READ-ONLY `ResearchNeed` list.
 *
 * Contract §2.1 / I-B6: it only READS Gap / Requirement / Priority (the S6-R1 read-only
 * face) / Methodology + the projected positions. It writes NOTHING and never back-writes
 * to Gap / Requirement / Priority.
 */

import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { PriorityService } from "./priority-service.js";
import { sufficiencyPolicies } from "../domain/sufficiency.js";
import { whyStudyNotJustFetch } from "../domain/research-need.js";
import type { InformationRequirement, ResearchNeed } from "../domain/index.js";

export class ResearchNeedService {
  constructor(private readonly db: DatabaseSync) {}

  list(industryId: string): ResearchNeed[] {
    const repo = new ResearchRepository(this.db);
    const requirementById = new Map(repo.listRequirements(industryId).map((r) => [r.requirementId, r]));
    const positions = repo.listPositions(industryId);
    const priorityByGap = new Map(
      new PriorityService(this.db).currentPriorities(industryId).map((p) => [p.gapId, p]),
    );

    const gaps = repo.listGaps(industryId).filter((g) => g.status === "open" || g.status === "mitigating");

    const needs: ResearchNeed[] = [];
    for (const gap of gaps) {
      const requirement = requirementById.get(gap.relatedRequirementIds[0] ?? "");
      if (!requirement) continue;
      const priority = priorityByGap.get(gap.gapId);

      needs.push({
        needId: gap.gapId,
        gapId: gap.gapId,
        requirementId: requirement.requirementId,
        dimension: requirement.dimension,
        question: requirement.description,
        whyStudyNotJustFetch: whyStudyNotJustFetch(gap.gapType, requiresFirstHand(requirement)),
        suggestedPositionRefs: positions
          .filter((p) => p.satisfiesRequirementRefs.includes(requirement.requirementId))
          .map((p) => p.positionRef),
        priorityScore: priority?.score ?? 0,
        priorityPolicyVersionId: priority?.policyVersionId ?? "",
      });
    }

    // Deterministic total order: priority desc, then needId asc.
    needs.sort(
      (a, b) => b.priorityScore - a.priorityScore || (a.needId < b.needId ? -1 : a.needId > b.needId ? 1 : 0),
    );
    return needs;
  }
}

/** Reads the requirement's declared sufficiency policy (no assertion, same as S5). */
function requiresFirstHand(requirement: InformationRequirement): boolean {
  const ref = requirement.sufficiencyPolicyRef;
  if (!ref) return false;
  return sufficiencyPolicies.get(ref)?.requiresFirstHand ?? false;
}
