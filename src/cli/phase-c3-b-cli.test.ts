/**
 * Phase C · Step C3-B — CLI consumer consistency (T-C3-17).
 *
 * Contract: `docs/phaseC/c3-implementation-contract.md` §5.3 / §10.3（出口原则：只读 observability）
 *   T-C3-17  CLI `research priority --json` **就是** `PriorityService.currentPriorities()` ——
 *            逐字段一致，且**不重算**（篡改 persisted 值后 CLI 跟随）。
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
} from "@tiancha/research";
import { runResearchCommand, type ResearchCliDeps } from "./research-commands.js";

const INDUSTRY = "C3-B CLI 行业";

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;

  const dir = mkdtempSync(join(tmpdir(), "tiancha-c3b-"));
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
    plans: new ResearchPlanService(db.db),
    reportDir: dir,
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR:${l}`),
  };
  return { db, repo, sid, dir, lines, deps };
}

describe("Phase C3-B · CLI priority == the read face", () => {
  test("T-C3-17: `research priority --json` IS currentPriorities(), field for field", async () => {
    const { db, repo, sid, dir, lines, deps } = await setupCli();
    try {
      lines.length = 0;
      assert.equal(await runResearchCommand("priority", [INDUSTRY, "--json"], deps), 0);
      const parsed = JSON.parse(lines.join("\n"));
      const direct = new PriorityService(db.db).currentPriorities(sid);
      assert.ok(direct.length > 0, "the fixture has persisted priorities");
      assert.deepEqual(parsed, direct, "the CLI emits exactly the read face's value");

      // ★ …and it is not a recomputation: tamper ONE persisted row and the CLI must FOLLOW it
      const row = repo.listNextActions(sid).find((a) => a.status === "open")!;
      const gapId = row.params.gapId as string;
      repo.upsertNextAction({
        ...row,
        priority: 11,
        rationale: "tampered",
        params: { ...row.params, priorityPolicyVersionId: "prio-TAMPERED" },
      });

      lines.length = 0;
      assert.equal(await runResearchCommand("priority", [INDUSTRY, "--json"], deps), 0);
      const after = JSON.parse(lines.join("\n")) as Array<{ gapId: string; score: number; policyVersionId: string; rationale: string }>;
      const tampered = after.find((p) => p.gapId === gapId)!;
      assert.equal(tampered.score, 11, "T-C3-17: the CLI shows the PERSISTED score");
      assert.equal(tampered.policyVersionId, "prio-TAMPERED", "…and the PERSISTED policy version");
      assert.equal(tampered.rationale, "tampered", "…and the PERSISTED rationale");
      // the other rows are unaffected
      assert.deepEqual(
        after.filter((p) => p.gapId !== gapId).map((p) => p.score),
        direct.filter((p) => p.gapId !== gapId).map((p) => p.score),
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("T-C3-17b: an unknown industry fails loudly and writes nothing", async () => {
    const { db, repo, sid, dir, lines, deps } = await setupCli();
    try {
      const fingerprint = () => JSON.stringify(repo.listNextActions(sid));
      const before = fingerprint();
      lines.length = 0;
      assert.equal(await runResearchCommand("priority", ["不存在的行业ZZZ", "--json"], deps), 1);
      assert.ok(lines.some((l) => l.startsWith("ERR:")), "it fails loudly");
      assert.equal(fingerprint(), before, "no write happened");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
