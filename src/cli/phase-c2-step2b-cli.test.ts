/**
 * Phase C2 · Step 2-B — Target Linkage Closure (`--for-gap`).
 *
 * Authorized scope: `Gap → gap.relatedRequirementIds → Target.relatedRequirementRefs` through the
 * ONLY writer (CLI `target add --for-gap`), plus the read-only `target list` link display.
 * Step 2-C (the plan builder) is NOT part of this stage.
 *
 *   T-C2-4   linking works (single / multiple / empty-requirement gap) and is displayed
 *   T-C2-5   linking never mutates a Gap (fingerprint)
 *   T-C2-37  refs are deterministic; repeated runs and repeated gapIds change nothing
 *   T-C2-39  the stored refs support the frozen `TargetsForGap(G)` derivation (multi-Gap, empty)
 *   T-C2-40  ① invalid / cross-industry gap ⇒ zero mutation; ② persistence failure ⇒ no partial update
 *   C′       existing + --for-gap only changes `relatedRequirementRefs`; conflicting args are
 *            REFUSED (never silently swallowed); link-only may omit the create args (Q7a)
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
  targetRefFor,
} from "@tiancha/research";
import { runTargetAdd, runTargetList, type ResearchCliDeps } from "./research-commands.js";

const INDUSTRY = "C2 Step2B 行业";
const OTHER = "C2 Step2B 其他行业";

async function setupCli() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  await svc.ingestMaterial({ materialText: "y", industryName: OTHER });

  const chain = new ChainProjectionService(db.db);
  chain.project(sid);
  const position = repo.listPositions(sid)[0]!;

  const dir = mkdtempSync(join(tmpdir(), "tiancha-c2-step2b-"));
  const lines: string[] = [];
  const deps: ResearchCliDeps = {
    repo,
    evaluation: new EvaluationService(db.db),
    priority: new PriorityService(db.db),
    reports: new ReportService(db.db),
    materials: new MaterialIngestService(repo, new EchoDataProvider(), artifacts),
    targets: new TargetService(db.db),
    chain,
    needs: new ResearchNeedService(db.db),
    fits: new QuestionTargetFitService(db.db),
    diligence: new DiligencePreparationService(db.db),
    reportDir: dir,
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR:${l}`),
  };
  return { db, repo, svc, sid, position, dir, lines, deps };
}

/** Full Target-row fingerprint: every field except the write timestamp. */
const targetFingerprint = (repo: ResearchRepository, industryId: string) =>
  JSON.stringify(
    repo
      .listTargets(industryId)
      .map((t) =>
        [
          t.targetRef,
          t.subjectKey,
          t.targetKind,
          t.positionRef,
          t.researchPurpose,
          t.selectionReason,
          String(t.expectedInformationValue),
          t.accessibility,
          t.limitations.join("|"),
          String(t.isFallback),
          String(t.fallbackForTargetRef),
          t.relatedRequirementRefs.join("|"),
          t.relatedQuestionRefs.join("|"),
          t.status,
          t.createdAt,
        ].join("::"),
      )
      .sort(),
  );

const gapFingerprint = (repo: ResearchRepository, industryId: string) =>
  JSON.stringify(
    repo
      .listGaps(industryId)
      .map((g) => `${g.gapId}:${g.status}:${g.gapType}:${g.updatedAt}:${g.relatedRequirementIds.join(",")}`)
      .sort(),
  );

const addArgs = (name: string, positionRef: string, extra: string[] = []) => [
  INDUSTRY,
  "--name",
  name,
  "--kind",
  "头部客户",
  "--position",
  positionRef,
  "--purpose",
  "验证需求真实性",
  "--reason",
  "行业头部采购方",
  ...extra,
];

const targetNamed = (repo: ResearchRepository, industryId: string, name: string) =>
  repo.listTargets(industryId).find((t) => t.subjectKey === name)!;

