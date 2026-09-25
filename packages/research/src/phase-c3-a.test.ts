/**
 * Phase C · Step C3-A — Priority / NextAction lifecycle verification.
 *
 * Contract: `docs/phaseC/c3-implementation-contract.md`（C3 Contract Gate PASS, rev2）
 *   §5.1 ★★ 核心闭环 reopened → Priority / NextAction re-entry（硬出口门禁：
 *        "没有通过 reopened re-entry 核心矩阵，C3 不得出门"）
 *   §5.2 驱动链其余段
 *   §1.5 reopen 的持久化语义 = **既有写入机制的产出**，C3 不新增计算规则
 *   §7.3 本文件 = Layer 2（自动化测试）；真实库演练 = Layer 3
 *
 * 只读纪律（I-C3-8）：**生产侧**消费一律经 `currentPriorities()`；本文件仅在断言
 * "持久化值 == 既有写入机制的产出" 时于**测试内**调用 `rank()`（§5.1 T-C3-5 允许）。
 *
 *   T-C3-1  gap resolved ⇒ 其 action 变为 cancelled
 *   T-C3-2  同一 gapId re-open ⇒ 原 action 重新 open（re-entry）
 *   T-C3-3  re-entry 后 actionId 不变，且不产生第二个 action
 *   T-C3-4  re-entry 后 createdAt 保留、updatedAt 前进
 *   T-C3-5  priority / priorityBreakdown / priorityPolicyVersionId 与既有写入机制一致
 *   T-C3-6  kind 与 actionKindByGapType[gapType] 一致
 *   T-C3-7  currentPriorities() 重新包含该 gap（且与持久化行一致）
 *   T-C3-8  ResearchState.nextActionIds 重新包含该 action（真实链路）
 *   T-C3-9  C2 ResearchPlan 重新看到该 gap / 该 action（跨阶段一致性）
 *   T-C3-10 多轮 resolve ↔ re-open 循环收敛（无重复 action / gap，identity 稳定）
 *   T-C3-11 gapType 变化 ⇒ kind 跟随 policy 映射变化
 *   T-C3-12 仅 priority 变化（kind 不变）⇒ 既有行被更新而非新建
 *   T-C3-13 no-change refresh 零写入（行级指纹）
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { MaterialIngestService } from "./application/material-ingest-service.js";
import { KnowledgeProjectionService } from "./application/knowledge-projection-service.js";
import { PriorityService } from "./application/priority-service.js";
import { ResearchPlanService } from "./application/research-plan-service.js";
import { PRIORITY_POLICY_V1 } from "./domain/priority-policy.js";
import type { InformationPoolSlot, InformationRequirement } from "./domain/index.js";

const DIM = "market";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const svc = new KnowledgeProjectionService(db.db);
  return { db, repo, svc };
}

function mkReq(subjectId: string, dimension: string, importance = 3): InformationRequirement {
  const now = new Date().toISOString();
  return {
    requirementId: "req-" + randomUUID(),
    questionId: "q-" + randomUUID(),
    subjectKind: "industry",
    subjectId,
    dimension,
    description: "需要掌握 " + dimension,
    importance,
    requiredEvidenceType: "text",
    confirmedCondition: "c",
    uncertainCondition: "u",
    unknownCondition: "n",
    preferredPositionKinds: [],
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
}

function mkSlot(
  subjectId: string,
  dimension: string,
  status: InformationPoolSlot["status"],
): InformationPoolSlot {
  const now = new Date().toISOString();
  return {
    slotId: `slot-${subjectId}-${dimension}`,
    subjectKind: "industry",
    subjectId,
    dimension,
    status,
    coverageJudgement: "test",
    createdAt: now,
    updatedAt: now,
  };
}

/** The action rows that EXIST for one gap (never filtered — duplicates would show up here). */
const actionsFor = (repo: ResearchRepository, subjectId: string, gapId: string) =>
  repo.listNextActions(subjectId).filter((a) => a.params?.gapId === gapId);

/** Row-level fingerprint (proves a no-change refresh wrote nothing at all). */
const rowFingerprint = (a: unknown) => JSON.stringify(a);

