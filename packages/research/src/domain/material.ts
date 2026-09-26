/**
 * Material (Phase C-MVP / C-MVP-R1) — a user-supplied research material.
 *
 * This is the FIRST object in the system that carries **subject provenance from the
 * moment it is created** (materialId + subjectKind + subjectId + source metadata +
 * content hash), so a future `Material → Fragment → Evidence → Claim` chain does not
 * inherit today's provenance debt.
 *
 * C-MVP red lines:
 *  - there is NO Fragment / Evidence domain model here — a material yields Claims;
 *  - there is NO model/LLM involved: claims are read from an explicit, rule-based block
 *    format (see `domain/material-parser.ts`);
 *  - nothing about Priority / Evaluation semantics changes.
 *
 * ★ C-MVP-R1 (§29) adds the INGEST STATE MACHINE. It still has no model, no Fragment and
 * no Evidence: it only makes "material in" recoverable, concurrency-safe and auditable.
 */

import { createHash } from "node:crypto";

export type MaterialKind = "text";

/**
 * ★ §29.2 — the ingest state machine.
 * `legacy_failed` is produced ONLY by the one-shot migration (§29.2 (c)): a historical row
 * that HAS valid `[CLAIM]` blocks but no claim refs, i.e. a possible残骸 that must be
 * reviewed by a human before any retry. It is NEVER entered by the normal flow.
 */
export type MaterialIngestStatus =
  | "received"
  | "parsed"
  | "projecting"
  | "completed"
  | "failed"
  | "legacy_failed";

/** The stage a non-`completed` ingest stopped at (drives where a resume continues). */
export type MaterialIngestStage = "received" | "parsed" | "projecting" | "migration";

/** ★ §29.5b — per-block ledger state. Monotonic: `reserved → artifact_written → projected`. */
export type MaterialBlockState = "reserved" | "artifact_written" | "projected";

/**
 * ★ §29.5b P1 — one ledger entry per VALID `[CLAIM]` block (malformed blocks never enter the
 * ledger; they only show up in `parseErrors`). `claimId` is allocated and persisted in P1 so
 * that a cross-DB resume has a stable anchor and never produces a second Claim.
 */
export interface MaterialIngestBlock {
  /** 0-based index among the VALID blocks (parse order). */
  blockIndex: number;
  /** Stable hash of the parsed block content (evidence that the ledger matches the text). */
  blockHash: string;
  /** Allocated in P1, persisted, reused forever — the resume anchor. */
  claimId: string;
  state: MaterialBlockState;
}

export interface Material {
  materialId: string;
  /** --- subject provenance (required, from day one) --- */
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  /** --- source metadata --- */
  kind: MaterialKind;
  title: string;
  filename?: string;
  /** Where the text came from (a file path, or `inline:`). */
  locator?: string;
  /** Stable fingerprint of the content — idempotency key together with the subject. */
  contentHash: string;
  /** --- content (kept verbatim) --- */
  rawText: string;
  /** Claims produced from this material (traceability in both directions). */
  claimRefs: string[];
  receivedAt: string;
  createdAt: string;

  /** --- ★ C-MVP-R1 (§29.2): ingest state, ownership and per-block ledger --- */
  ingestStatus: MaterialIngestStatus;
  /** Where a failed ingest stopped (informational when the row is not `failed`). */
  ingestStage?: MaterialIngestStage;
  /** Error summary of the last failure (never contains secrets/credentials). */
  ingestError?: string;
  /**
   * Parser version that produced this row's blocks. `undefined` means "legacy row, NOT yet
   * judged by C-MVP-R1" — the ONE-SHOT migration keys off exactly this (§29.2).
   */
  parserVersion?: string;
  /** Reserved for the future model-candidate layer; ALWAYS undefined under C-MVP-R1. */
  modelVersion?: string;
  /** Resume counter (audit). */
  ingestAttempts: number;
  /** Lease holder / expiry of the atomic ownership claim (§29.5a). */
  ingestOwner?: string;
  ingestLeaseUntil?: string;
  /** Per-block ledger (§29.5b). `[]` for legacy rows and materials with no valid blocks. */
  ingestBlocks: MaterialIngestBlock[];
}

/**
 * ★ §29.4 — the ingest outcome. The old boolean `created` is GONE on purpose: one flag could
 * not distinguish "fully duplicated" from "left-over残骸", which was the C-MVP defect.
 */
export type MaterialIngestOutcome =
  | { outcome: "created"; material: Material; claimIds: string[] }
  | { outcome: "duplicate"; material: Material }
  | { outcome: "resumed"; material: Material; claimIds: string[] }
  | { outcome: "failed"; material: Material; stage: MaterialIngestStage; error: string }
  | { outcome: "in_progress"; material: Material };

/** Optional evolution signal a material may declare for a claim. */
export type ParsedRelationHint =
  | { kind: "SUPPORT" }
  | { kind: "REVISE" }
  | { kind: "CONFLICT"; note?: string }
  | { kind: "SUPERSEDE"; supersedesClaimRef: string };

/** One claim parsed out of a material — the exact shape `ingestClaims()` accepts. */
export interface ParsedClaim {
  dimension: string;
  statement: string;
  confidence?: number;
  sourceRef?: string;
  relationHint?: ParsedRelationHint;
}

/**
 * ★ §29.5b — stable hash of one parsed block. Used by the ledger so a resume can PROVE it is
 * looking at the same block it reserved, and by tests to detect a ledger/text mismatch.
 * Canonical (sorted keys) so key order never changes the hash.
 */
export function blockHash(claim: ParsedClaim): string {
  const canonical = JSON.stringify([
    claim.dimension,
    claim.statement,
    claim.confidence ?? null,
    claim.sourceRef ?? null,
    claim.relationHint ? canonicalize(claim.relationHint) : null,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = canonicalize(obj[key]);
    return out;
  }
  return value;
}

/** Subject-scoped ingest identity (§29.5b): stable Source/Document ids for the resume path. */
export function ingestIdFor(subjectKind: string, subjectId: string, contentHash: string): string {
  return createHash("sha256")
    .update(`${subjectKind}\u0000${subjectId}\u0000${contentHash}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}
