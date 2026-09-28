/**
 * C6 model-extractor · Slice B acceptance — the adapter seam and PURE quote validation.
 *
 * Contract rev6 §M3.4 / §M5.1–§M5.3. Authorized numbering: `T-C6-31(unit)` / `T-C6-32(unit)` —
 * the unit-level half of those cases. The official `T-C6-31` / `T-C6-32` stay reserved for the
 * end-to-end behaviour that includes persistence and the all-or-nothing transaction (Slice F).
 *
 * ★ `DeterministicFakeAdapter` lives HERE, in the test file, and must never become a production
 * export, be wired into the CLI, or be described as "a model is integrated". It only proves the
 * seam can be injected, that `extractBatch` can return a well-formed `ModelBatchResult`, and that
 * its candidates can be fed to `resolveQuotes` (legal quotes accepted, illegal ones refused).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  QuoteValidationError,
  resolveQuote,
  resolveQuotes,
  type ModelBatchInput,
  type ModelBatchResult,
  type ModelCandidateDraft,
  type ModelExtractionAdapter,
  type ResolvedQuote,
} from "./application/model-extraction.js";
import { DEFAULT_WINDOW_RULE, extractionWindowFor, type ExtractionWindow } from "./application/extraction-window.js";
import {
  buildMaterialVersion,
  normalizeText,
  resolveLocator,
  sha256Hex,
  type MaterialVersion,
} from "./domain/material-source.js";

const AT = "2026-09-27T00:00:00.000Z";

const RAW = [
  "第一段：市场规模约 500 亿元。",
  "第二段：头部客户开始小批量采购。",
  "第三段：供给端产能仍待验证。",
  "",
].join("\n\n");

function versionOf(rawText: string): MaterialVersion {
  return buildMaterialVersion({
    materialId: "mat-b",
    subjectKind: "industry",
    subjectId: "ind-b",
    rawText,
    createdAt: AT,
  });
}

// ---------------------------------------------------------------------------
// ★ TEST-ONLY deterministic adapter (never a production export)
// ---------------------------------------------------------------------------

/**
 * A deterministic stand-in for a model. Its plan is a pure function of the window text, so the
 * same input always yields the same candidates — which is the whole point: the seam and the
 * validation are what is under test, NOT model quality.
 */
class DeterministicFakeAdapter implements ModelExtractionAdapter {
  readonly modelVersion = "fake-model-1";
  readonly promptVersion = "fake-prompt-1";
  readonly parserVersion = "fake-parser-1";
  readonly calls: ModelBatchInput[] = [];

  constructor(private readonly plan: (input: ModelBatchInput) => ModelCandidateDraft[]) {}

  /** Quote the first sentence of the window — deterministic, and a real substring by construction. */
  static firstSentencePlan(dimension: string, contentKind: "fact" | "judgment"): (i: ModelBatchInput) => ModelCandidateDraft[] {
    return (input) => {
      const stop = input.window.text.indexOf("。");
      const end = stop === -1 ? Math.min(20, input.window.text.length) : stop + 1;
      if (end <= 0) return [];
      return [
        {
          dimension,
          statement: "确定性候选",
          contentKind,
          confidence: 0.5,
          quotes: [
            {
              windowId: input.window.windowId,
              startInWindow: 0,
              endInWindow: end,
              text: input.window.text.slice(0, end),
            },
          ],
        },
      ];
    };
  }

  async extractBatch(input: ModelBatchInput, _signal: AbortSignal): Promise<ModelBatchResult> {
    this.calls.push(input);
    return { candidates: this.plan(input) };
  }
}

/** A seam consumer that only knows the interface — used to prove injection works. */
async function runThroughSeam(adapter: ModelExtractionAdapter, input: ModelBatchInput): Promise<ModelBatchResult> {
  return adapter.extractBatch(input, new AbortController().signal);
}

// ---------------------------------------------------------------------------
// T-C6-31(unit) — a legal quote resolves to the right place in the version
// ---------------------------------------------------------------------------

