/**
 * ResearchPlanService (Phase C2 · Step 2-C) — **the ONE plan projection / build path**.
 *
 * `build(industryId)` composes the deterministic results C2 already produces into a human-readable
 * "current research plan" view. It is NOT a planner: it never re-judges, never re-computes an
 * existing derivation and never writes.
 *
 * ★ READ-ONLY sources — the call-chain audit (not merely a grep):
 *   repo.getIndustry(industryId)                        — pure read of industry
 *   repo.getStateBySubject("industry", industryId)      — pure read of research_state (never refreshed)
 *   repo.listNextActions(industryId)                    — pure read of next_action (never refreshed)
 *   ResearchNeedService.list(industryId)                — Active Gaps + Priority + suggestedPositionRefs
 *                                                         (the shared Step 2-A resolver decides "active")
 *   ChainProjectionService.positionCoverage(industryId) — Step 2-A read-only coverage derivation
 *   ChainProjectionService.listProjectedPositions(...)  — pure read of research_position
 *   TargetService.list(industryId)                      — pure read of research_target
 *   QuestionTargetFitService.summarize(targetRef)       — pure read aggregation (FitSummary)
 *   DiligencePreparationService.list(industryId)        — pure read of diligence_preparation
 *   repo.getActiveMethodology()                         — pure read (dimension labels only)
 *
 * ★ It does NOT re-compute anything the contract freezes (I-C2-24 / I-C2-25):
 *   priority        ← the need list (never the priority service directly)
 *   active          ← the shared resolver's outputs (never a local predicate)
 *   Gap → Position  ← `need.suggestedPositionRefs` (never a new intersection)
 *   fit             ← `summarize()`; preparation counts ← the Phase 1 current/history view
 *   State/NextAction← read as-is (stale is shown as stale — no refresh on the show path)
 *
 * ★ Zero mutation (I-C2-22): no `refresh*` / `sync*` / `upsert*` / `create*` / `resolve*` appears
 *   in this file; calling `build()` twice leaves all 24 tables byte-identical (I-C2-17).
 *   `ResearchPlanView` is a projection DTO with no identity and no lifecycle fields (§1.1).
 */

import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { ResearchNeedService } from "./research-need-service.js";
import { ChainProjectionService } from "./chain-projection-service.js";
import { TargetService } from "./target-service.js";
import { QuestionTargetFitService } from "./question-target-fit-service.js";
import { DiligencePreparationService } from "./diligence-preparation-service.js";
import {
  compareGaps,
  compareNextActions,
  compareTargets,
  preparationSummary,
  targetAssociationStatus,
  targetBelongsToGap,
  type ResearchPlanGap,
  type ResearchPlanNextAction,
  type ResearchPlanPosition,
  type ResearchPlanState,
  type ResearchPlanTarget,
  type ResearchPlanView,
} from "../domain/index.js";
import type { ResearchTarget } from "../domain/index.js";

export class ResearchPlanService {
  constructor(private readonly db: DatabaseSync) {}

