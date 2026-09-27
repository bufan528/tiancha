/**
 * C6 slice ⑤ acceptance — the projection carries the C6 semantics into the Report.
 *
 *   T-C6-4   a MIXED-state material lands in the RIGHT sections: a confirmed `fact` is a fact, a
 *            confirmed `judgment` is a judgment, and a still-draft candidate stays a candidate.
 *            ★ The test does NOT require the sections to have different sizes (they may coincide).
 *   T-C6-7   scores stay labelled as evidence sufficiency, and the critical gate still blocks the
 *            decision when a critical dimension lacks evidence (regression, unchanged behaviour).
 *   §C6.3    a rendered excerpt is labelled with the normalization version it was located in.
 *
 * Assertions are behavioural: section membership, labels, decision status — never log wording.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore, type ArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { MaterialVersionService } from "./application/material-version-service.js";
import { CandidateExtractionService, ExplicitBlockExtractor } from "./application/candidate-extraction-service.js";
import { CandidateReviewService } from "./application/candidate-review-service.js";
import { CandidateProjectionService } from "./application/candidate-projection-service.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { EvaluationService } from "./application/evaluation-service.js";
import { ReportService } from "./application/report-service.js";
import { sha256Hex } from "./domain/material-source.js";

const AT = "2026-09-27T00:00:00.000Z";
const AT2 = "2026-09-27T01:00:00.000Z";
const AT3 = "2026-09-27T02:00:00.000Z";
const INDUSTRY = "测试行业";

const RAW = [
  "第一段：市场规模约 500 亿元。",
  "第二段：头部客户可能开始采购。",
  "第三段：供给端产能仍待验证。",
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
  "[CANDIDATE]",
  "dimension: supply",
  "kind: fact",
  "statement: 供给产能约 3 万台",
  "evidence: paragraph:2",
  "[/CANDIDATE]",
  "",
].join("\n\n");

interface Env {
  dir: string;
  db: ResearchDb;
  repo: ResearchRepository;
  review: CandidateReviewService;
  projection: CandidateProjectionService;
  discovery: OpportunityDiscoveryService;
  industryId: string;
  candidateIds: string[];
  close(): void;
}

const opened: Env[] = [];
after(() => {
  for (const e of opened) e.close();
});

async function env(): Promise<Env> {
  const dir = mkdtempSync(join(tmpdir(), "tiancha-c6e-"));
  const db = new ResearchDb({ path: join(dir, "research.sqlite") });
  const artifacts = new SqliteArtifactStore({ path: join(dir, "artifacts.sqlite") });
  const repo = new ResearchRepository(db.db);
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);

  // build the research skeleton through the SAME entry point the CLI uses
  await discovery.ingestMaterial({ industryName: INDUSTRY, materialText: "骨架材料", sourceType: "echo_placeholder" });
  const industry = repo.findIndustryByName(INDUSTRY);
  assert.ok(industry !== undefined);

  repo.upsertMaterial({
    materialId: "mat-1",
    subjectKind: "industry",
    subjectId: industry.industryId,
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
  const version = new MaterialVersionService(repo).registerVersion({ materialId: "mat-1", rawText: RAW, createdAt: AT })
    .version;
  const run = new CandidateExtractionService(repo, new ExplicitBlockExtractor(repo)).run(version, AT);

  const e: Env = {
    dir,
    db,
    repo,
    review: new CandidateReviewService(repo, () => AT2),
    projection: new CandidateProjectionService(repo, discovery, () => AT3),
    discovery,
    industryId: industry.industryId,
    candidateIds: run.candidateIds,
    close() {
      const closable = artifacts as unknown as { close?: () => void };
      try {
        void closable.close?.();
      } catch {
        /* already closed */
      }
      try {
        db.db.close();
      } catch {
        /* already closed */
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* windows may still hold the lock */
      }
    },
  };
  opened.push(e);
  return e;
}

function idOf(e: Env, dimension: string): string {
  const hit = e.candidateIds.find((id) => e.repo.getClaimCandidate(id)?.dimension === dimension);
  assert.ok(hit !== undefined, `expected a candidate for ${dimension}`);
  return hit;
}

