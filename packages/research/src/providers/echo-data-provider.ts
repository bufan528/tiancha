/**
 * EchoDataProvider — deterministic Phase 2A placeholder data source.
 * HARD RULE: this is NOT real external data. It must never be used to make a
 * real investment judgment. Every observation is flagged:
 *   isRealExternalData = false
 *   sourceType         = "echo_placeholder"
 * Its only purpose is to exercise the Research Memory pipeline end-to-end.
 */

import type {
  DataProviderPort,
  DataObservation,
  DataRetrievalRequest,
} from "../ports/data-provider.port.js";

export class EchoDataProvider implements DataProviderPort {
  readonly name = "echo";

  async retrieve(req: DataRetrievalRequest): Promise<DataObservation> {
    const now = new Date().toISOString();
    return {
      provider: "echo",
      isRealExternalData: false,
      sourceType: "echo_placeholder",
      industryName: req.subjectName,
      fetchedAt: now,
      claims: req.metrics.map((m, i) => ({
        statement: `[echo-placeholder] ${req.subjectName} 在「${m}」维度存在待验证信号（非真实外部数据）`,
        dimension: m,
        stance: "contextualize" as const,
        confidence: 0.1,
      })),
    };
  }
}
