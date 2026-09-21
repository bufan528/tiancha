/**
 * ResearchEventStore - DURABLE event store (lock). SQLite via node:sqlite
 * DatabaseSync. Distinct from Pi's transient EventBus. Supports close + reopen
 * (persistence across process boundaries).
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ResearchEvent, ResearchEventType } from "../domain/index.js";

export interface ResearchEventStore {
  append(event: ResearchEvent): Promise<void>;
  list(filter?: { runId?: string; roundId?: string; taskId?: string; type?: ResearchEventType }): Promise<ResearchEvent[]>;
  get(eventId: string): Promise<ResearchEvent | undefined>;
  close(): Promise<void>;
}

export interface SqliteResearchEventStoreOptions {
  /** Absolute path to the sqlite file, or ":memory:". */
  path: string;
}

export class SqliteResearchEventStore implements ResearchEventStore {
  private readonly db: DatabaseSync;
  private readonly path: string;

  constructor(options: SqliteResearchEventStoreOptions) {
    this.path = options.path;
    if (this.path !== ":memory:" && !existsSync(dirname(this.path))) {
      mkdirSync(dirname(this.path), { recursive: true });
    }
    this.db = new DatabaseSync(this.path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_event (
        event_id    TEXT PRIMARY KEY,
        run_id      TEXT,
        round_id    TEXT,
        task_id     TEXT,
        industry_id TEXT,
        company_id  TEXT,
        type        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        source      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_event_run   ON research_event(run_id);
      CREATE INDEX IF NOT EXISTS idx_research_event_task  ON research_event(task_id);
      CREATE INDEX IF NOT EXISTS idx_research_event_type  ON research_event(type);
    `);
  }

  async append(event: ResearchEvent): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO research_event
         (event_id, run_id, round_id, task_id, industry_id, company_id, type, payload, occurred_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        event.runId ?? null,
        event.roundId ?? null,
        event.taskId ?? null,
        event.industryId ?? null,
        event.companyId ?? null,
        event.type,
        JSON.stringify(event.payload),
        event.occurredAt,
        event.source,
      );
  }

  async list(
    filter: { runId?: string; roundId?: string; taskId?: string; type?: ResearchEventType } = {},
  ): Promise<ResearchEvent[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.runId !== undefined) {
      where.push("run_id = ?");
      params.push(filter.runId);
    }
    if (filter.roundId !== undefined) {
      where.push("round_id = ?");
      params.push(filter.roundId);
    }
    if (filter.taskId !== undefined) {
      where.push("task_id = ?");
      params.push(filter.taskId);
    }
    if (filter.type !== undefined) {
      where.push("type = ?");
      params.push(filter.type);
    }
    const sql =
      "SELECT * FROM research_event" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY occurred_at ASC, rowid ASC";
    const rows = this.db.prepare(sql).all(...(params as any[])) as unknown as ResearchEventRow[];
    return rows.map(rowToEvent);
  }

  async get(eventId: string): Promise<ResearchEvent | undefined> {
    const row = this.db.prepare("SELECT * FROM research_event WHERE event_id = ?").get(eventId);
    if (!row) return undefined;
    return rowToEvent(row as unknown as ResearchEventRow);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

interface ResearchEventRow {
  event_id: string;
  run_id: string | null;
  round_id: string | null;
  task_id: string | null;
  industry_id: string | null;
  company_id: string | null;
  type: ResearchEventType;
  payload: string;
  occurred_at: string;
  source: string;
}

function rowToEvent(row: ResearchEventRow): ResearchEvent {
  return {
    eventId: row.event_id,
    runId: row.run_id ?? undefined,
    roundId: row.round_id ?? undefined,
    taskId: row.task_id ?? undefined,
    industryId: row.industry_id ?? undefined,
    companyId: row.company_id ?? undefined,
    type: row.type,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    occurredAt: row.occurred_at,
    source: row.source,
  };
}
