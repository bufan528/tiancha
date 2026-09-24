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
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { METHODOLOGY_V1 } from "./methodology/methodology-v1.js";
import type {
  InformationRequirement,
  ResearchGap,
  Claim,
} from "./domain/index.js";
import type {
  DataProviderPort,
  DataObservation,
  DataRetrievalRequest,
} from "./ports/data-provider.port.js";

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
      confirmedCondition: "c",
      uncertainCondition: "u",
      unknownCondition: "n",
      preferredPositionKinds: [],
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
      gapType: "unknown",
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
  test("echo placeholder never promotes pool/state; claims live as separate artifacts", async () => {
    const { db, repo, artifacts } = setup();
    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "新能源" });

    // Pool SLOTS exist and track status/coverage; echo never marks them partial
    const pool = repo.listPoolSlots(res.industry.industryId);
    assert.ok(pool.length >= 12);
    for (const s of pool) {
      assert.ok(["unknown", "partial", "sufficient", "conflicting"].includes(s.status));
      assert.equal(s.status, "unknown", "echo placeholder must not promote coverage");
      // S3: slots carry NO content; content lives in items (each pointing at a Claim)
      assert.equal(typeof s.dimension, "string");
      assert.equal(repo.listPoolItems(s.slotId).length, 0);
      assert.equal((s as any).statement, undefined);
    }

    // State keeps echo out of known/confirmed (Invariant 5)
    const state = repo.getStateBySubject("industry", res.industry.industryId);
    assert.ok(state);
    assert.equal(state.known.length, 0, "placeholder claims are not knowledge");
    assert.equal(state.unknown.length, 12);

    // Claims still live as separate Artifacts (kind=claim), not in Pool
    assert.ok(res.claimIds.length > 0);
    const a = await artifacts.get(res.claimIds[0]!);
    assert.ok(a);
    const blob = a.blob as Claim;
    assert.equal(blob.subjectKind, "industry");
    assert.equal(blob.subjectId, res.industry.industryId);
    assert.equal(typeof blob.statement, "string");
    assert.equal(blob.isRealExternalData, false);
    db.close();
  });
});

