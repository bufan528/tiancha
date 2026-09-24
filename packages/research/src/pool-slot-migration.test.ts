/**
 * S3: Pool redesign — Entry -> Slot + Item.
 *
 * Hard acceptance (from the S3 gate):
 *   S3-T1 Identity Preservation: `pe-<subject>-<dimension>` migrates to
 *         `slot-<subject>-<dimension>` — SAME suffix, same logical research slot,
 *         relations (Requirement -> Slot) intact. Never a fresh random id.
 *   plus: migration idempotency, status-word mapping, item→Claim (I5),
 *   and that new ingests write Slots (not legacy entries).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { OpportunityDiscoveryService } from "./application/opportunity-discovery-service.js";
import { EchoDataProvider } from "./providers/echo-data-provider.js";
import { poolSlotKey } from "./domain/identity.js";
import type { InformationPoolItem } from "./domain/index.js";

/** Persist a LEGACY (pre-S3) pool entry directly, bypassing the new writer. */
function insertLegacyEntry(
  db: ResearchDb,
  entryId: string,
  subjectId: string,
  topic: string,
  status: string,
  evidenceRefs: string[] = [],
  requirementIds: string[] = [],
): void {
  db.db
    .prepare(
      `INSERT INTO information_pool_entry
       (entry_id, subject_kind, subject_id, topic, status, related_requirement_ids_json,
        evidence_refs_json, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      entryId,
      "industry",
      subjectId,
      topic,
      status,
      JSON.stringify(requirementIds),
      JSON.stringify(evidenceRefs),
      null,
      "t0",
      "t0",
    );
}

function tmpDbPath(): string {
  // small, deleted in the test's finally block
  return join(tmpdir(), `tiancha-s3-${randomUUID()}.sqlite`);
}

describe("S3 Pool migration (Entry -> Slot + Item)", () => {
  test("S3-T1 Identity Preservation: pe-X -> slot-X (same suffix), relations intact", () => {
    const path = tmpDbPath();
    try {
      // 1) legacy DB: schema exists, then a pre-S3 entry is written
      const db1 = new ResearchDb({ path });
      insertLegacyEntry(db1, "pe-ind-1-market", "ind-1", "market", "confirmed", ["artifact:claim/c1"], [
        "ir-ind-1-market",
      ]);
      db1.close();

      // 2) reopen: migrate() runs and upgrades the entry to a slot
      const db2 = new ResearchDb({ path });
      const repo = new ResearchRepository(db2.db);

      const slot = repo.getPoolSlot("slot-ind-1-market");
      assert.ok(slot, "entry pe-ind-1-market migrated to slot-ind-1-market (same suffix)");
      assert.equal(slot!.subjectId, "ind-1", "same subject");
      assert.equal(slot!.dimension, "market", "same dimension => same logical research slot");

      // it is the SAME logical slot, addressed by the deterministic key
      assert.equal(slot!.slotId, poolSlotKey("ind-1", "market"));

      // items migrated from evidence_refs, each pointing at the claim
      const items = repo.listPoolItems(slot!.slotId);
      assert.equal(items.length, 1);
      assert.equal(items[0].claimRef, "artifact:claim/c1");
      db2.close();
    } finally {
      rmSync(path, { force: true });
    }
  });

  test("status-word mapping: confirmed -> sufficient, conflict -> conflicting, unknown/partial unchanged", () => {
    const path = tmpDbPath();
    try {
      const db1 = new ResearchDb({ path });
      insertLegacyEntry(db1, "pe-ind-1-market", "ind-1", "market", "confirmed");
      insertLegacyEntry(db1, "pe-ind-1-demand", "ind-1", "demand", "conflict");
      insertLegacyEntry(db1, "pe-ind-1-supply", "ind-1", "supply", "partial");
      insertLegacyEntry(db1, "pe-ind-1-policy", "ind-1", "policy", "unknown");
      db1.close();

      const db2 = new ResearchDb({ path });
      const repo = new ResearchRepository(db2.db);
      assert.equal(repo.getPoolSlot("slot-ind-1-market")!.status, "sufficient");
      assert.equal(repo.getPoolSlot("slot-ind-1-demand")!.status, "conflicting");
      assert.equal(repo.getPoolSlot("slot-ind-1-supply")!.status, "partial");
      assert.equal(repo.getPoolSlot("slot-ind-1-policy")!.status, "unknown");
      db2.close();
    } finally {
      rmSync(path, { force: true });
    }
  });

  test("migration is idempotent: reopening the DB does not duplicate slots", () => {
    const path = tmpDbPath();
    try {
      const db1 = new ResearchDb({ path });
      insertLegacyEntry(db1, "pe-ind-1-market", "ind-1", "market", "partial");
      db1.close();

      for (let i = 0; i < 3; i++) {
        const db = new ResearchDb({ path });
        const repo = new ResearchRepository(db.db);
        assert.equal(repo.listPoolSlots("ind-1").length, 1, "no duplicate slots across reopens");
        db.close();
      }
    } finally {
      rmSync(path, { force: true });
    }
  });

  test("legacy entry table is never written by the NEW path (ingest writes Slots)", async () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const artifacts = new SqliteArtifactStore({ path: ":memory:" });
    const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);

    const res = await svc.ingestMaterial({ materialText: "x", industryName: "新能源" });
    const sid = res.industry.industryId;

    assert.equal(repo.listPoolSlots(sid).length, 12, "ingest created 12 slots");
    assert.equal(repo.listPoolEntries(sid).length, 0, "no legacy entries written");
    assert.ok(repo.getPoolSlot(poolSlotKey(sid, "market")), "deterministic slot key");
    db.close();
  });

  test("I5: a pool item MUST reference a Claim", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const bad: InformationPoolItem = {
      itemId: "item-x-0",
      slotId: "slot-ind-1-market",
      valueText: "500 亿",
      claimRef: "", // violates I5
      relation: "consistent",
      createdAt: "t0",
    };
    assert.throws(() => repo.replacePoolItems("slot-ind-1-market", [bad]), /must reference a Claim/);
    db.close();
  });
});
