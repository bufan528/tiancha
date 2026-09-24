/**
 * InformationPool — "what the research needs / how much is currently known".
 *
 * DOMAIN INVARIANT (T3): Pool is NOT a Knowledge Base.
 *   Pool answers:      research needs X; known = sufficient / partial / unknown / conflicting.
 *   Knowledge answers: based on Evidence/Claims, what belief do we hold?
 *
 * S3 (Pool redesign): the Pool is now **Slot + Item**.
 *   - Slot : one research dimension of one subject. Identity = subject + dimension
 *            (`slot-<subjectId>-<dimension>`), inheriting S2's identity contract.
 *   - Item : a piece of information organized under a Slot, which ALWAYS points at a
 *            Claim (I5: the Pool is an ORGANIZING layer, never a second source of truth).
 *
 * `InformationPoolEntry` is the LEGACY single-layer shape. It is kept (read-only) so the
 * S3 migration can dual-read / roll back; nothing writes it any more.
 */

// ---- S3: Slot + Item --------------------------------------------------------

export type PoolSlotStatus = "unknown" | "partial" | "sufficient" | "conflicting";

export interface InformationPoolSlot {
  /** Deterministic identity: `slot-<subjectId>-<dimension>`. */
  slotId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  dimension: string;
  status: PoolSlotStatus;
  /** Why this status — judged against the requirement's confirmedCondition. */
  coverageJudgement: string;
  createdAt: string;
  updatedAt: string;
}

export type PoolItemRelation = "consistent" | "caliber_differs" | "contradicts" | "complements";

export interface InformationPoolItem {
  /** Deterministic identity: `item-<slotId>-<n>`. */
  itemId: string;
  slotId: string;
  /** The information itself (readable). In S3 it carries the supporting claim ref. */
  valueText: string;
  /** Measurement caliber (T4: caliber traps). */
  caliber?: string;
  asOf?: string;
  /** REQUIRED (I5): every item traces back to a Claim. */
  claimRef: string;
  sourceRef?: string;
  relation: PoolItemRelation;
  createdAt: string;
}

// ---- Legacy (S2 and earlier) — read-only during/after migration ---------------

export type PoolStatus = "confirmed" | "partial" | "unknown" | "conflict";

export interface InformationPoolEntry {
  entryId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  topic: string;
  status: PoolStatus;
  relatedRequirementIds: string[];
  evidenceRefs: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- S3 migration helpers (single source of truth for the mapping) -----------

/** Legacy pool status -> slot status: `confirmed`→`sufficient`, `conflict`→`conflicting`. */
export function migrateLegacyPoolStatus(status: PoolStatus): PoolSlotStatus {
  switch (status) {
    case "confirmed":
      return "sufficient";
    case "conflict":
      return "conflicting";
    case "partial":
      return "partial";
    default:
      return "unknown";
  }
}

/** Legacy entry id (`pe-X`) -> slot id (`slot-X`): SAME suffix, identity preserved. */
export function slotIdFromEntryId(entryId: string): string {
  return entryId.startsWith("pe-") ? `slot-${entryId.slice(3)}` : `slot-${entryId}`;
}
