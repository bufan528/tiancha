/**
 * KnowledgeProjectionService — Phase 2C Step 2-A, aligned to the **Phase C Final Lock**
 * semantics by C1 (*Knowledge Projection Semantic Alignment*).
 *
 * What C1 changed here (see docs/phaseC/implementation-contract.md):
 *  - **one current predicate**: current ≡ `state === "confirmed"` (C-FIX-12 / P5);
 *  - **deterministic identity** + **exact no-op** for an already-projected claim (P6 / C-FIX-11);
 *  - **explicit, validated evolution target** for REVISE / SUPERSEDE (C-FIX-8),
 *    and a target may be `confirmed` **or** `conflicting` (C-FIX-13);
 *  - **dimension-level CONFLICT** with only the DIRECT pair recorded (C-FIX-1);
 *  - **open conflict is never bypassed** by an ordinary NEW / SUPPORT (C-FIX-7);
 *  - `candidate` / `rejected` lifecycle + human confirmation (P3 / C-FIX-3 / C-FIX-9).
 *
 * Decision order (contract §5) — every failing step must be ZERO mutation:
 *   ⓪ placeholder data never enters Knowledge (Invariant 13)
 *   ① already projected  → SKIPPED / ALREADY_PROJECTED (exact no-op)
 *   ② evolution target   → SKIPPED / INVALID_EVOLUTION_TARGET
 *   ③ open conflict      → candidate, or SKIPPED / OPEN_CONFLICT_REQUIRES_REVIEW
 *   ④ ordinary rule      → NEW / SUPPORT (deterministic default)
 *   ⑤ write              → insert belief (+ conflict), bump the current projection
 *
 * Deliberately unchanged (C1 red line): `reconcilePool` / `refreshGaps` /
 * `refreshNextActions` / `refreshState` business rules — C1 only changes the knowledge
 * decision that FEEDS that chain, and proves the chain still behaves.
 */

import type { DatabaseSync } from "node:sqlite";
import { KnowledgeRepository } from "../storage/knowledge-repository.js";
import { ResearchRepository } from "../storage/research-repository.js";
import {
  beliefIdFor,
  canonicalClaimPair,
  conflictIdFor,
  isCurrentBelief,
  isEvolvableBeliefState,
} from "../domain/index.js";
import { isSufficient, sufficiencyFacts, sufficiencyPolicies, type SufficiencyPolicy } from "../domain/sufficiency.js";
import { PriorityService } from "./priority-service.js";
import type {
  Claim,
  GapType,
  IndustryKnowledge,
  InformationRequirement,
  KnowledgeBelief,
  KnowledgeBeliefState,
  KnowledgeConflict,
  KnowledgeSubjectKind,
  NextAction,
  PoolItemRelation,
  PoolSlotStatus,
  ResearchGap,
  StateItemRef,
} from "../domain/index.js";

/**
 * The typed outcome of one projection (contract §4): four real Evolution relations plus two
 * structural ones — `NEW` (first belief of a dimension) and `SKIPPED` (nothing was written).
 * C1 deliberately adds NO new outcome value (C-FIX-11).
 */
export type KnowledgeEvolution = "SUPPORT" | "REVISE" | "CONFLICT" | "SUPERSEDE" | "NEW" | "SKIPPED";

/** `ProjectionOutcome` is the same closed set (contract §4); kept as an alias for clarity. */
export type ProjectionOutcome = KnowledgeEvolution;

/** Closed set of machine-readable reasons (contract §20). Never free-form prose. */
export type SkippedReason =
  | "ALREADY_PROJECTED"
  | "INVALID_EVOLUTION_TARGET"
  | "OPEN_CONFLICT_REQUIRES_REVIEW"
  | "CANDIDATE_REQUIRES_CONFIRMATION"
  | "PLACEHOLDER_DATA"
  | "INVALID_RELATION";

export type RelationHint =
  | { kind: "SUPPORT" }
  /**
   * C1: a REVISE must name the belief it revises. Without `revisesClaimRef` the projection is
   * SKIPPED (INVALID_EVOLUTION_TARGET) — never "guess the latest anchor" (C-FIX-8).
   */
  | { kind: "REVISE"; revisesClaimRef?: string }
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
  /** Explicit evolution signal; absence + matching belief ⇒ SUPPORT (deterministic rule). */
  relationHint?: RelationHint;
  /**
   * Caller-side Human Gate request (contract §7.2: "the system may PROPOSE a candidate").
   * The projection then writes a `candidate` instead of `confirmed` — it never confirms itself.
   */
  requiresHumanGate?: boolean;
}