describe("T-C6-31(unit) — quote validation and resolution (§M5.3)", () => {
  test("T-C6-31(unit)-a: a legal quote yields correct global offsets, a char_range locator and its hash", () => {
    const version = versionOf(RAW);
    const normalized = normalizeText(version.rawText);
    const windows = extractionWindowFor(version);
    const w = windows[0]!;
    const quoted = "市场规模约 500 亿元。";

    const startInWindow = w.text.indexOf(quoted);
    assert.ok(startInWindow >= 0, "the fixture sentence is inside the window");

    const resolved = resolveQuote(
      { windowId: w.windowId, startInWindow, endInWindow: startInWindow + quoted.length, text: quoted },
      { windows, maxQuoteChars: DEFAULT_WINDOW_RULE.maxQuoteChars },
    );

    assert.equal(resolved.windowId, w.windowId);
    assert.equal(resolved.startGlobal, w.start + startInWindow);
    assert.equal(resolved.endGlobal, w.start + startInWindow + quoted.length);
    assert.deepEqual(resolved.fragmentLocator, {
      kind: "char_range",
      start: resolved.startGlobal,
      end: resolved.endGlobal,
    });
    // ★ the hash is over the QUOTE, so it will equal the fragment's own textHash once written
    assert.equal(resolved.quoteHash, sha256Hex(quoted));
    assert.equal(resolved.quoteText, quoted);

    // ★ END-TO-END resolution: the locator points back into the material text
    assert.equal(resolveLocator(normalized, resolved.fragmentLocator), quoted);
  });

  test("T-C6-31(unit)-b: a quote that spans a paragraph boundary but stays CONTIGUOUS is accepted", () => {
    const version = versionOf(["前半段。", "后半段。", ""].join("\n\n"));
    const normalized = normalizeText(version.rawText);
    const w = extractionWindowFor(version)[0]!;
    const quoted = w.text.slice(0, w.text.indexOf("后半段。") + "后半段。".length);
    assert.ok(quoted.includes("\n\n"), "the fixture really crosses the separator");

    const resolved = resolveQuote(
      { windowId: w.windowId, startInWindow: 0, endInWindow: quoted.length, text: quoted },
      { windows: [w], maxQuoteChars: DEFAULT_WINDOW_RULE.maxQuoteChars },
    );
    assert.equal(resolveLocator(normalized, resolved.fragmentLocator), quoted);
  });

  test("T-C6-31(unit)-c: a span of exactly maxQuoteChars passes; one character more is refused (V4 boundary)", () => {
    const longUnit = "口径待核 ";
    const version = versionOf(longUnit.repeat(120).slice(0, 600)); // single paragraph, < maxChars
    const w = extractionWindowFor(version)[0]!;
    const maxQuoteChars = 50;

    const exact = w.text.slice(0, maxQuoteChars);
    assert.equal(
      resolveQuote({ windowId: w.windowId, startInWindow: 0, endInWindow: maxQuoteChars, text: exact }, {
        windows: [w],
        maxQuoteChars,
      }).quoteText,
      exact,
      "exactly maxQuoteChars is allowed (<=)",
    );

    const tooLong = w.text.slice(0, maxQuoteChars + 1);
    assert.throws(
      () =>
        resolveQuote({ windowId: w.windowId, startInWindow: 0, endInWindow: maxQuoteChars + 1, text: tooLong }, {
          windows: [w],
          maxQuoteChars,
        }),
      (err: unknown) => err instanceof QuoteValidationError && err.reason === "QUOTE_TOO_LONG",
    );
  });

  test("T-C6-31(unit)-d: resolveQuotes keeps the input order and is PURE (frozen inputs, deep-equal on re-run)", () => {
    const version = versionOf(RAW);
    const windows = Object.freeze(extractionWindowFor(version).map((w) => Object.freeze(w))) as readonly ExtractionWindow[];
    const w = windows[0]!;
    const a = "市场规模约 500 亿元。";
    const b = "头部客户开始小批量采购。";
    const qa = { windowId: w.windowId, startInWindow: w.text.indexOf(a), endInWindow: w.text.indexOf(a) + a.length, text: a };
    const qb = { windowId: w.windowId, startInWindow: w.text.indexOf(b), endInWindow: w.text.indexOf(b) + b.length, text: b };
    const quotes = Object.freeze([Object.freeze(qa), Object.freeze(qb)]);
    const input = Object.freeze({ windows, maxQuoteChars: DEFAULT_WINDOW_RULE.maxQuoteChars });

    const first = resolveQuotes(quotes, input);
    const second = resolveQuotes(quotes, input);
    assert.deepEqual(first, second, "same input ⇒ same output (no hidden state)");
    assert.deepEqual(
      first.map((r) => r.quoteText),
      [a, b],
      "order is preserved",
    );
    // frozen inputs were not mutated (a mutation would have thrown on assignment in strict mode)
    assert.equal(w.text, extractionWindowFor(version)[0]!.text);
  });
});

