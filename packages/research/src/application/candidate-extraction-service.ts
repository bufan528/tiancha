/**
 * C6 slice ② — candidate EXTRACTION (contract §C6.4 / §C6.7 / §C6.17).
 *
 * Scope of this slice: the candidate data model, its DETERMINISTIC identity, the extraction-run
 * lifecycle and an injectable extractor interface. It does NOT:
 *  - write any Claim / Belief / Pool / Gap / Evaluation (I-C6-1) — candidates stay in their own table;
 *  - provide a review entry point (slice ③) or any projection (slice ④);
 *  - call a model. ★ The reference extractor is DETERMINISTIC and LLM-free. A model-backed
 *    extractor is the separately-authorized follow-up (§10 of HANDOFF: a model may DRAFT candidates,
 *    but that needs its own contract + authorization). The `CandidateExtractor` interface below is
 *    exactly the seam such an extractor plugs into.
 */

import {
  candidateBlockHash,
  claimCandidateIdFor,
  extractionConfigKeyFor,
  extractionRunIdFor,
  type CandidateContentKind,
  type ClaimCandidate,
  type ExtractionRun,
} from "../domain/claim-candidate.js";
import {
  buildFragmentEvidence,
  buildMaterialFragment,
  normalizeText,
  type FragmentLocator,
  type MaterialFragment,
  type MaterialVersion,
} from "../domain/material-source.js";
import { randomUUID } from "node:crypto";
import type { ResearchRepository } from "../storage/research-repository.js";

/** What an extractor proposes — no ids, no status: identity is derived by the service. */
export interface CandidateDraft {
  dimension: string;
  statement: string;
  contentKind: CandidateContentKind;
  confidence?: number;
  /** ≥ 1 evidence id (fragment_evidence). */
  evidenceRefs: string[];
  /** The locator this draft came from (kept for traceability). */
  sourceLocator?: FragmentLocator;
}

export interface ExtractInput {
  version: MaterialVersion;
  fragments: MaterialFragment[];
}

/**
 * ★ The seam for a future MODEL-backed extractor. Implementations must be pure with respect to
 * storage: they only READ the version/fragments and RETURN drafts.
 *
 * ★ Slice E: `extract` is ASYNC. The boundary is locked here so a model-backed adapter can plug
 * into `await extractor.extract(...)` without a second, synchronised API ever existing. The
 * deterministic reference implementation below keeps its parsing algorithm UNCHANGED — only its
 * signature became async.
 */
export interface CandidateExtractor {
  readonly modelVersion: string;
  readonly promptVersion: string;
  extract(input: ExtractInput): Promise<CandidateDraft[]>;
}

export interface RunResult {
  extractionId: string;
  /** Candidates newly inserted by this run. */
  created: number;
  /**
   * Candidates that already existed (same identity). Their content is left untouched, but evidence
   * from the new occurrence is MERGED in — see `merged`.
   */
  reused: number;
  /** How many of those actually gained evidence in this run. */
  merged: number;
  candidateIds: string[];
  /** Unchanged (§M6.2): Slice E does NOT add a status member — `in_progress` is its own field. */
  status: "completed" | "failed";
  error?: string;
  /**
   * ★ Slice E: set when this call found ANOTHER live run for the same (material version, config)
   * and therefore did NOT obtain the lease — THIS call performed no extraction.
   *
   * `reused` / `skippedReviewed` deliberately do NOT live here: they are about reusing a finished
   * run and about not touching reviewed candidates, which is Slice F.
   */
  in_progress?: { owner: string; leaseUntil: string; attemptSeq: number };
}

export interface CandidateExtractionOptions {
  /** Bumped when the BLOCK FORMAT changes (identity input). */
  parserVersion?: string;
  /** Bumped when the draft schema changes (identity input). */
  schemaVersion?: string;
  now?: () => string;
}

const DEFAULT_PARSER_VERSION = "candidate-parser/v1";
const DEFAULT_SCHEMA_VERSION = "candidate-schema/v1";

/** Slice E defaults: how long THIS call may wait, and how long its execution right lasts. */
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_LEASE_MS = 120_000;

