/**
 * C6 model-extractor · Slice F acceptance — the PERSISTENCE boundary (§M13).
 *
 *   F-1   single persistence unit lands; fragment / evidence / candidate stay consistent
 *   F-2   several units land in ONE pass
 *   F-3   ★ any unit throwing rolls the WHOLE transaction back (the earlier unit's rows are gone)
 *   F-4   the CURRENT generation + owner commits (`committed === true`)
 *   F-5   ★ a STALE generation cannot commit — zero residue, the new owner's row is untouched
 *   F-6   a mismatched owner cannot commit
 *   F-7   ★ a CONFIRMED candidate is not touched — and gains NO new fragment / evidence
 *   F-8   ★ a candidate a human REVISED (still `draft`, `reviewed_by` set) is protected the same way
 *   F-9   an untouched draft is reused and genuinely new evidence is merged
 *   F-10  re-persisting the same unit adds no duplicate fragment / evidence / candidate
 *   F-11  fragment / evidence / candidate reference each other and resolve back to the raw text
 *   F-12  the run closes out with candidate ids, finished_at, audit columns and the snapshot —
 *         and the close-out is the LAST step (⑦), observably
 *   F-13  ★ persistence throw ⇒ rollback ⇒ the run is closed out as `failed` (rev11 / BLOCKING-1)
 *   F-14  ★ persistence throw ⇒ the transaction did NOT close the run out, and wrote nothing
 *   F-15  the downstream tables' fingerprints are unchanged and the candidates are inert
 *   F-16  ★ an existing `completed` run is reused with ZERO side effects and ZERO `extract()` calls
 *   F-17  ★ END-TO-END failure: run() ⇒ extract ⇒ bridge ⇒ persist throws ⇒ `failed` + DB `failed`
 *
 * Contract: `docs/phaseC/c6-model-extractor-contract.md` rev11 §M13. That revision fixed the three
 * blockers found by the independent review of the FIRST Slice F implementation:
 *   - BLOCKING-1  ① persistence exception ⇒ rollback ⇒ an OUT-OF-TRANSACTION, fenced `failed`
 *                 close-out (clarification 2). A rollback is NOT an automatic `failed`.
 *   - BLOCKING-3  ② the ① read-only existence gate and the ⑦ fenced `completed` close-out are two
 *                 DIFFERENT steps, and ⑦ is the FINAL authority (clarification 1). The old code
 *                 closed the run out FIRST and wrote the business rows afterwards.
 *   - §M13.2/④    ③ a PROTECTED candidate must be judged BEFORE any fragment/evidence is written
 *                 for it (clarification 4). The old code wrote the quotes first and judged after.
 *
 * Assertions are behavioural: rows, ids, statuses, fingerprints, ordering — never log wording.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { MaterialVersionService } from "./application/material-version-service.js";
import {
  CandidateExtractionService,
  ExplicitBlockExtractor,
  LostLeaseError,
  type CandidateDraft,
  type CandidateExtractor,
  type ExtractInput,
  type ValidatedCandidate,
} from "./application/candidate-extraction-service.js";
import { CandidateReviewService } from "./application/candidate-review-service.js";
import { DEFAULT_WINDOW_RULE } from "./application/extraction-window.js";
import type { ExtractionConfigSnapshot } from "./application/model-extraction-config.js";
import type { ResolvedQuote } from "./application/model-extraction.js";
import {
  buildMaterialFragment,
  locatorKey,
  normalizeText,
  resolveLocator,
  sha256Hex,
  type FragmentLocator,
  type MaterialVersion,
} from "./domain/material-source.js";
import type { ClaimCandidate } from "./domain/claim-candidate.js";
import { extractionRunIdFor } from "./domain/claim-candidate.js";

const AT = "2026-09-27T00:00:00.000Z";
const AT2 = "2026-09-27T01:00:00.000Z";
const LEASE_UNTIL = "2026-09-27T00:10:00.000Z";

// Paragraphs 0 and 1 carry the statements; the [CANDIDATE] blocks are paragraphs 2 and 3.
const RAW = [
  "第一段：市场规模约 500 亿元。",
  "第二段：头部客户开始小批量采购。",
  "[CANDIDATE]",
  "dimension: market",
  "kind: fact",
  "statement: 2025 年全球出货约 2.5 万台",
  "confidence: 0.6",
  "evidence: paragraph:0",
  "[/CANDIDATE]",
  "[CANDIDATE]",
  "dimension: demand",
  "kind: judgment",
  "statement: 头部客户可能开始小批量采购",
  "evidence: paragraph:1",
  "[/CANDIDATE]",
  "",
].join("\n\n");

/** Counts whose INVARIANCE is what "protected" and "rolled back" actually mean in the database. */
function businessCounts(e: Env): { fragments: number; evidence: number; candidates: number } {
  const one = (sql: string): number => (e.db.db.prepare(sql).get() as { c: number }).c;
  return {
    fragments: one("SELECT COUNT(*) AS c FROM fragment"),
    evidence: one("SELECT COUNT(*) AS c FROM fragment_evidence"),
    candidates: one("SELECT COUNT(*) AS c FROM claim_candidate"),
  };
}

