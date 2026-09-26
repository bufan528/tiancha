/**
 * Phase C5-D CLI — `research plan` surfaces the read-only Preparation summary.
 *
 * Contract §21.5: the human render appends a short suffix and OMITS it when there is no
 * preparation; `--json` carries `{ preparationRef, status, questionCount } | null` verbatim.
 * The formatter must never re-read the Preparation SoT (§21.5 formatter constraint).
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

const INDUSTRY = "C5D CLI 行业";

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = repo.findIndustryByName(INDUSTRY)!.industryId;
  new ChainProjectionService(db.db).project(sid);

  const reportDir = mkdtempSync(join(tmpdir(), "c5d-cli-"));
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

type T = Awaited<ReturnType<typeof setupCli>>;

function close(t: T) {
  t.db.close();
  rmSync(t.reportDir, { recursive: true, force: true });
}

const run = (deps: ResearchCliDeps, ...argv: string[]) =>
  runResearchCommand(argv[0], argv.slice(1), deps);

/** company → proposal → `confirm` (the ONLY path that creates a target). */
async function seedConfirmed(t: T, name: string) {
  assert.equal(await run(t.deps, "company", "add", INDUSTRY, "--name", name, "--kinds", "头部客户"), 0);
  assert.equal(await run(t.deps, "proposal", "generate", INDUSTRY), 0);
  const proposal = t.deps.proposals!.list(t.sid, "proposed").filter((p) => p.companyRef !== "")[0];
  assert.equal(await run(t.deps, "confirm", proposal.proposalRef, "--operator", "张三"), 0);
  const targetRef = t.repo.listTargets(t.sid)[0].targetRef;
  return { proposalRef: proposal.proposalRef, targetRef };
}

/** Dig out one proposal from a plan view (human or parsed `--json`). */
function findProposal(view: any, proposalRef: string): any {
  const all = [
    ...view.gaps.flatMap((g: any) => g.positions.flatMap((p: any) => p.proposals)),
    ...view.orphanProposals,
  ];
  const found = all.find((p: any) => p.proposalRef === proposalRef);
  assert.ok(found, `the plan shows ${proposalRef}`);
  return found;
}

async function planJson(t: T): Promise<any> {
  t.lines.length = 0;
  assert.equal(await run(t.deps, "plan", INDUSTRY, "--json"), 0);
  return JSON.parse(t.lines.join(""));
}

describe("C5-D CLI · research plan shows the preparation summary (read-only)", () => {
  test("T-D-12: no preparation ⇒ human omits the suffix entirely, json carries an explicit null", async () => {
    const t = await setupCli();
    try {
      const { proposalRef } = await seedConfirmed(t, "CLI无准备公司");
      assert.equal(t.repo.listPreparations(t.sid).length, 0, "fixture: no preparation exists");

      t.lines.length = 0;
      assert.equal(await run(t.deps, "plan", INDUSTRY), 0);
      const human = t.lines.join("\n");
      assert.match(human, /CLI无准备公司/);
      assert.match(human, /已确认 → 研究对象/);
      // The C2 target surface legitimately renders 「暂无调研准备」; the C5-D proposal line itself
      // must add NOTHING when there is no preparation (§21.5 formatter constraint).
      const proposalLine = human
        .split("\n")
        .find((l) => l.includes("CLI无准备公司（头部客户）· 已确认 → 研究对象"))!;
      assert.ok(proposalLine, "fixture: the proposal line is rendered");
      assert.doesNotMatch(proposalLine, /· 调研准备 /, "null ⇒ the suffix is omitted entirely");

      const p = findProposal(await planJson(t), proposalRef);
      assert.equal(p.preparation, null, "json keeps the explicit null");
    } finally {
      close(t);
    }
  });

  test("T-D-13: a materialised preparation shows the same three fields in human and json", async () => {
    const t = await setupCli();
    try {
      const { proposalRef, targetRef } = await seedConfirmed(t, "CLI有准备公司");
      assert.equal(await run(t.deps, "diligence", INDUSTRY, "--target", targetRef), 0);

      const stored = t.repo.listPreparations(t.sid)[0];
      const current = stored.questions.filter((q) => q.state === "current").length;
      assert.ok(current > 0, "fixture: the preparation has current questions");

      t.lines.length = 0;
      assert.equal(await run(t.deps, "plan", INDUSTRY), 0);
      const human = t.lines.join("\n");
      assert.match(human, new RegExp(`调研准备 ${stored.status}（${current} 问）`), "human shows status + current count");

      const p = findProposal(await planJson(t), proposalRef);
      assert.deepEqual(
        p.preparation,
        { preparationRef: stored.preparationRef, status: stored.status, questionCount: current },
        "json mirrors the SoT — and human/json agree",
      );
      assert.equal(p.targetRef, targetRef);
    } finally {
      close(t);
    }
  });
});