/**
 * Deterministically push the wall clock past an ISO-millisecond boundary, so a later write MUST
 * carry a strictly greater timestamp. This avoids both a `sleep` and the weakness of `>=`.
 */
function advanceClockByOneMs(): void {
  const t0 = new Date().toISOString();
  let guard = 0;
  while (new Date().toISOString() === t0 && guard < 100_000) guard += 1;
}

/**
 * ★ SQLite's OWN change counter (`sqlite3_total_changes`). A no-op `UPDATE ... SET <same values>`
 * WOULD increment it, so this distinguishes "no observable row churn" from a real zero-write
 * refresh — using a DB-provided mechanism, never a hand-rolled mock counter.
 */
const totalChanges = (db: ResearchDb) =>
  (db.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

/** Controlled path: one requirement + one slot, then the two existing refresh steps. */
function seedGap(svc: KnowledgeProjectionService, repo: ResearchRepository, subjectId: string) {
  repo.upsertRequirement(mkReq(subjectId, DIM));
  repo.upsertPoolSlot(mkSlot(subjectId, DIM, "unknown"));
  svc.refreshGaps(subjectId, "industry");
  svc.refreshNextActions(subjectId, "industry");
}

/** Real-chain path: a full ingest so `refreshSubject` (and `nextActionIds`) run for real. */
async function seedRealChain(industryName: string) {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const materials = new MaterialIngestService(repo, new EchoDataProvider(), artifacts);
  const svc = new KnowledgeProjectionService(db.db);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName });
  return { db, repo, discovery, materials, svc, sid: res.industry.industryId };
}

/** A real material whose `market` claim is enough to satisfy that dimension's slot. */
const REAL_MATERIAL = `[CLAIM]
dimension: market
content: 市场空间约 500 亿元，未来三年 CAGR 约 25%
confidence: 0.8
source: 专家访谈 A
[/CLAIM]
`;

