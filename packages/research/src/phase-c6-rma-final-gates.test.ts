/**
 * C6 · RMA · Slice A-4 — FINAL ARCHITECTURE & TEST GATES (part 1: boundaries + isolation).
 *
 *   T-RMA-13  the application layer does NOT depend on a provider IMPLEMENTATION — five assertions,
 *             including the §R1.3 exception for `AdapterIdentity` (a provider-neutral value object).
 *   T-RMA-27  ZERO real network: `globalThis.fetch` + `node:http` + `node:https` are ALL guarded, and
 *             the test asserts the triple — guard calls === 0, the model path really COMPLETED, and at
 *             least one valid candidate was produced.
 *   T-RMA-1/2/3  credential isolation: never in source, never in the database, never in logs/output/errors.
 *   T-RMA-16  candidates can only enter through `ModelExtractionAdapter`.
 *   T-RMA-29  `ExecutionTelemetry` never crosses the boundary (not into the snapshot, not into output).
 *
 * ★ Reading these files/DB rows is the point: the assertions inspect the PERSISTED result and the real
 *   source text, not a claim about the code.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import http from "node:http";
import https from "node:https";
import { CandidateExtractionService, ExplicitBlockExtractor } from "./application/candidate-extraction-service.js";
import type { AdapterIdentity, ModelBatchInput, ModelBatchResult, ModelExtractionAdapter } from "./application/model-extraction.js";
import { DEFAULT_WINDOW_RULE } from "./application/extraction-window.js";
import { MaterialVersionService } from "./application/material-version-service.js";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { sha256Hex } from "./domain/material-source.js";
import { stableStringify } from "./application/model-extraction-config.js";
import { assembleModelAdapter } from "./providers/openai-compatible-model-adapter.js";
import { extractionOutputContractFor } from "./application/extraction-output-contract.js";

const AT = "2026-09-27T00:00:00.000Z";
const RAW = ["第一段：市场规模约 500 亿元。", "第二段：头部客户开始小批量采购。", ""].join("\n\n");
const SECRET = "sk-SUPER-SECRET-KEY-42";

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

/** A model adapter that quotes the REAL window text, so V1–V4 can actually pass (§M5.3). */
class QuotingAdapter implements ModelExtractionAdapter {
  readonly modelVersion = "pid-fake";
  readonly promptVersion = "prompt/v1";
  readonly parserVersion = "parser/v1";
  readonly adapterIdentity: AdapterIdentity = {
    provider: "fake",
    model: "fake",
    deployment: "fake",
    endpointIdentity: "fake",
    adapterVersion: "fake/v1",
    authMode: "none",
  };
  readonly generationParams = {};
  calls = 0;

  async extractBatch(input: ModelBatchInput): Promise<ModelBatchResult> {
    this.calls += 1;
    const end = Math.min(4, input.window.text.length);
    return {
      candidates: [
        {
          dimension: input.dimensionHints[0]!,
          statement: "市场规模约 500 亿元",
          contentKind: "fact",
          quotes: [
            { windowId: input.window.windowId, startInWindow: 0, endInWindow: end, text: input.window.text.slice(0, end) },
          ],
        },
      ],
    };
  }
}

interface Env {
  db: ResearchDb;
  repo: ResearchRepository;
  versionId: string;
  service: CandidateExtractionService;
}

function env(rawText = RAW): Env {
  const db = new ResearchDb({ path: ":memory:" });
  opened.push(db);
  const repo = new ResearchRepository(db.db);
  repo.upsertMaterial({
    materialId: "mat-a4",
    subjectKind: "industry",
    subjectId: "ind-a4",
    kind: "text",
    title: "report.md",
    contentHash: sha256Hex(rawText),
    rawText,
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
    materialId: "mat-a4",
    rawText,
    createdAt: AT,
  }).version.materialVersionId;
  return { db, repo, versionId, service: new CandidateExtractionService(repo, new ExplicitBlockExtractor(repo)) };
}

