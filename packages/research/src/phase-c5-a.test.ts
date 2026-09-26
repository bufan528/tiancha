/**
 * Phase C5-A — Company Universe + TargetProposal (Recommendation, no Human Gate).
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` (rev4) §5.2 / §7 / §10 / §11 / §15 / §16.
 *
 * What this file proves (C5-A scope only):
 *   A  Company entry is human-only and vocabulary-validated
 *   B  Eligibility (kind intersection + no existing target + industry scope)
 *   C  Score is the frozen formula, versioned
 *   D  One Company ⇒ one Proposal, deterministic tie-break
 *   E  Identity: ProposalKey + recommendationRevision (incl. per-component sensitivity)
 *   F  Persistence idempotency (P11)
 *   G  The Engine writes NOTHING (P12, whole-schema fingerprint)
 *   H  Uniqueness at the persistence layer (§10.3)
 *   I  Static audits: no Position→Target path, no writes in the engine, no decision/target code
 *   J  selectionReason is a rendering of persisted facts
 *   K  Real end-to-end chain on a real SQLite database
 *
 * Deliberately ABSENT (C5-B): confirm / reject / `target_proposal_decision` / materialisation.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { ChainProjectionService } from "./application/chain-projection-service.js";
import { TargetService } from "./application/target-service.js";
import { CompanyService } from "./application/company-service.js";
import { canonicalJson, TargetRecommendationService } from "./application/target-recommendation-service.js";
import {
  PersistProposalsResult,
  TargetProposalService,
} from "./application/target-proposal-service.js";
import {
  KIND_VOCABULARY_VERSION,
  RECOMMENDATION_SCORE_V1,
  recommendationScoreV1,
  TARGET_KIND_VOCABULARY,
} from "./domain/index.js";
import type { TargetProposalDraft } from "./domain/index.js";

/**
 * Whole-schema content fingerprint. Enumerates the user tables of the LIVE database — the table
 * count is never hard-coded, so adding a table can never silently invalidate the zero-write proof.
 */
function dbFingerprint(db: { prepare: (sql: string) => any }): string {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return tables
    .map((t) => {
      const rows = db.prepare(`SELECT * FROM ${t.name}`).all() as unknown[];
      return `${t.name}:${rows.length}:${JSON.stringify(rows)}`;
    })
    .join("|");
}

async function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  const artifacts = new SqliteArtifactStore({ path: ":memory:" });
  const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await discovery.ingestMaterial({ materialText: "x", industryName: "C5A 测试行业" });
  const sid = res.industry.industryId;
  new ChainProjectionService(db.db).project(sid);
  const companies = new CompanyService(db.db);
  const proposals = new TargetProposalService(db.db);
  const engine = new TargetRecommendationService(db.db);
  return { db, repo, artifacts, sid, companies, proposals, engine };
}

const byCompany = (drafts: TargetProposalDraft[], companyRef: string) =>
  drafts.filter((d) => d.companyRef === companyRef);

describe("C5-A · A Company entry (human-only, vocabulary-validated)", () => {
  test("A1/A3: a human-supplied company with legal kinds is stored", async () => {
    const { companies, sid } = await setup();
    const c = companies.add({ industryId: sid, canonicalName: "甲客户", targetKinds: ["头部客户"] });
    assert.equal(c.canonicalName, "甲客户");
    assert.deepEqual(c.targetKinds, ["头部客户"]);
    assert.equal(c.primaryIndustryId, sid);
    assert.equal(companies.get(c.companyId)?.canonicalName, "甲客户");
  });

  test("A2/B4: a blank name is rejected (a company is human-supplied)", async () => {
    const { companies, sid } = await setup();
    assert.throws(() => companies.add({ industryId: sid, canonicalName: "   ", targetKinds: ["头部客户"] }), /canonicalName/);
  });

  test("A4: kinds outside the frozen vocabulary are rejected", async () => {
    const { companies, sid } = await setup();
    assert.throws(() => companies.add({ industryId: sid, canonicalName: "乙", targetKinds: ["客户"] }), /unknown target kind/);
    assert.throws(() => companies.add({ industryId: sid, canonicalName: "乙", targetKinds: [] }), /at least one kind/);
  });

  test("A5: duplicate kinds are rejected (no silent de-duplication of human input)", async () => {
    const { companies, sid } = await setup();
    assert.throws(
      () => companies.add({ industryId: sid, canonicalName: "丙", targetKinds: ["头部客户", "头部客户"] }),
      /duplicates/,
    );
  });

  test("A6: companies are isolated per industry (different id, different universe)", async () => {
    const { companies, repo, artifacts, sid } = await setup();
    const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const other = await discovery.ingestMaterial({ materialText: "x", industryName: "C5A 另一行业" });
    const otherSid = other.industry.industryId;

    const a = companies.add({ industryId: sid, canonicalName: "同名公司", targetKinds: ["行业专家"] });
    const b = companies.add({ industryId: otherSid, canonicalName: "同名公司", targetKinds: ["行业专家"] });
    assert.notEqual(a.companyId, b.companyId, "same name in a different industry must not share identity");
    assert.equal(companies.list(sid).length, 1);
    assert.equal(companies.list(otherSid).length, 1);
  });

  test("A7: the same (industry, name) is idempotent — same id, no second row", async () => {
    const { companies, sid } = await setup();
    const first = companies.add({ industryId: sid, canonicalName: "丁", targetKinds: ["头部客户"] });
    const second = companies.add({ industryId: sid, canonicalName: " 丁 ", targetKinds: ["大客户"] });
    assert.equal(first.companyId, second.companyId, "trimmed name ⇒ same identity");
    assert.equal(companies.list(sid).length, 1);
    assert.equal(second.createdAt, first.createdAt, "createdAt survives re-adding");
  });
});

