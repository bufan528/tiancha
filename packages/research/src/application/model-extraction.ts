/**
 * C6 model-extractor · Slice B — the ONLY seam between a model and Tiancha, plus PURE quote
 * validation.
 *
 * Contract: `docs/phaseC/c6-model-extractor-contract.md` **rev6** §M3.4 / §M5.1–§M5.3.
 * Authorized scope (Slice B): types + `resolveQuote(s)` and nothing else.
 *
 * What this file deliberately does NOT do (each is another slice):
 *   - no persistence of any kind (no Fragment / Evidence / candidate, no database handle here);
 *   - **no Tiancha identity is generated** — not a `fragmentId`, not an `evidenceId`, not a
 *     `candidateId`, not a `confirmedClaimRef`. Those belong where the write happens (Slice F);
 *   - no `CandidateExtractionService.run()`, no `extraction_run`, no migration, no lease, no
 *     fencing, no attempt, no transaction, no retry/timeout runtime;
 *   - no extraction-config identity (Slice C), no CLI, no report, no `stance` display;
 *   - no model SDK, no network, no API key, no new dependency.
 *
 * The type boundary is the enforcement, not a comment: `ModelQuote` / `ModelCandidateDraft`
 * simply have NO field in which a Tiancha id could travel, and `ModelExtractionAdapter` receives
 * no storage. A model therefore cannot invent an id or write anything — it can only return text.
 *
 * `resolveQuote` is a PURE function: `(quote, {windows, maxQuoteChars}) → ResolvedQuote`, no
 * clock, no randomness, no I/O. Anything invalid REFUSES the whole batch's quote — the contract
 * never lets an unverifiable quote through (rev6 §M5.3, checks V1–V4).
 */

import { sha256Hex, type FragmentLocator } from "../domain/material-source.js";
import type { ExtractionWindow } from "./extraction-window.js";

// ---------------------------------------------------------------------------
// §M3.4 — what a model is allowed to SEE (read-only, no storage, no ids)
// ---------------------------------------------------------------------------

export interface ModelBatchInput {
  readonly materialVersionId: string;
  /** The normalized text of exactly ONE window (§M4.1 coordinates). */
  readonly window: {
    readonly windowId: string;
    readonly index: number;
    readonly text: string;
  };
  /** Where this window starts in the version, so the model can self-locate. */
  readonly windowStartInVersion: number;
  /**
   * Dimension keys, in the methodology's declared order (§M3.4). A model must not invent its own
   * dimension; wiring this to the active methodology is Slice C.
   */
  readonly dimensionHints: readonly string[];
  /** The methodology that produced `dimensionHints` (audit + identity, Slice C). */
  readonly methodologyVersionId: string;
}

// ---------------------------------------------------------------------------
// §M5.1 — what a model may SUBMIT (text only; there is no id field by construction)
// ---------------------------------------------------------------------------

/**
 * One quote the model relies on. ★ There is deliberately no `evidenceRef` / `fragmentId` /
 * `evidenceId` / `candidateId`: those are Tiancha's to mint, never the model's to claim.
 */
export interface ModelQuote {
  readonly windowId: string;
  /** Closed, in UTF-16 code units, relative to the window text. */
  readonly startInWindow: number;
  /** Open. */
  readonly endInWindow: number;
  /** The verbatim quoted text; must match the window slice character for character. */
  readonly text: string;
}

/** One candidate the model proposes. Text only — never an identity, never an approval. */
export interface ModelCandidateDraft {
  readonly dimension: string;
  readonly statement: string;
  readonly contentKind: "fact" | "judgment";
  readonly confidence?: number;
  readonly quotes: readonly ModelQuote[];
}

export interface ModelBatchResult {
  readonly candidates: readonly ModelCandidateDraft[];
}

/**
 * ★ The ONLY way a model enters this system (§M3.4). Pure with respect to storage: it reads text
 * and returns data; it has no writer, no database, and no way to mint an id.
 *
 * The ASYNC SHAPE is locked here on purpose (§M9 #1) so the seam never has to change later — but
 * Slice B implements no async runtime: nothing calls `extractBatch`, nothing awaits it, there is
 * no timeout, no `AbortController` lifecycle, no retry. Implementing the async *semantics* is
 * Slice E.
 */
export interface ModelExtractionAdapter {
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly parserVersion: string;
  extractBatch(input: ModelBatchInput, signal: AbortSignal): Promise<ModelBatchResult>;
}

// ---------------------------------------------------------------------------
// §M5.3 — pure validation + resolution of a quote
// ---------------------------------------------------------------------------

/** The closed set of machine-readable refusals (contract §M5.3 checks V1–V4). */
export type QuoteRefusal =
  | "QUOTE_OUT_OF_VERSION" // V1: the window is not part of this material version's window set
  | "QUOTE_RANGE_INVALID" // V2: start/end are not integers, or not 0 <= start < end <= text.length
  | "QUOTE_MISMATCH" // V3: the window slice is not character-for-character the quoted text
  | "QUOTE_TOO_LONG"; // V4: the resolved span exceeds maxQuoteChars

