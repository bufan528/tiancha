/**
 * C-MVP-R1 (§29.17) — the AGENT entry point must run the SAME orphan-overlap detection as the CLI.
 *
 * This drives the real `research_material_add` tool. Without `knowledge` injected into the
 * MaterialIngestService the scan returns immediately, so an ambiguous overlap would be imported as
 * if nothing were wrong — that is exactly what this test rules out.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ResearchDb,
  ResearchRepository,
  KnowledgeRepository,
  SqliteArtifactStore,
  EchoDataProvider,
  OpportunityDiscoveryService,
  MethodologyService,
  PriorityService,
  ReportService,
  MaterialIngestService,
  TargetService,
  ResearchNeedService,
  QuestionTargetFitService,
  DiligencePreparationService,
  ResearchPlanService,
} from "@tiancha/research";
import { buildResearchTools } from "./research-tools.js";

const INDUSTRY = "R1 Agent 行业";
const MATERIAL = `Agent 路径正文。

[CLAIM]
dimension: market
content: Agent 路径同文块
[/CLAIM]
`;

async function readTool(tool: { execute: (id: string, params: never) => Promise<unknown> }, params: unknown) {
  const res = (await (tool as unknown as {
    execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>;
  }).execute("call-1", params)) as { content: Array<{ text: string }> };
  return res.content[0]!.text;
}

describe("C-MVP-R1 · the Agent tool surface runs the orphan-overlap detection (§29.17)", () => {
  test("T-R1-23: an ambiguous overlap reached through research_material_add FAILS", async () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const artifacts = new SqliteArtifactStore({ path: ":memory:" });
    try {
      const service = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
      const res = await service.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
      const sid = res.industry.industryId;

      // Two Claims with the same content for this subject ⇒ ambiguous (two independent sources).
      for (const claimId of ["claim-dup-a", "claim-dup-b"]) {
        await artifacts.put({
          artifact: {
            artifactId: claimId,
            kind: "claim",
            schemaVersion: "2",
            ref: { artifactId: claimId, kind: "claim", locator: { type: "sqlite", id: claimId } },
            createdAt: new Date().toISOString(),
            taskId: "field-research-ingest",
            attemptId: "ingest-claims",
            runId: "backfill-dupe",
          },
          blob: {
            claimId,
            statement: "Agent 路径同文块",
            claimType: "descriptive",
            provenance: "user",
            conflictOfInterest: false,
            factIds: [],
            evidenceIds: [],
            subjectKind: "industry",
            subjectId: sid,
            temporalRelation: "current",
            isRealExternalData: true,
          },
        });
      }

      // ★ the SAME wiring the Agent host uses (knowledge included) — that is the point of the test.
      const tools = buildResearchTools({
        repo,
        service,
        methodology: new MethodologyService(repo),
        priority: new PriorityService(db.db),
        reports: new ReportService(db.db),
        materials: new MaterialIngestService(repo, new EchoDataProvider(), artifacts, {
          knowledge: new KnowledgeRepository(db.db),
        }),
        targets: new TargetService(db.db),
        needs: new ResearchNeedService(db.db),
        fits: new QuestionTargetFitService(db.db),
        diligence: new DiligencePreparationService(db.db),
        plans: new ResearchPlanService(db.db),
      });

      const tool = tools.find((t) => t.name === "research_material_add");
      assert.ok(tool, "the material tool is exposed to the Agent");
      const text = await readTool(tool as never, {
        name: INDUSTRY,
        title: "Agent 材料",
        content: MATERIAL,
      });
      assert.match(
        text,
        /ORPHAN_CLAIM_AMBIGUOUS/,
        "T-R1-23: the Agent path runs the same detection as the CLI (it must NOT import silently)",
      );
      assert.match(text, /"outcome": "failed"/);
    } finally {
      await artifacts.close();
      db.close();
    }
  });
});
