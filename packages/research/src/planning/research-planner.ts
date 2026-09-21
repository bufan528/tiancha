/**
 * Deterministic research planner (NOT an LLM agent). Phase 1: skeleton only.
 */
import type { ResearchTask, TaskType } from "../domain/index.js";

export interface ResearchPlanner {
  plan(objective: string): ResearchTask[];
}

export const KNOWN_TASK_TYPES: readonly TaskType[] = [
  "plan",
  "hypothesis",
  "collect",
  "extract_industry",
  "resolve",
  "enrich",
  "evaluate",
  "critic",
  "dossier_update",
  "report",
  "human_gate",
];
