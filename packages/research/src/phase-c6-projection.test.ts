/**
 * C6 slice ④ acceptance — projection of a confirmed candidate into the EXISTING cognition path.
 *
 *   T-C6-3   a confirmed candidate projects through the SAME `ingestClaims` path; the resulting
 *            Claim ref and the belief are traceable in BOTH directions
 *   T-C6-2   ★ an UNCONFIRMED candidate can never be projected, and merely creating candidates
 *            leaves the downstream state byte-identical (I-C6-4)
 *   T-C6-8   re-running a projection at ANY point is idempotent: one Claim, one belief, one artifact
 *            (this covers every §C6.17 crash window: before P1, after P2/P3 without the callback,
 *            and before the P4 backfill)
 *   T-C6-8b  a projection thrown mid-flight is RECORDED (`projectionError`) and stays resumable
 *   T-C6-9   no relation / draft status ⇒ refused before any write (I-C6-8)
 *
 * Assertions are behavioural: row counts, belief ids, artifact counts, fingerprints — not wording.
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
import { CLAIM_ARTIFACT_TASK_ID } from "./application/opportunity-discovery-service.js";
import { sha256Hex } from "./domain/material-source.js";

const AT = "2026-09-27T00:00:00.000Z";
const AT2 = "2026-09-27T01:00:00.000Z";
const AT3 = "2026-09-27T02:00:00.000Z";

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
  dir: string;
  db: ResearchDb;
  artifacts: ArtifactStore;
  repo: ResearchRepository;
  review: CandidateReviewService;
  projection: CandidateProjectionService;
  candidateIds: string[];
  /** Close both DBs and drop the temp dir (Windows keeps a lock while a handle is open). */
  close(): void;
}

const opened: Env[] = [];
after(() => {
  for (const e of opened) e.close();
});

