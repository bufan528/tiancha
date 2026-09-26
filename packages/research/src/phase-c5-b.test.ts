/**
 * Phase C5-B — Proposal Decision / Human Gate / Target materialization.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §19 (rev5.1), incl. T-C5-B-1..11.
 *
 * Covers: confirm → Target, reject → no Target, terminal-state idempotence (R4),
 * `target_already_exists` ROLLBACK, CAS semantics, the partial-unique-index invariant, the
 * generate-race deterministic recovery (winner NOT overwritten), R1 fail-fast on legacy
 * duplicates, the "only confirm may add a target" static audit, and an anti-regression assertion
 * that the repository never contains `INSERT OR REPLACE INTO target_proposal`.
 *
 * Concurrency here is REAL: the race cases use a FILE-backed database and a SECOND connection
 * (`new ResearchDb({ path })`), so the database invariant is exercised across connections.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { ChainProjectionService } from "./application/chain-projection-service.js";
import { CompanyService } from "./application/company-service.js";
import { TargetProposalService } from "./application/target-proposal-service.js";
import { TargetRecommendationService } from "./application/target-recommendation-service.js";
import { ProposalDecisionService } from "./application/proposal-decision-service.js";
import { TargetService } from "./application/target-service.js";
import { INITIAL_PROPOSAL_STATUS } from "./domain/index.js";
import type { TargetProposalDraft } from "./domain/index.js";

/** A FILE-backed database, so a second connection can genuinely race against the first. */
async function setupFile() {
  const dir = mkdtempSync(join(tmpdir(), "c5b-"));
  const path = join(dir, "tiancha.sqlite");
  const db = new ResearchDb({ path });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: join(dir, "art.sqlite") });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: "C5B 测试行业" });
  const sid = res.industry.industryId;
  new ChainProjectionService(db.db).project(sid);
  return {
    dir,
    path,
    db,
    repo,
    sid,
    companies: new CompanyService(db.db),
    proposals: new TargetProposalService(db.db),
    engine: new TargetRecommendationService(db.db),
    decisions: new ProposalDecisionService(db.db),
  };
}

