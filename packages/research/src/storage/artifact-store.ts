/**
 * ArtifactStore — put/get/list by runId/task. Stores the ResearchArtifact
 * record plus its opaque blob payload. Locators resolve to this store.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ArtifactKind, ArtifactRef, ResearchArtifact } from "../domain/index.js";

export interface ArtifactRecord {
  artifact: ResearchArtifact;
  blob: unknown;
}

export interface ArtifactStore {
  put(record: ArtifactRecord): Promise<ArtifactRef>;
  get(artifactId: string): Promise<ArtifactRecord | undefined>;
  listByRun(runId: string): Promise<ResearchArtifact[]>;
  listByTask(taskId: string): Promise<ResearchArtifact[]>;
  close(): Promise<void>;
}

export interface SqliteArtifactStoreOptions {
  path: string;
}

const LOCATOR_TYPE = "sqlite:research_artifact";

export class SqliteArtifactStore implements ArtifactStore {
  private readonly db: DatabaseSync;
  private readonly path: string;

  constructor(options: SqliteArtifactStoreOptions) {
    this.path = options.path;
    if (this.path !== ":memory:" && !existsSync(dirname(this.path))) {
      mkdirSync(dirname(this.path), { recursive: true });
    }
    this.db = new DatabaseSync(this.path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_artifact (
        artifact_id    TEXT PRIMARY KEY,
        kind           TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        run_id         TEXT NOT NULL,
        round_id       TEXT,
        task_id        TEXT NOT NULL,
        attempt_id     TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        blob           TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifact_run  ON research_artifact(run_id);
      CREATE INDEX IF NOT EXISTS idx_artifact_task ON research_artifact(task_id);
    `);
  }

  async put(record: ArtifactRecord): Promise<ArtifactRef> {
    const a = record.artifact;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO research_artifact
         (artifact_id, kind, schema_version, run_id, round_id, task_id, attempt_id, created_at, blob)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.artifactId,
        a.kind,
        a.schemaVersion,
        a.runId,
        a.roundId ?? null,
        a.taskId,
        a.attemptId,
        a.createdAt,
        JSON.stringify(record.blob),
      );
    return {
      artifactId: a.artifactId,
      kind: a.kind,
      locator: { type: LOCATOR_TYPE, id: a.artifactId },
    };
  }

  async get(artifactId: string): Promise<ArtifactRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM research_artifact WHERE artifact_id = ?").get(artifactId);
    if (!row) return undefined;
    const r = row as unknown as ArtifactRow;
    return { artifact: rowToArtifact(r), blob: JSON.parse(r.blob) };
  }

  async listByRun(runId: string): Promise<ResearchArtifact[]> {
    const rows = this.db
      .prepare("SELECT * FROM research_artifact WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as unknown as ArtifactRow[];
    return rows.map(rowToArtifact);
  }

  async listByTask(taskId: string): Promise<ResearchArtifact[]> {
    const rows = this.db
      .prepare("SELECT * FROM research_artifact WHERE task_id = ? ORDER BY created_at ASC")
      .all(taskId) as unknown as ArtifactRow[];
    return rows.map(rowToArtifact);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

interface ArtifactRow {
  artifact_id: string;
  kind: ArtifactKind;
  schema_version: string;
  run_id: string;
  round_id: string | null;
  task_id: string;
  attempt_id: string;
  created_at: string;
  blob: string;
}

function rowToArtifact(row: ArtifactRow): ResearchArtifact {
  return {
    artifactId: row.artifact_id,
    kind: row.kind,
    schemaVersion: row.schema_version,
    ref: {
      artifactId: row.artifact_id,
      kind: row.kind,
      locator: { type: LOCATOR_TYPE, id: row.artifact_id },
    },
    createdAt: row.created_at,
    taskId: row.task_id,
    attemptId: row.attempt_id,
    runId: row.run_id,
    roundId: row.round_id ?? undefined,
  };
}
