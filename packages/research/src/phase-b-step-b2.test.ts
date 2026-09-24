/**
 * Phase B v1 · Step B2 — ResearchTarget (human-confirmed subjects).
 *
 *   T-B6  stable identity: the same human subject is ALWAYS the same target
 *   T-B7  Human-confirmed: no Position / projection / need path creates a target
 *   T-B8  provenance: createdBy is always "user" and cannot be overridden
 *   T-B9  fallback invariants (I-B3)
 *   T-B10 a fallback is not a dead boolean — it carries caveats downstream
 *   T-B12 creating a target changes NO A/C-MVP source of truth
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { ChainProjectionService } from "./application/chain-projection-service.js";
import { ResearchNeedService } from "./application/research-need-service.js";
import { TargetService } from "./application/target-service.js";
import { FALLBACK_CAVEAT, slugSubjectKey, targetCaveats } from "./domain/research-target.js";

const INDUSTRY = "B2测试行业";

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: INDUSTRY });
  const sid = res.industry.industryId;
  const projection = new ChainProjectionService(db.db).project(sid);
  const positionRef = projection.positions[0]!.positionRef;
  return { db, repo, sid, positionRef };
}

function base(sid: string, positionRef: string) {
  return {
    industryId: sid,
    subjectKey: "XX科技",
    targetKind: "头部客户",
    positionRef,
    researchPurpose: "验证真实采购意愿与规模",
    selectionReason: "该客户为该行业头部采购方",
  };
}

/** Everything a target creation must NOT touch. */
function sotFingerprint(db: ResearchDb, repo: ResearchRepository, sid: string): string {
  const kr = new KnowledgeRepository(db.db);
  const k = kr.findKnowledgeBySubject("industry", sid);
  return JSON.stringify({
    slots: repo.listPoolSlots(sid).map((s) => `${s.dimension}:${s.status}`).sort(),
    gaps: repo.listGaps(sid).map((g) => `${g.gapId}:${g.status}`).sort(),
    requirements: repo.listRequirements(sid).map((r) => `${r.requirementId}:${r.status}`).sort(),
    actions: repo.listNextActions(sid).map((a) => `${a.actionId}:${a.priority}`).sort(),
    beliefs: k ? kr.listBeliefs(k.knowledgeId).length : 0,
    evaluations: repo.getLatestEvaluation("industry", sid)?.evaluationId ?? null,
    stateVersion: repo.getStateBySubject("industry", sid)?.version ?? 0,
  });
}

describe("Phase B · Step B2", () => {
  test("T-B6: the same human subject yields a stable identity (no duplicates)", async () => {
    const { db, repo, sid, positionRef } = await setup();
    const svc = new TargetService(db.db);

    const first = svc.add(base(sid, positionRef));
    const second = svc.add(base(sid, positionRef));

    assert.equal(first.targetRef, second.targetRef);
    assert.equal(first.targetRef, `tgt-${sid}-${slugSubjectKey("XX科技")}`);
    assert.equal(repo.listTargets(sid).length, 1, "no duplicate target rows");
    assert.equal(second.createdAt, first.createdAt, "createdAt preserved on re-add");
    db.close();
  });

  test("T-B7: nothing but the human path creates a target", async () => {
    // (a) neither service may WRITE a target — only the human-facing TargetService does
    assert.ok(
      !/upsertTarget|getTarget|targetRefFor/.test(ChainProjectionService.prototype.project.toString()),
      "ChainProjectionService must not write targets",
    );
    assert.ok(
      !/upsertTarget|getTarget|targetRefFor/.test(ResearchNeedService.prototype.list.toString()),
      "ResearchNeedService must not write targets",
    );

    // (b) the subject is a REQUIRED human input — omitting it is rejected
    const { db, sid, positionRef } = await setup();
    assert.throws(
      () => new TargetService(db.db).add({ ...base(sid, positionRef), subjectKey: "   " }),
      /subjectKey is required/,
    );
    db.close();
  });

  test("T-B8: createdBy is always 'user' and cannot be overridden", async () => {
    const { db, sid, positionRef } = await setup();
    const svc = new TargetService(db.db);

    // even if a caller tries to inject createdBy, the service ignores it
    const t = svc.add({ ...base(sid, positionRef), createdBy: "system" } as never);
    assert.equal(t.createdBy, "user");
    assert.equal(svc.get(t.targetRef)!.createdBy, "user", "stored provenance is human");
    db.close();
  });

  test("T-B9: fallback invariants (I-B3)", async () => {
    const { db, sid, positionRef } = await setup();
    const svc = new TargetService(db.db);
    const primary = svc.add(base(sid, positionRef));

    assert.throws(
      () => svc.add({ ...base(sid, positionRef), subjectKey: "备选A", isFallback: true }),
      /fallbackForTargetRef/,
    );
    assert.throws(
      () =>
        svc.add({
          ...base(sid, positionRef),
          subjectKey: "备选B",
          isFallback: true,
          fallbackForTargetRef: primary.targetRef,
        }),
      /limitations/,
    );
    assert.throws(
      () =>
        svc.add({
          ...base(sid, positionRef),
          subjectKey: "备选C",
          isFallback: true,
          fallbackForTargetRef: "tgt-not-exist",
          limitations: ["x"],
        }),
      /does not exist/,
    );

    const fb = svc.add({
      ...base(sid, positionRef),
      subjectKey: "备选D",
      isFallback: true,
      fallbackForTargetRef: primary.targetRef,
      limitations: ["联系难度高"],
    });
    assert.equal(fb.isFallback, true);
    assert.equal(fb.fallbackForTargetRef, primary.targetRef);
    db.close();
  });

  test("T-B10: a fallback is not a dead boolean — it carries caveats downstream", async () => {
    const { db, sid, positionRef } = await setup();
    const svc = new TargetService(db.db);
    const primary = svc.add(base(sid, positionRef));
    const fallback = svc.add({
      ...base(sid, positionRef),
      subjectKey: "备选D",
      isFallback: true,
      fallbackForTargetRef: primary.targetRef,
      limitations: ["联系难度高"],
    });

    const caveats = targetCaveats(fallback);
    assert.ok(caveats.includes(FALLBACK_CAVEAT), "the fallback caveat is produced");
    assert.ok(caveats.includes("联系难度高"), "its limitations are carried too");
    assert.deepEqual(targetCaveats(primary), [], "a plain target with no limitations has no caveats");

    // downstream layers can enumerate fallbacks explicitly
    assert.deepEqual(svc.listFallbacks(sid).map((t) => t.targetRef), [fallback.targetRef]);
    db.close();
  });

  test("T-B12: creating targets changes no A/C-MVP source of truth", async () => {
    const { db, repo, sid, positionRef } = await setup();
    const svc = new TargetService(db.db);
    const before = sotFingerprint(db, repo, sid);

    const primary = svc.add(base(sid, positionRef));
    svc.add({
      ...base(sid, positionRef),
      subjectKey: "备选E",
      isFallback: true,
      fallbackForTargetRef: primary.targetRef,
      limitations: ["l"],
    });

    assert.equal(sotFingerprint(db, repo, sid), before, "only research_target may grow");
    assert.equal(repo.listTargets(sid).length, 2);
    db.close();
  });

  test("expectedInformationValue defaults to the position's derived importance (Q3)", async () => {
    const { db, repo, sid, positionRef } = await setup();
    const svc = new TargetService(db.db);
    const t = svc.add(base(sid, positionRef));
    assert.equal(t.expectedInformationValue, repo.getPosition(positionRef)!.importance);
    db.close();
  });
});
