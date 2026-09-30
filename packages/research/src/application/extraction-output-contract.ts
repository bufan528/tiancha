/**
 * C6 · RMA (§R4.3) — the Tiancha-owned, READ-ONLY **Extraction Output Contract**.
 *
 * It is the ONE authority for "what a model must return":
 *   - owned by Tiancha, never by a provider;
 *   - versioned by the service's resolved `schemaVersion`, which the service resolves EXACTLY once
 *     (§R4.3 / T-RMA-33) — this module never resolves a version, it only looks one up;
 *   - an IMMUTABLE one-to-one map: one version always points at the SAME schema content, and any
 *     change to the schema content REQUIRES a new version (§R4.3 / T-RMA-22 (d)).
 *
 * The adapter CONSUMES this (translating it into the provider's structured-output form). It may not
 * own, declare, override or widen it, and it may not be replaced after assembly (§R4.3).
 *
 * It carries NO provider detail and NO Tiancha identity — only the shape of a candidate batch. It is
 * a provider-neutral value: nothing here names a vendor, a transport or an endpoint.
 */

export interface ExtractionOutputContract {
  /** The service-resolved `schemaVersion` — the single source (§R4.3). */
  readonly version: string;
  /** The structural contract a model response must satisfy (JSON-schema shaped, provider-neutral). */
  readonly schema: Readonly<Record<string, unknown>>;
}

/**
 * The candidate-batch shape (mirrors `ModelCandidateDraft` / `ModelBatchResult`). It deliberately
 * contains NO id field: ids are Tiancha's to mint, never a model's to claim (§M5.2).
 */
const CANDIDATE_BATCH_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dimension", "statement", "contentKind", "quotes"],
        properties: {
          dimension: { type: "string" },
          statement: { type: "string" },
          contentKind: { type: "string", enum: ["fact", "judgment"] },
          confidence: { type: "number" },
          quotes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["windowId", "startInWindow", "endInWindow", "text"],
              properties: {
                windowId: { type: "string" },
                startInWindow: { type: "integer" },
                endInWindow: { type: "integer" },
                text: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
});

/** The immutable version → schema map. A version is NEVER mutated in place (§R4.3). */
const SCHEMAS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  "candidate-schema/v1": CANDIDATE_BATCH_SCHEMA,
});

/**
 * Look up the contract for an ALREADY-RESOLVED version.
 *
 * A version with its own frozen schema uses it; any OTHER version maps to the baseline schema. This
 * keeps the promise that matters — one version always yields the SAME schema (replayable chain) —
 * while staying behaviour-preserving for the service's existing callers, which are free to pass a
 * custom `schemaVersion` (the version is recorded verbatim either way, and it still enters the
 * identity).
 */
export function extractionOutputContractFor(version: string): ExtractionOutputContract {
  return Object.freeze({ version, schema: SCHEMAS[version] ?? CANDIDATE_BATCH_SCHEMA });
}

/** The versions this build knows (diagnostics/tests only). */
export function knownExtractionOutputSchemaVersions(): readonly string[] {
  return Object.freeze(Object.keys(SCHEMAS));
}
