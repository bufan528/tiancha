/**
 * C6 · RMA · Slice A-2 — generation wiring: the adapter's REAL generation parameters reach the model
 * path's identity AND its snapshot, while the legacy path keeps `generation: {}` byte-for-byte.
 *
 * Contract points exercised here:
 *   §R5.0/§R5.4  generationParams is the frozen four (temperature / topP / maxOutputTokens / seed) and
 *                NOTHING provider-specific; it is the ONE source for both the identity and the snapshot
 *   T-RMA-9      changing deployment / model            ⇒ `mxcfg-` MUST move
 *   T-RMA-10     changing a generation field            ⇒ `mxcfg-` MUST move
 *   T-RMA-11     changing adapterVersion                ⇒ `mxcfg-` MUST move
 *   T-RMA-25     changing the base URL (endpointIdentity) ⇒ `mxcfg-` MUST move
 *   T-RMA-26     changing an EXECUTION fact (usage / latency / requestId) ⇒ `mxcfg-` MUST NOT move
 *   T-RMA-32     `modelVersion === "pid-" + sha256Hex(stableStringify(adapterIdentity))`
 *   T-RMA-17     the snapshot carries what a request is rebuilt from (dimensionHints IN ORDER, and the
 *                full generation map)
 *   legacy       the legacy `[CANDIDATE]` path still writes `generation: {}`
 *
 * ★ Two hooks keep this honest: a fake adapter injected through the REAL `run()` (never a stub service),
 * and the DB read back directly (`extraction_config_key` + `config_snapshot_json`).
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { CandidateExtractionService, ExplicitBlockExtractor } from "./application/candidate-extraction-service.js";
import type { AdapterIdentity, ModelExtractionAdapter } from "./application/model-extraction.js";
import { DEFAULT_WINDOW_RULE } from "./application/extraction-window.js";
import { MaterialVersionService } from "./application/material-version-service.js";
import { METHODOLOGY_V1 } from "./methodology/methodology-v1.js";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { sha256Hex } from "./domain/material-source.js";
import { stableStringify } from "./application/model-extraction-config.js";
import { pickFrozenGenerationParams } from "./providers/openai-compatible-model-adapter.js";

const AT = "2026-09-27T00:00:00.000Z";
const RAW = ["第一段：市场规模约 500 亿元。", "第二段：头部客户开始小批量采购。", ""].join("\n\n");
/** The ACTIVE methodology the service actually uses when the repo has none. */
const ACTIVE_HINTS = METHODOLOGY_V1.dimensions.map((d) => d.key);

const opened: ResearchDb[] = [];
after(() => {
  for (const db of opened) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
});

/** A model adapter whose identity + generation parameters we can vary per case. */
function adapterWith(over: {
  identity?: Partial<AdapterIdentity>;
  generationParams?: ModelExtractionAdapter["generationParams"];
}): ModelExtractionAdapter {
  const identity: AdapterIdentity = {
    provider: "openai-compatible",
    model: "qwen2.5-7b",
    deployment: "local-4060",
    endpointIdentity: "http://127.0.0.1:1234/v1",
    adapterVersion: "openai-compatible-adapter/v1",
    authMode: "none",
    ...over.identity,
  };
  return {
    modelVersion: `pid-${sha256Hex(stableStringify(identity))}`,
    promptVersion: "candidate-extraction-prompt/v1",
    parserVersion: "openai-compatible-parser/v1",
    adapterIdentity: identity,
    generationParams: over.generationParams ?? { temperature: 0 },
    // An EMPTY candidate list is legal (§R4.2) and keeps this test about identity/snapshot only.
    async extractBatch() {
      return { candidates: [] };
    },
  };
}

interface Env {
  db: ResearchDb;
  repo: ResearchRepository;
  versionId: string;
  service: CandidateExtractionService;
}

