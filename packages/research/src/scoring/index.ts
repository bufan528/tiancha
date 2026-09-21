/**
 * Scoring — Phase 1 placeholder. Reads config/scoring.json, 7-dimension scoring,
 * EvidenceCoverage/Confidence/Freshness. Business logic lands in Phase 2+.
 */
export interface DimensionSubscore {
  key: string;
  subscore: number;
  weight: number;
  evidenceCoverage: number;
  confidence: number;
  freshness: string;
}

export const ENTER_POOL_THRESHOLD = 65;

export class ScoringEngine {
  aggregate(_subscores: DimensionSubscore[]): number {
    return 0;
  }
}