describe("C5-A · B Eligibility", () => {
  test("B1: a company whose kinds never intersect the position's kinds is not recommended", async () => {
    const { companies, engine, sid } = await setup();
    companies.add({ industryId: sid, canonicalName: "只做咨询", targetKinds: ["咨询机构"] });
    const drafts = engine.build(sid);
    // `咨询机构` only intersects the consulting position; every draft must still match on kinds.
    for (const d of drafts) {
      assert.ok(d.matchedTargetKinds.length > 0, "no draft may exist without a kind match");
    }
    assert.equal(drafts.length, 1, "only the consulting position can match this company");
  });

  test("B2: a company that is already a confirmed target is excluded (§10.1)", async () => {
    const { companies, engine, sid, repo } = await setup();
    companies.add({ industryId: sid, canonicalName: "已是研究对象", targetKinds: ["头部客户"] });
    const before = engine.build(sid);
    assert.equal(before.length, 1, "eligible while no target exists");

    const position = repo.listPositions(sid).find((p) => p.suggestedTargetKinds.includes("头部客户"))!;
    new TargetService(repo.db).add({
      industryId: sid,
      subjectKey: "已是研究对象",
      targetKind: "头部客户",
      positionRef: position.positionRef,
      researchPurpose: "验证需求",
      selectionReason: "人工确认",
    });

    assert.equal(engine.build(sid).length, 0, "an existing target removes the company from the universe");
  });

  test("B3: a company of another industry never enters this industry's universe", async () => {
    const { companies, engine, repo, artifacts, sid } = await setup();
    const discovery = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const other = await discovery.ingestMaterial({ materialText: "x", industryName: "C5A 第三行业" });
    companies.add({ industryId: other.industry.industryId, canonicalName: "外行业公司", targetKinds: ["头部客户"] });
    assert.equal(engine.build(sid).length, 0, "industry scope is enforced at the universe level");
  });
});

