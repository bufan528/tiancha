/**
 * Industry — first-class research aggregate root (Phase 2A).
 * An Industry is a long-lived object; its Dossier/Profile is a projection,
 * never the source of truth.
 */

export type ReserveStatus =
  | "discovered"
  | "candidate"
  | "watch"
  | "reserve"
  | "parked"
  | "dropped";

export interface Industry {
  industryId: string;
  canonicalName: string;
  aliases: string[];
  description?: string;
  reserveStatus: ReserveStatus;
  currentStateId?: string;
  currentEvaluationRunId?: string;
  firstDiscoveredAt: string;
  lastEvaluatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function createIndustry(params: {
  industryId: string;
  canonicalName: string;
  aliases?: string[];
  description?: string;
  now?: Date;
}): Industry {
  const now = (params.now ?? new Date()).toISOString();
  return {
    industryId: params.industryId,
    canonicalName: params.canonicalName,
    aliases: params.aliases ?? [],
    description: params.description,
    reserveStatus: "discovered",
    firstDiscoveredAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
