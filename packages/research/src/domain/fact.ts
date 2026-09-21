/**
 * Fact — standardized structured observation (a "value"). Distinct from Claim.
 */

export interface Fact {
  factId: string;
  subject: string;
  metric: string;
  value: number | string;
  unit?: string;
  currency?: string;
  asOf?: string;
  /** Measurement caliber (metric ontology). */
  caliber?: string;
}
