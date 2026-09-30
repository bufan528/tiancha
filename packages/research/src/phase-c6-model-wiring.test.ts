/**
 * C6 model-extractor · Slice F2 acceptance — the MODEL WIRING (§M14).
 *
 *   W-1  model path end-to-end: windows → batches → resolveQuotes → ValidatedCandidate[] → persist
 *   W-2  ★ per-batch: one `extractBatch` per window, in `window.index` order, `batchCount` recorded
 *   W-3  ★ identity dispatch: `mxcfg-…` (model) vs `xcfg-…` (legacy); the two never reuse each other;
 *        changing the window rule / dimensions changes the config key AND therefore the candidate id
 *   W-4  ★ zero tolerance: one bad quote (V1–V4) fails the WHOLE run with ZERO business residue
 *   W-5  ★ timeout + abort: ONE controller for the whole run, the adapter really receives the abort,
 *        the run is NOT closed out as `completed` (timeout ≠ lease failure)
 *   W-7  ★ exactly ONE model call per lease: two INDEPENDENT connections, the loser performs none
 *   W-8  ★ completed reuse on the model path: the second call performs NO model call at all
 *   W-9  ★ dimensions come from the ACTIVE METHODOLOGY, in its DECLARED order (never sorted)
 *   W-10 legacy still works through the SAME persistence entry point, with a `xcfg-` identity
 *   (W-6 / W-11 — `ADAPTER_NOT_CONFIGURED` at the assembly layer — live in
 *    `src/cli/research-candidate-extract.test.ts`: that failure is a CLI-assembly behaviour.)
 *
 * Contract: `docs/phaseC/c6-model-extractor-contract.md` rev13 §M14. ★ NO REAL MODEL IS INVOLVED:
 * every adapter below is a deterministic TEST-ONLY fake (§M14.7). Nothing in this file may be
 * exported by production, wired into the CLI, or described as "the model is integrated".
 *
 * Assertions are behavioural: rows, ids, statuses, call counts, fingerprints — never log wording.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { MaterialVersionService } from "./application/material-version-service.js";
import {
  CandidateExtractionService,
  ExplicitBlockExtractor,
  DEFAULT_WINDOW_RULE,
} from "./application/candidate-extraction-service.js";
import type {
  ModelBatchInput,
  ModelBatchResult,
  ModelCandidateDraft,
  ModelExtractionAdapter,
} from "./application/model-extraction.js";
import { normalizeText, resolveLocator, sha256Hex, type MaterialVersion } from "./domain/material-source.js";
import { METHODOLOGY_V1 } from "./methodology/methodology-v1.js";

const AT = "2026-09-27T00:00:00.000Z";
const AT2 = "2026-09-27T01:00:00.000Z";

/** Paragraphs 0/1 carry text for the model path; the `[CANDIDATE]` block serves the legacy path. */
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

/** ONLY two paragraphs — no `[CANDIDATE]` block — so the model path sees exactly TWO windows. */
const TWO_PARAGRAPHS = ["第一段：市场规模约 500 亿元。", "第二段：头部客户开始小批量采购。", ""].join("\n\n");

/** A rule small enough to put each of the two paragraphs in its OWN window (§M4.3 constraints). */
const TWO_WINDOW_RULE = {
  ...DEFAULT_WINDOW_RULE,
  maxChars: 20,
  overlapChars: 18,
  maxQuoteChars: 18,
};

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

// ---------------------------------------------------------------------------
// ★ TEST-ONLY deterministic fakes (never a production export, §M14.7)
// ---------------------------------------------------------------------------

