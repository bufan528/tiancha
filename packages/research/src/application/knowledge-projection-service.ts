/**
 * KnowledgeProjectionService (Phase 2C Step 2-A).
 *
 * Not a SELECT-claims→INSERT-knowledge aggregator. It really:
 *   find current IndustryKnowledge for subject → match SAME subject + SAME dimension
 *   current beliefs → apply conservative Evolution decision → persist (insert new
 *   belief, flip old belief state, optionally write Conflict) → bump current
 *   projection version.
 *
 * Conservatism (v1, per pre-coding clarification):
 *  - cross-dimension is NEVER auto-judged.
 *  - CONFLICT only on explicit contradiction hint; SUPERSEDE only on explicit
 *    supersedes hint; REVISE only on explicit revise hint. No numeric-range /
 *    caliber / time-window auto-conflict (no Metric Ontology yet).
 *  - without a hint and with a matching current belief → SUPPORT (safe default).
 *  - Claim has NO dimension field: dimension is an explicit required input.
 *
 * Step 2-A deliberately does NOT touch Pool/State; reconcile stubs below throw.
 */

import type { DatabaseSync } from "node:sqlite";
import { KnowledgeRepository } from "../storage/knowledge-repository.js";
import { ResearchRepository } from "../storage/research-repository.js";
import type {
  Claim,
  IndustryKnowledge,
  KnowledgeBelief,
  KnowledgeConflict,
  KnowledgeSubjectKind,
  NextAction,
  PoolSlotStatus,
  ResearchGap,
  StateItemRef,
} from "../domain/index.js";

export type KnowledgeEvolution = "SUPPORT" | "REVISE" | "CONFLICT" | "SUPERSEDE" | "NEW" | "SKIPPED";

export type RelationHint =
  | { kind: "SUPPORT" }
  | { kind: "REVISE" }
  | { kind: "CONFLICT"; note?: string }
  | { kind: "SUPERSEDE"; supersedesClaimRef: string };

export interface ProjectFromClaimInput {
  claim: Claim;
  /** Dimension key (e.g. methodology dimension). Claim carries no dimension. */
  dimension: string;
  topic?: string;
  sourceRef?: string;
  evidenceRef?: string;
  confidence?: number;
  /** Explicit evolution signal; absence + matching belief ⇒ SUPPORT. */
  relationHint?: RelationHint;
}

export interface ProjectResult {
  knowledgeId: string;
  evolution: KnowledgeEvolution;
  beliefId: string;
}

