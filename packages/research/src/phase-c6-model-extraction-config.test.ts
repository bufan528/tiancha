/**
 * C6 model-extractor · Slice C acceptance — `T-C6-30(unit)`: the model-extraction configuration
 * identity and the §M7.3 snapshot.
 *
 * Contract rev7 §M9 #5 / §M7.3 / §M3.4. The reserved `T-C6-30` (whose full statement includes the
 * identity feeding a real persisted candidate) stays for the end-to-end slice; this file proves the
 * unit-level half: same input ⇒ same key, and EVERY component that can change output or acceptance
 * changes the key — including the generation parameters (the hard gate).
 *
 * Pure tests: no database, no clock, no model.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_EXTRACTION_CONFIG_PREFIX,
  UnstableValueError,
  chunkerVersionOf,
  dimensionSetHashOf,
  generationHashOf,
  modelExtractionConfigKeyFor,
  stableStringify,
  type ExtractionConfigSnapshot,
  type ModelExtractionConfigParts,
} from "./application/model-extraction-config.js";
import { DEFAULT_WINDOW_RULE } from "./application/extraction-window.js";
import { sha256Hex } from "./domain/material-source.js";

const BASE: ModelExtractionConfigParts = {
  windowRule: DEFAULT_WINDOW_RULE,
  maxQuoteChars: DEFAULT_WINDOW_RULE.maxQuoteChars,
  generation: { temperature: 0.2, topP: 0.9, maxOutputTokens: 1024, seed: 7 },
  methodologyVersionId: "mw-v1",
  dimensionHints: ["market", "demand", "supply"],
  modelVersion: "model-deploy-2026-09-27",
  promptVersion: "prompt-v1",
  parserVersion: "parser-v1",
  schemaVersion: "schema-v1",
};

const keyOf = (p: ModelExtractionConfigParts): string => modelExtractionConfigKeyFor(p);

describe("T-C6-30(unit) — model-extraction config identity (§M9 #5)", () => {
  test("-a: the SAME input always yields the SAME key (pure, deterministic)", () => {
    assert.equal(keyOf(BASE), keyOf({ ...BASE }));
    assert.equal(keyOf(BASE), keyOf({ ...BASE, dimensionHints: [...BASE.dimensionHints] }));
    assert.match(keyOf(BASE), new RegExp(`^${MODEL_EXTRACTION_CONFIG_PREFIX}-[0-9a-f]{24}$`));
  });

  test("-b: EVERY output-affecting component changes the key", () => {
    const variants: Array<{ label: string; mutate: (p: ModelExtractionConfigParts) => ModelExtractionConfigParts }> = [
      { label: "WINDOW_RULE_VERSION", mutate: (p) => ({ ...p, windowRule: { ...p.windowRule, version: "para-greedy-v2" } }) },
      { label: "maxChars", mutate: (p) => ({ ...p, windowRule: { ...p.windowRule, maxChars: p.windowRule.maxChars + 1 } }) },
      { label: "overlapChars", mutate: (p) => ({ ...p, windowRule: { ...p.windowRule, overlapChars: p.windowRule.overlapChars - 1 } }) },
      { label: "maxQuoteChars", mutate: (p) => ({ ...p, maxQuoteChars: p.maxQuoteChars - 1 }) },
      { label: "methodologyVersionId", mutate: (p) => ({ ...p, methodologyVersionId: "mw-v2" }) },
      { label: "dimensionHints CONTENT", mutate: (p) => ({ ...p, dimensionHints: [...p.dimensionHints, "risk"] }) },
      { label: "dimensionHints ORDER", mutate: (p) => ({ ...p, dimensionHints: [...p.dimensionHints].reverse() }) },
      { label: "modelVersion", mutate: (p) => ({ ...p, modelVersion: "model-deploy-2026-09-28" }) },
      { label: "promptVersion", mutate: (p) => ({ ...p, promptVersion: "prompt-v2" }) },
      { label: "parserVersion", mutate: (p) => ({ ...p, parserVersion: "parser-v2" }) },
      { label: "schemaVersion", mutate: (p) => ({ ...p, schemaVersion: "schema-v2" }) },
      { label: "generation.temperature", mutate: (p) => ({ ...p, generation: { ...p.generation, temperature: 0.7 } }) },
      { label: "generation.topP", mutate: (p) => ({ ...p, generation: { ...p.generation, topP: 0.5 } }) },
      { label: "generation.seed", mutate: (p) => ({ ...p, generation: { ...p.generation, seed: 8 } }) },
      { label: "generation.maxOutputTokens", mutate: (p) => ({ ...p, generation: { ...p.generation, maxOutputTokens: 2048 } }) },
      { label: "generation.extra (new key)", mutate: (p) => ({ ...p, generation: { ...p.generation, extra: { toolChoice: "auto" } } }) },
    ];
    const base = keyOf(BASE);
    for (const v of variants) {
      assert.notEqual(keyOf(v.mutate(BASE)), base, `${v.label} must change the config identity`);
    }
  });

  test("-c: ★ HARD GATE — changing ONLY the generation parameters changes the key (generationHash really enters the identity)", () => {
    const onlyGeneration = { ...BASE, generation: { ...BASE.generation, temperature: 0.999 } };
    assert.notEqual(keyOf(onlyGeneration), keyOf(BASE), "a generation-only change must be visible in the key");
    // ...and the same parts modulo generation are otherwise identical, so nothing else caused it
    assert.equal(
      keyOf({ ...BASE, generation: onlyGeneration.generation }),
      keyOf(onlyGeneration),
      "the key is a pure function of the parts",
    );
  });

  test("-d: the generation hash is stable across OBJECT KEY writing order (top level and nested)", () => {
    const a = { temperature: 0.2, topP: 0.9, extra: { zeta: 1, alpha: 2 } };
    const b = { topP: 0.9, temperature: 0.2, extra: { alpha: 2, zeta: 1 } };
    assert.equal(generationHashOf(a), generationHashOf(b));
    assert.equal(
      keyOf({ ...BASE, generation: a }),
      keyOf({ ...BASE, generation: b }),
      "key writing order must not change the identity",
    );
  });

  test("-e: ARRAY order IS meaningful — reordering an array changes the hash", () => {
    const a = { temperature: 0.2, extra: { stops: ["x", "y"] } };
    const b = { temperature: 0.2, extra: { stops: ["y", "x"] } };
    assert.notEqual(generationHashOf(a), generationHashOf(b));
    assert.notEqual(keyOf({ ...BASE, generation: a }), keyOf({ ...BASE, generation: b }));
  });

  test("-f: dimensionHints keeps the caller's ORDER (never sorted) and is NOT a set", () => {
    assert.equal(dimensionSetHashOf(["A", "B", "C"]), sha256Hex("A|B|C"));
    assert.notEqual(dimensionSetHashOf(["A", "B", "C"]), dimensionSetHashOf(["C", "B", "A"]));
    assert.notEqual(dimensionSetHashOf(["a", "b"]), dimensionSetHashOf(["a", "b", "b"]));
    // duplicated keys are NOT deduplicated (no semantic normalization)
    assert.notEqual(dimensionSetHashOf(["a", "a"]), dimensionSetHashOf(["a"]));
  });

  test("-g: the chunker contribution carries the rule version AND both constants", () => {
    assert.equal(chunkerVersionOf(DEFAULT_WINDOW_RULE), `${DEFAULT_WINDOW_RULE.version}+2000+600`);
    assert.notEqual(chunkerVersionOf({ ...DEFAULT_WINDOW_RULE, maxChars: 1500 }), chunkerVersionOf(DEFAULT_WINDOW_RULE));
  });

  test("-h: this module does NOT use the [CANDIDATE] identity domain", () => {
    const key = keyOf(BASE);
    assert.ok(key.startsWith(`${MODEL_EXTRACTION_CONFIG_PREFIX}-`), "model extraction has its own prefix");
    assert.equal(key.startsWith("xcfg-"), false, "the [CANDIDATE] domain key shape is not reused");
  });

  test("-i: stableStringify sorts object keys, keeps arrays, and REFUSES what it cannot represent", () => {
    // keys sorted, recursively; unknown fields preserved; null preserved
    assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
    assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
    assert.equal(stableStringify({ keep: null }), '{"keep":null}');
    assert.ok(stableStringify({ a: 1, unknownField: "kept" }).includes('"unknownField":"kept"'));
    // arrays keep order
    assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
    assert.notEqual(stableStringify({ a: [1, 2] }), stableStringify({ a: [2, 1] }));
    // -0 is not silently equated with 0
    assert.equal(stableStringify(-0), '"-0"');
    assert.notEqual(stableStringify(-0), stableStringify(0));
    // refused rather than guessed
    assert.throws(() => stableStringify(undefined), UnstableValueError);
    assert.throws(() => stableStringify({ a: undefined }), UnstableValueError);
    assert.throws(() => stableStringify(Number.NaN), UnstableValueError);
    assert.throws(() => stableStringify(Number.POSITIVE_INFINITY), UnstableValueError);
    assert.throws(() => stableStringify({ f: () => 1 }), UnstableValueError);
    assert.throws(() => stableStringify({ b: 1n }), UnstableValueError);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.throws(() => stableStringify(circular), UnstableValueError);
  });
});

// ---------------------------------------------------------------------------
// §M7.3 — the snapshot is a value object with NO identity
// ---------------------------------------------------------------------------

const SNAPSHOT: ExtractionConfigSnapshot = {
  windowRule: {
    version: DEFAULT_WINDOW_RULE.version,
    maxChars: DEFAULT_WINDOW_RULE.maxChars,
    overlapChars: DEFAULT_WINDOW_RULE.overlapChars,
    overlapAppliesTo: "long-paragraph-slices-only",
  },
  quotePolicy: { maxQuoteChars: BASE.maxQuoteChars, allowedStances: ["supports"] },
  model: {
    modelVersion: BASE.modelVersion,
    promptVersion: BASE.promptVersion,
    parserVersion: BASE.parserVersion,
    schemaVersion: BASE.schemaVersion,
  },
  generation: BASE.generation,
  methodology: { methodologyVersionId: BASE.methodologyVersionId, dimensionHints: [...BASE.dimensionHints] },
  run: { timeoutMs: 120_000, batchCount: 3, attemptSeq: 1, generation: 1 },
};

describe("T-C6-30(unit) — §M7.3 snapshot carries no identity", () => {
  test("the snapshot's shape is exactly the configuration, recursively free of Tiancha ids", () => {
    assert.deepEqual(Object.keys(SNAPSHOT).sort(), ["generation", "methodology", "model", "quotePolicy", "run", "windowRule"]);

    const forbidden = [
      "materialVersionId",
      "fragmentId",
      "evidenceId",
      "candidateId",
      "extractionId",
      "claimRef",
      "confirmedClaimRef",
      "owner",
      "id",
    ];
    const walk = (node: unknown, path: string): void => {
      if (node === null || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        assert.equal(forbidden.includes(k), false, `${path}.${k} must not exist on a config snapshot`);
        walk(v, `${path}.${k}`);
      }
    };
    walk(SNAPSHOT, "$");
  });

  test("the snapshot keeps the ORDERED dimensionHints (as the adapter received them)", () => {
    assert.deepEqual(SNAPSHOT.methodology.dimensionHints, ["market", "demand", "supply"]);
    assert.notDeepEqual([...SNAPSHOT.methodology.dimensionHints].sort(), SNAPSHOT.methodology.dimensionHints);
  });

  test("the TYPES reject identity on the snapshot (compile-time)", () => {
    const s: ExtractionConfigSnapshot = SNAPSHOT;
    // @ts-expect-error — a config snapshot has no materialVersionId field
    s.materialVersionId = "mver-1";
    // @ts-expect-error — a config snapshot has no extractionId field
    s.extractionId = "xrun-1";
    // @ts-expect-error — allowedStances is the closed set ["supports"]
    const badStances: ExtractionConfigSnapshot = { ...SNAPSHOT, quotePolicy: { maxQuoteChars: 500, allowedStances: ["refutes"] } };
    // @ts-expect-error — `run.generation` is a number (the fencing token), not the model params object
    const badRun: ExtractionConfigSnapshot = { ...SNAPSHOT, run: { ...SNAPSHOT.run, generation: { temperature: 0.1 } } };
    void badStances;
    void badRun;
  });
});