/** Quote the first sentence of the window — deterministic, and a real substring by construction. */
function firstSentencePlan(input: ModelBatchInput): ModelCandidateDraft[] {
  const stop = input.window.text.indexOf("。");
  const end = stop === -1 ? Math.min(10, input.window.text.length) : stop + 1;
  if (end <= 0) return [];
  return [
    {
      dimension: "market",
      statement: `候选@窗口${input.window.index}`,
      contentKind: "fact",
      confidence: 0.5,
      quotes: [
        {
          windowId: input.window.windowId,
          startInWindow: 0,
          endInWindow: end,
          text: input.window.text.slice(0, end),
        },
      ],
    },
  ];
}

class FakeModelAdapter implements ModelExtractionAdapter {
  readonly modelVersion = "fake-model-1";
  readonly promptVersion = "fake-prompt-1";
  readonly parserVersion = "fake-parser-1";
  readonly adapterIdentity = {
    provider: "fake",
    model: "fake-model-1",
    deployment: "fake-deployment-1",
    endpointIdentity: "127.0.0.1:1",
    adapterVersion: "fake-adapter-1",
    authMode: "none",
  } as const;
  readonly generationParams = {};
  calls = 0;
  readonly batches: ModelBatchInput[] = [];
  aborted = false;

  constructor(private readonly plan: (input: ModelBatchInput) => ModelCandidateDraft[] = firstSentencePlan) {}

  async extractBatch(input: ModelBatchInput, signal: AbortSignal): Promise<ModelBatchResult> {
    this.calls += 1;
    this.batches.push(input);
    if (signal.aborted) this.aborted = true;
    signal.addEventListener("abort", () => {
      this.aborted = true;
    });
    return { candidates: this.plan(input) };
  }
}

/** NEVER resolves unless aborted — the W-5 probe. It records whether it saw the abort. */
class HangingModelAdapter implements ModelExtractionAdapter {
  /** Must MATCH `FakeModelAdapter`: the config key includes these, so two connections claim ONE run. */
  readonly modelVersion = "fake-model-1";
  readonly promptVersion = "fake-prompt-1";
  readonly parserVersion = "fake-parser-1";
  readonly adapterIdentity = {
    provider: "fake",
    model: "fake-model-1",
    deployment: "fake-deployment-1",
    endpointIdentity: "127.0.0.1:1",
    adapterVersion: "fake-adapter-1",
    authMode: "none",
  } as const;
  readonly generationParams = {};
  aborted = false;
  calls = 0;

  async extractBatch(_input: ModelBatchInput, signal: AbortSignal): Promise<ModelBatchResult> {
    this.calls += 1;
    return new Promise<ModelBatchResult>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        this.aborted = true;
        reject(new Error("aborted by the run's AbortController"));
      });
    });
  }
}

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

interface Env {
  db: ResearchDb;
  repo: ResearchRepository;
  version: MaterialVersion;
  /** legacy path: the deterministic `[CANDIDATE]` extractor */
  legacy: CandidateExtractionService;
}

