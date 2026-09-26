/**
 * Phase C · Step C4-B — CLI report-snapshot history (READ-ONLY).
 *
 * Contract: `docs/phaseC/c4-implementation-contract.md`（C4 Contract Final Gate PASS, rev2）
 *   §3.3  snapshot 历史（独立只读 CLI 出口，不递归进 sections）
 *   §7   红线 18：Snapshot History CLI 不得触发 Report 生成
 *   §8.4 T-C4-16（只读 + 未调用 build）× T-C4-17（flag 白名单守卫）
 *   §9   I-C4-13；§10 三层证据
 *
 *   T-C4-16  history 前后 **24 表 fingerprint 完全一致**；输出 == `listProjections()` 的元数据投影；
 *            未新增 snapshot（⇒ 未调用 build/generate*）；静态断言 handler 段不含 build/generate*
 *   T-C4-17  只允许 `--json`；任何其它 `--xxx`（含 4 个命令型 flag，以及 parser 会静默吞掉的
 *            `--force` / `--unknown`）都必须 usage error 且**不产生新 snapshot**
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ResearchDb,
  ResearchRepository,
  SqliteArtifactStore,
  EchoDataProvider,
  OpportunityDiscoveryService,
  EvaluationService,
  PriorityService,
  ReportService,
  ReportRepository,
  MaterialIngestService,
  TargetService,
  ChainProjectionService,
  ResearchNeedService,
  QuestionTargetFitService,
  DiligencePreparationService,
  ResearchPlanService,
  projectionId,
} from "@tiancha/research";
import { runResearchCommand, type ResearchCliDeps } from "./research-commands.js";

const INDUSTRY = "C4-B CLI 行业";

const TABLES = [
  "industry",
  "company",
  "research_question",
  "information_requirement",
  "research_gap",
  "information_pool_entry",
  "information_pool_slot",
  "information_pool_item",
  "research_state",
  "research_source",
  "research_document",
  "next_action",
  "methodology",
  "methodology_candidate",
  "human_gate",
  "industry_knowledge",
  "knowledge_belief",
  "knowledge_conflict",
  "investment_evaluation",
  "report_snapshot",
  "material",
  "research_position",
  "research_target",
  "diligence_preparation",
] as const;

/** Full 24-table fingerprint — the SAME idea used by C4-A's Layer-3 proof. */
const dbFingerprint = (db: ResearchDb) =>
  JSON.stringify(TABLES.map((t) => [t, db.db.prepare(`SELECT * FROM ${t}`).all()]));

