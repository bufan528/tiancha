/**
 * Phase C2 · Step 2-C — Agent exposure of the research plan (READ-ONLY).
 *
 *   T-C2-34  `research_plan_show` returns the projection directly — no "not generated yet" branch,
 *            no refresh, and nothing written (24-table fingerprint)
 *   T-C2-35  the Agent returns the SAME `ResearchPlanView` the CLI `--json` renders (one build path)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ResearchDb,
  ResearchRepository,
  SqliteArtifactStore,
  EchoDataProvider,
  OpportunityDiscoveryService,
  MethodologyService,
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
import { buildResearchTools } from "./research-tools.js";

const INDUSTRY = "C2 Step2C Agent 行业";

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

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  new ChainProjectionService(db.db).project(sid);

  const tools = buildResearchTools({
    repo,
    service: svc,
    methodology: new MethodologyService(repo),
    priority: new PriorityService(db.db),
    reports: new ReportService(db.db),
    materials: new MaterialIngestService(repo, new EchoDataProvider(), artifacts),
    targets: new TargetService(db.db),
    needs: new ResearchNeedService(db.db),
    fits: new QuestionTargetFitService(db.db),
    diligence: new DiligencePreparationService(db.db),
    plans: new ResearchPlanService(db.db),
  }) as any[];
  const byName = new Map(tools.map((t) => [t.name, t]));
  return { db, repo, sid, byName, tools };
}

async function call(tool: any, args: Record<string, unknown>): Promise<{ text: string; parsed: any }> {
  const res = await tool.execute("call-1", args);
  const text = res.content[0].text as string;
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { text, parsed };
}

describe("Phase C2 · Step 2-C · Agent research plan", () => {
  test("T-C2-34 / T-C2-35: returns the SAME view, read-only, with no 'not generated' branch", async () => {
    const { db, sid, byName } = await setup();
    try {
      // the tool exists (the 19th) and is reachable
      assert.ok(byName.has("research_plan_show"), "the plan tool is registered");

      const before = dbFingerprint(db);
      const { text, parsed } = await call(byName.get("research_plan_show"), { name: INDUSTRY });

      assert.ok(!/未生成|请先执行|not generated/.test(text), "there is NO 'not generated yet' branch");
      assert.deepEqual(parsed, new ResearchPlanService(db.db).build(sid), "the Agent IS the view");
      assert.equal(dbFingerprint(db), before, "the tool only reads (zero writes)");

      // an unknown industry is handled gracefully (and still writes nothing)
      const miss = await call(byName.get("research_plan_show"), { name: "不存在的行业ZZZ" });
      assert.match(miss.text, /未找到行业/);
      assert.equal(dbFingerprint(db), before);

      // 0 open gaps / 0 targets is a NORMAL state — the plan still renders
      for (const gap of new ResearchRepository(db.db).listGaps(sid)) {
        new ResearchRepository(db.db).upsertGap({ ...gap, status: "resolved" });
      }
      const empty = await call(byName.get("research_plan_show"), { name: INDUSTRY });
      assert.equal(empty.parsed.gaps.length, 0);
      assert.deepEqual(empty.parsed.industryTargets, []);
      assert.ok(empty.parsed.state === null || typeof empty.parsed.state.version === "number");
    } finally {
      db.close();
    }
  });
});
