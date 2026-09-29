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
  locatorKey,
  normalizeText,
  type FragmentLocator,
  type MaterialFragment,
  type MaterialVersion,
} from "../domain/material-source.js";
import {
  DEFAULT_WINDOW_RULE,
  extractionWindowFor,
  type ExtractionWindow,
  type WindowRule,
} from "./extraction-window.js";
import { randomUUID } from "node:crypto";
import {
  chunkerVersionOf,
  dimensionSetHashOf,
  modelExtractionConfigKeyFor,
  type ExtractionConfigSnapshot,
} from "./model-extraction-config.js";
import {
  resolveQuotes,
  type ModelExtractionAdapter,
  type ResolvedQuote,
} from "./model-extraction.js";
import { METHODOLOGY_V1 } from "../methodology/methodology-v1.js";
import type { MethodologyVersion } from "../domain/methodology.js";
import type { ResearchRepository } from "../storage/research-repository.js";

/**
 * ★ §M14.8 — the CLI assembly must be able to NAME the model seam and the default window rule.
 * `packages/research/src/index.ts` re-exports THIS module only (and index.ts is NOT in F2's
 * whitelist), so they are surfaced here rather than by widening the package surface elsewhere.
 */
export type { ModelExtractionAdapter } from "./model-extraction.js";
export { DEFAULT_WINDOW_RULE } from "./extraction-window.js";

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

/**
 * ★ Slice F (§M13.4) — what Slice B has ALREADY validated (V1–V4) and resolved. This is the ONLY
 * thing F consumes: F never re-derives, re-parses or re-prompts candidate content, and never
 * reverse-engineers the draft from a quote.
 *
 * `draft` and `quotes` are SIBLINGS, deliberately NOT one extended type: `ResolvedQuote` keeps its
 * frozen six-field contract (windowId / startGlobal / endGlobal / fragmentLocator / quoteHash /
 * quoteText) and carries no candidate semantics.
 */
export interface ValidatedCandidate {
  readonly draft: {
    readonly dimension: string;
    readonly statement: string;
    readonly contentKind: CandidateContentKind;
    readonly confidence?: number;
  };
  /** The quotes of THIS draft, already resolved to version-global coordinates (Slice B). */
  readonly quotes: readonly ResolvedQuote[];
}

/**
 * ★ Slice F (§M13.9) — the outcome of ONE atomic persistence pass.
 * `committed === false` means the fenced close-out lost the run; in that case NOTHING was written
 * and every count below is zero.
 */