describe("C5-A · C Score", () => {
  test("C1/C2/C3: the persisted score is exactly the frozen, versioned formula", async () => {
    const { companies, engine, sid } = await setup();
    companies.add({ industryId: sid, canonicalName: "打分公司", targetKinds: ["头部客户"] });
    const [draft] = engine.build(sid);
    assert.equal(draft.scoreVersion, RECOMMENDATION_SCORE_V1.version);
    assert.equal(
      draft.score,
      recommendationScoreV1({
        importance: draft.positionImportance,
        coveredCount: draft.coveredRequirementRefs.length,
        unresolvedCount: draft.unresolvedRequirementRefs.length,
        alreadyTargeted: false,
      }),
    );
    // unresolved is a SUBSET of covered (never a bogus count).
    for (const r of draft.unresolvedRequirementRefs) {
      assert.ok(draft.coveredRequirementRefs.includes(r), "unresolved ⊆ covered");
    }
    // ★ The comparison above is self-consistent, so it cannot catch a silent re-tuning of the
    //   weights. Pin the numbers themselves, and the frozen constant object.
    assert.equal(
      recommendationScoreV1({
        importance: 1,
        coveredCount: 2,
        unresolvedCount: 3,
        alreadyTargeted: false,
      }),
      100 * 1 + 10 * 2 + 15 * 3,
      "score weights are frozen (100/10/15)",
    );
    assert.deepEqual(RECOMMENDATION_SCORE_V1, {
      version: "rec-v1",
      importanceWeight: 100,
      coveredWeight: 10,
      unresolvedWeight: 15,
      alreadyTargetedPenalty: 25,
    });
    // The engine keeps the penalty term even though C5-A can never set it (formula shape frozen).
    assert.equal(
      recommendationScoreV1({
        importance: 0,
        coveredCount: 0,
        unresolvedCount: 0,
        alreadyTargeted: true,
      }),
      -25,
    );
  });

  test("D3: output order is (score DESC, positionRef ASC, companyRef ASC) — recomputed independently", async () => {
    const { companies, engine, sid } = await setup();
    companies.add({ industryId: sid, canonicalName: "甲客户", targetKinds: ["头部客户"] });
    companies.add({ industryId: sid, canonicalName: "乙客户", targetKinds: ["头部客户"] });
    companies.add({ industryId: sid, canonicalName: "丙渠道", targetKinds: ["渠道商"] });
    const drafts = engine.build(sid);
    assert.equal(drafts.length, 3, "three companies ⇒ three proposals");

    // Independently recomputed total order (never by calling the production comparator).
    const cmp = (a: TargetProposalDraft, b: TargetProposalDraft): number =>
      a.score !== b.score
        ? b.score - a.score
        : a.positionRef !== b.positionRef
          ? a.positionRef < b.positionRef
            ? -1
            : 1
          : a.companyRef < b.companyRef
            ? -1
            : a.companyRef === b.companyRef
              ? 0
              : 1;
    for (let i = 1; i < drafts.length; i++) {
      assert.ok(cmp(drafts[i - 1], drafts[i]) <= 0, `drafts[${i - 1}] must not sort after drafts[${i}]`);
    }

    // Two companies with identical kinds in the same position score identically ⇒ the ONLY
    // thing separating them is companyRef, which must be ascending.
    const tied = drafts.filter((d) => d.matchedTargetKinds[0] === "头部客户");
    assert.equal(tied.length, 2, "both customer-type companies are drafted");
    assert.equal(tied[0].score, tied[1].score, "identical kinds in one position ⇒ identical score");
    assert.ok(tied[0].companyRef < tied[1].companyRef, "tie broken by companyRef ASC");
  });

  test("D1: one company yields at most ONE proposal across all its matching gaps", async () => {
    const { companies, engine, sid } = await setup();
    const c = companies.add({ industryId: sid, canonicalName: "多缺口公司", targetKinds: ["头部客户", "大客户", "标杆客户"] });
    const drafts = engine.build(sid);
    assert.equal(byCompany(drafts, c.companyId).length, 1, "§10.3: one proposal per (industry, company)");
    assert.equal(drafts.length, 1);
  });
});

describe("C5-A · E Identity (ProposalKey + recommendationRevision)", () => {
  test("E1: identical persisted state ⇒ identical proposalRef", async () => {
    const { companies, engine, sid } = await setup();
    companies.add({ industryId: sid, canonicalName: "稳定公司", targetKinds: ["头部客户"] });
    const a = engine.build(sid);
    const b = engine.build(sid);
    assert.deepEqual(a.map((d) => d.proposalRef), b.map((d) => d.proposalRef));
    assert.deepEqual(a.map((d) => d.recommendationRevision), b.map((d) => d.recommendationRevision));
  });

  test("E5: changing company.targetKinds changes the proposal identity (it is a real input)", async () => {
    const { companies, engine, sid, repo } = await setup();
    const c = companies.add({ industryId: sid, canonicalName: "变更公司", targetKinds: ["头部客户"] });
    const before = engine.build(sid)[0];
    // A human edits the kinds (still legal, still the same company identity).
    const row = repo.getCompany(c.companyId)!;
    repo.upsertCompany({ ...row, targetKinds: ["大客户"] });
    const after = engine.build(sid)[0];
    assert.equal(before.companyRef, after.companyRef, "same company");
    assert.notEqual(before.recommendationRevision, after.recommendationRevision, "revision must change");
    assert.notEqual(before.proposalRef, after.proposalRef, "identity must follow the facts");
  });

  test("E6: changing position.label changes the proposal identity", async () => {
    const { companies, engine, sid, repo } = await setup();
    companies.add({ industryId: sid, canonicalName: "标签公司", targetKinds: ["头部客户"] });
    const before = engine.build(sid)[0];
    const position = repo.getPosition(before.positionRef)!;
    repo.upsertPosition({ ...position, label: "改过的下游头部客户" });
    const after = engine.build(sid)[0];
    assert.notEqual(before.recommendationRevision, after.recommendationRevision);
    assert.match(after.selectionReason, /改过的下游头部客户/, "the label is rendered into the reason");
  });

  test("E-canonical: canonicalJson sorts keys, keeps array order, is value-sensitive", () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
    assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }), "array order matters");
    assert.equal(canonicalJson({ a: null }), canonicalJson({ a: null }));
    assert.match(canonicalJson({}), /^\{\}$/);
  });

  test("E-vocab: the vocabulary version is part of the identity input", () => {
    assert.equal(KIND_VOCABULARY_VERSION, "kind-vocab-v1");
    assert.ok(TARGET_KIND_VOCABULARY.includes("头部客户"));
    assert.ok(!TARGET_KIND_VOCABULARY.includes("行业龙头"), "no free-text / judgement kinds");
  });
});

