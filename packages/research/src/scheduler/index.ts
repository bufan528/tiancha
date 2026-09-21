/**
 * Scheduler — jobs / schedules / triggers / queue / collectors placeholders.
 * Must NOT contain TaskGraph / HumanGate / ModelRouter (those live in runtime/).
 * Phase 1: contracts only.
 */

export type FetchStatus = "success" | "partial" | "failed";
export type ExtractionStatus = "pending" | "done" | "failed";

export interface SourceEndpoint {
  endpointId: string;
  kind: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface FetchCursor {
  endpointId: string;
  lastFetchedAt?: string;
  etag?: string;
  lastModified?: string;
  contentHash?: string;
}

export interface ChangeSet {
  added: number;
  changed: number;
  removed: number;
}

export interface Collector {
  endpointId: string;
  fetch(): Promise<FetchStatus>;
  extract(): Promise<ExtractionStatus>;
}
