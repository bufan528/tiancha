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
import { SUFFICIENCY_POLICY_V1, isSufficient, sufficiencyFacts } from "../domain/sufficiency.js";
import type {
  Claim,
  GapType,
  IndustryKnowledge,
  InformationRequirement,
  KnowledgeBelief,
  KnowledgeConflict,
  KnowledgeSubjectKind,
  NextAction,
  PoolItemRelation,
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
   * Rules (S4.5 — judged with the SHARED SufficiencyPolicy over the slot's items):
   *  - no beliefs on the dimension             -> `unknown`
   *  - beliefs present, policy NOT satisfied   -> `partial`
   *  - beliefs present, policy satisfied       -> `sufficient`  (now REACHABLE)
   *  - open KnowledgeConflict on the dimension -> `conflicting` (both sides kept)
   *  - conflicts clearing lets the slot fall back (NOT sticky).
   *  - only `confirmed` current beliefs are the scored support; revised/superseded
   *    are still indexed as items so history is never dropped.
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
      // ALL beliefs on this dimension (not just confirmed): a slot indexes the claims we
      // know about, so conflicting / revised history is kept, never silently dropped.
      const beliefsForDim = (knowledge ? this.knowledge.listBeliefs(knowledge.knowledgeId) : []).filter(
        (b) => b.dimension === dim,
      );
      const conflictsForDim = openConflicts.filter((c) => c.dimension === dim);

      // Items FIRST: PRESERVE history — upsert the claims we know about, NEVER
      // wholesale-delete. An unresolved disagreement is expressed as `contradicts`
      // (both sides kept) rather than dropping a side. Idempotent: same claim ->
      // same item id; write only on change.
      const existingById = new Map(repo.listPoolItems(slot.slotId).map((it) => [it.itemId, it]));
      for (const b of beliefsForDim) {
        const claimRef = b.claimRef;
        const itemId = poolItemId(slot.slotId, claimRef);
        const inConflict =
          b.state === "conflicting" ||
          conflictsForDim.some((c) => c.claimARef === claimRef || c.claimBRef === claimRef);
        const relation: PoolItemRelation = inConflict ? "contradicts" : "consistent";
        const prev = existingById.get(itemId);
        if (!prev || prev.relation !== relation) {
          repo.upsertPoolItem({
            itemId,
            slotId: slot.slotId,
            valueText: claimRef,
            claimRef,
            relation,
            createdAt: prev?.createdAt ?? now,
          });
        }
      }

      // S4.5: judge the slot status from the items we NOW hold, with the SHARED
      // sufficiency policy — so `sufficient` is reachable and `conflicting` recovers
      // (07 §7: unknown → partial → sufficient, or conflicting ⇄ partial).
      // Only `confirmed` current beliefs count as support; revised/superseded history
      // is indexed as items but NEVER satisfies the policy on its own.
      const confirmedClaimRefs = new Set(
        beliefsForDim.filter((b) => b.state === "confirmed").map((b) => b.claimRef),
      );
      const confirmingItems = repo.listPoolItems(slot.slotId).filter((it) => confirmedClaimRefs.has(it.claimRef));
      const facts = sufficiencyFacts(confirmingItems);
      const status: PoolSlotStatus =
        conflictsForDim.length > 0
          ? "conflicting"
          : confirmedClaimRefs.size === 0
            ? "unknown"
            : isSufficient(facts, SUFFICIENCY_POLICY_V1)
              ? "sufficient"
              : "partial";

      if (status !== slot.status) {
        repo.upsertPoolSlot({
          ...slot,
          status,
          coverageJudgement: slotJudgement(status, dim),
          updatedAt: now,
        });
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
   * Gap lifecycle, driven by the PoolSlot status (S4.5 — NOT by an importance magic
   * number). One-way: reads Pool/Requirement; writes only ResearchGap (+ syncs the
   * requirement's own status). Idempotent: stable gapId = `gap-<requirementId>`.
   *
   *   slot unknown      -> open gap, gapType = unknown       (no information at all)
   *   slot partial      -> open gap, gapType = insufficient  (condition not met)
   *   slot conflicting  -> open gap, gapType = conflict      (unresolved; never auto-resolved)
   *   slot sufficient   -> gap resolved (and requirement.status = met)
   *
   * A resolved gap whose slot later degrades RE-OPENS (same gapId, discoveredAt kept).
   * `importance`/`criticality` are written onto the gap as ATTRIBUTES for S5's
   * PriorityService; they no longer decide WHETHER a gap exists.
   */
  refreshGaps(subjectId: string, subjectKind: KnowledgeSubjectKind): void {
    const repo = new ResearchRepository(this.db);
    const reqs = repo.listRequirements(subjectId);
    if (reqs.length === 0) return;
    const slots = repo.listPoolSlots(subjectId);
    const prevById = new Map(repo.listGaps(subjectId).map((g) => [g.gapId, g]));
    const now = new Date().toISOString();

    for (const req of reqs) {
      const slot = slots.find((s) => s.dimension === req.dimension);
      const poolStatus: PoolSlotStatus = slot?.status ?? "unknown";
      const gapId = `gap-${req.requirementId}`;
      const prev = prevById.get(gapId);
      const uncertainty = uncertaintyFor(poolStatus);
      const gapType = gapTypeFor(poolStatus);

      if (gapType === null) {
        // Requirement satisfied: close any active gap; the row is KEPT (history).
        if (prev && (prev.status === "open" || prev.status === "mitigating")) {
          repo.upsertGap({ ...prev, uncertainty, status: "resolved", updatedAt: now });
        }
        syncRequirementStatus(repo, req, "met", now);
        continue;
      }

      // open — including RE-OPEN of a previously resolved gap (same id, same discoveredAt).
      repo.upsertGap({
        gapId,
        subjectKind,
        subjectId,
        description: `[${req.dimension}] ${req.description}`,
        gapType,
        importance: req.importance,
        uncertainty,
        relatedRequirementIds: [req.requirementId],
        relatedQuestionIds: [req.questionId],
        status: "open",
        discoveredAt: prev?.discoveredAt ?? now,
        updatedAt: now,
      });

      syncRequirementStatus(repo, req, poolStatus === "unknown" ? "open" : "partially_met", now);
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

/** S3-R1: deterministic item id per (slot, claim) — stable across reconciles, no timestamps. */
function poolItemId(slotId: string, claimRef: string): string {
  return `item-${slotId}-${claimRef.replace(/[^A-Za-z0-9]+/g, "_")}`;
}

/** S4.5: a slot status maps 1:1 to a gap category. `null` = sufficient = no gap. */
function gapTypeFor(status: PoolSlotStatus): GapType | null {
  switch (status) {
    case "sufficient":
      return null;
    case "conflicting":
      return "conflict";
    case "partial":
      return "insufficient";
    default:
      return "unknown";
  }
}

/** S4.5: how uncertain the pool currently is on this dimension. */
function uncertaintyFor(status: PoolSlotStatus): number {
  switch (status) {
    case "unknown":
      return 0.9;
    case "conflicting":
      return 0.8;
    case "partial":
      return 0.6;
    default:
      return 0.1;
  }
}

/** S4.5: keep requirement.status truthful; write only when it actually changes. */
function syncRequirementStatus(
  repo: ResearchRepository,
  req: InformationRequirement,
  status: InformationRequirement["status"],
  now: string,
): void {
  if (req.status === status) return;
  repo.upsertRequirement({ ...req, status, updatedAt: now });
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