function seedMaterial(repo: ResearchRepository, rawText: string = RAW): void {
  repo.upsertMaterial({
    materialId: "mat-1",
    subjectKind: "industry",
    subjectId: "ind-1",
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
}

function env(rawText: string = RAW): Env {
  const db = new ResearchDb({ path: ":memory:" });
  opened.push(db);
  const repo = new ResearchRepository(db.db);
  seedMaterial(repo, rawText);
  const version = new MaterialVersionService(repo).registerVersion({
    materialId: "mat-1",
    rawText,
    createdAt: AT,
  }).version;
  return { db, repo, version, legacy: new CandidateExtractionService(repo, new ExplicitBlockExtractor(repo)) };
}

function counts(e: Env): { fragments: number; evidence: number; candidates: number } {
  const one = (sql: string): number => (e.db.db.prepare(sql).get() as { c: number }).c;
  return {
    fragments: one("SELECT COUNT(*) AS c FROM fragment"),
    evidence: one("SELECT COUNT(*) AS c FROM fragment_evidence"),
    candidates: one("SELECT COUNT(*) AS c FROM claim_candidate"),
  };
}

function runRow(e: Env, extractionId: string): Record<string, unknown> {
  const row = e.db.db.prepare("SELECT * FROM extraction_run WHERE extraction_id = ?").get(extractionId) as
    | Record<string, unknown>
    | undefined;
  assert.ok(row !== undefined, `extraction_run ${extractionId} must exist`);
  return row;
}

describe("Slice F2 — the model wiring (§M14)", () => {
  test("W-1: the model path runs end-to-end and lands candidates through the ONE persistence entry", async () => {
    const e = env();
    const adapter = new FakeModelAdapter();

    const result = await e.legacy.run(e.version, AT, { model: adapter, owner: "o1" });

    assert.equal(result.status, "completed");
    assert.equal(result.created, 1, "one window ⇒ one candidate");
    assert.equal(result.reusedRun, false);
    assert.equal(adapter.calls, 1);

    const stored = e.repo.getClaimCandidate(result.candidateIds[0]!)!;
    assert.equal(stored.dimension, "market");
    assert.equal(stored.reviewStatus, "draft");
    assert.equal(stored.projectionStatus, "none");
    // ★ the four-way identity (§M5.3) still holds on the model path
    const evidence = e.repo.getFragmentEvidence(stored.evidenceRefs[0]!)!;
    const fragment = e.repo.getFragment(evidence.fragmentId)!;
    assert.equal(fragment.text, evidence.quoteText);
    assert.equal(fragment.textHash, evidence.quoteHash);
    assert.equal(resolveLocator(normalizeText(RAW), fragment.locator), fragment.text);
    // ★ the run closed out with a model identity
    const row = runRow(e, result.extractionId);
    assert.equal(row.status, "completed");
    assert.match(String(row.extraction_config_key), /^mxcfg-/);
  });

  test("W-2: ★ one batch per window, in window order, and `batchCount` is recorded", async () => {
    const e = env(TWO_PARAGRAPHS);
    const adapter = new FakeModelAdapter();

    const result = await e.legacy.run(e.version, AT, { model: adapter, rule: TWO_WINDOW_RULE, owner: "o1" });

    assert.equal(result.status, "completed");
    assert.equal(adapter.calls, 2, "one `extractBatch` per window");
    assert.deepEqual(
      adapter.batches.map((b) => b.window.index),
      [0, 1],
      "batches arrive in `window.index` ascending order",
    );
    assert.equal(adapter.batches[0]!.windowStartInVersion, 0);
    assert.ok(
      adapter.batches[1]!.windowStartInVersion > adapter.batches[0]!.windowStartInVersion,
      "each batch is told where its window sits in the version",
    );
    const snapshot = JSON.parse(runRow(e, result.extractionId).config_snapshot_json as string) as {
      run: { batchCount: number };
    };
    assert.equal(snapshot.run.batchCount, 2, "the snapshot records the real batch count");
    assert.equal(result.created, 2, "two windows ⇒ two candidates");
  });

  test("W-3: ★ `mxcfg-` vs `xcfg-` — and changing the rule changes the candidate identity", async () => {
    const e = env();
    const adapter = new FakeModelAdapter();

    const model = await e.legacy.run(e.version, AT, { model: adapter, owner: "o1" });
    const legacy = await e.legacy.run(e.version, AT, { owner: "o1" });

    const modelRow = runRow(e, model.extractionId);
    const legacyRow = runRow(e, legacy.extractionId);
    assert.match(String(modelRow.extraction_config_key), /^mxcfg-/);
    assert.match(String(legacyRow.extraction_config_key), /^xcfg-/);
    assert.notEqual(modelRow.extraction_config_key, legacyRow.extraction_config_key);

    // ★ the two paths did NOT reuse each other's run: both really ran and both wrote their own rows
    assert.equal(model.status, "completed");
    assert.equal(legacy.status, "completed");
    assert.equal(model.reusedRun, false);
    assert.equal(legacy.reusedRun, false);

    // ★ a different window rule ⇒ a different config key ⇒ a different candidate id
    const narrower = new FakeModelAdapter();
    const other = await e.legacy.run(e.version, AT, { model: narrower, rule: TWO_WINDOW_RULE, owner: "o1" });
    const otherRow = runRow(e, other.extractionId);
    assert.match(String(otherRow.extraction_config_key), /^mxcfg-/);
    assert.notEqual(otherRow.extraction_config_key, modelRow.extraction_config_key);
    const modelIds = new Set(model.candidateIds);
    assert.ok(
      other.candidateIds.every((id) => !modelIds.has(id)),
      "a changed rule produces NEW candidate ids (never a silent reuse)",
    );
  });

  test("W-4: ★ zero tolerance — one bad quote fails the WHOLE run with zero residue", async () => {
    const e = env();
    const liar = new FakeModelAdapter((input) => [
      {
        dimension: "market",
        statement: "不可信的候选",
        contentKind: "fact",
        quotes: [
          {
            windowId: input.window.windowId,
            startInWindow: 0,
            endInWindow: 5,
            // V3: NOT the window slice, character for character.
            text: "这段文字并不在窗口里",
          },
        ],
      },
    ]);

    const result = await e.legacy.run(e.version, AT, { model: liar, owner: "o1" });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /quote #0/, "the failure names the offending quote");
    assert.deepEqual(counts(e), { fragments: 0, evidence: 0, candidates: 0 }, "zero business residue");
    const row = runRow(e, result.extractionId);
    assert.equal(row.status, "failed", "the caller closed the run out, outside the transaction");
    assert.equal(row.candidate_ids_json, "[]");
  });

  test("W-5: ★ timeout aborts the WHOLE run, the adapter sees the abort, and nothing is completed", async () => {
    const e = env();
    const hanging = new HangingModelAdapter();

    const result = await e.legacy.run(e.version, AT, { model: hanging, timeoutMs: 40, owner: "o1" });

    assert.equal(result.status, "failed");
    // ★ NOTE (pre-existing, NOT introduced by F2): `§M10 T-C6-34` says the error starts with
    // `timeout:`, while BOTH paths actually report the legacy wording (`extraction timed out after
    // Nms`). F2 mirrors the legacy path rather than silently changing an existing message; the
    // discrepancy is reported for adjudication, not "fixed" here.
    assert.match(result.error ?? "", /timed out/, "a timeout is reported as a timeout");
    assert.equal(hanging.aborted, true, "★ the adapter really received the abort");
    assert.deepEqual(counts(e), { fragments: 0, evidence: 0, candidates: 0 });
    const row = runRow(e, result.extractionId);
    assert.equal(row.status, "running", "★ timeout ≠ lease failure: the row is NOT closed out");
    assert.equal(row.finished_at, null);
  });

  test("W-7: ★ exactly ONE model call per lease — the loser performs none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tiancha-c6f2-"));
    dirs.push(dir);
    const dbPath = join(dir, "tiancha.sqlite");

    const a = new ResearchDb({ path: dbPath });
    const b = new ResearchDb({ path: dbPath });
    opened.push(a, b);
    const repoA = new ResearchRepository(a.db);
    const repoB = new ResearchRepository(b.db);
    seedMaterial(repoA);
    const version = new MaterialVersionService(repoA).registerVersion({
      materialId: "mat-1",
      rawText: RAW,
      createdAt: AT,
    }).version;

    const hanging = new HangingModelAdapter();
    const loserAdapter = new FakeModelAdapter();
    const serviceA = new CandidateExtractionService(repoA, new ExplicitBlockExtractor(repoA));
    const serviceB = new CandidateExtractionService(repoB, new ExplicitBlockExtractor(repoB));

    // A claims the run and hangs inside the model call (it still holds a LIVE lease). Its own
    // deadline is short so the case cannot keep the process alive after the assertions.
    const pending = serviceA.run(version, AT, {
      model: hanging,
      owner: "owner-A",
      leaseMs: 600_000,
      timeoutMs: 300,
    });
    await Promise.resolve();

    const second = await serviceB.run(version, AT, { model: loserAdapter, owner: "owner-B", leaseMs: 600_000 });

    assert.equal(second.reusedRun, false);
    assert.equal(second.extractionId, "", "the loser obtained no run");
    assert.ok(second.in_progress !== undefined, "the loser is told a live run holds the lease");
    assert.equal(loserAdapter.calls, 0, "★ the loser performed NO model call");
    assert.equal(hanging.calls, 1, "★ exactly one model call happened inside the live lease");

    // ...and A's own call ends as a TIMEOUT (which, per §M14.5, is NOT a lease failure)
    const first = await pending;
    assert.equal(first.status, "failed");
    assert.match(first.error ?? "", /timed out/);
    assert.equal(hanging.aborted, true);
  });

  test("W-8: ★ completed reuse on the model path performs NO model call at all", async () => {
    const e = env();
    const adapter = new FakeModelAdapter();

    const first = await e.legacy.run(e.version, AT, { model: adapter, owner: "o1" });
    assert.equal(first.status, "completed");
    assert.equal(adapter.calls, 1);
    const callsAfterFirst = adapter.calls;
    const rowBefore = runRow(e, first.extractionId);
    const countsBefore = counts(e);

    const second = await e.legacy.run(e.version, AT2, { model: adapter, owner: "o1" });

    assert.equal(second.reusedRun, true);
    assert.equal(second.extractionId, first.extractionId);
    assert.equal(second.created, 0);
    assert.deepEqual(second.candidateIds, first.candidateIds);
    assert.equal(adapter.calls, callsAfterFirst, "★ reuse performs NO model call");
    assert.deepEqual(runRow(e, first.extractionId), rowBefore, "the completed row is byte-identical");
    assert.deepEqual(counts(e), countsBefore);
  });

  test("W-9: ★ dimensions come from the ACTIVE METHODOLOGY, in its declared order", async () => {
    const e = env();
    const adapter = new FakeModelAdapter();
    const active = e.repo.getActiveMethodology() ?? METHODOLOGY_V1;
    const declared = active.dimensions.map((d) => d.key);

    const result = await e.legacy.run(e.version, AT, { model: adapter, owner: "o1" });

    assert.equal(result.status, "completed");
    assert.deepEqual(adapter.batches[0]!.dimensionHints, declared, "★ the model is told the declared order");
    assert.equal(adapter.batches[0]!.methodologyVersionId, active.versionId);
    const snapshot = JSON.parse(runRow(e, result.extractionId).config_snapshot_json as string) as {
      methodology: { methodologyVersionId: string; dimensionHints: string[] };
    };
    assert.equal(snapshot.methodology.methodologyVersionId, active.versionId);
    assert.deepEqual(snapshot.methodology.dimensionHints, declared);
  });

  test("W-10: the legacy path still runs, through the SAME persistence entry point", async () => {
    const e = env();

    const legacy = await e.legacy.run(e.version, AT, { owner: "o1" });

    assert.equal(legacy.status, "completed");
    assert.equal(legacy.created, 1, "the [CANDIDATE] block still produces its candidate");
    const stored = e.repo.getClaimCandidate(legacy.candidateIds[0]!)!;
    assert.equal(stored.statement, "2025 年全球出货约 2.5 万台");
    assert.match(stored.extractionConfigKey, /^xcfg-/, "★ the legacy identity is unchanged");
    // and the model path on the same material mints a DIFFERENT identity (§M11.2 distinguishability)
    const model = await e.legacy.run(e.version, AT2, { model: new FakeModelAdapter(), owner: "o1" });
    assert.ok(
      model.candidateIds.every((id) => id !== legacy.candidateIds[0]),
      "★ the two paths never share a candidate id",
    );
  });
});
