/**
 * Phase C5-B — CLI surface for the HUMAN Gate.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §19 (rev5.1) §19.7 / §19.9 / §19.11.
 *
 * Proves at the CLI seam: `confirm`/`reject` are wired through the SHARED dispatcher; `--operator`
 * is required and must be non-blank for BOTH verbs; a non-whitelisted flag is a usage error;
 * terminal states never reverse and exit 1; and the whole surface still never touches a target
 * except on a successful confirm.
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
  TargetRecommendationService,
} from "@tiancha/research";
import { runResearchCommand, type ResearchCliDeps } from "./research-commands.js";

const INDUSTRY = "C5B CLI 行业";

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = repo.findIndustryByName(INDUSTRY)!.industryId;
  new ChainProjectionService(db.db).project(sid);

  const reportDir = mkdtempSync(join(tmpdir(), "c5b-cli-"));
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

/** Seed a company + persisted proposal via the C5-A surface. */
async function seed(t: Awaited<ReturnType<typeof setupCli>>, name: string) {
  await run(t.deps, "company", "add", INDUSTRY, "--name", name, "--kinds", "头部客户");
  await run(t.deps, "proposal", "generate", INDUSTRY);
  const proposal = t.repo.listTargetProposals(t.sid, "proposed")[0];
  assert.ok(proposal, "fixture: one active proposal");
  return proposal.proposalRef;
}

describe("C5-B CLI · confirm / reject", () => {
  test("confirm persists the decision, materialises the target, and exits 0", async () => {
    const t = await setupCli();
    const ref = await seed(t, "CLI确认公司");

    t.lines.length = 0;
    assert.equal(await run(t.deps, "confirm", ref, "--operator", "Alice", "--comment", "看过材料"), 0);
    const human = t.lines.join("\n");
    assert.match(human, /已确认调研/);
    assert.match(human, /正式研究对象/);
    assert.equal(t.repo.listTargets(t.sid).length, 1);
    assert.equal(t.deps.proposals!.get(ref)!.status, "confirmed");
  });

  test("reject records the decision, creates NO target, and exits 0", async () => {
    const t = await setupCli();
    const ref = await seed(t, "CLI拒绝公司");
    t.lines.length = 0;
    assert.equal(await run(t.deps, "reject", ref, "--operator", "Bob"), 0);
    assert.match(t.lines.join("\n"), /已拒绝调研/);
    assert.equal(t.repo.listTargets(t.sid).length, 0, "reject must never materialise");
  });

  test("--operator is required and must be non-blank, for BOTH verbs", async () => {
    const t = await setupCli();
    const ref = await seed(t, "CLI操作者公司");
    for (const argv of [
      ["confirm", ref],
      ["confirm", ref, "--operator", "   "],
      ["reject", ref],
      ["reject", ref, "--operator", "   "],
    ]) {
      t.errs.length = 0;
      assert.equal(await run(t.deps, ...argv), 1, `${argv.join(" ")} must be refused`);
      assert.match(t.errs.join("\n"), /usage: tiancha research (confirm|reject)/);
    }
    assert.equal(t.repo.listTargetProposals(t.sid, "proposed").length, 1, "nothing was decided");
    assert.ok(t.repo.listTargets(t.sid).length === 0);
  });

  test("terminal states never reverse: a second decision exits 1 with a deterministic message", async () => {
    const t = await setupCli();
    const ref = await seed(t, "CLI终态公司");
    assert.equal(await run(t.deps, "confirm", ref, "--operator", "Alice"), 0);
    t.lines.length = 0;
    assert.equal(await run(t.deps, "reject", ref, "--operator", "Bob"), 1);
    assert.match(t.lines.join("\n"), /已处于终态/);
    assert.equal(t.repo.listTargets(t.sid).length, 1, "still exactly one target");
  });

  test("non-whitelisted flags are usage errors (per-verb whitelist, +--operator/--comment only)", async () => {
    const t = await setupCli();
    const ref = await seed(t, "CLI白名单公司");
    for (const flag of ["--force", "--rebuild", "--status", "--json=1"]) {
      t.errs.length = 0;
      assert.equal(await run(t.deps, "confirm", ref, "--operator", "Alice", flag), 1, flag);
      assert.match(t.errs.join("\n"), /不支持的参数/);
    }
    assert.equal(t.repo.listTargetProposals(t.sid, "proposed").length, 1, "refused calls write nothing");
  });

  test("an unknown proposal is a deterministic exit-1 result, not an exception", async () => {
    const t = await setupCli();
    t.lines.length = 0;
    assert.equal(await run(t.deps, "confirm", "prop-nope", "--operator", "Alice"), 1);
    assert.match(t.lines.join("\n"), /未找到研究建议/);
  });

  test("--json returns the structured outcome", async () => {
    const t = await setupCli();
    const ref = await seed(t, "CLI JSON 公司");
    t.lines.length = 0;
    assert.equal(await run(t.deps, "confirm", ref, "--operator", "Alice", "--json"), 0);
    const parsed = JSON.parse(t.lines.join("\n")) as { status: string; targetRef: string };
    assert.equal(parsed.status, "confirmed");
    assert.match(parsed.targetRef, /^tgt-/);
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
