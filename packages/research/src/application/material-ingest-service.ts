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
 * Invariants this file owns:
 *   - §29.2 the one-shot migration triages historical rows (completed / completed / legacy_failed);
 *   - §29.3 the dedupe gate only counts a row whose `ingestStatus === "completed"`;
 *   - §29.4 the outcome is a five-value union — never a boolean;
 *   - §29.5a ownership = ONE atomic UPDATE whose only admission condition is a free lease, and the
 *     SAME statement issues a **fencing generation**: every later write must present it, so a
 *     process whose lease expired (or was taken over) can never overwrite the new holder;
 *   - §29.5b `claimId` is allocated in P1 and persisted, so a cross-DB resume never duplicates;
 *   - §29.2 (c) a `legacy_failed`残骸 is retried only after an **orphan Claim scan** that REUSES
 *     the Claims a previous attempt already wrote, instead of writing the same content twice.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ResearchRepository } from "../storage/research-repository.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import type { KnowledgeRepository } from "../storage/knowledge-repository.js";
import type { DataProviderPort } from "../ports/data-provider.port.js";
import { CLAIM_ARTIFACT_TASK_ID, OpportunityDiscoveryService } from "./opportunity-discovery-service.js";
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
   * ★ §29.2 (c): allow retrying a `legacy_failed` row. The orphan-Claim scan still runs first —
   * this flag authorises the human decision, it does not replace the detection.
   */
  acceptOrphanRisk?: boolean;
}

export interface MaterialIngestOptions {
  /** Lease length in ms (§29.5a). Production default is deliberately generous. */
  leaseMs?: number;
  /** Opaque owner id (§29.5a) — never a user name, never PII. */
  ownerId?: string;
  /**
   * ★ §29.2 (c): required for the orphan-Claim scan (a残骸 retry must reuse what already exists).
   * Injectable/probeable; tests may omit it when they do not exercise that path.
   */
  knowledge?: KnowledgeRepository;
}

type MaterialSourceType =
  | "user_self"
  | "management"
  | "customer_expert"
  | "public"
  | "third_party"
  | "user_judgment";

/**
 * ★ §29.15: thrown when a残骸's orphan scan cannot decide which existing Claim a block belongs to.
 * We NEVER guess: merging two sources would silently break "independent sources".
 */
export class OrphanClaimAmbiguous extends Error {
  constructor(materialId: string, statement: string, candidates: number) {
    super(
      `ORPHAN_CLAIM_AMBIGUOUS: material '${materialId}' has ${candidates} existing Claims that match ` +
        `the same content (${JSON.stringify(statement.slice(0, 60))}); an operator must decide.`,
    );
    this.name = "OrphanClaimAmbiguous";
  }
}

/** Thrown when a progress write is refused because the fencing generation no longer matches. */
export class IngestLeaseLost extends Error {
  constructor() {
    super("lost the C-MVP-R1 ingest lease: another holder owns this material now");
    this.name = "IngestLeaseLost";
  }
}

interface MaterialProgressPatch {
  ingestStatus: Material["ingestStatus"];
  ingestStage: MaterialIngestStage | null;
  ingestError: string | null;
  ingestBlocks: MaterialIngestBlock[];
  ingestOverlaps: string[];
  claimRefs: string[];
  ingestOwner: string | null;
  ingestLeaseUntil: string | null;
}

export class MaterialIngestService {
  private readonly ownerId: string;
  private readonly leaseMs: number;
  private readonly knowledge?: KnowledgeRepository;

  constructor(
    private readonly repo: ResearchRepository,
    private readonly provider: DataProviderPort,
    private readonly artifactStore: ArtifactStore,
    options: MaterialIngestOptions = {},
  ) {
    this.ownerId = options.ownerId ?? `owner-${randomUUID()}`;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.knowledge = options.knowledge;
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
      return { outcome: "failed", material: legacy, stage: "migration", error: "LEGACY_PARTIAL_IMPORT" };
    }

    // A non-terminal row (received / parsed / failed / projecting) ⇒ resume it.
    const inFlight = existing.find(
      (m) => m.ingestStatus !== "completed" && m.ingestStatus !== "legacy_failed",
    );
    if (inFlight) {
      return this.run(inFlight, this.ledgerFor(inFlight, parsed.claims), parsed, input, {
        outcome: "resumed",
        allowCompleted: false,
        allowResidual: false,
      });
    }

