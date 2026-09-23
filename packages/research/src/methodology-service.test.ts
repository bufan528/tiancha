/**
 * P1: Methodology versioning + Human-gated evolution tests.
 * Invariant 6: methodology cannot Activate without a human decision.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { MethodologyService } from "./application/methodology-service.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { METHODOLOGY_V1 } from "./methodology/methodology-v1.js";
import type { MethodologyDimension } from "./domain/index.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const svc = new MethodologyService(repo);
  return { db, repo, svc };
}

function extraDimension(): MethodologyDimension {
  return {
    key: "supply_chain_security",
    name: "供应链安全",
    description: "关键环节断供风险",
    whyNeeded: "识别卡脖子环节",
    requiredInfo: "单点依赖、替代来源",
    confirmedCondition: "依赖清单 + 替代方案",
    uncertainCondition: "仅识别单点",
    unknownCondition: "无供应链分析",
  };
}

describe("P1 Methodology versioning", () => {
  test("bootstrap seeds v1 once and is idempotent", () => {
    const { repo, svc } = setup();
    const v1 = svc.getActive();
    assert.equal(v1.versionId, METHODOLOGY_V1.versionId);
    assert.equal(v1.dimensions.length, 12);
    // idempotent: no duplicate version rows
    svc.bootstrap();
    svc.bootstrap();
    assert.equal(repo.listMethodologies().length, 1);
  });

  test("v1 dimensions round-trip through the DB (not re-derived from a constant)", () => {
    const { svc } = setup();
    svc.getActive();
    const stored = svc.getActive();
    assert.deepEqual(
      stored.dimensions.map((d) => d.key),
      METHODOLOGY_V1.dimensions.map((d) => d.key),
    );
  });

  test("propose creates a pending candidate and NEVER activates it", () => {
    const { svc } = setup();
    svc.getActive();
    const c = svc.propose({
      proposedDimensions: [...METHODOLOGY_V1.dimensions, extraDimension()],
      rationale: "某行业因缺少供应链维度而误判",
      evidenceRefs: ["artifact:claim/x"],
      createdBy: "agent",
    });
    assert.equal(c.status, "pending");
    assert.equal(svc.pendingCandidates().length, 1);
    // still v1: no activation without a human decision
    assert.equal(svc.getActive().versionId, METHODOLOGY_V1.versionId);
    assert.equal(svc.getActive().dimensions.length, 12);
  });

  test("decide without an operator throws (no human gate)", () => {
    const { svc } = setup();
    const c = svc.propose({ proposedDimensions: [...METHODOLOGY_V1.dimensions], rationale: "x" });
    assert.throws(
      () => svc.decide({ candidateId: c.candidateId, decision: "approved", operator: "" }),
      /human gate/,
    );
  });

  test("approval activates a NEW version and keeps the previous one", () => {
    const { svc } = setup();
    const active0 = svc.getActive();
    const c = svc.propose({
      proposedDimensions: [...METHODOLOGY_V1.dimensions, extraDimension()],
      rationale: "补齐供应链维度",
    });
    const res = svc.decide({ candidateId: c.candidateId, decision: "approved", operator: "bufan" });

    assert.ok(res.activatedVersion);
    assert.equal(res.activatedVersion!.versionTag, "v2");
    assert.equal(res.activatedVersion!.dimensions.length, 13);

    const active1 = svc.getActive();
    assert.equal(active1.versionId, res.activatedVersion!.versionId);
    assert.notEqual(active1.versionId, active0.versionId);

    // history retained (v1 + v2), never overwritten
    const history = svc.history();
    assert.equal(history.length, 2);
    assert.ok(history.some((v) => v.versionTag === "v1"));

    // candidate now decided
    assert.equal(svc.pendingCandidates().length, 0);
  });

  test("rejection never activates", () => {
    const { svc } = setup();
    const active0 = svc.getActive();
    const c = svc.propose({ proposedDimensions: [extraDimension()], rationale: "maybe bad" });
    const res = svc.decide({ candidateId: c.candidateId, decision: "rejected", operator: "bufan", comment: "证据不足" });
    assert.equal(res.activatedVersion, undefined);
    assert.equal(res.candidate.status, "rejected");
    assert.equal(svc.getActive().versionId, active0.versionId);
    assert.equal(svc.history().length, 1);
  });

  test("a candidate cannot be decided twice (failed decide leaves no partial write)", () => {
    const { repo, svc } = setup();
    const c = svc.propose({ proposedDimensions: [extraDimension()], rationale: "x" });
    svc.decide({ candidateId: c.candidateId, decision: "approved", operator: "bufan" });
    assert.throws(
      () => svc.decide({ candidateId: c.candidateId, decision: "rejected", operator: "bufan" }),
      /not pending/,
    );
    // atomic: only v1 + v2 exist and the candidate stays approved
    assert.equal(repo.listMethodologies().length, 2);
    assert.equal(svc.getActive().versionTag, "v2");
    assert.equal(repo.getMethodologyCandidate(c.candidateId)!.status, "approved");
  });

  test("repository.transaction rolls back on throw", () => {
    const { repo } = setup();
    const before = repo.listMethodologies().length;
    assert.throws(
      () =>
        repo.transaction(() => {
          repo.upsertMethodology({
            versionId: "mw-tx",
            versionTag: "tx",
            dimensions: [],
            isHumanApprovedBaseline: true,
            createdAt: "2026-01-01T00:00:00.000Z",
          });
          throw new Error("boom");
        }),
      /boom/,
    );
    assert.equal(repo.listMethodologies().length, before);
  });
});

describe("P1 methodology drives ingest", () => {
  test("ingest uses the ACTIVE version dimensions, not the frozen constant", async () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const artifacts = new SqliteArtifactStore({ path: ":memory:" });
    const msvc = new MethodologyService(repo);
    msvc.getActive(); // bootstrap v1

    const c = msvc.propose({
      proposedDimensions: [...METHODOLOGY_V1.dimensions, extraDimension()],
      rationale: "补齐供应链安全维度",
    });
    msvc.decide({ candidateId: c.candidateId, decision: "approved", operator: "bufan" });
    assert.equal(msvc.getActive().dimensions.length, 13);

    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "新能源" });
    // built from v2 (13 dims), proving ingest no longer uses the constant
    assert.equal(res.questionCount, 13);
    assert.equal(res.requirementCount, 13);
    db.close();
  });
});
