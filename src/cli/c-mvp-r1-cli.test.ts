/**
 * C-MVP-R1 (§29.4 / §29.6.1 / D-R1-5 5a) — the CLI surface.
 *
 * The five outcomes must be DISTINGUISHABLE, and a material that is not finished must never be
 * rendered as if it were. Everything here runs the REAL handlers through the composition seam.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ResearchDb,
  ResearchRepository,
  SqliteArtifactStore,
  EchoDataProvider,
  OpportunityDiscoveryService,
  EvaluationService,
  PriorityService,
  ReportService,
  MaterialIngestService,
  TargetService,
  ChainProjectionService,
  ResearchNeedService,
  QuestionTargetFitService,
  DiligencePreparationService,
} from "@tiancha/research";
import {
  runMaterialAdd,
  runMaterialList,
  runMaterialRetry,
  type ResearchCliDeps,
} from "./research-commands.js";
import { formatMaterialAddHuman, type MaterialAddView } from "./research-format.js";

const INDUSTRY = "R1 CLI 行业";
const MATERIAL = `纪要正文。

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
`;

function makeDeps(
  db: ResearchDb,
  repo: ResearchRepository,
  artifacts: SqliteArtifactStore,
  lines: string[],
  reportDir: string,
): ResearchCliDeps {
  return {
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
    materialMigration: db.materialMigrationSummary,
    reportDir,
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR:${l}`),
  };
}

async function bootstrap(dbPath: string) {
  const db = new ResearchDb({ path: dbPath });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  await artifacts.close();
  db.close();
  return res.industry.industryId;
}

describe("C-MVP-R1 CLI", () => {
  test("created then duplicate are DISTINCT (never a boolean)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tiancha-r1-cli-"));
    const dbPath = join(dir, "tiancha.sqlite");
    try {
      const sid = await bootstrap(dbPath);
      const file = join(dir, "expert.md");
      writeFileSync(file, MATERIAL, "utf8");

      const db = new ResearchDb({ path: dbPath });
      const repo = new ResearchRepository(db.db);
      const artifacts = new SqliteArtifactStore({ path: ":memory:" });
      const lines: string[] = [];
      const deps = makeDeps(db, repo, artifacts, lines, join(dir, "reports"));
      try {
        assert.equal(await runMaterialAdd(INDUSTRY, file, { json: false }, deps), 0);
        const first = lines.join("\n");
        assert.match(first, /材料入库完成/);
        assert.match(first, /解析出 2 条 claim/);
        assert.ok(!/材料未完成/.test(first), "a complete import says nothing about being unfinished");
        assert.equal(repo.listMaterials(sid)[0]!.ingestStatus, "completed");

        lines.length = 0;
        assert.equal(await runMaterialAdd(INDUSTRY, file, { json: false }, deps), 0);
        const second = lines.join("\n");
        assert.match(second, /相同材料已完整入库/, "the duplicate wording is its own outcome");
        assert.ok(!/材料入库完成/.test(second), "…and it is NOT reported as a fresh import");

        // --json carries the outcome kind, not a boolean
        lines.length = 0;
        assert.equal(await runMaterialAdd(INDUSTRY, file, { json: true }, deps), 0);
        const view = JSON.parse(lines.join("\n"));
        assert.equal(view.outcome, "duplicate");
        assert.equal(view.ingestStatus, "completed");
        assert.equal(view.projectedBlocks, 2);
        assert.equal(view.totalBlocks, 2);
      } finally {
        await artifacts.close();
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("D-R1-5 (5a): the formatter states REAL progress, never a bare 'done'", () => {
    const base: Omit<MaterialAddView, "outcome"> = {
      industry: "X",
      title: "纪要",
      materialId: "mat-x",
      ingestStatus: "failed",
      stage: "projecting",
      error: "injected boom",
      parsedClaims: 3,
      projectedBlocks: 1,
      totalBlocks: 3,
      parseErrors: [],
      before: { openGaps: 0, priorities: 0, slotStatuses: {} },
      after: { openGaps: 0, priorities: 0, slotStatuses: {} },
    };
    const failed = formatMaterialAddHuman({ ...base, outcome: "failed" });
    assert.match(failed, /材料导入未完成/);
    assert.match(failed, /已投影 1\/3 块/, "the K/N progress is stated");
    assert.match(failed, /停在 projecting/);
    assert.match(failed, /injected boom/);
    assert.match(failed, /tiancha research material retry mat-x/, "the repair path is named");

    const running = formatMaterialAddHuman({ ...base, outcome: "in_progress", stage: undefined });
    assert.match(running, /材料正在被另一个进程导入/);
    assert.match(running, /已投影 1\/3 块/, "an in-flight import is ALSO reported unfinished");

    const done = formatMaterialAddHuman({ ...base, outcome: "created", stage: undefined, error: undefined });
    assert.match(done, /材料入库完成/);
    assert.ok(!/材料未完成/.test(done), "a finished import never carries the unfinished warning");
  });

  test("a legacy残骸 is listed, reported unfinishED, and never silently resumed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tiancha-r1-cli2-"));
    const dbPath = join(dir, "tiancha.sqlite");
    const hashOf = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
    try {
      const sid = await bootstrap(dbPath);
      // A historical (C-MVP era) row: valid block, no claim refs, parser_version IS NULL.
      const legacy = `[CLAIM]\ndimension: market\ncontent: 历史残骸\n[/CLAIM]\n`;
      const seed = new ResearchDb({ path: dbPath });
      seed.db
        .prepare(
          `INSERT INTO material
             (material_id, subject_kind, subject_id, kind, title, content_hash, raw_text,
              claim_refs_json, received_at, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run("mat-legacy-cli", "industry", sid, "text", "legacy", hashOf(legacy), legacy, "[]", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      seed.close();

      // Reopen: the one-shot triage runs, and the CLI must PRINT it.
      const db = new ResearchDb({ path: dbPath });
      const repo = new ResearchRepository(db.db);
      const artifacts = new SqliteArtifactStore({ path: ":memory:" });
      const lines: string[] = [];
      const deps = makeDeps(db, repo, artifacts, lines, join(dir, "reports"));
      try {
        assert.equal(repo.getMaterial("mat-legacy-cli")!.ingestStatus, "legacy_failed");

        lines.length = 0;
        assert.equal(await runMaterialList(INDUSTRY, { json: false }, deps), 0);
        const listed = lines.join("\n");
        assert.match(listed, /legacy_failed/);
        assert.match(listed, /legacy_failed\(需人工复核\) 1/, "the migration summary is printed, never silent");

        // A plain submission of the SAME text must NOT continue the残骸 …
        const file = join(dir, "legacy.md");
        writeFileSync(file, legacy, "utf8");
        lines.length = 0;
        assert.equal(await runMaterialAdd(INDUSTRY, file, { json: false }, deps), 0);
        const add = lines.join("\n");
        assert.match(add, /材料导入未完成/);
        assert.match(add, /⚠ 材料未完成：/, "D-R1-5: an unfinished material says so");
        assert.match(add, /无块级进度记录/, "…and it explains that a pre-R1残骸 has no ledger");
        assert.match(add, /tiancha research material retry mat-legacy-cli/, "…and the repair path is named");
        assert.equal(repo.getMaterial("mat-legacy-cli")!.ingestStatus, "legacy_failed", "left untouched");

        // …and the explicit retry refuses without --accept-orphans.
        lines.length = 0;
        assert.equal(
          await runMaterialRetry("mat-legacy-cli", { json: false, force: false, acceptOrphanRisk: false }, deps),
          0,
        );
        assert.match(lines.join("\n"), /材料导入未完成/);
        assert.equal(repo.getMaterial("mat-legacy-cli")!.ingestStatus, "legacy_failed");

        // usage / unknown id
        lines.length = 0;
        assert.equal(await runMaterialRetry(undefined, { json: false, force: false, acceptOrphanRisk: false }, deps), 1);
        assert.ok(lines.some((l) => l.startsWith("ERR:usage:")));
        assert.equal(
          await runMaterialRetry("mat-nope", { json: false, force: false, acceptOrphanRisk: false }, deps),
          1,
        );
      } finally {
        await artifacts.close();
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