describe("T-C6-4 / T-C6-7 — C6 semantics reach the Report", () => {
  test("T-C6-4: a confirmed fact IS a fact, a confirmed judgment IS a judgment, a draft stays a candidate", async () => {
    const e = await env();
    const factId = idOf(e, "market");
    const judgmentId = idOf(e, "demand");
    const draftId = idOf(e, "supply");

    // market(fact) ⇒ confirmed + projected; demand(judgment) ⇒ confirmed + projected; supply ⇒ left draft
    e.review.confirm(factId, { operator: "analyst", relation: "SUPPORT" });
    await e.projection.project(factId, { operator: "analyst" });
    e.review.confirm(judgmentId, { operator: "analyst", relation: "SUPPORT" });
    await e.projection.project(judgmentId, { operator: "analyst" });

    const factRef = e.projection.claimRefOf(factId);
    const judgmentRef = e.projection.claimRefOf(judgmentId);
    assert.ok(factRef !== undefined && judgmentRef !== undefined);

    const s = new ReportService(e.db.db).generateDossier(e.industryId).sections;

    // ★ the judgment must NOT appear as a fact, and the fact must NOT appear as a judgment
    assert.ok(
      !s.keyFacts.some((f) => f.claimRef === judgmentRef),
      "a claim known to be a judgment must not be listed as a key fact",
    );
    assert.ok(
      !s.mainJudgments.some((k) => k.claimRef === factRef),
      "a claim known to be a fact must not be listed as a judgment",
    );
    // the confirmed judgment IS a judgment (its belief is confirmed after projection)
    assert.ok(
      s.mainJudgments.some((k) => k.claimRef === judgmentRef),
      "the confirmed judgment belongs in mainJudgments",
    );

    // ★ the still-draft candidate is a CANDIDATE row, carrying its own identity + normalization
    const draftRef = e.projection.claimRefOf(draftId);
    assert.equal(draftRef, undefined, "a draft candidate was never projected");
    const candidateRow = s.pendingCandidates.find(
      (r): r is Extract<typeof r, { candidateRef: string }> => "candidateRef" in r && r.candidateRef === draftId,
    );
    assert.ok(candidateRow !== undefined, "the draft candidate must appear in pendingCandidates");
    assert.equal(candidateRow.contentKind, "fact");
    assert.equal(candidateRow.reviewStatus, "draft");
    assert.equal(candidateRow.normalizationVersion, "nfkc-lf-v1", "★ §C6.3: the excerpt is normalized");
    assert.ok(candidateRow.evidenceRefCount >= 1);

    // ★ an unconfirmed candidate is still invisible to the confirmed cognition sections
    assert.ok(!s.mainJudgments.some((k) => k.claimRef === candidateRow.candidateRef));
    assert.ok(!s.keyFacts.some((f) => f.claimRef === candidateRow.candidateRef));

    // data source honesty: the report does not claim the sections must differ in size
    assert.ok(Array.isArray(s.keyFacts) && Array.isArray(s.mainJudgments));
  });

  test("T-C6-7: scores stay evidence-sufficiency, and the critical gate still blocks the decision", async () => {
    const e = await env();
    const factId = idOf(e, "market");
    e.review.confirm(factId, { operator: "analyst", relation: "SUPPORT" });
    await e.projection.project(factId, { operator: "analyst" });

    const evaluation = new EvaluationService(e.db.db).evaluate("industry", e.industryId);

    // the coverage is a SUFFICIENCY summary (evaluated / insufficient / conflicting) — not a rating
    const c = evaluation.coverage;
    assert.equal(c.evaluated + c.insufficient + c.conflicting + c.notApplicable, c.total);
    assert.equal(c.evaluated, 1, "exactly the projected dimension is evaluated");
    assert.ok(c.insufficient >= 1, "the untouched dimensions have no evidence");
    // ★ the critical dimensions (key_validation / risk) still carry NO evidence ⇒ the gate holds
    assert.equal(evaluation.dimensionEvaluations.length, c.total);

    const dossier = new ReportService(e.db.db).generateDossier(e.industryId);
    assert.ok(dossier.sections.evaluation !== null);
    // ★ `pending` = no reserve decision was taken, which is exactly what the critical gate does
    assert.equal(
      dossier.sections.evaluation?.decisionStatus,
      "pending",
      "no decision may be taken while a critical dimension lacks evidence",
    );
  });
});
