/**
 * Phase B v1 · Step B5 — CLI exposure of the research-planning chain.
 *
 * Everything runs through the REAL composition seam (in-memory db + temp dir), so these
 * tests exercise the same handlers production uses — not a re-implementation.
 *
 *   T-B24 `research chain` makes B1's projection REACHABLE, and re-running it is idempotent
 *   T-B25 `research need` is a read-only derivation (Gap/Requirement/Priority unchanged),
 *         and its `whyStudyNotJustFetch` is drawn from the closed enum
 *   T-B26 `research target list` carries the read-only fit counts, and writes nothing
 *   T-B27 `research diligence` generates + persists ONE preparation, idempotently, and
 *         refuses to guess a target or to accept another industry's target
 *   T-B29 scope self-check: no LLM / no external source / no new SoT in the B5 surface
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  WHY_STUDY_REASONS,
} from "@tiancha/research";
import {
  runResearchCommand,
  runTargetAdd,
  runTargetList,
  RESEARCH_SUBCOMMANDS,
  type ResearchCliDeps,
} from "./research-commands.js";

const INDUSTRY = "B5 CLI 行业";
const OTHER = "B5 其他行业";

const count = (db: ResearchDb, table: string) =>
  (db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n;

async function setupCli(industryName = INDUSTRY) {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName });
  const sid = res.industry.industryId;

  const dir = mkdtempSync(join(tmpdir(), "tiancha-b5-"));
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

/** Fingerprint of every source of truth B5 must NOT touch. */
function sotFingerprint(db: ResearchDb, repo: ResearchRepository, sid: string): string {
  return JSON.stringify({
    slots: repo.listPoolSlots(sid).map((s) => `${s.dimension}:${s.status}`).sort(),
    items: count(db, "information_pool_item"),
    gaps: repo.listGaps(sid).map((g) => `${g.gapId}:${g.status}:${g.gapType}`).sort(),
    requirements: repo.listRequirements(sid).map((r) => `${r.requirementId}:${r.importance}:${r.status}`).sort(),
    actions: repo.listNextActions(sid).map((a) => `${a.actionId}:${a.kind}:${a.priority}`).sort(),
    beliefs: count(db, "knowledge_belief"),
    conflicts: count(db, "knowledge_conflict"),
    evaluations: count(db, "investment_evaluation"),
    materials: count(db, "material"),
    stateVersion: repo.getStateBySubject("industry", sid)?.version ?? 0,
  });
}