describe("T9 old claim never overwritten", () => {
  test("supersede retains old claim (temporalRelation=old) and adds new current", async () => {
    const { db, repo, artifacts } = setup();
    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "固态电池" });
    const firstClaimRef = res.claimIds[0]!;

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

// --- Phase 2C wiring: a real (non-placeholder) provider must flow into Knowledge ---

class RealDataProvider implements DataProviderPort {
  readonly name = "test-real";
  async retrieve(req: DataRetrievalRequest): Promise<DataObservation> {
    return {
      provider: "test-real",
      isRealExternalData: true,
      sourceType: "analyst_report",
      industryName: req.subjectName,
      fetchedAt: new Date().toISOString(),
      // only the first two dimensions have real evidence
      claims: req.metrics.slice(0, 2).map((m, i) => ({
        statement: `real signal for ${m}`,
        dimension: m,
        stance: "contextualize" as const,
        confidence: 0.8 - i * 0.1,
      })),
    };
  }
}

describe("Phase 2C ingest wiring (real data)", () => {
  test("real claims project into Knowledge, promote Pool to sufficient, flow to State and Gap", async () => {
    const { db, repo, artifacts } = setup();
    const svc = new OpportunityDiscoveryService(repo, new RealDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "人形机器人" });

    // Knowledge: two real claims become confirmed beliefs
    const knowledgeRepo = new KnowledgeRepository(db.db);
    const k = knowledgeRepo.findKnowledgeBySubject("industry", res.industry.industryId);
    assert.ok(k, "knowledge created for real claims");
    assert.equal(k.beliefs.length, 2);
    assert.equal(k.beliefs.every((b) => b.state === "confirmed"), true);

    // Pool (S4.5): the two covered dimensions reach `sufficient`; the rest stay unknown
    const pool = repo.listPoolSlots(res.industry.industryId);
    assert.equal(pool.filter((s) => s.status === "sufficient").length, 2);
    assert.equal(pool.filter((s) => s.status === "unknown").length, 10);

    // State: known = the two sufficient entries; unknown = the rest
    assert.equal(res.state.known.length, 2);
    assert.equal(res.state.unknown.length, 10);

    // Gaps (S4.5): only the 10 un-met dimensions keep an open gap — a sufficient
    // dimension CLOSES its gap, so this is deliberately no longer a constant 12.
    const gaps = repo.listGaps(res.industry.industryId).filter((g) => g.status === "open");
    assert.equal(gaps.length, 10);
    assert.equal(res.gapCount, 10);
    assert.equal(res.nextActionCount, 10);
    db.close();
  });

  test("ingestClaims backfills real claims and refreshes subject idempotently", async () => {
    const { db, repo, artifacts } = setup();
    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "具身智能" });
    const sid = res.industry.industryId;
    assert.equal(repo.listNextActions(sid).filter((a) => a.status === "open").length, 12);

    await svc.ingestClaims({
      subjectKind: "industry",
      subjectId: sid,
      claims: [
        { statement: "market real", dimension: "market", confidence: 0.8 },
        { statement: "demand real", dimension: "demand", confidence: 0.7 },
      ],
    });

    const knowledgeRepo = new KnowledgeRepository(db.db);
    const k = knowledgeRepo.findKnowledgeBySubject("industry", sid)!;
    assert.equal(k.beliefs.length, 2);
    // traceability: beliefs resolve to a real research_source row (Invariant 7)
    const srcRef = k.beliefs[0]!.sourceRef;
    assert.ok(srcRef, "belief carries a sourceRef");
    assert.ok(repo.getSource(srcRef!), "sourceRef resolves to a research_source row");

    const pool = repo.listPoolSlots(sid);
    assert.equal(pool.filter((s) => s.status === "sufficient").length, 2);
    assert.equal(pool.filter((s) => s.status === "unknown").length, 10);

    const state = repo.getStateBySubject("industry", sid)!;
    assert.equal(state.known.length, 2);
    assert.equal(state.unknown.length, 10);
    // S4.5: the two backfilled dimensions are now met -> their gaps resolve -> their
    // actions cancel, so the count drops from the ingest baseline of 12 to 10.
    assert.equal(repo.listGaps(sid).filter((g) => g.status === "open").length, 10);
    assert.equal(repo.listNextActions(sid).filter((a) => a.status === "open").length, 10);
    db.close();
  });

  test("backfill relation hints drive Evolution (REVISE/CONFLICT/SUPERSEDE), never overwrite", async () => {
    const { db, repo, artifacts } = setup();
    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const res = await svc.ingestMaterial({ materialText: "x", industryName: "低空经济" });
    const sid = res.industry.industryId;
    const kr = new KnowledgeRepository(db.db);

    // establish a belief on 'market'
    const first = await svc.ingestClaims({
      subjectKind: "industry",
      subjectId: sid,
      claims: [{ statement: "market v1", dimension: "market", confidence: 0.6 }],
    });
    const firstClaimRef = first.claimIds[0]!;
    let k = kr.findKnowledgeBySubject("industry", sid)!;
    assert.equal(k.beliefs.length, 1);
    assert.equal(k.beliefs[0].state, "confirmed");

    // REVISE: the NAMED target leaves current as `revised`, the new belief is confirmed (C-FIX-8)
    const reviseHint = { kind: "REVISE" as const, revisesClaimRef: firstClaimRef };
    await svc.ingestClaims({
      subjectKind: "industry",
      subjectId: sid,
      claims: [{ statement: "market v2", dimension: "market", confidence: 0.8, relationHint: reviseHint }],
    });
    k = kr.findKnowledgeBySubject("industry", sid)!;
    assert.equal(k.beliefs.filter((b) => b.state === "confirmed").length, 1, "current = the revised belief");
    assert.equal(
      kr.listBeliefs(k.knowledgeId).filter((b) => b.state === "revised").length,
      1,
      "history keeps the revised row",
    );

    // CONFLICT: dimension-level — nothing is picked, nothing is deleted (C-FIX-1)
    const conflicted = await svc.ingestClaims({
      subjectKind: "industry",
      subjectId: sid,
      claims: [{ statement: "market X", dimension: "market", relationHint: { kind: "CONFLICT" } }],
    });
    k = kr.findKnowledgeBySubject("industry", sid)!;
    assert.equal(kr.listOpenConflicts().length, 1);
    assert.deepEqual(k.beliefs, [], "no current cognition while the conflict is open");
    assert.ok(
      kr.listBeliefs(k.knowledgeId).filter((b) => b.state === "conflicting").length >= 2,
      "both sides retained as conflicting",
    );

    // SUPERSEDE of a CONFLICTING target (C-FIX-13): the evolution advances the cognition
    // WITHOUT closing the conflict event or picking a winner.
    const supersedeHint = {
      kind: "SUPERSEDE" as const,
      supersedesClaimRef: conflicted.claimIds[0]!,
    };
    await svc.ingestClaims({
      subjectKind: "industry",
      subjectId: sid,
      claims: [{ statement: "market final", dimension: "market", relationHint: supersedeHint }],
    });
    k = kr.findKnowledgeBySubject("industry", sid)!;
    const hist = kr.listBeliefs(k.knowledgeId);
    assert.ok(hist.some((b) => b.state === "superseded"), "the named target is superseded");
    assert.ok(hist.length >= 4, "history never deleted");
    assert.equal(kr.listOpenConflicts().length, 1, "the conflict EVENT is not auto-closed");
    assert.deepEqual(k.beliefs.map((b) => b.state), ["confirmed"], "only the new belief is current");
    db.close();
  });
});
