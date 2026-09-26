/**
 * Phase C · Step C3-B — cross-consumer consistency + boundary / regression verification.
 *
 * Contract: `docs/phaseC/c3-implementation-contract.md`（C3 Contract Gate PASS, rev2）
 *   §5.2 驱动链其余段 · §5.3 读取面与消费者一致性 · §5.4 边界与静态审计
 *   §7.3 证据强度：Layer 1（静态结构）+ Layer 2（本文件）
 *
 *   T-C3-14 读取面永不重算（① 注入偏离 policy ② 篡改 persisted 值）
 *   T-C3-15 无 breakdown 的 action 被跳过而非伪造
 *   T-C3-16 cancelled / done 不进入读取面
 *   T-C3-19 priorityPolicyVersionId 在 action 行 / Priority view / Report 三处一致
 *   T-C3-20 C2 Plan 的展示 == persisted 行（不重算）
 *   T-C3-21 ★ 生产调用点审计：rank() 只能出现在既有写入路径；消费者一律 currentPriorities()
 *   T-C3-22 24 表基线不变 + 静态边界（无 LLM / 无 legacy / 无新写路径）
 *
 * 出口范围（Gate §9.2-2 选项 A）：**不新增任何出口** —— C3-B 只验证既有消费者
 * （CLI `research priority` / Agent `research_priority` / Report / C2 Plan）。
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { PriorityService } from "./application/priority-service.js";
import { ReportService } from "./application/report-service.js";
import { ResearchPlanService } from "./application/research-plan-service.js";
import { PRIORITY_POLICY_V1 } from "./domain/priority-policy.js";

/** The 24-table baseline frozen by the C3 contract §7.4. */
const TABLES_24 = [
  "company",
  "diligence_preparation",
  "human_gate",
  "industry",
  "industry_knowledge",
  "information_pool_entry",
  "information_pool_item",
  "information_pool_slot",
  "information_requirement",
  "investment_evaluation",
  "knowledge_belief",
  "knowledge_conflict",
  "material",
  "methodology",
  "methodology_candidate",
  "next_action",
  "report_snapshot",
  "research_document",
  "research_gap",
  "research_position",
  "research_question",
  "research_source",
  "research_state",
  "research_target",
  "target_proposal",
  "target_proposal_decision",
] as const;

/** A rich, real-chain fixture: a full ingest produces 12 gaps + persisted priorities. */
async function seed() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: "C3-B 验证行业" });
  return { db, repo, sid: res.industry.industryId };
}

/** Any open action row (the write path always leaves the breakdown + policy version on it). */
const openAction = (repo: ResearchRepository, sid: string) =>
  repo.listNextActions(sid).find((a) => a.status === "open")!;

const gapIdOf = (a: { params: Record<string, unknown> }) => a.params.gapId as string;

