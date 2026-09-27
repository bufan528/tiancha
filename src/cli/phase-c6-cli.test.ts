/**
 * C6 slice ③ acceptance — the HUMAN GATE for claim candidates.
 *
 *   T-C6-7a  `confirm` REQUIRES a non-empty operator AND an explicit relation (I-C6-8)
 *   T-C6-7b  `confirm` records the decision and makes the candidate projectable — but writes NO Claim
 *   T-C6-7c  ★ `revise` EDITS content and KEEPS `draft` (editing is not accepting)
 *   T-C6-7d  `reject` is terminal and never projectable
 *   T-C6-7e  the review trail is append-only; a terminal candidate cannot be acted on twice
 *   T-C6-7f  I-C6-1 / I-C6-4: reviewing changes NOTHING downstream (no Claim / Belief / Pool / Gap)
 *   T-C6-7g  CLI refuses a missing --operator / --relation and prints a usage line
 *
 * Assertions are behavioural: statuses, row counts, downstream fingerprints, exit codes — not wording.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchDb } from "@tiancha/research";
import { ResearchRepository } from "@tiancha/research";
import { MaterialVersionService } from "@tiancha/research";
import { CandidateExtractionService, ExplicitBlockExtractor } from "@tiancha/research";
import { CandidateReviewService, CandidateReviewError } from "@tiancha/research";
import { isProjectable } from "@tiancha/research";
import { sha256Hex } from "@tiancha/research";

const AT = "2026-09-27T00:00:00.000Z";
const AT2 = "2026-09-27T01:00:00.000Z";
const AT3 = "2026-09-27T02:00:00.000Z";
const AT4 = "2026-09-27T03:00:00.000Z";

const RAW = [
  "第一段：市场规模约 500 亿元。",
  "第二段：头部客户开始小批量采购。",
  "[CANDIDATE]",
  "dimension: market",
  "kind: fact",
  "statement: 2025 年全球出货约 2.5 万台",
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
  review: CandidateReviewService;
  candidateIds: string[];
  industryId: string;
}

function env(): Env {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const versionSvc = new MaterialVersionService(repo);
  repo.upsertMaterial({
    materialId: "mat-1",
    subjectKind: "industry",
    subjectId: "ind-1",
    kind: "text",
    title: "report.md",
    contentHash: sha256Hex(RAW),
    rawText: RAW,
    claimRefs: [],
    receivedAt: AT,
    createdAt: AT,
    ingestStatus: "completed",
    ingestAttempts: 1,
    ingestGeneration: 1,
    ingestBlocks: [],
    ingestOverlaps: [],
  });
  const version = versionSvc.registerVersion({ materialId: "mat-1", rawText: RAW, createdAt: AT }).version;
  const extraction = new CandidateExtractionService(repo, new ExplicitBlockExtractor(repo));
  const run = extraction.run(version, AT);
  return {
    db,
    repo,
    review: new CandidateReviewService(repo, () => AT4),
    candidateIds: run.candidateIds,
    industryId: "ind-1",
  };
}

/** Everything a human review must NOT be able to touch (I-C6-1 / I-C6-4). */
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
    "research_state",
  ];
  return tables
    .map((t) => `${t}=${(db.db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c}`)
    .join("|");
}

