/**
 * Company ↔ Industry relation.
 */

export type RelationType =
  | "primary"
  | "subtrack"
  | "chain_segment"
  | "application_scenario"
  | "tech_route";

export interface CompanyIndustryRelation {
  companyId: string;
  industryId: string;
  relationType: RelationType;
  confidence: number;
  startDate?: string;
  endDate?: string;
}
