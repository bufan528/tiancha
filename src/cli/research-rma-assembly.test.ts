/**
 * C6 · RMA · Slice A-1 — the ASSEMBLY-layer tests, driven through the REAL CLI entry point
 * (`runCandidateExtract`), not through a fake.
 *
 *   T-RMA-21  configured but credential-less ⇒ `configuration`, and explicitly NOT
 *             `ADAPTER_NOT_CONFIGURED` (§R2.3 — the two must never be confused)
 *             + partially configured ⇒ `configuration`
 *             + `AUTH_MODE="none"` against a non-loopback endpoint ⇒ `configuration` (§R2.1)
 *   T-RMA-30  path (3): ready ⇒ an assembled adapter carrying the canonical identity
 *   T-RMA-31  the ONLY assembly entry: the CLI seam never instantiates a provider adapter
 *
 * ★ Environment note: `resolveModelAdapter()` reads the process environment by contract (§R2.1), so
 * these tests set and restore the model variables around each case. No real network is touched: the
 * failing paths never reach a transport, and the ready path only CONSTRUCTS.
 */

import { test, describe, after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CandidateExtractionService,
  ChainProjectionService,
  DiligencePreparationService,
  EchoDataProvider,
  EvaluationService,
  ExplicitBlockExtractor,
  MaterialIngestService,
  MaterialVersionService,
  PriorityService,
  QuestionTargetFitService,
  ReportService,
  ResearchDb,
  ResearchNeedService,
  ResearchRepository,
  SqliteArtifactStore,
  TargetService,
  sha256Hex,
} from "@tiancha/research";
import { resolveModelAdapter, runCandidateExtract, type ResearchCliDeps } from "./research-commands.js";

const AT = "2026-09-27T00:00:00.000Z";

const RAW = [
  "第一段：市场规模约 500 亿元。",
  "第二段：头部客户开始小批量采购。",
  "[CANDIDATE]",
  "dimension: market",
  "kind: fact",
  "statement: 2025 年全球出货约 2.5 万台",
  "evidence: paragraph:0",
  "[/CANDIDATE]",
  "",
].join("\n\n");

const MODEL_ENV_KEYS = [
  "TIANCHA_MODEL_BASE_URL",
  "TIANCHA_MODEL_NAME",
  "TIANCHA_MODEL_DEPLOYMENT",
  "TIANCHA_MODEL_AUTH_MODE",
  "TIANCHA_MODEL_API_KEY",
  "TIANCHA_MODEL_CREDENTIAL_FILE",
] as const;