    if (legacy || completed) {
      const terminal = (legacy ?? completed)!;
      const ledger = this.ledgerFor(terminal, parsed.claims);
      return this.run(terminal, ledger, parsed, input, {
        outcome: "resumed",
        // ★ §29.17: authorise by USER INTENT, never by the status we just read — the row can change
        // under us, and that is exactly the race the whitelist must not open.
        allowCompleted: input.force === true,
        allowResidual: input.acceptOrphanRisk === true,
      });
    }

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
      ingestGeneration: 0,
      ingestOwner: undefined,
      ingestLeaseUntil: undefined,
      ingestBlocks: buildLedger(parsed.claims),
      ingestOverlaps: [],
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
      if (other) {
        return this.run(other, this.ledgerFor(other, parsed.claims), parsed, input, {
          outcome: "resumed",
          allowCompleted: false,
          allowResidual: false,
        });
      }
      throw err;
    }

    return this.run(material, material.ingestBlocks, parsed, input, {
      outcome: "created",
      allowCompleted: false,
      allowResidual: false,
    });
  }

  /**
   * ★ §29.5 — the EXPLICIT human retry (`tiancha research material retry <materialId>`).
   * This is the only way to touch a `completed` row (`force`) or a `legacy_failed`残骸
   * (`acceptOrphanRisk`), which is why the Agent is not given a tool for it.
   *
   * ★ §29.2 (c): for a row WITHOUT a ledger (a pre-R1残骸) the orphan scan runs FIRST and any
   * Claim that a previous attempt already wrote is REUSED (`state = projected`) instead of being
   * written a second time.
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
      return { outcome: "failed", material, stage: "migration", error: "LEGACY_PARTIAL_IMPORT" };
    }
    const parsed = parseClaims(material.rawText);
    const ledger = this.ledgerFor(material, parsed.claims);
    return this.run(
      material,
      ledger,
      parsed,
      {
        subjectKind: material.subjectKind,
        subjectId: material.subjectId,
        title: material.title,
        text: material.rawText,
        filename: material.filename,
        locator: material.locator,
        force: options.force,
        acceptOrphanRisk: options.acceptOrphanRisk,
      },
      {
        outcome: "resumed",
        // ★ §29.17: intent-driven whitelist (see above) — a plain `retry` can never take over a row
        // that completed meanwhile.
        allowCompleted: options.force === true,
        allowResidual: options.acceptOrphanRisk === true,
      },
    );
  }

  /**
   * ★ §29.5b — the resumable core. The atomic claim (which also issues the fencing generation)
   * comes first; then `P2` (idempotent artifact write) and `P3` (projection) run block by block,
   * and EVERY write carries the generation, so a stale holder stops instead of overwriting.
   */
  private async run(
    material: Material,
    ledger: MaterialIngestBlock[],
    parsed: { claims: ParsedClaim[]; errors: string[] },
    input: MaterialIngestInput,
    options: { outcome: "created" | "resumed"; allowCompleted: boolean; allowResidual: boolean },
  ): Promise<MaterialIngestOutcome> {
    // ★ §29.5a (+ §29.2 (c) for terminal rows reached through an explicit retry): lease = the ONLY
    // admission condition, status advances in the same statement, and the generation is returned.
    const generation = this.repo.claimMaterialIngest(
      material.materialId,
      this.ownerId,
      this.leaseUntil(),
      "received",
      new Date().toISOString(),
      { allowCompleted: options.allowCompleted, allowResidual: options.allowResidual },
    );
    if (generation === null) {
      // ★ §29.17: report what ACTUALLY happened — if the row completed while we were losing the
      // race, the honest answer is `duplicate`, not `in_progress`.
      const current = this.mustGet(material.materialId);
      return current.ingestStatus === "completed"
        ? { outcome: "duplicate", material: current }
        : { outcome: "in_progress", material: current };
    }

    let progress = ledger;
    let overlaps: string[] = [];
    try {
      // ★ §29.15 (review round 2): the orphan scan runs HERE, not at the call sites, and for ANY
      // attempt whose ledger is still entirely `reserved` — which includes a BRAND-NEW material,
      // because the pre-R1 pipe wrote Claims for a subject before any `material` row existed at all.
      // (A resume, or a `--force` re-run, already holds ids it must reuse, so it is skipped.)
      if (progress.length > 0 && progress.every((b) => b.state === "reserved")) {
        // ★ §29.16: DETECTION ONLY — `detectOrphanOverlap` never rewrites the ledger.
        overlaps = await this.detectOrphanOverlap(material, parsed.claims, progress);
      }

      // No valid block ⇒ nothing to project, and the import IS complete (§29.2 (b)).
      if (progress.length === 0) {
        this.write(material, generation, {
          ingestStatus: "completed",
          ingestStage: null,
          ingestError: null,
          ingestBlocks: [],
          ingestOverlaps: overlaps,
          claimRefs: [],
          ingestOwner: null,
          ingestLeaseUntil: null,
        });
        return { outcome: options.outcome, material: this.mustGet(material.materialId), claimIds: [] };
      }

      const skip = new Set(progress.filter((b) => b.state === "projected").map((b) => b.blockIndex));
      const stableId = ingestIdFor(material.subjectKind, material.subjectId, material.contentHash);

      const discovery = new OpportunityDiscoveryService(this.repo, this.provider, this.artifactStore);
      const { claimIds } = await discovery.ingestClaims({
        subjectKind: material.subjectKind,
        subjectId: material.subjectId,
        claims: parsed.claims,
        sourceType: input.sourceType ?? "user_self",
        sourceTitle: material.title,
        // §29.5b: stable Source identity ⇒ a resume never adds a second Source row.
        sourceId: `src-${stableId}`,
        // §29.5b: REUSE the ids reserved in P1 (or adopted from the orphan scan).
        claimIds: progress.map((b) => b.claimId),
        runId: `ingest-${stableId}`,
        skipBlocks: skip,
        onBlockCommitted: (blockIndex, claimId, phase) => {
          progress = progress.map((b) =>
            b.blockIndex === blockIndex
              ? { ...b, claimId, state: phase === "projected" ? "projected" : "artifact_written" }
              : b,
          );
          // Ledger write + lease renewal AFTER each step. `write()` is FENCED: if the lease moved
          // on (expired and taken over), this throws and we stop writing immediately.
          this.write(material, generation, {
            ingestStatus: "projecting",
            ingestStage: "projecting",
            ingestError: null,
            ingestBlocks: progress,
            ingestOverlaps: overlaps,
            claimRefs: projectedRefs(progress),
            ingestOwner: this.ownerId,
            ingestLeaseUntil: this.leaseUntil(),
          });
        },
      });

      // ---- P4: close out. claim_refs == every block's id, in block order.
      const refs = progress.map((b) => b.claimId);
      this.write(material, generation, {
        ingestStatus: "completed",
        ingestStage: null,
        ingestError: null,
        ingestBlocks: progress,
        ingestOverlaps: overlaps,
        claimRefs: refs,
        ingestOwner: null,
        ingestLeaseUntil: null,
      });
      return { outcome: options.outcome, material: this.mustGet(material.materialId), claimIds };
    } catch (err) {
      if (err instanceof IngestLeaseLost) {
        // Another holder owns the row now: report it honestly and write NOTHING (fencing).
        return { outcome: "in_progress", material: this.mustGet(material.materialId) };
      }
      const message = (err as Error)?.message ?? String(err);
      // ★ §29.16: an AMBIGUOUS overlap must stay IDENTIFIABLE as a残骸. If we wrote a plain
      // `failed`, `materialEvidenceIndex()` would not set `hasResidual` and the old, unattributable
      // Claims of this subject would be counted as confirmed evidence again.
      const ambiguous = err instanceof OrphanClaimAmbiguous;
      try {
        // An EXPLICIT failure (we are still alive) releases the lease, so a human retry does not
        // have to wait for it to expire. A hard crash keeps the lease — that is what §29.5a is for.
        this.write(material, generation, {
          ingestStatus: ambiguous ? "legacy_failed" : "failed",
          ingestStage: ambiguous ? "migration" : "projecting",
          ingestError: message.slice(0, 500),
          ingestBlocks: progress,
          ingestOverlaps: overlaps,
          claimRefs: projectedRefs(progress),
          ingestOwner: null,
          ingestLeaseUntil: null,
        });
      } catch {
        /* the lease moved on — the NEW holder's state must win (never overwrite it) */
        return { outcome: "in_progress", material: this.mustGet(material.materialId) };
      }
      return {
        outcome: "failed",
        material: this.mustGet(material.materialId),
        stage: ambiguous ? "migration" : "projecting",
        error: message,
      };
    }
  }

  /**
   * ★ §29.5a fencing — every progress/lease write presents the generation it was issued.
   * A refused write means we are no longer the holder ⇒ `IngestLeaseLost`.
   */
  private write(material: Material, generation: number, patch: MaterialProgressPatch): void {
    const applied = this.repo.updateMaterialProgress(material.materialId, patch, generation);
    if (!applied) throw new IngestLeaseLost();
  }

  /**
   * ★ §29.2 (c) — the ORPHAN CLAIM SCAN required before retrying a残骸: a pre-R1 import wrote its
   * Claims with RANDOM ids and no ledger, so we match by CONTENT (statement) against the Claims the
   * subject's beliefs already point at, and REUSE those ids (marking the block `projected`, so the
   * block is skipped entirely). Nothing is written here.
   */
  /**
   * ★ §29.16 (review round 3) — this used to ADOPT a matching existing Claim id. That was wrong:
   * *"a Claim with the same content is NOT proof that it belongs to THIS material"*. Two materials
   * may legitimately carry the same sentence and still be two INDEPENDENT SOURCES; adopting one id
   * for both silently destroys `independentSources`.
   *
   * So the scan is DETECTION ONLY — it never rewrites the ledger:
   *   · the material always keeps its OWN freshly reserved claim ids (provenance stays honest);
   *   · an overlap is only escalated when it is AMBIGUOUS (≥2 existing Claims for the same
   *     content), because then a human must decide how the sources relate (§29.16).
   *
   * Sources (unchanged from §29.15): every Claim artifact this pipe wrote for the subject — which
   * covers a残骸 that died before projecting — plus every Claim the subject's beliefs point at.
   */
  private async detectOrphanOverlap(
    material: Material,
    claims: ParsedClaim[],
    ledger: MaterialIngestBlock[],
  ): Promise<string[]> {
    const knowledge = this.knowledge;
    if (!knowledge || ledger.length === 0) return [];

    const candidates = new Map<string, Set<string>>();
    const addCandidate = (statement: string | undefined, claimId: string): void => {
      if (!statement) return;
      const bucket = candidates.get(statement) ?? new Set<string>();
      bucket.add(claimId);
      candidates.set(statement, bucket);
    };

    for (const artifact of await this.artifactStore.listByTask(CLAIM_ARTIFACT_TASK_ID)) {
      const record = await this.artifactStore.get(artifact.artifactId);
      const blob = record?.blob as { statement?: string; subjectId?: string } | undefined;
      if (!blob || blob.subjectId !== material.subjectId) continue;
      addCandidate(blob.statement, artifact.artifactId);
    }
    const k = knowledge.findKnowledgeBySubject(material.subjectKind, material.subjectId);
    if (k) {
      for (const belief of knowledge.listBeliefs(k.knowledgeId)) {
        const claimId = claimIdFromRef(belief.claimRef);
        if (!claimId) continue;
        const record = await this.artifactStore.get(claimId);
        const blob = record?.blob as { statement?: string } | undefined;
        addCandidate(blob?.statement, claimId);
      }
    }
    if (candidates.size === 0) return [];

    // ★ §29.17: which candidates are PROVABLY owned by a completed material? Only those may be
    // treated as an already-established source. Everything else is unattributed — even a single
    // candidate — and must keep this subject under the conservative downgrade.
    const attributed = new Set<string>();
    for (const other of this.repo.listMaterials(material.subjectId)) {
      if (other.ingestStatus !== "completed") continue;
      for (const claimId of other.claimRefs) attributed.add(claimId);
    }

    const overlaps: string[] = [];
    for (const block of ledger) {
      const statement = claims[block.blockIndex]?.statement;
      const matches = statement ? [...(candidates.get(statement) ?? [])] : [];
      // ★ §29.16: ambiguity is escalated — and never as a guess.
      if (matches.length > 1) {
        throw new OrphanClaimAmbiguous(material.materialId, statement!, matches.length);
      }
      for (const claimId of matches) {
        if (!attributed.has(claimId)) overlaps.push(`${CLAIM_REF_PREFIX}${claimId}`);
      }
    }
    return overlaps;
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

/** `artifact:claim/<id>` — the ONE prefix a belief's `claimRef` may use (§15 CR-10). */
const CLAIM_REF_PREFIX = "artifact:claim/";

/** `artifact:claim/<claimId>` ⇒ `<claimId>` (the belief→claim hop of the orphan scan). */
function claimIdFromRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const matched = /^artifact:claim\/(.+)$/.exec(ref);
  return matched?.[1];
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
