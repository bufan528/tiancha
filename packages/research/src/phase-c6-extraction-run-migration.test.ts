/**
 * C6 model-extractor · Slice D acceptance — T-C6-38: the `extraction_run` migration.
 *
 * Contract rev7 §M7.1b / §M9 #4/#4b/#4c. This is the first slice that touches an EXISTING file
 * (`storage/research-db.ts`) and the first with real persistence semantics, so the test proves the
 * migration itself: structure, backfill, legacy downgrade, FAIL FAST on conflict, atomicity, and
 * safe re-runs.
 *
 * Method: build a database with the OLD `extraction_run` shape by hand (temp file, real SQLite),
 * then open it through `ResearchDb` so the migration runs for real.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ResearchDb } from "./storage/research-db.js";
import { sha256Hex } from "./domain/material-source.js";

const AT = "2026-09-27T00:00:00.000Z";

/** The OLD 12-column shape, exactly as it existed before this slice. */
const OLD_TABLE = `
  CREATE TABLE extraction_run (
    extraction_id TEXT PRIMARY KEY,
    material_version_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    extraction_config_key TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    candidate_ids_json TEXT NOT NULL DEFAULT '[]',
    error TEXT
  )`;

interface OldRow {
  extractionId: string;
  versionId: string;
  configKey: string;
  startedAt: string;
  status: string;
}

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