/** ★ The downstream tables a candidate must NOT be able to touch before a human confirms it (§M8). */
function downstreamFingerprint(db: ResearchDb): string {
  const tables = [
    "industry_knowledge",
    "knowledge_belief",
    "knowledge_conflict",
    "information_pool_slot",
    "information_pool_item",
    "research_gap",
    "next_action",
    "investment_evaluation",
    "report_snapshot",
  ];
  return tables
    .map((t) => `${t}=${(db.db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c}`)
    .join("|");
}

/** The WHOLE `extraction_run` row — used to prove "not one byte changed". */
function runRow(e: Env, extractionId: string): Record<string, unknown> {
  const row = e.db.db.prepare("SELECT * FROM extraction_run WHERE extraction_id = ?").get(extractionId) as
    | Record<string, unknown>
    | undefined;
  assert.ok(row !== undefined, `extraction_run ${extractionId} must exist`);
  return row;
}

interface Env {
  db: ResearchDb;
  repo: ResearchRepository;
  svc: MaterialVersionService;
  review: CandidateReviewService;
  x: CandidateExtractionService;
  counting: CountingExtractor;
}

/** Counts `extract()` calls — the F-16 proof that a reuse performs NO extraction at all. */
class CountingExtractor implements CandidateExtractor {
  readonly modelVersion = "none";
  readonly promptVersion = "none";
  calls = 0;

  constructor(private readonly inner: CandidateExtractor) {}

  async extract(input: ExtractInput): Promise<CandidateDraft[]> {
    this.calls += 1;
    return this.inner.extract(input);
  }
}

function seedMaterial(repo: ResearchRepository, rawText: string = RAW): string {
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
  return "mat-1";
}

function env(): Env {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const svc = new MaterialVersionService(repo);
  const counting = new CountingExtractor(new ExplicitBlockExtractor(repo));
  return {
    db,
    repo,
    svc,
    review: new CandidateReviewService(repo, new KnowledgeRepository(db.db), () => AT2),
    x: new CandidateExtractionService(repo, counting),
    counting,
  };
}

function versionOf(e: Env, rawText: string = RAW): MaterialVersion {
  seedMaterial(e.repo, rawText);
  return e.svc.registerVersion({ materialId: "mat-1", rawText, createdAt: AT }).version;
}

/**
 * A `ResolvedQuote` for a locator — built EXACTLY the way the service's legacy bridge builds one
 * (fragment → locator / text / textHash), so the quote always matches the fragment it names.
 */
function quoteFor(version: MaterialVersion, locator: FragmentLocator): ResolvedQuote {
  const fragment = buildMaterialFragment(version, locator, AT);
  return {
    windowId: locatorKey(fragment.locator),
    startGlobal: fragment.locator.kind === "char_range" ? fragment.locator.start : 0,
    endGlobal: fragment.locator.kind === "char_range" ? fragment.locator.end : fragment.text.length,
    fragmentLocator: fragment.locator,
    quoteHash: fragment.textHash,
    quoteText: fragment.text,
  };
}

