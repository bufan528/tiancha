/**
 * C6 · RMA · Slice A-3 — snapshot / claimRun: the MODEL path records the ADAPTER's identity BY PATH,
 * the legacy path keeps its own sources byte-for-byte, and reuse is structurally untouched.
 *
 *   §R5.7 / A-3  `snapshotFor()`'s `model.*` and the run row's identity columns take the adapter's
 *                identity ON THE MODEL PATH ONLY; legacy omits the input and keeps `this.extractor.*`
 *                / `this.parserVersion`. `schemaVersion` stays Tiancha-owned on BOTH paths (§R4.3).
 *   T-RMA-24     the FOUR legacy faces, each with its OWN independent assertion:
 *                  ① legacy `xcfg-` identity
 *                  ② legacy `generation: {}`
 *                  ③ legacy `snapshot.model.*`          ← previously UNASSERTED
 *                  ④ legacy `extraction_run` identity columns ← previously UNASSERTED
 *   N1           `claimRun`'s new identity input must NOT reach the reuse predicate: identity columns
 *                appear in NO WHERE clause (only `material_version_id` + `extraction_config_key` +
 *                `status`), proven behaviourally BOTH ways.
 *   T-RMA-33     `schemaVersion` has exactly ONE source (`outputContract.version`) on all three spots.
 *
 * ★ Everything below reads the PERSISTED result (rows + snapshot JSON), not just code branches.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { CandidateExtractionService, ExplicitBlockExtractor } from "./application/candidate-extraction-service.js";
import type { AdapterIdentity, ModelExtractionAdapter } from "./application/model-extraction.js";
import { DEFAULT_WINDOW_RULE } from "./application/extraction-window.js";
import { MaterialVersionService } from "./application/material-version-service.js";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { sha256Hex } from "./domain/material-source.js";
import { stableStringify } from "./application/model-extraction-config.js";

const AT = "2026-09-27T00:00:00.000Z";
const RAW = ["第一段：市场规模约 500 亿元。", "第二段：头部客户开始小批量采购。", ""].join("\n\n");

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

interface Fake extends ModelExtractionAdapter {
  readonly calls: { extract: number };
}

function adapterWith(identity: Partial<AdapterIdentity> = {}): Fake {
  const full: AdapterIdentity = {
    provider: "openai-compatible",
    model: "qwen2.5-7b",
    deployment: "local-4060",
    endpointIdentity: "http://127.0.0.1:1234/v1",
    adapterVersion: "openai-compatible-adapter/v1",
    authMode: "none",
    ...identity,
  };
  const calls = { extract: 0 };
  return {
    modelVersion: `pid-${sha256Hex(stableStringify(full))}`,
    promptVersion: "candidate-extraction-prompt/v1",
    parserVersion: "openai-compatible-parser/v1",
    adapterIdentity: full,
    generationParams: { temperature: 0 },
    calls,
    async extractBatch() {
      calls.extract += 1;
      return { candidates: [] }; // an empty batch is legal (§R4.2)
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
    materialId: "mat-a3",
    subjectKind: "industry",
    subjectId: "ind-a3",
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
    materialId: "mat-a3",
    rawText: RAW,
    createdAt: AT,
  }).version.materialVersionId;
  return { db, repo, versionId, service: new CandidateExtractionService(repo, new ExplicitBlockExtractor(repo)) };
}

interface Row {
  extraction_id: string;
  extraction_config_key: string;
  model_version: string;
  prompt_version: string;
  parser_version: string;
  schema_version: string;
  status: string;
  attempt_seq: number;
  config_snapshot_json: string;
}

function rows(e: Env): Row[] {
  return e.db.db
    .prepare(
      `SELECT extraction_id, extraction_config_key, model_version, prompt_version, parser_version,
              schema_version, status, attempt_seq, config_snapshot_json
         FROM extraction_run ORDER BY attempt_seq ASC, rowid ASC`,
    )
    .all() as unknown as Row[];
}

async function runModel(e: Env, adapter: ModelExtractionAdapter, at = AT) {
  const version = e.repo.getMaterialVersion(e.versionId)!;
  return e.service.run(version, at, { model: adapter, rule: DEFAULT_WINDOW_RULE });
}

async function runLegacy(e: Env, at = AT) {
  const version = e.repo.getMaterialVersion(e.versionId)!;
  return e.service.run(version, at);
}

const MODEL_SNAPSHOT_KEYS = ["modelVersion", "promptVersion", "parserVersion", "schemaVersion"] as const;

describe("Slice A-3 — snapshot / claimRun identity by path (§R5.7)", () => {
  test("MODEL path: `snapshot.model.*` AND the run row's identity columns come from the ADAPTER", async () => {
    const e = env();
    const adapter = adapterWith({ deployment: "model-dep", model: "model-x" });

    const result = await runModel(e, adapter);
    const row = rows(e).find((r) => r.extraction_id === result.extractionId)!;
    const snapshot = JSON.parse(row.config_snapshot_json) as { model: Record<string, string> };

    assert.deepEqual(Object.keys(snapshot.model).sort(), [...MODEL_SNAPSHOT_KEYS].sort());
    assert.equal(snapshot.model.modelVersion, adapter.modelVersion);
    assert.equal(snapshot.model.promptVersion, adapter.promptVersion);
    assert.equal(snapshot.model.parserVersion, adapter.parserVersion);
    // …and the identity columns of the row agree with the snapshot (one source, two projections).
    assert.equal(row.model_version, adapter.modelVersion);
    assert.equal(row.prompt_version, adapter.promptVersion);
    assert.equal(row.parser_version, adapter.parserVersion);
  });

  test("★ T-RMA-24 face ① — legacy `xcfg-` identity (own assertion)", async () => {
    const e = env();
    const result = await runLegacy(e);
    const row = rows(e).find((r) => r.extraction_id === result.extractionId)!;
    assert.match(row.extraction_config_key, /^xcfg-/, "face ① legacy identity prefix");
  });

  test("★ T-RMA-24 face ② — legacy `generation: {}` (own assertion)", async () => {
    const e = env();
    const result = await runLegacy(e);
    const row = rows(e).find((r) => r.extraction_id === result.extractionId)!;
    const snapshot = JSON.parse(row.config_snapshot_json) as { generation: unknown };
    assert.deepEqual(snapshot.generation, {}, "face ② legacy generation stays `{}`");
  });

  test("★ T-RMA-24 face ③ — legacy `snapshot.model.*` (own assertion; previously unasserted)", async () => {
    const e = env();
    const result = await runLegacy(e);
    const row = rows(e).find((r) => r.extraction_id === result.extractionId)!;
    const snapshot = JSON.parse(row.config_snapshot_json) as { model: Record<string, string> };
    // The legacy sources are the service's deterministic block extractor ("none"/"none") and the
    // service parser version — recorded VERBATIM, exactly as before A-3.
    assert.equal(snapshot.model.modelVersion, "none", "face ③ legacy snapshot model version");
    assert.equal(snapshot.model.promptVersion, "none", "face ③ legacy snapshot prompt version");
    assert.equal(snapshot.model.parserVersion, "candidate-parser/v1", "face ③ legacy snapshot parser version");
  });

  test("★ T-RMA-24 face ④ — legacy `extraction_run` identity columns (own assertion; previously unasserted)", async () => {
    const e = env();
    const result = await runLegacy(e);
    const row = rows(e).find((r) => r.extraction_id === result.extractionId)!;
    assert.equal(row.model_version, "none", "face ④ legacy row model_version");
    assert.equal(row.prompt_version, "none", "face ④ legacy row prompt_version");
    assert.equal(row.parser_version, "candidate-parser/v1", "face ④ legacy row parser_version");
  });

  test("★ N1 (i) — SAME identity ⇒ SAME config key ⇒ REUSE (no new attempt, no extract call, row byte-identical)", async () => {
    const e = env();
    const adapter = adapterWith();
    const first = await runModel(e, adapter);
    const extractCallsAfterFirst = adapter.calls.extract;
    const before = JSON.stringify(rows(e));

    const second = await runModel(e, adapter, "2026-09-27T03:00:00.000Z");

    assert.equal(
      adapter.calls.extract,
      extractCallsAfterFirst,
      "★ a reused run makes NO additional adapter call (the counter does not move)",
    );
    assert.equal(rows(e).length, JSON.parse(before as string).length, "no new extraction_run row");
    assert.equal(JSON.stringify(rows(e)), before, "★ the completed row is byte-identical");
    assert.equal(second.reusedRun, true);
    assert.deepEqual(second.candidateIds, first.candidateIds);
  });

  test("★ N1 (ii) — DIFFERENT identity ⇒ different config key ⇒ NO reuse (a new attempt is taken)", async () => {
    const e = env();
    await runModel(e, adapterWith({ deployment: "dep-a" }), "2026-09-27T04:00:00.000Z");
    const other = adapterWith({ deployment: "dep-b" });
    await runModel(e, other, "2026-09-27T04:00:00.000Z");

    const all = rows(e);
    assert.equal(all.length, 2, "two distinct runs");
    assert.equal(new Set(all.map((r) => r.extraction_config_key)).size, 2, "two distinct identities");
    assert.equal(other.calls.extract, 1, "the second identity really ran");
  });

  test("★ N1 (iii) — legacy then MODEL: no reuse across paths, and the legacy row is untouched", async () => {
    const e = env();
    const legacy = await runLegacy(e);
    const legacyRowBefore = JSON.stringify(rows(e).find((r) => r.extraction_id === legacy.extractionId)!);

    const adapter = adapterWith();
    await runModel(e, adapter, "2026-09-27T05:00:00.000Z");

    const all = rows(e);
    assert.equal(all.length, 2, "the model path took its own attempt");
    assert.equal(
      JSON.stringify(all.find((r) => r.extraction_id === legacy.extractionId)),
      legacyRowBefore,
      "★ the legacy row is byte-identical after a model run",
    );
    assert.equal(adapter.calls.extract, 1, "the model path was not served by the legacy result");
  });

  test("★ N1 (iv) — the identity input cannot rewrite a reused row (reuse is decided WITHOUT it)", async () => {
    const e = env();
    const adapter = adapterWith();
    await runModel(e, adapter, "2026-09-27T06:00:00.000Z");
    const before = JSON.stringify(rows(e)[0]!);

    // A SECOND adapter carrying the SAME identity ⇒ same config key ⇒ must reuse the SAME row.
    const sameIdentity = adapterWith();
    await runModel(e, sameIdentity, "2026-09-27T06:30:00.000Z");

    const after = rows(e);
    assert.equal(after.length, 1);
    assert.equal(JSON.stringify(after[0]), before, "★ the row was not written by the reusing call");
    assert.equal(sameIdentity.calls.extract, 0);
  });

  test("★ T-RMA-33 — `schemaVersion` has ONE source: identity, snapshot and INSERT all agree", async () => {
    const e = env();
    const adapter = adapterWith();
    const result = await runModel(e, adapter);
    const row = rows(e).find((r) => r.extraction_id === result.extractionId)!;
    const snapshot = JSON.parse(row.config_snapshot_json) as { model: { schemaVersion: string } };

    const expected = e.service.outputContract.version;
    assert.equal(snapshot.model.schemaVersion, expected, "the snapshot uses the service-resolved version");
    assert.equal(row.schema_version, expected, "the row's schema_version uses the SAME value");
    assert.match(row.extraction_config_key, /^mxcfg-/, "and it is the model path");

    // The legacy path resolves the very same value (no second resolution point).
    const e2 = env();
    const legacy = await runLegacy(e2);
    const legacyRow = rows(e2).find((r) => r.extraction_id === legacy.extractionId)!;
    assert.equal(legacyRow.schema_version, e2.service.outputContract.version);
    assert.equal(
      (JSON.parse(legacyRow.config_snapshot_json) as { model: { schemaVersion: string } }).model.schemaVersion,
      e2.service.outputContract.version,
    );
  });
});
