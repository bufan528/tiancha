/**
 * C6 model-extractor · Slice C — the model-extraction CONFIGURATION IDENTITY, plus the §M7.3
 * configuration snapshot type.
 *
 * Contract: `docs/phaseC/c6-model-extractor-contract.md` **rev7** §M9 #5 / §M7.3 / §M3.4.
 *
 * PURE MODULE. It reads nothing: no database, no repository, no `MethodologyService`, no active
 * methodology, no clock, no randomness, no filesystem, no network. The caller supplies
 * `dimensionHints` + `methodologyVersionId`; this module only computes deterministic identities.
 *
 * ★ SEPARATE IDENTITY DOMAIN. `extractionConfigKeyFor()` (the `[CANDIDATE]` path, in
 * `domain/claim-candidate.ts`) is **not touched and not called**: its key feeds
 * `claimCandidateIdFor` for already-existing candidates, so changing its input semantics would
 * drift those ids. Model extraction therefore gets its OWN entry point with its OWN prefix, and
 * the two domains are never merged through "optional compatibility fields".
 *
 * ★ THE HARD GATE (Slice C ruling #11): `generationHash` must really ENTER the final
 * configuration identity — computing it and then forgetting to use it would leave the hole
 * "generation parameters changed but the config identity did not".
 */

import { sha256Hex } from "../domain/material-source.js";
import type { WindowRule } from "./extraction-window.js";

// ---------------------------------------------------------------------------
// §M7.3 — the generation parameters, AS VALUES (not folded into a version string)
// ---------------------------------------------------------------------------

/**
 * What the adapter actually sends to the model. Stored as VALUES so a historical run can answer
 * "what did the model really receive"; it also participates in the configuration identity.
 *
 * Note the naming distinction from the fencing token: this is the MODEL's generation parameters,
 * whereas `run.generation` below is the run's generation token (§M7.1a).
 */
