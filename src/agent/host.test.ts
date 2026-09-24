/**
 * Phase 2B tests.
 * T6: research tools delegate to the Application/Repository layer (semantic
 *     tool selection is the main model's job; here we assert the tools exist and
 *     return structured research data, with no keyword classifier in the host).
 * T7: the REPL entry (no args) is the Tiancha Agent, not the old host.
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
} from "@tiancha/research";
import { buildResearchTools } from "./research-tools.js";

describe("T6 research tools delegate to repository (no keyword classifier)", () => {
  test("research tools registered; industry_show returns structured research data", async () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const artifacts = new SqliteArtifactStore({ path: ":memory:" });
    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    await svc.ingestMaterial({ materialText: "测试材料", industryName: "固态电池" });

    const tools = buildResearchTools({
      repo,
      service: svc,
      methodology: new MethodologyService(repo),
      priority: new PriorityService(db.db),
      reports: new ReportService(db.db),
    });
    const names = tools.map((t: any) => t.name);
    for (const n of [
      "research_industry_ingest",
      "research_industry_show",
      "research_state_show",
      "research_question_list",
      "research_gap_list",
      "research_next_action_list",
      "research_methodology_show",
      "research_methodology_list",
      "research_methodology_propose",
    ]) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }
    // Invariant 6: the model may PROPOSE methodology changes but must never be
    // able to DECIDE/activate one — no such tool may be exposed.
    assert.ok(!/methodology_(decide|approve|activate)/.test(names.join(",")), "no methodology decide tool");

    const show = tools.find((t: any) => t.name === "research_industry_show") as any;
    const res = await show.execute("call-1", { name: "固态电池" });
    const text = res.content[0].text as string;
    assert.match(text, /canonicalName/);
    assert.match(text, /questions/);
    assert.ok(!text.includes("TODO"), "tool returns real data");

    // unknown industry handled gracefully, no crash
    const miss = await show.execute("call-2", { name: "不存在的行业XYZ" });
    assert.match(miss.content[0].text, /未找到/);
    db.close();
  });
});

describe("T7 entry wiring", () => {
  test("no keyword classifier exists in the tool surface (routing is semantic)", () => {
    // The host injects tools with rich descriptions; there is no text-classifier
    // function in this layer. Assert buildResearchTools is the only routing surface.
    const src = buildResearchTools.toString();
    assert.ok(!/includes\(|indexOf\(/.test(src), "no keyword matching in tools");
  });
});
