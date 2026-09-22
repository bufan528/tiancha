/**
 * InformationRequirement — what must be known to answer a ResearchQuestion.
 * e.g. market size / growth / customer count / purchase intent / real orders /
 * penetration / substitution demand / incremental demand source.
 * Chain: ResearchQuestion → InformationRequirement → InformationPool.
 */

export type RequirementStatus = "open" | "partially_met" | "met" | "blocked";

export interface InformationRequirement {
  requirementId: string;
  questionId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  dimension: string;
  description: string;
  importance: number;
  requiredEvidenceType: string;
  status: RequirementStatus;
  createdAt: string;
  updatedAt: string;
}
