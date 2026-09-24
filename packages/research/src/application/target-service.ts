/**
 * TargetService (Phase B v1 · Step B2) — the **ONLY** writer of `ResearchTarget`.
 *
 * ★ ARCHITECTURAL RED LINE (contract §2.4 / T-B7):
 *   the subject is ALWAYS supplied by a human. `subjectKey` is a required input and is
 *   echoed verbatim; `createdBy` is **hard-coded to `"user"`** and is NOT a parameter, so
 *   no caller (and no agent) can fabricate a human confirmation (T-B8).
 *
 * ★ There is deliberately NO `Position → ResearchTarget` path: a position contributes the
 *   suggested KIND; only the human contributes the SUBJECT.
 */

import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { targetRefFor } from "../domain/research-target.js";
import type { Accessibility, ResearchTarget, TargetStatus } from "../domain/index.js";

export interface AddTargetInput {
  industryId: string;
  /** ★ Supplied by a human. Empty / missing is rejected. */
  subjectKey: string;
  /** Type level, normally from `position.suggestedTargetKinds`. */
  targetKind: string;
  positionRef: string;
  researchPurpose: string;
  selectionReason: string;
  expectedInformationValue?: number;
  accessibility?: Accessibility;
  limitations?: string[];
  isFallback?: boolean;
  fallbackForTargetRef?: string | null;
  kindSubject?: Record<string, unknown>;
  relatedRequirementRefs?: string[];
  relatedQuestionRefs?: string[];
}

export class TargetService {
  constructor(private readonly db: DatabaseSync) {}

  /** Create or update the target for this (industry, human-supplied subject). */
  add(input: AddTargetInput): ResearchTarget {
    const repo = new ResearchRepository(this.db);
    const now = new Date().toISOString();

    const subjectKey = input.subjectKey?.trim();
    if (!subjectKey) {
      throw new Error("subjectKey is required — the subject must be supplied by a human (B2 red line)");
    }
    if (!input.researchPurpose?.trim()) throw new Error("researchPurpose is required (I-B2)");
    if (!input.selectionReason?.trim()) throw new Error("selectionReason is required (I-B2)");

    const position = repo.getPosition(input.positionRef);
    if (!position) throw new Error(`unknown positionRef '${input.positionRef}'`);

    const isFallback = input.isFallback === true;
    const limitations = input.limitations ?? [];
    if (isFallback) {
      if (!input.fallbackForTargetRef) throw new Error("isFallback=true requires fallbackForTargetRef (I-B3)");
      if (limitations.length === 0) throw new Error("isFallback=true requires non-empty limitations (I-B3)");
      if (!repo.getTarget(input.fallbackForTargetRef)) {
        throw new Error(`fallbackForTargetRef '${input.fallbackForTargetRef}' does not exist`);
      }
    }

    // Stable identity: the same subject in the same industry is ALWAYS the same target.
    const targetRef = targetRefFor(input.industryId, subjectKey);
    const existing = repo.getTarget(targetRef);

    const target: ResearchTarget = {
      targetRef,
      industryId: input.industryId,
      subjectKey,
      targetKind: input.targetKind,
      positionRef: input.positionRef,
      kindSubject: input.kindSubject ?? { displayName: subjectKey },
      researchPurpose: input.researchPurpose.trim(),
      selectionReason: input.selectionReason.trim(),
      // Q3 ruling: a human value wins; otherwise derive from the position's importance.
      expectedInformationValue: input.expectedInformationValue ?? position.importance,
      accessibility: input.accessibility ?? "unknown",
      limitations,
      isFallback,
      fallbackForTargetRef: isFallback ? (input.fallbackForTargetRef ?? null) : null,
      relatedQuestionRefs: input.relatedQuestionRefs ?? [],
      relatedRequirementRefs: input.relatedRequirementRefs ?? [],
      status: existing?.status ?? "proposed",
      createdBy: "user", // ★ hard-coded; never a parameter
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    repo.upsertTarget(target);
    return target;
  }

  list(industryId: string): ResearchTarget[] {
    return new ResearchRepository(this.db).listTargets(industryId);
  }

  get(targetRef: string): ResearchTarget | undefined {
    return new ResearchRepository(this.db).getTarget(targetRef);
  }

  /** Fallbacks are first-class, not a dead boolean: downstream layers can list them. */
  listFallbacks(industryId: string): ResearchTarget[] {
    return this.list(industryId).filter((t) => t.isFallback);
  }

  /** Advance the lifecycle status (kept separate from `add`, which is human confirmation). */
  setStatus(targetRef: string, status: TargetStatus): ResearchTarget {
    const repo = new ResearchRepository(this.db);
    const target = repo.getTarget(targetRef);
    if (!target) throw new Error(`unknown target '${targetRef}'`);
    const updated: ResearchTarget = { ...target, status, updatedAt: new Date().toISOString() };
    repo.upsertTarget(updated);
    return updated;
  }
}
