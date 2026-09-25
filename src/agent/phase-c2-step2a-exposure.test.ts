/**
 * Phase C2 · Step 2-A — Agent coverage exposure (READ-ONLY).
 *
 * T-C2-36: `research_chain_show` gains `activeRequirementCount` from the SAME domain derivation
 * the CLI uses, while `servesRequirementCount` (= all / capability) is kept unchanged. The Agent
 * still has no chain projection service injected (B5 governance) — it READS only.
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
} from "@tiancha/research";
import { buildResearchTools } from "./research-tools.js";

const INDUSTRY = "C2 Step2A Agent 行业";

const count = (db: ResearchDb, table: string) =>
  (db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n;

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
  }) as any[];
  const byName = new Map(tools.map((t) => [t.name, t]));
  return { db, repo, sid, byName, svc };
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

describe("Phase C2 · Step 2-A · Agent coverage", () => {
  test("T-C2-36 (Agent): `research_chain_show` adds active coverage from the SAME derivation", async () => {
    const { db, repo, sid, byName, svc } = await setup();
    try {
      new ChainProjectionService(db.db).project(sid);
      const coverage = new ChainProjectionService(db.db).positionCoverage(sid);
      const positionsBefore = count(db, "research_position");

      const { parsed } = await call(byName.get("research_chain_show"), { name: INDUSTRY });
      assert.equal(parsed.length, coverage.length);
      for (const p of parsed) {
        const cov = coverage.find((c) => c.positionRef === p.positionRef)!;
        assert.ok(cov, "coverage exists for every reported position");
        // ★ kept unchanged: servesRequirementCount = all (capability)
        assert.equal(p.servesRequirementCount, cov.allRequirementRefs.length);
        // ★ new in Step 2-A: activeRequirementCount = active (shared derivation)
        assert.equal(p.activeRequirementCount, cov.activeRequirementRefs.length);
        assert.ok(p.activeRequirementCount <= p.servesRequirementCount, "active ≤ all");
      }

      // the same predicate: converging a gap shrinks the Agent's active numbers
      const activeBefore = parsed.reduce((s: number, p: any) => s + p.activeRequirementCount, 0);
      await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market A", dimension: "market" }],
      });
      const { parsed: after } = await call(byName.get("research_chain_show"), { name: INDUSTRY });
      const activeAfter = after.reduce((s: number, p: any) => s + p.activeRequirementCount, 0);
      assert.ok(activeAfter < activeBefore, "active coverage shrank after convergence");
      for (const p of after) {
        assert.equal(
          p.servesRequirementCount,
          coverage.find((c) => c.positionRef === p.positionRef)!.allRequirementRefs.length,
          "capability count is unchanged by convergence",
        );
      }

      // …and the tool still only READS: nothing was projected / written by showing it
      assert.equal(count(db, "research_position"), positionsBefore, "the tool never projects a chain");
    } finally {
      db.close();
    }
  });
});
