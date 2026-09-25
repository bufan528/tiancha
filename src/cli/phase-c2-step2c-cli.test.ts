/**
 * Phase C2 · Step 2-C — CLI exposure of the research plan.
 *
 *   T-C2-33  `research plan` renders, is deterministic, and an unknown industry writes nothing
 *   T-C2-35  `--json` IS the ONE `ResearchPlanView` (the very same build path the Agent uses)
 *   T-C2-17  rendering writes nothing (24-table fingerprint)
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
  ResearchNeedService,
  QuestionTargetFitService,
  DiligencePreparationService,
  ResearchPlanService,
} from "@tiancha/research";
import { runResearchCommand, type ResearchCliDeps } from "./research-commands.js";

const INDUSTRY = "C2 Step2C CLI 行业";

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

const dbFingerprint = (db: ResearchDb) =>
  JSON.stringify(TABLES.map((t) => [t, db.db.prepare(`SELECT * FROM ${t}`).all()]));

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  new ChainProjectionService(db.db).project(sid);

  const dir = mkdtempSync(join(tmpdir(), "tiancha-c2-step2c-"));
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

describe("Phase C2 · Step 2-C · CLI research plan", () => {
  test("T-C2-33 / T-C2-35 / T-C2-17: renders deterministically, writes nothing, and IS the view", async () => {
    const { db, sid, dir, lines, deps } = await setupCli();
    try {
      const before = dbFingerprint(db);

      // ① the human formatter renders the plan
      lines.length = 0;
      assert.equal(await runResearchCommand("plan", [INDUSTRY], deps), 0);
      const human = lines.join("\n");
      assert.match(human, /研究计划（/);
      assert.match(human, /当前认知|暂无已落库的研究状态/);
      assert.match(human, /开放缺口/);
      assert.match(human, /行业级对象（不属于任何开放缺口）：/);
      assert.match(human, /下一步动作（/);
      assert.equal(dbFingerprint(db), before, "rendering writes nothing");

      // ② deterministic: the same industry renders byte-identically twice
      lines.length = 0;
      assert.equal(await runResearchCommand("plan", [INDUSTRY], deps), 0);
      assert.equal(lines.join("\n"), human, "the human output is deterministic");

      // ③ ★ `--json` IS the ONE view (the same build path the Agent uses)
      lines.length = 0;
      assert.equal(await runResearchCommand("plan", [INDUSTRY, "--json"], deps), 0);
      const parsed = JSON.parse(lines.join("\n"));
      assert.deepEqual(parsed, new ResearchPlanService(db.db).build(sid), "CLI --json === the view");
      // …and the DTO carries no identity / lifecycle (projection, not an entity)
      for (const forbidden of ["planId", "createdAt", "updatedAt", "versionId", "status"]) {
        assert.equal(forbidden in parsed, false, `the view must not carry ${forbidden}`);
      }

      // ④ an unknown industry errors and writes nothing
      lines.length = 0;
      assert.equal(await runResearchCommand("plan", ["不存在的行业ZZZ"], deps), 1);
      assert.ok(lines.some((l) => l.startsWith("ERR:")), "it fails loudly");
      assert.equal(dbFingerprint(db), before, "…still zero writes");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("T-C2-27 (CLI): a fully converged industry renders the empty plan as a NORMAL state", async () => {
    const { db, repo, sid, dir, lines, deps } = await setupCli();
    try {
      for (const gap of repo.listGaps(sid)) repo.upsertGap({ ...gap, status: "resolved" });
      lines.length = 0;
      assert.equal(await runResearchCommand("plan", [INDUSTRY], deps), 0);
      const human = lines.join("\n");
      assert.match(human, /开放缺口：无 —— 相关缺口已收敛/);
      assert.ok(!/未生成|请先执行/.test(human), "no 'not generated yet' branch exists");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
