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
  /** Derived from the ACTIVE methodology dimension — never hard-coded. */
  importance: number;
  requiredEvidenceType: string;
  // --- E1: inherited from the methodology dimension, used to judge "is this enough?" ---
  confirmedCondition: string;
  uncertainCondition: string;
  unknownCondition: string;
  /** Where to look first (ResearchPosition kinds); Phase B populates this. */
  preferredPositionKinds: string[];
  status: RequirementStatus;
  createdAt: string;
  updatedAt: string;
}
