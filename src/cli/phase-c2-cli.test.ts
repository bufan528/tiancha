/**
 * Phase C2 · Step 1 · CLI current projection.
 *
 * I-C2-12: every "current" output (outline, list, JSON export, counts) derives ONLY from
 * `questions.filter(q => q.state === "current")`; retired questions are counted, never listed.
 * Everything runs through the REAL composition seam (in-memory db + temp dir).
 *
 *   C2-CLI-1  `research diligence` shows the CURRENT outline + a history count, and `--json`
 *             exposes the current projection only
 *   C2-CLI-2  `--all` is the explicit audit mode (and the default never silently falls back)
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
  currentQuestions,
  retiredQuestions,
} from "@tiancha/research";
import {
  runResearchCommand,
  runTargetAdd,
  type ResearchCliDeps,
} from "./research-commands.js";

const INDUSTRY = "C2 CLI 行业";

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;

  const dir = mkdtempSync(join(tmpdir(), "tiancha-c2-"));
  const lines: string[] = [];
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
    reportDir: dir,
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR:${l}`),
  };
  return { db, repo, sid, dir, lines, deps, svc };
}

/** A human-confirmed target on the industry's `customer` position. */
async function withTarget(deps: ResearchCliDeps, repo: ResearchRepository, sid: string): Promise<string> {
  await runResearchCommand("chain", [INDUSTRY], deps);
  const position = repo.listPositions(sid).find((p) => p.kind === "customer")!;
  await runTargetAdd(
    [
      INDUSTRY,
      "--kind",
      position.suggestedTargetKinds[0]!,
      "--name",
      "C2 客户甲",
      "--position",
      position.positionRef,
      "--purpose",
      "验证采购意愿",
      "--reason",
      "行业头部采购方",
    ],
    { json: false },
    deps,
  );
  return repo.listTargets(sid)[0]!.targetRef;
}

describe("Phase C2 · Step 1 · CLI current projection", () => {
  test("C2-CLI-1: the CLI shows the CURRENT outline only, and counts history", async () => {
    const { db, repo, sid, dir, lines, deps, svc } = await setupCli();
    try {
      const targetRef = await withTarget(deps, repo, sid);

      // ① first run: everything is current, so no history is reported
      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY, "--target", targetRef], deps), 0);
      const first = lines.join("\n");
      const m = first.match(/问题清单（当前 (\d+)/);
      assert.ok(m, "the outline reports its CURRENT count");
      const firstCurrent = Number(m![1]);
      assert.ok(firstCurrent > 0);
      assert.ok(!/历史问题/.test(first), "nothing has converged yet");

      // ② converge `market` through the EXISTING pipeline ⇒ its questions become history
      await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market A", dimension: "market" }],
      });

      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY, "--target", targetRef], deps), 0);
      const human = lines.join("\n");
      const m2 = human.match(/问题清单（当前 (\d+) · 历史问题 (\d+)（已收敛））/);
      assert.ok(m2, "the outline reports current + history");

      const stored = new DiligencePreparationService(db.db).get(`dp-${targetRef}`)!;
      assert.equal(Number(m2![1]), currentQuestions(stored.questions).length);
      assert.equal(Number(m2![2]), retiredQuestions(stored.questions).length);
      assert.ok(Number(m2![2]) > 0, "the converged requirement's questions became history");
      assert.ok(Number(m2![1]) < firstCurrent, "…and left the current outline");

      // retired questions are never listed (they only show up as a count)
      for (const q of retiredQuestions(stored.questions)) {
        assert.ok(!human.includes(q.text), `a retired question must not be shown: ${q.text}`);
      }

      // ③ `--json` exposes the CURRENT projection only, plus explicit counts
      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY, "--target", targetRef, "--json"], deps), 0);
      const view = JSON.parse(lines.join("\n"));
      assert.equal(view.questions.length, view.currentQuestionCount);
      assert.ok(view.questions.every((q: { state: string }) => q.state === "current"));
      assert.equal(view.currentQuestionCount + view.retiredQuestionCount, stored.questions.length);
      assert.ok(view.retiredQuestionCount > 0);

      // ④ the list view counts current only as well
      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY], deps), 0);
      assert.match(lines.join("\n"), /当前问题 \d+（历史问题 \d+）/);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("C2-CLI-2: `--all` is the explicit audit mode and never an implicit fallback", async () => {
    const { db, repo, sid, dir, lines, deps } = await setupCli();
    try {
      const targetRef = await withTarget(deps, repo, sid);

      lines.length = 0;
      assert.equal(
        await runResearchCommand("diligence", [INDUSTRY, "--target", targetRef, "--json"], deps),
        0,
      );
      const scoped = JSON.parse(lines.join("\n"));

      // converge EVERY gap: the default scope is now empty — and it must stay empty
      for (const gap of repo.listGaps(sid)) repo.upsertGap({ ...gap, status: "resolved" });
      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY, "--target", targetRef], deps), 0);
      const empty = lines.join("\n");
      assert.match(empty, /问题清单（当前 0/);
      assert.match(empty, /（当前无待问问题：相关缺口已收敛）/);

      // the explicit audit mode covers every requirement again
      lines.length = 0;
      assert.equal(
        await runResearchCommand("diligence", [INDUSTRY, "--target", targetRef, "--all", "--json"], deps),
        0,
      );
      const audited = JSON.parse(lines.join("\n"));
      assert.equal(audited.currentQuestionCount, scoped.currentQuestionCount);
      assert.ok(audited.currentQuestionCount > 0, "--all restores the full requirement set");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