describe("Phase C3-A · Gap → persisted Priority / NextAction lifecycle", () => {
  test("T-C3-1/2/3/4/5/6: resolve cancels; re-degrade RE-ENTERS with stable actionId + createdAt", () => {
    const { db, repo, svc } = setup();
    try {
      const subj = "ind-" + randomUUID();
      seedGap(svc, repo, subj);

      // ---- baseline: one open gap, one open action -------------------------
      const gap0 = repo.listGaps(subj)[0]!;
      assert.equal(gap0.status, "open", "baseline: the gap is open");
      const before = actionsFor(repo, subj, gap0.gapId);
      assert.equal(before.length, 1, "baseline: exactly one action for the gap");
      const a0 = before[0]!;
      assert.equal(a0.status, "open");
      assert.equal(a0.actionId, `act-${gap0.gapId}`, "actionId ≡ act-<gapId>");
      assert.equal(repo.listNextActions(subj).length, 1);

      // ---- T-C3-1: slot becomes sufficient ⇒ gap resolved ⇒ action cancelled
      repo.upsertPoolSlot(mkSlot(subj, DIM, "sufficient"));
      svc.refreshGaps(subj, "industry");
      svc.refreshNextActions(subj, "industry");
      assert.equal(repo.listGaps(subj)[0]!.status, "resolved", "the gap resolved");
      const cancelled = actionsFor(repo, subj, gap0.gapId);
      assert.equal(cancelled.length, 1, "the row is KEPT (history), not deleted");
      assert.equal(cancelled[0]!.status, "cancelled", "T-C3-1: cancelled");
      assert.equal(cancelled[0]!.actionId, a0.actionId, "identity kept while cancelled");

      // ---- T-C3-2/3/4: the slot degrades again ⇒ SAME gapId re-opens ----------
      // Force the clock past a millisecond boundary: the re-entry MUST rewrite the row, so its
      // updatedAt has to be STRICTLY greater (not merely `>=`, which same-ms writes would pass).
      advanceClockByOneMs();
      repo.upsertPoolSlot(mkSlot(subj, DIM, "partial"));
      svc.refreshGaps(subj, "industry");
      svc.refreshNextActions(subj, "industry");

      const gap1 = repo.listGaps(subj)[0]!;
      assert.equal(gap1.gapId, gap0.gapId, "same gap identity");
      assert.equal(gap1.status, "open", "the gap re-opened");
      assert.equal(gap1.discoveredAt, gap0.discoveredAt, "discoveredAt preserved");

      const all = repo.listNextActions(subj);
      assert.equal(all.length, 1, "T-C3-3: NO second action row was created");
      const a1 = all[0]!;
      assert.equal(a1.status, "open", "T-C3-2: re-entered the queue");
      assert.equal(a1.actionId, a0.actionId, "T-C3-3: same actionId");
      assert.equal(a1.createdAt, a0.createdAt, "T-C3-4: createdAt is the FIRST creation time");
      assert.ok(a1.updatedAt > a0.updatedAt, "T-C3-4: updatedAt must ADVANCE (>), not merely >=");

      // ---- T-C3-5: the persisted priority IS the existing write path's output ----
      // (test-only comparison; production consumers must use currentPriorities(), I-C3-8)
      const ranked = new PriorityService(db.db)
        .rank(subj, "industry")
        .find((p) => p.gapId === gap1.gapId)!;
      assert.equal(a1.priority, ranked.score, "T-C3-5: persisted score == write-path score");
      assert.deepEqual(a1.params.priorityBreakdown, ranked.factors, "T-C3-5: breakdown restored");
      assert.equal(
        a1.params.priorityPolicyVersionId,
        ranked.policyVersionId,
        "T-C3-5: policy version restored",
      );
      assert.equal(a1.params.priorityPolicyVersionId, PRIORITY_POLICY_V1.versionId);
      assert.ok(a1.priority >= 0 && a1.priority <= 100, "score is a 0..100 integer");

      // ---- T-C3-6: KIND comes from the gap state (policy map), not from the score
      assert.equal(
        a1.kind,
        PRIORITY_POLICY_V1.actionKindByGapType[gap1.gapType],
        "T-C3-6: kind follows the gap type map",
      );
      assert.equal(gap1.gapType, "insufficient");
      assert.equal(a1.params.gapType, "insufficient", "the row records the producing gap type");
    } finally {
      db.close();
    }
  });

  test("T-C3-7: currentPriorities() sees the gap again — and it agrees with the row exactly", () => {
    const { db, repo, svc } = setup();
    try {
      const subj = "ind-" + randomUUID();
      seedGap(svc, repo, subj);
      const gapId = repo.listGaps(subj)[0]!.gapId;
      const priorities = new PriorityService(db.db);

      assert.equal(priorities.currentPriorities(subj).length, 1, "baseline: visible");

      // resolve ⇒ the read view must go empty (cancelled rows are not priorities)
      repo.upsertPoolSlot(mkSlot(subj, DIM, "sufficient"));
      svc.refreshGaps(subj, "industry");
      svc.refreshNextActions(subj, "industry");
      assert.equal(
        priorities.currentPriorities(subj).length,
        0,
        "a cancelled action is not a current priority",
      );

      // re-open ⇒ visible again, identical to the persisted row
      repo.upsertPoolSlot(mkSlot(subj, DIM, "unknown"));
      svc.refreshGaps(subj, "industry");
      svc.refreshNextActions(subj, "industry");
      const view = priorities.currentPriorities(subj);
      assert.equal(view.length, 1, "T-C3-7: visible again");
      const row = actionsFor(repo, subj, gapId)[0]!;
      assert.equal(view[0]!.gapId, gapId);
      assert.equal(view[0]!.score, row.priority, "T-C3-7: score == persisted row");
      assert.deepEqual(view[0]!.factors, row.params.priorityBreakdown, "T-C3-7: factors == row");
      assert.equal(view[0]!.policyVersionId, row.params.priorityPolicyVersionId);
      assert.equal(view[0]!.rationale, row.rationale);
    } finally {
      db.close();
    }
  });

  test("T-C3-10: repeated resolve ↔ re-open cycles converge (no duplicate action / gap)", () => {
    const { db, repo, svc } = setup();
    try {
      const subj = "ind-" + randomUUID();
      seedGap(svc, repo, subj);
      const gapId = repo.listGaps(subj)[0]!.gapId;
      const a0 = actionsFor(repo, subj, gapId)[0]!;
      const priorities = new PriorityService(db.db);
      const snapshot = () => ({
        gaps: repo.listGaps(subj).length,
        actions: repo.listNextActions(subj).length,
        values: priorities.currentPriorities(subj).length,
        actionIds: repo.listNextActions(subj).map((a) => a.actionId).sort(),
        createdAt: repo.listNextActions(subj).map((a) => a.createdAt).sort(),
      });

      for (let cycle = 1; cycle <= 3; cycle++) {
        // resolve
        repo.upsertPoolSlot(mkSlot(subj, DIM, "sufficient"));
        svc.refreshGaps(subj, "industry");
        svc.refreshNextActions(subj, "industry");
        assert.equal(repo.listGaps(subj).length, 1, `cycle ${cycle}: still ONE gap row`);
        assert.equal(repo.listNextActions(subj).length, 1, `cycle ${cycle}: still ONE action row`);
        assert.equal(repo.listNextActions(subj)[0]!.status, "cancelled", `cycle ${cycle}: cancelled`);
        assert.equal(priorities.currentPriorities(subj).length, 0, `cycle ${cycle}: view empty`);

        // re-open (alternating degradation reason: partial / conflicting / unknown)
        const degraded: InformationPoolSlot["status"] =
          cycle === 1 ? "partial" : cycle === 2 ? "conflicting" : "unknown";
        repo.upsertPoolSlot(mkSlot(subj, DIM, degraded));
        svc.refreshGaps(subj, "industry");
        svc.refreshNextActions(subj, "industry");
        assert.equal(repo.listGaps(subj).length, 1, `cycle ${cycle}: no duplicate gap`);
        assert.equal(repo.listNextActions(subj).length, 1, `cycle ${cycle}: no duplicate action`);
        assert.equal(repo.listNextActions(subj)[0]!.status, "open", `cycle ${cycle}: re-entered`);
        assert.equal(priorities.currentPriorities(subj).length, 1, `cycle ${cycle}: visible again`);
        assert.deepEqual(
          snapshot(),
          {
            gaps: 1,
            actions: 1,
            values: 1,
            actionIds: [a0.actionId],
            createdAt: [a0.createdAt],
          },
          `cycle ${cycle}: identity + cardinality are stable`,
        );
      }
    } finally {
      db.close();
    }
  });

  test("T-C3-11: the gap TYPE decides the kind — unknown / insufficient / conflict", () => {
    const { db, repo, svc } = setup();
    try {
      const subj = "ind-" + randomUUID();
      repo.upsertRequirement(mkReq(subj, DIM));
      for (const [slotStatus, expectedGapType, expectedKind] of [
        ["unknown", "unknown", "retrieve_data"],
        ["partial", "insufficient", "request_manual_input"],
        ["conflicting", "conflict", "request_manual_input"],
      ] as const) {
        repo.upsertPoolSlot(mkSlot(subj, DIM, slotStatus));
        svc.refreshGaps(subj, "industry");
        svc.refreshNextActions(subj, "industry");
        const gap = repo.listGaps(subj)[0]!;
        const action = actionsFor(repo, subj, gap.gapId)[0]!;
        assert.equal(gap.gapType, expectedGapType, `${slotStatus} ⇒ gapType`);
        assert.equal(action.kind, expectedKind, `${slotStatus} ⇒ kind`);
        assert.equal(
          action.kind,
          PRIORITY_POLICY_V1.actionKindByGapType[gap.gapType],
          "T-C3-11: kind is the policy map's value for the CURRENT gap type",
        );
        assert.equal(action.params.gapType, expectedGapType, "the row records the gap type");
      }
    } finally {
      db.close();
    }
  });

  test("T-C3-12: a priority-only change UPDATES the existing row (never a second row)", () => {
    const { db, repo, svc } = setup();
    try {
      const subj = "ind-" + randomUUID();
      const req = mkReq(subj, DIM, 1); // importance 1
      repo.upsertRequirement(req);
      repo.upsertPoolSlot(mkSlot(subj, DIM, "conflicting")); // kind stays request_manual_input
      svc.refreshGaps(subj, "industry");
      svc.refreshNextActions(subj, "industry");
      const gapId = repo.listGaps(subj)[0]!.gapId;
      const a0 = actionsFor(repo, subj, gapId)[0]!;
      const beforeBreakdown = structuredClone(a0.params.priorityBreakdown);

      // raise importance ⇒ the score must move, while the gap type (and thus kind) stays
      repo.upsertRequirement({ ...req, importance: 5 });
      svc.refreshGaps(subj, "industry");
      svc.refreshNextActions(subj, "industry");

      const rows = actionsFor(repo, subj, gapId);
      assert.equal(rows.length, 1, "T-C3-12: still ONE row (updated, not appended)");
      const a1 = rows[0]!;
      assert.equal(a1.actionId, a0.actionId, "same action");
      assert.equal(a1.kind, a0.kind, "the kind did not change (gap type unchanged)");
      assert.ok(a1.priority > a0.priority, "T-C3-12: the score really moved (importance ↑)");
      assert.equal(a1.createdAt, a0.createdAt);
      assert.ok(a1.updatedAt >= a0.updatedAt);
      // ★ Value-level (not reference-level) proof: snapshot the OLD breakdown, compare DEEPLY,
      //   and pin the ONE factor that must have moved (importance) while the others stay put.
      assert.notDeepEqual(
        a1.params.priorityBreakdown,
        beforeBreakdown,
        "T-C3-12: the breakdown VALUE was rewritten (not merely a new object reference)",
      );
      type Factor = { raw: number; normalized: number; weight: number; contribution: number };
      const b0 = beforeBreakdown as Record<string, Factor>;
      const b1 = a1.params.priorityBreakdown as Record<string, Factor>;
      assert.equal(b1.importance!.raw, 5, "the importance factor saw the new requirement value");
      assert.ok(
        b1.importance!.contribution > b0.importance!.contribution,
        "T-C3-12: the importance contribution ROSE",
      );
      assert.deepEqual(b1.criticality, b0.criticality, "uncorrelated factor unchanged");
      assert.deepEqual(b1.uncertainty, b0.uncertainty, "uncorrelated factor unchanged");
      assert.deepEqual(b1.coverageGap, b0.coverageGap, "uncorrelated factor unchanged");
      assert.deepEqual(b1.acquisitionValue, b0.acquisitionValue, "uncorrelated factor unchanged");
      assert.deepEqual(b1.acquisitionCost, b0.acquisitionCost, "uncorrelated factor unchanged");
    } finally {
      db.close();
    }
  });

  test("T-C3-13: a no-change refresh writes NOTHING (row-level fingerprint)", () => {
    const { db, repo, svc } = setup();
    try {
      const subj = "ind-" + randomUUID();
      seedGap(svc, repo, subj);
      const gapId = repo.listGaps(subj)[0]!.gapId;

      const before = actionsFor(repo, subj, gapId).map(rowFingerprint);
      // ★ Zero-WRITE evidence, not merely "no observable churn": SQLite's own counter would move
      //   even for an `UPDATE ... SET <same values>`, so equality here means nothing was written.
      const changes0 = totalChanges(db);
      svc.refreshNextActions(subj, "industry");
      svc.refreshNextActions(subj, "industry");
      const changes1 = totalChanges(db);
      assert.equal(changes1, changes0, "T-C3-13: the DB reports ZERO changed rows (true zero-write)");
      const after = actionsFor(repo, subj, gapId).map(rowFingerprint);
      assert.deepEqual(after, before, "T-C3-13: no churn — not even updatedAt");

      // …and the whole subject is stable too (no hidden rows appear)
      assert.equal(repo.listNextActions(subj).length, 1);
    } finally {
      db.close();
    }
  });

  test("T-C3-8/9/10 (real chain): a real material resolves the gap; a CONFLICT re-opens it end-to-end", async () => {
    const { db, repo, discovery, materials, sid } = await seedRealChain("C3-A 验证行业");
    try {
      const priorities = new PriorityService(db.db);
      const plans = new ResearchPlanService(db.db);
      const openGapIds = () =>
        repo.listGaps(sid)
          .filter((g) => g.status === "open")
          .map((g) => g.gapId);
      const marketRequirementId = repo.listRequirements(sid).find((r) => r.dimension === DIM)!.requirementId;
      const marketGapId = repo.listGaps(sid).find((g) => g.relatedRequirementIds.includes(marketRequirementId))!.gapId;

      // the ingest built a real ResearchState, and the gap starts open + queued
      const state0 = repo.getStateBySubject("industry", sid);
      assert.ok(state0, "research_state exists");
      const before = repo.listNextActions(sid).find((a) => a.params?.gapId === marketGapId)!;
      assert.equal(before.status, "open");
      assert.ok(state0.nextActionIds.includes(before.actionId), "baseline: queued in nextActionIds");

      // ---- resolve the market gap through the REAL MATERIAL pipe -----------
      const ingested = await materials.ingest({
        subjectKind: "industry",
        subjectId: sid,
        title: "专家访谈纪要",
        text: REAL_MATERIAL,
      });
      assert.equal(ingested.created, true, "the material went through the real pipe");
      assert.equal(repo.getPoolSlot(`slot-${sid}-${DIM}`)!.status, "sufficient", "market became sufficient");
      assert.equal(repo.getRequirement(marketRequirementId)!.status, "met", "the requirement is met");
      const cancelledRow = repo.listNextActions(sid).find((a) => a.params?.gapId === marketGapId)!;
      assert.equal(cancelledRow.status, "cancelled", "T-C3-1: resolved ⇒ cancelled");
      assert.equal(priorities.currentPriorities(sid).some((p) => p.gapId === marketGapId), false);

      // ---- re-open through the REAL claim pipe: a CONFLICT on the same dimension
      await discovery.ingestClaims({
        subjectKind: "industry",
        subjectId: sid,
        claims: [{ statement: "市场空间另有说法", dimension: DIM, relationHint: { kind: "CONFLICT" } }],
      });

      const reopenedGap = repo.listGaps(sid).find((g) => g.gapId === marketGapId)!;
      assert.equal(reopenedGap.status, "open", "the SAME gap re-opened");
      assert.ok(openGapIds().includes(marketGapId), "T-C3-9: it is an ACTIVE gap again");

      const rows = repo.listNextActions(sid).filter((a) => a.params?.gapId === marketGapId);
      assert.equal(rows.length, 1, "T-C3-10: still exactly one action for this gap");
      assert.equal(rows[0]!.status, "open", "T-C3-2: re-entered through the real chain");
      assert.equal(rows[0]!.actionId, before.actionId, "T-C3-3: same actionId");
      assert.equal(rows[0]!.createdAt, before.createdAt, "T-C3-4: createdAt preserved");

      // T-C3-7: the read-only face sees it again
      const view = priorities.currentPriorities(sid);
      assert.ok(view.some((p) => p.gapId === marketGapId), "T-C3-7: visible again");

      // T-C3-8: ResearchState.nextActionIds re-includes it (refreshed by the real chain)
      const state = repo.getStateBySubject("industry", sid)!;
      assert.ok(
        state.nextActionIds.includes(rows[0]!.actionId),
        "T-C3-8: nextActionIds re-includes the re-entered action",
      );

      // T-C3-9: the C2 plan (read-only projection) sees gap + action again
      const plan = plans.build(sid);
      assert.ok(
        plan.gaps.some((g) => g.gapId === marketGapId),
        "T-C3-9: the plan shows the gap in its open-gap section",
      );
      assert.ok(
        plan.nextActions.some((a) => a.actionId === rows[0]!.actionId && a.status === "open"),
        "T-C3-9: the plan shows the re-entered action as open",
      );
      assert.deepEqual(
        plan.gaps.map((g) => g.gapId).sort(),
        openGapIds().sort(),
        "T-C3-9: plan gaps == persisted active gaps",
      );
    } finally {
      db.close();
    }
  });
});