export interface ProjectResult {
  knowledgeId: string;
  /** Backward-compatible alias of `outcome`. */
  evolution: KnowledgeEvolution;
  outcome: ProjectionOutcome;
  /** Empty when nothing was written (`SKIPPED`). */
  beliefId: string;
  claimRef: string;
  /** Old beliefs whose state was flipped by this projection (anchor / propagated / target). */
  affectedBeliefRefs: string[];
  /** Set when a `KnowledgeConflict` row was created. */
  conflictRef?: string;
  /** True when the written belief is a `candidate` awaiting human confirmation. */
  requiresHumanGate: boolean;
  reason?: SkippedReason;
}

/**
 * Result of an explicit **HUMAN Gate** action (confirm / reject a candidate).
 * Deliberately NOT a `ProjectionOutcome`: confirming a candidate is not a projection
 * and must never be reachable by re-projecting the same claim (C-FIX-3).
 */
export interface CandidateDecisionResult {
  knowledgeId: string;
  beliefId: string;
  state: KnowledgeBeliefState;
  /** Beliefs whose lifecycle this decision changed (e.g. the REVISE / SUPERSEDE target). */
  affectedBeliefRefs: string[];
}

/** The relations a human may choose when confirming a candidate (contract §7.4). */
export type ConfirmRelation = "NEW" | "SUPPORT" | "REVISE" | "SUPERSEDE";

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

  /**
   * Project ONE claim into this subject's knowledge (contract §5 decision order).
   *
   *  ⓪ placeholder data never enters Knowledge (Invariant 13);
   *  ① an already-projected `(knowledgeId, claimRef)` is an EXACT no-op, in every state;
   *  ② REVISE / SUPERSEDE must name a legal target (`confirmed` or `conflicting`);
   *  ③ an open conflict on the dimension is never bypassed by an ordinary NEW / SUPPORT;
   *  ④ otherwise the deterministic rule applies (no relation + anchor ⇒ SUPPORT);
   *  ⑤ only now do we write — every path above is zero-mutation.
   */
  projectFromClaim(input: ProjectFromClaimInput): ProjectResult {
    const { claim, dimension } = input;
    const now = new Date().toISOString();
    const subjectKind = claim.subjectKind as KnowledgeSubjectKind;
    const claimRef = normalizeClaimRef(claim.claimId);

    const skip = (knowledgeId: string, reason: SkippedReason): ProjectResult => ({
      knowledgeId,
      evolution: "SKIPPED",
      outcome: "SKIPPED",
      beliefId: "",
      claimRef,
      affectedBeliefRefs: [],
      requiresHumanGate: false,
      reason,
    });

    // ⓪ Placeholder data (Echo) never enters Knowledge (Invariant 13).
    if (!claim.isRealExternalData) return skip("", "PLACEHOLDER_DATA");

    // Read-only lookup: the header is written ONLY in step ⑤, so every skip stays zero-mutation.
    const existingKnowledge = this.knowledge.findKnowledgeBySubject(subjectKind, claim.subjectId);
    const knowledgeId = existingKnowledge?.knowledgeId ?? "";

    // ① Already projected ⇒ exact no-op in EVERY state (C-FIX-11).
    if (existingKnowledge && this.knowledge.findBeliefByKnowledgeAndClaim(knowledgeId, claimRef)) {
      return skip(knowledgeId, "ALREADY_PROJECTED");
    }

    const dimensionBeliefs = existingKnowledge
      ? this.knowledge.listBeliefsByDimension(knowledgeId, dimension)
      : [];
    const confirmedOnDimension = dimensionBeliefs.filter((b) => isCurrentBelief(b.state));
    const latestConfirmed = confirmedOnDimension[confirmedOnDimension.length - 1];

    // ② Evolution target validation (C-FIX-8 + C-FIX-13). A dimension-level CONFLICT moves
    //    every confirmed belief to `conflicting`, so `conflicting` MUST be a legal target —
    //    otherwise "explicit evolution is the legal way out of a conflict" is unreachable.
    const hint = input.relationHint;
    let target: KnowledgeBelief | undefined;
    if (hint?.kind === "REVISE" || hint?.kind === "SUPERSEDE") {
      const targetRef = hint.kind === "SUPERSEDE" ? hint.supersedesClaimRef : hint.revisesClaimRef;
      target = targetRef
        ? this.knowledge.findBeliefByKnowledgeAndClaim(knowledgeId, normalizeClaimRef(targetRef))
        : undefined;
      if (!target || target.dimension !== dimension || !isEvolvableBeliefState(target.state)) {
        return skip(knowledgeId, "INVALID_EVOLUTION_TARGET");
      }
    }

    // ③ An open conflict on this dimension must not be bypassed (C-FIX-7): an ordinary
    //    NEW / SUPPORT becomes a CANDIDATE (or is skipped), never an auto-confirmed belief.
    const explicitEvolution = hint?.kind === "REVISE" || hint?.kind === "SUPERSEDE";
    const openConflicts = this.openConflictsForDimension(existingKnowledge, dimension);
    const canBuildCandidate = claim.statement.trim().length > 0 && dimension.trim().length > 0;
    const blockedByOpenConflict = openConflicts.length > 0 && !explicitEvolution;
    // A SECOND conflict is NOT executed while one is already open: writing it would mutate the
    // dimension's cognition (every confirmed belief leaves current + a new conflict pair) BEFORE
    // any human confirmation. The contract defines no lifecycle for "conflict on top of an open
    // conflict", so C1 SKIPS it rather than inventing one — zero mutation (C-FIX-7 / §6.4).
    if (blockedByOpenConflict && hint?.kind === "CONFLICT") {
      return skip(knowledgeId, "OPEN_CONFLICT_REQUIRES_REVIEW");
    }
    if (blockedByOpenConflict && !canBuildCandidate) {
      return skip(knowledgeId, "OPEN_CONFLICT_REQUIRES_REVIEW");
    }

    // ④ Ordinary rule (deterministic). CONFLICT needs a current cognition to be in conflict
    //    with; without one there is nothing to record, so the projection is skipped.
    let outcome: KnowledgeEvolution;
    let anchor: KnowledgeBelief | undefined;
    switch (hint?.kind) {
      case "SUPERSEDE":
      case "REVISE":
        outcome = hint.kind;
        anchor = target;
        break;
      case "CONFLICT":
        if (!latestConfirmed) return skip(knowledgeId, "INVALID_EVOLUTION_TARGET");
        outcome = "CONFLICT";
        anchor = latestConfirmed;
        break;
      case "SUPPORT":
      default:
        outcome = latestConfirmed ? "SUPPORT" : "NEW";
        anchor = latestConfirmed;
        break;
    }

    // ⑤ Write.
    const knowledge: IndustryKnowledge = existingKnowledge ?? {
      // Deterministic header identity: one knowledge row per subject, never a timestamped twin.
      knowledgeId: "kn-" + claim.subjectId,
      subjectKind,
      subjectId: claim.subjectId,
      beliefs: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const newBelief: KnowledgeBelief = {
      beliefId: beliefIdFor(knowledge.knowledgeId, claimRef),
      knowledgeId: knowledge.knowledgeId,
      claimRef,
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

    const affectedBeliefRefs: string[] = [];
    let conflictRef: string | undefined;

    switch (outcome) {
      case "SUPERSEDE":
      case "REVISE": {
        const targetState: KnowledgeBeliefState = outcome === "SUPERSEDE" ? "superseded" : "revised";
        if (anchor) {
          this.knowledge.updateBeliefState(anchor.beliefId, targetState, now);
          newBelief.historicalRelations = [{ relation: outcome, otherBeliefId: anchor.beliefId, at: now }];
          affectedBeliefRefs.push(anchor.beliefId);
        }
        break;
      }
      case "CONFLICT": {
        // Dimension-level (C-FIX-1): EVERY current confirmed belief of this dimension leaves
        // current; only the DIRECT pair gets a KnowledgeConflict row (no fake B↔D edges):
        // state propagation ≠ relation graph.
        newBelief.state = "conflicting";
        if (anchor) {
          newBelief.historicalRelations = [{ relation: "CONFLICT", otherBeliefId: anchor.beliefId, at: now }];
        }
        for (const belief of confirmedOnDimension) {
          this.knowledge.updateBeliefState(belief.beliefId, "conflicting", now);
          affectedBeliefRefs.push(belief.beliefId);
        }
        if (anchor) {
          const [claimARef, claimBRef] = canonicalClaimPair(anchor.claimRef, claimRef);
          const conflictId = conflictIdFor(dimension, anchor.claimRef, claimRef);
          const created = this.knowledge.insertConflictIfAbsent({
            conflictId,
            claimARef,
            claimBRef,
            dimension,
            status: "open",
            createdAt: now,
          });
          if (created) conflictRef = conflictId;
        }
        break;
      }
      case "SUPPORT":
        if (anchor) {
          newBelief.historicalRelations = [{ relation: "SUPPORT", otherBeliefId: anchor.beliefId, at: now }];
        }
        break;
      case "NEW":
      default:
        break;
    }

    // Human Gate (contract §7): the projection may PROPOSE a candidate — it never confirms one.
    let requiresHumanGate = false;
    let reason: SkippedReason | undefined;
    if (blockedByOpenConflict) {
      newBelief.state = "candidate";
      requiresHumanGate = true;
      reason = "OPEN_CONFLICT_REQUIRES_REVIEW";
    } else if (input.requiresHumanGate === true) {
      newBelief.state = "candidate";
      requiresHumanGate = true;
      reason = "CANDIDATE_REQUIRES_CONFIRMATION";
    }
    // A candidate is NOT yet part of current cognition, so it carries no evolution edge:
    // the edge is written when a human confirms it with an explicit relation (§7.3–§7.4).
    if (requiresHumanGate) newBelief.historicalRelations = [];

    this.knowledge.insertBelief(newBelief);

    // Bump the CURRENT projection header (history lives in the belief rows).
    this.knowledge.upsertKnowledge({
      ...knowledge,
      version: knowledge.version + (outcome === "NEW" ? 0 : 1),
      beliefs: this.knowledge.listCurrentBeliefs(knowledge.knowledgeId),
      updatedAt: now,
    });

    return {
      knowledgeId: knowledge.knowledgeId,
      evolution: outcome,
      outcome,
      beliefId: newBelief.beliefId,
      claimRef,
      affectedBeliefRefs,
      conflictRef,
      requiresHumanGate,
      reason,
    };
  }

  /**
   * Confirm a candidate (C-FIX-3 / C-FIX-4 / §7.3–§7.4) — an **independent human transition**.
   * It is never reachable by re-projecting the same claim (that stays an exact no-op).
   * The final relation is chosen EXPLICITLY by the human; `CONFLICT` is not a valid choice.
   */
  confirmCandidate(
    beliefId: string,
    relation: ConfirmRelation,
    targetClaimRef?: string,
  ): CandidateDecisionResult {
    const now = new Date().toISOString();
    const belief = this.knowledge.getBelief(beliefId);
    if (!belief) throw new Error(`unknown belief '${beliefId}'`);
    if (belief.state !== "candidate") {
      throw new Error(`belief '${beliefId}' is not a candidate (state=${belief.state})`);
    }

    // C-FIX-7 applies to the HUMAN path as well: while the dimension still has an open
    // conflict, an ordinary NEW / SUPPORT must not promote cognition back to current — that
    // is exactly the bypass §6.4 forbids (it would silently revive the dimension). The legal
    // way out is an explicit REVISE / SUPERSEDE (§6.7). Nothing is auto-resolved here.
    if (relation === "NEW" || relation === "SUPPORT") {
      const openConflicts = this.openConflictsForDimension(
        this.knowledge.getKnowledge(belief.knowledgeId),
        belief.dimension,
      );
      if (openConflicts.length > 0) {
        throw new Error(
          `confirmCandidate: dimension '${belief.dimension}' still has an open conflict — ` +
            `confirm with an explicit REVISE / SUPERSEDE instead of ${relation}`,
        );
      }
    }

    const affectedBeliefRefs: string[] = [];
    if (relation === "REVISE" || relation === "SUPERSEDE") {
      const target = targetClaimRef
        ? this.knowledge.findBeliefByKnowledgeAndClaim(belief.knowledgeId, normalizeClaimRef(targetClaimRef))
        : undefined;
      if (!target || target.dimension !== belief.dimension || !isEvolvableBeliefState(target.state)) {
        throw new Error(`confirmCandidate: invalid ${relation} target '${targetClaimRef ?? ""}'`);
      }
      const targetState: KnowledgeBeliefState = relation === "SUPERSEDE" ? "superseded" : "revised";
      this.knowledge.updateBeliefState(target.beliefId, targetState, now);
      this.knowledge.appendBeliefRelation(beliefId, { relation, otherBeliefId: target.beliefId, at: now });
      affectedBeliefRefs.push(target.beliefId);
    }

    this.knowledge.updateBeliefState(beliefId, "confirmed", now);
    // The CURRENT cognition changed ⇒ the current projection header must move with it
    // (same rule as `projectFromClaim` step ⑤).
    this.bumpCurrentProjection(belief.knowledgeId, now);
    return { knowledgeId: belief.knowledgeId, beliefId, state: "confirmed", affectedBeliefRefs };
  }

  /**
   * Re-write the CURRENT projection header after a human decision.
   * `beliefs[]` is always DERIVED (`findKnowledgeBySubject` fills it from `knowledge_belief`),
   * so only `version` / `updatedAt` really change here.
   */
  private bumpCurrentProjection(knowledgeId: string, now: string): void {
    const knowledge = this.knowledge.getKnowledge(knowledgeId);
    if (!knowledge) return;
    this.knowledge.upsertKnowledge({
      ...knowledge,
      version: knowledge.version + 1,
      beliefs: this.knowledge.listCurrentBeliefs(knowledgeId),
      updatedAt: now,
    });
  }

  /**
   * Reject a candidate (C-FIX-9) — a terminal human decision that is **neither current nor
   * historical fact**: a rejected candidate never becomes current cognition.
   */
  rejectCandidate(beliefId: string): CandidateDecisionResult {
    const now = new Date().toISOString();
    const belief = this.knowledge.getBelief(beliefId);
    if (!belief) throw new Error(`unknown belief '${beliefId}'`);
    if (belief.state !== "candidate") {
      throw new Error(`belief '${beliefId}' is not a candidate (state=${belief.state})`);
    }
    this.knowledge.updateBeliefState(beliefId, "rejected", now);
    return { knowledgeId: belief.knowledgeId, beliefId, state: "rejected", affectedBeliefRefs: [] };
  }

  /**
   * Close a conflict EVENT (C-FIX-10): `open → resolved` only.
   * It never touches belief state — "we have dealt with this disagreement" is NOT
   * "the system now knows which side is true".
   */
  resolveConflictEvent(conflictId: string): KnowledgeConflict {
    const now = new Date().toISOString();
    const conflict = this.knowledge.getConflict(conflictId);
    if (!conflict) throw new Error(`unknown conflict '${conflictId}'`);
    if (conflict.status !== "open") throw new Error(`conflict '${conflictId}' is not open`);
    this.knowledge.resolveConflict(conflictId, "resolved", now);
    return { ...conflict, status: "resolved", resolvedAt: now };
  }

  /** Open conflicts of this dimension belonging to THIS subject's knowledge (unchanged scoping). */
  private openConflictsForDimension(
    knowledge: IndustryKnowledge | undefined,
    dimension: string,
  ): KnowledgeConflict[] {
    if (!knowledge) return [];
    const claimRefs = new Set(this.knowledge.listBeliefs(knowledge.knowledgeId).map((b) => b.claimRef));
    return this.knowledge
      .listOpenConflictsByDimension(dimension)
      .filter((c) => claimRefs.has(c.claimARef) || claimRefs.has(c.claimBRef));
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
   * Rules (S4.5-R1 — judged with the SufficiencyPolicy the slot's REQUIREMENT names,
   * resolved through PolicyRegistry; never a hard-coded version):
   *  - no beliefs on the dimension             -> `unknown`
   *  - beliefs present, policy NOT satisfied   -> `partial`
   *  - beliefs present, policy satisfied       -> `sufficient`  (REACHABLE)
   *  - no requirement for the dimension        -> cannot judge `sufficient` (stays partial)
   *  - requirement ref missing / unknown       -> THROW (never a silent fallback)
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

    // S4.5-R1: each slot judges with the policy ITS OWN requirement references
    // (same subject + dimension), resolved through the immutable PolicyRegistry —
    // the same rule semantics the Evaluation side uses. No hard-coded version here.
    const requirementByDimension = new Map(repo.listRequirements(subjectId).map((r) => [r.dimension, r]));

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

      // S4.5-R1: judge with the policy the requirement NAMES (not a constant) —
      // so a methodology that pins `suf-v2` is honoured by the Pool AND Evaluation
      // alike. Only `confirmed` current beliefs count as support; revised/superseded
      // history is indexed as items but NEVER satisfies the policy on its own.
      const policy = resolveSufficiencyPolicy(requirementByDimension.get(dim));
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
            : policy !== undefined && isSufficient(facts, policy)
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
   * Gap -> NextAction refresh (S5). One-way: reads Gap + Priority, writes only NextAction.
   * Idempotent: stable actionId = `act-<gapId>`; a gap with an existing open action is not
   * duplicated; actions whose gap is no longer active are cancelled.
   *
   * S5 split (red line 8):
   *   - PriorityService decides the ORDER and the numeric priority (score 0..100).
   *   - The GAP state decides the ACTION KIND (policy's gap-type map) — NOT the cost.
   *   - The full factor breakdown is stored in params so the ranking is auditable.
   * Values are rewritten whenever they change, so the ranking never goes stale; a
   * no-change refresh writes nothing (deterministic: same state -> same values).
   */
  refreshNextActions(subjectId: string, subjectKind: KnowledgeSubjectKind): void {
    const repo = new ResearchRepository(this.db);
    const gaps = repo
      .listGaps(subjectId)
      .filter((g) => g.status === "open" || g.status === "mitigating");
    const existing = repo.listNextActions(subjectId);
    const now = new Date().toISOString();
    const priorityService = new PriorityService(this.db);
    const ranked = new Map(priorityService.rank(subjectId, subjectKind).map((p) => [p.gapId, p]));

    const byGap = new Map<string, NextAction>();
    for (const a of existing) {
      const gapId = a.params?.gapId;
      if (typeof gapId === "string") byGap.set(gapId, a);
    }
    const activeGapIds = new Set(gaps.map((g) => g.gapId));

    for (const gap of gaps) {
      const existingAction = byGap.get(gap.gapId);
      const p = ranked.get(gap.gapId);
      const score = p?.score ?? 0;
      const kind = priorityService.actionKindFor(gap.gapType);

      if (
        existingAction &&
        existingAction.status === "open" &&
        existingAction.priority === score &&
        existingAction.kind === kind
      ) {
        continue; // nothing changed -> do not churn the row
      }

      repo.upsertNextAction({
        actionId: existingAction?.actionId ?? `act-${gap.gapId}`,
        subjectKind,
        subjectId,
        kind,
        params: {
          gapId: gap.gapId,
          gapType: gap.gapType,
          // S5 traceability: why this action sits where it does.
          priorityBreakdown: p?.factors,
          priorityPolicyVersionId: p?.policyVersionId,
        },
        dependsOn: [],
        priority: score,
        rationale: p?.rationale ?? "信息缺失，需补全",
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

/** The one artifact claim ref shape used across Knowledge/Pool. */
export const CLAIM_REF_PREFIX = "artifact:claim/";

/**
 * Accept EITHER a bare claimId or a full `artifact:claim/<id>` ref.
 * Material authors write both forms; normalising here keeps "the evolution target must
 * actually exist" strict without being pedantic about spelling.
 */
export function normalizeClaimRef(ref: string): string {
  return ref.startsWith(CLAIM_REF_PREFIX) ? ref : CLAIM_REF_PREFIX + ref;
}

/**
 * S4.5-R1: resolve the sufficiency policy the Pool must judge with, from the
 * Requirement's `sufficiencyPolicyRef`. NEVER a hard-coded version:
 *   - no requirement         -> undefined (nothing to judge against; the slot can
 *                               only reach `partial`, never `sufficient`)
 *   - ref missing / unknown  -> THROW (silently falling back to a default would make
 *                               the recorded provenance a lie)
 */
function resolveSufficiencyPolicy(req?: InformationRequirement): SufficiencyPolicy | undefined {
  if (!req) return undefined;
  const ref = req.sufficiencyPolicyRef;
  if (!ref) {
    throw new Error(`requirement ${req.requirementId} has no sufficiencyPolicyRef (S4.5-R1)`);
  }
  const policy = sufficiencyPolicies.get(ref);
  if (!policy) {
    throw new Error(
      `unknown sufficiency policy version '${ref}' referenced by requirement ${req.requirementId}`,
    );
  }
  return policy;
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
