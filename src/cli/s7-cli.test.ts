/**
 * T-A12-8 / T-A12-9: CLI **route + composition** tests.
 *
 * The handlers are dependency-injected (temp report dir + in-memory db), so this runs the
 * REAL command logic without touching `~/.tiancha`. It pins the R3 write boundary:
 * only `evaluate` writes an InvestmentEvaluation; `report` appends a projection + Markdown.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
} from "@tiancha/research";
import { parseResearchArgs, runResearchCommand, type ResearchCliDeps } from "./research-commands.js";

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: "S7 行业" });
  const sid = res.industry.industryId;
  await svc.ingestClaims({
    subjectKind: "industry",
    subjectId: sid,
    claims: [{ statement: "market a", dimension: "market", sourceRef: "s1" }],
  });
  const reportDir = mkdtempSync(join(tmpdir(), "tiancha-s7-"));
  const lines: string[] = [];
  const deps: ResearchCliDeps = {
    repo,
    evaluation: new EvaluationService(db.db),
    priority: new PriorityService(db.db),
    reports: new ReportService(db.db),
    materials: new MaterialIngestService(repo, new EchoDataProvider(), artifacts),
    reportDir,
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR:${l}`),
  };
  return { db, repo, sid, deps, reportDir, lines };
}

const count = (db: ResearchDb, table: string) =>
  (db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n;

describe("S7 CLI route + composition", () => {
  test("parseResearchArgs: positional name + --json format switch", () => {
    assert.deepEqual(parseResearchArgs(["AI", "--json"]), { name: "AI", options: { json: true } });
    assert.deepEqual(parseResearchArgs(["--json"]), { name: undefined, options: { json: true } });
    assert.deepEqual(parseResearchArgs(["AI"]), { name: "AI", options: { json: false } });
  });

  test("T-A12-8: only `evaluate` appends an InvestmentEvaluation; the rest never do", async () => {
    const { db, deps, reportDir } = await setupCli();
    try {
      assert.equal(count(db, "investment_evaluation"), 0);
      assert.equal(await runResearchCommand("evaluate", ["S7 行业"], deps), 0);
      assert.equal(count(db, "investment_evaluation"), 1, "CLI evaluate writes one");
      await runResearchCommand("pool", ["S7 行业"], deps);
      await runResearchCommand("priority", ["S7 行业"], deps);
      assert.equal(count(db, "investment_evaluation"), 1, "read-only commands write nothing");
    } finally {
      rmSync(reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("T-A12-9: `report` appends a snapshot and materialises Markdown 1:1 with its id", async () => {
    const { db, deps, reportDir } = await setupCli();
    try {
      assert.equal(count(db, "report_snapshot"), 0);
      assert.equal(await runResearchCommand("report", ["S7 行业"], deps), 0);
      assert.equal(count(db, "report_snapshot"), 1, "one projection appended");

      const files = readdirSync(reportDir);
      assert.equal(files.length, 1);
      const row = db.db.prepare("SELECT report_id FROM report_snapshot").get() as any;
      assert.equal(files[0], `S7_行业__${row.report_id}.md`, "file name carries the SNAPSHOT id");

      const md = readFileSync(join(reportDir, files[0]), "utf8");
      assert.match(md, /# 行业研究报告/);
      assert.match(md, /只读投影/);
    } finally {
      rmSync(reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("`--json` renders the SAME service result (format switch, not a second code path)", async () => {
    const { db, deps, reportDir, sid } = await setupCli();
    try {
      const jsonLines: string[] = [];
      const jsonDeps: ResearchCliDeps = { ...deps, out: (l) => jsonLines.push(l) };
      assert.equal(await runResearchCommand("priority", ["S7 行业", "--json"], jsonDeps), 0);

      const parsed = JSON.parse(jsonLines.join("\n"));
      const direct = new PriorityService(db.db).currentPriorities(sid);
      assert.deepEqual(parsed, direct, "--json is the raw service result");
    } finally {
      rmSync(reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("missing industry name -> usage error + exit code 1", async () => {
    const { db, deps, reportDir, lines } = await setupCli();
    try {
      assert.equal(await runResearchCommand("pool", [], deps), 1);
      assert.ok(lines.some((l) => l.startsWith("ERR:usage:")), "prints usage");
    } finally {
      rmSync(reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("unknown industry -> not-found, exit code 1, nothing written", async () => {
    const { db, deps, reportDir } = await setupCli();
    try {
      assert.equal(await runResearchCommand("report", ["不存在行业XYZ"], deps), 1);
      assert.equal(count(db, "report_snapshot"), 0);
    } finally {
      rmSync(reportDir, { recursive: true, force: true });
      db.close();
    }
  });
});
