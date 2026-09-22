/**
 * Phase 2A research-memory foundation tests.
 * T1 InformationRequirement lifecycle
 * T2 ResearchGap lifecycle
 * T3 InformationPool vs Knowledge invariant
 * T4 Methodology v1 loads
 * T8 Echo provider not mislabeled as real external data
 * T9 old claim never overwritten by new evidence
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { METHODOLOGY_V1 } from "./methodology/methodology-v1.js";
import type {
  InformationRequirement,
  ResearchGap,
  Claim,
} from "./domain/index.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  return { db, repo, artifacts };
}

describe("T4 Methodology v1", () => {
  test("is a human-approved baseline with 12 dimensions", () => {
    assert.equal(METHODOLOGY_V1.versionTag, "v1");
    assert.equal(METHODOLOGY_V1.isHumanApprovedBaseline, true);
    assert.equal(METHODOLOGY_V1.dimensions.length, 12);
    const keys = METHODOLOGY_V1.dimensions.map((d) => d.key);
    for (const k of ["market", "market_growth", "demand", "supply", "competition",
      "technology", "industry_chain", "business_model", "profitability",
      "policy", "risk", "key_validation"]) {
      assert.ok(keys.includes(k), `missing dimension ${k}`);
    }
    for (const d of METHODOLOGY_V1.dimensions) {
      assert.ok(d.requiredInfo && d.confirmedCondition && d.uncertainCondition && d.unknownCondition);
    }
  });
});

describe("T8 Echo provider", () => {
  test("flags every observation as non-real placeholder", async () => {
    const p = new EchoDataProvider();
    const obs = await p.retrieve({
      purpose: "initial",
      subjectKind: "industry",
      subjectId: "ind-x",
      subjectName: "机器人",
      metrics: ["market", "demand"],
    });
    assert.equal(obs.isRealExternalData, false);
    assert.equal(obs.sourceType, "echo_placeholder");
    assert.ok(obs.claims.every((c) => c.statement.includes("echo-placeholder")));
  });
});

describe("T1 InformationRequirement lifecycle", () => {
  test("upsert + list by subject", () => {
    const { db, repo } = setup();
    const req: InformationRequirement = {
      requirementId: `ir-${randomUUID()}`,
      questionId: "q-1",
      subjectKind: "industry",
      subjectId: "ind-1",
      dimension: "market",
      description: "TAM",
      importance: 8,
      requiredEvidenceType: "number",
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repo.upsertRequirement(req);
    const listed = repo.listRequirements("ind-1");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.status, "open");
    db.close();
  });
});

describe("T2 ResearchGap lifecycle", () => {
  test("upsert + list by subject", () => {
    const { db, repo } = setup();
    const gap: ResearchGap = {
      gapId: `gap-${randomUUID()}`,
      subjectKind: "industry",
      subjectId: "ind-1",
      description: "需求未知",
      importance: 7,
      uncertainty: 0.8,
      relatedRequirementIds: ["ir-1"],
      relatedQuestionIds: ["q-1"],
      status: "open",
      discoveredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repo.upsertGap(gap);
    const listed = repo.listGaps("ind-1");
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0]?.relatedRequirementIds, ["ir-1"]);
    db.close();
  });
});

describe("T3 InformationPool vs Knowledge invariant", () => {
  test("Pool tracks coverage; Knowledge claims live as separate Artifacts, not two homogeneous tables", async () => {
    const { db, repo, artifacts } = setup();
    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "新能源" });

    // Pool entries exist and track status/coverage
    const pool = repo.listPoolEntries(res.industry.industryId);
    assert.ok(pool.length >= 12);
    for (const e of pool) {
      assert.ok(["unknown", "partial", "confirmed", "conflict"].includes(e.status));
      // Pool entry is coverage metadata, NOT a claim statement
      assert.equal(typeof e.topic, "string");
      assert.equal((e as any).statement, undefined);
    }

    // Knowledge claims are separate Artifacts (kind=claim) with subjectKind/subjectId
    const claimArtifacts = await artifacts.listByRun("ingest-nope").catch(() => [] as any[]);
    void claimArtifacts;
    // directly read a claim blob via known artfactStore roundtrip
    const state = repo.getStateBySubject("industry", res.industry.industryId);
    assert.ok(state);
    assert.ok(state.known.length > 0, "state.known should reference claim artifacts");
    const a = await artifacts.get(state.known[0]!.ref);
    assert.ok(a);
    const blob = a.blob as Claim;
    assert.equal(blob.subjectKind, "industry");
    assert.equal(blob.subjectId, res.industry.industryId);
    assert.equal(typeof blob.statement, "string");
    db.close();
  });
});

describe("T9 old claim never overwritten", () => {
  test("supersede retains old claim (temporalRelation=old) and adds new current", async () => {
    const { db, repo, artifacts } = setup();
    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "固态电池" });
    const firstClaimRef = res.state.known[0]!.ref;

    const { oldClaimId, newClaimId } = await svc.supersedeClaim({
      oldClaimId: firstClaimRef,
      newStatement: "新证据：实际订单低于预期",
      subjectKind: "industry",
      subjectId: res.industry.industryId,
    });

    const oldAfter = await artifacts.get(oldClaimId);
    const newAfter = await artifacts.get(newClaimId);
    assert.ok(oldAfter, "old claim must still exist");
    assert.ok(newAfter, "new claim must exist");
    assert.equal((oldAfter!.blob as Claim).temporalRelation, "old");
    assert.equal((newAfter!.blob as Claim).temporalRelation, "current");
    assert.notEqual(oldClaimId, newClaimId);
    db.close();
  });
});
