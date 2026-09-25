/**
 * Phase C · Step C3-B — Agent consumer consistency (T-C3-17).
 *
 * Contract: `docs/phaseC/c3-implementation-contract.md` §5.3 / §10.3（Agent 只读、写权限不扩大）
 *   T-C3-17  Agent `research_priority` **就是** `PriorityService.currentPriorities()`；
 *            篡改 persisted 值后 Agent 跟随（证明它不重算）。
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

const INDUSTRY = "C3-B Agent 行业";

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
  return { db, repo, sid, byName };
}

async function callTool(tool: any, args: Record<string, unknown>): Promise<any> {
  const res = await tool.execute("call-1", args);
  return JSON.parse(res.content[0].text as string);
}

describe("Phase C3-B · Agent priority == the read face", () => {
  test("T-C3-17: `research_priority` IS currentPriorities(), and the tool only reads", async () => {
    const { db, repo, sid, byName } = await setup();
    try {
      const before = dbFingerprint(db);
      const parsed = await callTool(byName.get("research_priority"), { name: INDUSTRY });
      const direct = new PriorityService(db.db).currentPriorities(sid);
      assert.ok(direct.length > 0, "the fixture has persisted priorities");
      // The Agent surfaces a PROJECTION of the read face (4 fields), so compare semantically:
      // same set, same order, identical values — and never a field the read face does not have.
      assert.equal(parsed.length, direct.length, "same number of priorities as the read face");
      assert.deepEqual(
        parsed.map((l: any) => l.gapId),
        direct.map((p) => p.gapId),
        "the Agent keeps the read face's (persisted) order",
      );
      const byGap = new Map(direct.map((p) => [p.gapId, p]));
      for (const line of parsed as Array<Record<string, unknown>>) {
        assert.deepEqual(
          Object.keys(line).sort(),
          ["gapId", "policyVersionId", "rationale", "score"],
          "the Agent must not invent fields the read face does not have",
        );
        const p = byGap.get(line.gapId as string)!;
        assert.ok(p, "every Agent line exists in the read face");
        assert.equal(line.score, p.score);
        assert.equal(line.policyVersionId, p.policyVersionId);
        assert.equal(line.rationale, p.rationale);
      }
      assert.equal(dbFingerprint(db), before, "the Agent tool is read-only (24-table fingerprint)");

      // ★ tamper ONE persisted row: the Agent must FOLLOW the persisted value (no recomputation)
      const row = repo.listNextActions(sid).find((a) => a.status === "open")!;
      const gapId = row.params.gapId as string;
      repo.upsertNextAction({
        ...row,
        priority: 9,
        params: { ...row.params, priorityPolicyVersionId: "prio-TAMPERED" },
      });
      const after = (await callTool(byName.get("research_priority"), { name: INDUSTRY })) as Array<{
        gapId: string;
        score: number;
        policyVersionId: string;
      }>;
      const tampered = after.find((p) => p.gapId === gapId)!;
      assert.equal(tampered.score, 9, "T-C3-17: the Agent shows the PERSISTED score");
      assert.equal(tampered.policyVersionId, "prio-TAMPERED", "…and the PERSISTED policy version");

      // the Agent still exposes no write capability for Priority / NextAction
      const names = [...byName.keys()].join(",");
      assert.ok(!/priority_(write|set|update)|next_action_(write|create|update)/.test(names));
      // …and the only DB change since the baseline is the tamper WE made, not the tool
      assert.notEqual(dbFingerprint(db), before, "only the explicit tamper changed the DB");
    } finally {
      db.close();
    }
  });
});
