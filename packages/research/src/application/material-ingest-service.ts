/**
 * MaterialIngestService (Phase C-MVP → **C-MVP-R1**) — the FIRST real input pipe.
 *
 * C-MVP made real material enter the system at all. C-MVP-R1 (contract §29) makes that entry
 * **resumable, concurrency-safe and auditable**, without touching the rule parser, Priority,
 * Evaluation or Knowledge semantics:
 *
 *   1. persist the material (subject provenance + content fingerprint) as a STATE MACHINE row;
 *   2. extract claims with the RULE-BASED parser (still no model, no Fragment, no Evidence);
 *   3. hand those claims to the EXISTING `OpportunityDiscoveryService.ingestClaims()`.
 *
 * Three things the old implementation could not do (§29.1 documents the defect):
 *   - a failure AFTER the material row was written made the material permanently un-completable
 *     (the dedupe gate saw "a row exists" and answered `created: false` forever);
 *   - one boolean could not distinguish "fully duplicated" from "left-over残骸";
 *   - nothing coordinated two concurrent imports of the same content.
 *
 * Invariants this file owns:
 *   - §29.2 a one-shot migration triages historical rows (completed / completed / legacy_failed);
 *   - §29.3 the dedupe gate only counts a row whose `ingestStatus === "completed"`;
 *   - §29.4 the outcome is a five-value union — never a boolean;
 *   - §29.5a ownership = ONE atomic UPDATE whose only admission condition is a free lease;
 *   - §29.5b `claimId` is allocated in P1 and persisted, so a cross-DB resume never duplicates.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ResearchRepository } from "../storage/research-repository.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import type { DataProviderPort } from "../ports/data-provider.port.js";
import { OpportunityDiscoveryService } from "./opportunity-discovery-service.js";
import { PARSER_VERSION, parseClaims } from "../domain/material-parser.js";
import { blockHash, ingestIdFor } from "../domain/material.js";
import type {
  Material,
  MaterialIngestBlock,
  MaterialIngestOutcome,
  MaterialIngestStage,
  MaterialKind,
  ParsedClaim,
} from "../domain/index.js";

export interface MaterialIngestInput {
  subjectKind: Material["subjectKind"];
  subjectId: string;
  title: string;
  text: string;
  filename?: string;
  locator?: string;
  /** Defaults to `user_self` — materials are supplied by the researcher. */
  sourceType?: MaterialSourceType;
  /**
   * ★ §29.5: re-run a material that is already `completed`. HUMAN-ONLY (CLI `--force`);
   * the Agent never gets this (§29.7 keeps the model's write surface unchanged).
   */
  force?: boolean;
  /**
   * ★ §29.2 (c): explicitly accept that a `legacy_failed` row may leave orphan Claims behind.
   * Required to retry such a row (see `retry()`); never implied by a plain re-submission.
   */
  acceptOrphanRisk?: boolean;
}

export interface MaterialIngestOptions {
  /** Lease length in ms (§29.5a). Production default is deliberately generous. */
  leaseMs?: number;
  /** Opaque owner id (§29.5a) — never a user name, never PII. */
  ownerId?: string;
}

type MaterialSourceType =
  | "user_self"
  | "management"
  | "customer_expert"
  | "public"
  | "third_party"
  | "user_judgment";

export class MaterialIngestService {
  private readonly ownerId: string;
  private readonly leaseMs: number;

  constructor(
    private readonly repo: ResearchRepository,
    private readonly provider: DataProviderPort,
    private readonly artifactStore: ArtifactStore,
    options: MaterialIngestOptions = {},
  ) {
    this.ownerId = options.ownerId ?? `owner-${randomUUID()}`;
    this.leaseMs = options.leaseMs ?? 60_000;
  }