function unit(
  version: MaterialVersion,
  opts: {
    dimension: string;
    statement: string;
    contentKind: "fact" | "judgment";
    paragraph: number;
    confidence?: number;
  },
): ValidatedCandidate {
  return {
    draft: {
      dimension: opts.dimension,
      statement: opts.statement,
      contentKind: opts.contentKind,
      ...(opts.confidence === undefined ? {} : { confidence: opts.confidence }),
    },
    quotes: [quoteFor(version, { kind: "paragraph", index: opts.paragraph })],
  };
}

function unitAt(
  version: MaterialVersion,
  draft: { dimension: string; statement: string; contentKind: "fact" | "judgment"; confidence?: number },
  locator: FragmentLocator,
): ValidatedCandidate {
  return { draft, quotes: [quoteFor(version, locator)] };
}

function snapshotOf(attemptSeq: number, generation: number): ExtractionConfigSnapshot {
  return {
    windowRule: {
      version: DEFAULT_WINDOW_RULE.version,
      maxChars: DEFAULT_WINDOW_RULE.maxChars,
      overlapChars: DEFAULT_WINDOW_RULE.overlapChars,
      overlapAppliesTo: "long-paragraph-slices-only",
    },
    quotePolicy: { maxQuoteChars: DEFAULT_WINDOW_RULE.maxQuoteChars, allowedStances: ["supports"] },
    model: {
      modelVersion: "none",
      promptVersion: "none",
      parserVersion: "candidate-parser/v1",
      schemaVersion: "candidate-schema/v1",
    },
    generation: {},
    methodology: { methodologyVersionId: "unbound", dimensionHints: ["market", "demand"] },
    run: { timeoutMs: 120_000, batchCount: 1, attemptSeq, generation },
  };
}

/**
 * A `running` row for this (version, config) — the state `claimRun()` leaves behind. Written
 * directly so the persistence entry point can be driven in isolation, without an extractor.
 * The partial unique index allows exactly one `running` row per (version, config), which is why
 * every test closes the previous run out (or uses a fresh database) before seeding another.
 */
function seedRunningRun(
  e: Env,
  version: MaterialVersion,
  opts: { owner: string; generation: number; attemptSeq: number; leaseUntil?: string },
): string {
  const extractionId = extractionRunIdFor(version.materialVersionId, e.x.extractionConfigKey, String(opts.attemptSeq));
  e.db.db
    .prepare(
      `INSERT INTO extraction_run
         (extraction_id, material_version_id, model_version, prompt_version, parser_version,
          schema_version, extraction_config_key, started_at, status, candidate_ids_json,
          owner, lease_until, attempt_seq, generation)
       VALUES (?,?,?,?,?,?,?,?,'running','[]',?,?,?,?)`,
    )
    .run(
      extractionId,
      version.materialVersionId,
      "none",
      "none",
      "candidate-parser/v1",
      "candidate-schema/v1",
      e.x.extractionConfigKey,
      AT,
      opts.owner,
      opts.leaseUntil ?? LEASE_UNTIL,
      opts.attemptSeq,
      opts.generation,
    );
  return extractionId;
}

function persist(
  e: Env,
  version: MaterialVersion,
  run: { extractionId: string; owner: string; generation: number; attemptSeq: number },
  candidates: readonly ValidatedCandidate[],
) {
  return e.x.persistValidatedCandidates({
    version,
    extractionId: run.extractionId,
    owner: run.owner,
    generation: run.generation,
    extractionConfigKey: e.x.extractionConfigKey,
    snapshot: snapshotOf(run.attemptSeq, run.generation),
    candidates,
  });
}

const MARKET = { dimension: "market", statement: "2025 年全球出货约 2.5 万台", contentKind: "fact" } as const;
const DEMAND = { dimension: "demand", statement: "头部客户可能开始小批量采购", contentKind: "judgment" } as const;

