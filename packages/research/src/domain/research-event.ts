/**
 * ResearchEvent — FROZEN durable event (lock ④). Landed in SQLite by the
 * ResearchEventStore; bridged from the transient Pi EventBus by ResearchEventAdapter.
 */

export type ResearchEventType =
  | "industry_discovered"
  | "score_changed"
  | "evidence_added"
  | "contradiction_detected"
  | "human_gate_created"
  | "human_gate_decided"
  | "dossier_updated"
  | "round_created"
  | "task_attempt_started"
  | "task_attempt_finished"
  | "report_published";

export interface ResearchEvent {
  eventId: string;
  runId?: string;
  roundId?: string;
  taskId?: string;
  industryId?: string;
  companyId?: string;
  type: ResearchEventType;
  /** Arbitrary JSON payload. */
  payload: Record<string, unknown>;
  occurredAt: string;
  /** Origin, e.g. "task-engine" | "orchestrator" | "human-gate". */
  source: string;
}