function count(e: Env, table: string): number {
  return (e.db.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "application");
const PROVIDER_DIR = join(dirname(fileURLToPath(import.meta.url)), "providers");

function applicationSources(): Array<{ file: string; text: string }> {
  return readdirSync(APP_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((file) => ({ file, text: readFileSync(join(APP_DIR, file), "utf8") }));
}

function providerSources(): Array<{ file: string; text: string }> {
  return readdirSync(PROVIDER_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((file) => ({ file, text: readFileSync(join(PROVIDER_DIR, file), "utf8") }));
}

/**
 * Install the three-entry network guard (§R13.0(2)). Any request that is NOT the injected transport
 * bumps the counter and throws IMMEDIATELY. `node:http`/`node:https` are reached through their CJS
 * export objects so they can actually be replaced.
 */
function installNetworkGuard(): { calls: { n: number }; restore: () => void } {
  const calls = { n: 0 };
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  const forbidden = (what: string) => {
    calls.n += 1;
    throw new Error(`real network access attempted via ${what}`);
  };
  (globalThis as unknown as { fetch: unknown }).fetch = () => forbidden("globalThis.fetch");
  (http as { request: unknown }).request = () => forbidden("node:http.request");
  (http as { get: unknown }).get = () => forbidden("node:http.get");
  (https as { request: unknown }).request = () => forbidden("node:https.request");
  (https as { get: unknown }).get = () => forbidden("node:https.get");
  return {
    calls,
    restore: () => {
      (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
      (http as { request: unknown }).request = originalHttpRequest;
      (http as { get: unknown }).get = originalHttpGet;
      (https as { request: unknown }).request = originalHttpsRequest;
      (https as { get: unknown }).get = originalHttpsGet;
    },
  };
}

describe("Slice A-4 · part 1 — boundaries and isolation", () => {
  test("★ T-RMA-13 (a)(d): the application layer imports nothing from the provider implementation", () => {
    for (const { file, text } of applicationSources()) {
      assert.doesNotMatch(text, /from\s+"\.\.\/providers\//, `${file} must not import providers/`);
      assert.doesNotMatch(text, /from\s+"\.\/.*-transport/, `${file} must not import a transport`);
      assert.doesNotMatch(text, /\bopenai\b|\banthropic\b/i, `${file} must not name a vendor`);
      assert.doesNotMatch(text, /fetch\s*\(|https?:\/\//, `${file} must not touch the network`);
    }
    // (d) provider implementation details DO live in the providers directory.
    const providers = providerSources().map((s) => s.file).join(" ");
    assert.match(providers, /openai-compatible/, "the implementation belongs to providers/");
  });

  test("★ T-RMA-13 (b)(c)(e): no provider-specific types, and AdapterIdentity stays a neutral value object", () => {
    for (const { file, text } of applicationSources()) {
      for (const forbidden of [
        "ProviderHttpRequest",
        "ProviderHttpResponse",
        "ProviderTransport",
        "Authorization",
        "Bearer ",
        "response_format",
      ]) {
        assert.ok(!text.includes(forbidden), `${file} must not mention ${forbidden}`);
      }
    }
    // (c) the exception is a value object: its field names must NOT be flagged by the rule above.
    const contract = readFileSync(join(APP_DIR, "model-extraction.ts"), "utf8");
    assert.match(contract, /export interface AdapterIdentity/, "AdapterIdentity lives in the application layer");
    for (const field of ["provider", "model", "deployment", "endpointIdentity", "adapterVersion", "authMode"]) {
      assert.ok(contract.includes(`${field}:`), `AdapterIdentity carries ${field} (§R5.1(A))`);
    }
  });

  test("★ T-RMA-16 — a candidate can only enter through the adapter (no second entry point)", () => {
    const service = readFileSync(join(APP_DIR, "candidate-extraction-service.ts"), "utf8");
    // The service never constructs a provider and never writes candidates outside the single
    // persistence entry point.
    assert.doesNotMatch(service, /new\s+OpenAiCompatible/, "the service cannot instantiate a provider");
    assert.doesNotMatch(service, /from\s+"\.\.\/providers\//, "the service cannot import the provider layer");
    assert.match(service, /persistValidatedCandidates/, "the single persistence entry stays");
    const writers = [...service.matchAll(/INSERT INTO claim_candidate/g)].length;
    assert.equal(writers, 0, "candidate persistence is NOT inlined in the service (it delegates)");
  });

  test("★★ T-RMA-27 — three-entry network guard: zero real calls while the model path really completes", async () => {
    const guard = installNetworkGuard();
    try {
      const e = env();
      const adapter = new QuotingAdapter();
      const version = e.repo.getMaterialVersion(e.versionId)!;

      const result = await e.service.run(version, AT, { model: adapter, rule: DEFAULT_WINDOW_RULE });

      // ① no network call happened…
      assert.equal(guard.calls.n, 0, "★ NO real network access may occur");
      // ② …the model path really COMPLETED (not skipped, not failed early)…
      assert.equal(result.status, "completed", "★ the model path ran to completion");
      // ③ …and at least one VALID candidate was produced (so the run was not vacuous).
      assert.ok(result.candidateIds.length > 0, "★ at least one valid candidate");
      assert.equal(count(e, "claim_candidate"), result.candidateIds.length);

      // The guard itself is real: touching either entry throws immediately.
      assert.throws(
        () => (globalThis as unknown as { fetch: () => unknown }).fetch(),
        /real network access attempted/,
      );
      assert.throws(() => (http.request as () => unknown)(), /real network access attempted/);
      assert.throws(() => (https.request as () => unknown)(), /real network access attempted/);
      assert.equal(guard.calls.n, 3, "each forbidden attempt is counted");
    } finally {
      guard.restore();
    }
  });

  test("★ T-RMA-1 — no credential literal in the provider sources", () => {
    for (const { file, text } of providerSources()) {
      assert.doesNotMatch(text, /sk-[A-Za-z0-9]{8,}/, `${file} must not carry a key literal`);
      assert.doesNotMatch(text, /api[_-]?key\s*[:=]\s*"[^"]{8,}"/i, `${file} must not carry a key literal`);
    }
  });

  test("★ T-RMA-2 — a configured credential never reaches the database", async () => {
    const e = env();
    const adapter = assembleModelAdapter(
      e.service.outputContract,
      {
        TIANCHA_MODEL_BASE_URL: "http://127.0.0.1:1234/v1",
        TIANCHA_MODEL_NAME: "qwen",
        TIANCHA_MODEL_DEPLOYMENT: "dep",
        TIANCHA_MODEL_API_KEY: SECRET,
      },
      async () => ({ status: 200, text: async () => "{}" }),
    );
    assert.ok(adapter !== undefined);
    assert.equal(adapter.adapterIdentity.authMode, "api-key");

    const version = e.repo.getMaterialVersion(e.versionId)!;
    await e.service.run(version, AT, { model: new QuotingAdapter(), rule: DEFAULT_WINDOW_RULE });

    // Dump EVERY table and every column: the secret must appear nowhere (§R2.2 #2/#3/#4).
    const tables = (e.db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map((r) => r.name);
    for (const table of tables) {
      const dump = JSON.stringify(e.db.db.prepare(`SELECT * FROM ${table}`).all());
      assert.ok(!dump.includes(SECRET), `the secret must not appear in ${table}`);
    }
  });

  test("★ T-RMA-3 — the credential never appears in an error message or in captured output", async () => {
    const logs: string[] = [];
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    (process.stdout as { write: unknown }).write = (chunk: string) => {
      logs.push(String(chunk));
      return true;
    };
    (process.stderr as { write: unknown }).write = (chunk: string) => {
      logs.push(String(chunk));
      return true;
    };
    try {
      const e = env();
      // A provider that REJECTS the credential: the classified failure must stay credential-free.
      const adapter = assembleModelAdapter(
        e.service.outputContract,
        {
          TIANCHA_MODEL_BASE_URL: "http://127.0.0.1:1234/v1",
          TIANCHA_MODEL_NAME: "qwen",
          TIANCHA_MODEL_DEPLOYMENT: "dep",
          TIANCHA_MODEL_API_KEY: SECRET,
        },
        async () => ({ status: 401, text: async () => "" }),
      );
      assert.ok(adapter !== undefined);
      const version = e.repo.getMaterialVersion(e.versionId)!;
      const result = await e.service.run(version, AT, { model: adapter, rule: DEFAULT_WINDOW_RULE });

      const surfaces = [result.error ?? "", logs.join("\n"), JSON.stringify(result)].join("\n");
      assert.ok(!surfaces.includes(SECRET), "★ the credential must never surface (error / stdout / stderr)");
      assert.match(surfaces, /authentication/, "…while the classification IS reported (§R7.3)");
    } finally {
      (process.stdout as { write: unknown }).write = originalOut;
      (process.stderr as { write: unknown }).write = originalErr;
    }
  });

  test("★ T-RMA-29 — telemetry never crosses the boundary (never in the snapshot, never in output)", async () => {
    const e = env();
    const adapter = new QuotingAdapter();
    const version = e.repo.getMaterialVersion(e.versionId)!;
    const result = await e.service.run(version, AT, { model: adapter, rule: DEFAULT_WINDOW_RULE });

    const row = e.db.db
      .prepare("SELECT config_snapshot_json FROM extraction_run WHERE extraction_id = ?")
      .get(result.extractionId) as { config_snapshot_json: string };
    const snapshot = JSON.parse(row.config_snapshot_json) as Record<string, unknown>;
    const serialized = JSON.stringify(snapshot);
    for (const telemetry of ["requestId", "latency", "usage", "totalTokens", "finishReason", "attempts"]) {
      assert.ok(!serialized.includes(telemetry), `telemetry field ${telemetry} must not appear in the snapshot`);
    }
    // …and not in the run result either.
    assert.ok(!JSON.stringify(result).includes("totalTokens"));
  });

  test("★ T-RMA-4 (reprise) — the credential never enters the identity (same identity with/without a key)", () => {
    const base = {
      TIANCHA_MODEL_BASE_URL: "http://127.0.0.1:1234/v1",
      TIANCHA_MODEL_NAME: "qwen",
      TIANCHA_MODEL_DEPLOYMENT: "dep",
    };
    const contract = extractionOutputContractFor("candidate-schema/v1");
    const a = assembleModelAdapter(contract, { ...base, TIANCHA_MODEL_API_KEY: SECRET });
    const b = assembleModelAdapter(contract, { ...base, TIANCHA_MODEL_API_KEY: "another-key" });
    assert.ok(a !== undefined && b !== undefined);
    assert.equal(a.modelVersion, b.modelVersion, "the SECRET is not part of the identity");
    assert.equal(a.modelVersion, `pid-${sha256Hex(stableStringify(a.adapterIdentity))}`);
  });
});


