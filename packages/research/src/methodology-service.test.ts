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
    weight: 0.07,
    criticality: "normal",
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
    const { candidate: c, resumeToken } = svc.propose({
      proposedDimensions: [...METHODOLOGY_V1.dimensions, extraDimension()],
      rationale: "某行业因缺少供应链维度而误判",
      evidenceRefs: ["artifact:claim/x"],
      createdBy: "agent",
    });
    assert.equal(c.status, "pending");
    assert.ok(resumeToken.length > 0, "propose issues an approval credential");
    assert.equal(svc.pendingCandidates().length, 1);
    // still v1: no activation without a human decision
    assert.equal(svc.getActive().versionId, METHODOLOGY_V1.versionId);
    assert.equal(svc.getActive().dimensions.length, 12);
  });

  test("decide without an operator throws (no human gate)", () => {
    const { svc } = setup();
    const { candidate: c } = svc.propose({ proposedDimensions: [...METHODOLOGY_V1.dimensions], rationale: "x" });
    assert.throws(
      () => svc.decide({ candidateId: c.candidateId, decision: "approved", operator: "" }),
      /human gate/,
    );
  });

  test("approval activates a NEW version and keeps the previous one", () => {
    const { svc } = setup();
    const active0 = svc.getActive();
    const { candidate: c } = svc.propose({
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
    const { candidate: c } = svc.propose({ proposedDimensions: [extraDimension()], rationale: "maybe bad" });
    const res = svc.decide({ candidateId: c.candidateId, decision: "rejected", operator: "bufan", comment: "证据不足" });
    assert.equal(res.activatedVersion, undefined);
    assert.equal(res.candidate.status, "rejected");
    assert.equal(svc.getActive().versionId, active0.versionId);
    assert.equal(svc.history().length, 1);
  });

  test("a candidate cannot be decided twice (failed decide leaves no partial write)", () => {
    const { repo, svc } = setup();
    const { candidate: c } = svc.propose({ proposedDimensions: [extraDimension()], rationale: "x" });
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

    const { candidate: c } = msvc.propose({
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

describe("P1 approval credential (human gate token)", () => {
  test("valid token approves and is consumed; a wrong token is rejected", () => {
    const { repo, svc } = setup();
    svc.getActive();
    const { candidate, resumeToken } = svc.propose({
      proposedDimensions: [extraDimension()],
      rationale: "r",
    });

    // wrong token: rejected, nothing decided
    assert.throws(
      () =>
        svc.decide({
          candidateId: candidate.candidateId,
          decision: "approved",
          operator: "bufan",
          resumeToken: "bogus",
        }),
      /resume token rejected/,
    );
    assert.equal(repo.getMethodologyCandidate(candidate.candidateId)!.status, "pending");

    // correct token: approval activates and the gate is consumed
    const res = svc.decide({
      candidateId: candidate.candidateId,
      decision: "approved",
      operator: "bufan",
      resumeToken,
    });
    assert.ok(res.activatedVersion);
    const gate = repo.getHumanGate(`gate-${candidate.candidateId}`)!;
    assert.equal(gate.status, "approved");
    assert.equal(gate.resumeTokenConsumed, true);
  });

  test("token is bound to its candidate: another candidate's token is rejected", () => {
    const { svc } = setup();
    svc.getActive();
    const a = svc.propose({ proposedDimensions: [extraDimension()], rationale: "a" });
    const b = svc.propose({ proposedDimensions: [extraDimension()], rationale: "b" });
    svc.decide({
      candidateId: a.candidate.candidateId,
      decision: "approved",
      operator: "bufan",
      resumeToken: a.resumeToken,
    });
    assert.throws(
      () =>
        svc.decide({
          candidateId: b.candidate.candidateId,
          decision: "approved",
          operator: "bufan",
          resumeToken: a.resumeToken,
        }),
      /resume token rejected/,
    );
  });
});

// --- S1: Methodology Extension + E1 -----------------------------------------

describe("S1 T-A1 Methodology Evaluation Policy (weight / criticality)", () => {
  test("weight + criticality round-trip through the DB for the active version", () => {
    const { svc } = setup();
    const active = svc.getActive();

    assert.equal(active.dimensions.length, 12);
    const risk = active.dimensions.find((d) => d.key === "risk")!;
    const keyValidation = active.dimensions.find((d) => d.key === "key_validation")!;
    const market = active.dimensions.find((d) => d.key === "market")!;
    assert.equal(risk.criticality, "critical");
    assert.equal(keyValidation.criticality, "critical");
    assert.equal(market.criticality, "normal");
    // weights come from the STORED version (not re-derived)
    assert.equal(market.weight, 0.1);
    const sum = active.dimensions.reduce((a, d) => a + d.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights should sum to 1, got ${sum}`);
  });
});

describe("S1 T-A2 E1 requirement importance + conditions from methodology", () => {
  test("ingest derives importance + conditions from the ACTIVE methodology (not constant 5)", async () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const artifacts = new SqliteArtifactStore({ path: ":memory:" });
    const msvc = new MethodologyService(repo);
    msvc.getActive(); // bootstrap v1

    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "新能源" });
    const reqs = repo.listRequirements(res.industry.industryId);

    const market = reqs.find((r) => r.dimension === "market")!;
    const supply = reqs.find((r) => r.dimension === "supply")!;
    // importance derived from weight (market 0.10 → 5, supply 0.06 → 3), NOT constant 5
    assert.equal(market.importance, 5);
    assert.equal(supply.importance, 3);
    // conditions inherited verbatim from the methodology dimension
    assert.equal(market.confirmedCondition, "至少 1 条可溯源 TAM + 结构拆分");
    assert.equal(market.uncertainCondition, "仅有单一来源或口径不一致");
    assert.equal(supply.unknownCondition, "无供给数据");
    assert.deepEqual(market.preferredPositionKinds, []);
    db.close();
  });

  test("importance follows the ACTIVE version when methodology changes", async () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const artifacts = new SqliteArtifactStore({ path: ":memory:" });
    const msvc = new MethodologyService(repo);
    msvc.getActive();

    // activate a version where "supply" is promoted to weight 0.10 (→ importance 5)
    const dims = METHODOLOGY_V1.dimensions.map((d) => (d.key === "supply" ? { ...d, weight: 0.1 } : d));
    const { candidate } = msvc.propose({ proposedDimensions: dims, rationale: "提高供给维度权重" });
    msvc.decide({ candidateId: candidate.candidateId, decision: "approved", operator: "bufan" });

    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "光伏" });
    const supply = repo.listRequirements(res.industry.industryId).find((r) => r.dimension === "supply")!;
    assert.equal(supply.importance, 5, "importance must follow the new ACTIVE version");
    db.close();
  });
});