const snapshotCount = (db: ResearchDb) =>
  (db.db.prepare("SELECT COUNT(*) AS n FROM report_snapshot").get() as { n: number }).n;

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;

  const dir = mkdtempSync(join(tmpdir(), "tiancha-c4b-"));
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
    plans: new ResearchPlanService(db.db),
    reportDir: dir,
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR:${l}`),
  };
  return { db, repo, sid, dir, lines, deps };
}

/** The metadata projection the CLI is supposed to emit (contract §3.3). */
const expectedMetadata = (db: ResearchDb, sid: string) =>
  new ReportRepository(db.db)
    .listProjections(sid)
    .filter((p) => p.subjectKind === "industry")
    .map((p) => ({
      projectionRef: projectionId(p),
      reportKind: p.reportKind,
      generatedAt: p.generatedAt,
      methodologyVersionId: p.methodologyVersionId,
      knowledgeVersion: p.reportKind === "dossier" ? p.knowledgeVersion : null,
    }));

describe("Phase C4-B · CLI report-history (read-only snapshot history)", () => {
  test("T-C4-16: READ-ONLY — 24-table fingerprint identical, output == listProjections() metadata", async () => {
    const { db, sid, dir, lines, deps } = await setupCli();
    try {
      // ① no history yet: "暂无", and NOTHING changed
      const before0 = dbFingerprint(db);
      lines.length = 0;
      assert.equal(await runResearchCommand("report-history", [INDUSTRY], deps), 0);
      assert.match(lines.join("\n"), /研究报告历史（.*）：暂无/);
      assert.match(lines.join("\n"), /tiancha research report/);
      assert.equal(dbFingerprint(db), before0, "T-C4-16: an empty history query writes nothing");

      // ② plant TWO persisted dossiers (via the real ReportService — that is the ONLY writer)
      const reports = new ReportService(db.db);
      reports.generateDossier(sid);
      reports.generateDossier(sid);
      assert.equal(snapshotCount(db), 2, "fixture: two persisted snapshots");

      // ③ the history query must be pure: same 24 tables before/after, no new snapshot
      const before = dbFingerprint(db);
      const beforeCount = snapshotCount(db);
      lines.length = 0;
      assert.equal(await runResearchCommand("report-history", [INDUSTRY, "--json"], deps), 0);
      const parsed = JSON.parse(lines.join("\n"));
      assert.equal(dbFingerprint(db), before, "T-C4-16: the DB is BYTE-identical after the query");
      assert.equal(snapshotCount(db), beforeCount, "T-C4-16: no snapshot was appended");

      // …and the payload is exactly the persisted metadata projection (newest first)
      assert.deepEqual(parsed, expectedMetadata(db, sid), "T-C4-16: output == listProjections() metadata");
      assert.equal(parsed.length, 2);
      assert.deepEqual(
        Object.keys(parsed[0]).sort(),
        ["generatedAt", "knowledgeVersion", "methodologyVersionId", "projectionRef", "reportKind"],
        "T-C4-16: metadata only — `sections` are never re-expanded",
      );
      assert.equal("sections" in parsed[0], false, "T-C4-16: no recursive sections in history");
      assert.equal(parsed[0].reportKind, "dossier");
      assert.equal(typeof parsed[0].knowledgeVersion, "number", "dossier carries its persisted knowledge version");

      // ④ the human formatter renders the same rows (same source, only a formatter differs)
      lines.length = 0;
      assert.equal(await runResearchCommand("report-history", [INDUSTRY], deps), 0);
      const human = lines.join("\n");
      assert.match(human, /研究报告历史（C4-B CLI 行业，共 2，最新在前）/);
      for (const row of parsed) assert.ok(human.includes(row.projectionRef), `human shows ${row.projectionRef}`);
      assert.equal(dbFingerprint(db), before, "T-C4-16: the human path is read-only too");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  test("T-C4-16b: the handler never calls build / generateReport / generateDossier (static)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./research-commands.ts", import.meta.url)),
      "utf8",
    );
    const start = src.indexOf("export async function runReportHistory");
    assert.ok(start > 0, "runReportHistory exists");
    // slice up to the NEXT top-level export — a stable, unambiguous function boundary
    const nextExport = src.indexOf("\nexport ", start + 1);
    const body = src.slice(start, nextExport > 0 ? nextExport : src.length);
    for (const banned of ["new ReportService(", "generateReport(", "generateDossier(", ".build("]) {
      assert.ok(!body.includes(banned), `T-C4-16b: runReportHistory must not reference ${banned}`);
    }
    // …and it really reads the persisted rows instead
    assert.ok(body.includes("listProjections("), "T-C4-16b: it consumes persisted snapshots");
    assert.ok(body.includes("ReportRepository"), "T-C4-16b: via the report repository");
  });

  test("T-C4-17: strict WHITELIST — only `--json` is accepted, every other --xxx is a usage error", async () => {
    const { db, sid, dir, lines, deps } = await setupCli();
    try {
      new ReportService(db.db).generateDossier(sid);
      const before = dbFingerprint(db);
      const beforeCount = snapshotCount(db);

      for (const flag of [
        "--rebuild",
        "--refresh",
        "--regenerate",
        "--compare-and-update",
        "--force",
        "--unknown",
      ]) {
        lines.length = 0;
        assert.equal(
          await runResearchCommand("report-history", [INDUSTRY, flag], deps),
          1,
          `T-C4-17: ${flag} must be rejected`,
        );
        assert.ok(
          lines.some((l) => l.startsWith("ERR:") && l.includes("usage: tiancha research report-history")),
          `T-C4-17: ${flag} ⇒ usage error`,
        );
        assert.equal(snapshotCount(db), beforeCount, `T-C4-17: ${flag} appended no snapshot`);
      }
      assert.equal(dbFingerprint(db), before, "T-C4-17: rejected flags changed NOTHING");

      // the one allowed flag still works
      lines.length = 0;
      assert.equal(await runResearchCommand("report-history", [INDUSTRY, "--json"], deps), 0);
      assert.ok(Array.isArray(JSON.parse(lines.join("\n"))), "T-C4-17: --json is accepted");
      assert.equal(dbFingerprint(db), before, "…and stays read-only");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  test("T-C4-17b / boundary: unknown industry errors with zero writes; non-industry snapshots are filtered out", async () => {
    const { db, sid, dir, lines, deps } = await setupCli();
    try {
      // a snapshot whose subjectKind is NOT industry, sharing the same subject id
      new ReportService(db.db).generateReport("company", sid);
      new ReportService(db.db).generateDossier(sid);
      const before = dbFingerprint(db);

      lines.length = 0;
      assert.equal(await runResearchCommand("report-history", [INDUSTRY, "--json"], deps), 0);
      const parsed = JSON.parse(lines.join("\n"));
      assert.equal(parsed.length, 1, "boundary: only the industry snapshot is listed");
      assert.equal(parsed[0].reportKind, "dossier");

      // unknown industry ⇒ loud failure, zero writes
      lines.length = 0;
      assert.equal(await runResearchCommand("report-history", ["不存在的行业ZZZ"], deps), 1);
      assert.ok(lines.some((l) => l.startsWith("ERR:")), "unknown industry fails loudly");
      assert.equal(dbFingerprint(db), before, "boundary: unknown industry writes nothing");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