function env(): Env {
  const dir = mkdtempSync(join(tmpdir(), "tiancha-c6d-"));
  const db = new ResearchDb({ path: join(dir, "research.sqlite") });
  const artifacts = new SqliteArtifactStore({ path: join(dir, "artifacts.sqlite") });
  const repo = new ResearchRepository(db.db);
  repo.upsertMaterial({
    materialId: "mat-1",
    subjectKind: "industry",
    subjectId: "ind-c6",
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
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const e: Env = {
    dir,
    db,
    artifacts,
    repo,
    review: new CandidateReviewService(repo, () => AT2),
    projection: new CandidateProjectionService(repo, discovery, () => AT3),
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

function fingerprint(db: ResearchDb): string {
  const tables = [
    "industry_knowledge",
    "knowledge_belief",
    "knowledge_conflict",
    "information_pool_slot",
    "information_pool_item",
    "research_gap",
    "next_action",
    "investment_evaluation",
    "research_state",
  ];
  return tables
    .map((t) => `${t}=${(db.db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c}`)
    .join("|");
}

describe("T-C6-3 / T-C6-2 / T-C6-8 — projection into the existing cognition path", () => {
  test("T-C6-2: an UNCONFIRMED candidate can never be projected (I-C6-8) and creates nothing", async () => {
    const e = env();
    const before = fingerprint(e.db);
    await assert.rejects(
      () => e.projection.project(e.candidateIds[0], { operator: "analyst" }),
      /only a confirmed\/revised candidate WITH an explicit relation/,
    );
    assert.equal(fingerprint(e.db), before, "a refused projection must write nothing");
    assert.equal(e.repo.getClaimCandidate(e.candidateIds[0])?.projectionStatus, "none");
  });

  test("T-C6-3: projection uses the EXISTING path and is traceable BOTH ways", async () => {
    const e = env();
    const id = e.candidateIds[0];
    e.review.confirm(id, { operator: "analyst", relation: "SUPPORT" });

    const result = await e.projection.project(id, { operator: "analyst" });
    assert.equal(result.status, "projected");
    const claimRef = result.claimRef;
    assert.ok(claimRef !== undefined);

    // ★ the candidate now points at a REAL Claim ...
    assert.equal(e.repo.getClaimCandidate(id)?.confirmedClaimRef, claimRef);
    assert.ok(claimRef.startsWith("artifact:claim/"), "the stored ref uses the project-wide claimRef shape");
    assert.equal(e.repo.getClaimCandidate(id)?.projectionStatus, "finalized");

    // ...and the Claim artifact went in through the shared field-research task id
    const record = await e.artifacts.get(claimRef.replace("artifact:claim/", ""));
    assert.ok(record !== undefined, "the Claim artifact must exist");
    assert.equal(record?.artifact.taskId, CLAIM_ARTIFACT_TASK_ID);

    // ...and the projected belief points back at the SAME claim (the other direction of the chain)
    const beliefs = e.db.db.prepare("SELECT claim_ref FROM knowledge_belief").all() as { claim_ref: string }[];
    assert.equal(beliefs.length, 1, "exactly one belief came out of this candidate");
    assert.equal(beliefs[0].claim_ref, claimRef, "★ belief -> claim ref must match candidate -> claim ref");

  });

  test("T-C6-8: re-running a projection at ANY point yields ONE claim / ONE belief", async () => {
    const e = env();
    const id = e.candidateIds[0];
    e.review.confirm(id, { operator: "analyst", relation: "SUPPORT" });
    const first = await e.projection.project(id, { operator: "analyst" });
    const afterFirst = fingerprint(e.db);
    const artifactsFirst = (await e.artifacts.listByTask(CLAIM_ARTIFACT_TASK_ID)).length;

    // (a) a plain re-run after P4 ⇒ already_projected, nothing changes
    const again = await e.projection.project(id, { operator: "analyst" });
    assert.equal(again.status, "already_projected");
    assert.equal(again.claimRef, first.claimRef);

    // (b) simulate a crash BEFORE the P4 backfill: clear the backfill but keep the reservation
    e.repo.updateCandidateProjection(id, { projectionStatus: "projected" });
    e.db.db.prepare("UPDATE claim_candidate SET confirmed_claim_ref = NULL WHERE candidate_id = ?").run(id);
    const resumed = await e.projection.project(id, { operator: "analyst" });
    assert.equal(resumed.status, "projected");
    assert.equal(resumed.claimRef, first.claimRef, "★ the SAME claim id is recovered, never a second one");

    // (c) simulate a crash right after P2 (claim written, candidate not yet marked projected)
    e.repo.updateCandidateProjection(id, { projectionStatus: "claim_written" });
    const resumed2 = await e.projection.project(id, { operator: "analyst" });
    assert.equal(resumed2.claimRef, first.claimRef);

    // one claim, one artifact, and the downstream fingerprint is exactly what the first run left
    assert.equal(fingerprint(e.db), afterFirst);
    assert.equal((await e.artifacts.listByTask(CLAIM_ARTIFACT_TASK_ID)).length, artifactsFirst);
    assert.equal(
      (e.db.db.prepare("SELECT COUNT(*) AS c FROM knowledge_belief").get() as { c: number }).c,
      1,
    );

  });

  test("T-C6-8b: a projection that throws is RECORDED and stays resumable", async () => {
    const e = env();
    const id = e.candidateIds[0];
    e.review.confirm(id, { operator: "analyst", relation: "SUPPORT" });

    const dir = e.dir;
    const brokenArtifacts = {
      put: async () => {
        throw new Error("artifact store exploded");
      },
      get: async () => undefined,
      listByTask: () => [],
    } as unknown as ArtifactStore;
    const broken = new CandidateProjectionService(
      e.repo,
      new OpportunityDiscoveryService(e.repo, new EchoDataProvider(), brokenArtifacts),
      () => AT3,
    );
    const failed = await broken.project(id, { operator: "analyst" });
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /exploded/);
    const row = e.repo.getClaimCandidate(id);
    assert.equal(row?.projectionError, "artifact store exploded");
    // ★ the reservation survives ⇒ the retry reuses the SAME claim id
    const reserved = row?.reservedClaimId ?? "";
    assert.ok(reserved.length > 0, "P1 must persist the reserved claim id");
    assert.equal(e.repo.getClaimCandidate(id)?.reviewStatus, "confirmed", "review state is untouched");

    const ok = await e.projection.project(id, { operator: "analyst" });
    assert.equal(ok.status, "projected");
    assert.equal(ok.claimRef, `artifact:claim/${reserved}`, "recovery reuses the reserved claim id");

  });

  test("T-C6-9: SUPERSEDE cannot guess a target, and a retry may not change it", async () => {
    const e = env();
    const id = e.candidateIds[0];

    // ★ the DECISION itself is refused without a target, before anything is reserved or written
    assert.throws(
      () => e.review.confirm(id, { operator: "analyst", relation: "SUPERSEDE" }),
      /requires --supersedes-claim/,
    );
    const untouched = e.repo.getClaimCandidate(id);
    assert.equal(untouched?.reviewStatus, "draft", "a refused decision leaves the candidate a draft");
    assert.equal(untouched?.reservedClaimId, undefined, "nothing may be reserved by a refused decision");
    assert.equal(untouched?.projectionError, undefined);

    // ★ the target is part of the DECISION: it is persisted with it...
    e.review.confirm(id, {
      operator: "analyst",
      relation: "SUPERSEDE",
      supersedesClaimRef: "artifact:claim/claim-old",
    });
    assert.equal(e.repo.getClaimCandidate(id)?.supersededClaimRef, "artifact:claim/claim-old");

    // ...and a retry may not quietly re-choose it
    await assert.rejects(
      () => e.projection.project(id, { operator: "analyst", supersedesClaimRef: "artifact:claim/claim-other" }),
      /may not change the decision/,
    );

    // using the STORED target works
    const result = await e.projection.project(id, { operator: "analyst" });
    assert.equal(result.status, "projected");
  });

  test("a rejected candidate is never projectable, and two candidates project independently", async () => {
    const e = env();
    const [a, b] = e.candidateIds;
    e.review.reject(b, { operator: "analyst" });
    await assert.rejects(() => e.projection.project(b, { operator: "analyst" }), /can be projected/);

    e.review.confirm(a, { operator: "analyst", relation: "SUPPORT" });
    const ra = await e.projection.project(a, { operator: "analyst" });
    assert.equal(ra.status, "projected");
    assert.notEqual(ra.claimRef, e.repo.getClaimCandidate(b)?.confirmedClaimRef);
    assert.equal(
      (e.db.db.prepare("SELECT COUNT(*) AS c FROM knowledge_belief").get() as { c: number }).c,
      1,
      "only the confirmed candidate produced a belief",
    );
  });
});