  /** The ONE build path (CLI and Agent both call exactly this). */
  build(industryId: string): ResearchPlanView {
    const repo = new ResearchRepository(this.db);
    const industry = repo.getIndustry(industryId);
    if (!industry) throw new Error(`unknown industry '${industryId}'`);

    // ---- read-only sources ---------------------------------------------------
    const needs = new ResearchNeedService(this.db).list(industryId);
    const chain = new ChainProjectionService(this.db);
    const coverage = chain.positionCoverage(industryId);
    const positions = chain.listProjectedPositions(industryId);
    const targets = new TargetService(this.db).list(industryId);
    const fits = new QuestionTargetFitService(this.db);
    const preparations = new DiligencePreparationService(this.db).list(industryId);
    const state = repo.getStateBySubject("industry", industryId);
    const actions = repo.listNextActions(industryId);
    // ★ READ-ONLY on purpose: the methodology *service*'s `getActive()` bootstraps (i.e. WRITES) the
    //   frozen baseline when no active version exists. The plan must not write, so it reads the
    //   active row directly and falls back to the dimension key when that row is absent.
    const activeMethodology = repo.getActiveMethodology();
    const dimensionNameByKey = new Map(
      (activeMethodology?.dimensions ?? []).map((d) => [d.key, d.name]),
    );

    // ★ The active-gap requirement universe. `needs` already comes from the shared Step 2-A
    //   resolver; each gap carries its own `requirementRefs` verbatim. The plan NEVER decides
    //   what "active" means (it would otherwise reinvent the gap-status predicate).
    const activeRequirementRefs = new Set(needs.flatMap((need) => need.requirementRefs));
    const dimensionByRequirementRef = new Map(needs.map((need) => [need.requirementId, need.dimension]));

    const positionByRef = new Map(positions.map((p) => [p.positionRef, p]));
    const coverageByRef = new Map(coverage.map((c) => [c.positionRef, c]));
    const preparationByTargetRef = new Map(preparations.map((p) => [p.targetRef, p]));

    // ---- targets → view entries (association derived; everything else consumed) ----
    const targetView = (target: ResearchTarget): ResearchPlanTarget => ({
      targetRef: target.targetRef,
      subjectKey: target.subjectKey,
      targetKind: target.targetKind,
      positionRef: target.positionRef,
      isFallback: target.isFallback,
      fallbackForTargetRef: target.fallbackForTargetRef,
      // ★ derived ONLY from the Requirement intersection (§1.4) — never stored, never a new relation
      associationStatus: targetAssociationStatus(target, activeRequirementRefs),
      fit: fits.summarize(target.targetRef),
      preparation: preparationSummary(preparationByTargetRef.get(target.targetRef)),
      requirementLabels: target.relatedRequirementRefs.map((ref) => ({
        ref,
        label: dimensionByRequirementRef.get(ref) ?? ref,
      })),
    });
    const targetViews = new Map(targets.map((t) => [t.targetRef, targetView(t)]));

    // ---- per-gap assembly (positions come from `suggestedPositionRefs` — never recomputed) ----
    const gaps: ResearchPlanGap[] = needs
      .map((need) => {
        const requirementRefs = need.requirementRefs;
        const gapTargets = targets
          .filter((t) => targetBelongsToGap(t, requirementRefs))
          .map((t) => targetViews.get(t.targetRef)!);

        const positionViews: ResearchPlanPosition[] = [];
        for (const positionRef of need.suggestedPositionRefs) {
          const position = positionByRef.get(positionRef);
          const cov = coverageByRef.get(positionRef);
          if (!position || !cov) continue; // defensive: a ref for a position that is not projected
          positionViews.push({
            positionRef: position.positionRef,
            label: position.label,
            kind: position.kind,
            allRequirementRefs: cov.allRequirementRefs, // consumed verbatim (never re-sorted)
            activeRequirementRefs: cov.activeRequirementRefs, // consumed verbatim
            targets: gapTargets
              .filter((tv) => tv.positionRef === position.positionRef)
              .sort(compareTargets),
          });
        }

        return {
          gapId: need.gapId,
          dimension: need.dimension,
          dimensionLabel: dimensionNameByKey.get(need.dimension) ?? need.dimension,
          gapType: need.gapType,
          status: need.status,
          requirementRefs,
          whyStudyNotJustFetch: need.whyStudyNotJustFetch, // passed through verbatim
          priorityScore: need.priorityScore,
          priorityPolicyVersionId: need.priorityPolicyVersionId,
          positions: positionViews,
        };
      })
      .sort(compareGaps);

    // ---- industry-level targets: `unlinked ∪ non_currently_mapped` (never hidden) ----
    const industryTargets = [...targetViews.values()]
      .filter((tv) => tv.associationStatus !== "mapped")
      .sort(compareTargets);

    // ---- state (`null` ⇒ simply absent — never fabricated as 0) + next actions ----
    const planState: ResearchPlanState | null = state
      ? {
          version: state.version,
          known: state.known.length,
          confirmed: state.confirmed.length,
          uncertain: state.uncertain.length,
          conflicting: state.conflicting.length,
          unknown: state.unknown.length,
          keyQuestionCount: state.keyQuestionIds.length,
        }
      : null;

    const nextActions: ResearchPlanNextAction[] = actions
      .map((action) => ({
        actionId: action.actionId,
        gapId: typeof action.params?.gapId === "string" ? action.params.gapId : null,
        kind: action.kind,
        priority: action.priority,
        rationale: action.rationale,
        status: action.status,
      }))
      .sort(compareNextActions);

    return {
      industryRef: industry.industryId,
      industryName: industry.canonicalName,
      state: planState,
      gaps,
      industryTargets,
      nextActions,
    };
  }
}
