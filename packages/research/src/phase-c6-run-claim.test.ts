/**
 * C6 model-extractor · Slice E acceptance — the run CLAIM, the LEASE and FENCING.
 *
 * Contract rev7 §M7.1a / §M6.2a. This file is the only place where Slice E's new behaviour is
 * asserted; the four pre-existing C6 tests were migrated to `await` and nothing else.
 *
 * ★ The concurrency requirement is explicit: TWO INDEPENDENT SQLite CONNECTIONS, not two services
 * sharing one `ResearchDb`. Every case below therefore builds two `ResearchDb` handles on the same
 * file, each with its own repository and its own extraction service.
 *
 * E-1 only one claim wins            · E-2 a live lease blocks the second claim
 * E-3 an expired lease is taken over · E-4 the OLD generation can no longer commit (the key case)
 * E-5 the current generation commits · plus timeout ≠ lease failure
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import {
  CandidateExtractionService,
  type CandidateDraft,
  type CandidateExtractor,
} from "./application/candidate-extraction-service.js";
import { MaterialVersionService } from "./application/material-version-service.js";
import { buildFragmentEvidence, sha256Hex, type MaterialVersion } from "./domain/material-source.js";

const AT = "2026-09-27T00:00:00.000Z";

/** Two paragraphs — paragraph 0 is the one every draft cites. */
const RAW = ["第一段：市场规模约 500 亿元。", "", "第二段：竞争格局尚未稳定。", ""].join("\n");

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

/**
 * ★ A shared, MUTABLE clock: both connections read "now" from it, so a test can make a lease lapse
 * deterministically. This is the only way to test a takeover stably — and it is exactly why the
 * service must never call `new Date()` / `Date.now()` for its lease decisions.
 */
class Clock {
  private t = AT;
  now = (): string => this.t;

  advance(ms: number): void {
    this.t = new Date(Date.parse(this.t) + ms).toISOString();
  }
}

/** One INDEPENDENT connection (its own ResearchDb / repository / service) on the same file. */
interface Connection {
  db: ResearchDb;
  repo: ResearchRepository;
  service: CandidateExtractionService;
  close(): void;
}

function connection(dbPath: string, extractor: CandidateExtractor, clock: Clock): Connection {
  const db = new ResearchDb({ path: dbPath });
  opened.push(db);
  const repo = new ResearchRepository(db.db);
  return {
    db,
    repo,
    service: new CandidateExtractionService(repo, extractor, { now: clock.now }),
    close() {
      db.close();
    },
  };
}

/**
 * A deterministic extractor whose completion the test controls: it counts its starts and only
 * resolves when released.
 */
class GatedExtractor implements CandidateExtractor {
  readonly modelVersion = "gated-model";
  readonly promptVersion = "gated-prompt";
  private release!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  started = 0;

  constructor(private readonly drafts: CandidateDraft[]) {}

  open(): void {
    this.release();
  }

  async extract(): Promise<CandidateDraft[]> {
    this.started += 1;
    await this.gate;
    return this.drafts;
  }
}

/** An extractor that resolves immediately — used for the second connection in takeover cases. */
class ImmediateExtractor implements CandidateExtractor {
  /** Must MATCH GatedExtractor: the config key is derived from these, so both claim ONE run. */
  readonly modelVersion = "gated-model";
  readonly promptVersion = "gated-prompt";

  constructor(private readonly drafts: CandidateDraft[]) {}

  async extract(): Promise<CandidateDraft[]> {
    return this.drafts;
  }
}

interface Fixture {
  dbPath: string;
  version: MaterialVersion;
  drafts: CandidateDraft[];
}

/** A material version WITH a fragment + evidence, plus a draft that cites the real evidence id. */
function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "tiancha-c6e-"));
  dirs.push(dir);
  const dbPath = join(dir, "tiancha.sqlite");
  const seedDb = new ResearchDb({ path: dbPath });
  const repo = new ResearchRepository(seedDb.db);
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
  const version = new MaterialVersionService(repo).registerWithFragments({
    materialId: "mat-1",
    rawText: RAW,
    createdAt: AT,
    locators: [{ kind: "paragraph", index: 0 }],
  }).version;
  const fragment = repo.listFragments(version.materialVersionId)[0]!;
  const evidence = buildFragmentEvidence(version, fragment, "supports", AT);
  repo.upsertFragmentEvidence(evidence);
  seedDb.close();

  return {
    dbPath,
    version,
    drafts: [
      {
        dimension: "market",
        statement: "2026 年全球出货约 3 万台",
        contentKind: "fact",
        evidenceRefs: [evidence.evidenceId],
      },
    ],
  };
}

