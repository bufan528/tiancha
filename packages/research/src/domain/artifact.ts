/**
 * Artifact Contract — FROZEN (lock ④). Task.outputs and TaskAttempt.outputs
 * only reference ArtifactRef. The actual blob lives in the ArtifactStore.
 */

export type ArtifactKind =
  | "fact"
  | "claim"
  | "evidence"
  | "score"
  | "report"
  | "dossier";

/** A locator that resolves an artifact blob to storage. */
export interface ArtifactLocator {
  /** e.g. "sqlite:research_artifact" | "file:artifacts/" */
  type: string;
  /** storage key / row id / file path. */
  id: string;
}

/** Lightweight reference to an artifact. */
export interface ArtifactRef {
  artifactId: string;
  kind: ArtifactKind;
  locator: ArtifactLocator;
}

/** The stored artifact record. */
export interface ResearchArtifact {
  artifactId: string;
  kind: ArtifactKind;
  schemaVersion: string;
  ref: ArtifactRef;
  createdAt: string;
  taskId: string;
  attemptId: string;
  runId: string;
  roundId?: string;
}

/** JSON Schema descriptor (Phase 1: opaque identifier only). */
export interface ArtifactSchema {
  kind: ArtifactKind;
  version: string;
  schema: unknown;
}