describe("C5-A · F Idempotency (P11)", () => {
  test("F1/F2/F3: re-generating the same state adds nothing", async () => {
    const { companies, engine, proposals, sid } = await setup();
    companies.add({ industryId: sid, canonicalName: "幂等公司", targetKinds: ["头部客户"] });

    const first = proposals.persistDrafts(engine.build(sid));
    const second = proposals.persistDrafts(engine.build(sid));
    const third = proposals.persistDrafts(engine.build(sid));

    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.ok(second.skippedSameRef >= 1);
    assert.equal(third.created, 0);
    assert.equal(proposals.list(sid).length, 1, "exactly one row after three generates");
  });
});

describe("C5-A · G Engine is write-free (P12)", () => {
  test("G1: build() leaves every table byte-identical", async () => {
    const { companies, engine, sid, db } = await setup();
    companies.add({ industryId: sid, canonicalName: "零写公司", targetKinds: ["头部客户"] });
    const before = dbFingerprint(db.db);
    engine.build(sid);
    engine.build(sid);
    const after = dbFingerprint(db.db);
    assert.equal(after, before, "a pure engine must not mutate any table");
  });

  test("G2: build() does not create proposals (only the service persists)", async () => {
    const { companies, engine, proposals, sid } = await setup();
    companies.add({ industryId: sid, canonicalName: "未落库公司", targetKinds: ["头部客户"] });
    assert.equal(engine.build(sid).length, 1, "the engine drafts");
    assert.equal(proposals.list(sid).length, 0, "…but persists nothing");
  });
});

describe("C5-A · H Persistence-layer uniqueness (§10.3)", () => {
  test("H1: a second draft for a company that already has an ACTIVE proposal is skipped", async () => {
    const { companies, engine, proposals, repo, sid } = await setup();
    const c = companies.add({ industryId: sid, canonicalName: "唯一公司", targetKinds: ["头部客户"] });
    proposals.persistDrafts(engine.build(sid));
    assert.equal(proposals.list(sid, "proposed").length, 1);

    // Same company, DIFFERENT gap ⇒ different ProposalKey ⇒ different ref, yet still refused.
    const base = engine.build(sid)[0];
    const anotherGap = repo.listGaps(sid).find((g) => g.gapId !== base.gapRef)!;
    const forged: TargetProposalDraft = { ...base, gapRef: anotherGap.gapId, proposalRef: "prop-forged" };
    const result: PersistProposalsResult = proposals.persistDrafts([forged]);

    assert.equal(result.created, 0);
    assert.equal(result.skippedActiveExists, 1);
    assert.equal(proposals.list(sid).length, 1, "no company ever holds two active proposals");
    assert.equal(c.companyId, base.companyRef);
  });

  test("H2: a company whose kind matches nothing yields no draft at all", async () => {
    const { companies, engine, sid } = await setup();
    assert.equal(engine.build(sid).length, 0, "empty universe ⇒ no proposals");
    companies.add({ industryId: sid, canonicalName: "匹配公司", targetKinds: ["渠道商"] });
    const drafts = engine.build(sid);
    assert.ok(drafts.length >= 1);
    assert.deepEqual(drafts[0].matchedTargetKinds, ["渠道商"]);
  });
});