describe("Slice F — persistence and atomic close-out (§M13)", () => {
  test("F-1: one persistence unit lands, and fragment / evidence / candidate agree", async () => {
    const e = env();
    const version = versionOf(e);
    const extractionId = seedRunningRun(e, version, { owner: "o1", generation: 1, attemptSeq: 1 });

    const candidate = unit(version, { ...MARKET, paragraph: 0 });
    const res = await persist(e, version, { extractionId, owner: "o1", generation: 1, attemptSeq: 1 }, [candidate]);

    assert.equal(res.committed, true);
    assert.equal(res.created, 1);
    assert.equal(res.reused, 0);
    assert.equal(res.merged, 0);
    assert.equal(res.skippedReviewed, 0);
    assert.equal(res.candidateIds.length, 1);

    const counts = businessCounts(e);
    assert.equal(counts.candidates, 1);
    assert.equal(counts.fragments, 1);
    assert.equal(counts.evidence, 1);

    const stored = e.repo.getClaimCandidate(res.candidateIds[0]!)!;
    assert.equal(stored.statement, MARKET.statement);
    assert.equal(stored.dimension, MARKET.dimension);
    assert.equal(stored.reviewStatus, "draft");
    assert.equal(stored.projectionStatus, "none");

    const evidenceId = stored.evidenceRefs[0]!;
    const evidence = e.repo.getFragmentEvidence(evidenceId)!;
    const fragment = e.repo.getFragment(evidence.fragmentId)!;
    const quote = candidate.quotes[0]!;

    // ★ "引文即 Fragment" — all four agree, and the fragment resolves back to the raw text (§M5.3).
    assert.equal(fragment.text, evidence.quoteText);
    assert.equal(fragment.text, quote.quoteText);
    assert.equal(fragment.textHash, evidence.quoteHash);
    assert.equal(fragment.textHash, sha256Hex(quote.quoteText));
    assert.equal(evidence.evidenceId, evidenceId);
    assert.equal(resolveLocator(normalizeText(RAW), fragment.locator), fragment.text);
  });

  test("F-2: several persistence units land in ONE pass", async () => {
    const e = env();
    const version = versionOf(e);
    const extractionId = seedRunningRun(e, version, { owner: "o1", generation: 1, attemptSeq: 1 });

    const res = await persist(e, version, { extractionId, owner: "o1", generation: 1, attemptSeq: 1 }, [
      unit(version, { ...MARKET, paragraph: 0, confidence: 0.6 }),
      unit(version, { ...DEMAND, paragraph: 1 }),
    ]);

    assert.equal(res.committed, true);
    assert.equal(res.created, 2);
    assert.equal(res.candidateIds.length, 2);
    const counts = businessCounts(e);
    assert.equal(counts.candidates, 2);
    assert.equal(counts.fragments, 2);
    assert.equal(counts.evidence, 2);
  });

  test("F-3: ★ a throwing unit rolls the WHOLE transaction back — the earlier unit is gone too", async () => {
    const e = env();
    const version = versionOf(e);
    const extractionId = seedRunningRun(e, version, { owner: "o1", generation: 1, attemptSeq: 1 });

    const good = unit(version, { ...MARKET, paragraph: 0 });
    const bad = unit(version, { ...DEMAND, paragraph: 1 });
    // A quote that does not match the fragment it names — the service must REFUSE it (§M5.3).
    const tampered: ValidatedCandidate = {
      draft: bad.draft,
      quotes: [{ ...bad.quotes[0]!, quoteHash: sha256Hex("这不是那段话") }],
    };

    await assert.rejects(
      () => persist(e, version, { extractionId, owner: "o1", generation: 1, attemptSeq: 1 }, [good, tampered]),
      /hash does not match/,
    );

    // ★ One transaction: the FIRST unit (already written) is rolled back with the failing one.
    const counts = businessCounts(e);
    assert.deepEqual(counts, { fragments: 0, evidence: 0, candidates: 0 });
    const row = runRow(e, extractionId);
    assert.equal(row.status, "running", "the persistence transaction did NOT close the run out");
    assert.equal(row.candidate_ids_json, "[]");
  });

  test("F-4: the CURRENT generation + owner commits (committed === true)", async () => {
    const e = env();
    const version = versionOf(e);
    const extractionId = seedRunningRun(e, version, { owner: "o1", generation: 3, attemptSeq: 3 });

    const res = await persist(e, version, { extractionId, owner: "o1", generation: 3, attemptSeq: 3 }, [
      unit(version, { ...MARKET, paragraph: 0 }),
    ]);

    assert.equal(res.committed, true);
    assert.equal(runRow(e, extractionId).status, "completed");
  });

  test("F-5: ★ a STALE generation cannot commit — no residue, and the new owner's row is untouched", async () => {
    const e = env();
    const version = versionOf(e);
    const staleId = seedRunningRun(e, version, { owner: "o1", generation: 1, attemptSeq: 1 });

    // Simulate the takeover: the old attempt is closed as `failed`/`lease_expired` and a NEW owner
    // holds a NEW running attempt (exactly what `claimRun()` does for a lapsed lease).
    e.db.db
      .prepare(`UPDATE extraction_run SET status = 'failed', error = 'lease_expired', finished_at = ? WHERE extraction_id = ?`)
      .run(AT2, staleId);
    const newId = seedRunningRun(e, version, {
      owner: "o2",
      generation: 2,
      attemptSeq: 2,
      leaseUntil: "2026-09-27T02:00:00.000Z",
    });
    const before = runRow(e, newId);

    await assert.rejects(
      () => persist(e, version, { extractionId: staleId, owner: "o1", generation: 1, attemptSeq: 1 }, [
        unit(version, { ...MARKET, paragraph: 0 }),
      ]),
      (err: unknown) => err instanceof LostLeaseError,
    );

    assert.deepEqual(businessCounts(e), { fragments: 0, evidence: 0, candidates: 0 }, "zero business residue");
    assert.equal(runRow(e, staleId).status, "failed", "the stale row was NOT upgraded to `completed`");
    assert.deepEqual(runRow(e, newId), before, "★ the new owner's run row is byte-identical");
  });

  test("F-6: a mismatched owner cannot commit", async () => {
    const e = env();
    const version = versionOf(e);
    const extractionId = seedRunningRun(e, version, { owner: "o1", generation: 1, attemptSeq: 1 });
    const before = runRow(e, extractionId);

    await assert.rejects(
      () =>
        persist(e, version, { extractionId, owner: "o-other", generation: 1, attemptSeq: 1 }, [
          unit(version, { ...MARKET, paragraph: 0 }),
        ]),
      (err: unknown) => err instanceof LostLeaseError,
    );

    assert.deepEqual(businessCounts(e), { fragments: 0, evidence: 0, candidates: 0 });
    assert.deepEqual(runRow(e, extractionId), before, "the run row was not written at all");
  });

  test("F-7: ★ a CONFIRMED candidate is untouched AND gains no new fragment / evidence", async () => {
    const e = env();
    const version = versionOf(e);

    const first = await e.x.run(version, AT);
    // The fixture declares TWO [CANDIDATE] blocks (market / demand).
    assert.equal(first.created, 2);
    const candidateId = first.candidateIds[0]!;
    e.review.confirm(candidateId, { operator: "alice", relation: "SUPPORT", at: AT2 });
    const confirmed = e.repo.getClaimCandidate(candidateId)!;
    assert.equal(confirmed.reviewStatus, "confirmed");

    const before = businessCounts(e);
    const extractionId = seedRunningRun(e, version, { owner: "o9", generation: 2, attemptSeq: 2 });

    // The SAME statement extracted from a DIFFERENT, not-yet-used span: if protection were applied
    // after the write, a brand-new fragment + evidence row would appear in the database.
    const res = await persist(e, version, { extractionId, owner: "o9", generation: 2, attemptSeq: 2 }, [
      unitAt(version, MARKET, { kind: "char_range", start: 0, end: 6 }),
    ]);

    assert.equal(res.skippedReviewed, 1);
    assert.equal(res.created, 0);
    assert.equal(res.reused, 0);
    assert.equal(res.merged, 0);
    assert.deepEqual(e.repo.getClaimCandidate(candidateId), confirmed, "the confirmed candidate is byte-identical");
    assert.deepEqual(
      businessCounts(e),
      before,
      "★ protection is REALLY zero-write: no fragment and no evidence row was appended",
    );
  });

  test("F-8: ★ a candidate a human REVISED (still `draft`) is protected the same way", async () => {
    const e = env();
    const version = versionOf(e);

    const first = await e.x.run(version, AT);
    const candidateId = first.candidateIds[0]!;
    // `revise` deliberately KEEPS the status `draft` — it only records who touched it.
    e.review.revise(candidateId, { operator: "bob", contentKind: "fact", at: AT2 });
    const revised = e.repo.getClaimCandidate(candidateId)!;
    assert.equal(revised.reviewStatus, "draft");
    assert.equal(revised.reviewedBy, "bob");

    const before = businessCounts(e);
    const extractionId = seedRunningRun(e, version, { owner: "o9", generation: 2, attemptSeq: 2 });
    const res = await persist(e, version, { extractionId, owner: "o9", generation: 2, attemptSeq: 2 }, [
      unitAt(version, MARKET, { kind: "char_range", start: 0, end: 6 }),
    ]);

    assert.equal(res.skippedReviewed, 1);
    assert.equal(res.merged, 0);
    assert.deepEqual(e.repo.getClaimCandidate(candidateId), revised);
    assert.deepEqual(businessCounts(e), before, "no fragment / evidence was appended for a touched candidate");
  });

  test("F-9: an untouched draft is reused, and genuinely new evidence is MERGED", async () => {
    const e = env();
    const version = versionOf(e);

    const first = await e.x.run(version, AT);
    const candidateId = first.candidateIds[0]!;
    const evidenceBefore = e.repo.getClaimCandidate(candidateId)!.evidenceRefs.length;

    const extractionId = seedRunningRun(e, version, { owner: "o9", generation: 2, attemptSeq: 2 });
    const res = await persist(e, version, { extractionId, owner: "o9", generation: 2, attemptSeq: 2 }, [
      unit(version, { ...MARKET, paragraph: 1 }),
    ]);

    assert.equal(res.created, 0);
    assert.equal(res.reused, 1);
    assert.equal(res.merged, 1);
    assert.equal(res.skippedReviewed, 0);
    assert.equal(e.repo.getClaimCandidate(candidateId)!.evidenceRefs.length, evidenceBefore + 1);
  });

  test("F-10: re-persisting the same unit adds no duplicate fragment / evidence / candidate", async () => {
    const e = env();
    const version = versionOf(e);

    const run1 = seedRunningRun(e, version, { owner: "o1", generation: 1, attemptSeq: 1 });
    await persist(e, version, { extractionId: run1, owner: "o1", generation: 1, attemptSeq: 1 }, [
      unit(version, { ...MARKET, paragraph: 0 }),
    ]);
    const after = businessCounts(e);

    const run2 = seedRunningRun(e, version, { owner: "o1", generation: 2, attemptSeq: 2 });
    const res = await persist(e, version, { extractionId: run2, owner: "o1", generation: 2, attemptSeq: 2 }, [
      unit(version, { ...MARKET, paragraph: 0 }),
    ]);

    assert.equal(res.created, 0);
    assert.equal(res.reused, 1);
    assert.equal(res.merged, 0, "the evidence was already there — nothing new to merge");
    assert.deepEqual(businessCounts(e), after, "a second pass changes no row counts");
  });

  test("F-11: references stay consistent — evidence points at the fragment, candidate at the evidence", async () => {
    const e = env();
    const version = versionOf(e);
    const extractionId = seedRunningRun(e, version, { owner: "o1", generation: 1, attemptSeq: 1 });

    const candidate = unit(version, { ...DEMAND, paragraph: 1 });
    const res = await persist(e, version, { extractionId, owner: "o1", generation: 1, attemptSeq: 1 }, [candidate]);

    const stored = e.repo.getClaimCandidate(res.candidateIds[0]!)!;
    const evidence = e.repo.getFragmentEvidence(stored.evidenceRefs[0]!)!;
    const fragment = e.repo.getFragment(evidence.fragmentId)!;

    assert.equal(evidence.materialVersionId, version.materialVersionId);
    assert.equal(fragment.materialVersionId, version.materialVersionId);
    assert.equal(evidence.stance, "supports");
    assert.equal(stored.extractionId, extractionId);
    assert.equal(stored.materialVersionId, version.materialVersionId);
    assert.equal(stored.subjectKind, version.subjectKind);
    assert.equal(stored.subjectId, version.subjectId);
    // the fragment resolves back to the material's own normalized text, at the quoted location
    assert.equal(resolveLocator(normalizeText(RAW), fragment.locator), candidate.quotes[0]!.quoteText);
  });

  test("F-12: the run closes out LAST, with ids / finished_at / audit columns / snapshot", async () => {
    const e = env();
    const version = versionOf(e);
    const extractionId = seedRunningRun(e, version, { owner: "o1", generation: 1, attemptSeq: 1 });

    // ★ ORDER PROBE (rev11 / BLOCKING-3): when the business row is written, the run must STILL be
    // `running`. The first Slice F implementation closed the run out FIRST, which would show up here
    // as `completed`.
    let statusAtCandidateWrite: unknown;
    const original = e.repo.insertClaimCandidate.bind(e.repo);
    e.repo.insertClaimCandidate = (c: ClaimCandidate): void => {
      statusAtCandidateWrite = runRow(e, extractionId).status;
      original(c);
    };

    const res = await persist(e, version, { extractionId, owner: "o1", generation: 1, attemptSeq: 1 }, [
      unit(version, { ...MARKET, paragraph: 0 }),
    ]);

    assert.equal(statusAtCandidateWrite, "running", "★ ⑦ is the LAST step: ① left the row alone");

    const row = runRow(e, extractionId);
    assert.equal(row.status, "completed");
    assert.equal(row.candidate_ids_json, JSON.stringify(res.candidateIds));
    assert.ok(typeof row.finished_at === "string" && row.finished_at.length > 0);
    assert.equal(
      row.chunker_version,
      `${DEFAULT_WINDOW_RULE.version}+${DEFAULT_WINDOW_RULE.maxChars}+${DEFAULT_WINDOW_RULE.overlapChars}`,
    );
    assert.equal(row.max_quote_chars, DEFAULT_WINDOW_RULE.maxQuoteChars);
    assert.equal(row.methodology_version_id, "unbound");
    assert.equal(typeof row.dimension_set_hash, "string");
    const snapshot = JSON.parse(row.config_snapshot_json as string) as ExtractionConfigSnapshot;
    assert.equal(snapshot.windowRule.version, DEFAULT_WINDOW_RULE.version);
    assert.equal(snapshot.run.attemptSeq, 1);
    assert.deepEqual(snapshot.methodology.dimensionHints, ["market", "demand"]);
  });

  test("F-13: ★ persistence throw ⇒ rollback ⇒ the run ends `failed` (BLOCKING-1)", async () => {
    const e = env();
    const version = versionOf(e);

    const boom = new Error("boom: the persistence write failed");
    e.repo.insertClaimCandidate = (): void => {
      throw boom;
    };

    const result = await e.x.run(version, AT, { owner: "o1", leaseMs: 60_000, timeoutMs: 60_000 });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /boom/);

    const run = runRow(e, result.extractionId);
    assert.equal(run.status, "failed", "the CALLER closed the run out, outside the transaction");
    assert.equal(run.error, "boom: the persistence write failed");
    assert.equal(run.candidate_ids_json, "[]");
    assert.ok(typeof run.finished_at === "string");
    // ★ The rollback removed the PERSISTENCE transaction's OWN writes: the two [CANDIDATE] blocks
    // registered their fragments/evidence during extract() (legacy behaviour, §M13.8), and nothing
    // beyond those survives — the candidate write AND that unit's fragment/evidence are gone.
    const counts = businessCounts(e);
    assert.equal(counts.candidates, 0, "no candidate survived the rollback");
    assert.equal(counts.fragments, 2, "only the extractor's own fragments remain");
    assert.equal(counts.evidence, 2, "only the extractor's own evidence remains");
  });

  test("F-14: ★ persistence throw ⇒ the transaction wrote nothing and did NOT close the run out", async () => {
    const e = env();
    const version = versionOf(e);
    const extractionId = seedRunningRun(e, version, { owner: "o1", generation: 1, attemptSeq: 1 });

    const good = unit(version, { ...MARKET, paragraph: 0 });
    const bad = unit(version, { ...DEMAND, paragraph: 1 });
    const tampered: ValidatedCandidate = {
      draft: bad.draft,
      quotes: [{ ...bad.quotes[0]!, quoteText: "与片段不符的引文" }],
    };

    await assert.rejects(() =>
      persist(e, version, { extractionId, owner: "o1", generation: 1, attemptSeq: 1 }, [good, tampered]),
    );

    assert.deepEqual(businessCounts(e), { fragments: 0, evidence: 0, candidates: 0 });
    const row = runRow(e, extractionId);
    assert.equal(row.status, "running", "the persistence transaction must NOT write a terminal state");
    assert.equal(row.candidate_ids_json, "[]");
    assert.equal(row.finished_at, null);
  });

  test("F-15: the downstream tables are untouched and the candidates are inert", async () => {
    const e = env();
    const version = versionOf(e);
    const before = downstreamFingerprint(e.db);

    const extractionId = seedRunningRun(e, version, { owner: "o1", generation: 1, attemptSeq: 1 });
    const res = await persist(e, version, { extractionId, owner: "o1", generation: 1, attemptSeq: 1 }, [
      unit(version, { ...MARKET, paragraph: 0 }),
      unit(version, { ...DEMAND, paragraph: 1 }),
    ]);

    assert.equal(downstreamFingerprint(e.db), before, "§M8: not one downstream table changed");
    for (const id of res.candidateIds) {
      const c = e.repo.getClaimCandidate(id)!;
      assert.equal(c.reviewStatus, "draft");
      assert.equal(c.projectionStatus, "none");
      assert.equal(c.decisionRelation, undefined);
    }
  });

  test("F-16: ★ an existing `completed` run is reused with ZERO side effects and ZERO extract() calls", async () => {
    const e = env();
    const version = versionOf(e);

    const first = await e.x.run(version, AT);
    assert.equal(first.status, "completed");
    assert.equal(first.reusedRun, false);
    const rowBefore = runRow(e, first.extractionId);
    const countsBefore = businessCounts(e);
    const callsBefore = e.counting.calls;
    assert.equal(callsBefore, 1);

    const second = await e.x.run(version, AT2);

    assert.equal(second.reusedRun, true);
    assert.equal(second.created, 0);
    assert.equal(second.reused, 0);
    assert.equal(second.merged, 0);
    assert.equal(second.skippedReviewed, 0);
    assert.deepEqual(second.candidateIds, first.candidateIds);
    assert.equal(second.extractionId, first.extractionId);
    assert.equal(e.counting.calls, callsBefore, "no extraction was performed for a reused run");
    assert.equal(
      (e.db.db.prepare("SELECT COUNT(*) AS c FROM extraction_run").get() as { c: number }).c,
      1,
      "★ reuse creates NO new attempt row",
    );
    assert.deepEqual(runRow(e, first.extractionId), rowBefore, "★ the completed row is byte-identical");
    assert.deepEqual(businessCounts(e), countsBefore);
  });

  test("F-17: ★ END-TO-END — run() ⇒ extract ⇒ bridge ⇒ persist throws ⇒ failed, zero residue", async () => {
    const e = env();
    const version = versionOf(e);

    const boom = new Error("boom: persistence exploded");
    e.repo.insertClaimCandidate = (): void => {
      throw boom;
    };

    const result = await e.x.run(version, AT, { owner: "o1", leaseMs: 60_000, timeoutMs: 60_000 });

    assert.equal(result.status, "failed");
    assert.equal(result.reusedRun, false);
    assert.equal(result.created, 0);
    assert.equal(result.candidateIds.length, 0);
    assert.match(result.error ?? "", /boom/);

    const run = runRow(e, result.extractionId);
    assert.equal(run.status, "failed");
    assert.equal(run.error, "boom: persistence exploded");
    assert.equal(run.candidate_ids_json, "[]");
    assert.equal(
      (e.db.db.prepare("SELECT COUNT(*) AS c FROM claim_candidate").get() as { c: number }).c,
      0,
      "★ zero business residue: the candidate write was rolled back",
    );
  });
});
