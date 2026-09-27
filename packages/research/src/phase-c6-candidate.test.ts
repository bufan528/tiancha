/**
 * C6 slice ② acceptance — claim candidates: identity, extraction runs, lineage.
 *
 *   T-C6-6a  the SAME extraction config re-run REUSES ids (no duplicate candidates)
 *   T-C6-6b  a NEW config produces NEW candidates + `supersedesCandidateRef` lineage
 *   T-C6-6c  an existing candidate is NEVER overwritten (a human edit survives any re-run)
 *   T-C6-6d  fresh candidates are `draft` / `projectionStatus = none` / NO relation
 *   T-C6-6e  I-C6-4: creating candidates changes NOTHING downstream (Pool / Gap / Evaluation input)
 *   T-C6-6f  a throwing extractor is recorded as a FAILED run carrying its error, with no candidates
 *   T-C6-6g  a draft without evidence (or with an empty statement) is rejected
 *   T-C6-6h  I-C6-8: `isProjectable` needs BOTH a non-draft status AND an explicit relation
 *   §C6.7    the same block+dimension under a different config ⇒ a DIFFERENT candidate id
 *
 * Assertions are behavioural: row counts, ids, statuses, fingerprints — never log wording.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { MaterialVersionService } from "./application/material-version-service.js";
import {
  CandidateExtractionService,
  ExplicitBlockExtractor,
  type CandidateDraft,
} from "./application/candidate-extraction-service.js";
import { isProjectable, type ClaimCandidate, type CandidateContentKind } from "./domain/claim-candidate.js";
import { sha256Hex } from "./domain/material-source.js";

const AT = "2026-09-27T00:00:00.000Z";
const AT2 = "2026-09-27T01:00:00.000Z";
const AT3 = "2026-09-27T02:00:00.000Z";
const AT4 = "2026-09-27T03:00:00.000Z";
const AT5 = "2026-09-27T04:00:00.000Z";

// Paragraph 0 and 1 carry the statements; the [CANDIDATE] blocks are paragraphs 2 and 3.
const RAW = [
  "第一段：市场规模约 500 亿元。",
  "第二段：头部客户开始小批量采购。",
  "[CANDIDATE]",
  "dimension: market",
  "kind: fact",
  "statement: 2025 年全球出货约 2.5 万台",
  "confidence: 0.6",
  "evidence: paragraph:0",
  "[/CANDIDATE]",
  "[CANDIDATE]",
  "dimension: demand",
  "kind: judgment",
  "statement: 头部客户可能开始小批量采购",
  "evidence: paragraph:1",
  "[/CANDIDATE]",
  "",
].join("\n\n");

interface Env {
  db: ResearchDb;
  repo: ResearchRepository;
  svc: MaterialVersionService;
  x: CandidateExtractionService;
}

function seedMaterial(repo: ResearchRepository, rawText: string = RAW): string {
  repo.upsertMaterial({
    materialId: "mat-1",
    subjectKind: "industry",
    subjectId: "ind-1",
    kind: "text",
    title: "report.md",
    contentHash: sha256Hex(rawText),
    rawText,
    claimRefs: [],
    receivedAt: AT,
    createdAt: AT,
    ingestStatus: "completed",
    ingestAttempts: 1,
    ingestGeneration: 1,
    ingestBlocks: [],
    ingestOverlaps: [],
  });
  return "mat-1";
}

function env(): Env {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const svc = new MaterialVersionService(repo);
  const extractor = new ExplicitBlockExtractor(repo);
  return { db, repo, svc, x: new CandidateExtractionService(repo, extractor) };
}

function versionOf(e: Env, rawText: string = RAW) {
  seedMaterial(e.repo, rawText);
  return e.svc.registerVersion({ materialId: "mat-1", rawText, createdAt: AT }).version;
}

/** Downstream fingerprint: everything a candidate must NOT be able to touch (I-C6-4). */
function downstreamFingerprint(db: ResearchDb): string {
  const tables = [
    "industry_knowledge",
    "knowledge_belief",
    "knowledge_conflict",
    "information_pool_slot",
    "information_pool_item",
    "research_gap",
    "next_action",
    "investment_evaluation",
    "report_snapshot",
  ];
  return tables
    .map((t) => `${t}=${(db.db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c}`)
    .join("|");
}

