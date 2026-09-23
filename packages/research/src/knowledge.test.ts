/**
 * Phase 2C Step 1 tests: knowledge domain + persistence.
 *  - persistence roundtrip (three tables)
 *  - migration idempotency (PRAGMA pre-check, no duplicate column)
 *  - belief history retained on REVISE (old row preserved, state=revised)
 *  - knowledge conflict both sides preserved
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResearchDb } from "./storage/research-db.js";
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { createIndustry } from "./domain/index.js";
import type {
  IndustryKnowledge,
  KnowledgeBelief,
  KnowledgeConflict,
} from "./domain/index.js";

function setup() {
  const db = new ResearchDb({ path: ":memory:" });
  const knowledge = new KnowledgeRepository(db.db);
  return { db, knowledge };
}

function mkKnowledge(): IndustryKnowledge {
  const now = new Date().toISOString();
  return {
    knowledgeId: randomUUID(),
    subjectKind: "industry",
    subjectId: "ind-" + randomUUID(),
    beliefs: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function mkBelief(knowledgeId: string, dimension: string, state: KnowledgeBelief["state"]): KnowledgeBelief {
  const now = new Date().toISOString();
  return {
    beliefId: randomUUID(),
    knowledgeId,
    claimRef: "artifact:claim/" + randomUUID(),
    sourceRef: "src-" + randomUUID(),
    dimension,
    confidence: 0.7,
    state,
    historicalRelations: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("Phase 2C Step1 persistence", () => {
  test("knowledge + belief roundtrip", () => {
    const { knowledge } = setup();
    const k = mkKnowledge();
    knowledge.upsertKnowledge(k);
    const b = mkBelief(k.knowledgeId, "market", "confirmed");
    knowledge.insertBelief(b);

    const got = knowledge.getKnowledge(k.knowledgeId);
    assert.equal(got?.knowledgeId, k.knowledgeId);

    const bySubject = knowledge.findKnowledgeBySubject("industry", k.subjectId)!;
    assert.equal(bySubject.beliefs.length, 1);
    assert.equal(bySubject.beliefs[0].claimRef, b.claimRef);
    assert.equal(bySubject.beliefs[0].state, "confirmed");
  });

  test("REVISE preserves old row; current projection excludes superseded", () => {
    const { knowledge } = setup();
    const k = mkKnowledge();
    knowledge.upsertKnowledge(k);

    const oldB = mkBelief(k.knowledgeId, "market_growth", "confirmed");
    knowledge.insertBelief(oldB);

    const now = new Date().toISOString();
    // new belief revises: insert new row + flip old row state
    knowledge.updateBeliefState(oldB.beliefId, "revised", now);
    const newB: KnowledgeBelief = {
      ...mkBelief(k.knowledgeId, "market_growth", "confirmed"),
      historicalRelations: [{ relation: "REVISE", otherBeliefId: oldB.beliefId, at: now }],
    };
    knowledge.insertBelief(newB);

    // history retained: both rows still present
    const all = knowledge.listBeliefs(k.knowledgeId);
    assert.equal(all.length, 2);
    assert.equal(all.find((x) => x.beliefId === oldB.beliefId)?.state, "revised");
    assert.equal(all.find((x) => x.beliefId === newB.beliefId)?.state, "confirmed");

    // current projection drops superseded; revised stays visible unless superseded
    const cur = knowledge.listCurrentBeliefs(k.knowledgeId);
    assert.ok(cur.some((x) => x.beliefId === newB.beliefId));
  });

  test("knowledge conflict keeps both claims; resolve deletes nothing", () => {
    const { knowledge } = setup();
    const k = mkKnowledge();
    knowledge.upsertKnowledge(k);
    const c: KnowledgeConflict = {
      conflictId: randomUUID(),
      claimARef: "artifact:claim/a",
      claimBRef: "artifact:claim/b",
      dimension: "demand",
      status: "open",
      createdAt: new Date().toISOString(),
    };
    knowledge.insertConflict(c);
    assert.equal(knowledge.listOpenConflicts().length, 1);

    knowledge.resolveConflict(c.conflictId, "resolved", new Date().toISOString());
    const got = knowledge.getConflict(c.conflictId)!;
    assert.equal(got.status, "resolved");
    assert.equal(knowledge.listOpenConflicts().length, 0);
    // both refs still intact
    assert.equal(got.claimARef, "artifact:claim/a");
    assert.equal(got.claimBRef, "artifact:claim/b");
  });
});

describe("Phase 2C Step1 migration", () => {
  test("PRAGMA pre-check: re-run migration does not duplicate column", () => {
    const db = new ResearchDb({ path: ":memory:" });
    // second migrate() on same handle must not error (column already exists)
    (db as any).migrate();
    const cols = (db.db.prepare("PRAGMA table_info(industry)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    assert.ok(cols.includes("current_knowledge_id"));
    // exactly once: no duplicate
    assert.equal(cols.filter((c) => c === "current_knowledge_id").length, 1);
    db.close();
  });

  test("fresh DB gets knowledge tables + industry column", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const tables = (
      db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    for (const t of ["industry_knowledge", "knowledge_belief", "knowledge_conflict"]) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
    const repo = new ResearchRepository(db.db);
    const ind = createIndustry({ industryId: "ind-x", canonicalName: "机器人" });
    ind.currentKnowledgeId = "kn-x";
    repo.upsertIndustry(ind);
    assert.equal(repo.getIndustry("ind-x")?.currentKnowledgeId, "kn-x");
    db.close();
  });
});
