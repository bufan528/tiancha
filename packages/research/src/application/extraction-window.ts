/**
 * C6 model-extractor · Slice A — the DETERMINISTIC chunker.
 *
 * Contract: `docs/phaseC/c6-model-extractor-contract.md` **rev6** §M4 (D-C6-H).
 *
 * Responsibility, and nothing more:
 *
 *   MaterialVersion ──► normalizeText(version.rawText) ──► ExtractionWindow[]
 *
 * It is a PURE function of (version, rule). No storage, no clock, no randomness, no model.
 * Everything downstream (identity, quoting, persistence, concurrency) belongs to other slices —
 * this file must stay callable from a test without any database.
 *
 * The rules the rest of the contract depends on (§M4.2–§M4.5):
 *
 *  - coordinates are **UTF-16 code units** (`String.prototype.length` / `slice`);
 *  - paragraph separators (`\n{2,}`) belong to the window in FRONT of them, so the windows are
 *    edge-to-edge and their union is exactly `[0, normalized.length)` — no gap anywhere;
 *  - `maxChars` constrains **paragraph text only**; the separator is NOT counted, so the LAST
 *    slice of a long paragraph may span slightly more than `maxChars` (it swallows the trailing
 *    separator). That is deliberate: the alternative is either a gap or an overlap;
 *  - only slices of the SAME long paragraph overlap, by `overlapChars`;
 *  - `overlapChars >= maxQuoteChars` so a quote sitting on a split point still fits inside one
 *    slice (v1 does NOT promise a quote spanning two paragraph-group windows).
 */

import {
  deterministicId,
  normalizeText,
  splitParagraphs,
  type MaterialVersion,
} from "../domain/material-source.js";

/** The window rule this version of the contract pins (§M4.3). */
export const WINDOW_RULE_VERSION = "para-greedy-v1" as const;

/**
 * The complete window rule. All four numbers are part of the extraction identity (§M9 #5):
 * changing any of them changes which windows (and therefore which quotes) exist.
 */
export interface WindowRule {
  /** Rule version; only `WINDOW_RULE_VERSION` exists today. */
  version: string;
  /** Max PARAGRAPH TEXT length per window, in UTF-16 code units. Must be a positive integer. */
  maxChars: number;
  /** Overlap between consecutive slices of the SAME long paragraph. `0 <= overlapChars < maxChars`. */
  overlapChars: number;
  /** The quote length cap the chunker must leave room for: `overlapChars >= maxQuoteChars`. */
  maxQuoteChars: number;
}

/** v1 defaults (§M4.3). `overlapChars` is 600 > `maxQuoteChars` 500 on purpose. */
export const DEFAULT_WINDOW_RULE: WindowRule = {
  version: WINDOW_RULE_VERSION,
  maxChars: 2000,
  overlapChars: 600,
  maxQuoteChars: 500,
};

/** A rule that cannot produce well-formed windows is REFUSED — never silently clamped. */
export class WindowRuleError extends Error {}

export function assertValidWindowRule(rule: WindowRule): void {
  if (typeof rule.version !== "string" || rule.version.trim().length === 0) {
    throw new WindowRuleError("window rule version must not be empty");
  }
  const int = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
  if (!int(rule.maxChars) || rule.maxChars <= 0) {
    throw new WindowRuleError(`maxChars must be a positive integer (got ${String(rule.maxChars)})`);
  }
  if (!int(rule.overlapChars) || rule.overlapChars < 0) {
    throw new WindowRuleError(`overlapChars must be an integer >= 0 (got ${String(rule.overlapChars)})`);
  }
  if (rule.overlapChars >= rule.maxChars) {
    throw new WindowRuleError(
      `overlapChars (${rule.overlapChars}) must be < maxChars (${rule.maxChars}), otherwise the split never advances`,
    );
  }
  if (!int(rule.maxQuoteChars) || rule.maxQuoteChars <= 0) {
    throw new WindowRuleError(`maxQuoteChars must be a positive integer (got ${String(rule.maxQuoteChars)})`);
  }
  if (rule.overlapChars < rule.maxQuoteChars) {
    throw new WindowRuleError(
      `overlapChars (${rule.overlapChars}) must be >= maxQuoteChars (${rule.maxQuoteChars}), ` +
        `otherwise a quote sitting on a split point cannot fit inside one slice`,
    );
  }
}