/** A refused input (invalid timeout/lease) — never silently clamped. */
export class CandidateExtractionError extends Error {}

/** Distinguishes "this call waited too long" from "the extractor failed" (they differ in DB effect). */
export class CandidateExtractionTimeoutError extends Error {}

/**
 * Bound one promise by `timeoutMs`. ★ This bounds how long THIS CALL waits; it is NOT a lease
 * expiry — the caller must not treat it as one (Slice E ruling: timeout ≠ lease failure).
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CandidateExtractionTimeoutError(message())), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class CandidateExtractionService {
  constructor(
    private readonly repo: ResearchRepository,
    private readonly extractor: CandidateExtractor,
    private readonly options: CandidateExtractionOptions = {},
  ) {}

  private get parserVersion(): string {
    return this.options.parserVersion ?? DEFAULT_PARSER_VERSION;
  }

  private get schemaVersion(): string {
    return this.options.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  }

  private now(): string {
    return (this.options.now ?? (() => new Date().toISOString()))();
  }

  /** The configuration identity of this service — part of every candidate id (§C6.7). */
  get extractionConfigKey(): string {
    return extractionConfigKeyFor({
      modelVersion: this.extractor.modelVersion,
      promptVersion: this.extractor.promptVersion,
      parserVersion: this.parserVersion,
      schemaVersion: this.schemaVersion,
    });
  }

  /**
   * W3 — run an extraction over one material version.
   * Idempotent BY IDENTITY: the same configuration produces the same candidate ids, so a re-run
   * inserts nothing new. A DIFFERENT configuration produces NEW candidates and links each to its
   * predecessor via `supersedesCandidateRef` (lineage).
   * Candidates that already exist are NEVER overwritten — an existing row may carry a human edit
   * (I-C6-5).
   *
   * ★ Slice E: this is now the run's CONCURRENCY entry point. Before doing any work it CLAIMS the
   * (material version, configuration) pair:
   *   - a LIVE lease elsewhere ⇒ `in_progress`; THIS call extracts nothing;
   *   - an EXPIRED attempt ⇒ closed here (`failed` / `lease_expired`) so the partial unique index
   *     is free again, then a NEW attempt is claimed (`attempt_seq = MAX+1`, `generation` = it);
   *   - otherwise ⇒ this call owns the run.
   *
   * ★ FENCING IS IN THE SQL. Every state transition this method makes carries
   * `status='running' AND generation=? AND owner=?` as a WHERE predicate, so a generation that lost
   * the run cannot commit anything (`changes() !== 1` ⇒ nothing is written, no candidate is
   * inserted). A read-then-write in memory would be a TOCTOU window.
   *
   * ★ A TIMEOUT IS NOT A LEASE EXPIRY: on timeout the row is deliberately left `running` so the
   * lease lapses on its own; the caller just learns the call did not finish.
   *
   * ★ All lease/fencing SQL lives HERE rather than in the repository, because Slice E is authorized
   * to touch this file only. Slice F may lift it into the repository together with the
   * all-or-nothing transaction.
   */
  async run(
    version: MaterialVersion,
    at?: string,
    opts: { timeoutMs?: number; leaseMs?: number; owner?: string } = {},
  ): Promise<RunResult> {
    const configKey = this.extractionConfigKey;

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
    // ★ refuse rather than silently clamp
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new CandidateExtractionError(`timeoutMs must be a positive integer (got ${String(timeoutMs)})`);
    }
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new CandidateExtractionError(`leaseMs must be a positive integer (got ${String(leaseMs)})`);
    }
    const owner = opts.owner ?? `xowner-${randomUUID()}`;
    // ★ the SINGLE time source: `now()` provides "the present" for every lease/expiry decision.
    // `at` is only the recorded start time; it must never be used to decide whether a lease lives.
    const now = this.now();
    const startedAt = at ?? now;

    const claim = this.claimRun({
      materialVersionId: version.materialVersionId,
      configKey,
      owner,
      leaseMs,
      startedAt,
      now,
    });
    if (claim.kind === "in_progress") {
      // ★ No extraction was performed. `status` keeps its contract enum (§M6.2 = running |
      // completed | failed): that another live run holds this (version, config) pair is expressed
      // ONLY by `in_progress`, never by adding a third status member.
      return {
        extractionId: "",
        created: 0,
        reused: 0,
        merged: 0,
        candidateIds: [],
        status: "failed",
        in_progress: { owner: claim.owner, leaseUntil: claim.leaseUntil, attemptSeq: claim.attemptSeq },
      };
    }
    const { extractionId, generation } = claim;
    const fragments = this.repo.listFragments(version.materialVersionId);

    let drafts: CandidateDraft[];
    try {
      drafts = await withTimeout(
        this.extractor.extract({ version, fragments }),
        timeoutMs,
        () => `extraction timed out after ${timeoutMs}ms`,
      );
      // ★ A non-empty list is not enough: every ref must be REAL and belong to THIS material
      // version. A model-backed extractor must never be able to assert a source that does not exist.
      this.validateDrafts(drafts, version);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof CandidateExtractionTimeoutError) {
        // ★ timeout ≠ lease failure: leave the row `running`, let the lease lapse by itself.
        return { extractionId, created: 0, reused: 0, merged: 0, candidateIds: [], status: "failed", error: message };
      }
      this.finishRun({ extractionId, generation, owner, candidateIds: [], error: message, at: this.now() });
      return { extractionId, created: 0, reused: 0, merged: 0, candidateIds: [], status: "failed", error: message };
    }

    // Identity is deterministic, so the ids are known BEFORE anything is written.
    const planned = drafts.map((draft) => {
      const blockHash = candidateBlockHash({
        dimension: draft.dimension,
        statement: draft.statement,
        contentKind: draft.contentKind,
      });
      return {
        candidateId: claimCandidateIdFor(version.materialVersionId, blockHash, draft.dimension, configKey),
        draft,
        blockHash,
      };
    });
    const candidateIds = planned.map((p) => p.candidateId);

    // ★ THE COMMIT GATE. Decided by a conditional UPDATE, not by an in-memory comparison: if this
    // generation lost the lease (another attempt took over), `changes()` is 0 and NOTHING below runs.
    const committed = this.finishRun({
      extractionId,
      generation,
      owner,
      candidateIds,
      at: this.now(),
    });
    if (!committed) {
      return {
        extractionId,
        created: 0,
        reused: 0,
        merged: 0,
        candidateIds: [],
        status: "failed",
        error: "lost_lease: this run's generation is no longer current; nothing was written",
      };
    }

    let created = 0;
    let reused = 0;
    /** Candidates whose evidence list GREW because the same statement appeared again. */
    let merged = 0;
    for (const { candidateId, draft, blockHash } of planned) {
      const existing = this.repo.getClaimCandidate(candidateId);
      if (existing !== undefined) {
        // ★ the SAME statement extracted from ANOTHER place in the material: the candidate is
        // already there (insert-only), so MERGE this occurrence's evidence instead of dropping it.
        if (this.repo.appendCandidateEvidence(candidateId, draft.evidenceRefs)) merged += 1;
        reused += 1;
        continue;
      }
      const candidate: ClaimCandidate = {
        candidateId,
        materialVersionId: version.materialVersionId,
        subjectKind: version.subjectKind,
        subjectId: version.subjectId,
        dimension: draft.dimension,
        blockHash,
        statement: draft.statement,
        contentKind: draft.contentKind,
        ...(draft.confidence === undefined ? {} : { confidence: draft.confidence }),
        evidenceRefs: [...draft.evidenceRefs],
        extractionId,
        extractionConfigKey: configKey,
        reviewStatus: "draft",
        ...(this.lineageFor(version.materialVersionId, blockHash, draft.dimension) === undefined
          ? {}
          : { supersedesCandidateRef: this.lineageFor(version.materialVersionId, blockHash, draft.dimension)! }),
        projectionStatus: "none",
        createdAt: at ?? this.now(),
      };
      // insert-only: an existing candidate is left EXACTLY as it is (it may carry a human edit)
      this.repo.insertClaimCandidate(candidate);
      created += 1;
    }

    return { extractionId, created, reused, merged, candidateIds, status: "completed" };
  }

  /**
   * §M7.1a — claim the (material version, configuration) run in ONE transaction.
   * Order is fixed: a live lease blocks; an expired attempt yields; then a NEW attempt row is
   * INSERTed (never an UPDATE of a row that does not exist yet).
   */
  private claimRun(input: {
    materialVersionId: string;
    configKey: string;
    owner: string;
    leaseMs: number;
    /** Recorded start time (goes into `extraction_id` / `started_at`). */
    startedAt: string;
    /** ★ "The present" — the ONLY input to every lease decision here. */
    now: string;
  }):
    | { kind: "claimed"; extractionId: string; attemptSeq: number; generation: number }
    | { kind: "in_progress"; owner: string; leaseUntil: string; attemptSeq: number } {
    const db = this.repo.db;
    // derived from the injected NOW (never `new Date()` / `Date.now()`)
    const leaseUntil = new Date(Date.parse(input.now) + input.leaseMs).toISOString();

    return this.repo.transaction(() => {
      // ① a LIVE lease elsewhere ⇒ this call must not extract
      const active = db
        .prepare(
          `SELECT owner, lease_until, attempt_seq
             FROM extraction_run
            WHERE material_version_id = ? AND extraction_config_key = ? AND status = 'running'
              AND owner IS NOT NULL AND lease_until IS NOT NULL AND lease_until >= ?
            ORDER BY attempt_seq DESC
            LIMIT 1`,
        )
        .get(input.materialVersionId, input.configKey, input.now) as
        | { owner: string; lease_until: string; attempt_seq: number | null }
        | undefined;
      if (active !== undefined) {
        return {
          kind: "in_progress" as const,
          owner: active.owner,
          leaseUntil: active.lease_until,
          attemptSeq: active.attempt_seq ?? 0,
        };
      }

      // ② an EXPIRED / unleased attempt yields — closed here so the partial unique index is free
      db.prepare(
        `UPDATE extraction_run
            SET status = 'failed', error = 'lease_expired', finished_at = ?
          WHERE material_version_id = ? AND extraction_config_key = ? AND status = 'running'
            AND (owner IS NULL OR lease_until IS NULL OR lease_until < ?)`,
      ).run(input.now, input.materialVersionId, input.configKey, input.now);

      // ③ claim a NEW attempt (attempt_seq continues from this pair's MAX, generation = attempt_seq)
      const maxRow = db
        .prepare(
          `SELECT COALESCE(MAX(attempt_seq), 0) AS m
             FROM extraction_run
            WHERE material_version_id = ? AND extraction_config_key = ?`,
        )
        .get(input.materialVersionId, input.configKey) as { m: number };
      const attemptSeq = Number(maxRow.m) + 1;
      const generation = attemptSeq;
      // ★ §M6.2a: run id = extractionRunIdFor(materialVersionId, extractionConfigKey, attemptSeq).
      // `started_at` is an AUDIT field only and must NOT enter the identity — two requests in the
      // same millisecond would otherwise collide. NOTE: the identity function itself is NOT modified
      // by this slice; its third parameter is fed the attempt token, which is what the contract fixes.
      const extractionId = extractionRunIdFor(input.materialVersionId, input.configKey, String(attemptSeq));
      db.prepare(
        `INSERT INTO extraction_run
           (extraction_id, material_version_id, model_version, prompt_version, parser_version,
            schema_version, extraction_config_key, started_at, status, candidate_ids_json,
            owner, lease_until, attempt_seq, generation)
         VALUES (?,?,?,?,?,?,?,?,'running','[]',?,?,?,?)`,
      ).run(
        extractionId,
        input.materialVersionId,
        this.extractor.modelVersion,
        this.extractor.promptVersion,
        this.parserVersion,
        this.schemaVersion,
        input.configKey,
        input.startedAt,
        input.owner,
        leaseUntil,
        attemptSeq,
        generation,
      );
      return { kind: "claimed" as const, extractionId, attemptSeq, generation };
    });
  }

  /**
   * ★ FENCED write of a terminal state. The `generation` + `owner` + `running` predicate is part of
   * the SQL, so a superseded generation CANNOT overwrite the new owner's row.
   *
   * Returns whether this generation still held the run (`changes() === 1`).
   */
  private finishRun(input: {
    extractionId: string;
    generation: number;
    owner: string;
    candidateIds: string[];
    at: string;
    error?: string;
  }): boolean {
    const status = input.error === undefined ? "completed" : "failed";
    const res = this.repo.db
      .prepare(
        `UPDATE extraction_run
            SET status = ?, finished_at = ?, candidate_ids_json = ?, error = ?
          WHERE extraction_id = ? AND status = 'running' AND generation = ? AND owner = ?`,
      )
      .run(
        status,
        input.at,
        JSON.stringify(input.candidateIds),
        input.error ?? null,
        input.extractionId,
        input.generation,
        input.owner,
      );
    return Number(res.changes) === 1;
  }

  /** The predecessor of the same (blockHash, dimension) under ANY other extraction config. */
  private lineageFor(materialVersionId: string, blockHash: string, dimension: string): string | undefined {
    const prior = this.repo
      .listClaimCandidates(materialVersionId)
      .filter((c) => c.blockHash === blockHash && c.dimension === dimension);
    if (prior.length === 0) return undefined;
    // prefer the newest predecessor so a chain of configs stays traceable one hop at a time
    return prior.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0].candidateId;
  }


  /** ★ §C6.4/§C6.7: drafts must cite evidence that EXISTS and belongs to this version. */
  private validateDrafts(drafts: CandidateDraft[], version: MaterialVersion): void {
    validateDraftShapes(drafts);
    for (const [i, draft] of drafts.entries()) {
      for (const evidenceRef of draft.evidenceRefs) {
        const evidence = this.repo.getFragmentEvidence(evidenceRef);
        if (evidence === undefined) {
          throw new Error(`draft #${i}: evidence ${evidenceRef} does not exist`);
        }
        if (evidence.materialVersionId !== version.materialVersionId) {
          throw new Error(
            `draft #${i}: evidence ${evidenceRef} belongs to material version ${evidence.materialVersionId}, ` +
              `not ${version.materialVersionId}`,
          );
        }
      }
    }
  }

  listCandidates(materialVersionId: string): ClaimCandidate[] {
    return this.repo.listClaimCandidates(materialVersionId);
  }

  listRuns(materialVersionId: string): ExtractionRun[] {
    return this.repo.listExtractionRuns(materialVersionId);
  }

  getRun(extractionId: string): ExtractionRun | undefined {
    return this.repo.getExtractionRun(extractionId);
  }
}

