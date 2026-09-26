/**
 * Phase C5-A — CLI surface (`research company …` / `research proposal …`).
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` (rev4) §12 / §15 (P13) / §16 (T-C5-11).
 *
 * What this proves at the CLI seam:
 *   - the three company commands and the three proposal commands are wired and wired ONLY
 *     through the shared handlers (no second code path);
 *   - `generate` persists proposals but creates NO research target (§2.4 / R3 / P13);
 *   - re-generating the same state adds nothing (P11) — through the CLI, not just the service;
 *   - a non-whitelisted flag is a usage error that persists nothing (T-C5-11, C4-B discipline);
 *   - invalid `--kinds` is refused by the SERVICE, not merely by the CLI.
 *
 * Deliberately ABSENT (C5-B): confirm / reject / decision rows / materialisation.
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
} from "@tiancha/research";
import { runResearchCommand, type ResearchCliDeps } from "./research-commands.js";

const INDUSTRY = "C5A CLI 行业";
const OPTIONS = { json: false };

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = repo.findIndustryByName(INDUSTRY)!.industryId;
  // Positions must be projected, exactly as in production (`research chain` is the prerequisite).
  new ChainProjectionService(db.db).project(sid);

  const reportDir = mkdtempSync(join(tmpdir(), "c5a-cli-"));
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
    reportDir,
    out: (line) => lines.push(line),
    err: (line) => errs.push(line),
  };
  return { db, repo, sid, deps, lines, errs, reportDir };
}

/** Runs through the SHARED dispatcher (proves the union/subcommand/switch wiring). */
const run = (deps: ResearchCliDeps, ...argv: string[]) =>
  runResearchCommand(argv[0], argv.slice(1), deps);

describe("C5-A CLI · company commands", () => {
  test("add → list → get, through the shared dispatcher", async () => {
    const t = await setupCli();
    assert.equal(await run(t.deps, "company", "add", INDUSTRY, "--name", "某头部集成商", "--kinds", "头部客户,大客户"), 0);
    assert.match(t.lines.join("\n"), /候选企业：某头部集成商/);
    assert.match(t.lines.join("\n"), /头部客户 \/ 大客户/);
    assert.equal(t.repo.listCompanies(t.sid).length, 1);

    t.lines.length = 0;
    assert.equal(await run(t.deps, "company", "list", INDUSTRY), 0);
    assert.match(t.lines.join("\n"), /共 1/);

    const companyId = t.repo.listCompanies(t.sid)[0].companyId;
    t.lines.length = 0;
    assert.equal(await run(t.deps, "company", "get", companyId), 0);
    assert.match(t.lines.join("\n"), new RegExp(companyId));

    t.errs.length = 0;
    assert.equal(await run(t.deps, "company", "get", "com-nope"), 1);
    assert.match(t.errs.join("\n"), /未找到企业/);
  });

  test("an invalid --kinds is refused by the service, and nothing is written", async () => {
    const t = await setupCli();
    assert.equal(await run(t.deps, "company", "add", INDUSTRY, "--name", "非法公司", "--kinds", "客户"), 1);
    assert.match(t.errs.join("\n"), /unknown target kind/);
    assert.equal(t.repo.listCompanies(t.sid).length, 0, "no company row may be created");

    t.errs.length = 0;
    assert.equal(await run(t.deps, "company", "add", INDUSTRY, "--name", "缺类型"), 1);
    assert.match(t.errs.join("\n"), /usage: tiancha research company add/);
  });

  test("company CRUD never touches research_target", async () => {
    const t = await setupCli();
    await run(t.deps, "company", "add", INDUSTRY, "--name", "甲", "--kinds", "行业专家");
    assert.equal(t.repo.listTargets(t.sid).length, 0);
  });
});