/** The stable, order-free key form of a rule (used by the extraction identity in a later slice). */
export function windowRuleKey(rule: WindowRule): string {
  return [rule.version, rule.maxChars, rule.overlapChars, rule.maxQuoteChars].join("|");
}

export interface ExtractionWindow {
  /** Deterministic: same version + same rule + same span ⇒ same id. */
  windowId: string;
  /** 0-based, ascending. */
  index: number;
  /** UTF-16 code unit offsets into the normalized text; `start` closed, `end` open. */
  start: number;
  end: number;
  /** Always `normalized.slice(start, end)` — including any trailing separator. */
  text: string;
  /** The paragraph indexes this window covers (a slice covers exactly its own paragraph). */
  paragraphIndexes: number[];
  /** Set when this window is ONE SLICE of a long paragraph ⇒ that paragraph's index. */
  splitOfParagraph?: number;
}

/**
 * Why the window AFTER `lastParagraphIndex` starts where it does: paragraph separators
 * (`\n{2,}`) are not part of any paragraph span (`material-source.ts:84-97`), so a window must
 * extend to the NEXT paragraph's `start` to swallow them. The final window runs to the end of
 * the normalized text.
 */
function separatorInclusiveEnd(
  paragraphs: { start: number }[],
  lastParagraphIndex: number,
  normalizedLength: number,
): number {
  const next = paragraphs[lastParagraphIndex + 1];
  return next === undefined ? normalizedLength : next.start;
}

function makeWindow(
  version: MaterialVersion,
  rule: WindowRule,
  index: number,
  start: number,
  end: number,
  paragraphIndexes: number[],
  splitOfParagraph: number | undefined,
  normalized: string,
): ExtractionWindow {
  return {
    windowId: deterministicId(
      "win",
      `${version.materialVersionId}|${rule.version}|${rule.maxChars}|${rule.overlapChars}|${start}|${end}`,
    ),
    index,
    start,
    end,
    text: normalized.slice(start, end),
    paragraphIndexes,
    ...(splitOfParagraph === undefined ? {} : { splitOfParagraph }),
  };
}

/**
 * Split a material version into deterministic, recomputable windows.
 *
 * Deterministic: the result depends only on `normalizeText(version.rawText)` and `rule`.
 * Recomputable: any process, any number of times ⇒ byte-identical output.
 */
export function extractionWindowFor(
  version: MaterialVersion,
  rule: WindowRule = DEFAULT_WINDOW_RULE,
): ExtractionWindow[] {
  assertValidWindowRule(rule);
  const normalized = normalizeText(version.rawText);
  const paragraphs = splitParagraphs(normalized);
  const windows: ExtractionWindow[] = [];

  let i = 0;
  while (i < paragraphs.length) {
    const paragraph = paragraphs[i]!;

    // ---- A long paragraph: sliced on its own, with overlap, last slice swallowing the separator.
    if (paragraph.text.length > rule.maxChars) {
      const step = rule.maxChars - rule.overlapChars;
      const bodyEnd = paragraph.end; // paragraph text end (separators excluded)
      let start = paragraph.start;
      for (;;) {
        const isLast = start + rule.maxChars >= bodyEnd;
        const end = isLast
          ? separatorInclusiveEnd(paragraphs, i, normalized.length)
          : start + rule.maxChars;
        windows.push(makeWindow(version, rule, windows.length, start, end, [paragraph.index], paragraph.index, normalized));
        if (isLast) break;
        start += step;
      }
      i += 1;
      continue;
    }

    // ---- Otherwise: greedily merge FOLLOWING paragraphs while the (text-only) budget allows.
    let last = i;
    let textChars = paragraph.text.length;
    while (last + 1 < paragraphs.length) {
      const next = paragraphs[last + 1]!;
      if (next.text.length > rule.maxChars) break; // it will be sliced on its own
      if (textChars + next.text.length > rule.maxChars) break;
      textChars += next.text.length;
      last += 1;
    }
    const paragraphIndexes: number[] = [];
    for (let k = i; k <= last; k += 1) paragraphIndexes.push(paragraphs[k]!.index);
    windows.push(
      makeWindow(
        version,
        rule,
        windows.length,
        paragraph.start,
        separatorInclusiveEnd(paragraphs, last, normalized.length),
        paragraphIndexes,
        undefined,
        normalized,
      ),
    );
    i = last + 1;
  }

  return windows;
}