describe("Phase C2 · Step 2-B · Target linkage", () => {
  test("T-C2-4: `--for-gap` links requirement refs (single / extra gap / empty gap) and is shown", async () => {
    const { db, repo, sid, position, dir, lines, deps } = await setupCli();
    try {
      const gaps = repo.listGaps(sid);
      assert.ok(gaps.length >= 3, "fixture: several gaps");
      const [gapA, gapB, gapC] = [gaps[0]!, gaps[1]!, gaps[2]!];
      assert.ok(gapA.relatedRequirementIds.length > 0 && gapB.relatedRequirementIds.length > 0);

      // ① new target + --for-gap ⇒ refs == the gap's requirements
      lines.length = 0;
      assert.equal(await runTargetAdd(addArgs("对象甲", position.positionRef, ["--for-gap", gapA.gapId]), { json: false }, deps), 0);
      assert.deepEqual(targetNamed(repo, sid, "对象甲").relatedRequirementRefs, gapA.relatedRequirementIds);

      // ② existing + --for-gap ⇒ union, CLI order × gap-inner order, first occurrence wins
      lines.length = 0;
      assert.equal(await runTargetAdd([INDUSTRY, "--name", "对象甲", "--for-gap", gapB.gapId], { json: false }, deps), 0);
      const expectedUnion = [
        ...gapA.relatedRequirementIds,
        ...gapB.relatedRequirementIds.filter((r) => !gapA.relatedRequirementIds.includes(r)),
      ];
      assert.deepEqual(targetNamed(repo, sid, "对象甲").relatedRequirementRefs, expectedUnion);

      // ③ a gap with an EMPTY relatedRequirementIds is legal: no ref added, target still fine
      repo.upsertGap({ ...gapC, relatedRequirementIds: [] });
      const beforeEmpty = targetNamed(repo, sid, "对象甲").relatedRequirementRefs;
      lines.length = 0;
      assert.equal(await runTargetAdd([INDUSTRY, "--name", "对象甲", "--for-gap", gapC.gapId], { json: false }, deps), 0);
      assert.deepEqual(targetNamed(repo, sid, "对象甲").relatedRequirementRefs, beforeEmpty);

      // ④ `target list` shows the link as dimension summary + ref (read-only)
      lines.length = 0;
      assert.equal(await runTargetList(INDUSTRY, { json: false }, deps), 0);
      const human = lines.join("\n");
      assert.match(human, /用于补充 Requirement：/);
      for (const ref of beforeEmpty) {
        assert.ok(human.includes(ref), `the ref ${ref} is displayed`);
      }
      // …and `--json` carries the same refs (the row itself, unchanged shape)
      lines.length = 0;
      assert.equal(await runTargetList(INDUSTRY, { json: true }, deps), 0);
      const parsed = JSON.parse(lines.join("\n"));
      assert.deepEqual(parsed[0].target.relatedRequirementRefs, beforeEmpty);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("T-C2-5: linking never mutates a Gap", async () => {
    const { db, repo, sid, position, dir, lines, deps } = await setupCli();
    try {
      const gaps = repo.listGaps(sid);
      const before = gapFingerprint(repo, sid);

      lines.length = 0;
      assert.equal(await runTargetAdd(addArgs("对象乙", position.positionRef, ["--for-gap", gaps[0]!.gapId]), { json: false }, deps), 0);
      assert.equal(await runTargetAdd([INDUSTRY, "--name", "对象乙", "--for-gap", gaps[1]!.gapId], { json: false }, deps), 0);

      assert.equal(gapFingerprint(repo, sid), before, "gaps are read-only for this command");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("T-C2-37: refs are deterministic; repeated runs and repeated gapIds change nothing", async () => {
    const { db, repo, sid, position, dir, lines, deps } = await setupCli();
    try {
      const [gapA, gapB] = repo.listGaps(sid);
      assert.ok(gapA && gapB && gapA.gapId !== gapB.gapId);

      // ① order = CLI argument order × gap-inner order
      lines.length = 0;
      assert.equal(
        await runTargetAdd(
          addArgs("对象丙", position.positionRef, ["--for-gap", gapB.gapId, "--for-gap", gapA.gapId]),
          { json: false },
          deps,
        ),
        0,
      );
      const expected = [
        ...gapB.relatedRequirementIds,
        ...gapA.relatedRequirementIds.filter((r) => !gapB.relatedRequirementIds.includes(r)),
      ];
      const first = targetNamed(repo, sid, "对象丙").relatedRequirementRefs;
      assert.deepEqual(first, expected);

      // ② re-running the SAME command changes nothing (idempotent)
      lines.length = 0;
      assert.equal(
        await runTargetAdd(
          [INDUSTRY, "--name", "对象丙", "--for-gap", gapB.gapId, "--for-gap", gapA.gapId],
          { json: false },
          deps,
        ),
        0,
      );
      assert.deepEqual(targetNamed(repo, sid, "对象丙").relatedRequirementRefs, first);

      // ③ a repeated gapId (`A A B`) ≡ (`A B`): no duplicate entries, same order
      lines.length = 0;
      assert.equal(
        await runTargetAdd(
          addArgs("对象丁", position.positionRef, [
            "--for-gap",
            gapA.gapId,
            "--for-gap",
            gapA.gapId,
            "--for-gap",
            gapB.gapId,
          ]),
          { json: false },
          deps,
        ),
        0,
      );
      const dedup = targetNamed(repo, sid, "对象丁").relatedRequirementRefs;
      assert.deepEqual(dedup, [
        ...gapA.relatedRequirementIds,
        ...gapB.relatedRequirementIds.filter((r) => !gapA.relatedRequirementIds.includes(r)),
      ]);
      assert.equal(new Set(dedup).size, dedup.length, "no duplicates");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("T-C2-39: the stored refs support the frozen `TargetsForGap` derivation", async () => {
    const { db, repo, sid, position, dir, lines, deps } = await setupCli();
    try {
      const [gapA, gapB] = repo.listGaps(sid);
      assert.ok(gapA && gapB);
      const disjoint = gapA.relatedRequirementIds.every((r) => !gapB.relatedRequirementIds.includes(r));
      assert.ok(disjoint, "fixture: the two gaps ask for different requirements");

      // 甲 → gapA ; 乙 → gapB ; 丙 → both (multi-Gap membership is legal) ; 丁 → nothing
      lines.length = 0;
      assert.equal(await runTargetAdd(addArgs("甲", position.positionRef, ["--for-gap", gapA.gapId]), { json: false }, deps), 0);
      assert.equal(await runTargetAdd(addArgs("乙", position.positionRef, ["--for-gap", gapB.gapId]), { json: false }, deps), 0);
      assert.equal(await runTargetAdd(addArgs("丙", position.positionRef, ["--for-gap", gapA.gapId, "--for-gap", gapB.gapId]), { json: false }, deps), 0);
      assert.equal(await runTargetAdd(addArgs("丁", position.positionRef), { json: false }, deps), 0);

      // the derivation is NOT implemented in production here — this test-local implementation is
      // the frozen contract rule (§1.4), used to prove the WRITTEN DATA supports it.
      const targetsForGap = (gapId: string) => {
        const gap = repo.listGaps(sid).find((g) => g.gapId === gapId)!;
        return repo
          .listTargets(sid)
          .filter((t) => t.relatedRequirementRefs.some((r) => gap.relatedRequirementIds.includes(r)))
          .map((t) => t.subjectKey)
          .sort();
      };
      assert.deepEqual(targetsForGap(gapA.gapId), ["丙", "甲"].sort());
      assert.deepEqual(targetsForGap(gapB.gapId), ["丙", "乙"].sort());
      assert.ok(!targetsForGap(gapA.gapId).includes("丁"), "a target with no refs belongs to no gap");
      // 丙 legitimately appears under BOTH gaps (allowed cross-Gap membership)
      assert.ok(targetsForGap(gapA.gapId).includes("丙") && targetsForGap(gapB.gapId).includes("丙"));
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("T-C2-40①: invalid / cross-industry gap fails BEFORE the upsert (zero mutation)", async () => {
    const { db, repo, sid, position, dir, lines, deps } = await setupCli();
    try {
      const [gapA] = repo.listGaps(sid);
      lines.length = 0;
      assert.equal(await runTargetAdd(addArgs("对象戊", position.positionRef), { json: false }, deps), 0);
      const before = targetFingerprint(repo, sid);

      // ❶ unknown gapId
      lines.length = 0;
      assert.equal(await runTargetAdd([INDUSTRY, "--name", "对象戊", "--for-gap", "gap-nope"], { json: false }, deps), 1);
      assert.match(lines.join("\n"), /未找到研究缺口「gap-nope」/);
      assert.equal(targetFingerprint(repo, sid), before, "zero mutation");

      // ❷ a gap that belongs to ANOTHER industry
      const other = repo.findIndustryByName(OTHER)!;
      const foreignGap = repo.listGaps(other.industryId)[0]!;
      lines.length = 0;
      assert.equal(await runTargetAdd([INDUSTRY, "--name", "对象戊", "--for-gap", foreignGap.gapId], { json: false }, deps), 1);
      assert.match(lines.join("\n"), /不属于行业/);
      assert.equal(targetFingerprint(repo, sid), before, "zero mutation");

      // ❸ mixed valid + invalid ⇒ the WHOLE command fails; the valid one is NOT written
      lines.length = 0;
      assert.equal(
        await runTargetAdd([INDUSTRY, "--name", "对象戊", "--for-gap", gapA!.gapId, "--for-gap", "gap-nope"], { json: false }, deps),
        1,
      );
      assert.equal(targetFingerprint(repo, sid), before, "no partial link was stored");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("T-C2-40②: a REAL persistence failure (repo.upsertTarget) leaves no partial update", async () => {
    const { db, repo, sid, position, dir, lines, deps } = await setupCli();
    try {
      const [gapA, gapB] = repo.listGaps(sid);
      lines.length = 0;
      assert.equal(await runTargetAdd(addArgs("对象己", position.positionRef, ["--for-gap", gapA!.gapId]), { json: false }, deps), 0);
      const before = targetFingerprint(repo, sid);
      const beforeCount = repo.listTargets(sid).length;

      // ★ The failure is injected at the REAL persistence boundary: a SQLite trigger makes the
      //   `research_target` write itself ABORT, so `repo.upsertTarget()` throws — this is NOT a
      //   mocked service. Reads keep working, so the "no partial update" claim is verifiable.
      db.db.exec(
        "CREATE TRIGGER c2_step2b_block_target_write BEFORE INSERT ON research_target " +
          "BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;",
      );
      try {
        // ① existing target: byte-identical (identity, metadata and refs all unchanged)
        lines.length = 0;
        assert.equal(await runTargetAdd([INDUSTRY, "--name", "对象己", "--for-gap", gapB!.gapId], { json: false }, deps), 1);
        assert.match(lines.join("\n"), /无法录入研究对象/);
        assert.equal(targetFingerprint(repo, sid), before, "no partial mutation on an existing target");

        // ② new target: not created at all
        lines.length = 0;
        assert.equal(await runTargetAdd(addArgs("对象庚", position.positionRef, ["--for-gap", gapA!.gapId]), { json: false }, deps), 1);
        assert.equal(repo.listTargets(sid).length, beforeCount, "no new row");
        assert.equal(repo.listTargets(sid).some((t) => t.subjectKey === "对象庚"), false, "no half-created target");
        assert.equal(targetFingerprint(repo, sid), before);
      } finally {
        db.db.exec("DROP TRIGGER c2_step2b_block_target_write");
      }

      // ③ once the trigger is gone the same command succeeds — proving the failure really came
      //    from the persistence layer (and that no transaction abstraction was needed, Q4 = NO).
      lines.length = 0;
      assert.equal(await runTargetAdd([INDUSTRY, "--name", "对象己", "--for-gap", gapB!.gapId], { json: false }, deps), 0);
      assert.ok(
        targetNamed(repo, sid, "对象己").relatedRequirementRefs.includes(gapB!.relatedRequirementIds[0]!),
        "the link is applied only once persistence works again",
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("C′: link-only changes ONLY relatedRequirementRefs; conflicting args are refused (Q7a)", async () => {
    const { db, repo, sid, position, dir, lines, deps } = await setupCli();
    try {
      const [gapA, gapB] = repo.listGaps(sid);
      lines.length = 0;
      assert.equal(
        await runTargetAdd(
          addArgs("对象辛", position.positionRef, ["--limitation", "只能联系 CTO", "--accessibility", "likely", "--value", "0.4"]),
          { json: false },
          deps,
        ),
        0,
      );
      const before = targetNamed(repo, sid, "对象辛");
      const beforeFp = targetFingerprint(repo, sid);

      // ① Q7a: the create args may be OMITTED in link-only mode
      lines.length = 0;
      assert.equal(await runTargetAdd([INDUSTRY, "--name", "对象辛", "--for-gap", gapA!.gapId], { json: false }, deps), 0);
      const after = targetNamed(repo, sid, "对象辛");
      // identity + creation metadata (asserted separately, per the gate)
      assert.equal(after.targetRef, before.targetRef);
      assert.equal(after.subjectKey, before.subjectKey);
      assert.equal(after.createdAt, before.createdAt);
      // every other field is untouched…
      assert.equal(after.targetKind, before.targetKind);
      assert.equal(after.positionRef, before.positionRef);
      assert.equal(after.researchPurpose, before.researchPurpose);
      assert.equal(after.selectionReason, before.selectionReason);
      assert.equal(after.expectedInformationValue, before.expectedInformationValue);
      assert.equal(after.accessibility, before.accessibility);
      assert.deepEqual(after.limitations, before.limitations);
      assert.equal(after.isFallback, before.isFallback);
      assert.deepEqual(after.relatedQuestionRefs, before.relatedQuestionRefs);
      // …and ONLY the refs changed
      assert.deepEqual(
        after.relatedRequirementRefs,
        [...before.relatedRequirementRefs, ...gapA!.relatedRequirementIds.filter((r) => !before.relatedRequirementRefs.includes(r))],
      );

      // ② an explicitly provided, CONFLICTING non-refs arg is refused (zero mutation)
      const snapshot = targetFingerprint(repo, sid);
      lines.length = 0;
      assert.equal(
        await runTargetAdd([INDUSTRY, "--name", "对象辛", "--accessibility", "unlikely", "--for-gap", gapB!.gapId], { json: false }, deps),
        1,
      );
      assert.match(lines.join("\n"), /只允许改变 relatedRequirementRefs/);
      assert.equal(targetFingerprint(repo, sid), snapshot, "refused input does not touch the row");

      // ③ an explicitly provided, IDENTICAL arg is accepted (idempotent)
      lines.length = 0;
      assert.equal(
        await runTargetAdd([INDUSTRY, "--name", "对象辛", "--accessibility", "likely", "--for-gap", gapB!.gapId], { json: false }, deps),
        0,
      );
      assert.ok(targetNamed(repo, sid, "对象辛").relatedRequirementRefs.includes(gapB!.relatedRequirementIds[0]!));

      // ④ a NEW target still needs its create args (usage)
      lines.length = 0;
      assert.equal(await runTargetAdd([INDUSTRY, "--name", "对象壬", "--for-gap", gapA!.gapId], { json: false }, deps), 1);
      assert.match(lines.join("\n"), /usage: tiancha research target add/);
      assert.equal(repo.listTargets(sid).some((t) => t.subjectKey === "对象壬"), false);

      assert.ok(beforeFp.length > 0);
      assert.equal(repo.getTarget(targetRefFor(sid, "对象辛"))!.subjectKey, "对象辛", "identity lookup is stable");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Q2: `--for-gap` composes with `--fallback-for` and never changes identity", async () => {
    const { db, repo, sid, position, dir, lines, deps } = await setupCli();
    try {
      const [gapA, gapB] = repo.listGaps(sid);
      lines.length = 0;
      assert.equal(await runTargetAdd(addArgs("主对象", position.positionRef), { json: false }, deps), 0);
      const main = targetNamed(repo, sid, "主对象");

      // a NEW fallback target that is also linked to a gap — both dimensions are expressed
      lines.length = 0;
      assert.equal(
        await runTargetAdd(
          addArgs("备选对象", position.positionRef, ["--fallback-for", main.targetRef, "--limitation", "仅作交叉验证", "--for-gap", gapA!.gapId]),
          { json: false },
          deps,
        ),
        0,
      );
      const fallback = targetNamed(repo, sid, "备选对象");
      assert.equal(fallback.isFallback, true);
      assert.equal(fallback.fallbackForTargetRef, main.targetRef);
      assert.deepEqual(fallback.relatedRequirementRefs, gapA!.relatedRequirementIds);
      // identity comes from (industry, subjectKey) only — `--for-gap` never participates
      assert.equal(fallback.targetRef, targetRefFor(sid, "备选对象"));

      // existing fallback + a DIFFERENT --fallback-for ⇒ conflict (C′), zero mutation
      const snapshot = targetFingerprint(repo, sid);
      lines.length = 0;
      assert.equal(
        await runTargetAdd([INDUSTRY, "--name", "备选对象", "--fallback-for", "tgt-nope", "--for-gap", gapB!.gapId], { json: false }, deps),
        1,
      );
      assert.equal(targetFingerprint(repo, sid), snapshot);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
