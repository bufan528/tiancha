/**
 * Phase C-MVP-R1 (§29) — material ingest RELIABILITY.
 *
 *   T-R1-1   a failure after the material row is written ⇒ RESUMABLE (never a permanent残骸)
 *   T-R1-2   a crash mid-artifacts ⇒ resume writes each block ONCE (count = valid blocks)
 *   T-R1-3   a crash mid-projection ⇒ no duplicate belief / pool item
 *   T-R1-4   a crash before the closing write ⇒ both directions complete after resume
 *   T-R1-5   the same content twice (same process) ⇒ `duplicate`, zero new rows
 *   T-R1-6   a COMPLETED row again ⇒ `duplicate`, content fingerprint unchanged
 *   T-R1-7   the boolean `created` is GONE (compile-time AND behaviour)
 *   T-R1-8   the one-shot migration never rewrites ids / refs / row count
 *   T-R1-9   the parser version is recorded; a completed row is never auto-rerun
 *   T-R1-10  TWO independent processes ⇒ exactly one writer (insert race AND failed-resume race)
 *   T-R1-11  the triage is three-way and (c) `legacy_failed` is never auto-resumed
 *   T-R1-12  the cross-DB window: an artifact written without a ledger record is REUSED
 *
 * Assertions are behavioural: outcomes, row counts, content fingerprints, artifact ids —
 * never log wording.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import {
  SqliteArtifactStore,
  type ArtifactStore,
  type ArtifactRecord,
} from "./storage/artifact-store.js";
import type { ArtifactRef } from "./domain/artifact.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { MaterialIngestService } from "./application/material-ingest-service.js";
import { PARSER_VERSION } from "./domain/material-parser.js";
import { ingestIdFor } from "./domain/material.js";

const MATERIAL = `访谈纪要正文。

[CLAIM]
dimension: market
content: 市场空间约 500 亿元
confidence: 0.8
source: 访谈 A
[/CLAIM]

[CLAIM]
dimension: demand
content: 头部客户开始小批量采购
[/CLAIM]

[CLAIM]
dimension: supply
content: 供给集中度提升
[/CLAIM]

[CLAIM]
content: 缺少 dimension 的坏块，必须被报告而不是被臆测
[/CLAIM]
`;

const VALID_BLOCKS = 3;

/** Injects a failure at the Nth artifact write of the MATERIAL pipeline (§29.8). */
class FlakyArtifactStore implements ArtifactStore {
  private calls = 0;
  constructor(
    private readonly inner: ArtifactStore,
    private readonly failAt: number,
    /** true ⇒ write, THEN throw: a crash right after the cross-DB write (§29.5b). */
    private readonly failAfterWrite = false,
  ) {}
  async put(record: ArtifactRecord): Promise<ArtifactRef> {
    this.calls += 1;
    if (this.calls === this.failAt && this.failAfterWrite) {
      await this.inner.put(record);
      throw new Error(`injected failure AFTER artifact write #${this.calls}`);
    }
    if (this.calls === this.failAt) throw new Error(`injected failure at artifact write #${this.calls}`);
    return this.inner.put(record);
  }
  get(id: string) {
    return this.inner.get(id);
  }
  listByRun(id: string) {
    return this.inner.listByRun(id);
  }
  listByTask(id: string) {
    return this.inner.listByTask(id);
  }
  close() {
    return this.inner.close();
  }
}

interface Fixture {
  db: ResearchDb;
  repo: ResearchRepository;
  inner: SqliteArtifactStore;
  sid: string;
  /** material pipeline wired to a healthy store. */
  healthy: () => MaterialIngestService;
  /** material pipeline wired to a store that fails at the Nth write. */
  broken: (failAt: number, failAfterWrite?: boolean) => MaterialIngestService;
}

/** The industry is ALWAYS bootstrapped with a healthy store — only the material run is sabotaged. */
async function setup(industryName = "R1 行业"): Promise<Fixture> {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const inner = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), inner);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName });
  const svc = (store: ArtifactStore, ownerId: string) =>
    new MaterialIngestService(repo, new EchoDataProvider(), store, { leaseMs: 30_000, ownerId });
  return {
    db,
    repo,
    inner,
    sid: res.industry.industryId,
    healthy: () => svc(inner, "test-owner"),
    broken: (failAt, failAfterWrite = false) =>
      svc(new FlakyArtifactStore(inner, failAt, failAfterWrite), "test-owner"),
  };
}

function submit(materials: MaterialIngestService, sid: string) {
  return materials.ingest({ subjectKind: "industry", subjectId: sid, title: "纪要", text: MATERIAL });
}

/** Whole-subject CONTENT fingerprint: nothing moved ⟺ nothing was written. */
function fingerprint(repo: ResearchRepository, sid: string): string {
  const knowledge = new KnowledgeRepository(repo.db);
  const k = knowledge.findKnowledgeBySubject("industry", sid);
  return JSON.stringify({
    materials: repo.listMaterials(sid).map((m) => [m.materialId, m.claimRefs, m.ingestStatus, m.ingestBlocks]),
    beliefs: k ? knowledge.listBeliefs(k.knowledgeId).map((b) => [b.beliefId, b.state]) : [],
    slots: repo.listPoolSlots(sid).map((s) => [s.dimension, s.status]),
    items: repo.listPoolSlots(sid).flatMap((s) => repo.listPoolItems(s.slotId).map((i) => i.itemId)),
    gaps: repo.listGaps(sid).map((g) => [g.gapId, g.status]),
    actions: repo.listNextActions(sid).map((a) => [a.actionId, a.status]),
  });
}

