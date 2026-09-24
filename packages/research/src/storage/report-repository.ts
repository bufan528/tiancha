/**
 * ReportRepository (S6) — persistence for READ-ONLY projections.
 *
 * Append-only: a snapshot is never updated in place; regenerating inserts a NEW row
 * (new id), so the previous snapshot stays readable. Nothing here can mutate a SoT.
 */

import type { DatabaseSync } from "node:sqlite";
import type { AnyProjection, ReportSections } from "../domain/index.js";
import { projectionId } from "../domain/index.js";

export class ReportRepository {
  constructor(public readonly db: DatabaseSync) {}

  /** Append one projection (report or dossier). */
  saveProjection(p: AnyProjection): void {
    this.db
      .prepare(
        `INSERT INTO report_snapshot
         (report_id, report_kind, subject_kind, subject_id, methodology_version_id,
          knowledge_version, generated_at, sections_json)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        projectionId(p),
        p.reportKind,
        p.subjectKind,
        p.subjectId,
        p.methodologyVersionId,
        p.reportKind === "dossier" ? p.knowledgeVersion : null,
        p.generatedAt,
        JSON.stringify(p.sections),
      );
  }

  getProjection(reportId: string): AnyProjection | undefined {
    const row = this.db.prepare("SELECT * FROM report_snapshot WHERE report_id = ?").get(reportId) as any;
    return row ? rowToProjection(row) : undefined;
  }

  /** Latest projection for a subject; optionally restricted to a kind. */
  getLatestProjection(subjectId: string, kind?: AnyProjection["reportKind"]): AnyProjection | undefined {
    const row = (
      kind
        ? this.db
            .prepare(
              "SELECT * FROM report_snapshot WHERE subject_id = ? AND report_kind = ? ORDER BY generated_at DESC, rowid DESC LIMIT 1",
            )
            .get(subjectId, kind)
        : this.db
            .prepare(
              "SELECT * FROM report_snapshot WHERE subject_id = ? ORDER BY generated_at DESC, rowid DESC LIMIT 1",
            )
            .get(subjectId)
    ) as any;
    return row ? rowToProjection(row) : undefined;
  }

  /** All projections for a subject, newest first (deterministic tie-break on id). */
  listProjections(subjectId: string): AnyProjection[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM report_snapshot WHERE subject_id = ? ORDER BY generated_at DESC, rowid DESC",
      )
      .all(subjectId) as any[];
    return rows.map(rowToProjection);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM report_snapshot").get() as any;
    return row?.n ?? 0;
  }
}

function rowToProjection(row: any): AnyProjection {
  const base = {
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    methodologyVersionId: row.methodology_version_id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections_json) as ReportSections,
  };
  if (row.report_kind === "dossier") {
    return {
      ...base,
      dossierId: row.report_id,
      reportKind: "dossier",
      industryId: row.subject_id,
      knowledgeVersion: row.knowledge_version ?? 0,
    };
  }
  return { ...base, reportId: row.report_id, reportKind: "report" };
}