/** Create a database whose `extraction_run` still has the OLD shape, then open it via ResearchDb. */
function migrateLegacy(rows: OldRow[], extra = (db: DatabaseSync) => {}): { dir: string; db: ResearchDb } {
  const dir = mkdtempSync(join(tmpdir(), "tiancha-c6d-d-"));
  dirs.push(dir);
  const path = join(dir, "tiancha.sqlite");
  const raw = new DatabaseSync(path);
  raw.exec(OLD_TABLE);
  const insert = raw.prepare(
    `INSERT INTO extraction_run
       (extraction_id, material_version_id, model_version, prompt_version, parser_version,
        schema_version, extraction_config_key, started_at, status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  for (const r of rows) {
    insert.run(r.extractionId, r.versionId, "m", "p", "pa", "s", r.configKey, r.startedAt, r.status);
  }
  extra(raw);
  raw.close();

  const db = new ResearchDb({ path });
  opened.push(db);
  return { dir, db };
}

/** Re-open an already-migrated database (drives the migration a SECOND time). */
function reopen(dir: string): ResearchDb {
  const db = new ResearchDb({ path: join(dir, "tiancha.sqlite") });
  opened.push(db);
  return db;
}

/**
 * Open RAW, with no migrations. Needed AFTER a deliberately failing migration: `new ResearchDb`
 * would simply fail again, so the post-failure state can only be observed through a plain handle.
 */
function withRaw<T>(dir: string, fn: (db: DatabaseSync) => T): T {
  const raw = new DatabaseSync(join(dir, "tiancha.sqlite"));
  try {
    return fn(raw);
  } finally {
    raw.close();
  }
}

const columns = (db: ResearchDb): Array<{ name: string; type: string; notnull: number; dflt_value: string | null }> =>
  db.db.prepare("PRAGMA table_info(extraction_run)").all() as never;

const indexSql = (db: ResearchDb, name: string): string | undefined =>
  (db.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as { sql?: string } | undefined)
    ?.sql;

const runRows = (db: ResearchDb): Array<{ extraction_id: string; status: string; attempt_seq: number | null; generation: number | null; error: string | null }> =>
  db.db
    .prepare("SELECT extraction_id, status, attempt_seq, generation, error FROM extraction_run ORDER BY extraction_id")
    .all() as never;

/** Content fingerprint of `extraction_run` (columns sorted, rows sorted) — for atomicity/re-run checks. */
const runFingerprint = (db: ResearchDb): string =>
  sha256Hex(
    JSON.stringify(
      (db.db.prepare("SELECT * FROM extraction_run ORDER BY extraction_id").all() as Array<Record<string, unknown>>).map(
        (row) =>
          Object.keys(row)
            .sort()
            .map((k) => `${k}=${String(row[k])}`)
            .join("&"),
      ),
    ),
  );

const schemaFingerprint = (db: ResearchDb): string =>
  sha256Hex(
    JSON.stringify(
      (columns(db) as Array<{ name: string; type: string }>).map((c) => `${c.name}:${c.type}`).sort(),
    ),
  );

const NEW_COLUMNS = [
  "chunker_version",
  "methodology_version_id",
  "dimension_set_hash",
  "max_quote_chars",
  "attempt_seq",
  "config_snapshot_json",
  "owner",
  "lease_until",
  "generation",
];

describe("T-C6-38 — extraction_run migration (§M7.1b)", () => {
  test("① structure: the nine new columns exist (nullable) and consume the partial unique index is created with the right predicate", () => {
    const { db } = migrateLegacy([]);
    const cols = columns(db);
    for (const name of NEW_COLUMNS) {
      const c = cols.find((x) => x.name === name);
      assert.ok(c !== undefined, `${name} must exist after the migration`);
      assert.equal(c.notnull, 0, `${name} must stay NULLABLE (nothing writes it in this slice)`);
      assert.equal(c.dflt_value, null, `${name} must have no DEFAULT`);
    }
    assert.equal(cols.find((x) => x.name === "max_quote_chars")?.type, "INTEGER");
    assert.equal(cols.find((x) => x.name === "generation")?.type, "INTEGER");
    assert.equal(cols.find((x) => x.name === "attempt_seq")?.type, "INTEGER");

    const sql = indexSql(db, "idx_extraction_run_single_active");
    assert.ok(sql !== undefined, "the partial unique index must exist");
    assert.match(sql!, /UNIQUE/i);
    assert.match(sql!, /material_version_id,\s*extraction_config_key/i);
    assert.match(sql!, /WHERE\s+status\s*=\s*'running'/i);
  });

  test("② backfill: EVERY NULL row is numbered per group, ordered by (started_at, extraction_id), continuing from that group's MAX+1", () => {
    const { db } = migrateLegacy([
      // group A — inserted in reverse time order on purpose
      { extractionId: "x-a3", versionId: "mver-1", configKey: "xcfg-a", startedAt: "2026-09-27T03:00:00.000Z", status: "completed" },
      { extractionId: "x-a1", versionId: "mver-1", configKey: "xcfg-a", startedAt: "2026-09-27T01:00:00.000Z", status: "failed" },
      { extractionId: "x-a2", versionId: "mver-1", configKey: "xcfg-a", startedAt: "2026-09-27T02:00:00.000Z", status: "completed" },
      // group B — a different config key on the same material version
      { extractionId: "x-b1", versionId: "mver-1", configKey: "xcfg-b", startedAt: "2026-09-27T01:00:00.000Z", status: "completed" },
      // group C — a different material version
      { extractionId: "x-c1", versionId: "mver-2", configKey: "xcfg-a", startedAt: "2026-09-27T01:00:00.000Z", status: "completed" },
    ]);

    const rows = runRows(db);
    const seq = (id: string): number | null => rows.find((r) => r.extraction_id === id)?.attempt_seq ?? null;
    const gen = (id: string): number | null => rows.find((r) => r.extraction_id === id)?.generation ?? null;

    // ordered by started_at inside the group
    assert.equal(seq("x-a1"), 1);
    assert.equal(seq("x-a2"), 2);
    assert.equal(seq("x-a3"), 3);
    // each group starts at its own MAX+1 (here: 1)
    assert.equal(seq("x-b1"), 1);
    assert.equal(seq("x-c1"), 1);
    // generation is initialised from the attempt number
    for (const id of ["x-a1", "x-a2", "x-a3", "x-b1", "x-c1"]) assert.equal(gen(id), seq(id));

    // no duplicate (material_version_id, extraction_config_key, attempt_seq)
    const dupes = db.db
      .prepare(
        `SELECT material_version_id, extraction_config_key, attempt_seq, COUNT(*) AS c
           FROM extraction_run
          GROUP BY material_version_id, extraction_config_key, attempt_seq
         HAVING c > 1`,
      )
      .all();
    assert.deepEqual(dupes, [], "attempt_seq must be unique inside its (version, config) group");
  });

  test("③ legacy running WITHOUT lease evidence is downgraded; a running row WITH a lease is not", () => {
    const { dir, db } = migrateLegacy([
      { extractionId: "x-legacy", versionId: "mver-1", configKey: "xcfg-a", startedAt: AT, status: "running" },
      { extractionId: "x-done", versionId: "mver-1", configKey: "xcfg-a", startedAt: AT, status: "completed" },
    ]);
    const legacy = runRows(db).find((r) => r.extraction_id === "x-legacy");
    assert.equal(legacy?.status, "failed", "a running row with no lease evidence must be downgraded");
    assert.equal(legacy?.error, "legacy_interrupted");
    assert.equal(runRows(db).find((r) => r.extraction_id === "x-done")?.status, "completed", "other rows untouched");

    // a running row that DOES hold a lease must survive the migration
    db.db
      .prepare("UPDATE extraction_run SET status='running', owner='worker-1', lease_until='2099-01-01T00:00:00.000Z' WHERE extraction_id='x-done'")
      .run();
    db.close();
    const again = reopen(dir);
    assert.equal(
      runRows(again).find((r) => r.extraction_id === "x-done")?.status,
      "running",
      "a running row WITH a lease must not be downgraded",
    );
  });

  test("④ conflict ⇒ FAIL FAST: the migration aborts, lists the offenders, fixes nothing and rolls back", () => {
    const { dir, db } = migrateLegacy([
      { extractionId: "x-r1", versionId: "mver-1", configKey: "xcfg-a", startedAt: AT, status: "completed" },
      { extractionId: "x-r2", versionId: "mver-1", configKey: "xcfg-a", startedAt: AT, status: "completed" },
    ]);
    // Put the database into the ONLY state that can still conflict after step ③: two running rows
    // that both hold a valid lease. The index must be dropped FIRST — with it in place, the second
    // UPDATE could not make a second row running.
    db.db.exec("DROP INDEX idx_extraction_run_single_active");
    db.db
      .prepare("UPDATE extraction_run SET status='running', owner='w', lease_until='2099-01-01T00:00:00.000Z' WHERE extraction_id IN ('x-r1','x-r2')")
      .run();
    const before = runFingerprint(db);
    db.close();

    assert.throws(
      () => new ResearchDb({ path: join(dir, "tiancha.sqlite") }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /multiple running rows/);
        assert.match(msg, /x-r1/);
        assert.match(msg, /x-r2/);
        return true;
      },
      "the migration must FAIL FAST on a real conflict",
    );

    // Inspect through a RAW handle: `new ResearchDb` would just re-run the migration and fail again.
    const state = withRaw(dir, (raw) => ({
      running: (
        raw.prepare("SELECT extraction_id FROM extraction_run WHERE status='running' ORDER BY extraction_id").all() as Array<{
          extraction_id: string;
        }>
      ).map((r) => r.extraction_id),
      indexSql: (
        raw
          .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_extraction_run_single_active'")
          .get() as { sql?: string } | undefined
      )?.sql,
      fingerprint: sha256Hex(
        JSON.stringify(
          (raw.prepare("SELECT * FROM extraction_run ORDER BY extraction_id").all() as Array<Record<string, unknown>>).map(
            (row) =>
              Object.keys(row)
                .sort()
                .map((k) => `${k}=${String(row[k])}`)
                .join("&"),
          ),
        ),
      ),
    }));

    // it did NOT silently repair the conflict…
    assert.deepEqual(state.running, ["x-r1", "x-r2"], "the migration must not quietly resolve the conflict");
    // …the conflicting index still does not exist…
    assert.equal(state.indexSql, undefined, "no index may be left behind");
    // …and nothing else about the data changed during the failed migration
    assert.equal(state.fingerprint, before, "a failed migration must leave the data as it was");
  });
  test("⑤ atomicity: a failed migration leaves BOTH the schema and the data at their pre-migration state", () => {
    // Build a database whose `extraction_run` ALREADY has the new columns (so a rollback cannot
    // hide behind "the columns were never added") but whose index is missing, and make the
    // migration fail via a real conflict. The rollback must then restore the index-less, running
    // state exactly — no half-applied cleanup.
    const { dir, db } = migrateLegacy([
      { extractionId: "y-r1", versionId: "mver-9", configKey: "xcfg-y", startedAt: AT, status: "completed" },
      { extractionId: "y-r2", versionId: "mver-9", configKey: "xcfg-y", startedAt: AT, status: "completed" },
    ]);
    db.db.exec("DROP INDEX idx_extraction_run_single_active");
    db.db
      .prepare("UPDATE extraction_run SET status='running', owner='w', lease_until='2099-01-01T00:00:00.000Z' WHERE extraction_id IN ('y-r1','y-r2')")
      .run();
    const schemaBefore = schemaFingerprint(db);
    const dataBefore = runFingerprint(db);
    db.close();

    assert.throws(() => new ResearchDb({ path: join(dir, "tiancha.sqlite") }), /multiple running rows/);

    // RAW again: the db is still in the conflicting state, so ResearchDb cannot be opened.
    const after = withRaw(dir, (raw) => ({
      schema: sha256Hex(
        JSON.stringify(
          (raw.prepare("PRAGMA table_info(extraction_run)").all() as Array<{ name: string; type: string }>)
            .map((c) => `${c.name}:${c.type}`)
            .sort(),
        ),
      ),
      data: sha256Hex(
        JSON.stringify(
          (raw.prepare("SELECT * FROM extraction_run ORDER BY extraction_id").all() as Array<Record<string, unknown>>).map(
            (row) =>
              Object.keys(row)
                .sort()
                .map((k) => `${k}=${String(row[k])}`)
                .join("&"),
          ),
        ),
      ),
      indexSql: (
        raw
          .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_extraction_run_single_active'")
          .get() as { sql?: string } | undefined
      )?.sql,
    }));

    assert.equal(after.schema, schemaBefore, "schema must be unchanged by the failed migration");
    assert.equal(after.data, dataBefore, "data must be unchanged by the failed migration");
    assert.equal(after.indexSql, undefined, "no index may be left behind");
  });

  test("⑥ re-run: opening the database again neither renumbers rows nor changes anything", () => {
    const { dir, db } = migrateLegacy([
      { extractionId: "z-1", versionId: "mver-1", configKey: "xcfg-a", startedAt: "2026-09-27T01:00:00.000Z", status: "completed" },
      { extractionId: "z-2", versionId: "mver-1", configKey: "xcfg-a", startedAt: "2026-09-27T02:00:00.000Z", status: "completed" },
    ]);
    const firstSeq = runRows(db).map((r) => `${r.extraction_id}=${r.attempt_seq}`);
    const firstFingerprint = runFingerprint(db);
    const firstSchema = schemaFingerprint(db);
    const firstIndex = indexSql(db, "idx_extraction_run_single_active");
    db.close();

    for (let i = 0; i < 2; i += 1) {
      const again = reopen(dir);
      assert.deepEqual(
        runRows(again).map((r) => `${r.extraction_id}=${r.attempt_seq}`),
        firstSeq,
        "re-running the migration must not renumber anything",
      );
      assert.equal(runFingerprint(again), firstFingerprint, "data fingerprint must be stable across re-runs");
      assert.equal(schemaFingerprint(again), firstSchema, "schema fingerprint must be stable across re-runs");
      assert.equal(indexSql(again, "idx_extraction_run_single_active"), firstIndex, "the index is created once");
      again.close();
    }
    // and the database still rejects a SECOND running run for the same (version, config)
    const last = reopen(dir);
    last.db
      .prepare("UPDATE extraction_run SET status='running', owner='w', lease_until='2099-01-01T00:00:00.000Z' WHERE extraction_id='z-1'")
      .run();
    assert.throws(
      () =>
        last.db
          .prepare("UPDATE extraction_run SET status='running', owner='w', lease_until='2099-01-01T00:00:00.000Z' WHERE extraction_id='z-2'")
          .run(),
      /UNIQUE|constraint/i,
      "the partial unique index must actually forbid two running runs of one configuration",
    );

    // ★ a row added LATER without a number must continue from that group's MAX+1 (= 3), never
    // restart at 1, and must not disturb the numbers already handed out.
    last.db
      .prepare(
        `INSERT INTO extraction_run
           (extraction_id, material_version_id, model_version, prompt_version, parser_version,
            schema_version, extraction_config_key, started_at, status)
         VALUES ('z-3','mver-1','m','p','pa','s','xcfg-a','2026-09-27T03:00:00.000Z','failed')`,
      )
      .run();
    last.close();

    const third = reopen(dir);
    assert.equal(
      runRows(third).find((r) => r.extraction_id === "z-3")?.attempt_seq,
      3,
      "a later unnumbered row continues from the group's MAX+1",
    );
    assert.equal(runRows(third).find((r) => r.extraction_id === "z-1")?.attempt_seq, 1, "existing numbers are never rewritten");
    assert.equal(runRows(third).find((r) => r.extraction_id === "z-2")?.attempt_seq, 2, "existing numbers are never rewritten");
  });

  test("an OLD database whose claim_candidate lacks the new claim_candidate columns also migrates", () => {
    // Reproduces a real defect found while building this slice: those two columns were added with a
    // MALFORMED migration (a bare "TEXT" instead of a complete ALTER). On a fresh database it was
    // invisible (CREATE TABLE already contained them); on an EXISTING one, opening the database
    // CRASHED. The real library is exactly this case: claim_candidate exists, the columns do not.
    const dir = mkdtempSync(join(tmpdir(), "tiancha-c6d-legacy-cc-"));
    dirs.push(dir);
    const path = join(dir, "tiancha.sqlite");
    const raw = new DatabaseSync(path);
    // a pre-existing table WITHOUT the two columns (and with the columns the rest of the repository
    // expects, so nothing downstream has to be lenient)
    raw.exec(`CREATE TABLE claim_candidate (
      candidate_id TEXT PRIMARY KEY,
      material_version_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL DEFAULT 'industry',
      subject_id TEXT NOT NULL DEFAULT 'ind-0',
      dimension TEXT NOT NULL DEFAULT '',
      block_hash TEXT NOT NULL DEFAULT '',
      statement TEXT NOT NULL DEFAULT '',
      content_kind TEXT NOT NULL DEFAULT 'fact',
      confidence REAL,
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      extraction_id TEXT NOT NULL DEFAULT '',
      extraction_config_key TEXT NOT NULL DEFAULT '',
      review_status TEXT NOT NULL DEFAULT 'draft',
      reviewed_by TEXT,
      reviewed_at TEXT,
      decision_relation TEXT,
      confirmed_claim_ref TEXT,
      supersedes_candidate_ref TEXT,
      projection_status TEXT NOT NULL DEFAULT 'none',
      reserved_claim_id TEXT,
      projection_error TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    )`);
    raw.close();

    const db = new ResearchDb({ path });
    opened.push(db);
    const cols = (db.db.prepare("PRAGMA table_info(claim_candidate)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    assert.ok(cols.includes("superseded_claim_ref"), "the column must be added to a pre-existing table");
    assert.ok(cols.includes("revised_claim_ref"), "the column must be added to a pre-existing table");
  });

  test("the migration method owns its transaction boundary (a nested BEGIN is refused, not silently joined)", () => {
    const { db } = migrateLegacy([]);
    // `migrateExtractionRunState` is private; the invariant is observable through its own guard:
    // drive it again from inside an open transaction and require the refusal.
    const anyDb = db as unknown as { migrateExtractionRunState: () => void };
    db.db.exec("BEGIN IMMEDIATE");
    try {
      assert.throws(() => anyDb.migrateExtractionRunState(), /must own its transaction boundary/);
    } finally {
      db.db.exec("ROLLBACK");
    }
    // …and with no transaction open it completes without error
    assert.doesNotThrow(() => anyDb.migrateExtractionRunState());
  });
});
