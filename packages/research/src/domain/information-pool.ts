/**
 * InformationPool — "what the research needs / how much is currently known".
 * DOMAIN INVARIANT (T3): Pool is NOT a Knowledge Base.
 *   Pool answers:  research needs X; known=confirmed / partial / unknown / conflict.
 *   Knowledge answers: based on Evidence/Claims, what belief do we hold?
 * A Knowledge Claim must always be tied to Evidence. Pool entries track coverage
 * of InformationRequirements, not beliefs.
 */

export type PoolStatus = "confirmed" | "partial" | "unknown" | "conflict";

export interface InformationPoolEntry {
  entryId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  topic: string;
  status: PoolStatus;
  relatedRequirementIds: string[];
  evidenceRefs: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}