describe("C5-A CLI · proposal commands", () => {
  test("generate persists a proposal, then re-generating adds nothing (P11)", async () => {
    const t = await setupCli();
    await run(t.deps, "company", "add", INDUSTRY, "--name", "乙", "--kinds", "头部客户");

    t.lines.length = 0;
    assert.equal(await run(t.deps, "proposal", "generate", INDUSTRY), 0);
    assert.match(t.lines.join("\n"), /新增：1/);
    assert.equal(t.repo.listTargetProposals(t.sid).length, 1);

    t.lines.length = 0;
    assert.equal(await run(t.deps, "proposal", "generate", INDUSTRY), 0);
    assert.match(t.lines.join("\n"), /新增：0/);
    assert.match(t.lines.join("\n"), /已存在同一建议：1/);
    assert.equal(t.repo.listTargetProposals(t.sid).length, 1, "still exactly one row");

    // ★ The whole CLI flow must leave `research_target` empty (P13 / §2.4).
    assert.equal(t.repo.listTargets(t.sid).length, 0, "generate must never materialise a target");
    assert.equal(t.repo.listPreparations(t.sid).length, 0, "and never a diligence preparation");
  });

  test("list / get expose the persisted proposal (status stays `proposed`)", async () => {
    const t = await setupCli();
    await run(t.deps, "company", "add", INDUSTRY, "--name", "丙", "--kinds", "头部客户");
    await run(t.deps, "proposal", "generate", INDUSTRY);
    const stored = t.repo.listTargetProposals(t.sid)[0];
    assert.equal(stored.status, "proposed", "C5-A stops at proposed");

    t.lines.length = 0;
    assert.equal(await run(t.deps, "proposal", "list", INDUSTRY), 0);
    assert.match(t.lines.join("\n"), new RegExp(stored.proposalRef));

    t.lines.length = 0;
    assert.equal(await run(t.deps, "proposal", "get", stored.proposalRef), 0);
    const human = t.lines.join("\n");
    assert.match(human, /状态：proposed/);
    assert.match(human, /匹配类型：/);
    assert.match(human, /推荐依据：/);

    t.errs.length = 0;
    assert.equal(await run(t.deps, "proposal", "get", "prop-nope"), 1);
    assert.match(t.errs.join("\n"), /未找到研究建议/);
  });

  test("a non-whitelisted flag is a usage error that persists nothing (T-C5-11)", async () => {
    const t = await setupCli();
    await run(t.deps, "company", "add", INDUSTRY, "--name", "丁", "--kinds", "头部客户");
    for (const flag of ["--force", "--rebuild", "--refresh", "--regenerate", "--confirm"]) {
      t.errs.length = 0;
      assert.equal(await run(t.deps, "proposal", "generate", INDUSTRY, flag), 1, `${flag} must be refused`);
      assert.match(t.errs.join("\n"), /不支持的参数/);
    }
    assert.equal(t.repo.listTargetProposals(t.sid).length, 0, "a refused command writes nothing");

    // The whitelisted flag still works.
    assert.equal(await run(t.deps, "proposal", "generate", INDUSTRY, "--gap", "gap-does-not-exist"), 0);
  });

  test("an unknown verb yields the usage line", async () => {
    const t = await setupCli();
    assert.equal(await run(t.deps, "proposal", "confirm", "x"), 1);
    assert.match(t.errs.join("\n"), /usage: tiancha research proposal <generate\|list\|get>/);
    assert.equal(await run(t.deps, "company", "delete", "x"), 1);
    assert.match(t.errs.join("\n"), /usage: tiancha research company <add\|list\|get>/);
  });

  test("every verb rejects ANY non-whitelisted flag — not just --force", async () => {
    const t = await setupCli();
    await run(t.deps, "company", "add", INDUSTRY, "--name", "戊", "--kinds", "头部客户");
    const companyId = t.repo.listCompanies(t.sid)[0].companyId;
    await run(t.deps, "proposal", "generate", INDUSTRY);
    const proposalRef = t.repo.listTargetProposals(t.sid)[0].proposalRef;
    assert.ok(companyId && proposalRef, "fixtures exist");

    const cases: Array<[string, string[]]> = [
      ["company add --force", ["company", "add", INDUSTRY, "--name", "X", "--kinds", "头部客户", "--force"]],
      ["company add --rebuild", ["company", "add", INDUSTRY, "--name", "X", "--kinds", "头部客户", "--rebuild"]],
      ["company list --force", ["company", "list", INDUSTRY, "--force"]],
      ["company list --name (not a list flag)", ["company", "list", INDUSTRY, "--name", "X"]],
      ["company get --force", ["company", "get", companyId, "--force"]],
      ["company get --name (cross-verb flag)", ["company", "get", companyId, "--name", "X"]],
      ["proposal generate --force", ["proposal", "generate", INDUSTRY, "--force"]],
      ["proposal list --status", ["proposal", "list", INDUSTRY, "--status"]],
      ["proposal list --status=proposed", ["proposal", "list", INDUSTRY, "--status=proposed"]],
      ["proposal list --status=nonsense", ["proposal", "list", INDUSTRY, "--status=nonsense"]],
      ["proposal get --force", ["proposal", "get", proposalRef, "--force"]],
      ["proposal get --gap (not a get flag)", ["proposal", "get", proposalRef, "--gap", "x"]],
    ];
    for (const [label, argv] of cases) {
      t.errs.length = 0;
      const code = await run(t.deps, ...argv);
      assert.equal(code, 1, `${label} must be rejected`);
      assert.match(t.errs.join("\n"), /不支持的参数/, `${label} must report the offending flag`);
    }

    // Whitelisted flags still work (the guard must not over-reject).
    assert.equal(await run(t.deps, "company", "list", INDUSTRY, "--json"), 0);
    assert.equal(await run(t.deps, "company", "get", companyId, "--json"), 0);
    assert.equal(await run(t.deps, "proposal", "list", INDUSTRY, "--json"), 0);
    assert.equal(await run(t.deps, "proposal", "generate", INDUSTRY, "--gap", "no-such-gap", "--json"), 0);
    assert.equal(await run(t.deps, "proposal", "get", proposalRef, "--json"), 0);

    // A rejected command must not have written anything.
    assert.equal(t.repo.listCompanies(t.sid).length, 1, "no extra company");
    assert.equal(t.repo.listTargetProposals(t.sid).length, 1, "no extra proposal");
    assert.equal(t.repo.listTargets(t.sid).length, 0, "and still no research target");
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
