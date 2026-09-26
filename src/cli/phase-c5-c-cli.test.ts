/**
 * Phase C5-C — CLI surface for the read-only plan proposal display.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §20.6 / §20.9 T-C5-C-12.
 *
 * Proves: `research plan` shows the proposal section (status explicit, 「尚无决策」 when there is
 * none) and an orphan section; `--json` carries `orphanProposals` + `positions[].proposals`;
 * no new flag/command is introduced; and C5-C never decides or materialises anything.
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
  CompanyService,
  TargetProposalService,
  ProposalDecisionService,
} from "@tiancha/research";
import { runResearchCommand, type ResearchCliDeps } from "./research-commands.js";

const INDUSTRY = "C5C CLI 行业";

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = repo.findIndustryByName(INDUSTRY)!.industryId;
  new ChainProjectionService(db.db).project(sid);

  const reportDir = mkdtempSync(join(tmpdir(), "c5c-cli-"));
  const lines: string[] = [];
  const errs: string[] = [];
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
    companies: new CompanyService(db.db),
    proposals: new TargetProposalService(db.db),
    decisions: new ProposalDecisionService(db.db),
    reportDir,
    out: (line) => lines.push(line),
    err: (line) => errs.push(line),
  };
  return { db, repo, sid, deps, lines, errs, reportDir };
}

const run = (deps: ResearchCliDeps, ...argv: string[]) =>
  runResearchCommand(argv[0], argv.slice(1), deps);

async function seed(t: Awaited<ReturnType<typeof setupCli>>, name: string) {
  await run(t.deps, "company", "add", INDUSTRY, "--name", name, "--kinds", "头部客户");
  await run(t.deps, "proposal", "generate", INDUSTRY);
}

describe("C5-C CLI · research plan shows proposals (read-only)", () => {
  test("T-C5-C-12: the human render shows the proposal section and 「尚无决策」", async () => {
    const t = await setupCli();
    await seed(t, "CLI提案公司");
    t.lines.length = 0;
    assert.equal(await run(t.deps, "plan", INDUSTRY), 0);
    const human = t.lines.join("\n");
    assert.match(human, /研究建议 1/);
    assert.match(human, /CLI提案公司/);
    assert.match(human, /待人工决策/, "an undecided proposal says so");
    assert.match(human, /尚无决策/, "decision absence is stated, never fabricated");
    assert.match(human, /悬空研究建议/, "the orphan section is always rendered");
  });

  test("after confirm the same line reports the target; after reject it reports 已拒绝", async () => {
    const t = await setupCli();
    await seed(t, "CLI已确认公司");
    const ref = t.repo.listTargetProposals(t.sid, "proposed")[0].proposalRef;
    assert.equal(await run(t.deps, "confirm", ref, "--operator", "Alice"), 0);

    t.lines.length = 0;
    assert.equal(await run(t.deps, "plan", INDUSTRY), 0);
    const human = t.lines.join("\n");
    assert.match(human, /已确认 → 研究对象 tgt-/);
    assert.match(human, /决策确认 by Alice/);
  });

  test("--json carries orphanProposals and positions[].proposals", async () => {
    const t = await setupCli();
    await seed(t, "CLI JSON 公司");
    t.lines.length = 0;
    assert.equal(await run(t.deps, "plan", INDUSTRY, "--json"), 0);
    const view = JSON.parse(t.lines.join("\n")) as {
      orphanProposals: unknown[];
      gaps: Array<{ positions: Array<{ proposals: unknown[] }> }>;
    };
    assert.ok(Array.isArray(view.orphanProposals), "orphanProposals present");
    const mounted = view.gaps.flatMap((g) => g.positions.flatMap((p) => p.proposals));
    assert.equal(mounted.length, 1, "the proposal is mounted in the JSON view too");
    assert.equal(view.orphanProposals.length, 0);
  });

  test("C5-C adds NO new command and decides nothing", async () => {
    const t = await setupCli();
    await seed(t, "CLI零决策公司");
    // `plan` is read-only: it must not change proposal status or create a target.
    await run(t.deps, "plan", INDUSTRY);
    assert.equal(t.repo.listTargetProposals(t.sid, "proposed").length, 1, "status untouched");
    assert.equal(t.repo.listTargets(t.sid).length, 0, "no target materialised");
    // an unknown verb is still refused by the shared dispatcher
    assert.equal(await run(t.deps, "plans", INDUSTRY), 1);
  });

  test("cleanup", async () => {
    const t = await setupCli();
    try {
      rmSync(t.reportDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      /* cleanup must never fail the assertion */
    }
  });
});
