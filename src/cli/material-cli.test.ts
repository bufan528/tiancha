/**
 * C1 — the material CLI command, exercised through the composition seam
 * (temp directory + in-memory db), so it runs the REAL handler.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
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
import { runMaterialAdd, type ResearchCliDeps } from "./research-commands.js";

const INDUSTRY = "CLI材料行业";
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

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  const dir = mkdtempSync(join(tmpdir(), "tiancha-material-"));
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
    reportDir: join(dir, "reports"),
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR:${l}`),
  };
  return { db, repo, sid, dir, lines, deps };
}

describe("C-MVP CLI (research material add)", () => {
  test("C1: adds a material file and reports the before/after effect", async () => {
    const { db, repo, sid, dir, lines, deps } = await setupCli();
    try {
      const file = join(dir, "expert.md");
      writeFileSync(file, MATERIAL, "utf8");
      assert.equal(await runMaterialAdd(INDUSTRY, file, { json: false }, deps), 0);

      const text = lines.join("\n");
      assert.match(text, /材料入库/);
      assert.match(text, /解析出 2 条 claim/);
      assert.match(text, /开放缺口：12 → 10/);
      assert.match(text, /优先级条目：12 → 10/);
      assert.match(text, /槽位变化：.*market unknown→sufficient/);
      assert.equal(repo.listMaterials(sid).length, 1);
      assert.equal(repo.getPoolSlot(`slot-${sid}-market`)!.status, "sufficient");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      db.close();
    }
  });

  test("C5: adding the SAME file again is a no-op", async () => {
    const { db, repo, sid, dir, lines, deps } = await setupCli();
    try {
      const file = join(dir, "expert.md");
      writeFileSync(file, MATERIAL, "utf8");
      await runMaterialAdd(INDUSTRY, file, { json: false }, deps);
      const before = repo.listMaterials(sid).length;

      lines.length = 0;
      await runMaterialAdd(INDUSTRY, file, { json: false }, deps);
      // ★ C-MVP-R1 §29.4: a COMPLETED相同内容 is reported as a complete duplicate.
      assert.match(lines.join("\n"), /相同材料已完整入库/);
      assert.equal(repo.listMaterials(sid).length, before, "no duplicate material");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      db.close();
    }
  });

  test("--json carries the same view as the human output", async () => {
    const { db, dir, lines, deps } = await setupCli();
    try {
      const file = join(dir, "expert.md");
      writeFileSync(file, MATERIAL, "utf8");
      assert.equal(await runMaterialAdd(INDUSTRY, file, { json: true }, deps), 0);
      const view = JSON.parse(lines.join("\n"));
      assert.equal(view.industry, INDUSTRY);
      // ★ C-MVP-R1 §29.4: no boolean any more — the JSON carries the five-value outcome.
      assert.equal(view.outcome, "created");
      assert.equal(view.parsedClaims, 2);
      assert.equal(view.before.openGaps, 12);
      assert.equal(view.after.openGaps, 10);
      assert.equal(view.before.slotStatuses.market, "unknown");
      assert.equal(view.after.slotStatuses.market, "sufficient");
      assert.match(view.materialId, /^mat-/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      db.close();
    }
  });

  test("usage / unknown industry / unreadable file all exit 1", async () => {
    const { db, dir, lines, deps } = await setupCli();
    try {
      assert.equal(await runMaterialAdd(undefined, "x", { json: false }, deps), 1);
      assert.ok(lines.some((l) => l.startsWith("ERR:usage:")));

      const file = join(dir, "expert.md");
      writeFileSync(file, MATERIAL, "utf8");
      assert.equal(await runMaterialAdd("不存在行业ZZZ", file, { json: false }, deps), 1);

      assert.equal(await runMaterialAdd(INDUSTRY, join(dir, "missing.md"), { json: false }, deps), 1);
      assert.ok(lines.some((l) => l.includes("无法读取材料文件")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      db.close();
    }
  });
});