export interface PersistResult {
  /** Candidates newly inserted by this pass. */
  created: number;
  /** Candidates that already existed (same identity) and were left untouched. */
  reused: number;
  /** How many of those actually gained evidence in this pass. */
  merged: number;
  /** Candidates a human had touched (reviewed protection) ⇒ NOT appended, NOT modified. */
  skippedReviewed: number;
  candidateIds: string[];
  /** `false` ⇒ this generation lost the run (fencing); NOTHING was written. */
  committed: boolean;
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
  /**
   * ★ Slice F (§M13.1 / §M13.10): TRUE when this call ran NO extraction at all, because a
   * `completed` run already existed for this (material version, config) and was reused verbatim.
   *
   * NOT the same as `reused`, which counts CANDIDATES reused inside this persistence pass: when
   * `reusedRun` is true, `created` / `reused` / `merged` / `skippedReviewed` are ALL zero.
   */
  reusedRun: boolean;
  /** ★ Slice F: how many candidates a human had touched and were therefore NOT modified. */
  skippedReviewed: number;
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
 * ★ §M13.9 clarification 1 / step ⑦ — this generation NO LONGER holds the run. It is thrown from
 * INSIDE the persistence transaction (by ① or by ⑦), so the transaction rolls back with zero
 * business residue; closing the run out as `failed` is the CALLER's job, OUTSIDE that transaction
 * and still under generation/owner fencing (clarification 2).
 */
export class LostLeaseError extends CandidateExtractionError {}

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
   * ★ Slice F (§M13.9) — THE persistence entry point. This is the ONLY place candidates are
   * written: `run()` routes through it and the Slice F tests call it directly, so the candidate
   * write path has exactly ONE implementation.
   *
   * It consumes what Slice B already validated (`ValidatedCandidate[]`): it never re-derives,
   * re-parses or re-prompts candidate content, and it NEVER calls a model adapter (§M13.4).
   *
   * Everything below happens in ONE main-database transaction, in the contract's order (§M13.9):
   *   ① the FENCING GATE — a READ-ONLY existence check (status='running' AND generation AND owner).
   *      It must NOT change any state, and it does NOT replace ⑦;
   *   ② Fragment persistence (one exact `char_range` fragment per quote, §M5.3);
   *   ③ Evidence persistence (`stance = "supports"`, quote taken FROM the fragment);
   *   ④ candidate identity + persistence (insert-only; a PROTECTED candidate is skipped BEFORE any
   *      fragment/evidence is written for it — §M13.2 / §M13.9 clarification 4);
   *   ⑤ `reused` / `merged` / `skippedReviewed` counting;
   *   ⑥ the immutable config snapshot + the run's audit columns;
   *   ⑦ the fenced `completed` close-out — the FINAL authority (§M13.9 clarification 1).
   *
   * Any throw rolls the WHOLE transaction back ⇒ zero business residue. If ① or ⑦ finds that the run
   * is no longer this generation's, `LostLeaseError` is thrown and NOTHING is written. The `failed`
   * marker is deliberately NOT written here: §M6.3 / clarification 2 require it OUTSIDE the
   * transaction, still under generation/owner fencing.
   */
  async persistValidatedCandidates(input: {
    version: MaterialVersion;
    extractionId: string;
    owner: string;
    generation: number;
    extractionConfigKey: string;
    snapshot: ExtractionConfigSnapshot;
    candidates: readonly ValidatedCandidate[];
  }): Promise<PersistResult> {
    const at = this.now();

    // Identity is deterministic, so the ids are known BEFORE anything is written.
    const planned = input.candidates.map((candidate) => {
      const blockHash = candidateBlockHash({
        dimension: candidate.draft.dimension,
        statement: candidate.draft.statement,
        contentKind: candidate.draft.contentKind,
      });
      return {
        blockHash,
        candidateId: claimCandidateIdFor(
          input.version.materialVersionId,
          blockHash,
          candidate.draft.dimension,
          input.extractionConfigKey,
        ),
        candidate,
      };
    });
    const candidateIds = planned.map((p) => p.candidateId);

    return this.repo.transaction(() => {
      // ① ★ §M13.9 clarification 1 — the FENCING GATE. READ-ONLY: it asserts that this generation
      // still holds the run and changes NOTHING. It never replaces ⑦ below; precisely because it
      // leaves the row alone, a takeover between ① and ⑦ is still caught by ⑦.
      const held = this.repo.db
        .prepare(
          `SELECT 1 AS held
             FROM extraction_run
            WHERE extraction_id = ? AND status = 'running' AND generation = ? AND owner = ?`,
        )
        .get(input.extractionId, input.generation, input.owner) as { held: number } | undefined;
      if (held === undefined) {
        throw new LostLeaseError(
          "lost_lease: this run's generation is no longer current; nothing was written",
        );
      }

      // ②③④⑤ — fragments, evidence and candidates, one persistence unit at a time
      let created = 0;
      let reusedCount = 0;
      let merged = 0;
      let skippedReviewed = 0;
      for (const { blockHash, candidateId, candidate } of planned) {
        // ★ §M13.2 / §M13.9 clarification 4 — DECIDE FIRST, then (only if unprotected) WRITE.
        // A candidate a human has touched must not gain a single Fragment / Evidence row from this
        // run: judging AFTER `persistQuotes()` would protect the candidate row while still leaving
        // new fragment/evidence rows behind. The repository's SQL guard (§M13.3) is the second line
        // of defence for the very same rule.
        const existing = this.repo.getClaimCandidate(candidateId);
        if (existing !== undefined && this.isProtected(existing)) {
          skippedReviewed += 1;
          continue;
        }
        // ②+③ fragments + evidence — ONLY for a candidate that is not protected
        const evidenceRefs = this.persistQuotes(input.version, candidate.quotes, at);
        if (existing !== undefined) {
          // the SAME statement extracted from ANOTHER place: merge this occurrence's evidence in
          if (this.repo.appendCandidateEvidence(candidateId, evidenceRefs)) merged += 1;
          reusedCount += 1;
          continue;
        }
        const row: ClaimCandidate = {
          candidateId,
          materialVersionId: input.version.materialVersionId,
          subjectKind: input.version.subjectKind,
          subjectId: input.version.subjectId,
          dimension: candidate.draft.dimension,
          blockHash,
          statement: candidate.draft.statement,
          contentKind: candidate.draft.contentKind,
          ...(candidate.draft.confidence === undefined ? {} : { confidence: candidate.draft.confidence }),
          evidenceRefs: [...evidenceRefs],
          extractionId: input.extractionId,
          extractionConfigKey: input.extractionConfigKey,
          reviewStatus: "draft",
          ...(this.lineageFor(input.version.materialVersionId, blockHash, candidate.draft.dimension) === undefined
            ? {}
            : {
                supersedesCandidateRef: this.lineageFor(
                  input.version.materialVersionId,
                  blockHash,
                  candidate.draft.dimension,
                )!,
              }),
          projectionStatus: "none",
          createdAt: at,
        };
        // insert-only: an existing candidate is left EXACTLY as it is (it may carry a human edit)
        this.repo.insertClaimCandidate(row);
        created += 1;
      }

      // ⑥+⑦ ★ THE FINAL AUTHORITY (§M13.9 clarification 1). The business rows above are written
      // FIRST; the fenced close-out is LAST and carries status='running' + generation + owner in its
      // WHERE. `changes() !== 1` ⇒ this generation lost the run in the meantime ⇒ throw ⇒ the WHOLE
      // transaction (business rows included) rolls back.
      if (
        !this.closeOutRun({
          extractionId: input.extractionId,
          generation: input.generation,
          owner: input.owner,
          candidateIds,
          snapshot: input.snapshot,
          at,
        })
      ) {
        throw new LostLeaseError(
          "lost_lease: this run's generation is no longer current; nothing was written",
        );
      }

      return { created, reused: reusedCount, merged, skippedReviewed, candidateIds, committed: true };
    });
  }