// ---------------------------------------------------------------------------
// T-C6-32(unit) — every invalid quote is REFUSED, with the contract's reason
// ---------------------------------------------------------------------------

describe("T-C6-32(unit) — V1–V4 refuse, never degrade", () => {
  test("T-C6-32(unit)-V1: a windowId from ANOTHER material version is refused", () => {
    const version = versionOf(RAW);
    const windows = extractionWindowFor(version);
    const otherWindows = extractionWindowFor(versionOf(RAW + "\n\n另一版新增段落。"));

    assert.throws(
      () =>
        resolveQuote(
          { windowId: otherWindows[0]!.windowId, startInWindow: 0, endInWindow: 3, text: otherWindows[0]!.text.slice(0, 3) },
          { windows, maxQuoteChars: 500 },
        ),
      (err: unknown) => err instanceof QuoteValidationError && err.reason === "QUOTE_OUT_OF_VERSION",
    );
    // an outright invented windowId is refused the same way
    assert.throws(
      () => resolveQuote({ windowId: "win-does-not-exist", startInWindow: 0, endInWindow: 1, text: "x" }, { windows, maxQuoteChars: 500 }),
      (err: unknown) => err instanceof QuoteValidationError && err.reason === "QUOTE_OUT_OF_VERSION",
    );
  });

  test("T-C6-32(unit)-V2: non-integer, out-of-range and inverted spans are refused", () => {
    const version = versionOf(RAW);
    const w = extractionWindowFor(version)[0]!;
    const text = w.text.slice(0, 3);
    const cases: Array<{ s: number; e: number; why: string }> = [
      { s: 0.5, e: 3, why: "non-integer start" },
      { s: 0, e: 2.5, why: "non-integer end" },
      { s: -1, e: 2, why: "negative start" },
      { s: 0, e: w.text.length + 1, why: "end past the window" },
      { s: 5, e: 5, why: "empty span" },
      { s: 6, e: 4, why: "inverted span" },
    ];
    for (const c of cases) {
      assert.throws(
        () => resolveQuote({ windowId: w.windowId, startInWindow: c.s, endInWindow: c.e, text }, { windows: [w], maxQuoteChars: 500 }),
        (err: unknown) => err instanceof QuoteValidationError && err.reason === "QUOTE_RANGE_INVALID",
        c.why,
      );
    }
  });

  test("T-C6-32(unit)-V3: text that is not the window text AT THAT POSITION is refused", () => {
    const version = versionOf(RAW);
    const w = extractionWindowFor(version)[0]!;
    // ★ the window text is NORMALIZED (nfkc-lf-v1: full-width `：` becomes `:`), so every fixture
    // is DERIVED from `w.text` — re-typing the raw source would compare against different text.
    const firstSentence = w.text.slice(0, w.text.indexOf("。") + 1);
    // trimEnd() FIRST: a window may legitimately END with the material's trailing separator, so
    // `lastIndexOf("\n\n")` on the raw window text would point at that tail, not between paragraphs.
    const body = w.text.trimEnd();
    const thirdParagraph = body.slice(body.lastIndexOf("\n\n") + 2).trim();
    assert.ok(firstSentence.length > 0 && thirdParagraph.length > 0);
    assert.notEqual(firstSentence, thirdParagraph);

    // right words, wrong place
    assert.throws(
      () =>
        resolveQuote(
          { windowId: w.windowId, startInWindow: 0, endInWindow: firstSentence.length, text: thirdParagraph },
          { windows: [w], maxQuoteChars: 500 },
        ),
      (err: unknown) => err instanceof QuoteValidationError && err.reason === "QUOTE_MISMATCH",
    );
    // a fabricated quote is refused even at a plausible length (verbatim comparison, not length)
    assert.throws(
      () => resolveQuote({ windowId: w.windowId, startInWindow: 0, endInWindow: 4, text: "四个字的假引用" }, { windows: [w], maxQuoteChars: 500 }),
      (err: unknown) => err instanceof QuoteValidationError && err.reason === "QUOTE_MISMATCH",
    );
    // ★ SAME LENGTH, DIFFERENT CONTENT — a length-only comparison would let this through
    const actual = w.text.slice(0, 6);
    const equalLengthImpostor = `${actual.slice(0, 5)}☃`;
    assert.equal(equalLengthImpostor.length, actual.length, "the impostor has the same length");
    assert.notEqual(equalLengthImpostor, actual, "...but different content");
    assert.throws(
      () =>
        resolveQuote(
          { windowId: w.windowId, startInWindow: 0, endInWindow: 6, text: equalLengthImpostor },
          { windows: [w], maxQuoteChars: 500 },
        ),
      (err: unknown) => err instanceof QuoteValidationError && err.reason === "QUOTE_MISMATCH",
      "a same-length impostor must be refused: the comparison is verbatim, not a length check",
    );
    // ★ verbatim: one added leading space is NOT tolerated
    const padded = ` ${w.text.slice(0, 3)}`;
    assert.throws(
      () => resolveQuote({ windowId: w.windowId, startInWindow: 0, endInWindow: 3, text: padded }, { windows: [w], maxQuoteChars: 500 }),
      (err: unknown) => err instanceof QuoteValidationError && err.reason === "QUOTE_MISMATCH",
    );
  });

  test("T-C6-32(unit)-fail-fast: the FIRST bad quote aborts the whole batch (no partial result)", () => {
    const version = versionOf(RAW);
    const w = extractionWindowFor(version)[0]!;
    const good = w.text.slice(0, w.text.indexOf("。") + 1);
    assert.ok(good.length > 0);
    const quotes = [
      { windowId: w.windowId, startInWindow: 0, endInWindow: good.length, text: good },
      { windowId: "win-invented", startInWindow: 0, endInWindow: 1, text: "x" },
    ];
    assert.throws(
      () => resolveQuotes(quotes, { windows: [w], maxQuoteChars: 500 }),
      (err: unknown) => err instanceof QuoteValidationError && err.reason === "QUOTE_OUT_OF_VERSION" && err.quoteIndex === 1,
    );
  });
});