  /**
   * ★ §29.3/§29.4 — submit material for one subject. Five outcomes, never a boolean:
   *   `created` (first import finished) · `duplicate` (a COMPLETED row with the same content) ·
   *   `resumed` (continued a non-terminal row and finished) · `in_progress` (somebody else holds
   *   a live lease) · `failed` (still not finished — including a `legacy_failed`残骸).
   */
  async ingest(input: MaterialIngestInput): Promise<MaterialIngestOutcome> {
    const contentHash = sha256(input.text);
    // §29.2 (b) as a FORWARD optimisation: parse first (pure + cheap), so "material with no valid
    // block" is recognised as a complete import without ever entering the projection pipeline.
    const parsed = parseClaims(input.text);

    const existing = this.repo.listMaterialsByContent(input.subjectKind, input.subjectId, contentHash);

    // §29.3: only a COMPLETED row means "fully duplicated".
    const completed = existing.find((m) => m.ingestStatus === "completed");
    if (completed && !input.force) return { outcome: "duplicate", material: completed };

    // §29.3: a migration残骸 is NEVER auto-resumed — it needs a human decision first.
    const legacy = existing.find((m) => m.ingestStatus === "legacy_failed");
    if (legacy && !input.acceptOrphanRisk) {
      return {
        outcome: "failed",
        material: legacy,
        stage: "migration",
        error: "LEGACY_PARTIAL_IMPORT",
      };
    }

    // A non-terminal row (received / parsed / failed / projecting) ⇒ resume it.
    const inFlight = existing.find(
      (m) => m.ingestStatus !== "completed" && m.ingestStatus !== "legacy_failed",
    );
    if (inFlight) return this.run(inFlight, this.ledgerFor(inFlight, parsed.claims), parsed, input);

    if (legacy) return this.run(legacy, this.ledgerFor(legacy, parsed.claims), parsed, input);
    if (completed) return this.run(completed, this.ledgerFor(completed, parsed.claims), parsed, input);

    // ---- NEW row (§29.5b P1): the ledger AND its claim ids are persisted with the row itself.
    const nowIso = new Date().toISOString();
    const material: Material = {
      materialId: `mat-${randomUUID()}`,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      kind: "text" satisfies MaterialKind,
      title: input.title,
      filename: input.filename,
      locator: input.locator,
      contentHash,
      rawText: input.text,
      claimRefs: [],
      receivedAt: nowIso,
      createdAt: nowIso,
      ingestStatus: "received",
      ingestStage: undefined,
      ingestError: undefined,
      parserVersion: PARSER_VERSION,
      modelVersion: undefined,
      ingestAttempts: 0,
      ingestOwner: undefined,
      ingestLeaseUntil: undefined,
      ingestBlocks: buildLedger(parsed.claims),
    };

    try {
      this.repo.upsertMaterial(material);
    } catch (err) {
      // §29.5a ① — we lost the INSERT race on UNIQUE(subject, content). Re-read and continue
      // through the normal gates instead of surfacing a raw SQLite error.
      const raced = this.repo.listMaterialsByContent(input.subjectKind, input.subjectId, contentHash);
      const winner = raced.find((m) => m.ingestStatus === "completed");
      if (winner) return { outcome: "duplicate", material: winner };
      const other = raced[0];
      if (other) return this.run(other, this.ledgerFor(other, parsed.claims), parsed, input);
      throw err;
    }

    return this.run(material, material.ingestBlocks, parsed, input, "created");
  }

  /**
   * ★ §29.5 — the EXPLICIT human retry (`tiancha research material retry <materialId>`).
   * This is the only way to touch a `completed` row (`force`) or a `legacy_failed`残骸
   * (`acceptOrphanRisk`), which is why the Agent is not given a tool for it.
   */
  async retry(
    materialId: string,
    options: { force?: boolean; acceptOrphanRisk?: boolean } = {},
  ): Promise<MaterialIngestOutcome> {
    const material = this.mustGet(materialId);
    if (material.ingestStatus === "completed" && !options.force) {
      return { outcome: "duplicate", material };
    }
    if (material.ingestStatus === "legacy_failed" && !options.acceptOrphanRisk) {
      return {
        outcome: "failed",
        material,
        stage: "migration",
        error: "LEGACY_PARTIAL_IMPORT",
      };
    }
    const parsed = parseClaims(material.rawText);
    return this.run(material, this.ledgerFor(material, parsed.claims), parsed, {
      subjectKind: material.subjectKind,
      subjectId: material.subjectId,
      title: material.title,
      text: material.rawText,
      filename: material.filename,
      locator: material.locator,
    });
  }

