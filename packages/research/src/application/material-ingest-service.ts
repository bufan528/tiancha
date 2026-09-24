/**
 * MaterialIngestService (Phase C-MVP) — the FIRST real input pipe.
 *
 * It does exactly three things:
 *   1. persist the material (carrying subject provenance) and fingerprint its content;
 *   2. extract claims with the RULE-BASED parser (no model involved);
 *   3. hand those claims to the EXISTING `OpportunityDiscoveryService.ingestClaims()`.
 *
 * It does NOT re-implement any Knowledge / Pool / Gap write logic, and it changes no
 * Priority / Evaluation semantics.
 *
 * Idempotency: the same content (same subject + same content hash) is ingested ONCE.
 * A repeat returns `created: false` and never calls `ingestClaims` again, so no Claim /
 * Belief / PoolItem is duplicated.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ResearchRepository } from "../storage/research-repository.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import type { DataProviderPort } from "../ports/data-provider.port.js";
import { OpportunityDiscoveryService } from "./opportunity-discovery-service.js";
import { parseClaims } from "../domain/material-parser.js";
import type { Material, MaterialKind } from "../domain/index.js";

export interface MaterialIngestInput {
  subjectKind: Material["subjectKind"];
  subjectId: string;
  title: string;
  text: string;
  filename?: string;
  locator?: string;
  /** Defaults to `user_self` — materials are supplied by the researcher. */
  sourceType?: MaterialSourceType;
}

type MaterialSourceType = "user_self" | "management" | "customer_expert" | "public" | "third_party" | "user_judgment";

export interface MaterialIngestResult {
  material: Material;
  /** false => the identical material was already ingested (idempotent no-op). */
  created: boolean;
  parsedClaims: number;
  parseErrors: string[];
  /** Claim ids produced by THIS ingestion (empty on a duplicate). */
  claimIds: string[];
}

export class MaterialIngestService {
  constructor(
    private readonly repo: ResearchRepository,
    private readonly provider: DataProviderPort,
    private readonly artifactStore: ArtifactStore,
  ) {}

  async ingest(input: MaterialIngestInput): Promise<MaterialIngestResult> {
    const now = new Date().toISOString();
    const contentHash = sha256(input.text);
    const kind: MaterialKind = "text";

    // Idempotency gate: identical content for this subject is ingested ONCE.
    const existing = this.repo.findMaterialByHash(input.subjectKind, input.subjectId, contentHash);
    if (existing) {
      return {
        material: existing,
        created: false,
        parsedClaims: existing.claimRefs.length,
        parseErrors: [],
        claimIds: [],
      };
    }

    const material: Material = {
      materialId: `mat-${randomUUID()}`,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      kind,
      title: input.title,
      filename: input.filename,
      locator: input.locator,
      contentHash,
      rawText: input.text,
      claimRefs: [],
      receivedAt: now,
      createdAt: now,
    };
    this.repo.upsertMaterial(material);

    const { claims, errors } = parseClaims(input.text);
    if (claims.length === 0) {
      return { material, created: true, parsedClaims: 0, parseErrors: errors, claimIds: [] };
    }

    // The EXISTING pipeline does the knowledge work — no duplicated write logic here.
    const discovery = new OpportunityDiscoveryService(this.repo, this.provider, this.artifactStore);
    const { claimIds } = await discovery.ingestClaims({
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      claims,
      sourceType: input.sourceType ?? "user_self",
      sourceTitle: input.title,
    });

    // Traceability in both directions: material -> claims.
    const updated: Material = { ...material, claimRefs: claimIds };
    this.repo.upsertMaterial(updated);

    return {
      material: updated,
      created: true,
      parsedClaims: claims.length,
      parseErrors: errors,
      claimIds,
    };
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
