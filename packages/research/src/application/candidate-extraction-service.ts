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
 */
export interface CandidateExtractor {
  readonly modelVersion: string;
  readonly promptVersion: string;
  extract(input: ExtractInput): CandidateDraft[];
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
  status: "completed" | "failed";
  error?: string;
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
   */
  run(version: MaterialVersion, at?: string): RunResult {
    const startedAt = at ?? this.now();
    const configKey = this.extractionConfigKey;
    const extractionId = extractionRunIdFor(version.materialVersionId, configKey, startedAt);
    const fragments = this.repo.listFragments(version.materialVersionId);

    const run: ExtractionRun = {
      extractionId,
      materialVersionId: version.materialVersionId,
      modelVersion: this.extractor.modelVersion,
      promptVersion: this.extractor.promptVersion,
      parserVersion: this.parserVersion,
      schemaVersion: this.schemaVersion,
      extractionConfigKey: configKey,
      startedAt,
      status: "running",
      candidateIds: [],
    };
    this.repo.insertExtractionRun(run);

    let drafts: CandidateDraft[];
    try {
      drafts = this.extractor.extract({ version, fragments });
      // ★ A non-empty list is not enough: every ref must be REAL and belong to THIS material
      // version. A model-backed extractor must never be able to assert a source that does not exist.
      this.validateDrafts(drafts, version);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.repo.updateExtractionRun(extractionId, {
        status: "failed",
        finishedAt: this.now(),
        error: message,
      });
      return { extractionId, created: 0, reused: 0, merged: 0, candidateIds: [], status: "failed", error: message };
    }

    const candidateIds: string[] = [];
    let created = 0;
    let reused = 0;
    /** Candidates whose evidence list GREW because the same statement appeared again. */
    let merged = 0;
    for (const draft of drafts) {
      const blockHash = candidateBlockHash({
        dimension: draft.dimension,
        statement: draft.statement,
        contentKind: draft.contentKind,
      });
      const candidateId = claimCandidateIdFor(version.materialVersionId, blockHash, draft.dimension, configKey);
      candidateIds.push(candidateId);
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

    this.repo.updateExtractionRun(extractionId, {
      status: "completed",
      finishedAt: this.now(),
      candidateIds,
    });
    return { extractionId, created, reused, merged, candidateIds, status: "completed" };
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

  extract(input: ExtractInput): CandidateDraft[] {
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