// ---------------------------------------------------------------------------
// The seam itself — injectable, returns data, and its candidates feed the validator
// ---------------------------------------------------------------------------

describe("ModelExtractionAdapter seam (§M3.4)", () => {
  test("the seam is injectable and its result flows into resolveQuotes (accepted cleanly)", async () => {
    const version = versionOf(RAW);
    const windows = extractionWindowFor(version);
    const adapter = new DeterministicFakeAdapter(DeterministicFakeAdapter.firstSentencePlan("market", "fact"));
    const w = windows[0]!;

    const result = await runThroughSeam(adapter, {
      materialVersionId: version.materialVersionId,
      window: { windowId: w.windowId, index: w.index, text: w.text },
      windowStartInVersion: w.start,
      dimensionHints: ["market", "demand", "supply"],
      methodologyVersionId: "mw-fake-1",
    });

    assert.equal(adapter.calls.length, 1, "the adapter was called exactly once");
    assert.equal(result.candidates.length, 1);

    const resolved: ResolvedQuote[] = resolveQuotes(result.candidates[0]!.quotes, {
      windows,
      maxQuoteChars: DEFAULT_WINDOW_RULE.maxQuoteChars,
    });
    assert.equal(resolved.length, 1);
    assert.equal(
      resolveLocator(normalizeText(version.rawText), resolved[0]!.fragmentLocator),
      result.candidates[0]!.quotes[0]!.text,
      "a fake adapter's quote resolves to exactly what it claimed",
    );
  });

  test("the seam refuses a fake adapter's fabricated quote (a model cannot invent a source)", async () => {
    const version = versionOf(RAW);
    const windows = extractionWindowFor(version);
    const w = windows[0]!;
    const liar = new DeterministicFakeAdapter((input) => [
      {
        dimension: "market",
        statement: "模型编造的候选",
        contentKind: "fact",
        quotes: [
          { windowId: input.window.windowId, startInWindow: 0, endInWindow: 6, text: "模型自己编的句子" },
        ],
      },
    ]);

    const result = await runThroughSeam(liar, {
      materialVersionId: version.materialVersionId,
      window: { windowId: w.windowId, index: w.index, text: w.text },
      windowStartInVersion: w.start,
      dimensionHints: ["market"],
      methodologyVersionId: "mw-fake-1",
    });
    assert.throws(
      () => resolveQuotes(result.candidates[0]!.quotes, { windows, maxQuoteChars: 500 }),
      (err: unknown) => err instanceof QuoteValidationError && err.reason === "QUOTE_MISMATCH",
    );
  });

  test("the seam's result carries no Tiancha identity (the type has nowhere to put one)", () => {
    const version = versionOf(RAW);
    const windows = extractionWindowFor(version);
    const w = windows[0]!;
    const resolved = resolveQuote(
      { windowId: w.windowId, startInWindow: 0, endInWindow: 4, text: w.text.slice(0, 4) },
      { windows, maxQuoteChars: 500 },
    );
    assert.deepEqual(Object.keys(resolved).sort(), [
      "endGlobal",
      "fragmentLocator",
      "quoteHash",
      "quoteText",
      "startGlobal",
      "windowId",
    ]);
    for (const forbidden of ["fragmentId", "evidenceId", "evidenceRef", "candidateId", "stance", "confirmedClaimRef"]) {
      assert.equal(forbidden in resolved, false, `${forbidden} must not exist on a resolved quote`);
    }
  });
});

