/**
 * S7 — capability exposure acceptance (T-A12).
 *
 * These tests pin the entry-exposure contract:
 *   the Agent tools READ what already exists (no recomputation) and NEVER let the model
 *   change research state; `research_report` appends a projection only.
 *
 * T-A12-1  exactly 13 tools, uniquely named  | T-A12-2  the 4 new tools are registered
 * T-A12-3  pool read equivalence              | T-A12-4  evaluate reads latest evaluation
 * T-A12-5  priority == currentPriorities()    | T-A12-6  report appends a projection only
 * T-A12-7  no evaluation -> the tool MUST NOT trigger evaluate()
 * T-A12-11 insufficient_evidence renders as "证据不足"
 * T-A12-12 forbidden wording absent from the S7 tool metadata AND human output
 * T-A12-13 no methodology decide/activate tool
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
  EvaluationService,
  MaterialIngestService,
} from "@tiancha/research";
import { buildResearchTools } from "./research-tools.js";
import { EVIDENCE_INSUFFICIENT, dimensionStatusLabel, formatEvaluationHuman } from "../cli/research-format.js";

const S7_TOOLS = ["research_pool_show", "research_evaluate", "research_priority", "research_report"] as const;
const FORBIDDEN = ["不看好", "值得投", "建议投资", "不值得投", "看好"];

async function setup() {
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
  const tools = buildResearchTools({
    repo,
    service: svc,
    methodology: new MethodologyService(repo),
    priority: new PriorityService(db.db),
    reports: new ReportService(db.db),
    materials: new MaterialIngestService(repo, new EchoDataProvider(), artifacts),
  }) as any[];
  const byName = new Map(tools.map((t) => [t.name, t]));
  return { db, repo, sid, tools, byName };
}

async function call(tool: any, name: string): Promise<{ text: string; parsed: any }> {
  const res = await tool.execute("call-1", { name });
  const text = res.content[0].text as string;
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { text, parsed };
}

const countEvals = (db: ResearchDb) =>
  (db.db.prepare("SELECT COUNT(*) AS n FROM investment_evaluation").get() as any).n;

describe("S7 capability exposure", () => {
  test("T-A12-1 / T-A12-2: exactly 14 uniquely-named tools; the 4 S7 tools registered", async () => {
    const { tools, byName, db } = await setup();
    assert.equal(tools.length, 14, "exactly 14 tools (13 from S7 + C-MVP material_add)");
    assert.equal(new Set(tools.map((t) => t.name)).size, 14, "no duplicate registration");
    for (const n of S7_TOOLS) assert.ok(byName.has(n), `missing tool ${n}`);
    db.close();
  });

  test("T-A12-13: no methodology decide/activate tool is exposed", async () => {
    const { tools, db } = await setup();
    assert.ok(!/methodology_(decide|approve|activate)/.test(tools.map((t) => t.name).join(",")));
    db.close();
  });

  test("B2: the Agent has NO target-write tool — targets stay human-confirmed", async () => {
    const { tools, db } = await setup();
    const names = tools.map((t) => t.name).join(",");
    assert.ok(!names.includes("research_target_add"), "no target add tool");
    assert.ok(!/target_(add|write|create)/.test(names), "no target write surface at all");
    db.close();
  });

  test("T-A12-3: research_pool_show == a direct repository read", async () => {
    const { byName, repo, sid, db } = await setup();
    const { parsed } = await call(byName.get("research_pool_show"), "S7 行业");
    const expected = repo.listPoolSlots(sid).map((s) => ({
      dimension: s.dimension,
      status: s.status,
      judgement: s.coverageJudgement,
      items: repo.listPoolItems(s.slotId).map((i) => ({ claimRef: i.claimRef, relation: i.relation })),
    }));
    assert.deepEqual(parsed, expected);
    db.close();
  });

  test("T-A12-5: research_priority == PriorityService.currentPriorities() (read-only face)", async () => {
    const { byName, db, sid } = await setup();
    const ps = new PriorityService(db.db).currentPriorities(sid);
    const { parsed } = await call(byName.get("research_priority"), "S7 行业");
    assert.deepEqual(
      parsed,
      ps.map((p) => ({ gapId: p.gapId, score: p.score, rationale: p.rationale, policyVersionId: p.policyVersionId })),
    );
    db.close();
  });

  test("T-A12-7: with no evaluation the Agent tool MUST NOT trigger evaluate()", async () => {
    const { byName, db } = await setup();
    assert.equal(countEvals(db), 0, "no evaluation to begin with");
    const first = await call(byName.get("research_evaluate"), "S7 行业");
    const second = await call(byName.get("research_evaluate"), "S7 行业");
    assert.match(first.text, /暂无已落库的投资评估/);
    assert.equal(first.text, second.text);
    assert.equal(countEvals(db), 0, "the Agent tool must never append an InvestmentEvaluation");
    db.close();
  });

  test("T-A12-4: research_evaluate reads exactly the latest stored evaluation", async () => {
    const { byName, db, sid } = await setup();
    const ev = new EvaluationService(db.db).evaluate("industry", sid); // a HUMAN-side write
    assert.equal(countEvals(db), 1);
    const { parsed } = await call(byName.get("research_evaluate"), "S7 行业");
    assert.deepEqual(parsed, ev);
    // …and reading it again writes nothing new
    await call(byName.get("research_evaluate"), "S7 行业");
    assert.equal(countEvals(db), 1);
    db.close();
  });

  test("T-A12-6: research_report appends a projection and touches no source of truth", async () => {
    const { byName, repo, sid, db } = await setup();
    const sot = () =>
      JSON.stringify({
        slots: repo.listPoolSlots(sid).map((s) => `${s.dimension}:${s.status}`).sort(),
        items: repo.listPoolSlots(sid).flatMap((s) => repo.listPoolItems(s.slotId).map((i) => i.itemId)).sort(),
        gaps: repo.listGaps(sid).map((g) => `${g.gapId}:${g.status}:${g.gapType}`).sort(),
        actions: repo.listNextActions(sid).map((a) => `${a.actionId}:${a.kind}:${a.priority}`).sort(),
      });
    const before = sot();
    const { parsed } = await call(byName.get("research_report"), "S7 行业");
    assert.match(parsed.dossierId, /^dossier-/);
    const row = db.db.prepare("SELECT * FROM report_snapshot WHERE report_id = ?").get(parsed.dossierId);
    assert.ok(row, "the projection row was appended");
    assert.equal(sot(), before, "no Knowledge/Pool/Gap/NextAction mutation");
    db.close();
  });

  test("T-A12-11 / T-A12-12: '证据不足' mapping + no forbidden wording in metadata/output", async () => {
    const { byName, db, sid } = await setup();

    // (a) tool metadata must not contain bullish/bearish wording
    for (const n of S7_TOOLS) {
      const desc = byName.get(n)!.description as string;
      for (const w of FORBIDDEN) {
        assert.ok(!desc.includes(w), `${n}.description must not contain "${w}"`);
      }
    }

    // (b) presentation mapping: insufficient_evidence -> 证据不足 (never a verdict)
    assert.equal(EVIDENCE_INSUFFICIENT, "证据不足");
    assert.equal(dimensionStatusLabel("insufficient_evidence"), "证据不足");

    // (c) the rendered evaluation contains no forbidden wording either
    const ev = new EvaluationService(db.db).evaluate("industry", sid);
    const human = formatEvaluationHuman(ev);
    assert.ok(human.includes("证据不足"), "the evaluation renders 证据不足");
    for (const w of FORBIDDEN) assert.ok(!human.includes(w), `human output must not contain "${w}"`);
    // decision wording stays inside the locked enum rendering
    assert.ok(!/reserve|watch|park|pending/.test(human), "raw decision enum is not leaked to humans");
    db.close();
  });
});