function env(): Env {
  const db = new ResearchDb({ path: ":memory:" });
  opened.push(db);
  const repo = new ResearchRepository(db.db);
  repo.upsertMaterial({
    materialId: "mat-a2",
    subjectKind: "industry",
    subjectId: "ind-a2",
    kind: "text",
    title: "report.md",
    contentHash: sha256Hex(RAW),
    rawText: RAW,
    claimRefs: [],
    receivedAt: AT,
    createdAt: AT,
    ingestStatus: "completed",
    ingestAttempts: 1,
    ingestGeneration: 1,
    ingestBlocks: [],
    ingestOverlaps: [],
  });
  const versionId = new MaterialVersionService(repo).registerVersion({
    materialId: "mat-a2",
    rawText: RAW,
    createdAt: AT,
  }).version.materialVersionId;
  return { db, repo, versionId, service: new CandidateExtractionService(repo, new ExplicitBlockExtractor(repo)) };
}

/** Run the MODEL path and read back what was actually persisted. */
async function runModel(e: Env, adapter: ModelExtractionAdapter, at = AT) {
  const version = e.repo.getMaterialVersion(e.versionId)!;
  const result = await e.service.run(version, at, { model: adapter, rule: DEFAULT_WINDOW_RULE });
  const row = e.db.db
    .prepare("SELECT extraction_config_key AS key, config_snapshot_json AS snapshot FROM extraction_run ORDER BY rowid DESC LIMIT 1")
    .get() as { key: string; snapshot: string };
  return { result, key: row.key, snapshot: JSON.parse(row.snapshot) as { generation: unknown; methodology: { dimensionHints: string[] } } };
}