describe("T-C6-6 — candidate identity, runs and lineage", () => {
  test("T-C6-6a: the same extraction config re-run REUSES ids and creates no duplicates", () => {
    const e = env();
    const version = versionOf(e);

    const r1 = e.x.run(version, AT);
    assert.equal(r1.status, "completed");
    assert.equal(r1.created, 2);
    assert.equal(r1.reused, 0);

    const r2 = e.x.run(version, AT2);
    assert.equal(r2.created, 0, "a re-run with the SAME config must not create candidates");
    assert.equal(r2.reused, 2);
    assert.deepEqual(r2.candidateIds, r1.candidateIds);
    assert.equal(e.repo.listClaimCandidates(version.materialVersionId).length, 2);
    // the second run is its own audit row, and it is recorded as completed
    assert.equal(e.repo.listExtractionRuns(version.materialVersionId).length, 2);
    assert.equal(e.repo.getExtractionRun(r2.extractionId)?.status, "completed");
  });

  test("T-C6-6b: a NEW config creates NEW candidates and links them by lineage", () => {
    const e = env();
    const version = versionOf(e);
    const r1 = e.x.run(version, AT);

    const v2 = new CandidateExtractionService(e.repo, new ExplicitBlockExtractor(e.repo), {
      parserVersion: "candidate-parser/v2",
    });
    assert.notEqual(v2.extractionConfigKey, e.x.extractionConfigKey);

    const r2 = v2.run(version, AT2);
    assert.equal(r2.created, 2, "a new config must produce its own candidates");
    assert.equal(e.repo.listClaimCandidates(version.materialVersionId).length, 4);

    for (const id of r2.candidateIds) assert.ok(!r1.candidateIds.includes(id), "ids must differ per config");
    const newer = e.repo.getClaimCandidate(r2.candidateIds[0]);
    assert.ok(newer !== undefined);
    assert.ok(
      newer.supersedesCandidateRef !== undefined && r1.candidateIds.includes(newer.supersedesCandidateRef),
      "a candidate from a new config must point back at its predecessor",
    );
    // ...and the predecessor itself is untouched
    assert.equal(e.repo.getClaimCandidate(r1.candidateIds[0])?.supersedesCandidateRef, undefined);
  });

  test("T-C6-6c: an existing candidate is NEVER overwritten (a human edit survives a re-run)", () => {
    const e = env();
    const version = versionOf(e);
    const r1 = e.x.run(version, AT);
    const id = r1.candidateIds[0];
    const original = e.repo.getClaimCandidate(id);
    assert.ok(original !== undefined);

    // simulate what a human review will do in slice ③: a different statement + a revision status
    const humanEdit: ClaimCandidate = {
      ...original,
      statement: "人工改过的说法：出货约 2.5 万台（口径待核）",
      reviewStatus: "revised",
      decisionRelation: "REVISE",
      reviewedBy: "analyst",
      reviewedAt: AT2,
    };
    e.repo.insertClaimCandidate(humanEdit);

    const after = e.repo.getClaimCandidate(id);
    assert.ok(after !== undefined);
    assert.equal(after.statement, original.statement, "insert-only: a stored candidate is not rewritten");
    assert.equal(after.reviewStatus, "draft");
    assert.equal(after.decisionRelation, undefined);

    // and a full re-run still leaves it alone
    const r2 = e.x.run(version, AT3);
    assert.equal(r2.reused, 2);
    assert.equal(e.repo.getClaimCandidate(id)?.statement, original.statement);
  });

  test("T-C6-6d: fresh candidates are draft / projectionStatus none / carry NO relation", () => {
    const e = env();
    const version = versionOf(e);
    const r = e.x.run(version, AT);
    for (const id of r.candidateIds) {
      const c = e.repo.getClaimCandidate(id);
      assert.ok(c !== undefined);
      assert.equal(c.reviewStatus, "draft");
      assert.equal(c.projectionStatus, "none");
      assert.equal(c.decisionRelation, undefined);
      assert.equal(c.confirmedClaimRef, undefined);
      assert.ok(c.evidenceRefs.length >= 1, "every candidate must point at evidence");
      assert.equal(c.subjectKind, "industry");
      assert.equal(c.subjectId, "ind-1");
      assert.ok(c.contentKind === "fact" || c.contentKind === "judgment");
    }
    // the parsed content is faithful to the blocks
    const byDim = new Map(r.candidateIds.map((id) => [e.repo.getClaimCandidate(id)!.dimension, e.repo.getClaimCandidate(id)!]));
    assert.equal(byDim.get("market")?.contentKind, "fact");
    assert.equal(byDim.get("market")?.confidence, 0.6);
    assert.equal(byDim.get("demand")?.contentKind, "judgment");
    assert.equal(byDim.get("demand")?.confidence, undefined);
  });

  test("T-C6-6e: I-C6-4 — creating candidates changes NOTHING downstream", () => {
    const e = env();
    const version = versionOf(e);
    const before = downstreamFingerprint(e.db);
    const r = e.x.run(version, AT);
    assert.equal(r.created, 2);
    assert.equal(downstreamFingerprint(e.db), before, "candidates must not reach Pool / Gap / Evaluation");
    // and they are not visible as beliefs either
    assert.equal(
      (e.db.db.prepare("SELECT COUNT(*) AS c FROM knowledge_belief").get() as { c: number }).c,
      0,
    );
  });

  test("T-C6-6f: a throwing extractor is recorded as a FAILED run with its error and no candidates", () => {
    const e = env();
    const version = versionOf(e);
    const boom = new CandidateExtractionService(e.repo, {
      modelVersion: "none",
      promptVersion: "none",
      extract: () => {
        throw new Error("extractor exploded");
      },
    });
    const r = boom.run(version, AT);
    assert.equal(r.status, "failed");
    assert.equal(r.created, 0);
    assert.equal(r.error, "extractor exploded");
    const run = e.repo.getExtractionRun(r.extractionId);
    assert.equal(run?.status, "failed");
    assert.equal(run?.error, "extractor exploded");
    assert.deepEqual(run?.candidateIds, []);
    assert.equal(e.repo.listClaimCandidates(version.materialVersionId).length, 0);
  });

  test("T-C6-6g: a draft without evidence, or with an empty statement, is rejected", () => {
    const e = env();
    const version = versionOf(e);
    const cases: CandidateDraft[][] = [
      [{ dimension: "market", statement: "x", contentKind: "fact", evidenceRefs: [] }],
      [{ dimension: "market", statement: "   ", contentKind: "fact", evidenceRefs: ["ev-1"] }],
      [{ dimension: "", statement: "x", contentKind: "fact", evidenceRefs: ["ev-1"] }],
    ];
    for (const drafts of cases) {
      const svc = new CandidateExtractionService(e.repo, {
        modelVersion: "none",
        promptVersion: "none",
        extract: () => drafts,
      });
      const r = svc.run(version, AT);
      assert.equal(r.status, "failed", JSON.stringify(drafts));
      assert.equal(e.repo.listClaimCandidates(version.materialVersionId).length, 0);
    }
  });

  test("T-C6-6h: I-C6-8 — isProjectable needs a non-draft status AND an explicit relation", () => {
    const e = env();
    const version = versionOf(e);
    const r = e.x.run(version, AT);
    const c = e.repo.getClaimCandidate(r.candidateIds[0]);
    assert.ok(c !== undefined);

    assert.equal(isProjectable(c), false, "draft candidate is not projectable");
    assert.equal(
      isProjectable({ ...c, reviewStatus: "confirmed" }),
      false,
      "★ confirmed WITHOUT a relation is still not projectable",
    );
    assert.equal(
      isProjectable({ ...c, decisionRelation: "SUPPORT" }),
      false,
      "★ a relation without a non-draft status is not projectable either",
    );
    assert.equal(isProjectable({ ...c, reviewStatus: "confirmed", decisionRelation: "SUPPORT" }), true);
    assert.equal(isProjectable({ ...c, reviewStatus: "revised", decisionRelation: "REVISE" }), true);
    assert.equal(isProjectable({ ...c, reviewStatus: "rejected", decisionRelation: "SUPPORT" }), false);
  });

  test("§C6.7 — identity covers block, dimension AND config; the review trail is append-only", () => {
    const e = env();
    const version = versionOf(e);
    const r = e.x.run(version, AT);

    // the extraction config key is part of identity
    const sameBlock = r.candidateIds[0];
    const otherConfig = new CandidateExtractionService(e.repo, new ExplicitBlockExtractor(e.repo), {
      schemaVersion: "candidate-schema/v2",
    });
    assert.notEqual(otherConfig.extractionConfigKey, e.x.extractionConfigKey);
    const r2 = otherConfig.run(version, AT2);
    assert.ok(!r2.candidateIds.includes(sameBlock));

    // reviews append; the same (candidate, action, at) does not duplicate
    const review = { reviewId: "crev-x", candidateId: sameBlock, action: "edit" as const, operator: "analyst", at: AT2 };
    e.repo.insertCandidateReview(review);
    e.repo.insertCandidateReview(review);
    assert.equal(e.repo.listCandidateReviews(sameBlock).length, 1);

    // the three new tables exist next to the rest of the schema
    const names = (
      e.db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((x) => x.name);
    for (const t of ["claim_candidate", "candidate_review", "extraction_run"]) assert.ok(names.includes(t), t);
    assert.equal(names.length, 32, "26 + 3 (slice 1) + 3 (slice 2)");
  });
});

// keep the type import used even if a refactor drops the map above
const _contentKindCheck: CandidateContentKind = "fact";
void _contentKindCheck;


// ---------------------------------------------------------------------------
// Candidate identity for REPEATED text + evidence validation (review follow-up)
// ---------------------------------------------------------------------------

const REPEATED = [
  "\u7b2c\u4e00\u6bb5\uff1a\u5e02\u573a\u89c4\u6a21\u7ea6 500 \u4ebf\u5143\u3002",
  "\u7b2c\u4e8c\u6bb5\uff1a\u53e6\u4e00\u4efd\u53e3\u5f84\u4e5f\u6307\u5411\u540c\u4e00\u4e2a\u6570\u5b57\u3002",
  "[\u0043ANDIDATE]",
  "dimension: market",
  "kind: fact",
  "statement: 2025 \u5e74\u5168\u7403\u51fa\u8d27\u7ea6 2.5 \u4e07\u53f0",
  "evidence: paragraph:0",
  "[/\u0043ANDIDATE]",
  "[\u0043ANDIDATE]",
  "dimension: market",
  "kind: fact",
  "statement: 2025 \u5e74\u5168\u7403\u51fa\u8d27\u7ea6 2.5 \u4e07\u53f0",
  "evidence: paragraph:1",
  "[/\u0043ANDIDATE]",
  "",
].join("\n\n");

describe("candidate identity for repeated text, and evidence validation", () => {
  test("T-C6-12: the SAME statement in two places yields ONE candidate that keeps BOTH sources", () => {
    const e = env();
    const version = versionOf(e, REPEATED);
    const r = e.x.run(version, AT);

    // one candidate (identity is (version, blockHash, dimension, config)) ...
    assert.equal(r.created, 1, "the same statement is one candidate, not two");
    assert.equal(e.repo.listClaimCandidates(version.materialVersionId).length, 1);

    // ...but the SECOND occurrence is not lost: its evidence is merged in
    const candidate = e.repo.getClaimCandidate(r.candidateIds[0]);
    assert.ok(candidate !== undefined);
    assert.equal(candidate.evidenceRefs.length, 2, "\u2605 both source locations are kept");
    assert.equal(r.merged, 1, "the merge is reported, not silent");

    // a further re-run changes nothing
    const again = e.x.run(version, AT2);
    assert.equal(again.created, 0);
    assert.equal(again.merged, 0);
    assert.equal(e.repo.getClaimCandidate(r.candidateIds[0])?.evidenceRefs.length, 2);
  });

  test("T-C6-13: a draft citing non-existent evidence is refused (a model may not invent sources)", () => {
    const e = env();
    const version = versionOf(e);
    const svc = new CandidateExtractionService(e.repo, {
      modelVersion: "none",
      promptVersion: "none",
      extract: () => [
        {
          dimension: "market",
          statement: "x",
          contentKind: "fact" as CandidateContentKind,
          evidenceRefs: ["ev-does-not-exist"],
        },
      ],
    });
    const r = svc.run(version, AT);
    assert.equal(r.status, "failed");
    assert.match(r.error ?? "", /does not exist/);
    assert.equal(e.repo.listClaimCandidates(version.materialVersionId).length, 0);
  });
});