  /**
   * ★ §29.5b — the resumable core. `P1` is already done (the ledger exists); this method does the
   * atomic claim, then `P2` (idempotent artifact write) and `P3` (projection) block by block,
   * recording progress in the ledger after every step so any crash point is re-enterable.
   */
  private async run(
    material: Material,
    ledger: MaterialIngestBlock[],
    parsed: { claims: ParsedClaim[]; errors: string[] },
    input: MaterialIngestInput,
    outcome: "created" | "resumed" = "resumed",
  ): Promise<MaterialIngestOutcome> {
    // No valid block ⇒ there is nothing to project, and the import IS complete (§29.2 (b)).
    if (ledger.length === 0) {
      this.repo.updateMaterialProgress(material.materialId, {
        ingestStatus: "completed",
        ingestStage: null,
        ingestError: null,
        ingestBlocks: [],
        claimRefs: [],
        ingestOwner: null,
        ingestLeaseUntil: null,
      });
      return { outcome, material: this.mustGet(material.materialId), claimIds: [] };
    }

    // Make the row claimable again when a HUMAN explicitly asked for a re-run of a terminal row.
    if (material.ingestStatus === "completed" || material.ingestStatus === "legacy_failed") {
      this.repo.updateMaterialProgress(material.materialId, {
        ingestStatus: "received",
        ingestStage: null,
        ingestError: null,
        ingestBlocks: ledger,
        claimRefs: material.claimRefs,
        ingestOwner: null,
        ingestLeaseUntil: null,
      });
    }

    // ★ §29.5a: the atomic ownership claim. Lease = the ONLY admission condition, and the status
    // advances in the same statement ⇒ exactly one holder.
    const resumeStage: MaterialIngestStage = "received";
    const claimed = this.repo.claimMaterialIngest(
      material.materialId,
      this.ownerId,
      this.leaseUntil(),
      resumeStage,
      new Date().toISOString(),
    );
    if (!claimed) return { outcome: "in_progress", material: this.mustGet(material.materialId) };

    let progress = ledger;
    const skip = new Set(progress.filter((b) => b.state === "projected").map((b) => b.blockIndex));
    const stableId = ingestIdFor(material.subjectKind, material.subjectId, material.contentHash);

    try {
      const discovery = new OpportunityDiscoveryService(this.repo, this.provider, this.artifactStore);
      const { claimIds } = await discovery.ingestClaims({
        subjectKind: material.subjectKind,
        subjectId: material.subjectId,
        claims: parsed.claims,
        sourceType: input.sourceType ?? "user_self",
        sourceTitle: material.title,
        // §29.5b: stable Source identity ⇒ a resume never adds a second Source row.
        sourceId: `src-${stableId}`,
        // §29.5b: REUSE the ids reserved in P1 — this is what makes the retry idempotent.
        claimIds: progress.map((b) => b.claimId),
        runId: `ingest-${stableId}`,
        skipBlocks: skip,
        onBlockCommitted: (blockIndex, claimId, phase) => {
          progress = progress.map((b) =>
            b.blockIndex === blockIndex
              ? { ...b, claimId, state: phase === "projected" ? "projected" : "artifact_written" }
              : b,
          );
          // Ledger write + lease renewal AFTER each step (§29.5a: renew so a long material cannot
          // lose its lease half-way).
          this.repo.updateMaterialProgress(material.materialId, {
            ingestStatus: "projecting",
            ingestStage: "projecting",
            ingestError: null,
            ingestBlocks: progress,
            claimRefs: projectedRefs(progress),
            ingestOwner: this.ownerId,
            ingestLeaseUntil: this.leaseUntil(),
          });
        },
      });

      // ---- P4: close out. claim_refs == every block's id, in block order.
      const refs = progress.map((b) => b.claimId);
      this.repo.updateMaterialProgress(material.materialId, {
        ingestStatus: "completed",
        ingestStage: null,
        ingestError: null,
        ingestBlocks: progress,
        claimRefs: refs,
        ingestOwner: null,
        ingestLeaseUntil: null,
      });
      return { outcome, material: this.mustGet(material.materialId), claimIds };
    } catch (err) {
      // An EXPLICIT failure (we are still alive) releases the lease, so a human retry does not
      // have to wait for it to expire. A hard crash keeps the lease — that is what §29.5a is for.
      const message = (err as Error)?.message ?? String(err);
      this.repo.updateMaterialProgress(material.materialId, {
        ingestStatus: "failed",
        ingestStage: "projecting",
        ingestError: message.slice(0, 500),
        ingestBlocks: progress,
        claimRefs: projectedRefs(progress),
        ingestOwner: null,
        ingestLeaseUntil: null,
      });
      return {
        outcome: "failed",
        material: this.mustGet(material.materialId),
        stage: "projecting",
        error: message,
      };
    }
  }

  /**
   * The ledger to use for this attempt: the PERSISTED one is authoritative (§29.5b — those claim
   * ids are the resume anchors). Only a row without a ledger (legacy / force-rerun) gets a fresh
   * one built from the current parse.
   */
  private ledgerFor(material: Material, claims: ParsedClaim[]): MaterialIngestBlock[] {
    if (material.ingestBlocks.length > 0) return material.ingestBlocks;
    return buildLedger(claims);
  }

  private leaseUntil(now: Date = new Date()): string {
    return new Date(now.getTime() + this.leaseMs).toISOString();
  }

  private mustGet(materialId: string): Material {
    const m = this.repo.getMaterial(materialId);
    if (!m) throw new Error(`material '${materialId}' disappeared during ingest`);
    return m;
  }
}

function projectedRefs(ledger: MaterialIngestBlock[]): string[] {
  return ledger.filter((b) => b.state === "projected").map((b) => b.claimId);
}

/** §29.5b P1: one ledger entry per VALID block, with its claim id allocated right here. */
function buildLedger(claims: ParsedClaim[]): MaterialIngestBlock[] {
  return claims.map((claim, index) => ({
    blockIndex: index,
    blockHash: blockHash(claim),
    claimId: `claim-${randomUUID()}`,
    state: "reserved" as const,
  }));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
