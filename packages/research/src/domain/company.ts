/**
 * Company — first-class research aggregate root (Phase 2A, identity only).
 */

export interface Company {
  companyId: string;
  canonicalName: string;
  aliases: string[];
  primaryIndustryId?: string;
  /**
   * C5-A: the research-role types this candidate company can play, drawn from the frozen
   * target-kind vocabulary (`domain/target-kind-vocabulary.ts`). Multi-valued on purpose —
   * one company may be both a benchmark customer and a large customer.
   * It is NOT `chainPosition` (that column has no vocabulary and no writer).
   */
  targetKinds: string[];
  chainPosition?: string;
  currentStateId?: string;
  createdAt: string;
  updatedAt: string;
}