/**
 * A draft with no evidence, or with an empty statement, is not a reviewable proposal.
 * ★ It also checks that every `evidenceRef` EXISTS and belongs to THIS material version — an
 * extractor (especially a future model-backed one) cannot point at evidence it made up.
 */
function validateDraftShapes(drafts: CandidateDraft[]): void {
  for (const [i, d] of drafts.entries()) {
    if (d.statement.trim().length === 0) {
      throw new Error(`draft #${i}: statement must not be empty`);
    }
    if (!d.evidenceRefs || d.evidenceRefs.length === 0) {
      throw new Error(`draft #${i}: every candidate must carry >= 1 evidence ref (§C6.4)`);
    }
    if (d.contentKind !== "fact" && d.contentKind !== "judgment") {
      throw new Error(`draft #${i}: contentKind must be fact | judgment (§C6.5)`);
    }
    if (d.dimension.trim().length === 0) {
      throw new Error(`draft #${i}: dimension must not be empty`);
    }
  }
}

// ---------------------------------------------------------------------------
// Reference extractor — DETERMINISTIC and LLM-FREE.
// ---------------------------------------------------------------------------

export interface ExplicitBlockExtractorOptions {
  /** Evidence stance used for every block it reads (the block states an assertion). */
  stance?: "supports" | "refutes" | "context";
  /** Evidence note recorded on the fragment evidence created for each block. */
  evidenceNote?: string;
}

