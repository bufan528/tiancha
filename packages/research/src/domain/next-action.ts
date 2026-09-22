/**
 * NextAction — executable next research step (Phase 2A).
 * Planner outputs structured actions, not prose.
 */

export type NextActionKind =
  | "retrieve_data"
  | "read_material"
  | "research_company"
  | "interview"
  | "field_visit"
  | "wait_evidence"
  | "request_manual_input"
  | "reevaluate"
  | "escalate_gap";

export type NextActionStatus = "open" | "done" | "cancelled";

export interface NextAction {
  actionId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  kind: NextActionKind;
  params: Record<string, unknown>;
  dependsOn: string[];
  priority: number;
  rationale: string;
  status: NextActionStatus;
  createdBy: "planner" | "user";
  createdAt: string;
  updatedAt: string;
}