describe("C5-A · J selectionReason provenance", () => {
  test("J1: every clause of the reason is recomputable from the persisted fields", async () => {
    const { companies, engine, proposals, sid } = await setup();
    companies.add({ industryId: sid, canonicalName: "溯源公司", targetKinds: ["头部客户"] });
    proposals.persistDrafts(engine.build(sid));
    const p = proposals.get(proposals.list(sid)[0].proposalRef)!;

    assert.match(p.selectionReason, new RegExp(p.matchedTargetKinds[0]));
    assert.ok(p.selectionReason.includes(String(p.positionImportance)));
    assert.ok(p.selectionReason.includes(`${p.coveredRequirementRefs.length} 个 Information Requirements`));
    assert.ok(p.selectionReason.includes(`${p.unresolvedRequirementRefs.length} 个尚未解决`));
    // The structured facts are stored NEXT TO the rendering, not only inside it.
    assert.ok(Array.isArray(p.matchedTargetKinds) && Array.isArray(p.coveredRequirementRefs));
  });
});

describe("C5-A · I static audits (boundaries)", () => {
  const engineSrc = readFileSync(
    new URL("./application/target-recommendation-service.ts", import.meta.url),
    "utf8",
  );
  const proposalSrc = readFileSync(
    new URL("./application/target-proposal-service.ts", import.meta.url),
    "utf8",
  );

  test("I1: the recommendation engine contains no database write call", () => {
    for (const forbidden of ["INSERT INTO", "UPDATE ", "DELETE FROM", "upsert", "persistDrafts("]) {
      assert.ok(!engineSrc.includes(forbidden), `engine must not contain '${forbidden}'`);
    }
  });

  test("I2: C5-A never creates a research target (no Position → Target path)", () => {
    for (const forbidden of ["TargetService", "research_target", "targetRefFor("]) {
      assert.ok(!proposalSrc.includes(forbidden), `proposal service must not contain '${forbidden}'`);
    }
    assert.ok(!engineSrc.includes("TargetService.add"), "engine must not add targets");
  });

  test("I3: C5-A itself has no decision table and no state-change implementation", () => {
    // C5-B (contract §19) now builds `transition()` on top of this service. C5-A's OWN scope —
    // "no decision table, no confirm/reject implementation" — is what these assertions keep.
    for (const forbidden of [
      "target_proposal_decision",
      "function confirm",
      "function reject",
    ]) {
      assert.ok(!proposalSrc.includes(forbidden), `C5-A must not contain '${forbidden}'`);
    }
  });
});

describe("C5-A · K real end-to-end chain", () => {
  test("K1: industry → gap → position → company → draft → persisted proposal → list/get", async () => {
    const { companies, engine, proposals, repo, sid } = await setup();
    const needs = repo.listGaps(sid);
    assert.ok(needs.length > 0, "industry has gaps");

    const c = companies.add({ industryId: sid, canonicalName: "闭环公司", targetKinds: ["头部客户", "大客户"] });
    const drafts = engine.build(sid);
    assert.equal(drafts.length, 1);

    const result = proposals.persistDrafts(drafts);
    assert.equal(result.created, 1);

    const stored = proposals.list(sid);
    assert.equal(stored.length, 1);
    const p = stored[0];
    assert.equal(p.companyRef, c.companyId);
    assert.equal(p.status, "proposed", "C5-A stops at `proposed`");
    assert.equal(p.kindVocabularyVersion, KIND_VOCABULARY_VERSION);
    assert.equal(p.scoreVersion, RECOMMENDATION_SCORE_V1.version);
    assert.equal(proposals.get(p.proposalRef)?.proposalRef, p.proposalRef);

    // The research state was NOT touched: the gap list and targets are unchanged.
    assert.equal(repo.listGaps(sid).length, needs.length);
    assert.equal(repo.listTargets(sid).length, 0, "no target was materialised");
  });

  test("K2: gap-scoped generate only considers that gap", async () => {
    const { companies, engine, repo, sid } = await setup();
    companies.add({ industryId: sid, canonicalName: "范围公司", targetKinds: ["头部客户"] });
    const all = engine.build(sid);
    const gaps = new Set(all.map((d) => d.gapRef));
    assert.ok(gaps.size >= 1);
    const one = [...gaps][0];
    const scoped = engine.build(sid, { gapRef: one });
    assert.ok(scoped.every((d) => d.gapRef === one), "only the requested gap is considered");
  });
});