/** Set exactly these model variables for one test, restoring the previous state afterwards. */
function withModelEnv(t: TestContext, values: Record<string, string>): void {
  const saved = new Map<string, string | undefined>();
  for (const key of MODEL_ENV_KEYS) saved.set(key, process.env[key]);
  for (const key of MODEL_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  t.after(() => {
    for (const key of MODEL_ENV_KEYS) {
      const previous = saved.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });
}

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

interface Env {
  db: ResearchDb;
  repo: ResearchRepository;
  versionId: string;
  lines: string[];
  deps: ResearchCliDeps;
}

function env(): Env {
  const db = new ResearchDb({ path: ":memory:" });
  opened.push(db);
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  repo.upsertMaterial({
    materialId: "mat-1",
    subjectKind: "industry",
    subjectId: "ind-1",
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
  const version = new MaterialVersionService(repo).registerVersion({
    materialId: "mat-1",
    rawText: RAW,
    createdAt: AT,
  }).version;
  const lines: string[] = [];
  const deps: ResearchCliDeps = {
    repo,
    evaluation: new EvaluationService(db.db),
    priority: new PriorityService(db.db),
    reports: new ReportService(db.db),
    materials: new MaterialIngestService(repo, new EchoDataProvider(), artifacts),
    targets: new TargetService(db.db),
    chain: new ChainProjectionService(db.db),
    needs: new ResearchNeedService(db.db),
    fits: new QuestionTargetFitService(db.db),
    diligence: new DiligencePreparationService(db.db),
    extraction: new CandidateExtractionService(repo, new ExplicitBlockExtractor(repo)),
    reportDir: `${process.cwd()}/.unused-rma-report-dir`,
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR:${l}`),
  };
  return { db, repo, versionId: version.materialVersionId, lines, deps };
}

function tableCount(e: Env, table: string): number {
  return (e.db.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

const READY_ENV = {
  TIANCHA_MODEL_BASE_URL: "http://127.0.0.1:1234/v1",
  TIANCHA_MODEL_NAME: "qwen2.5-7b",
  TIANCHA_MODEL_DEPLOYMENT: "local-4060",
  TIANCHA_MODEL_AUTH_MODE: "none",
};

describe("Slice A-1 — the assembly boundary (§R7.5)", () => {
  test("T-RMA-21: configured but with NO credential ⇒ `configuration`, never ADAPTER_NOT_CONFIGURED", async (t) => {
    withModelEnv(t, {
      TIANCHA_MODEL_BASE_URL: "http://127.0.0.1:1234/v1",
      TIANCHA_MODEL_NAME: "qwen2.5-7b",
      TIANCHA_MODEL_DEPLOYMENT: "local-4060",
      // no AUTH_MODE and no key ⇒ the credential is simply missing
    });
    const e = env();

    const code = await runCandidateExtract(e.versionId, { json: true, model: true, operator: "alice" }, e.deps);

    assert.equal(code, 1, "an unusable assembly is a non-zero exit");
    const payload = JSON.parse(e.lines[0]!) as { status: string; reason: string };
    assert.equal(payload.status, "failed");
    assert.equal(payload.reason, "configuration", "★ the reason is the CLASSIFIED code, not 'no adapter'");
    assert.notEqual(payload.reason, "ADAPTER_NOT_CONFIGURED", "★ the two causes stay distinguishable");
    assert.equal(tableCount(e, "extraction_run"), 0, "★ zero residue: no attempt row was ever created");
    assert.equal(tableCount(e, "claim_candidate"), 0, "★ and the legacy path was NOT used instead");
  });

  test("T-RMA-21b: a PARTIAL instance configuration is a configuration error (never 'absent')", async (t) => {
    withModelEnv(t, { TIANCHA_MODEL_NAME: "qwen2.5-7b" });
    const e = env();

    const code = await runCandidateExtract(e.versionId, { json: true, model: true, operator: "alice" }, e.deps);

    assert.equal(code, 1);
    const payload = JSON.parse(e.lines[0]!) as { reason: string };
    assert.equal(payload.reason, "configuration");
    assert.equal(tableCount(e, "extraction_run"), 0);
  });

  test('T-RMA-21c: AUTH_MODE="none" against a NON-loopback endpoint ⇒ configuration', async (t) => {
    withModelEnv(t, {
      TIANCHA_MODEL_BASE_URL: "https://api.example.com/v1",
      TIANCHA_MODEL_NAME: "qwen2.5-7b",
      TIANCHA_MODEL_DEPLOYMENT: "remote",
      TIANCHA_MODEL_AUTH_MODE: "none",
    });
    const e = env();

    const code = await runCandidateExtract(e.versionId, { json: true, model: true, operator: "alice" }, e.deps);

    assert.equal(code, 1);
    assert.equal((JSON.parse(e.lines[0]!) as { reason: string }).reason, "configuration");
    assert.equal(tableCount(e, "extraction_run"), 0);
  });

  test("T-RMA-30 (3): ready ⇒ an assembled adapter whose identity is canonical and carries authMode", (t) => {
    withModelEnv(t, READY_ENV);
    const e = env();

    const adapter = resolveModelAdapter(e.deps.extraction!.outputContract);

    assert.ok(adapter !== undefined, "the ready path yields an adapter (path (3) of §R7.5)");
    assert.equal(adapter.adapterIdentity.provider, "openai-compatible");
    assert.equal(adapter.adapterIdentity.endpointIdentity, "http://127.0.0.1:1234/v1");
    assert.equal(adapter.adapterIdentity.authMode, "none", "§R2.1 — authMode participates in the identity");
    assert.match(adapter.modelVersion, /^pid-/, "§R3.1 — the canonical identity prefix");
    assert.ok(adapter.promptVersion.length > 0 && adapter.parserVersion.length > 0);
  });

  test("T-RMA-31: the CLI seam is the ONLY assembly entry — it never instantiates a provider adapter", () => {
    const source = readFileSync(new URL("./research-commands.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /new\s+OpenAiCompatibleModelAdapter\s*\(/, "no direct instantiation");
    assert.doesNotMatch(source, /new\s+.*Adapter\s*\(/, "no other adapter instantiation either");
    // …and the provider detail really lives in the package, not in this seam.
    assert.doesNotMatch(source, /openai|anthropic/i, "no provider name in the CLI seam");
  });
});
