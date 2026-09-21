import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteResearchEventStore } from "./storage/research-event-store.js";
import { ResearchEventAdapter } from "./runtime/research-event-adapter.js";
import { RESEARCH_EVENT_CHANNEL, type EventBusPort } from "./ports/event-bus.port.js";
import type { ResearchEvent } from "./domain/research-event.js";

/** Minimal structural EventBus mirroring Pi's {emit,on}. */
function makeFakeBus(): EventBusPort & { emitRaw(ch: string, d: unknown): void } {
  const listeners = new Map<string, Set<(d: unknown) => void>>();
  return {
    on(ch, h) {
      if (!listeners.has(ch)) listeners.set(ch, new Set());
      listeners.get(ch)!.add(h);
      return () => listeners.get(ch)?.delete(h);
    },
    emit(ch, d) {
      for (const h of listeners.get(ch) ?? []) h(d);
    },
    emitRaw(ch, d) {
      for (const h of listeners.get(ch) ?? []) h(d);
    },
  };
}

test("adapter bridges transient EventBus -> durable store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "adb-"));
  const store = new SqliteResearchEventStore({ path: join(dir, "a.db") });
  const bus = makeFakeBus();
  const adapter = new ResearchEventAdapter({ store, bus });
  adapter.start();

  const event: ResearchEvent = {
    eventId: "bridge-1",
    runId: "run-x",
    type: "score_changed",
    payload: { score: 71 },
    occurredAt: new Date().toISOString(),
    source: "bridge-test",
  };
  // Emit a raw transient event on the research channel (simulates UI/pi bus).
  bus.emitRaw(RESEARCH_EVENT_CHANNEL, {
    eventId: event.eventId,
    runId: event.runId,
    type: event.type,
    payload: event.payload,
    occurredAt: event.occurredAt,
    source: event.source,
  });

  // allow async handler to flush
  await new Promise((r) => setTimeout(r, 20));
  const back = await store.get("bridge-1");
  assert.ok(back, "bridged event should be persisted");
  assert.equal(back?.type, "score_changed");

  // emit() fans out to both transient and durable
  await adapter.emit({ ...event, eventId: "bridge-2" });
  assert.ok(await store.get("bridge-2"));

  adapter.stop();
  await store.close();
});