// ---------------------------------------------------------------------------
// Type boundary — enforced by the type system, not by a comment (§M5.2)
// ---------------------------------------------------------------------------

describe("type boundary (§M5.2): a model can neither carry nor mint a Tiancha id", () => {
  test("the runtime shape of a candidate/quote carries only text-level fields", () => {
    const draft: ModelCandidateDraft = {
      dimension: "market",
      statement: "s",
      contentKind: "fact",
      quotes: [{ windowId: "win-1", startInWindow: 0, endInWindow: 1, text: "x" }],
    };
    assert.deepEqual(Object.keys(draft).sort(), ["contentKind", "dimension", "quotes", "statement"]);
    assert.deepEqual(Object.keys(draft.quotes[0]!).sort(), ["endInWindow", "startInWindow", "text", "windowId"]);
    for (const forbidden of ["evidenceRef", "fragmentId", "evidenceId", "candidateId", "confirmedClaimRef", "claimRef"]) {
      assert.equal(forbidden in draft, false, `${forbidden} must not exist on a model draft`);
      assert.equal(forbidden in draft.quotes[0]!, false, `${forbidden} must not exist on a model quote`);
    }
  });

  test("the TYPES themselves reject an id, an extra field, and a storage handle (compile-time)", () => {
    const draft: ModelCandidateDraft = {
      dimension: "market",
      statement: "s",
      contentKind: "fact",
      quotes: [{ windowId: "win-1", startInWindow: 0, endInWindow: 1, text: "x" }],
    };
    // @ts-expect-error — a model draft has no `evidenceRef` field, by construction
    draft.evidenceRef = "ev-1";
    // @ts-expect-error — a model quote has no `fragmentId` field, by construction
    draft.quotes[0]!.fragmentId = "frag-1";
    // @ts-expect-error — a model draft cannot carry an approval/review state
    draft.reviewStatus = "confirmed";
    // @ts-expect-error — `contentKind` stays the closed set `fact | judgment`
    const badKind: ModelCandidateDraft = { dimension: "d", statement: "s", contentKind: "candidate", quotes: [] };

    const badInput: ModelBatchInput = {
      materialVersionId: "mver-1",
      window: { windowId: "win-1", index: 0, text: "t" },
      windowStartInVersion: 0,
      dimensionHints: ["market"],
      methodologyVersionId: "mw-1",
      // @ts-expect-error — the adapter is handed text, never a storage handle
      repo: {},
    };
    void badKind;
    void badInput;
  });
});
