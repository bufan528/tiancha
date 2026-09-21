import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteArtifactStore } from "./storage/artifact-store.js";
import { SqliteResearchEventStore } from "./storage/research-event-store.js";
import type { ResearchEvent } from "./domain/research-event.js";

describe("ArtifactStore put/get/list", () => {
  test("put -> get -> list by run/task round-trips", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    const store = new SqliteArtifactStore({ path: join(dir, "a.db") });
    const now = new Date().toISOString();
    const ref = await store.put({
      artifact: {
        artifactId: "art-1",
        kind: "evidence",
        schemaVersion: "1",
        ref: { artifactId: "art-1", kind: "evidence", locator: { type: "sqlite", id: "art-1" } },
        createdAt: now,
        taskId: "task-1",
        attemptId: "att-1",
        runId: "run-1",
      },
      blob: { note: "hello" },
    });
    assert.equal(ref.artifactId, "art-1");
    const got = await store.get("art-1");
    assert.ok(got);
    assert.deepEqual(got?.blob, { note: "hello" });
    const byRun = await store.listByRun("run-1");
    assert.equal(byRun.length, 1);
    const byTask = await store.listByTask("task-1");
    assert.equal(byTask.length, 1);
    await store.close();
  });
});

describe("ResearchEventStore durability across close/reopen", () => {
  test("write -> close -> reopen -> read back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "evt-"));
    const dbPath = join(dir, "e.db");
    const event: ResearchEvent = {
      eventId: "e-1",
      runId: "run-1",
      type: "evidence_added",
      payload: { k: 1 },
      occurredAt: new Date().toISOString(),
      source: "test",
    };
    const s1 = new SqliteResearchEventStore({ path: dbPath });
    await s1.append(event);
    await s1.close();

    // reopen on a brand new handle
    const s2 = new SqliteResearchEventStore({ path: dbPath });
    const back = await s2.get("e-1");
    assert.ok(back);
    assert.equal(back?.type, "evidence_added");
    assert.deepEqual(back?.payload, { k: 1 });
    const list = await s2.list({ runId: "run-1" });
    assert.equal(list.length, 1);
    await s2.close();
  });
});