describe("Slice A-2 — generation wiring (§R5.0 / §R5.4)", () => {
  test("the model path records the adapter's REAL generation parameters in BOTH the identity and the snapshot", async () => {
    const e = env();
    const adapter = adapterWith({ generationParams: { temperature: 0.2, topP: 0.9, maxOutputTokens: 512, seed: 7 } });

    const { key, snapshot } = await runModel(e, adapter);

    assert.match(key, /^mxcfg-/, "the model path mints its own identity (§M14.4)");
    assert.deepEqual(
      snapshot.generation,
      { temperature: 0.2, topP: 0.9, maxOutputTokens: 512, seed: 7 },
      "★ the snapshot carries the REAL generation parameters, not `{}`",
    );
  });

  test("the legacy path still records `generation: {}` (byte-for-byte unchanged)", async () => {
    const e = env();
    const version = e.repo.getMaterialVersion(e.versionId)!;

    const result = await e.service.run(version, AT); // NO `model` ⇒ the legacy [CANDIDATE] path
    const row = e.db.db
      .prepare("SELECT extraction_config_key AS key, config_snapshot_json AS snapshot FROM extraction_run ORDER BY rowid DESC LIMIT 1")
      .get() as { key: string; snapshot: string };

    assert.match(row.key, /^xcfg-/, "the legacy identity is unchanged");
    assert.deepEqual((JSON.parse(row.snapshot) as { generation: unknown }).generation, {}, "★ legacy generation stays `{}`");
    assert.ok(result.status === "completed" || result.status === "failed");
  });

  test("★ T-RMA-10 / T-RMA-25 / T-RMA-9 / T-RMA-11 — identity-SENSITIVE mutation: each change moves `mxcfg-`", async () => {
    const e = env();
    const base = adapterWith({ generationParams: { temperature: 0.2, topP: 0.9, maxOutputTokens: 512, seed: 7 } });
    const baseline = (await runModel(e, base, "2026-09-27T01:00:00.000Z")).key;

    const mutations: Array<[string, ModelExtractionAdapter]> = [
      ["temperature", adapterWith({ generationParams: { temperature: 0.3, topP: 0.9, maxOutputTokens: 512, seed: 7 } })],
      ["topP", adapterWith({ generationParams: { temperature: 0.2, topP: 0.8, maxOutputTokens: 512, seed: 7 } })],
      ["maxOutputTokens", adapterWith({ generationParams: { temperature: 0.2, topP: 0.9, maxOutputTokens: 256, seed: 7 } })],
      ["seed", adapterWith({ generationParams: { temperature: 0.2, topP: 0.9, maxOutputTokens: 512, seed: 8 } })],
      ["deployment", adapterWith({ identity: { deployment: "other-deployment" } })],
      ["model", adapterWith({ identity: { model: "qwen2.5-14b" } })],
      ["endpointIdentity (base URL)", adapterWith({ identity: { endpointIdentity: "http://localhost:5678" } })],
      ["adapterVersion", adapterWith({ identity: { adapterVersion: "openai-compatible-adapter/v2" } })],
      ["authMode", adapterWith({ identity: { authMode: "api-key" } })],
    ];
    for (const [what, mutated] of mutations) {
      const key = (await runModel(e, mutated, "2026-09-27T01:00:00.000Z")).key;
      assert.notEqual(key, baseline, `★ changing ${what} MUST move the identity`);
    }
  });

  test("★ T-RMA-26 — identity-INSENSITIVE: execution facts and provider extras never enter `mxcfg-`", async () => {
    const e = env();
    const frozen = { temperature: 0.2, topP: 0.9, maxOutputTokens: 512, seed: 7 };
    const plain = adapterWith({ generationParams: pickFrozenGenerationParams(frozen) });
    const baseline = (await runModel(e, plain, "2026-09-27T02:00:00.000Z")).key;

    // An adapter that ALSO carries provider-specific options must produce the SAME identity: those
    // fields are dropped by `pickFrozenGenerationParams`, so usage / latency / toolConfig can never
    // leak into the identity (§R5.0 / §R9.3).
    const withExtras = adapterWith({
      generationParams: pickFrozenGenerationParams({
        ...frozen,
        toolConfig: { some: "vendor-specific" },
        extra: { requestId: "req-1", latencyMs: 42, usage: { total: 999 } },
      } as ModelExtractionAdapter["generationParams"]),
    });
    const same = (await runModel(e, withExtras, "2026-09-27T02:00:00.000Z")).key;

    assert.deepEqual(withExtras.generationParams, frozen, "only the frozen four survive normalization");
    assert.equal(same, baseline, "★ execution facts / provider extras MUST NOT move the identity");
  });

  test("§R5.0 — `pickFrozenGenerationParams` keeps exactly the frozen four and omits the absent ones", () => {
    assert.deepEqual(pickFrozenGenerationParams({ temperature: 0 }), { temperature: 0 });
    assert.deepEqual(Object.keys(pickFrozenGenerationParams({})), [], "absent fields are OMITTED, not undefined");
    assert.deepEqual(
      pickFrozenGenerationParams({ seed: 3, toolConfig: { x: 1 }, extra: { y: 2 } } as never),
      { seed: 3 },
      "provider-specific options are dropped",
    );
    assert.ok(Object.isFrozen(pickFrozenGenerationParams({ temperature: 0 })));
  });

  test("★ T-RMA-32 — `modelVersion` is the canonical identity hash (and moves with a single field)", async () => {
    const e = env();
    const adapter = adapterWith({});
    assert.equal(adapter.modelVersion, `pid-${sha256Hex(stableStringify(adapter.adapterIdentity))}`);
    const moved = adapterWith({ identity: { deployment: "another" } });
    assert.notEqual(moved.modelVersion, adapter.modelVersion, "one identity field moves the canonical value");

    const { key } = await runModel(e, adapter);
    const { key: movedKey } = await runModel(e, moved, AT);
    assert.notEqual(movedKey, key);
  });

  test("★ T-RMA-17 — the snapshot carries what a request is rebuilt from (dimensionHints IN ORDER + full generation)", async () => {
    const e = env();
    const adapter = adapterWith({ generationParams: { temperature: 0.1 } });

    const { snapshot } = await runModel(e, adapter);

    // §R4.1: the methodology's DECLARED dimension order travels verbatim — never sorted, never deduped.
    assert.deepEqual(
      snapshot.methodology.dimensionHints,
      ACTIVE_HINTS,
      "the declared order is preserved in full",
    );
    assert.deepEqual(snapshot.generation, { temperature: 0.1 });
  });
});