describe("T-C6-7 — the human gate records decisions and nothing else", () => {
  test("T-C6-7a: confirm needs a non-empty operator AND an explicit relation", () => {
    const e = env();
    const id = e.candidateIds[0];
    assert.throws(() => e.review.confirm(id, { operator: "  ", relation: "SUPPORT" }), CandidateReviewError);
    assert.throws(
      () => e.review.confirm(id, { operator: "analyst", relation: "MAYBE" as never }),
      /--relation must be one of/,
    );
    // nothing was recorded by the refused calls
    assert.equal(e.repo.listCandidateReviews(id).length, 0);
    assert.equal(e.repo.getClaimCandidate(id)?.reviewStatus, "draft");
  });

  test("T-C6-7b: confirm stores the relation and makes it projectable, but writes NO Claim", () => {
    const e = env();
    const id = e.candidateIds[0];
    const before = downstreamFingerprint(e.db);

    const confirmed = e.review.confirm(id, { operator: "analyst", relation: "SUPPORT", comment: "口径与报告一致" });
    assert.equal(confirmed.reviewStatus, "confirmed");
    assert.equal(confirmed.decisionRelation, "SUPPORT");
    assert.equal(confirmed.reviewedBy, "analyst");
    assert.equal(isProjectable(confirmed), true, "confirmed + relation ⇒ projectable (slice 4 will project)");

    // ★ the confirmation is RECORDED only: no Claim / Belief / Pool / Gap / Evaluation moved
    assert.equal(downstreamFingerprint(e.db), before);
    assert.equal(confirmed.confirmedClaimRef, undefined, "slice 3 must not create a Claim ref");
    assert.equal(confirmed.projectionStatus, "none");
    // ...and the audit trail has exactly one row
    const reviews = e.repo.listCandidateReviews(id);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].action, "confirm");
    assert.equal(reviews[0].operator, "analyst");
    assert.deepEqual(reviews[0].after, { reviewStatus: "confirmed", decisionRelation: "SUPPORT" });
  });

  test("T-C6-7c: revise EDITS content and KEEPS the candidate a draft (editing ≠ accepting)", () => {
    const e = env();
    const id = e.candidateIds[0];
    const original = e.repo.getClaimCandidate(id);
    assert.ok(original !== undefined);

    const revised = e.review.revise(id, {
      operator: "analyst",
      statement: "人工修正：2025 年全球出货约 2.5 万台（口径待核）",
      contentKind: "judgment",
      comment: "口径需要再核",
    });
    assert.equal(revised.statement, "人工修正：2025 年全球出货约 2.5 万台（口径待核）");
    assert.equal(revised.contentKind, "judgment");
    // ★ still a draft, still without a relation ⇒ still NOT projectable
    assert.equal(revised.reviewStatus, "draft");
    assert.equal(revised.decisionRelation, undefined);
    assert.equal(isProjectable(revised), false);
    // the identity anchor is untouched
    assert.equal(revised.candidateId, id);
    assert.equal(revised.blockHash, original.blockHash);

    // and an edit with no actual change is refused
    assert.throws(() => e.review.revise(id, { operator: "analyst" }), /at least one of/);
  });

  test("T-C6-7d: reject is terminal and never projectable", () => {
    const e = env();
    const id = e.candidateIds[0];
    const rejected = e.review.reject(id, { operator: "analyst", comment: "来源不可靠" });
    assert.equal(rejected.reviewStatus, "rejected");
    assert.equal(rejected.decisionRelation, undefined);
    assert.equal(isProjectable(rejected), false);
    // a rejected candidate cannot be re-decided
    assert.throws(() => e.review.confirm(id, { operator: "analyst", relation: "SUPPORT" }), /only applies to a draft/);
    assert.throws(() => e.review.reject(id, { operator: "analyst" }), /only applies to a draft/);
  });

  test("T-C6-7e: the review trail is append-only and each action appends exactly one row", () => {
    const e = env();
    const [a, b] = e.candidateIds;
    e.review.revise(a, { operator: "analyst", statement: "edit one" });
    e.review.confirm(a, { operator: "analyst", relation: "REVISE" });
    e.review.reject(b, { operator: "analyst", comment: "no source" });

    const rowsA = e.repo.listCandidateReviews(a);
    assert.equal(rowsA.length, 2, "edit + confirm");
    assert.deepEqual(
      rowsA.map((r) => r.action),
      ["edit", "confirm"],
    );
    assert.equal(e.repo.listCandidateReviews(b).length, 1);
    // an earlier row is never rewritten
    assert.equal(rowsA[0].before?.statement, "2025 年全球出货约 2.5 万台");

    // show() returns the candidate together with its trail
    const shown = e.review.show(a);
    assert.equal(shown.candidate.reviewStatus, "confirmed");
    assert.equal(shown.reviews.length, 2);
  });

  test("T-C6-7f: I-C6-1 / I-C6-4 — every review action leaves the downstream state untouched", () => {
    const e = env();
    const before = downstreamFingerprint(e.db);
    const [a, b] = e.candidateIds;
    // order matters: `revise` only applies to a DRAFT, so edit BEFORE confirming
    e.review.revise(a, { operator: "analyst", statement: "changed" });
    e.review.confirm(a, { operator: "analyst", relation: "SUPPORT" });
    e.review.reject(b, { operator: "analyst" });
    assert.equal(downstreamFingerprint(e.db), before, "reviews must not reach Claim / Belief / Pool / Gap");
    // candidates themselves are still the only rows that changed
    assert.equal(
      (e.db.db.prepare("SELECT COUNT(*) AS c FROM claim_candidate").get() as { c: number }).c,
      2,
    );
  });

  test("list() filters by subject and by review status", () => {
    const e = env();
    const [a] = e.candidateIds;
    e.review.confirm(a, { operator: "analyst", relation: "SUPPORT" });
    assert.equal(e.review.list({ subjectKind: "industry", subjectId: "ind-1" }).length, 2);
    assert.equal(e.review.list({ subjectKind: "industry", subjectId: "ind-1", reviewStatus: "draft" }).length, 1);
    assert.equal(e.review.list({ subjectKind: "industry", subjectId: "ind-1", reviewStatus: "confirmed" }).length, 1);
    assert.equal(e.review.list({ subjectKind: "industry", subjectId: "other" }).length, 0);
    assert.throws(() => e.review.list({}), /provide either/);
  });

  test("T-C6-7g: the CLI refuses a missing --operator / --relation", () => {
    const home = mkdtempSync(join(tmpdir(), "tiancha-c6c-"));
    try {
      const run = (args: string[]) =>
        spawnSync(process.execPath, ["--import", "tsx", "src/cli/tiancha.ts", ...args], {
          encoding: "utf8",
          env: { ...process.env, USERPROFILE: home },
        });
      const noOperator = run(["research", "candidate", "confirm", "cand-x", "--relation", "SUPPORT"]);
      assert.equal(noOperator.status, 1);
      assert.match(noOperator.stderr, /--operator is required/);

      const noRelation = run(["research", "candidate", "confirm", "cand-x", "--operator", "analyst"]);
      assert.equal(noRelation.status, 1);
      assert.match(noRelation.stderr, /--relation is required/);

      const noUsage = run(["research", "candidate", "list"]);
      assert.equal(noUsage.status, 1);
      assert.match(noUsage.stderr, /usage: tiancha research candidate list/);

      const unknownId = run(["research", "candidate", "show", "cand-missing"]);
      assert.equal(unknownId.status, 1);
      assert.match(unknownId.stderr, /candidate not found/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
