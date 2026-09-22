/**
 * Company — first-class research aggregate root (Phase 2A, identity only).
 */

export interface Company {
  companyId: string;
  canonicalName: string;
  aliases: string[];
  primaryIndustryId?: string;
  chainPosition?: string;
  currentStateId?: string;
  createdAt: string;
  updatedAt: string;
}
