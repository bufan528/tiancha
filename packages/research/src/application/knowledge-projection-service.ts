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
import type {
  Claim,
  IndustryKnowledge,
  KnowledgeBelief,
  KnowledgeConflict,
  KnowledgeSubjectKind,
} from "../domain/index.js";

export type KnowledgeEvolution = "SUPPORT" | "REVISE" | "CONFLICT" | "SUPERSEDE" | "NEW";

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

  constructor(db: DatabaseSync) {
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

  // ---- Step 2-B placeholders (NOT implemented in 2-A) ----
  reconcilePool(_subjectId: string): void {
    throw new Error("KnowledgeProjectionService.reconcilePool: not implemented in Step 2-A (Step 2-B)");
  }

  refreshState(_subjectId: string): void {
    throw new Error("KnowledgeProjectionService.refreshState: not implemented in Step 2-A (Step 2-B)");
  }
}