export interface ModelGenerationParams {
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxOutputTokens?: number;
  readonly seed?: number;
  readonly toolConfig?: Readonly<Record<string, unknown>>;
  /** Anything else the adapter reports that can change the output. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// §M7.3 — the immutable configuration snapshot
// ---------------------------------------------------------------------------

/**
 * The snapshot a run persists so the configuration can be reconstructed EXACTLY.
 *
 * ★ It contains NO Tiancha identity: no `materialVersionId`, no `fragmentId`, no `evidenceId`,
 * no `candidateId`, no `extractionId`, no `claimRef`. Identity belongs to the rows that own it;
 * this is only "what the model was asked to do".
 */
export interface ExtractionConfigSnapshot {
  readonly windowRule: {
    readonly version: string;
    readonly maxChars: number;
    readonly overlapChars: number;
    readonly overlapAppliesTo: "long-paragraph-slices-only";
  };
  readonly quotePolicy: {
    readonly maxQuoteChars: number;
    readonly allowedStances: readonly ["supports"];
  };
  readonly model: {
    readonly modelVersion: string;
    readonly promptVersion: string;
    readonly parserVersion: string;
    readonly schemaVersion: string;
  };
  readonly generation: ModelGenerationParams;
  readonly methodology: {
    readonly methodologyVersionId: string;
    /** ★ In the methodology's DECLARED order — the same order the adapter received (§M3.4). */
    readonly dimensionHints: readonly string[];
  };
  readonly run: {
    readonly timeoutMs: number;
    readonly batchCount: number;
    readonly attemptSeq: number;
    /** The run's fencing generation token — NOT the model's generation parameters. */
    readonly generation: number;
  };
}

// ---------------------------------------------------------------------------
// Stable serialization — ORDER OF OBJECT KEYS ONLY. Never arrays, never values.
// ---------------------------------------------------------------------------

export class UnstableValueError extends Error {}

/**
 * Deterministic JSON for identity purposes: object keys are emitted in ASCENDING order, recursively;
 * ARRAYS KEEP THEIR ORDER (sorting an array would change its meaning).
 *
 * Deliberately performs NO semantic normalization: it does not rewrite numbers, does not drop
 * unknown fields, does not turn `null` into "missing" (or vice versa), and does not fill in model
 * defaults. Values it cannot represent deterministically are REFUSED rather than guessed.
 */
export function stableStringify(value: unknown): string {
  const seen = new Set<object>();
  const walk = (v: unknown, path: string): string => {
    if (v === null) return "null";
    switch (typeof v) {
      case "string":
        return JSON.stringify(v);
      case "boolean":
        return v ? "true" : "false";
      case "number": {
        if (!Number.isFinite(v)) {
          throw new UnstableValueError(`${path}: non-finite number cannot be serialized deterministically`);
        }
        // `JSON.stringify(-0)` is "0", which would silently equate -0 with 0.
        return Object.is(v, -0) ? '"-0"' : JSON.stringify(v);
      }
      case "undefined":
        throw new UnstableValueError(`${path}: undefined cannot be serialized deterministically`);
      case "bigint":
        throw new UnstableValueError(`${path}: bigint is not supported`);
      case "function":
      case "symbol":
        throw new UnstableValueError(`${path}: ${typeof v} is not supported`);
      default:
        break;
    }
    if (typeof v !== "object") throw new UnstableValueError(`${path}: unsupported value`);
    if (seen.has(v)) throw new UnstableValueError(`${path}: circular reference`);

    if (Array.isArray(v)) {
      seen.add(v);
      // ★ arrays keep their order; only object KEYS are sorted
      const parts = v.map((item, i) => walk(item, `${path}[${i}]`));
      seen.delete(v);
      return `[${parts.join(",")}]`;
    }

    seen.add(v);
    const record = v as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${walk(record[k], `${path}.${k}`)}`);
    seen.delete(v);
    return `{${parts.join(",")}}`;
  };
  return walk(value, "$");
}

// ---------------------------------------------------------------------------
// Identity components
// ---------------------------------------------------------------------------

/** `sha256Hex` of the stably serialized generation parameters (§M7.3). */
export function generationHashOf(generation: ModelGenerationParams): string {
  return sha256Hex(stableStringify(generation));
}

/**
 * `sha256Hex(dimensionHints.join("|"))` — ★ the order is PRESERVED, never sorted: this hashes the
 * SAME ordered list the adapter receives, so `["A","B","C"]` and `["C","B","A"]` differ (§M3.4).
 */
export function dimensionSetHashOf(dimensionHints: readonly string[]): string {
  return sha256Hex(dimensionHints.join("|"));
}

/** The window rule's contribution, as one stable string (includes the rule version and constants). */
export function chunkerVersionOf(rule: WindowRule): string {
  return `${rule.version}+${rule.maxChars}+${rule.overlapChars}`;
}

// ---------------------------------------------------------------------------
// The model-extraction configuration identity (its OWN domain)
// ---------------------------------------------------------------------------

export interface ModelExtractionConfigParts {
  /** The chunker rule, i.e. `WindowRule` (§M4.3/§M9 #5). */
  readonly windowRule: WindowRule;
  /** The quote cap, which decides which outputs can pass validation (§M5.3). */
  readonly maxQuoteChars: number;
  readonly generation: ModelGenerationParams;
  readonly methodologyVersionId: string;
  /** Ordered, as declared by the methodology. */
  readonly dimensionHints: readonly string[];
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly parserVersion: string;
  readonly schemaVersion: string;
}

/** Distinguishes this identity domain from the `[CANDIDATE]` one (`xcfg-…`). */
export const MODEL_EXTRACTION_CONFIG_PREFIX = "mxcfg" as const;

/**
 * The configuration key for a model-extraction run.
 *
 * Every component that can change WHICH outputs are produced — or which of them are ACCEPTED —
 * is in the payload: the model/prompt/parser/schema versions, the chunker rule (version +
 * constants), `maxQuoteChars`, the methodology version, the ORDERED dimension set, and
 * ★ `generationHash` (the hard gate: it is really used, not merely computed).
 */
export function modelExtractionConfigKeyFor(parts: ModelExtractionConfigParts): string {
  const payload = [
    "mxcfg-v1",
    parts.modelVersion,
    parts.promptVersion,
    parts.parserVersion,
    parts.schemaVersion,
    chunkerVersionOf(parts.windowRule),
    String(parts.maxQuoteChars),
    parts.methodologyVersionId,
    dimensionSetHashOf(parts.dimensionHints),
    // ★ hard gate (#11): the generation parameters MUST reach the final identity
    generationHashOf(parts.generation),
  ].join("|");
  return `${MODEL_EXTRACTION_CONFIG_PREFIX}-${sha256Hex(payload).slice(0, 24)}`;
}