  /**
   * §M13.2 — reviewed protection. `revise` deliberately KEEPS the status `draft` (it only sets
   * `reviewedBy`), so the status alone would let a later extraction quietly append evidence to a
   * candidate a human had already handled. Both signals are therefore checked.
   */
  private isProtected(candidate: ClaimCandidate): boolean {
    return candidate.reviewStatus !== "draft" || candidate.reviewedBy != null;
  }

  /**
   * §M5.3 steps 2–3 — one exact `char_range` Fragment per quote, then its Evidence.
   *
   * Because the fragment is built FROM the quote's own span, the four-way invariant holds by
   * construction: `fragment.text === evidence.quoteText === quote.text` and
   * `fragment.textHash === evidence.quoteHash === sha256Hex(quote.text)`. The two checks below turn
   * that from a hope into a refusal.
   */
  private persistQuotes(version: MaterialVersion, quotes: readonly ResolvedQuote[], at: string): string[] {
    // §M5.1: a candidate cites at least one quote — an evidence-free candidate is not a candidate.
    if (quotes.length === 0) {
      throw new CandidateExtractionError("a candidate must cite at least one quote (§M5.1: ≥ 1)");
    }
    const refs: string[] = [];
    for (const quote of quotes) {
      const fragment = buildMaterialFragment(version, quote.fragmentLocator, at);
      if (fragment.text !== quote.quoteText) {
        throw new CandidateExtractionError(
          `fragment text does not match the quote for ${quote.windowId} (§M5.3 "引文即 Fragment")`,
        );
      }
      if (fragment.textHash !== quote.quoteHash) {
        throw new CandidateExtractionError(`quote hash does not match the fragment's own textHash for ${quote.windowId}`);
      }
      this.repo.insertFragments([fragment]);
      const evidence = buildFragmentEvidence(version, fragment, "supports", at);
      this.repo.upsertFragmentEvidence(evidence);
      refs.push(evidence.evidenceId);
    }
    return refs;
  }

