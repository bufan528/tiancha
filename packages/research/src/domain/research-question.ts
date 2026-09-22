/**
 * ResearchQuestion — first-class (Phase 2A).
 * "机器人未来三年真实需求增长来自哪里" etc.
 * Chain: ResearchQuestion → InformationRequirement → InformationPool.
 */

export type QuestionStatus = "open" | "in_progress" | "answered" | "abandoned";

export interface ResearchQuestion {
  questionId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  statement: string;
  origin: "user" | "planner" | "material";
  status: QuestionStatus;
  priority: number;
  dependsOn: string[];
  answerClaimRef?: string;
  createdAt: string;
  updatedAt: string;
}
