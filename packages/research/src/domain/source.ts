/**
 * Source / Document / DocumentVersion / DocumentFragment / Citation (Phase 2A).
 * Provenance chain for Evidence:
 *   Source → Document → Version → Fragment → Citation → Evidence
 */

export type SourceType =
  | "user_self"
  | "management"
  | "customer_expert"
  | "public"
  | "third_party"
  | "agent_inferred"
  | "user_judgment"
  | "echo_placeholder";

export interface ResearchSource {
  sourceId: string;
  type: SourceType;
  publisher?: string;
  title?: string;
  publishedAt?: string;
  isRealExternalData: boolean;
  createdAt: string;
}

export interface ResearchDocument {
  documentId: string;
  sourceId: string;
  title: string;
  rawTextLocator?: string;
  createdAt: string;
}

export interface DocumentFragment {
  fragmentId: string;
  documentId: string;
  text: string;
  startChar?: number;
  endChar?: number;
  createdAt: string;
}