  /**
   * ★ The `[CANDIDATE]` extractor hands back ALREADY-REGISTERED evidence ids (it registered its own
   * fragments while parsing — that legacy behaviour is deliberately untouched, §M13.8). To route
   * that path through the SAME persistence entry point, its evidence ids are resolved back to
   * their fragment locators, which is exactly what a `ResolvedQuote` carries.
   *
   * Purely deterministic: it reads the fragment the id points at; nothing is invented. The entry
   * point then re-inserts the very same fragment/evidence (both writes are idempotent by identity).
   */
  private quotesFromEvidenceRefs(evidenceRefs: readonly string[]): ResolvedQuote[] {
    return evidenceRefs.map((evidenceId) => {
      const evidence = this.repo.getFragmentEvidence(evidenceId);
      if (evidence === undefined) {
        throw new CandidateExtractionError(`evidence ${evidenceId} does not exist`);
      }
      const fragment = this.repo.getFragment(evidence.fragmentId);
      if (fragment === undefined) {
        throw new CandidateExtractionError(`fragment ${evidence.fragmentId} does not exist`);
      }
      return {
        windowId: locatorKey(fragment.locator),
        startGlobal: fragment.locator.kind === "char_range" ? fragment.locator.start : 0,
        endGlobal: fragment.locator.kind === "char_range" ? fragment.locator.end : fragment.text.length,
        fragmentLocator: fragment.locator,
        quoteHash: fragment.textHash,
        quoteText: fragment.text,
      };
    });
  }