export class KnowledgeProjectionService {
  private readonly knowledge: KnowledgeRepository;
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.knowledge = new KnowledgeRepository(db);
  }

  /** Visible for tests/queries. */
  repository(): KnowledgeRepository {
    return this.knowledge;
  }

  projectFromClaim(input: ProjectFromClaimInput): ProjectResult {
    const { claim, dimension } = input;
    const now = new Date().toISOString();
    const subjectKind = claim.subjectKind as KnowledgeSubjectKind;

    // Placeholder data (Echo) never enters Knowledge: it must not become a
    // confirmed belief that later reconciles as real coverage (Invariant 5).
    if (!claim.isRealExternalData) {
      return { knowledgeId: "", evolution: "SKIPPED", beliefId: "" };
    }

    // 1. current knowledge for this subject (create v1 if absent)
    let knowledge = this.knowledge.findKnowledgeBySubject(subjectKind, claim.subjectId);
    if (!knowledge) {
      knowledge = {
        knowledgeId: "kn-" + claim.subjectId + "-" + now.replace(/[:.]/g, ""),
        subjectKind,
        subjectId: claim.subjectId,
        beliefs: [],
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      this.knowledge.upsertKnowledge(knowledge);
    }

    // 2. same subject + same dimension, non-superseded current beliefs
    const existing = this.knowledge
      .listCurrentBeliefs(knowledge.knowledgeId)
      .filter((b) => b.dimension === dimension);

    // pick the latest matching belief as the relationship anchor
    const anchor = existing[existing.length - 1];

    const evolution = this.decideEvolution(input, anchor);
    const newBelief: KnowledgeBelief = {
      beliefId: "bel-" + claim.claimId + "-" + now.replace(/[:.]/g, ""),
      knowledgeId: knowledge.knowledgeId,
      claimRef: "artifact:claim/" + claim.claimId,
      sourceRef: input.sourceRef,
      evidenceRef: input.evidenceRef,
      dimension,
      topic: input.topic,
      confidence: input.confidence ?? 0.5,
      state: "confirmed",
      historicalRelations: [],
      createdAt: now,
      updatedAt: now,
    };

    switch (evolution) {
      case "SUPERSEDE": {
        if (anchor) {
          this.knowledge.updateBeliefState(anchor.beliefId, "superseded", now);
          newBelief.historicalRelations = [
            { relation: "SUPERSEDE", otherBeliefId: anchor.beliefId, at: now },
          ];
        }
        break;
      }
      case "REVISE": {
        if (anchor) {
          this.knowledge.updateBeliefState(anchor.beliefId, "revised", now);
          newBelief.historicalRelations = [
            { relation: "REVISE", otherBeliefId: anchor.beliefId, at: now },
          ];
        }
        break;
      }
      case "CONFLICT": {
        newBelief.state = "conflicting";
        if (anchor) {
          this.knowledge.updateBeliefState(anchor.beliefId, "conflicting", now);
          newBelief.historicalRelations = [
            { relation: "CONFLICT", otherBeliefId: anchor.beliefId, at: now },
          ];
          const conflict: KnowledgeConflict = {
            conflictId: "kcf-" + claim.claimId + "-" + now.replace(/[:.]/g, ""),
            claimARef: anchor.claimRef,
            claimBRef: newBelief.claimRef,
            dimension,
            status: "open",
            createdAt: now,
          };
          this.knowledge.insertConflict(conflict);
        }
        break;
      }
      case "SUPPORT": {
        if (anchor) {
          newBelief.historicalRelations = [
            { relation: "SUPPORT", otherBeliefId: anchor.beliefId, at: now },
          ];
        }
        break;
      }
      case "NEW":
      default:
        break;
    }

    this.knowledge.insertBelief(newBelief);

    // 5. bump current projection header (version+1, current projection)
    const updated: IndustryKnowledge = {
      ...knowledge,
      version: knowledge.version + (evolution === "NEW" ? 0 : 1),
      beliefs: this.knowledge.listCurrentBeliefs(knowledge.knowledgeId),
      updatedAt: now,
    };
    this.knowledge.upsertKnowledge(updated);

    return { knowledgeId: knowledge.knowledgeId, evolution, beliefId: newBelief.beliefId };
  }

  private decideEvolution(input: ProjectFromClaimInput, anchor?: KnowledgeBelief): KnowledgeEvolution {
    const hint = input.relationHint?.kind;
    if (!anchor) return "NEW";
    if (hint === "SUPERSEDE") return "SUPERSEDE";
    if (hint === "CONFLICT") return "CONFLICT";
    if (hint === "REVISE") return "REVISE";
    // same subject+dimension, no explicit contradiction/supersede → safe SUPPORT
    return "SUPPORT";
  }

  // ---- Step 2-B-1: Knowledge -> InformationPool (one-way) ----
  /**
   * Reconcile the Pool SLOTS against the CURRENT knowledge projection.
   * One-way: Knowledge/Claim/Evidence -> Pool only. Never writes State, Gap,
   * NextAction. Idempotent: recomputed from the current projection.
   *
   * S3: the Pool is Slot + Item, and a slot's identity is (subject, dimension), so
   * we read the slot's own `dimension` directly (no requirement lookup needed).
   *
   * Rules (strict, conservative):
   *  - unknown -> partial when >=1 `confirmed` current belief covers the slot's dimension.
   *  - partial -> sufficient is NEVER auto-upgraded here (insufficient coverage
   *    judgment); we would rather stay partial than over-confirm.
   *  - open KnowledgeConflict on the dimension -> status `conflicting` (both sides kept).
   *  - only `confirmed` current beliefs act as support; revised/superseded do not.
   */
  reconcilePool(subjectId: string, subjectKind: KnowledgeSubjectKind): void {
    const repo = new ResearchRepository(this.db);
    const knowledge = this.knowledge.findKnowledgeBySubject(subjectKind, subjectId);
    const slots = repo.listPoolSlots(subjectId);
    if (slots.length === 0) return;

    // Subject-scoped conflict: an open conflict only counts for THIS subject when
    // one of its claim refs belongs to this subject's knowledge beliefs.
    const subjectClaimRefs = new Set<string>(
      knowledge ? this.knowledge.listBeliefs(knowledge.knowledgeId).map((b) => b.claimRef) : [],
    );
    const openConflicts = this.knowledge
      .listOpenConflicts()
      .filter((c) => subjectClaimRefs.has(c.claimARef) || subjectClaimRefs.has(c.claimBRef));

    const now = new Date().toISOString();
    for (const slot of slots) {
      const dim = slot.dimension;
      const support = (knowledge?.beliefs ?? []).filter(
        (b) => b.state === "confirmed" && b.dimension === dim,
      );
      const hasOpenConflict = openConflicts.some((c) => c.dimension === dim);

      let status: PoolSlotStatus = slot.status;
      if (hasOpenConflict) {
        status = "conflicting";
      } else if (slot.status === "unknown" && support.length > 0) {
        status = "partial";
      }

      // Canonical, sorted claim refs of the current support (idempotent set).
      const claimRefs =
        support.length > 0 ? [...new Set(support.map((b) => b.claimRef))].sort() : [];

      const existingItems = repo.listPoolItems(slot.slotId);
      const itemsSame =
        existingItems.length === claimRefs.length &&
        claimRefs.every((r, i) => existingItems[i]?.claimRef === r);

      if (status !== slot.status) {
        repo.upsertPoolSlot({
          ...slot,
          status,
          coverageJudgement: slotJudgement(status, dim),
          updatedAt: now,
        });
      }
      if (!itemsSame) {
        repo.replacePoolItems(
          slot.slotId,
          claimRefs.map((ref, i) => ({
            itemId: `item-${slot.slotId}-${i}`,
            slotId: slot.slotId,
            valueText: ref,
            claimRef: ref,
            relation: "consistent" as const,
            createdAt: now,
          })),
        );
      }
    }
  }

  /**
   * Pool -> ResearchState (one-way projection). Input to classification is the
   * CURRENT InformationPool projection; we do NOT map Knowledge directly to State.
   * Never writes Pool/Knowledge/Claim/Evidence. Existing researchGapIds /
   * nextActionIds / keyQuestionIds are READ and preserved (never created/deleted here).
   * Idempotent: same Pool + same existing ids -> same State projection, version+1.
   */
  refreshState(subjectId: string, subjectKind: KnowledgeSubjectKind): void {
    const repo = new ResearchRepository(this.db);
    const slots = repo.listPoolSlots(subjectId);
    const prev = repo.getStateBySubject(subjectKind, subjectId);
    const now = new Date().toISOString();

    const known: StateItemRef[] = [];
    const confirmed: StateItemRef[] = [];
    const uncertain: StateItemRef[] = [];
    const conflicting: StateItemRef[] = [];
    const unknown: StateItemRef[] = [];

    for (const s of slots) {
      const ref: StateItemRef = { ref: s.slotId };
      switch (s.status) {
        case "sufficient":
          confirmed.push(ref);
          known.push(ref);
          break;
        case "partial":
          known.push(ref);
          uncertain.push(ref);
          break;
        case "conflicting":
          conflicting.push(ref);
          break;
        case "unknown":
        default:
          unknown.push(ref);
          break;
      }
    }

    repo.upsertState({
      stateId: prev?.stateId ?? `state-${subjectKind}-${subjectId}`,
      subjectKind,
      subjectId,
      known,
      confirmed,
      uncertain,
      conflicting,
      unknown,
      // carry over existing auxiliary ids; never create/delete here
      keyQuestionIds: prev?.keyQuestionIds ?? [],
      researchGapIds: prev?.researchGapIds ?? [],
      nextActionIds: prev?.nextActionIds ?? [],
      version: (prev?.version ?? 0) + 1,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    });
  }

  /**
   * Gap evaluation centered on InformationRequirement (not every unknown entry).
   * One-way: reads Pool/Requirement/Question; writes only ResearchGap. Never touches
   * Pool/Knowledge/State/Claim/Evidence. Idempotent: stable gapId = `gap-<requirementId>`.
   *
   * Rules (A-E, conservative; importance >= 2 is "high"):
   *  - A: high + Pool unknown (req still open)      -> open Gap
   *  - B: low  + unknown                            -> no Gap
   *  - C: high + Pool partial (partial != sufficient) -> open Gap
   *  - D: confirmed / requirement met                -> close active Gap (open/mitigating -> resolved), row kept
   *  - E: high + Pool conflict                      -> open Gap ("unresolved disagreement"), never auto-resolved
   */
  refreshGaps(subjectId: string, subjectKind: KnowledgeSubjectKind): void {
    const repo = new ResearchRepository(this.db);
    const reqs = repo.listRequirements(subjectId);
    if (reqs.length === 0) return;
    const slots = repo.listPoolSlots(subjectId);
    const now = new Date().toISOString();

    const activeByReq = new Map<string, ResearchGap>();
    for (const g of repo.listGaps(subjectId)) {
      if (g.status === "open" || g.status === "mitigating") {
        for (const rid of g.relatedRequirementIds) activeByReq.set(rid, g);
      }
    }

    for (const req of reqs) {
      const slot = slots.find((s) => s.dimension === req.dimension);
      const poolStatus = slot?.status ?? "unknown";
      const isHigh = req.importance >= 2;

      const need =
        poolStatus === "sufficient" || req.status === "met"
          ? false
          : poolStatus === "conflicting"
            ? isHigh
            : poolStatus === "partial"
              ? isHigh
              : isHigh;

      const uncertainty =
        poolStatus === "unknown" ? 0.9 : poolStatus === "partial" ? 0.6 : poolStatus === "conflicting" ? 0.8 : 0.1;

      if (need) {
        const existing = activeByReq.get(req.requirementId);
        repo.upsertGap({
          gapId: existing?.gapId ?? `gap-${req.requirementId}`,
          subjectKind,
          subjectId,
          description: `[${req.dimension}] ${req.description}`,
          importance: req.importance,
          uncertainty,
          relatedRequirementIds: [req.requirementId],
          relatedQuestionIds: [req.questionId],
          status: "open",
          discoveredAt: existing?.discoveredAt ?? now,
          updatedAt: now,
        });
      } else {
        const active = activeByReq.get(req.requirementId);
        if (active) repo.upsertGap({ ...active, status: "resolved", updatedAt: now });
      }
    }
  }

  /**
   * Gap -> NextAction refresh. One-way: reads Gap, writes only NextAction.
   * Idempotent: stable actionId = `act-<gapId>`; a gap with an existing open
   * action is not duplicated; actions whose gap is no longer active are cancelled.
   */
  refreshNextActions(subjectId: string, subjectKind: KnowledgeSubjectKind): void {
    const repo = new ResearchRepository(this.db);
    const gaps = repo
      .listGaps(subjectId)
      .filter((g) => g.status === "open" || g.status === "mitigating");
    const existing = repo.listNextActions(subjectId);
    const now = new Date().toISOString();

    const byGap = new Map<string, NextAction>();
    for (const a of existing) {
      const gapId = a.params?.gapId;
      if (typeof gapId === "string") byGap.set(gapId, a);
    }
    const activeGapIds = new Set(gaps.map((g) => g.gapId));

    for (const gap of gaps) {
      const existingAction = byGap.get(gap.gapId);
      if (existingAction && existingAction.status === "open") continue;
      repo.upsertNextAction({
        actionId: existingAction?.actionId ?? `act-${gap.gapId}`,
        subjectKind,
        subjectId,
        kind: "retrieve_data",
        params: { gapId: gap.gapId },
        dependsOn: [],
        priority: 0,
        rationale: "信息缺失，需补全",
        status: "open",
        createdBy: "planner",
        createdAt: existingAction?.createdAt ?? now,
        updatedAt: now,
      });
    }

    for (const a of existing) {
      const gapId = a.params?.gapId;
      if (typeof gapId === "string" && !activeGapIds.has(gapId) && a.status === "open") {
        repo.upsertNextAction({ ...a, status: "cancelled", updatedAt: now });
      }
    }
  }

  /**
   * Full one-way refresh for a subject: Knowledge -> Pool -> Gaps -> NextActions -> State.
   * Single entry point for ingest and claim backfill. Idempotent. keyQuestionIds are
   * preserved (created by the caller, e.g. ingest); gap/nextAction ids are synced here.
   */
  refreshSubject(subjectId: string, subjectKind: KnowledgeSubjectKind): void {
    this.reconcilePool(subjectId, subjectKind);
    this.refreshGaps(subjectId, subjectKind);
    this.refreshNextActions(subjectId, subjectKind);
    this.refreshState(subjectId, subjectKind);

    const repo = new ResearchRepository(this.db);
    const prev = repo.getStateBySubject(subjectKind, subjectId);
    if (!prev) return;
    const gaps = repo
      .listGaps(subjectId)
      .filter((g) => g.status === "open" || g.status === "mitigating");
    const actions = repo.listNextActions(subjectId).filter((a) => a.status === "open");
    repo.upsertState({
      ...prev,
      researchGapIds: gaps.map((g) => g.gapId),
      nextActionIds: actions.map((a) => a.actionId),
      updatedAt: new Date().toISOString(),
    });
  }
}

/** S3: human-readable coverage judgement for a pool slot status. */
function slotJudgement(status: PoolSlotStatus, dimension: string): string {
  switch (status) {
    case "sufficient":
      return `${dimension}: 证据满足确认条件`;
    case "partial":
      return `${dimension}: 部分掌握（尚未满足确认条件）`;
    case "conflicting":
      return `${dimension}: 存在未解冲突`;
    default:
      return `${dimension}: 尚无信息`;
  }
}
