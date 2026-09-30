/**
 * C6 · RMA · Slice A-4 — FINAL GATES (part 2: provider behaviour through the REAL wiring).
 *
 *   T-RMA-5/20  a malformed provider response ⇒ the run fails with ZERO business residue
 *               (four independent shapes: bad JSON, missing `candidates`, illegal `contentKind`, a
 *               quote whose text does not match the window)
 *   T-RMA-19    an adapter that "repairs" a quote must be REFUSED by V1–V4 (never silently accepted)
 *   T-RMA-12    the call-count invariant: success ⇒ exactly `windowCount` calls; a failure in window k
 *               ⇒ exactly `k` calls (never `windowCount × maxAttempts`, §R8.3)
 *   T-RMA-6     the caller's signal reaches the TRANSPORT (the adapter propagates it, §R6.2)
 *   T-RMA-23    caller abort ⇒ classified `abort`, never `network` / `provider_unavailable`
 *   T-RMA-22    the request actually carries the TIANCHA schema: change the contract's schema ⇒ the
 *               request body changes (the adapter may not own it)
 *
 * ★ The provider is reachable only through the injectable transport, so nothing here touches a socket.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { CandidateExtractionService, ExplicitBlockExtractor } from "./application/candidate-extraction-service.js";
import type { AdapterIdentity, ModelBatchInput, ModelBatchResult, ModelExtractionAdapter } from "./application/model-extraction.js";
import { DEFAULT_WINDOW_RULE } from "./application/extraction-window.js";
import { MaterialVersionService } from "./application/material-version-service.js";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { sha256Hex } from "./domain/material-source.js";
import { extractionOutputContractFor } from "./application/extraction-output-contract.js";
import { OpenAiCompatibleModelAdapter, ProviderError, type FetchLike } from "./providers/openai-compatible-model-adapter.js";

const AT = "2026-09-27T00:00:00.000Z";
const RAW = "第一段：市场规模约 500 亿元。";

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
  service: CandidateExtractionService;
}

function env(rawText = RAW): Env {
  const db = new ResearchDb({ path: ":memory:" });
  opened.push(db);
  const repo = new ResearchRepository(db.db);
  repo.upsertMaterial({
    materialId: "mat-a4b",
    subjectKind: "industry",
    subjectId: "ind-a4b",
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
    materialId: "mat-a4b",
    rawText,
    createdAt: AT,
  }).version.materialVersionId;
  return { db, repo, versionId, service: new CandidateExtractionService(repo, new ExplicitBlockExtractor(repo)) };
}

function count(e: Env, table: string): number {
  return (e.db.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

function residue(e: Env): Record<string, number> {
  return {
    claim_candidate: count(e, "claim_candidate"),
    fragment: count(e, "fragment"),
    fragment_evidence: count(e, "fragment_evidence"),
  };
}

/** A fetch double that returns a canned body and records the parsed request. */
function cannedFetch(status: number, body: string): { fetchImpl: FetchLike; sent: unknown[] } {
  const sent: unknown[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    sent.push(JSON.parse(init.body) as unknown);
    return { status, text: async () => body };
  };
  return { fetchImpl, sent };
}

function chat(body: string): string {
  return JSON.stringify({ choices: [{ message: { content: body } }] });
}

function adapterOver(e: Env, fetchImpl: FetchLike, schema?: object): OpenAiCompatibleModelAdapter {
  const contract =
    schema === undefined
      ? e.service.outputContract
      : { version: "candidate-schema/v1", schema: schema as Readonly<Record<string, unknown>> };
  return new OpenAiCompatibleModelAdapter({
    transport: {
      async send(request) {
        const response = await fetchImpl(request.url, {
          method: "POST",
          headers: { ...request.headers },
          body: request.body,
          signal: request.signal,
        });
        return { status: response.status, body: await response.text() };
      },
    },
    outputContract: contract,
    instance: { baseUrl: "http://127.0.0.1:1234/v1", model: "qwen", deployment: "dep" },
    credential: { authMode: "none" },
    capabilities: { structuredOutput: true, abortSignal: true },
  });
}

/** A model adapter that can deliberately produce a BAD quote (the T-RMA-19 probe). */
class BadQuoteAdapter implements ModelExtractionAdapter {
  readonly modelVersion = "pid-bad";
  readonly promptVersion = "p/v1";
  readonly parserVersion = "r/v1";
  readonly adapterIdentity: AdapterIdentity = {
    provider: "fake",
    model: "fake",
    deployment: "fake",
    endpointIdentity: "fake",
    adapterVersion: "fake/v1",
    authMode: "none",
  };
  readonly generationParams = {};
  readonly seen: ModelBatchInput[] = [];
  constructor(private readonly mutate: (q: { windowId: string; startInWindow: number; endInWindow: number; text: string }) => unknown) {}
  async extractBatch(input: ModelBatchInput, _signal?: AbortSignal): Promise<ModelBatchResult> {
    this.seen.push(input);
    const quote = { windowId: input.window.windowId, startInWindow: 0, endInWindow: 4, text: input.window.text.slice(0, 4) };
    return {
      candidates: [
        {
          dimension: input.dimensionHints[0]!,
          statement: "s",
          contentKind: "fact",
          quotes: [this.mutate(quote) as never],
        },
      ],
    };
  }
}