describe("Phase C3-B · Priority read face + consumers (consistency)", () => {
  test("T-C3-14: the read face NEVER recomputes — proven by policy injection AND tampering", async () => {
    const { db, repo, sid } = await seed();
    try {
      const persisted = new PriorityService(db.db).currentPriorities(sid);
      assert.ok(persisted.length > 0, "S5 has persisted priorities");

      // ① an injected policy that WOULD produce different scores …
      const extreme = new PriorityService(db.db, {
        ...PRIORITY_POLICY_V1,
        versionId: "prio-c3b-extreme",
        weights: {
          importance: 1,
          criticality: 0,
          uncertainty: 0,
          coverageGap: 0,
          acquisitionValue: 0,
          acquisitionCost: 0,
        },
      });
      const persistedByGap = new Map(persisted.map((p) => [p.gapId, p.score]));
      const wouldDiffer = extreme.rank(sid).filter((p) => persistedByGap.get(p.gapId) !== p.score);
      assert.ok(
        wouldDiffer.length > 0,
        "the injected policy really WOULD differ (otherwise this assertion would be vacuous)",
      );

      // …yet the read face still reports the PERSISTED values and the PERSISTED policy version
      const view = new PriorityService(db.db).currentPriorities(sid);
      assert.deepEqual(
        view.map((p) => [p.gapId, p.score, p.policyVersionId]),
        persisted.map((p) => [p.gapId, p.score, p.policyVersionId]),
        "the read face is identical before/after the injection",
      );
      for (const p of view) {
        assert.equal(p.policyVersionId, PRIORITY_POLICY_V1.versionId);
        assert.notEqual(p.policyVersionId, "prio-c3b-extreme", "…and never the injected version");
      }

      // ② tampering: rewrite ONE persisted score to a value no policy could produce
      const target = openAction(repo, sid);
      const tamperedGap = gapIdOf(target);
      repo.upsertNextAction({
        ...target,
        priority: 7,
        params: { ...target.params, priorityPolicyVersionId: "prio-TAMPERED" },
      });
      const after = new PriorityService(db.db)
        .currentPriorities(sid)
        .find((p) => p.gapId === tamperedGap)!;
      assert.equal(after.score, 7, "T-C3-14: the view shows the PERSISTED score, not a recomputation");
      assert.equal(after.policyVersionId, "prio-TAMPERED", "…and the PERSISTED policy version");
      // …and the untampered rows are untouched by the injection/tampering
      const others = new PriorityService(db.db)
        .currentPriorities(sid)
        .filter((p) => p.gapId !== tamperedGap);
      assert.deepEqual(
        others.map((p) => [p.gapId, p.score]),
        persisted.filter((p) => p.gapId !== tamperedGap).map((p) => [p.gapId, p.score]),
      );
    } finally {
      db.close();
    }
  });

  test("T-C3-15: an action without a persisted breakdown is SKIPPED — never fabricated", async () => {
    const { db, repo, sid } = await seed();
    try {
      const target = openAction(repo, sid);
      const gapId = gapIdOf(target);
      assert.ok(
        new PriorityService(db.db).currentPriorities(sid).some((p) => p.gapId === gapId),
        "baseline: present",
      );

      const { priorityBreakdown: _dropped, ...paramsWithoutBreakdown } = target.params as Record<
        string,
        unknown
      >;
      repo.upsertNextAction({ ...target, params: paramsWithoutBreakdown });

      const view = new PriorityService(db.db).currentPriorities(sid);
      assert.equal(
        view.some((p) => p.gapId === gapId),
        false,
        "T-C3-15: the row is skipped, not reconstructed",
      );
      // nothing fake appeared in its place (no phantom zero-score entry)
      assert.equal(view.filter((p) => p.gapId === gapId).length, 0);
      assert.equal(view.filter((p) => p.score === 0).length, 0, "no fabricated 0-score line");
    } finally {
      db.close();
    }
  });

  test("T-C3-16: only `open` actions are current priorities", async () => {
    const { db, repo, sid } = await seed();
    try {
      const target = openAction(repo, sid);
      const gapId = gapIdOf(target);
      const has = () => new PriorityService(db.db).currentPriorities(sid).some((p) => p.gapId === gapId);

      assert.equal(has(), true, "baseline: open ⇒ visible");
      for (const status of ["cancelled", "done"] as const) {
        repo.upsertNextAction({ ...target, status });
        assert.equal(has(), false, `T-C3-16: ${status} ⇒ NOT a current priority`);
      }
      repo.upsertNextAction({ ...target, status: "open" });
      assert.equal(has(), true, "back to open ⇒ visible again");
    } finally {
      db.close();
    }
  });

  test("T-C3-19: priorityPolicyVersionId agrees across the row, the read face and the Report", async () => {
    const { db, repo, sid } = await seed();
    try {
      const row = openAction(repo, sid);
      const gapId = gapIdOf(row);
      const rowVersion = row.params.priorityPolicyVersionId;

      const view = new PriorityService(db.db).currentPriorities(sid).find((p) => p.gapId === gapId)!;
      const dossier = new ReportService(db.db).generateDossier(sid);
      const line = dossier.sections.priority.find((p) => p.gapId === gapId)!;

      assert.equal(view.policyVersionId, rowVersion, "read face == persisted row");
      assert.equal(line.policyVersionId, rowVersion, "Report == persisted row");
      assert.equal(view.score, row.priority, "read face score == persisted score");
      assert.equal(line.score, row.priority, "Report score == persisted score");
      assert.equal(view.score, line.score, "the two consumers agree");
    } finally {
      db.close();
    }
  });

  test("T-C3-20: the C2 plan shows the PERSISTED values (and follows tampering, not a recompute)", async () => {
    const { db, repo, sid } = await seed();
    try {
      const plans = new ResearchPlanService(db.db);
      const before = plans.build(sid);

      // every plan gap's score must equal its persisted row (no recomputation on the show path)
      for (const gap of before.gaps) {
        const row = repo.listNextActions(sid).find((a) => a.params?.gapId === gap.gapId);
        if (!row) continue; // a gap without an action shows the "no persisted priority" state
        assert.equal(gap.priorityScore, row.priority, "plan gap score == persisted row score");
        assert.equal(gap.priorityPolicyVersionId, row.params.priorityPolicyVersionId);
      }

      // tampering method: rewrite a persisted score; the plan must FOLLOW it
      const row = openAction(repo, sid);
      const gapId = gapIdOf(row);
      repo.upsertNextAction({ ...row, priority: 3 });
      const after = plans.build(sid).gaps.find((g) => g.gapId === gapId)!;
      assert.equal(after.priorityScore, 3, "T-C3-20: the plan reflects the PERSISTED value");
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// §5.4 boundary + static audit
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "vendor" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("Phase C3-B · boundary + static audit (§5.4)", () => {
  test("T-C3-21 ★: rank() has ONE production caller — the write path; consumers read the read face", () => {
    const files = [...walk(join(ROOT, "packages/research/src")), ...walk(join(ROOT, "src"))];
    const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

    // ★ I-C3-8: the computation face may only be called from the existing persist write path.
    const rankCallers = files.filter((f) => /\.rank\(/.test(readFileSync(f, "utf8"))).map(rel).sort();
    assert.deepEqual(
      rankCallers,
      ["packages/research/src/application/knowledge-projection-service.ts"],
      "rank() must have exactly one production caller (the S5 write path)",
    );

    // …and every consumer goes through the read-only face instead.
    const readCallers = files.filter((f) => /currentPriorities\(/.test(readFileSync(f, "utf8"))).map(rel);
    for (const expected of [
      "packages/research/src/application/report-service.ts",
      "packages/research/src/application/research-need-service.ts",
      "packages/research/src/application/question-target-fit-service.ts",
      "src/cli/research-commands.ts",
      "src/agent/research-tools.ts",
    ]) {
      assert.ok(readCallers.includes(expected), `${expected} must consume currentPriorities()`);
    }
  });

  test("T-C3-22: the 24-table baseline holds, and the consumer chain has no write path / LLM / legacy surface", async () => {
    const { db } = await seed();
    try {
      const tables = (
        db.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all() as { name: string }[]
      )
        .map((r) => r.name)
        .sort();
      assert.deepEqual(tables, [...TABLES_24].sort(), "exactly the frozen 24-table baseline");
    } finally {
      db.close();
    }

    // ★ static: the CONSUMER chain (the read faces + the plan projection) must stay free of
    //   writes / LLM / legacy surfaces. The one file deliberately NOT in this set is
    //   `knowledge-projection-service.ts` — it is the single legal refresh/persist write path.
    const consumers = [
      "packages/research/src/application/priority-service.ts",
      "packages/research/src/application/report-service.ts",
      "packages/research/src/application/research-plan-service.ts",
    ];
    const banned: Array<[string, RegExp]> = [
      ["a model call", /\bopenai\b|\banthropic\b|\bgpt-/i],
      ["a network call", /\bfetch\(|https?:\/\//],
      ["the legacy plans json", /plans\.json/],
      ["a legacy server/store module", /\bserver\.ts\b|\bstore\.ts\b/],
      ["a SoT write verb", /upsertNextAction\(|upsertGap\(|upsertMethodology\(/],
    ];
    for (const rel of consumers) {
      const body = readFileSync(join(ROOT, rel), "utf8");
      for (const [label, pattern] of banned) {
        assert.ok(!pattern.test(body), `${rel} must not contain ${label}`);
      }
    }
  });

  test("T-C3-22b: `ResearchPlanView` is a projection — C3-B does not persist anything new", async () => {
    const { db, repo, sid } = await seed();
    try {
      const tables = () =>
        JSON.stringify(
          (db.db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all() as { name: string }[]).map((r) => r.name),
        );
      const before = tables();
      new ResearchPlanService(db.db).build(sid); // pure read
      new PriorityService(db.db).currentPriorities(sid);
      new ReportService(db.db).generateDossier(sid); // appends a projection snapshot only
      assert.ok(tables() === before, "no table appeared/disappeared");
      assert.ok(repo.listNextActions(sid).length > 0);
    } finally {
      db.close();
    }
  });
});
