/**
 * Structural mirror of Pi's EventBus. The composition root binds Pi's real
 * createEventBus() to this shape. research never imports coding-agent.
 *
 * Pi EventBus (verified from vendor source):
 *   emit(channel: string, data: unknown): void
 *   on(channel: string, handler: (data: unknown) => void): () => void
 */

export interface EventBusPort {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

/** A research-domain event envelope carried on a transient channel. */
export interface ResearchEventEnvelope {
  eventId: string;
  runId?: string;
  roundId?: string;
  taskId?: string;
  industryId?: string;
  companyId?: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  source: string;
}

/** Transient channel name the ResearchEventAdapter subscribes to. */
export const RESEARCH_EVENT_CHANNEL = "tiancha.research.event";