/** Raised on the FIRST failing check; carries the machine-readable reason and the quote position. */
export class QuoteValidationError extends Error {
  constructor(
    readonly reason: QuoteRefusal,
    readonly quoteIndex: number,
    readonly windowId: string,
    message: string,
  ) {
    super(`quote #${quoteIndex} (window ${windowId}): ${message}`);
    this.name = "QuoteValidationError";
  }
}

/**
 * The outcome of validating ONE quote: where it sits in the version, and its hash.
 *
 * ★ It carries no Tiancha identity on purpose — no `fragmentId`, no `evidenceId`, no `stance`.
 * Creating those (and writing them) is the writer's job in a later slice; this type only says
 * "this span of the normalized text is exactly what the model quoted".
 */
export interface ResolvedQuote {
  readonly windowId: string;
  /** Global offsets in `normalizeText(version.rawText)`, UTF-16 code units. */
  readonly startGlobal: number;
  readonly endGlobal: number;
  /** The exact locator the writer will use to create the fragment (§M5.3). */
  readonly fragmentLocator: FragmentLocator;
  /** `sha256Hex(quote.text)`; equals the fragment's own `textHash` once the fragment exists. */
  readonly quoteHash: string;
  readonly quoteText: string;
}

export interface ResolveQuotesInput {
  /** The material version's OWN windows — i.e. `extractionWindowFor(version, rule)` (§M4.5). */
  readonly windows: readonly ExtractionWindow[];
  /** `WindowRule.maxQuoteChars`; the window rule already guarantees `overlapChars >= this`. */
  readonly maxQuoteChars: number;
}

function refuse(
  quoteIndex: number,
  windowId: string,
  reason: QuoteRefusal,
  message: string,
): never {
  throw new QuoteValidationError(reason, quoteIndex, windowId, message);
}

/**
 * Validate ONE quote against the window set and resolve it into version-global coordinates.
 *
 * Checks, in contract order (§M5.3), each of which REFUSES rather than degrades:
 *   V1 `windowId` belongs to this version's window set;
 *   V2 `startInWindow` / `endInWindow` are integers with `0 <= start < end <= window.text.length`;
 *   V3 `window.text.slice(start, end) === quote.text` (verbatim, normalized text);
 *   V4 the resolved length is `<= maxQuoteChars`.
 *
 * PURE: depends only on its arguments.
 */
export function resolveQuote(quote: ModelQuote, input: ResolveQuotesInput, quoteIndex = 0): ResolvedQuote {
  const windowId = typeof quote.windowId === "string" ? quote.windowId : "";
  const window = input.windows.find((w) => w.windowId === quote.windowId);

  // V1 — the window must belong to THIS material version's window set (never another version's).
  if (window === undefined) {
    refuse(quoteIndex, windowId, "QUOTE_OUT_OF_VERSION", "windowId is not part of this material version");
  }

  // V2 — integer range inside the window text.
  const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
  if (!isInt(quote.startInWindow) || !isInt(quote.endInWindow)) {
    refuse(quoteIndex, windowId, "QUOTE_RANGE_INVALID", "startInWindow/endInWindow must be integers");
  }
  if (quote.startInWindow < 0 || quote.endInWindow > window.text.length) {
    refuse(
      quoteIndex,
      windowId,
      "QUOTE_RANGE_INVALID",
      `range ${quote.startInWindow}..${quote.endInWindow} is outside the window text (length ${window.text.length})`,
    );
  }
  if (quote.endInWindow <= quote.startInWindow) {
    refuse(
      quoteIndex,
      windowId,
      "QUOTE_RANGE_INVALID",
      `range must be non-empty: start < end (got ${quote.startInWindow}..${quote.endInWindow})`,
    );
  }
  if (typeof quote.text !== "string") {
    refuse(quoteIndex, windowId, "QUOTE_MISMATCH", "quote text must be a string");
  }

  // V3 — the quote is the window text AT THAT POSITION, character for character.
  const slice = window.text.slice(quote.startInWindow, quote.endInWindow);
  if (slice !== quote.text) {
    refuse(quoteIndex, windowId, "QUOTE_MISMATCH", "the quoted text is not the window text at that position");
  }

  // V4 — the resolved span must still be quotable in one piece.
  const startGlobal = window.start + quote.startInWindow;
  const endGlobal = window.start + quote.endInWindow;
  if (endGlobal - startGlobal > input.maxQuoteChars) {
    refuse(
      quoteIndex,
      windowId,
      "QUOTE_TOO_LONG",
      `span ${endGlobal - startGlobal} exceeds maxQuoteChars ${input.maxQuoteChars}`,
    );
  }

  return {
    windowId: window.windowId,
    startGlobal,
    endGlobal,
    fragmentLocator: { kind: "char_range", start: startGlobal, end: endGlobal },
    quoteHash: sha256Hex(quote.text),
    quoteText: quote.text,
  };
}

/**
 * Validate every quote of ONE batch result, in order, FAILING FAST on the first refusal.
 *
 * The contract is all-or-nothing per run (§M6.3): callers must not treat a partial result as
 * usable, so this throws instead of returning partial successes. Writing the resolved quotes is
 * NOT this function's job (Slice F).
 */
export function resolveQuotes(
  quotes: readonly ModelQuote[],
  input: ResolveQuotesInput,
): ResolvedQuote[] {
  return quotes.map((quote, i) => resolveQuote(quote, input, i));
}
