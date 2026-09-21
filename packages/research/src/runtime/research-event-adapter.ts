/**
 * ResearchEventAdapter -bridges Pi's transient EventBusPort and the durable
 * ResearchEventStore. Subscribes to the research channel and persists events;
 * `emit` fans out to BOTH transient (UI) and durable (SQLite).
 */

import type { ResearchEvent } from "../domain/index.js";
import type { ResearchEventStore } from "../storage/research-event-store.js";
import type { EventBusPort, ResearchEventEnvelope } from "../ports/event-bus.port.js";
import { RESEARCH_EVENT_CHANNEL } from "../ports/event-bus.port.js";

export class ResearchEventAdapter {
  private unsubscriber: (() => void) | null = null;
  private readonly store: ResearchEventStore;
  private readonly bus: EventBusPort;

  constructor(deps: { store: ResearchEventStore; bus: EventBusPort }) {
    this.store = deps.store;
    this.bus = deps.bus;
  }

  /** Start listening on the transient channel and persisting incoming events. */
  start(): void {
    if (this.unsubscriber) return;
    this.unsubscriber = this.bus.on(RESEARCH_EVENT_CHANNEL, async (data: unknown) => {
      const event = toEvent(data);
      if (event) await this.store.append(event);
    });
  }

  /** Emit an event to BOTH transient bus (for UI) and durable store. */
  async emit(event: ResearchEvent): Promise<void> {
    const envelope: ResearchEventEnvelope = {
      eventId: event.eventId,
      runId: event.runId,
      roundId: event.roundId,
      taskId: event.taskId,
      industryId: event.industryId,
      companyId: event.companyId,
      type: event.type,
      payload: event.payload,
      occurredAt: event.occurredAt,
      source: event.source,
    };
    this.bus.emit(RESEARCH_EVENT_CHANNEL, envelope);
    await this.store.append(event);
  }

  stop(): void {
    this.unsubscriber?.();
    this.unsubscriber = null;
  }
}

function toEvent(data: unknown): ResearchEvent | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.eventId !== "string" || typeof d.type !== "string" || typeof d.occurredAt !== "string") {
    return null;
  }
  return {
    eventId: d.eventId,
    runId: optionalString(d.runId),
    roundId: optionalString(d.roundId),
    taskId: optionalString(d.taskId),
    industryId: optionalString(d.industryId),
    companyId: optionalString(d.companyId),
    type: d.type as ResearchEvent["type"],
    payload: (d.payload ?? {}) as Record<string, unknown>,
    occurredAt: d.occurredAt,
    source: typeof d.source === "string" ? d.source : "unknown",
  };
}

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
