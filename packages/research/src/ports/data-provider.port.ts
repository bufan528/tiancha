/**
 * DataProviderPort — abstract data source (Phase 2A).
 * Domain/Application depend only on this port; concrete providers (Wind/Web/
 * LocalDocument) bind at composition root. EchoDataProvider is a test-only
 * placeholder and MUST NOT produce real investment judgments.
 */

export interface DataRetrievalRequest {
  purpose: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  subjectName: string;
  metrics: string[];
  asOf?: string;
}

export interface DataObservation {
  provider: string;
  /** Marked by every provider; echo placeholder sets false. */
  isRealExternalData: boolean;
  sourceType: string;
  industryName: string;
  claims: Array<{
    statement: string;
    dimension: string;
    stance: "support" | "contextualize";
    confidence: number;
  }>;
  fetchedAt: string;
}

export interface DataProviderPort {
  readonly name: string;
  retrieve(req: DataRetrievalRequest): Promise<DataObservation>;
}
