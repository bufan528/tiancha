/**
 * Evidence extractor skeleton — Phase 1 placeholder. Real extraction lands in
 * Phase 2+.
 */
export interface ExtractionResult {
  extracted: number;
}

export class EvidenceExtractor {
  async extract(_source: unknown): Promise<ExtractionResult> {
    return { extracted: 0 };
  }
}