describe("C-MVP-R1 · resumable ingest (§29.1–§29.5)", () => {
  // The fixture has 4 blocks but only 3 are VALID — a 4th artifact write never happens (§29.8).
  for (const failAt of [1, 2, 3]) {
    test(`T-R1-1…T-R1-4: a crash at artifact write #${failAt} is resumed, never duplicated`, async () => {
      const t = await setup(`R1 行业 ${failAt}`);
      try {
        const broken = t.broken(failAt);
        const first = await submit(broken, t.sid);
        assert.equal(first.outcome, "failed", `T-R1-1: write #${failAt} failing ⇒ outcome failed`);
        assert.equal(first.material.ingestStatus, "failed");
        assert.equal(first.material.parserVersion, PARSER_VERSION, "T-R1-9: parser version recorded");
        assert.equal(first.material.ingestError?.length !== 0, true, "the error is recorded, not swallowed");
        assert.equal(first.material.ingestBlocks.length, VALID_BLOCKS, "T-R1-2: only VALID blocks are counted");
        assert.equal(
          new Set(first.material.ingestBlocks.map((b) => b.blockIndex)).size,
          VALID_BLOCKS,
          "the ledger has one entry per block",
        );
        const reservedIds = first.material.ingestBlocks.map((b) => b.claimId);
        const materialId = first.material.materialId;

        // ---- resume with a HEALTHY store: the SAME content must not be "duplicate"
        const resumed = await submit(t.healthy(), t.sid);
        assert.equal(resumed.outcome, "resumed", "T-R1-1: a残骸 is continued, not skipped");
        assert.equal(resumed.material.materialId, materialId, "the resume reuses the same material row");
        assert.equal(resumed.material.ingestStatus, "completed");
        assert.deepEqual(
          resumed.material.ingestBlocks.map((b) => b.claimId),
          reservedIds,
          "T-R1-12: the claim ids reserved in P1 survive and are reused",
        );
        assert.equal(
          resumed.material.ingestBlocks.filter((b) => b.state === "projected").length,
          VALID_BLOCKS,
          "T-R1-2/3: every block ended up projected",
        );
        assert.deepEqual(resumed.material.claimRefs, reservedIds, "T-R1-4: refs match the blocks exactly");

        // ---- cross-DB: exactly ONE artifact per block, and the belief set did not double up
        const runId = `ingest-${ingestIdFor("industry", t.sid, resumed.material.contentHash)}`;
        const artifacts = await t.inner.listByRun(runId);
        assert.equal(artifacts.length, VALID_BLOCKS, "T-R1-2: one artifact per valid block — no duplicates");
        assert.equal(new Set(artifacts.map((a) => a.artifactId)).size, VALID_BLOCKS, "artifact ids unique");

        const knowledge = new KnowledgeRepository(t.db.db);
        const k = knowledge.findKnowledgeBySubject("industry", t.sid)!;
        const beliefs = knowledge.listBeliefs(k.knowledgeId);
        assert.equal(beliefs.length, VALID_BLOCKS, "T-R1-3: one belief per claim — the projection did not repeat");

        // ---- and it is now a complete duplicate
        const again = await submit(t.healthy(), t.sid);
        assert.equal(again.outcome, "duplicate", "T-R1-5: now it IS a complete duplicate");
      } finally {
        await t.inner.close();
        t.db.close();
      }
    });
  }

  test("T-R1-5/6: a complete import reports `duplicate` and moves NOTHING", async () => {
    const t = await setup("R1 行业 dup");
    try {
      const first = await submit(t.healthy(), t.sid);
      assert.equal(first.outcome, "created");
      assert.equal(first.material.claimRefs.length, VALID_BLOCKS);
      const before = fingerprint(t.repo, t.sid);

      const again = await submit(t.healthy(), t.sid);
      assert.equal(again.outcome, "duplicate");
      assert.equal(fingerprint(t.repo, t.sid), before, "T-R1-6: zero new rows anywhere");
      assert.equal(t.repo.listMaterials(t.sid).length, 1, "one row per (subject, content)");
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });

  test("T-R1-7: the boolean `created` is gone from the public API", async () => {
    const t = await setup("R1 行业 api");
    try {
      const result = await submit(t.healthy(), t.sid);
      // Compile-time: the outcome union has NO `created` property any more.
      // @ts-expect-error — `created` was removed by §29.4 (replaced by the five-value outcome).
      const legacyFlag: boolean = result.created;
      void legacyFlag;
      // Behaviour: the union member really is `outcome`.
      assert.equal("outcome" in result, true);
      assert.equal("created" in result, false);
      assert.ok(
        ["created", "duplicate", "resumed", "failed", "in_progress"].includes(result.outcome),
        "only the five declared outcomes exist",
      );
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });

  test("T-R1-9: a completed row is never re-run by a plain submission; --force is explicit", async () => {
    const t = await setup("R1 行业 force");
    try {
      const first = await submit(t.healthy(), t.sid);
      const material = t.repo.getMaterial(first.material.materialId)!;
      assert.equal(material.parserVersion, PARSER_VERSION);
      assert.equal(material.modelVersion, undefined, "no model under C-MVP-R1");
      assert.equal(material.ingestAttempts, 1, "exactly one claim attempt");
      assert.equal(material.ingestOwner, undefined, "the lease is released after success");
      assert.equal(material.ingestLeaseUntil, undefined);

      const noForce = await t.healthy().retry(material.materialId);
      assert.equal(noForce.outcome, "duplicate", "completed + no --force ⇒ no-op");

      const before = fingerprint(t.repo, t.sid);
      const forced = await t.healthy().retry(material.materialId, { force: true });
      assert.equal(forced.outcome, "resumed", "an EXPLICIT force re-run is allowed");
      assert.equal(forced.material.ingestStatus, "completed");
      assert.equal(t.repo.listMaterials(t.sid).length, 1, "force never forks the material row");
      assert.equal(fingerprint(t.repo, t.sid), before, "a force re-run of a complete import is idempotent");
      assert.ok(forced.material.ingestAttempts >= 2, "the attempt counter is auditable");
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });

  test("T-R1-12: an artifact written without a ledger record is REUSED after the crash", async () => {
    const t = await setup("R1 行业 xdb");
    try {
      const broken = t.broken(1, /* failAfterWrite */ true);
      const first = await submit(broken, t.sid);
      assert.equal(first.outcome, "failed", "the crash-after-write surfaces as failed");
      const reservedIds = first.material.ingestBlocks.map((b) => b.claimId);
      const runId = `ingest-${ingestIdFor("industry", t.sid, first.material.contentHash)}`;

      // The artifact of block #1 reached the OTHER database before the crash…
      const writtenSoFar = await t.inner.listByRun(runId);
      assert.equal(writtenSoFar.length, 1, "exactly the first block's artifact exists");

      // …and a healthy resume must REUSE that artifact id rather than write a second row.
      const resumed = await t.healthy().retry(first.material.materialId);
      assert.equal(resumed.outcome, "resumed");
      assert.deepEqual(resumed.material.ingestBlocks.map((b) => b.claimId), reservedIds);
      const all = await t.inner.listByRun(runId);
      assert.equal(all.length, VALID_BLOCKS, "one row per block — the orphan write was reused");
      assert.deepEqual(
        all.map((a) => a.artifactId).sort(),
        [...reservedIds].sort(),
        "the surviving artifact is one of the reserved ids",
      );
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });
});

describe("C-MVP-R1 · the one-shot migration (§29.2)", () => {
  test("T-R1-8/11: three-way triage; ids/refs/row-count untouched; (c) never auto-resumed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tiancha-r1-mig-"));
    const dbPath = join(dir, "tiancha.sqlite");
    const legacyWithClaimsA = `[CLAIM]\ndimension: market\ncontent: 历史材料里的有效块 A\n[/CLAIM]\n`;
    const legacyWithClaimsC = `[CLAIM]\ndimension: market\ncontent: 历史材料里的有效块 C\n[/CLAIM]\n`;
    const legacyWithoutClaims = `只有散文，没有任何 [CLAIM] 块。\n`;
    // ★ the content hash must be the REAL one, otherwise the dedupe gate cannot see the残骸.
    const hashOf = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
    const opened: ResearchDb[] = [];
    let artifacts: SqliteArtifactStore | undefined;

    try {
      // --- build "legacy" rows (the C-MVP shape: parser_version IS NULL)
      const db1 = new ResearchDb({ path: dbPath });
      opened.push(db1);
      const insert = db1.db.prepare(
        `INSERT INTO material
           (material_id, subject_kind, subject_id, kind, title, content_hash, raw_text,
            claim_refs_json, received_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      );
      const at = "2026-01-01T00:00:00.000Z";
      insert.run("mat-legacy-a", "industry", "ind-legacy", "text", "a", hashOf(legacyWithClaimsA), legacyWithClaimsA, '["claim-old-1"]', at, at);
      insert.run("mat-legacy-b", "industry", "ind-legacy", "text", "b", hashOf(legacyWithoutClaims), legacyWithoutClaims, "[]", at, at);
      insert.run("mat-legacy-c", "industry", "ind-legacy", "text", "c", hashOf(legacyWithClaimsC), legacyWithClaimsC, "[]", at, at);
      const beforeCount = (db1.db.prepare("SELECT COUNT(*) AS n FROM material").get() as { n: number }).n;
      db1.close();

      // --- reopen: the one-shot triage runs exactly once, and says what it did
      const db2 = new ResearchDb({ path: dbPath });
      opened.push(db2);
      const repo2 = new ResearchRepository(db2.db);
      assert.deepEqual(
        db2.materialMigrationSummary,
        { completedWithRefs: 1, completedWithoutClaims: 1, legacyFailed: 1 },
        "T-R1-11: the three-way summary is produced (a migration is never silent)",
      );
      assert.equal(
        (db2.db.prepare("SELECT COUNT(*) AS n FROM material").get() as { n: number }).n,
        beforeCount,
        "T-R1-8: the row count is untouched",
      );
      const a = repo2.getMaterial("mat-legacy-a")!;
      const b = repo2.getMaterial("mat-legacy-b")!;
      const c = repo2.getMaterial("mat-legacy-c")!;
      assert.equal(a.ingestStatus, "completed", "(a) refs non-empty ⇒ completed");
      assert.deepEqual(a.claimRefs, ["claim-old-1"], "T-R1-8: refs are NOT rewritten");
      assert.equal(a.materialId, "mat-legacy-a", "T-R1-8: ids are NOT rewritten");
      assert.equal(b.ingestStatus, "completed", "(b) no valid block ⇒ the import really did finish");
      assert.equal(c.ingestStatus, "legacy_failed", "(c) valid blocks + no refs ⇒ 残骸");
      assert.equal(c.ingestStage, "parsed");
      assert.equal(c.ingestError, "LEGACY_PARTIAL_IMPORT");
      assert.equal(c.parserVersion, PARSER_VERSION, "the triage records its own parser version");
      assert.deepEqual(c.claimRefs, [], "T-R1-8: (c) keeps its refs too");
      db2.close();

      // --- idempotent: a second open has nothing left to judge
      const db3 = new ResearchDb({ path: dbPath });
      opened.push(db3);
      assert.deepEqual(db3.materialMigrationSummary, {
        completedWithRefs: 0,
        completedWithoutClaims: 0,
        legacyFailed: 0,
      });

      // --- (c) is NEVER continued by a plain submission; only an explicit human retry may
      const repo3 = new ResearchRepository(db3.db);
      artifacts = new SqliteArtifactStore({ path: ":memory:" });
      const materials = new MaterialIngestService(repo3, new EchoDataProvider(), artifacts, { ownerId: "t" });
      const plain = await materials.ingest({
        subjectKind: "industry",
        subjectId: "ind-legacy",
        title: "c",
        text: legacyWithClaimsC,
      });
      assert.equal(plain.outcome, "failed", "T-R1-11: a残骸 is not silently continued");
      assert.equal(plain.outcome === "failed" ? plain.stage : "", "migration");
      assert.equal(
        plain.outcome === "failed" ? plain.error : "",
        "LEGACY_PARTIAL_IMPORT",
        "the reason is reported, not hidden",
      );
      assert.equal(repo3.getMaterial("mat-legacy-c")!.ingestStatus, "legacy_failed", "left exactly as it was");
      db3.close();
    } finally {
      // Windows keeps a closed SQLite file locked if the handle was never released.
      for (const d of opened) {
        try {
          d.close();
        } catch {
          /* already closed */
        }
      }
      if (artifacts) {
        try {
          await artifacts.close();
        } catch {
          /* already closed */
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// T-R1-10 — TWO independent operating-system processes.
// ---------------------------------------------------------------------------

const PROBE = `
import { readFileSync } from "node:fs";
const [modUrl, mode, dbPath, artPath, idOrSid, textFile] = process.argv.slice(2);
const mod = await import(modUrl);
// Opening the DB bootstraps the schema (which WRITES) — two processes can lose that lock, so
// retry instead of reporting a probe error that has nothing to do with the ingest logic.
let db = null;
for (let attempt = 0; attempt < 60 && db === null; attempt += 1) {
  try {
    db = new mod.ResearchDb({ path: dbPath });
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}
if (db === null) throw new Error("probe could not open " + dbPath);
db.db.exec("PRAGMA busy_timeout = 15000");
const repo = new mod.ResearchRepository(db.db);
const artifacts = new mod.SqliteArtifactStore({ path: artPath });
const materials = new mod.MaterialIngestService(repo, new mod.EchoDataProvider(), artifacts, {
  ownerId: "probe-" + process.pid,
  leaseMs: 30000,
});
const text = readFileSync(textFile, "utf8");
const result = mode === "ingest"
  ? await materials.ingest({ subjectKind: "industry", subjectId: idOrSid, title: "concurrent", text })
  : await materials.retry(idOrSid, { acceptOrphanRisk: true });
process.stdout.write(JSON.stringify({ outcome: result.outcome }));
db.close();
await artifacts.close();
`;

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const modUrl = pathToFileURL(join(repoRoot, "packages", "research", "src", "index.ts")).href;
const probeDir = mkdtempSync(join(tmpdir(), "tiancha-r1-probe-"));
const probePath = join(probeDir, "probe.mjs");
writeFileSync(probePath, PROBE, "utf8");

function runProbe(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", probePath, ...args], { cwd: repoRoot });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("close", () => {
      const raw = out.trim().split("\n").pop() ?? "";
      try {
        resolve((JSON.parse(raw) as { outcome: string }).outcome);
      } catch {
        resolve(`PROBE_ERROR:${out.trim()}:${err.slice(0, 300)}`);
      }
    });
  });
}

describe("C-MVP-R1 · concurrency with TWO independent processes (§29.5a)", () => {
  test("T-R1-10 ①: two processes importing the SAME new material ⇒ exactly one writes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tiancha-r1-conc-"));
    const dbPath = join(dir, "tiancha.sqlite");
    const artPath = join(dir, "artifacts.sqlite");
    const textFile = join(dir, "material.md");
    writeFileSync(textFile, MATERIAL, "utf8");
    try {
      const db = new ResearchDb({ path: dbPath });
      const repo = new ResearchRepository(db.db);
      const artifacts = new SqliteArtifactStore({ path: artPath });
      const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
      const res = await discovery.ingestMaterial({ materialText: "x", industryName: "R1 并发行业" });
      const sid = res.industry.industryId;
      await artifacts.close();
      db.close();

      const [a, b] = await Promise.all([
        runProbe([modUrl, "ingest", dbPath, artPath, sid, textFile]),
        runProbe([modUrl, "ingest", dbPath, artPath, sid, textFile]),
      ]);
      const writers = [a, b].filter((o) => o === "created" || o === "resumed");
      assert.equal(writers.length, 1, `exactly ONE process writes (got ${JSON.stringify([a, b])})`);
      assert.equal(
        [a, b].filter((o) => o === "in_progress" || o === "duplicate").length,
        1,
        `the loser observes in_progress/duplicate (got ${JSON.stringify([a, b])})`,
      );

      const db2 = new ResearchDb({ path: dbPath });
      const repo2 = new ResearchRepository(db2.db);
      const materials = repo2.listMaterials(sid);
      assert.equal(materials.length, 1, "one material row");
      assert.equal(materials[0]!.ingestStatus, "completed");
      assert.equal(materials[0]!.claimRefs.length, VALID_BLOCKS, "one claim per valid block");
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("T-R1-10 ②: two processes resuming the SAME failed material ⇒ never two writers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tiancha-r1-conc2-"));
    const dbPath = join(dir, "tiancha.sqlite");
    const artPath = join(dir, "artifacts.sqlite");
    const textFile = join(dir, "material.md");
    writeFileSync(textFile, MATERIAL, "utf8");
    try {
      // Leave a genuine `failed` row behind (a store that dies on the FIRST artifact write).
      const db = new ResearchDb({ path: dbPath });
      const repo = new ResearchRepository(db.db);
      const inner = new SqliteArtifactStore({ path: artPath });
      const broken = new FlakyArtifactStore(inner, 1);
      const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), inner);
      const res = await discovery.ingestMaterial({ materialText: "x", industryName: "R1 并发行业2" });
      const sid = res.industry.industryId;
      const materials = new MaterialIngestService(repo, new EchoDataProvider(), broken, { ownerId: "seed" });
      const seeded = await materials.ingest({
        subjectKind: "industry",
        subjectId: sid,
        title: "纪要",
        text: MATERIAL,
      });
      assert.equal(seeded.outcome, "failed", "fixture: a real failed row with a reserved ledger");
      const materialId = seeded.material.materialId;
      await inner.close();
      db.close();

      const [a, b] = await Promise.all([
        runProbe([modUrl, "retry", dbPath, artPath, materialId, textFile]),
        runProbe([modUrl, "retry", dbPath, artPath, materialId, textFile]),
      ]);
      const resumed = [a, b].filter((o) => o === "resumed");
      assert.equal(resumed.length, 1, `exactly ONE resume (got ${JSON.stringify([a, b])})`);
      assert.equal(
        [a, b].filter((o) => o === "in_progress" || o === "duplicate").length,
        1,
        `the loser never resumes (got ${JSON.stringify([a, b])})`,
      );

      const db2 = new ResearchDb({ path: dbPath });
      const repo2 = new ResearchRepository(db2.db);
      const material = repo2.getMaterial(materialId)!;
      assert.equal(material.ingestStatus, "completed", "the material ends up complete");
      assert.equal(material.claimRefs.length, VALID_BLOCKS, "no duplicated claims");
      assert.equal(
        new Set(material.ingestBlocks.map((b) => b.blockIndex)).size,
        VALID_BLOCKS,
        "one ledger entry per block — no double reservation",
      );
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

after(() => {
  rmSync(probeDir, { recursive: true, force: true });
});


// ---------------------------------------------------------------------------
// T-R1-13/14/15 — the two acceptance gaps found in review: FENCING (a stale holder must never
// overwrite the new one) and the ORPHAN CLAIM SCAN a残骸 retry must run before writing anything.
// ---------------------------------------------------------------------------

import type { DatabaseSync } from "node:sqlite";

/** Simulates a SECOND process taking the lease over while the first one is still working. */
class LeaseStealingStore implements ArtifactStore {
  private calls = 0;
  constructor(
    private readonly inner: ArtifactStore,
    private readonly db: DatabaseSync,
    private readonly stealAt: number,
  ) {}
  async put(record: ArtifactRecord): Promise<ArtifactRef> {
    const ref = await this.inner.put(record);
    this.calls += 1;
    if (this.calls === this.stealAt) {
      // A new holder claims the row: owner changes AND the fencing generation moves on.
      this.db
        .prepare(
          "UPDATE material SET ingest_owner = 'thief', ingest_lease_until = ?, " +
            "ingest_generation = ingest_generation + 1",
        )
        .run(new Date(Date.now() + 60_000).toISOString());
    }
    return ref;
  }
  get(id: string) {
    return this.inner.get(id);
  }
  listByRun(id: string) {
    return this.inner.listByRun(id);
  }
  listByTask(id: string) {
    return this.inner.listByTask(id);
  }
  close() {
    return this.inner.close();
  }
}

describe("C-MVP-R1 · fencing: a stale holder can never overwrite the new one (§29.5a)", () => {
  test("T-R1-13: after a take-over, the OLD generation's write is refused", async () => {
    const t = await setup("R1 行业 fence");
    try {
      const done = await submit(t.healthy(), t.sid);
      const id = done.material.materialId;

      // Re-open the row so it can be claimed again, keeping the ledger.
      const current = t.repo.getMaterial(id)!;
      assert.equal(
        t.repo.updateMaterialProgress(
          id,
          {
            ingestStatus: "received",
            ingestStage: null,
            ingestError: null,
            ingestBlocks: current.ingestBlocks,
            claimRefs: [],
            ingestOwner: null,
            ingestLeaseUntil: null,
          },
          current.ingestGeneration,
        ),
        true,
      );

      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 60_000).toISOString();
      const now = new Date().toISOString();

      const generationA = t.repo.claimMaterialIngest(id, "A", future, "received", now);
      assert.equal(typeof generationA, "number", "A gets the lease");

      // A's lease EXPIRES (a long block), and B takes over.
      t.repo.db.prepare("UPDATE material SET ingest_lease_until = ? WHERE material_id = ?").run(past, id);
      const generationB = t.repo.claimMaterialIngest(id, "B", future, "received", now);
      assert.equal(typeof generationB, "number", "B takes over the expired lease");
      assert.notEqual(generationB, generationA, "taking over bumps the fencing generation");

      const patch = {
        ingestStatus: "projecting" as const,
        ingestStage: "projecting" as const,
        ingestError: null,
        ingestBlocks: current.ingestBlocks,
        claimRefs: [] as string[],
        ingestOwner: "A",
        ingestLeaseUntil: future,
      };
      assert.equal(
        t.repo.updateMaterialProgress(id, patch, generationA!),
        false,
        "T-R1-13: the STALE generation is REFUSED (A cannot resume writing)",
      );
      assert.equal(t.repo.getMaterial(id)!.ingestOwner, "B", "A did not overwrite B's ownership");
      assert.equal(
        t.repo.updateMaterialProgress(id, { ...patch, ingestOwner: "B" }, generationB!),
        true,
        "the CURRENT generation still writes",
      );
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });

  test("T-R1-14: losing the lease mid-run ⇒ in_progress, and NOTHING is overwritten", async () => {
    const t = await setup("R1 行业 steal");
    try {
      // Steal the lease right after the FIRST artifact write of the material pipeline.
      const stealing = new LeaseStealingStore(t.inner, t.db.db, 1);
      const service = new MaterialIngestService(t.repo, new EchoDataProvider(), stealing, {
        ownerId: "A",
        leaseMs: 30_000,
      });
      const outcome = await service.ingest({
        subjectKind: "industry",
        subjectId: t.sid,
        title: "纪要",
        text: MATERIAL,
      });

      assert.equal(
        outcome.outcome,
        "in_progress",
        "T-R1-14: the stale holder reports in_progress — never `created`",
      );
      const stored = t.repo.getMaterial(outcome.material.materialId)!;
      assert.equal(stored.ingestOwner, "thief", "A never overwrote the new holder");
      assert.notEqual(stored.ingestStatus, "completed", "A did not close the row out");
      assert.equal(stored.claimRefs.length, 0, "A's claim refs were never committed");
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });
});

describe("C-MVP-R1 · a same-content Claim is NOT an ownership proof (§29.16)", () => {
  test("T-R1-15: two materials with the same statements keep TWO independent sources", async () => {
    const t = await setup("R1 行业 overlap");
    try {
      const knowledge = new KnowledgeRepository(t.db.db);
      const a = await submit(t.healthy(), t.sid);
      assert.equal(a.outcome, "created");
      const aRefs = a.material.claimRefs.slice();
      assert.equal(aRefs.length, VALID_BLOCKS);

      // A DIFFERENT material (different text, different fingerprint) that happens to carry the
      // SAME [CLAIM] statements — a completely normal situation.
      const body = MATERIAL.split("访谈纪要正文。")[1] ?? MATERIAL;
      const b = await t.healthy().ingest({
        subjectKind: "industry",
        subjectId: t.sid,
        title: "另一份纪要",
        text: `另一份材料的正文（不同来源）。${body}`,
      });
      assert.equal(b.outcome, "created");
      assert.notEqual(b.material.materialId, a.material.materialId, "it is a SEPARATE material");

      // ★ §29.16: no id may be adopted — merging them would destroy `independentSources`.
      for (const id of b.material.claimRefs) {
        assert.ok(!aRefs.includes(id), "T-R1-15: an id from the other material was NOT adopted");
      }
      const k = knowledge.findKnowledgeBySubject("industry", t.sid)!;
      assert.equal(
        knowledge.listBeliefs(k.knowledgeId).length,
        VALID_BLOCKS * 2,
        "T-R1-15: each statement has TWO independent Claims — one per source",
      );
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });
});

// ===========================================================================
// T-R1-16/17 — §29.14 (5a): a NOT-completed material's Claims stay VISIBLE (5a accepts partial
// visibility) but are NEVER counted as confirmed evidence; they ARE counted once it completes.
// ===========================================================================

describe("C-MVP-R1 · 5a: unconfirmed material evidence is never counted as confirmed (§29.14)", () => {
  test("T-R1-16/17: excluded while unfinished, included after completion", async () => {
    const t = await setup("R1 行业 5a");
    try {
      // Let block #1 project, then fail on block #2 ⇒ a genuinely PARTIAL projection exists.
      const partial = await submit(t.broken(2), t.sid);
      assert.equal(partial.outcome, "failed");
      const projected = partial.material.ingestBlocks
        .filter((b) => b.state === "projected")
        .map((b) => b.claimId);
      assert.ok(projected.length > 0, "fixture: at least one Claim reached the projection");

      // 5a: the partial evidence IS visible downstream (beliefs exist) …
      const knowledge = new KnowledgeRepository(t.db.db);
      const k = knowledge.findKnowledgeBySubject("industry", t.sid)!;
      const beliefRefs = new Set(knowledge.listBeliefs(k.knowledgeId).map((b) => b.claimRef));
      assert.ok(
        projected.some((id) => beliefRefs.has(`artifact:claim/${id}`)),
        "5a: partial visibility is accepted — the Claim really did reach Knowledge",
      );

      // … but no SUMMARY may present it as confirmed evidence.
      const report = new ReportService(t.db.db).generateReport("industry", t.sid);
      for (const id of projected) {
        assert.ok(
          !report.sections.recentEvidence.includes(`artifact:claim/${id}`),
          `T-R1-16: ${id} must NOT be listed as recent (confirmed) evidence`,
        );
      }
      const evaluation = new EvaluationService(t.db.db).evaluate("industry", t.sid);
      for (const dim of evaluation.dimensionEvaluations) {
        for (const id of projected) {
          assert.ok(
            !dim.evidenceRefs.includes(`artifact:claim/${id}`),
            `T-R1-16: ${id} must NOT be among the confirmed evidence refs of ${dim.dimension}`,
          );
        }
      }
      // The split is strictly ADDITIVE: the two buckets never overlap, so nothing that WAS in
      // `evidenceRefs` is lost. (If the projected view never referenced a Claim — e.g. it never
      // reached a Pool item — both buckets simply omit it: the contract forbids COUNTING it as
      // confirmed evidence, it does not require it to be surfaced everywhere.)
      assert.ok(
        evaluation.dimensionEvaluations.every((d) =>
          (d.unconfirmedEvidenceRefs ?? []).every((ref) => !d.evidenceRefs.includes(ref)),
        ),
        "T-R1-16: confirmed and unconfirmed evidence never overlap",
      );

      // ---- T-R1-17: completing the material confirms every Claim again
      const finished = await submit(t.healthy(), t.sid);
      assert.equal(finished.outcome, "resumed");
      assert.equal(finished.material.ingestStatus, "completed");
      const after = new ReportService(t.db.db).generateReport("industry", t.sid);
      const counted = finished.material.claimRefs.filter((id) =>
        after.sections.recentEvidence.includes(`artifact:claim/${id}`),
      );
      assert.equal(
        counted.length,
        finished.material.claimRefs.length,
        "T-R1-17: once COMPLETED, every Claim of the material counts as evidence again",
      );
      const afterEval = new EvaluationService(t.db.db).evaluate("industry", t.sid);
      assert.equal(
        afterEval.dimensionEvaluations.flatMap((d) => d.unconfirmedEvidenceRefs ?? []).length,
        0,
        "T-R1-17: nothing is left unconfirmed",
      );
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });
});

import { ReportService } from "./application/report-service.js";
import { EvaluationService } from "./application/evaluation-service.js";

// ===========================================================================
// T-R1-18 … T-R1-21 — §29.15 (review round 2):
//   18  the "projected but not yet ledgered" window must NOT look like confirmed evidence
//   19  an unattributable残骸 forces the conservative downgrade
//   20  an artifact-only残骸 Claim (never projected) is still discovered and reused
//   21  an AMBIGUOUS orphan set fails explicitly — sources are never merged by guessing
// ===========================================================================

/** Writes a Claim artifact exactly the way the pre-R1 field-research pipe did. */
async function putOrphanClaim(
  store: ArtifactStore,
  subjectId: string,
  claimId: string,
  statement: string,
): Promise<void> {
  await store.put({
    artifact: {
      artifactId: claimId,
      kind: "claim",
      schemaVersion: "2",
      ref: { artifactId: claimId, kind: "claim", locator: { type: "sqlite", id: claimId } },
      createdAt: new Date().toISOString(),
      taskId: "field-research-ingest",
      attemptId: "ingest-claims",
      runId: "backfill-orphan",
    },
    blob: {
      claimId,
      statement,
      claimType: "descriptive",
      provenance: "user",
      conflictOfInterest: false,
      factIds: [],
      evidenceIds: [],
      subjectKind: "industry",
      subjectId,
      temporalRelation: "current",
      isRealExternalData: true,
    },
  });
}

describe("C-MVP-R1 · 5a crash window and conservative downgrade (§29.15)", () => {
  test("T-R1-18: projected-but-not-yet-ledgered Claims are NOT confirmed evidence", async () => {
    const t = await setup("R1 行业 window");
    try {
      const done = await submit(t.healthy(), t.sid);
      const claimIds = done.material.claimRefs.slice();
      assert.equal(claimIds.length, VALID_BLOCKS);

      // Reproduce the crash window: the projections DID happen, the ledger callback did not run.
      t.db.db
        .prepare(
          `UPDATE material
              SET ingest_status = 'projecting', ingest_stage = 'projecting',
                  claim_refs_json = '[]', ingest_blocks_json = ?
            WHERE material_id = ?`,
        )
        .run(
          JSON.stringify(done.material.ingestBlocks.map((b) => ({ ...b, state: "artifact_written" }))),
          done.material.materialId,
        );
      assert.deepEqual(t.repo.getMaterial(done.material.materialId)!.claimRefs, [], "fixture: refs are empty");

      const report = new ReportService(t.db.db).generateReport("industry", t.sid);
      for (const id of claimIds) {
        assert.ok(
          !report.sections.recentEvidence.includes(`artifact:claim/${id}`),
          `T-R1-18: ${id} must not be counted as confirmed evidence during the window`,
        );
      }
      const evaluation = new EvaluationService(t.db.db).evaluate("industry", t.sid);
      for (const dim of evaluation.dimensionEvaluations) {
        for (const id of claimIds) {
          assert.ok(
            !dim.evidenceRefs.includes(`artifact:claim/${id}`),
            `T-R1-18: ${id} must not be among the confirmed evidence refs`,
          );
        }
      }
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });

  test("T-R1-19: with an unattributable残骸 present, unattributable Claims are withheld", async () => {
    const t = await setup("R1 行业 residual");
    try {
      const done = await submit(t.healthy(), t.sid);
      const claimIds = done.material.claimRefs.slice();
      const confirmedBefore = new ReportService(t.db.db).generateReport("industry", t.sid);
      assert.ok(
        claimIds.every((id) => confirmedBefore.sections.recentEvidence.includes(`artifact:claim/${id}`)),
        "fixture: while COMPLETED they are confirmed evidence",
      );

      // The migration's残骸 shape: no ledger, no refs ⇒ its Claims become UNATTRIBUTABLE.
      t.db.db
        .prepare(
          `UPDATE material SET ingest_status = 'legacy_failed', ingest_stage = 'parsed',
                  ingest_error = 'LEGACY_PARTIAL_IMPORT', ingest_blocks_json = '[]',
                  claim_refs_json = '[]', ingest_generation = 0, ingest_owner = NULL,
                  ingest_lease_until = NULL
            WHERE material_id = ?`,
        )
        .run(done.material.materialId);

      const report = new ReportService(t.db.db).generateReport("industry", t.sid);
      for (const id of claimIds) {
        assert.ok(
          !report.sections.recentEvidence.includes(`artifact:claim/${id}`),
          `T-R1-19: ${id} is not attributable while the残骸 is unresolved — it must NOT be confirmed`,
        );
      }
      const evaluation = new EvaluationService(t.db.db).evaluate("industry", t.sid);
      const confirmedRefs = evaluation.dimensionEvaluations.flatMap((d) => d.evidenceRefs);
      for (const id of claimIds) {
        assert.ok(!confirmedRefs.includes(`artifact:claim/${id}`), `T-R1-19: ${id} withheld`);
      }
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });
});

describe("C-MVP-R1 · orphan scan reach and ambiguity (§29.15)", () => {
  test("T-R1-20: an artifact-only Claim (never projected) IS discovered and reused", async () => {
    const t = await setup("R1 行业 orphan2");
    try {
      const knowledge = new KnowledgeRepository(t.db.db);
      const claims = parseClaims(MATERIAL).claims;
      const written: string[] = [];
      for (let i = 0; i < claims.length; i += 1) {
        const claimId = `claim-orphan-${i}`;
        await putOrphanClaim(t.inner, t.sid, claimId, claims[i]!.statement);
        written.push(claimId);
      }
      assert.equal(
        knowledge.findKnowledgeBySubject("industry", t.sid)?.beliefs.length ?? 0,
        0,
        "fixture: nothing was ever projected — there is not a single belief",
      );

      const materials = new MaterialIngestService(t.repo, new EchoDataProvider(), t.inner, {
        ownerId: "orphan-scan-2",
        knowledge,
      });
      const result = await materials.ingest({
        subjectKind: "industry",
        subjectId: t.sid,
        title: "纪要",
        text: MATERIAL,
      });
      assert.equal(result.outcome, "created");
      assert.ok(
        result.material.ingestBlocks.every((b) => !written.includes(b.claimId)),
        "T-R1-20: a同文 candidate is NOT proof of ownership — no id was adopted",
      );
      assert.equal(
        (await t.inner.listByRun("backfill-orphan")).length,
        VALID_BLOCKS,
        "the pre-existing artifacts are left untouched",
      );
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });

  test("T-R1-21: TWO Claims with the same content are AMBIGUOUS — retry fails, never merges", async () => {
    const t = await setup("R1 行业 ambiguous");
    try {
      const knowledge = new KnowledgeRepository(t.db.db);
      const claims = parseClaims(MATERIAL).claims;
      // Two independent sources that happen to say the same thing ⇒ two Claim ids per statement.
      for (let i = 0; i < claims.length; i += 1) {
        await putOrphanClaim(t.inner, t.sid, `claim-amb-${i}-a`, claims[i]!.statement);
        await putOrphanClaim(t.inner, t.sid, `claim-amb-${i}-b`, claims[i]!.statement);
      }

      const materials = new MaterialIngestService(t.repo, new EchoDataProvider(), t.inner, {
        ownerId: "orphan-scan-3",
        knowledge,
      });
      const result = await materials.ingest({
        subjectKind: "industry",
        subjectId: t.sid,
        title: "纪要",
        text: MATERIAL,
      });
      assert.equal(result.outcome, "failed", "T-R1-21: ambiguity is a HUMAN decision");
      assert.match(
        result.outcome === "failed" ? result.error : "",
        /ORPHAN_CLAIM_AMBIGUOUS/,
        "T-R1-21: the reason is explicit — no silent merge of two sources",
      );
      // …and nothing was written on the way out.
      assert.equal(
        (knowledge.findKnowledgeBySubject("industry", t.sid)?.beliefs.length ?? 0),
        0,
        "T-R1-21: no projection happened",
      );

      // ★ §29.16: the ambiguity must STAY identifiable as a残骸 …
      const stored = t.repo.getMaterial(result.material.materialId)!;
      assert.equal(
        stored.ingestStatus,
        "legacy_failed",
        "T-R1-21: an ambiguous overlap leaves a残骸 a human has to resolve",
      );
      assert.equal(stored.ingestStage, "migration");
      assert.match(stored.ingestError ?? "", /ORPHAN_CLAIM_AMBIGUOUS/);

      // … so this subject's pre-existing Claims are NOT confirmed evidence any more.
      // Simulate the old pipe having projected one of them: a Claim WITH a belief that belongs to
      // no completed material.
      const discovery = new OpportunityDiscoveryService(t.repo, new EchoDataProvider(), t.inner);
      await discovery.ingestClaims({
        subjectKind: "industry",
        subjectId: t.sid,
        claims: [{ statement: claims[0]!.statement, dimension: "market" }],
      });
      const legacyRefs = (await t.inner.listByTask("field-research-ingest")).map(
        (a) => `artifact:claim/${a.artifactId}`,
      );
      const report = new ReportService(t.db.db).generateReport("industry", t.sid);
      for (const ref of legacyRefs) {
        assert.ok(
          !report.sections.recentEvidence.includes(ref),
          `T-R1-21: ${ref} must NOT be counted as confirmed while the ambiguity is unresolved`,
        );
      }
      const afterEval = new EvaluationService(t.db.db).evaluate("industry", t.sid);
      const confirmedRefs = afterEval.dimensionEvaluations.flatMap((d) => d.evidenceRefs);
      for (const ref of legacyRefs) {
        assert.ok(!confirmedRefs.includes(ref), `T-R1-21: ${ref} withheld from the confirmed refs`);
      }
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });
});

  test("T-R1-22: a残骸 retry does NOT adopt a same-content Claim it cannot attribute", async () => {
    const t = await setup("R1 行业 orphan3");
    try {
      const knowledge = new KnowledgeRepository(t.db.db);
      const claims = parseClaims(MATERIAL).claims;
      // a pre-R1 artifact-only Claim for this subject …
      await putOrphanClaim(t.inner, t.sid, "claim-legacy-0", claims[0]!.statement);
      // … and a残骸 row with NO ledger and NO refs (exactly the migration shape).
      t.db.db
        .prepare(
          `INSERT INTO material (material_id, subject_kind, subject_id, kind, title, content_hash,
              raw_text, claim_refs_json, received_at, created_at, ingest_status, ingest_stage,
              ingest_error, parser_version, ingest_blocks_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          "mat-legacy-orphan", "industry", t.sid, "text", "legacy", "hash-legacy", MATERIAL,
          "[]", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
          "legacy_failed", "parsed", "LEGACY_PARTIAL_IMPORT", "material-parser/v1", "[]",
        );

      const materials = new MaterialIngestService(t.repo, new EchoDataProvider(), t.inner, {
        ownerId: "orphan-scan-4",
        knowledge,
      });
      const result = await materials.retry("mat-legacy-orphan", { acceptOrphanRisk: true });
      assert.equal(result.outcome, "resumed", "one unambiguous candidate is NOT an error …");
      assert.ok(
        result.material.ingestBlocks.every((b) => b.claimId !== "claim-legacy-0"),
        "T-R1-22: …but it is also NOT an ownership proof — the id was NOT adopted",
      );
      const after = await t.inner.listByTask("field-research-ingest");
      assert.ok(
        after.some((a) => a.artifactId === "claim-legacy-0"),
        "the pre-existing artifact still exists (it was not rewritten)",
      );
      assert.equal(
        after.length,
        VALID_BLOCKS + 1,
        "the残骸's own Claims were written IN ADDITION to the un-attributable one",
      );
    } finally {
      await t.inner.close();
      t.db.close();
    }
  });

import { parseClaims } from "./domain/material-parser.js";