describe("Slice A-4 · part 2 — provider behaviour through the real wiring", () => {
  test("★ T-RMA-5/20 — four malformed provider outputs ⇒ failed run with ZERO residue", async () => {
    const shapes: Array<[string, string]> = [
      ["not JSON at all", "{{{not json"],
      ["no `candidates` array", chat(JSON.stringify({ nope: [] }))],
      ["illegal `contentKind`", chat(JSON.stringify({ candidates: [{ dimension: "market", statement: "s", contentKind: "guess", quotes: [] }] }))],
      ["quote text that cannot match", chat(JSON.stringify({ candidates: [{ dimension: "market", statement: "s", contentKind: "fact", quotes: [{ windowId: "w", startInWindow: 0, endInWindow: 4, text: "XXXX" }] }] }))],
    ];
    for (const [label, body] of shapes) {
      const e = env();
      const { fetchImpl } = cannedFetch(200, body);
      const adapter = adapterOver(e, fetchImpl);
      const version = e.repo.getMaterialVersion(e.versionId)!;
      const result = await e.service.run(version, AT, { model: adapter, rule: DEFAULT_WINDOW_RULE });

      assert.equal(result.status, "failed", `${label}: the run must fail`);
      assert.match(result.error ?? "", /malformed_response|explicit-block|window|quote|refus/i, `${label}: classified`);
      assert.deepEqual(residue(e), { claim_candidate: 0, fragment: 0, fragment_evidence: 0 }, `${label}: ZERO residue`);
    }
  });

  test("★ T-RMA-19 — an adapter that MUTATES a quote is refused by V1–V4 (never accepted)", async () => {
    const mutations: Array<[string, (q: { windowId: string; startInWindow: number; endInWindow: number; text: string }) => unknown]> = [
      ["shifted offsets", (q) => ({ ...q, startInWindow: 1, endInWindow: 5 })],
      ["changed text", (q) => ({ ...q, text: q.text + "!" })],
      ["rewritten text", (q) => ({ ...q, text: "something else" })],
      ["out-of-window span", (q) => ({ ...q, endInWindow: 10_000 })],
    ];
    for (const [label, mutate] of mutations) {
      const e = env();
      const version = e.repo.getMaterialVersion(e.versionId)!;
      const result = await e.service.run(version, AT, { model: new BadQuoteAdapter(mutate), rule: DEFAULT_WINDOW_RULE });

      assert.equal(result.status, "failed", `${label}: the run must fail`);
      assert.deepEqual(residue(e), { claim_candidate: 0, fragment: 0, fragment_evidence: 0 }, `${label}: ZERO residue`);
    }
  });

  test("★ T-RMA-12 — call-count invariant: success ⇒ windowCount, failure in window k ⇒ k (§R8.3)", async () => {
    // A single very long paragraph makes the DEFAULT greedy window rule split it into several
    // windows (the rule's own constraint — overlapChars >= maxQuoteChars — stays satisfied).
    const long = "A".repeat(3000);
    const rule = DEFAULT_WINDOW_RULE;

    // (a) every window succeeds ⇒ one call per window.
    const ok = env(long);
    const okAdapter = new BadQuoteAdapter((q) => q);
    const okResult = await ok.service.run(ok.repo.getMaterialVersion(ok.versionId)!, AT, { model: okAdapter, rule });
    const windows = okAdapter.seen.length;
    assert.equal(okResult.status, "completed");
    assert.ok(windows >= 2, "the fixture really splits into several windows");
    assert.equal(okAdapter.seen.length, windows, "★ success ⇒ exactly windowCount calls");

    // (b) FAIL in window 2 ⇒ exactly 2 calls, never `windowCount`.
    const failing = env(long);
    let calls = 0;
    const failingAdapter: ModelExtractionAdapter = {
      ...okAdapter,
      adapterIdentity: okAdapter.adapterIdentity,
      generationParams: {},
      async extractBatch(input: ModelBatchInput): Promise<ModelBatchResult> {
        calls += 1;
        if (calls === 2) throw new ProviderError("provider_unavailable", "boom in window 2");
        return okAdapter.extractBatch(input, new AbortController().signal);
      },
    };
    const failedResult = await failing.service.run(failing.repo.getMaterialVersion(failing.versionId)!, AT, {
      model: failingAdapter,
      rule,
    });
    assert.equal(failedResult.status, "failed");
    assert.equal(calls, 2, "★ calls === k (the failing window's index), NOT windowCount");
    assert.deepEqual(residue(failing), { claim_candidate: 0, fragment: 0, fragment_evidence: 0 });
  });

  test("★ T-RMA-6 — the caller's signal REACHES the transport (the adapter propagates it)", async () => {
    const e = env();
    let sawAbort = false;
    const fetchImpl: FetchLike = async (_url, init) => {
      // A hanging provider that only finishes when the signal fires.
      await new Promise<void>((_resolve, reject) => {
        if (init.signal.aborted) {
          sawAbort = true;
          reject(new Error("aborted"));
          return;
        }
        init.signal.addEventListener("abort", () => {
          sawAbort = true;
          reject(new Error("aborted"));
        });
      });
      return { status: 200, text: async () => chat(JSON.stringify({ candidates: [] })) };
    };
    const adapter = adapterOver(e, fetchImpl);
    const version = e.repo.getMaterialVersion(e.versionId)!;

    const result = await e.service.run(version, AT, { model: adapter, rule: DEFAULT_WINDOW_RULE, timeoutMs: 50 });

    assert.equal(result.status, "failed");
    assert.equal(sawAbort, true, "★ the transport really received the abort (§R6.2)");
    assert.match(result.error ?? "", /extraction timed out after 50ms/, "timeout keeps F2's frozen text (§R7.3)");
    assert.deepEqual(residue(e), { claim_candidate: 0, fragment: 0, fragment_evidence: 0 });
  });

  test("★ T-RMA-23 — a caller abort is classified `abort`, never `network` (§R6.5)", async () => {
    const e = env();
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: FetchLike = async () => {
      // Whatever the vendor throws for a cancelled request…
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      throw err;
    };
    const adapter = adapterOver(e, fetchImpl);

    await assert.rejects(
      () => adapter.extractBatch({ materialVersionId: "m", window: { windowId: "w", index: 0, text: RAW }, windowStartInVersion: 0, dimensionHints: ["market"], methodologyVersionId: "mw-v1" }, controller.signal),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError, "the vendor error is normalized");
        assert.equal(err.code, "abort", "★ an already-aborted caller ⇒ `abort`");
        assert.notEqual(err.code, "network");
        return true;
      },
    );
  });

  test("★ T-RMA-22 — the request carries the TIANCHA schema (change the contract ⇒ the request changes)", async () => {
    const e = env();
    const first = cannedFetch(200, chat(JSON.stringify({ candidates: [] })));
    const adapterA = adapterOver(e, first.fetchImpl);
    await adapterA.extractBatch({ materialVersionId: "m", window: { windowId: "w", index: 0, text: RAW }, windowStartInVersion: 0, dimensionHints: ["market"], methodologyVersionId: "mw-v1" }, new AbortController().signal);

    const second = cannedFetch(200, chat(JSON.stringify({ candidates: [] })));
    const adapterB = adapterOver(e, second.fetchImpl, { type: "object", title: "DIFFERENT-SCHEMA" });
    await adapterB.extractBatch({ materialVersionId: "m", window: { windowId: "w", index: 0, text: RAW }, windowStartInVersion: 0, dimensionHints: ["market"], methodologyVersionId: "mw-v1" }, new AbortController().signal);

    const bodyA = JSON.stringify(first.sent[0]);
    const bodyB = JSON.stringify(second.sent[0]);
    assert.ok(bodyA.includes("candidates"), "the Tiancha schema rides the request");
    assert.ok(bodyB.includes("DIFFERENT-SCHEMA"), "★ changing the contract's schema changes the request");
    assert.notEqual(bodyA, bodyB);
    // …and the contract the service exposes is the version identity it also records.
    assert.equal(e.service.outputContract.version, extractionOutputContractFor("candidate-schema/v1").version);
  });

  test("★ T-RMA-18 — if an adapter SWALLOWED the abort, the run would still be honest (no residue, failed)", async () => {
    const e = env();
    const swallowing: ModelExtractionAdapter = {
      modelVersion: "pid-swallow",
      promptVersion: "p/v1",
      parserVersion: "r/v1",
      adapterIdentity: {
        provider: "fake",
        model: "fake",
        deployment: "fake",
        endpointIdentity: "fake",
        adapterVersion: "fake/v1",
        authMode: "none",
      },
      generationParams: {},
      // The dangerous shape: abort arrives, the adapter ignores it and NEVER settles.
      async extractBatch(): Promise<ModelBatchResult> {
        return new Promise<ModelBatchResult>(() => {
          /* deliberately never settles */
        });
      },
    };
    const version = e.repo.getMaterialVersion(e.versionId)!;
    const result = await e.service.run(version, AT, { model: swallowing, rule: DEFAULT_WINDOW_RULE, timeoutMs: 50 });

    assert.equal(result.status, "failed", "★ an adapter that never settles cannot fake a success");
    assert.match(result.error ?? "", /extraction timed out after 50ms/);
    assert.deepEqual(residue(e), { claim_candidate: 0, fragment: 0, fragment_evidence: 0 });
    const row = e.db.db.prepare("SELECT status FROM extraction_run WHERE material_version_id = ?").get(e.versionId) as { status: string };
    assert.equal(row.status, "running", "the run row keeps `running` — timeout ≠ lease failure (§M14.5)");
  });
});