function dispose(t: { db: ResearchDb; dir: string }) {
  try {
    t.db.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(t.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* cleanup must never fail the assertion */
  }
}

/** Seed one company and persist ITS proposal; returns the persisted proposal ref. */
async function seedProposal(t: Awaited<ReturnType<typeof setupFile>>, name: string) {
  const company = t.companies.add({
    industryId: t.sid,
    canonicalName: name,
    targetKinds: ["头部客户"],
  });
  const drafts = t.engine.build(t.sid).filter((d) => d.companyRef === company.companyId);
  t.proposals.persistDrafts(drafts);
  const stored = t.proposals
    .list(t.sid, "proposed")
    .filter((p) => p.companyRef === company.companyId);
  assert.equal(stored.length, 1, "fixture: exactly one active proposal for this company");
  return stored[0].proposalRef;
}

describe("C5-B · confirm / reject", () => {
  test("T-C5-B-1: confirm materialises a target with createdBy='user' and records the decision", async () => {
    const t = await setupFile();
    try {
      const ref = await seedProposal(t, "确认公司");
      assert.equal(t.repo.listTargets(t.sid).length, 0, "nothing materialised before the decision");

      const outcome = t.decisions.confirm(ref, "  Alice  ", "验证需求");
      assert.equal(outcome.status, "confirmed");
      const confirmed = t.proposals.get(ref)!;
      assert.equal(confirmed.status, "confirmed");
      const target = new TargetService(t.repo.db).list(t.sid);
      assert.equal(target.length, 1, "exactly one target");
      assert.equal(target[0].createdBy, "user", "hard-coded human provenance");
      assert.equal(target[0].subjectKey, "确认公司");
      const decision = t.decisions.getDecision(ref)!;
      assert.equal(decision.kind, "confirmed");
      assert.equal(decision.operator, "Alice", "operator is trimmed");
      assert.equal(decision.comment, "验证需求");
    } finally {
      dispose(t);
    }
  });

  test("T-C5-B-2: reject records the decision and creates NO target", async () => {
    const t = await setupFile();
    try {
      const ref = await seedProposal(t, "拒绝公司");
      const outcome = t.decisions.reject(ref, "Bob");
      assert.equal(outcome.status, "rejected");
      assert.equal(t.proposals.get(ref)!.status, "rejected");
      assert.equal(t.repo.listTargets(t.sid).length, 0, "reject must never materialise a target");
      assert.equal(t.decisions.getDecision(ref)!.kind, "rejected");
      assert.equal(t.decisions.getDecision(ref)!.comment, undefined);
    } finally {
      dispose(t);
    }
  });

  test("T-C5-B-3: terminal states never reverse (R4)", async () => {
    const t = await setupFile();
    try {
      const ref = await seedProposal(t, "终态公司");
      assert.equal(t.decisions.confirm(ref, "Alice").status, "confirmed");
      // second confirm, and a reject attempt, both refuse.
      assert.deepEqual(t.decisions.confirm(ref, "Alice"), {
        status: "already_decided",
        proposalRef: ref,
        proposalStatus: "confirmed",
      });
      assert.deepEqual(t.decisions.reject(ref, "Bob"), {
        status: "already_decided",
        proposalRef: ref,
        proposalStatus: "confirmed",
      });
      assert.equal(t.repo.listTargets(t.sid).length, 1, "still exactly one target");
      assert.equal(t.decisions.getDecision(ref)!.kind, "confirmed", "history is untouched");
    } finally {
      dispose(t);
    }
  });

  test("T-C5-B-4: target_already_exists ⇒ full ROLLBACK (proposal unchanged, no decision)", async () => {
    const t = await setupFile();
    try {
      const ref = await seedProposal(t, "已存在公司");
      const proposal = t.proposals.get(ref)!;
      // The company is ALREADY a confirmed research target (human-confirmed elsewhere).
      new TargetService(t.repo.db).add({
        industryId: t.sid,
        subjectKey: "已存在公司",
        targetKind: proposal.matchedTargetKinds[0]!,
        positionRef: proposal.positionRef,
        researchPurpose: "先行确认",
        selectionReason: "人工先行确认",
      });

      const outcome = t.decisions.confirm(ref, "Alice");
      assert.equal(outcome.status, "target_already_exists");
      assert.equal(t.proposals.get(ref)!.status, "proposed", "proposal must stay proposed");
      assert.equal(t.decisions.getDecision(ref), undefined, "no decision may be recorded");
      assert.equal(t.repo.listTargets(t.sid).length, 1, "and the existing target is untouched");
    } finally {
      dispose(t);
    }
  });

  test("T-C5-B-11: operator is required, trimmed, and never defaulted", async () => {
    const t = await setupFile();
    try {
      const ref = await seedProposal(t, "操作者公司");
      assert.throws(() => t.decisions.confirm(ref, ""), /operator is required/);
      assert.throws(() => t.decisions.confirm(ref, "   "), /operator is required/);
      assert.throws(() => t.decisions.reject(ref, "   "), /operator is required/);
      assert.equal(t.proposals.get(ref)!.status, "proposed", "refused attempts change nothing");
      assert.equal(t.decisions.getDecision(ref), undefined);
    } finally {
      dispose(t);
    }
  });

  test("not_found: an unknown proposal is a deterministic result, not an exception", async () => {
    const t = await setupFile();
    try {
      assert.deepEqual(t.decisions.confirm("prop-nope", "Alice"), {
        status: "not_found",
        proposalRef: "prop-nope",
      });
      assert.deepEqual(t.decisions.reject("prop-nope", "Alice"), {
        status: "not_found",
        proposalRef: "prop-nope",
      });
    } finally {
      dispose(t);
    }
  });
});

describe("C5-B · CAS semantics", () => {
  test("CAS: only a `proposed` row transitions (1); terminal protection lives in the business layer", async () => {
    const t = await setupFile();
    try {
      const a = await seedProposal(t, "CAS甲");
      const b = await seedProposal(t, "CAS乙");
      assert.equal(t.proposals.transition(a, "proposed", "confirmed"), 1);
      assert.equal(t.proposals.transition(a, "proposed", "rejected"), 0, "no longer proposed");
      assert.equal(t.proposals.transition(b, "proposed", "rejected"), 1);
      assert.equal(t.proposals.transition(b, "proposed", "confirmed"), 0, "no longer proposed");
      assert.equal(t.proposals.get(a)!.status, "confirmed");
      assert.equal(t.proposals.get(b)!.status, "rejected");
      // ★ R4 (terminal is final) is enforced by the DECISION SERVICE, never by the primitive.
      assert.equal(t.decisions.reject(a, "Bob").status, "already_decided");
      assert.equal(t.decisions.confirm(b, "Bob").status, "already_decided");
      // ★ The primitive alone records NO decision — the audit row belongs to the decision service.
      assert.equal(t.decisions.getDecision(a), undefined);
      assert.equal(t.decisions.getDecision(b), undefined);
    } finally {
      dispose(t);
    }
  });
});

describe("C5-B · concurrency (real second connection)", () => {
  test("T-C5-B-5: two confirmations of the same proposal ⇒ one wins, one is already_decided", async () => {
    const t = await setupFile();
    const other = new ResearchDb({ path: t.path }); // ★ second connection, same file
    try {
      const ref = await seedProposal(t, "并发公司");
      const a = new ProposalDecisionService(t.db.db);
      const b = new ProposalDecisionService(other.db);

      const r1 = a.confirm(ref, "Alice");
      const r2 = b.confirm(ref, "Bob"); // the loser must NOT throw

      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, ["already_decided", "confirmed"], "exactly one wins");
      assert.equal(t.proposals.get(ref)!.status, "confirmed");
      const decisions = t.db.db
        .prepare("SELECT COUNT(*) AS n FROM target_proposal_decision")
        .get() as { n: number };
      assert.equal(decisions.n, 1, "exactly one decision row");
      assert.ok(t.repo.listTargets(t.sid).length <= 1, "at most one target row");
    } finally {
      try {
        other.close();
      } catch {
        /* ignore */
      }
      dispose(t);
    }
  });

  test("T-C5-B-6: the database invariant forbids a second ACTIVE proposal (partial unique index)", async () => {
    const t = await setupFile();
    const other = new ResearchDb({ path: t.path });
    try {
      const ref = await seedProposal(t, "索引公司");
      const base = t.proposals.get(ref)!;

      // A competing INSERT that bypasses the service pre-check must be REJECTED BY THE DATABASE.
      const forged = { ...base, gapRef: "gap-forged", proposalRef: "prop-forged" };
      assert.throws(() => new ResearchRepository(other.db).insertTargetProposal(forged), /UNIQUE/i);
      assert.equal(t.proposals.list(t.sid, "proposed").length, 1, "still exactly one active proposal");
    } finally {
      try {
        other.close();
      } catch {
        /* ignore */
      }
      dispose(t);
    }
  });

  test("T-C5-B-7: generate race ⇒ loser is skipped, the WINNER IS NOT OVERWRITTEN", async () => {
    const t = await setupFile();
    const other = new ResearchDb({ path: t.path });
    try {
      const ref = await seedProposal(t, "竞争公司");
      const winner = t.proposals.get(ref)!;

      // The second generator sees the same company (different gap ⇒ different ProposalKey) and
      // must get a deterministic skip — no exception, and above all no overwrite.
      const anotherGap = t.repo.listGaps(t.sid).find((g) => g.gapId !== winner.gapRef)!;
      const forged: TargetProposalDraft = {
        ...winner,
        gapRef: anotherGap.gapId,
        proposalRef: "prop-racer",
      };
      const result = new TargetProposalService(other.db).persistDrafts([forged]);
      assert.equal(result.created, 0);
      assert.equal(result.skippedActiveExists, 1);

      const after = t.proposals.get(ref)!;
      assert.equal(after.proposalRef, winner.proposalRef, "winner identity unchanged");
      assert.equal(after.score, winner.score, "winner score unchanged");
      assert.equal(after.selectionReason, winner.selectionReason, "winner reason unchanged");
      assert.equal(after.createdAt, winner.createdAt, "winner createdAt unchanged");
      assert.equal(t.proposals.list(t.sid, "proposed").length, 1, "no second active row");
    } finally {
      try {
        other.close();
      } catch {
        /* ignore */
      }
      dispose(t);
    }
  });

  test("non-unique errors still propagate (the recovery must not be a blanket catch)", async () => {
    const t = await setupFile();
    try {
      const ref = await seedProposal(t, "错误公司");
      const repo = new ResearchRepository(t.db.db);
      // A NOT NULL violation on an unrelated column must NOT be absorbed as skippedActiveExists.
      assert.throws(
        () =>
          t.db.db
            .prepare(
              "INSERT INTO target_proposal (proposal_ref, industry_ref, gap_ref, position_ref, company_ref, " +
                "matched_target_kinds_json, position_importance, covered_requirement_refs_json, " +
                "unresolved_requirement_refs_json, score, score_version, kind_vocabulary_version, " +
                "recommendation_revision, selection_reason, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run("p-x", null, "g", "po", "c", "[]", 0, "[]", "[]", 0, "v", "v", "r", "s", "proposed", "t"),
        /NOT NULL/i,
      );
      assert.equal(repo.getTargetProposal(ref)!.status, INITIAL_PROPOSAL_STATUS);
    } finally {
      dispose(t);
    }
  });
});

describe("C5-B · R1 fail-fast on legacy duplicate active proposals", () => {
  test("opening a database that already holds two ACTIVE proposals for one company THROWS", async () => {
    const t = await setupFile();
    let dir = t.dir;
    try {
      const ref = await seedProposal(t, "遗留公司");
      const base = t.proposals.get(ref)!;
      // Simulate the pre-C5-B race residue: drop the guard, add a second `proposed` row, then
      // reopen the database (initSchema re-runs the R1 pre-check) and expect a REFUSAL.
      t.db.db.exec("DROP INDEX IF EXISTS idx_proposal_active_subject");
      const raw = t.db.db
        .prepare("INSERT INTO target_proposal SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?")
        .run(
          "prop-legacy-dup",
          base.industryRef,
          "gap-other",
          base.positionRef,
          base.companyRef,
          JSON.stringify(base.matchedTargetKinds),
          base.positionImportance,
          JSON.stringify(base.coveredRequirementRefs),
          JSON.stringify(base.unresolvedRequirementRefs),
          base.score,
          base.scoreVersion,
          base.kindVocabularyVersion,
          "rev-other",
          base.selectionReason,
          "proposed",
          base.createdAt,
        );
      assert.equal(Number(raw.changes), 1, "fixture: duplicate persisted");

      const path = t.path;
      t.db.close();
      assert.throws(() => new ResearchDb({ path }), /duplicate ACTIVE proposal group/i);
    } finally {
      try {
        t.db.close();
      } catch {
        /* ignore */
      }
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        /* ignore */
      }
    }
  });
});