/**
 * A deterministic extractor reading an explicit, human-written block format:
 *
 * ```text
 * [CANDIDATE]
 * dimension: market
 * kind: fact
 * statement: 2025 年全球出货约 2.5 万台
 * confidence: 0.6
 * evidence: paragraph:1
 * [/CANDIDATE]
 * ```
 *
 * Why a block format: it keeps slice ② testable end-to-end WITHOUT a model, and it makes the human
 * gate explicit — a `[CANDIDATE]` never becomes knowledge on its own, unlike a `[CLAIM]` block.
 * ★ Replacing this with a model-backed extractor is a SEPARATE, not-yet-authorized step.
 */
export class ExplicitBlockExtractor implements CandidateExtractor {
  readonly modelVersion = "none";
  readonly promptVersion = "none";
  private readonly parserVersion: string;

  constructor(
    private readonly repo: ResearchRepository,
    private readonly options: ExplicitBlockExtractorOptions & { parserVersion?: string } = {},
  ) {
    this.parserVersion = options.parserVersion ?? DEFAULT_PARSER_VERSION;
  }

  async extract(input: ExtractInput): Promise<CandidateDraft[]> {
    // read the BLOCKS from the version's normalized text; `fragments` resolve their evidence
    const text = normalizeText(input.version.rawText);
    const drafts: CandidateDraft[] = [];
    const re = /\[CANDIDATE\]([\s\S]*?)\[\/CANDIDATE\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const body = m[1];
      const get = (key: string): string | undefined => {
        const hit = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "m").exec(body);
        return hit?.[1]?.trim();
      };
      const dimension = get("dimension");
      const statement = get("statement");
      const rawKind = get("kind");
      const locatorRaw = get("evidence");
      if (dimension === undefined || statement === undefined || rawKind === undefined || locatorRaw === undefined) {
        throw new Error(`malformed [CANDIDATE] block: dimension/kind/statement/evidence are all required`);
      }
      const evidenceRefs = this.resolveEvidenceRefs(input.version, locatorRaw);
      const confidenceRaw = get("confidence");
      drafts.push({
        dimension,
        statement,
        contentKind: rawKind === "fact" ? "fact" : "judgment",
        ...(confidenceRaw === undefined ? {} : { confidence: Number(confidenceRaw) }),
        evidenceRefs,
      });
    }
    return drafts;
  }

  /** `evidence: paragraph:1` / `evidence: char_range:0:12` ⇒ a fragment + fragment evidence. */
  private resolveEvidenceRefs(version: MaterialVersion, raw: string): string[] {
    const locator = parseLocator(raw);
    const fragment = buildMaterialFragment(version, locator, new Date().toISOString());
    if (this.repo.getFragment(fragment.fragmentId) === undefined) {
      this.repo.insertFragments([fragment]);
    }
    const stance = this.options.stance ?? "supports";
    const existing = this.repo
      .listFragmentEvidence(version.materialVersionId)
      .filter((e) => e.fragmentId === fragment.fragmentId && e.stance === stance);
    if (existing.length > 0) return [existing[0].evidenceId];
    const evidence = buildFragmentEvidence(
      version,
      fragment,
      stance,
      new Date().toISOString(),
      this.options.evidenceNote,
    );
    this.repo.upsertFragmentEvidence(evidence);
    return [evidence.evidenceId];
  }
}

export function parseLocator(raw: string): FragmentLocator {
  const parts = raw.split(":").map((p) => p.trim());
  if (parts[0] === "paragraph" && parts.length === 2) {
    return { kind: "paragraph", index: Number(parts[1]) };
  }
  if (parts[0] === "char_range" && parts.length === 3) {
    return { kind: "char_range", start: Number(parts[1]), end: Number(parts[2]) };
  }
  throw new Error(`unsupported evidence locator "${raw}" (v1: paragraph:<i> | char_range:<start>:<end>)`);
}