  /**
   * ★ §M14.3 — THE MODEL PATH. windows → per-window `extractBatch(input, signal)` → `resolveQuotes`
   * (V1–V4, zero tolerance) → `ValidatedCandidate[]`.
   *
   * ★ NOTHING is written here: this is the "compute first" half of §M6.3, so a failure anywhere
   * (a throwing adapter, a quote that fails V1–V4, a timeout) leaves ZERO business residue.
   *
   * ★ §M14.5 — ONE `AbortController` covers the WHOLE run: the same `signal` reaches EVERY batch, and
   * the deadline aborts it. The work is ALSO raced against the deadline, so an adapter that ignores
   * its signal cannot hold the run open (the contract promises "not awaited, not used, nothing
   * written" — never "the vendor's socket is closed").
   */
  private async extractWithModel(input: {
    version: MaterialVersion;
    model: ModelExtractionAdapter;
    rule: WindowRule;
    windows: readonly ExtractionWindow[];
    /** ★ §M14.4 — the methodology's DECLARED order; never sorted, never model-chosen. */
    dimensionHints: readonly string[];
    methodologyVersionId: string;
    timeoutMs: number;
  }): Promise<ValidatedCandidate[]> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new CandidateExtractionTimeoutError(`extraction timed out after ${input.timeoutMs}ms`));
      }, input.timeoutMs);
    });

    const work = async (): Promise<ValidatedCandidate[]> => {
      const units: ValidatedCandidate[] = [];
      // ★ Batch order is `window.index` ascending — the windows are already in that order (§M4.3).
      for (const window of input.windows) {
        const batch = await input.model.extractBatch(
          {
            materialVersionId: input.version.materialVersionId,
            window: { windowId: window.windowId, index: window.index, text: window.text },
            windowStartInVersion: window.start,
            dimensionHints: input.dimensionHints,
            methodologyVersionId: input.methodologyVersionId,
          },
          controller.signal,
        );
        for (const draft of batch.candidates) {
          // ★ Zero tolerance: the FIRST quote that fails V1–V4 fails the WHOLE run (nothing written).
          // An empty `candidates` list is LEGAL ("this window has no candidate") — not a failure.
          const quotes = resolveQuotes(draft.quotes, {
            windows: input.windows,
            maxQuoteChars: input.rule.maxQuoteChars,
          });
          units.push({
            draft: {
              dimension: draft.dimension,
              statement: draft.statement,
              contentKind: draft.contentKind,
              ...(draft.confidence === undefined ? {} : { confidence: draft.confidence }),
            },
            quotes,
          });
        }
      }
      return units;
    };

    try {
      return await Promise.race([work(), deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * The IMMUTABLE configuration snapshot for this run (§M7.3). The legacy `[CANDIDATE]` path has no
   * window rule of its own, so it records the default rule and its own parser identity; the model
   * path (Slice F2) supplies the real window rule. Written once, never mutated afterwards.
   */
  private snapshotFor(input: {
    timeoutMs: number;
    batchCount: number;
    attemptSeq: number;
    generation: number;
    rule: WindowRule;
    dimensionHints: readonly string[];
    /**
     * ★ §M14.4: the MODEL path records the REAL methodology version. The legacy path omits it and
     * keeps `"unbound"` (unchanged, so no legacy identity/snapshot byte moves).
     */
    methodologyVersionId?: string;
  }): ExtractionConfigSnapshot {
    return {
      windowRule: {
        version: input.rule.version,
        maxChars: input.rule.maxChars,
        overlapChars: input.rule.overlapChars,
        overlapAppliesTo: "long-paragraph-slices-only",
      },
      quotePolicy: { maxQuoteChars: input.rule.maxQuoteChars, allowedStances: ["supports"] },
      model: {
        modelVersion: this.extractor.modelVersion,
        promptVersion: this.extractor.promptVersion,
        parserVersion: this.parserVersion,
        schemaVersion: this.schemaVersion,
      },
      generation: {},
      methodology: {
        methodologyVersionId: input.methodologyVersionId ?? "unbound",
        dimensionHints: input.dimensionHints,
      },
      run: {
        timeoutMs: input.timeoutMs,
        batchCount: input.batchCount,
        attemptSeq: input.attemptSeq,
        generation: input.generation,
      },
    };
  }

  /**
   * ★ §M7.1a ④ / §M13.4 steps 6–7 — the FENCED close-out. The `status='running' AND generation=? AND
   * owner=?` predicate is part of the SQL, so a superseded generation can neither complete the run
   * nor overwrite the new owner's row. Returns `changes() === 1`.
   */
  private closeOutRun(input: {
    extractionId: string;
    generation: number;
    owner: string;
    candidateIds: string[];
    snapshot: ExtractionConfigSnapshot;
    at: string;
  }): boolean {
    const res = this.repo.db
      .prepare(
        `UPDATE extraction_run
            SET status = 'completed', finished_at = ?, candidate_ids_json = ?,
                chunker_version = ?, methodology_version_id = ?, dimension_set_hash = ?,
                max_quote_chars = ?, config_snapshot_json = ?
          WHERE extraction_id = ? AND status = 'running' AND generation = ? AND owner = ?`,
      )
      .run(
        input.at,
        JSON.stringify(input.candidateIds),
        chunkerVersionOf({
          ...input.snapshot.windowRule,
          maxQuoteChars: input.snapshot.quotePolicy.maxQuoteChars,
        }),
        input.snapshot.methodology.methodologyVersionId,
        dimensionSetHashOf(input.snapshot.methodology.dimensionHints),
        input.snapshot.quotePolicy.maxQuoteChars,
        JSON.stringify(input.snapshot),
        input.extractionId,
        input.generation,
        input.owner,
      );
    return Number(res.changes) === 1;
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
    opts: {
      timeoutMs?: number;
      leaseMs?: number;
      owner?: string;
      /**
       * ★ §M14.2 — THE MODEL PATH. Given ⇒ the model path (A-B-C wiring, §M14.3); absent ⇒ the
       * legacy `[CANDIDATE]` path, byte-for-byte unchanged. This is an EXPLICIT parameter: there is
       * no environment variable and no implicit "does this service happen to hold an adapter"
       * switch, so `--model` can never fall back to legacy — and legacy can never silently become a
       * model call.
       */
      model?: ModelExtractionAdapter;
      /** ★ §M14.3 — the window rule used by the MODEL path (default: `DEFAULT_WINDOW_RULE`). */
      rule?: WindowRule;
    } = {},
  ): Promise<RunResult> {
    // ★ §M14.4 — the two paths mint DIFFERENT configuration identities (`xcfg-…` vs `mxcfg-…`), so
    // their runs and candidates can never reuse or overwrite each other (§M11.2).
    const rule = opts.rule ?? DEFAULT_WINDOW_RULE;
    const methodology = this.repo.getActiveMethodology() ?? METHODOLOGY_V1;
    const dimensionHints = methodology.dimensions.map((d) => d.key);
    const configKey =
      opts.model === undefined
        ? this.extractionConfigKey
        : modelExtractionConfigKeyFor({
            windowRule: rule,
            maxQuoteChars: rule.maxQuoteChars,
            generation: {},
            methodologyVersionId: methodology.versionId,
            dimensionHints,
            modelVersion: opts.model.modelVersion,
            promptVersion: opts.model.promptVersion,
            parserVersion: opts.model.parserVersion,
            schemaVersion: this.schemaVersion,
          });

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
    if (claim.kind === "reused") {
      // ★ §M13.10 — ZERO side effects: the existing completed run is reused VERBATIM. No new
      // attempt, no `extract()` call, no fragment / evidence / candidate, and no change to the
      // existing extraction_run row. Every candidate-level counter stays zero (§M13.1).
      return {
        extractionId: claim.extractionId,
        created: 0,
        reused: 0,
        merged: 0,
        skippedReviewed: 0,
        candidateIds: claim.candidateIds,
        status: "completed",
        reusedRun: true,
      };
    }
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
        reusedRun: false,
        skippedReviewed: 0,
        in_progress: { owner: claim.owner, leaseUntil: claim.leaseUntil, attemptSeq: claim.attemptSeq },
      };
    }
    const { extractionId, generation } = claim;

    // ★ Two candidate PRODUCERS, ONE run skeleton (§M14.2). The legacy extractor hands back drafts
    // whose quotes are looked up from the evidence it registered (§M13.5a); the model path runs the
    // A-B-C wiring and produces `ValidatedCandidate[]` directly (§M14.3). Both then go through the
    // SAME `persistValidatedCandidates()` below — never a second write path.
    let units: ValidatedCandidate[];
    let batchCount: number;
    let snapshotRule: WindowRule = DEFAULT_WINDOW_RULE;
    let snapshotDimensions: readonly string[] = [];
    let snapshotMethodologyVersionId: string | undefined;
    try {
      if (opts.model === undefined) {
        const fragments = this.repo.listFragments(version.materialVersionId);
        const drafts = await withTimeout(
          this.extractor.extract({ version, fragments }),
          timeoutMs,
          () => `extraction timed out after ${timeoutMs}ms`,
        );
        // ★ A non-empty list is not enough: every ref must be REAL and belong to THIS material
        // version. A model-backed extractor must never be able to assert a source that does not exist.
        this.validateDrafts(drafts, version);
        units = drafts.map((draft) => ({
          draft: {
            dimension: draft.dimension,
            statement: draft.statement,
            contentKind: draft.contentKind,
            ...(draft.confidence === undefined ? {} : { confidence: draft.confidence }),
          },
          quotes: this.quotesFromEvidenceRefs(draft.evidenceRefs),
        }));
        batchCount = drafts.length;
        snapshotDimensions = drafts.map((d) => d.dimension);
      } else {
        // ★ §M14.3 — COMPUTE FIRST: every window is extracted AND every quote validated BEFORE the
        // single write transaction below. A failure here leaves zero business residue.
        const windows = extractionWindowFor(version, rule);
        units = await this.extractWithModel({
          version,
          model: opts.model,
          rule,
          windows,
          dimensionHints,
          methodologyVersionId: methodology.versionId,
          timeoutMs,
        });
        batchCount = windows.length;
        snapshotRule = rule;
        snapshotDimensions = dimensionHints;
        snapshotMethodologyVersionId = methodology.versionId;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof CandidateExtractionTimeoutError) {
        // ★ timeout ≠ lease failure: leave the row `running`, let the lease lapse by itself.
        return { extractionId, created: 0, reused: 0, merged: 0, skippedReviewed: 0, candidateIds: [], status: "failed", reusedRun: false, error: message };
      }
      this.finishRun({ extractionId, generation, owner, candidateIds: [], error: message, at: this.now() });
      return { extractionId, created: 0, reused: 0, merged: 0, skippedReviewed: 0, candidateIds: [], status: "failed", reusedRun: false, error: message };
    }

    // Identity is deterministic, so the ids are known BEFORE anything is written.
    // ★ Slice F (§M13.9): candidate persistence happens in exactly ONE place —
    // `persistValidatedCandidates()`, which `run()` and the Slice F persistence tests both call.
    // The extractor's drafts are handed over as `ValidatedCandidate`s: the content fields travel
    // UNCHANGED (F never re-derives them) and the quotes come from the fragments the drafts cite.
    let persisted: PersistResult;
    try {
      persisted = await this.persistValidatedCandidates({
        version,
        extractionId,
        owner,
        generation,
        extractionConfigKey: configKey,
        snapshot: this.snapshotFor({
          timeoutMs,
          batchCount,
          attemptSeq: generation,
          generation,
          rule: snapshotRule,
          dimensionHints: snapshotDimensions,
          ...(snapshotMethodologyVersionId === undefined
            ? {}
            : { methodologyVersionId: snapshotMethodologyVersionId }),
        }),
        candidates: units,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // ★ §M6.3 / §M13.9 clarification 2 — the persistence transaction has ALREADY rolled back:
      // zero business residue, and the run row is back to `running`. Closing it out as `failed` is
      // the CALLER's job, and it must STILL be fenced — a rollback is NOT an automatic `failed`.
      //
      // The business exception is the PRIMARY error; this close-out is best-effort:
      //   * a superseded generation (`changes() === 0`) is safely ignored — that IS fencing working;
      //   * a throwing close-out must never leak the original error as an unhandled rejection, and
      //     must not grow a second state machine.
      try {
        this.finishRun({ extractionId, generation, owner, candidateIds: [], error: message, at: this.now() });
      } catch {
        // fenced best-effort only: the error reported below stays the business error
      }
      return {
        extractionId,
        created: 0,
        reused: 0,
        merged: 0,
        skippedReviewed: 0,
        candidateIds: [],
        status: "failed",
        reusedRun: false,
        error: message,
      };
    }

    return {
      extractionId,
      created: persisted.created,
      reused: persisted.reused,
      merged: persisted.merged,
      skippedReviewed: persisted.skippedReviewed,
      candidateIds: persisted.candidateIds,
      status: "completed",
      reusedRun: false,
    };
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
    | { kind: "reused"; extractionId: string; candidateIds: string[] }
    | { kind: "in_progress"; owner: string; leaseUntil: string; attemptSeq: number } {
    const db = this.repo.db;
    // derived from the injected NOW (never `new Date()` / `Date.now()`)
    const leaseUntil = new Date(Date.parse(input.now) + input.leaseMs).toISOString();

    return this.repo.transaction(() => {
      // ⓪ ★ §M7.1 / §M13.10 — a COMPLETED run for this (version, config) is reused VERBATIM, and
      // this check runs BEFORE any new attempt row is created. Inside the same transaction as the
      // INSERT below, no other claim can interleave, so check and INSERT cannot race; the
      // "INSERT an attempt first and only then notice the completed run" shape is ruled out.
      const done = db
        .prepare(
          `SELECT extraction_id, candidate_ids_json
             FROM extraction_run
            WHERE material_version_id = ? AND extraction_config_key = ? AND status = 'completed'
            ORDER BY attempt_seq DESC
            LIMIT 1`,
        )
        .get(input.materialVersionId, input.configKey) as
        | { extraction_id: string; candidate_ids_json: string }
        | undefined;
      if (done !== undefined) {
        return {
          kind: "reused" as const,
          extractionId: done.extraction_id,
          candidateIds: JSON.parse(done.candidate_ids_json) as string[],
        };
      }

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