describe("Phase B · Step B5 · CLI (chain / need / target / diligence)", () => {
  test("T-B24: `research chain` is the production entry of B1's projection, and it is idempotent", async () => {
    const { db, repo, sid, lines, deps } = await setupCli();
    try {
      // The ingest pipeline does NOT project (otherwise the chain would appear by magic).
      assert.equal(count(db, "research_position"), 0, "no position before the chain command");
      const before = sotFingerprint(db, repo, sid);

      lines.length = 0;
      assert.equal(await runResearchCommand("chain", [INDUSTRY], deps), 0);
      const human = lines.join("\n");
      assert.match(human, /调研链条（模板实例 chain-template-general@v1/);
      assert.match(human, /建议研究哪类对象：/);
      assert.match(human, /不是该行业客观存在的链条节点/);
      assert.equal(count(db, "research_position"), 6, "the 6 template positions that serve a requirement");

      // Re-running reproduces the same plan (stable refs, same content) and adds no rows.
      const refsOf = () => repo.listPositions(sid).map((p) => p.positionRef).sort();
      const first = refsOf();
      const contentOf = () =>
        repo
          .listPositions(sid)
          .map((p) => `${p.positionRef}|${p.label}|${p.importance}|${p.satisfiesRequirementRefs.join(",")}`)
          .sort();
      const firstContent = contentOf();

      lines.length = 0;
      assert.equal(await runResearchCommand("chain", [INDUSTRY, "--json"], deps), 0);
      const parsed = JSON.parse(lines.join("\n"));
      assert.deepEqual(parsed.positions.map((p: any) => p.positionRef).sort(), first, "stable identity");
      assert.deepEqual(refsOf(), first, "no duplicate rows");
      assert.deepEqual(contentOf(), firstContent, "the projected plan does not drift");
      assert.equal(count(db, "research_position"), 6);
      assert.deepEqual(parsed.skipped, [], "every v1 template position serves a requirement");
      // `--json` is the raw service result, so it matches what was persisted (the DB read
      // is ordered by ref; compare as a set).
      assert.deepEqual(
        [...parsed.positions].sort((a: any, b: any) => (a.positionRef < b.positionRef ? -1 : 1)),
        repo.listPositions(sid),
      );

      // Projecting a plan never touches a source of truth.
      assert.equal(sotFingerprint(db, repo, sid), before, "positions are a projection, not truth");
    } finally {
      rmSync(deps.reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("T-B25: `research need` is a read-only derivation whose explanation comes from the closed enum", async () => {
    const { db, repo, sid, lines, deps } = await setupCli();
    try {
      const before = sotFingerprint(db, repo, sid);

      // Before the chain exists, we cannot name a serving position — and we say so.
      lines.length = 0;
      assert.equal(await runResearchCommand("need", [INDUSTRY, "--json"], deps), 0);
      const unprojected = JSON.parse(lines.join("\n"));
      assert.equal(unprojected.chainProjected, false);
      assert.ok(
        unprojected.needs.every((n: any) => n.suggestedPositionRefs.length === 0),
        "no chain ⇒ no serving position is claimed",
      );

      await runResearchCommand("chain", [INDUSTRY], deps);

      lines.length = 0;
      assert.equal(await runResearchCommand("need", [INDUSTRY, "--json"], deps), 0);
      const view = JSON.parse(lines.join("\n"));
      assert.equal(view.chainProjected, true);

      // The needs are EXACTLY the read-only service result (no second code path).
      const direct = new ResearchNeedService(db.db).list(sid);
      assert.deepEqual(view.needs, direct);
      assert.ok(direct.length > 0, "the fixture produces open needs");

      const priorities = new PriorityService(db.db).currentPriorities(sid);
      const requirements = new Map(repo.listRequirements(sid).map((r) => [r.requirementId, r]));
      for (const n of direct) {
        assert.equal(n.needId, n.gapId, "need identity is derived from the gap");
        assert.ok((WHY_STUDY_REASONS as readonly string[]).includes(n.whyStudyNotJustFetch), "closed enum only");
        assert.equal(n.question, requirements.get(n.requirementId)!.description, "question is the requirement text");
        assert.equal(n.suggestedPositionRefs.length > 0, true, "a projected chain serves it");
        assert.equal(n.priorityScore, priorities.find((p) => p.gapId === n.gapId)?.score ?? 0, "priority is READ, not recomputed");
      }

      // …and deriving needs changes no source of truth (I-B6).
      assert.equal(sotFingerprint(db, repo, sid), before, "needs are derived, never written back");
    } finally {
      rmSync(deps.reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("T-B26: `research target list` shows the read-only fit counts and writes nothing", async () => {
    const { db, repo, sid, lines, deps } = await setupCli();
    try {
      await runResearchCommand("chain", [INDUSTRY], deps);
      const position = repo.listPositions(sid).find((p) => p.kind === "expert")!;
      assert.equal(
        await runTargetAdd(
          [
            INDUSTRY,
            "--kind",
            position.suggestedTargetKinds[0]!,
            "--name",
            "B5 专家甲",
            "--position",
            position.positionRef,
            "--purpose",
            "判断技术路线",
            "--reason",
            "资深从业者",
          ],
          { json: false },
          deps,
        ),
        0,
      );

      const before = sotFingerprint(db, repo, sid);
      const targetsBefore = count(db, "research_target");

      lines.length = 0;
      assert.equal(await runTargetList(INDUSTRY, { json: false }, deps), 0);
      const human = lines.join("\n");
      assert.match(human, /研究对象（1）/);
      assert.match(human, /适配：强 \d+ \/ 部分 \d+ \/ 弱 \d+ \/ 无 \d+/);
      assert.match(human, /需备选对象 \d+/);

      lines.length = 0;
      assert.equal(await runTargetList(INDUSTRY, { json: true }, deps), 0);
      const views = JSON.parse(lines.join("\n"));
      const targetRef = repo.listTargets(sid)[0]!.targetRef;
      assert.deepEqual(views[0].target, repo.listTargets(sid)[0], "the target is echoed verbatim");
      assert.deepEqual(views[0].fit, new QuestionTargetFitService(db.db).summarize(targetRef), "fit counts are B3 aggregation");
      const total = views[0].fit.strong + views[0].fit.partial + views[0].fit.weak + views[0].fit.none;
      assert.equal(total, views[0].fit.questionCount, "every question lands in exactly one bucket");

      assert.equal(count(db, "research_target"), targetsBefore, "listing writes no target");
      assert.equal(sotFingerprint(db, repo, sid), before, "listing touches no source of truth");
    } finally {
      rmSync(deps.reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("T-B27: `research diligence` assembles ONE preparation, idempotently, for a human-confirmed target", async () => {
    const { db, repo, sid, lines, deps, svc } = await setupCli();
    try {
      await runResearchCommand("chain", [INDUSTRY], deps);
      const position = repo.listPositions(sid).find((p) => p.kind === "customer")!;

      // Without `--target` nothing is generated: no target is ever guessed for the user.
      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY], deps), 0);
      assert.match(lines.join("\n"), /暂无/);
      assert.equal(count(db, "diligence_preparation"), 0, "no outline without a confirmed target");

      assert.equal(
        await runTargetAdd(
          [
            INDUSTRY,
            "--kind",
            position.suggestedTargetKinds[0]!,
            "--name",
            "B5 客户甲",
            "--position",
            position.positionRef,
            "--purpose",
            "验证采购意愿",
            "--reason",
            "行业头部采购方",
          ],
          { json: false },
          deps,
        ),
        0,
      );
      const targetRef = repo.listTargets(sid)[0]!.targetRef;
      const before = sotFingerprint(db, repo, sid);

      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY, "--target", targetRef], deps), 0);
      const human = lines.join("\n");
      assert.match(human, /调研准备（draft）：B5 客户甲/);
      assert.match(human, /\[common\]/);
      assert.match(human, /\[target_specific\]/);
      assert.equal(count(db, "diligence_preparation"), 1, "exactly one preparation row");

      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY, "--target", targetRef, "--json"], deps), 0);
      const first = JSON.parse(lines.join("\n"));
      assert.equal(first.preparationRef, `dp-${targetRef}`);
      assert.deepEqual(first.questions, new DiligencePreparationService(db.db).get(`dp-${targetRef}`)!.questions);

      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY, "--target", targetRef, "--json"], deps), 0);
      const second = JSON.parse(lines.join("\n"));
      assert.deepEqual(second, first, "regeneration is deterministic");
      assert.equal(count(db, "diligence_preparation"), 1, "no duplicate rows");

      assert.equal(sotFingerprint(db, repo, sid), before, "assembling an outline writes only its own row");

      // usage / unknown target / another industry's target all fail loudly, writing nothing.
      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [], deps), 1);
      assert.ok(lines.some((l) => l.startsWith("ERR:usage:")));

      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY, "--target", "tgt-nope"], deps), 1);
      assert.ok(lines.some((l) => l.includes("未找到研究对象")));

      // …and a target confirmed for ANOTHER industry must be refused, writing nothing.
      const other = await svc.ingestMaterial({ materialText: "x", industryName: OTHER });
      const otherSid = other.industry.industryId;
      await runResearchCommand("chain", [OTHER], deps);
      const otherPosition = repo.listPositions(otherSid).find((p) => p.kind === "customer")!;
      assert.equal(
        await runTargetAdd(
          [
            OTHER,
            "--kind",
            otherPosition.suggestedTargetKinds[0]!,
            "--name",
            "别行业的对象",
            "--position",
            otherPosition.positionRef,
            "--purpose",
            "p",
            "--reason",
            "r",
          ],
          { json: false },
          deps,
        ),
        0,
      );
      const foreignRef = repo.listTargets(otherSid)[0]!.targetRef;

      lines.length = 0;
      assert.equal(await runResearchCommand("diligence", [INDUSTRY, "--target", foreignRef], deps), 1);
      assert.ok(lines.some((l) => l.includes("不属于行业")));
      assert.equal(count(db, "diligence_preparation"), 1, "nothing was written for the foreign target");
    } finally {
      rmSync(deps.reportDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("T-B29: the B5 CLI surface adds no LLM, no external source and no new SoT", () => {
    for (const sub of ["chain", "need", "diligence"]) {
      assert.ok((RESEARCH_SUBCOMMANDS as readonly string[]).includes(sub), `${sub} is routed`);
    }
    const source = readFileSync(new URL("./research-commands.ts", import.meta.url), "utf8");
    assert.ok(!/openai|anthropic|generateText|llm\(/i.test(source), "no model call in the CLI seam");
    assert.ok(!/fetch\(|https?:\/\//.test(source), "no external data source in the CLI seam");
    assert.ok(!/EvidenceAssertion|DocumentFragment/.test(source), "B5 introduces no Evidence-layer model");
    // The target write path stays exactly where B2 put it (human CLI only).
    assert.ok(!/research_target_add|target.*createdBy.*agent/i.test(source), "no agent-side target write");
  });
});