interface RunRow {
  extraction_id: string;
  status: string;
  owner: string | null;
  generation: number | null;
  attempt_seq: number | null;
  error: string | null;
}

const runsFor = (c: Connection, version: MaterialVersion): RunRow[] =>
  c.db.db
    .prepare(
      "SELECT extraction_id, status, owner, generation, attempt_seq, error FROM extraction_run WHERE material_version_id = ? ORDER BY attempt_seq",
    )
    .all(version.materialVersionId) as never;

const ownersOf = (rows: RunRow[]): string => rows.map((r) => `${r.status}:${r.owner}`).join("|");

const candidateCount = (c: Connection): number =>
  Number((c.db.db.prepare("SELECT COUNT(*) AS c FROM claim_candidate").get() as { c: number }).c);

describe("Slice E — claim / lease / fencing (§M7.1a)", () => {
  test("E-1: two INDEPENDENT connections — exactly one obtains the run, the other reports in_progress", async () => {
    const f = fixture();
    const clock = new Clock();
    const gated = new GatedExtractor(f.drafts);
    const a = connection(f.dbPath, gated, clock);
    const b = connection(f.dbPath, new ImmediateExtractor(f.drafts), clock);

    // claiming is synchronous up to the extractor call, so A already holds the lease here
    const runA = a.service.run(f.version, AT, { owner: "owner-A", leaseMs: 60_000 });
    const runB = await b.service.run(f.version, AT, { owner: "owner-B", leaseMs: 60_000 });

    // ★ §M6.2: `status` keeps its two-member contract enum — the "another run is live" fact is
    // carried ONLY by `in_progress`, never by a third status member.
    assert.ok(runB.in_progress !== undefined, "B must NOT obtain the run while A holds a live lease");
    assert.equal(runB.status, "failed", "the run-result status stays within the contract enum");
    assert.equal(runB.in_progress?.owner, "owner-A");
    assert.equal(runB.in_progress?.attemptSeq, 1);
    assert.equal(runB.created + runB.reused, 0, "B extracted nothing");
    assert.equal(runB.candidateIds.length, 0);
    assert.equal(candidateCount(b), 0, "B wrote no candidate");

    gated.open();
    const doneA = await runA;
    assert.equal(doneA.status, "completed", "A finishes normally");

    const rows = runsFor(a, f.version);
    assert.equal(rows.length, 1, "only ONE attempt row exists");
    assert.equal(rows[0]!.owner, "owner-A");
    assert.equal(rows[0]!.generation, rows[0]!.attempt_seq);
  });

  test("E-2: a live lease is not stealable — the second claim does not create a second executor", async () => {
    const f = fixture();
    const clock = new Clock();
    const gated = new GatedExtractor(f.drafts);
    const a = connection(f.dbPath, gated, clock);
    const b = connection(f.dbPath, new ImmediateExtractor(f.drafts), clock);

    const runA = a.service.run(f.version, AT, { owner: "owner-A", leaseMs: 60_000 });
    for (let i = 1; i <= 3; i += 1) {
      const r = await b.service.run(f.version, AT, { owner: `owner-B${i}`, leaseMs: 60_000 });
      assert.ok(r.in_progress !== undefined, `attempt ${i} must be refused`);
      assert.equal(r.status, "failed", "status stays inside the contract enum");
      assert.equal(r.in_progress?.owner, "owner-A", "the live owner does not change");
    }
    assert.equal(runsFor(b, f.version).length, 1, "no second attempt row was created");
    assert.equal(gated.started, 1, "A's extractor started exactly once");

    gated.open();
    await runA;
  });

  test("E-3: an EXPIRED lease is taken over — owner AND generation change", async () => {
    const f = fixture();
    const clock = new Clock();
    const gated = new GatedExtractor(f.drafts);
    const a = connection(f.dbPath, gated, clock);
    const b = connection(f.dbPath, new ImmediateExtractor(f.drafts), clock);

    const runA = a.service.run(f.version, AT, { owner: "owner-A", leaseMs: 1_000 });
    clock.advance(60_000); // ★ A's lease lapses while it is still extracting

    const runB = await b.service.run(f.version, AT, { owner: "owner-B", leaseMs: 600_000 });
    assert.equal(runB.status, "completed", "B takes over and completes");

    const rows = runsFor(b, f.version);
    assert.equal(rows.length, 2, "a NEW attempt row was created");
    const [first, second] = rows;
    assert.equal(first!.owner, "owner-A");
    assert.equal(first!.status, "failed", "the stale attempt is closed");
    assert.equal(first!.error, "lease_expired");
    assert.equal(second!.owner, "owner-B");
    assert.equal(second!.generation, 2, "the generation moved on");
    assert.equal(second!.attempt_seq, 2);
    assert.ok(first!.attempt_seq! < second!.attempt_seq!, "attempt_seq strictly increased");

    gated.open();
    const late = await runA;
    // ★ and A's own completion did NOT commit anything (the E-4 property)
    assert.equal(late.status, "failed");
    assert.match(late.error ?? "", /lost_lease/);
  });

  test("E-4: ★ the OLD generation cannot commit after a takeover — and cannot overwrite the new owner", async () => {
    const f = fixture();
    const clock = new Clock();
    const gated = new GatedExtractor(f.drafts);
    const a = connection(f.dbPath, gated, clock);
    const b = connection(f.dbPath, new ImmediateExtractor(f.drafts), clock);

    const runA = a.service.run(f.version, AT, { owner: "owner-A", leaseMs: 1_000 });
    clock.advance(60_000);
    const runB = await b.service.run(f.version, AT, { owner: "owner-B", leaseMs: 600_000 });
    assert.equal(runB.status, "completed");
    assert.equal(runB.created, 1, "B wrote its candidate normally");

    const before = runsFor(a, f.version);
    assert.equal(ownersOf(before), "failed:owner-A|completed:owner-B");

    gated.open(); // ★ A resumes AFTER B has taken over
    const late = await runA;
    assert.equal(late.status, "failed", "a superseded generation must not report success");
    assert.equal(late.created, 0);
    assert.equal(late.candidateIds.length, 0, "no candidate id is claimed by a lost generation");

    const after = runsFor(b, f.version);
    assert.deepEqual(after, before, "★ A must not have written ANYTHING to the run table");
    assert.equal(ownersOf(after), "failed:owner-A|completed:owner-B", "the completed attempt still belongs to B");
    // A inserted no candidate of its own: B's single candidate is all there is
    assert.equal(candidateCount(a), 1, "the superseded generation added no candidate");
  });

  test("E-5: the CURRENT generation commits normally", async () => {
    const f = fixture();
    const clock = new Clock();
    const a = connection(f.dbPath, new ImmediateExtractor(f.drafts), clock);
    const r = await a.service.run(f.version, AT, { owner: "owner-A", leaseMs: 60_000 });

    assert.equal(r.status, "completed");
    assert.equal(r.created, 1);
    const rows = runsFor(a, f.version);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "completed");
    assert.equal(rows[0]!.owner, "owner-A");
    assert.equal(rows[0]!.attempt_seq, 1);
    assert.equal(rows[0]!.generation, 1);
  });

  test("★ §M6.2a: the run id is (materialVersionId, configKey, attemptSeq) — `started_at` does NOT enter it", async () => {
    // (a) the SAME (version, config, attemptSeq) with DIFFERENT start times ⇒ the SAME run id.
    // Two INDEPENDENT databases with the same material content, each taking attempt 1.
    const f1 = fixture();
    const f2 = fixture();
    const a1 = connection(f1.dbPath, new ImmediateExtractor(f1.drafts), new Clock());
    const a2 = connection(f2.dbPath, new ImmediateExtractor(f2.drafts), new Clock());

    const r1 = await a1.service.run(f1.version, AT, { owner: "owner-A", leaseMs: 60_000 });
    const r2 = await a2.service.run(f2.version, "2027-05-05T05:05:05.000Z", {
      owner: "owner-A",
      leaseMs: 60_000,
    });

    assert.equal(f1.version.materialVersionId, f2.version.materialVersionId, "same content => same version id");
    assert.equal(r1.status, "completed");
    assert.equal(r2.status, "completed");
    assert.equal(
      r1.extractionId,
      r2.extractionId,
      "★ the same (version, config, attemptSeq) must yield the SAME run id even with different started_at",
    );

    // (b) attemptSeq IS part of the identity: a lease takeover takes attempt 2 on the same
    // (version, config) and must therefore produce a DIFFERENT run id.
    // ★ Slice F (§M13.10) note: this scenario deliberately keeps attempt 1 UNFINISHED — once a run
    // is `completed`, a same-config call is REUSED rather than re-attempted, so a takeover can only
    // be observed while the first attempt is still `running`.
    const f3 = fixture();
    const clock = new Clock();
    const gated = new GatedExtractor(f3.drafts);
    const held = connection(f3.dbPath, gated, clock);
    const taker = connection(f3.dbPath, new ImmediateExtractor(f3.drafts), clock);

    const runHeld = held.service.run(f3.version, AT, { owner: "owner-C", leaseMs: 1_000 });
    const attempt1 = runsFor(taker, f3.version)[0]!;
    assert.equal(attempt1.attempt_seq, 1);
    assert.equal(attempt1.status, "running", "attempt 1 is still in flight — no completed run exists yet");

    clock.advance(60_000); // the lease lapses while attempt 1 is still extracting
    const takeover = await taker.service.run(f3.version, AT, { owner: "owner-D", leaseMs: 600_000 });
    gated.open();
    const late = await runHeld;

    assert.equal(takeover.status, "completed");
    assert.notEqual(takeover.extractionId, attempt1.extraction_id, "attemptSeq is part of the run identity");
    // the superseded generation is blocked by fencing, not merely ignored
    assert.equal(late.status, "failed");
    assert.match(late.error ?? "", /lost_lease/);
    const rows = runsFor(taker, f3.version);
    assert.deepEqual(
      rows.map((r) => r.attempt_seq),
      [1, 2],
      "each claim takes MAX(attempt_seq)+1 and a takeover produces a NEW generation/attempt",
    );
    assert.equal(rows[0]!.status, "failed");
    assert.equal(rows[0]!.error, "lease_expired");
  });

  test("invalid timeoutMs / leaseMs are REFUSED, never clamped", async () => {
    const f = fixture();
    const a = connection(f.dbPath, new ImmediateExtractor(f.drafts), new Clock());
    await assert.rejects(() => a.service.run(f.version, AT, { timeoutMs: 0 }), /timeoutMs must be a positive integer/);
    await assert.rejects(() => a.service.run(f.version, AT, { timeoutMs: -5 }), /timeoutMs must be a positive integer/);
    await assert.rejects(() => a.service.run(f.version, AT, { leaseMs: 0 }), /leaseMs must be a positive integer/);
    await assert.rejects(() => a.service.run(f.version, AT, { leaseMs: 1.5 }), /leaseMs must be a positive integer/);
  });

  test("★ a TIMEOUT is not a lease failure: the row is left running and the lease lapses by itself", async () => {
    const f = fixture();
    const gated = new GatedExtractor(f.drafts); // never released during this test
    const a = connection(f.dbPath, gated, new Clock());

    const r = await a.service.run(f.version, AT, { owner: "owner-A", timeoutMs: 20, leaseMs: 60_000 });
    assert.equal(r.status, "failed");
    assert.match(r.error ?? "", /timed out/);

    const rows = runsFor(a, f.version);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "running", "a timeout must NOT mark the run failed in the database");
    assert.equal(rows[0]!.owner, "owner-A", "the lease still belongs to the timed-out call");
    assert.equal(rows[0]!.generation, 1, "and no new generation was taken");
  });
});
