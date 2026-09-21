/**
 * Evidence engine skeleton -Phase 1 behavior placeholder. Real extraction /
 * provenance / contradiction logic lands in Phase 2+.
 */
import type { Evidence } from "../domain/index.js";

export interface EvidenceQuery {
  claimId?: string;
  stance?: string;
}

export class EvidenceEngine {
  async query(_query: EvidenceQuery): Promise<Evidence[]> {
    return [];
  }
}