describe("C5-B · boundaries (static)", () => {
  const repo = readFileSync(new URL("./storage/research-repository.ts", import.meta.url), "utf8");
  const decisionSrc = readFileSync(
    new URL("./application/proposal-decision-service.ts", import.meta.url),
    "utf8",
  );
  const proposalSrc = readFileSync(
    new URL("./application/target-proposal-service.ts", import.meta.url),
    "utf8",
  );

  test("T-C5-B-7⑥: the repository never contains INSERT OR REPLACE INTO target_proposal", () => {
    assert.ok(
      !/INSERT OR REPLACE INTO target_proposal/i.test(repo),
      "proposal creation must be a plain INSERT (REPLACE would silently overwrite the winner)",
    );
    assert.ok(/INSERT INTO target_proposal/i.test(repo), "and the plain INSERT must exist");
  });

  test("the conflict recovery is NARROW: only the named index conflict is absorbed", () => {
    assert.ok(
      /isActiveSubjectConflict\(/.test(proposalSrc),
      "the catch must identify the specific index conflict",
    );
    assert.ok(
      /throw err/.test(proposalSrc),
      "and must still re-throw every other error (no blanket catch)",
    );
  });

  test("T-C5-B-10: TargetService.add( has exactly ONE call site in C5 code — confirm", () => {
    assert.ok(/targets\.add\(/.test(decisionSrc), "confirm materialises the target");
    assert.equal(
      (decisionSrc.match(/targets\.add\(/g) ?? []).length,
      1,
      "exactly one TargetService.add( call in the decision service",
    );
    assert.ok(!/TargetService/.test(proposalSrc), "the persistence path must not know TargetService");
    assert.ok(!/\.add\(/.test(proposalSrc), "persistence must never add a target");
  });

  test("the decision service promotes CAS, not a read-then-update", () => {
    assert.ok(/transition\(/.test(decisionSrc), "uses the CAS transition");
    assert.ok(/transaction\(/.test(decisionSrc), "wraps the steps in one transaction");
    assert.ok(!/UPDATE target_proposal/.test(decisionSrc), "never writes SQL itself");
  });
});
