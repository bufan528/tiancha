/**
 * Phase B v1 · Step B5 — Agent exposure of the research-planning chain (T-B28).
 *
 * The four B5 tools are READ-ONLY by construction: the Agent may look at the projected
 * chain, the derived needs, the human-confirmed targets and the assembled preparations —
 * it can never project a chain, never record a target and never assemble an outline.
 * When the upstream artefact does not exist, the tool says WHO must produce it instead of
 * producing it (the same governance as S7's `research_evaluate`).
 *
 * T-B29 scope self-check: the B5 tool surface adds no model call, no external data source,
 * no Evidence-layer model — and no `ChainProjectionService` is handed to the Agent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const INDUSTRY = "B5 Agent 行业";
const B5_TOOLS = [
  "research_chain_show",
  "research_need_list",
  "research_target_list",
  "research_diligence_show",
] as const;

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
  return { db, repo, sid, tools, byName };
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

describe("Phase B · Step B5 · Agent exposure (read-only)", () => {
  test("T-B28-1: `research_chain_show` READS the chain and never projects one", async () => {
    const { db, repo, sid, byName } = await setup();
    try {
      assert.equal(count(db, "research_position"), 0, "nothing projected yet");

      const empty = await call(byName.get("research_chain_show"), { name: INDUSTRY });
      assert.match(empty.text, /尚未生成调研链条/);
      assert.match(empty.text, /tiancha research chain/, "it names the human command that produces it");
      assert.equal(count(db, "research_position"), 0, "the tool must NOT project a chain");

      // a researcher runs the CLI command …
      new ChainProjectionService(db.db).project(sid);

      const { parsed } = await call(byName.get("research_chain_show"), { name: INDUSTRY });
      assert.equal(parsed.length, 6);
      for (const p of parsed) {
        assert.ok(p.positionRef.startsWith("pos-"));
        assert.ok(p.whyImportant.length > 0, "I-B1: no empty node is exposed");
        assert.ok(p.suggestedTargetKinds.length > 0, "type-level advice only");
        assert.ok(p.servesRequirementCount > 0, "a position is never an empty node");
        assert.equal(p.chainTemplateId, "chain-template-general");
        assert.equal(p.chainVersion, "v1");
      }
      // …and reading it a second time still writes nothing.
      await call(byName.get("research_chain_show"), { name: INDUSTRY });
      assert.equal(count(db, "research_position"), 6, "read-only");

      const missing = await call(byName.get("research_chain_show"), { name: "不存在的行业ZZZ" });
      assert.match(missing.text, /未找到行业/);
    } finally {
      db.close();
    }
  });

  test("T-B28-2: `research_need_list` returns exactly the derived needs", async () => {
    const { db, repo, sid, byName } = await setup();
    try {
      new ChainProjectionService(db.db).project(sid);
      const direct = new ResearchNeedService(db.db).list(sid);
      const { parsed } = await call(byName.get("research_need_list"), { name: INDUSTRY });
      assert.deepEqual(parsed, direct, "no second code path");
      assert.ok(direct.length > 0);
      for (const n of parsed) assert.ok(n.whyStudyNotJustFetch.length > 0);
      // needs stay derived: no Gap / Requirement is written by listing them
      assert.ok(repo.listGaps(sid).every((g) => g.status === "open" || g.status === "mitigating"));
    } finally {
      db.close();
    }
  });

  test("T-B28-3: `research_target_list` lists confirmed targets + fit counts, and writes none", async () => {
    const { db, repo, sid, byName } = await setup();
    try {
      const empty = await call(byName.get("research_target_list"), { name: INDUSTRY });
      assert.match(empty.text, /尚无已确认的研究对象/);
      assert.match(empty.text, /由人确认/, "the human boundary is stated");

      new ChainProjectionService(db.db).project(sid);
      const position = repo.listPositions(sid).find((p) => p.kind === "expert")!;
      new TargetService(db.db).add({
        industryId: sid,
        subjectKey: "B5 专家乙",
        targetKind: position.suggestedTargetKinds[0]!,
        positionRef: position.positionRef,
        researchPurpose: "判断技术路线",
        selectionReason: "资深从业者",
      });

      const { parsed } = await call(byName.get("research_target_list"), { name: INDUSTRY });
      assert.equal(parsed.length, 1);
      assert.deepEqual(parsed[0].target, repo.listTargets(sid)[0], "the target is echoed verbatim");
      assert.deepEqual(
        parsed[0].fit,
        new QuestionTargetFitService(db.db).summarize(repo.listTargets(sid)[0]!.targetRef),
        "the fit counts are B3 aggregation",
      );
      assert.equal(count(db, "research_target"), 1, "listing writes no target");
    } finally {
      db.close();
    }
  });

  test("T-B28-4: `research_diligence_show` reads a preparation and never assembles one", async () => {
    const { db, repo, sid, byName } = await setup();
    try {
      new ChainProjectionService(db.db).project(sid);
      const position = repo.listPositions(sid).find((p) => p.kind === "customer")!;
      const target = new TargetService(db.db).add({
        industryId: sid,
        subjectKey: "B5 客户乙",
        targetKind: position.suggestedTargetKinds[0]!,
        positionRef: position.positionRef,
        researchPurpose: "验证采购意愿",
        selectionReason: "行业头部采购方",
      });

      // no outline yet ⇒ the tool says so and writes nothing.
      const empty = await call(byName.get("research_diligence_show"), { name: INDUSTRY });
      assert.match(empty.text, /暂无调研准备/);
      const missing = await call(byName.get("research_diligence_show"), {
        name: INDUSTRY,
        target: target.targetRef,
      });
      assert.match(missing.text, /尚无调研准备/);
      assert.match(missing.text, /tiancha research diligence/, "it names the human command");
      assert.equal(count(db, "diligence_preparation"), 0, "the tool must NOT assemble an outline");

      // a researcher generates it via CLI …
      new DiligencePreparationService(db.db).prepare(target.targetRef);

      const { parsed } = await call(byName.get("research_diligence_show"), {
        name: INDUSTRY,
        target: target.targetRef,
      });
      assert.equal(parsed.preparationRef, `dp-${target.targetRef}`);
      assert.equal(parsed.purpose, "验证采购意愿");
      assert.ok(parsed.questions.length > 0);
      for (const q of parsed.questions) {
        assert.ok(q.fromRequirementRef !== null || q.fromFitRef !== null, "I-B5 traceability survives exposure");
        if (q.isFallbackSource) assert.ok(q.caveat && q.caveat.length > 0, "I-B4 caveat survives exposure");
      }
      const overview = await call(byName.get("research_diligence_show"), { name: INDUSTRY });
      assert.equal(overview.parsed.length, 1);
      assert.equal(overview.parsed[0].preparationRef, `dp-${target.targetRef}`);
    } finally {
      db.close();
    }
  });

  test("T-B29: the B5 tool surface exposes no write path and no model", () => {
    const source = readFileSync(new URL("./research-tools.ts", import.meta.url), "utf8");
    // ★ No chain projection, no target write, no methodology decision reaches the model.
    assert.ok(
      !/ChainProjectionService|\.project\(/.test(source),
      "the Agent is not given the projection service",
    );
    assert.ok(!/target_(add|write|create)|research_target_add/.test(source), "no target write tool");
    assert.ok(!/methodology_(decide|approve|activate)/.test(source), "no methodology decision tool");
    assert.ok(!/openai|anthropic|generateText|llm\(/i.test(source), "no model call in the tool layer");
    assert.ok(!/fetch\(|https?:\/\//.test(source), "no external data source in the tool layer");
    assert.ok(!/EvidenceAssertion|DocumentFragment/.test(source), "B5 introduces no Evidence-layer model");
    for (const name of B5_TOOLS) {
      assert.ok(source.includes(`"${name}"`), `${name} is defined in the tool layer`);
    }
  });
});
