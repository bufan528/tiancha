/**
 * Phase C2 · Step 2-A — CLI coverage exposure.
 *
 * T-C2-36: `research chain`'s active/all coverage comes from the SHARED predicate (the same one
 * `need` and `fit` use) and never falls back to "all positions" when everything has converged.
 * Everything runs through the REAL composition seam (in-memory db + temp dir).
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
  ActiveRequirementResolver,
} from "@tiancha/research";
import type { PositionCoverage } from "@tiancha/research";
import { runResearchCommand, type ResearchCliDeps } from "./research-commands.js";

const INDUSTRY = "C2 Step2A CLI 行业";

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;

  const dir = mkdtempSync(join(tmpdir(), "tiancha-c2-step2a-"));
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

describe("Phase C2 · Step 2-A · CLI coverage", () => {
  test("T-C2-36 (CLI): `research chain` reports active/all from the SHARED predicate", async () => {
    const { db, repo, sid, dir, lines, deps, svc } = await setupCli();
    try {
      lines.length = 0;
      assert.equal(await runResearchCommand("chain", [INDUSTRY], deps), 0);
      const human = lines.join("\n");

      // ① one coverage line per projected position, each aligned with the position printed above it
      const rows = [...human.matchAll(/服务缺口：active (\d+) \/ all (\d+)/g)].map((m) => ({
        active: Number(m[1]),
        all: Number(m[2]),
      }));
      const positions = repo.listPositions(sid);
      assert.ok(positions.length > 0);
      assert.equal(rows.length, positions.length, "one coverage line per projected position");

      // ② `--json` carries the same derivation, ALIGNED to the projected order
      lines.length = 0;
      assert.equal(await runResearchCommand("chain", [INDUSTRY, "--json"], deps), 0);
      const parsed = JSON.parse(lines.join("\n"));
      assert.equal(parsed.coverage.length, positions.length);
      parsed.coverage.forEach((cov: PositionCoverage, i: number) => {
        assert.equal(cov.positionRef, parsed.positions[i].positionRef, "coverage aligns with positions");
        assert.equal(rows[i]!.active, cov.activeRequirementRefs.length, "the human line matches the JSON view");
        assert.equal(rows[i]!.all, cov.allRequirementRefs.length);
      });
      // `all` agrees with the capability count printed on the line above (one number, not two)
      assert.ok(human.includes(`服务问题数：${parsed.coverage[0].allRequirementRefs.length}`));

      // ③ the SAME predicate drives `need`: converging a gap shrinks both
      const activeBefore = rows.reduce((s, r) => s + r.active, 0);
      const needsBefore = deps.needs.list(sid).length;
      await svc.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "market A", dimension: "market" }],
      });
      const activeAfter = deps.chain
        .positionCoverage(sid)
        .reduce((s, c) => s + c.activeRequirementRefs.length, 0);
      assert.ok(activeAfter < activeBefore, "coverage shrank after the gap converged");
      assert.ok(deps.needs.list(sid).length < needsBefore, "`need` follows the same predicate");

      // ④ everything converged: active is 0, `all` untouched — NEVER a fallback to the full set
      const allBefore = deps.chain.positionCoverage(sid).map((c) => c.allRequirementRefs.length);
      for (const gap of repo.listGaps(sid)) repo.upsertGap({ ...gap, status: "resolved" });
      const zeroed = deps.chain.positionCoverage(sid);
      assert.deepEqual(
        zeroed.map((c) => c.allRequirementRefs.length),
        allBefore,
        "capability refs are untouched",
      );
      assert.equal(zeroed.reduce((s, c) => s + c.activeRequirementRefs.length, 0), 0);
      assert.equal(ActiveRequirementResolver.activeGaps(repo.listGaps(sid)).length, 0);
      assert.equal(deps.needs.list(sid).length, 0);

      lines.length = 0;
      assert.equal(await runResearchCommand("chain", [INDUSTRY], deps), 0);
      assert.match(lines.join("\n"), /服务缺口：active 0 \/ all \d+/);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
