/**
 * C6 model-extractor · Slice F2 — the ASSEMBLY layer (§M14.1 / §M14.6).
 *
 *   W-6   ★ `--model` with NO adapter is an HONEST failure at the assembly layer: non-zero exit,
 *         NOTHING written, and the `[CANDIDATE]` path is NOT used as a silent substitute
 *   W-11  ★ the assembly-layer contract: non-zero exit code + a machine-readable reason (`--json`)
 *   W-10  (assembly side) the legacy default path really runs through the command
 *
 * ★ This slice wires NO provider on purpose: a real adapter (vendor SDK / credentials / deployment
 * identity) needs its own contract and its own authorization, so `resolveModelAdapter()` returns
 * `undefined` BY CONSTRUCTION. These cases assert exactly that — never a fake standing in for a model.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { runCandidateExtract, type ResearchCliDeps } from "./research-commands.js";

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

const opened: ResearchDb[] = [];
const dirs: string[] = [];
after(() => {
  for (const db of opened) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* windows lock */
    }
  }
});

interface Env {
  db: ResearchDb;
  repo: ResearchRepository;
  versionId: string;
  dir: string;
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
  const dir = mkdtempSync(join(tmpdir(), "tiancha-c6f2cli-"));
  dirs.push(dir);
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
    // ★ §M14.1: the extraction entry point, composed exactly as `src/cli/tiancha.ts` composes it.
    extraction: new CandidateExtractionService(repo, new ExplicitBlockExtractor(repo)),
    reportDir: join(dir, "reports"),
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR:${l}`),
  };
  return { db, repo, versionId: version.materialVersionId, dir, lines, deps };
}

function tableCount(e: Env, table: string): number {
  return (e.db.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

describe("Slice F2 — the assembly layer (§M14.1 / §M14.6)", () => {
  test("W-6: ★ `--model` without an adapter fails honestly — nothing written, no legacy substitute", async () => {
    const e = env();

    const code = await runCandidateExtract(e.versionId, { json: false, model: true, operator: "alice" }, e.deps);

    assert.equal(code, 1, "a model path with no adapter is a non-zero exit");
    const text = e.lines.join("\n");
    assert.match(text, /ADAPTER_NOT_CONFIGURED/, "the reason is stated, machine-readably");
    assert.equal(tableCount(e, "claim_candidate"), 0, "★ NOTHING was written");
    assert.equal(tableCount(e, "extraction_run"), 0, "★ `run()` was never entered: no attempt row");
    assert.equal(tableCount(e, "fragment"), 0);
    // ★ and the legacy `[CANDIDATE]` path was NOT silently used instead
    assert.equal(tableCount(e, "claim_candidate"), 0, "the [CANDIDATE] path did not stand in");
    assert.ok(!/extract\]/.test(text), "no run summary was produced");
  });

  test("W-11: ★ the assembly-layer exit code and the machine-readable reason (`--json`)", async () => {
    const e = env();

    const code = await runCandidateExtract(e.versionId, { json: true, model: true, operator: "alice" }, e.deps);

    assert.equal(code, 1);
    const payload = JSON.parse(e.lines[0]!) as { status: string; reason: string };
    assert.equal(payload.status, "failed");
    assert.equal(payload.reason, "ADAPTER_NOT_CONFIGURED");
    assert.equal(tableCount(e, "extraction_run"), 0, "★ the model path wrote no run at all");

    // ★ an unknown material version is refused the same way (never a silent no-op)
    const unknown = await runCandidateExtract("mv-does-not-exist", { json: false, operator: "alice" }, e.deps);
    assert.equal(unknown, 1);
    assert.match(e.lines.join("\n"), /unknown material version/);

    // ★ `--model` without `--operator` is refused BEFORE anything else (who asked for the call)
    const noOperator = await runCandidateExtract(e.versionId, { json: false, model: true }, e.deps);
    assert.equal(noOperator, 1);
    assert.match(e.lines.join("\n"), /--operator is required with --model/);
  });

  test("W-10 (assembly side): the legacy default path really runs through the command", async () => {
    const e = env();

    // ★ NO `--model`: the existing legacy `[CANDIDATE]` default path (a default, not a fallback)
    const code = await runCandidateExtract(e.versionId, { json: false, operator: "alice" }, e.deps);

    assert.equal(code, 0, "a completed legacy run exits 0");
    assert.match(e.lines.join("\n"), /status=completed/, "the run summary reports the terminal state");
    assert.equal(tableCount(e, "claim_candidate"), 1, "the [CANDIDATE] block produced its candidate");
    assert.equal(tableCount(e, "extraction_run"), 1, "exactly one attempt row");
    const stored = e.repo.listClaimCandidates(e.versionId)[0]!;
    assert.match(stored.extractionConfigKey, /^xcfg-/, "the legacy identity is unchanged");
  });
});
