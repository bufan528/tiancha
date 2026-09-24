/**
 * Material (Phase C-MVP) — a user-supplied research material.
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
 */

export type MaterialKind = "text";

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
}

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
