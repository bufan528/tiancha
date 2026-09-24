/**
 * T-B11 — the `research target add` CLI command, exercised through the composition seam
 * (in-memory db), so it runs the REAL handler. The Agent has NO target-write tool
 * (asserted in src/agent/s7-exposure.test.ts).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
} from "@tiancha/research";
import { runTargetAdd, runTargetList, parseFlags, type ResearchCliDeps } from "./research-commands.js";

const INDUSTRY = "B2 CLI 行业";

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  const positionRef = new ChainProjectionService(db.db).project(sid).positions[0]!.positionRef;

  const dir = mkdtempSync(join(tmpdir(), "tiancha-b2-"));
  const lines: string[] = [];
  const deps: ResearchCliDeps = {
    repo,
    evaluation: new EvaluationService(db.db),
    priority: new PriorityService(db.db),
    reports: new ReportService(db.db),
    materials: new MaterialIngestService(repo, new EchoDataProvider(), artifacts),
    targets: new TargetService(db.db),
    reportDir: dir,
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR:${l}`),
  };
  return { db, repo, sid, positionRef, dir, lines, deps };
}

/** Valid args for INDUSTRY; `extra` may override flags (e.g. a different --name). */
function addArgs(positionRef: string, extra: string[] = []): string[] {
  return [
    INDUSTRY,
    "--kind",
    "头部客户",
    "--name",
    "XX科技",
    "--position",
    positionRef,
    "--purpose",
    "验证采购意愿",
    "--reason",
    "行业头部采购方",
    ...extra,
  ];
}

describe("B2 CLI (research target)", () => {
  test("parseFlags splits positionals from repeated flags", () => {
    const { positional, flags } = parseFlags(["行业名", "--kind", "客户", "--limitation", "a", "--limitation", "b"]);
    assert.deepEqual(positional, ["行业名"]);
    assert.deepEqual(flags.get("kind"), ["客户"]);
    assert.deepEqual(flags.get("limitation"), ["a", "b"]);
  });

  test("T-B11: `target add` writes a real target", async () => {
    const { db, repo, sid, positionRef, lines, deps } = await setupCli();
    try {
      assert.equal(await runTargetAdd(addArgs(positionRef), { json: false }, deps), 0);
      const text = lines.join("\n");
      assert.match(text, /研究对象已确认：XX科技/);
      assert.match(text, /确认人 user/);
      assert.equal(repo.listTargets(sid).length, 1);
      assert.equal(repo.listTargets(sid)[0]!.createdBy, "user");
    } finally {
      rmSync(deps.reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("T-B11: `target list` shows confirmed targets, and --json carries them verbatim", async () => {
    const { db, repo, sid, positionRef, lines, deps } = await setupCli();
    try {
      await runTargetAdd(addArgs(positionRef), { json: false }, deps);
      lines.length = 0;
      assert.equal(await runTargetList(INDUSTRY, { json: false }, deps), 0);
      assert.match(lines.join("\n"), /研究对象（1）/);

      lines.length = 0;
      assert.equal(await runTargetList(INDUSTRY, { json: true }, deps), 0);
      assert.deepEqual(JSON.parse(lines.join("\n")), repo.listTargets(sid));
    } finally {
      rmSync(deps.reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("T-B11: a fallback needs --fallback-for AND a limitation; it lists with its marker", async () => {
    const { db, repo, sid, positionRef, lines, deps } = await setupCli();
    try {
      await runTargetAdd(addArgs(positionRef), { json: false }, deps);
      const primaryRef = repo.listTargets(sid)[0]!.targetRef;

      // missing limitation -> rejected
      lines.length = 0;
      assert.equal(
        await runTargetAdd(addArgs(positionRef, ["--name", "备选甲", "--fallback-for", primaryRef]), { json: false }, deps),
        1,
      );
      assert.match(lines.join("\n"), /ERR:无法录入研究对象/);

      // valid fallback
      lines.length = 0;
      const ok = addArgs(positionRef, [
        "--name",
        "备选乙",
        "--fallback-for",
        primaryRef,
        "--limitation",
        "联系难度高",
      ]);
      assert.equal(await runTargetAdd(ok, { json: true }, deps), 0);
      const created = JSON.parse(lines.join("\n"));
      assert.equal(created.isFallback, true);
      assert.equal(created.fallbackForTargetRef, primaryRef);
      assert.ok(created.limitations.includes("联系难度高"));

      lines.length = 0;
      await runTargetList(INDUSTRY, { json: false }, deps);
      assert.match(lines.join("\n"), /备选→/, "the fallback marker is shown");
    } finally {
      rmSync(deps.reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("T-B11: missing args / unknown industry / unknown position all exit 1", async () => {
    const { db, positionRef, lines, deps } = await setupCli();
    try {
      assert.equal(await runTargetAdd([], { json: false }, deps), 1);
      assert.ok(lines.some((l) => l.startsWith("ERR:usage:")));

      const badIndustry = [
        "不存在行业ZZZ",
        "--kind",
        "k",
        "--name",
        "n",
        "--position",
        positionRef,
        "--purpose",
        "p",
        "--reason",
        "r",
      ];
      assert.equal(await runTargetAdd(badIndustry, { json: false }, deps), 1);

      const badPosition = [
        INDUSTRY,
        "--kind",
        "k",
        "--name",
        "n",
        "--position",
        "pos-nope",
        "--purpose",
        "p",
        "--reason",
        "r",
      ];
      assert.equal(await runTargetAdd(badPosition, { json: false }, deps), 1);
    } finally {
      rmSync(deps.reportDir, { recursive: true, force: true });
      db.close();
    }
  });
});
