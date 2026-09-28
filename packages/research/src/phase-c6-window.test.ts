/**
 * C6 model-extractor · Slice A acceptance — the deterministic chunker (contract rev6 §M4, T-C6-29).
 *
 * Everything here is PURE: no database, no clock, no model, no filesystem. The chunker's whole job
 * is `MaterialVersion → ExtractionWindow[]`, so the tests build a `MaterialVersion` in memory and
 * assert the invariants I1–I7 from §M4.5, split by window KIND (rev3 corrected the earlier
 * self-contradiction where "edge-to-edge" and "slices overlap" were both asserted for all windows).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WINDOW_RULE,
  WINDOW_RULE_VERSION,
  WindowRuleError,
  assertValidWindowRule,
  extractionWindowFor,
  windowRuleKey,
  type ExtractionWindow,
  type WindowRule,
} from "./application/extraction-window.js";
import { buildMaterialVersion, normalizeText, type MaterialVersion } from "./domain/material-source.js";

const AT = "2026-09-27T00:00:00.000Z";

function versionOf(rawText: string): MaterialVersion {
  return buildMaterialVersion({
    materialId: "mat-1",
    subjectKind: "industry",
    subjectId: "ind-1",
    rawText,
    createdAt: AT,
  });
}

/** A paragraph repeated to make a long one (> maxChars) without writing a huge literal. */
function longParagraph(chars: number, label: string): string {
  const unit = `${label} `;
  const repeat = Math.ceil(chars / unit.length);
  return unit.repeat(repeat).slice(0, chars);
}

/** Is every position of [0, len) covered by at least one window? (interval UNION, gaps disallowed) */
function unionCovers(normalizedLength: number, windows: ExtractionWindow[]): boolean {
  const sorted = [...windows].sort((a, b) => a.start - b.start || a.end - b.end);
  let covered = 0;
  for (const w of sorted) {
    if (w.start > covered) return false; // a gap
    covered = Math.max(covered, w.end);
  }
  return covered === normalizedLength;
}

describe("§M4 / T-C6-29 — deterministic, gap-free, recomputable windows", () => {
  test("T-C6-29a: the SAME input twice produces DEEP-EQUAL windows (recomputable)", () => {
    const v = versionOf(["第一段。", "第二段。", "", "第三段。", ""].join("\n\n"));
    assert.deepEqual(extractionWindowFor(v), extractionWindowFor(v));
    // and a second, independently built version of the same material too
    assert.deepEqual(extractionWindowFor(v), extractionWindowFor(versionOf(v.rawText)));
  });

  test("T-C6-29b: I1–I3 + I7 — text is the slice, indexes ascend from 0, coverage starts at 0 and ends at the text length", () => {
    const v = versionOf(["A 段。", "B 段。", "C 段。", ""].join("\n\n"));
    const normalized = normalizeText(v.rawText);
    const windows = extractionWindowFor(v);

    assert.ok(windows.length >= 1);
    for (const [i, w] of windows.entries()) {
      assert.equal(w.index, i, "I2: index is the position in the array");
      assert.equal(w.text, normalized.slice(w.start, w.end), "I1: text === normalized.slice(start,end)");
      assert.ok(w.start >= 0 && w.end > w.start, "a window is a non-empty span");
      assert.ok(w.end <= normalized.length);
    }
    assert.equal(windows[0]!.start, 0, "I3: the first window starts at 0");
    assert.equal(windows[windows.length - 1]!.end, normalized.length, "I7: the last window ends at the text end");
  });

  test("T-C6-29c: I4 — the interval UNION covers the whole text with NO gap (overlaps allowed)", () => {
    const v = versionOf(
      [
        "第一段：市场规模约 500 亿元。",
        longParagraph(5000, "LONG"),
        "最后一段：供给端产能仍待验证。",
        "",
      ].join("\n\n"),
    );
    const normalized = normalizeText(v.rawText);
    const windows = extractionWindowFor(v);
    assert.equal(unionCovers(normalized.length, windows), true, "no character may be left uncovered");
  });

  test("T-C6-29d: I5 — PARAGRAPH-GROUP windows are edge-to-edge and never overlap", () => {
    const v = versionOf(["甲。", "乙。", "丙。", "丁。", ""].join("\n\n"));
    const windows = extractionWindowFor(v, { ...DEFAULT_WINDOW_RULE, maxChars: 4, overlapChars: 2, maxQuoteChars: 2 });
    // maxChars 4 with one short paragraph per window ⇒ every window is a paragraph group
    for (let i = 0; i + 1 < windows.length; i += 1) {
      assert.equal(windows[i]!.end, windows[i + 1]!.start, `I5: window ${i} ends exactly where ${i + 1} begins`);
    }
    assert.equal(
      windows.every((w) => w.splitOfParagraph === undefined),
      true,
      "no slice was produced for these short paragraphs",
    );
  });

  test("T-C6-29e: I6 — slices of the SAME long paragraph DO overlap, and only they", () => {
    const v = versionOf([longParagraph(5000, "LONG"), "普通结尾段。", ""].join("\n\n"));
    const windows = extractionWindowFor(v, { ...DEFAULT_WINDOW_RULE, maxChars: 1000, overlapChars: 300, maxQuoteChars: 200 });
    const slices = windows.filter((w) => w.splitOfParagraph !== undefined);
    assert.ok(slices.length >= 2, "the long paragraph must be sliced");

    for (const w of slices) assert.equal(w.splitOfParagraph, 0);
    for (let i = 0; i + 1 < slices.length; i += 1) {
      const overlap = slices[i]!.end - slices[i + 1]!.start;
      assert.equal(overlap, 300, `I6: consecutive slices overlap by exactly overlapChars (window ${i})`);
    }
    // the body length of every NON-final slice respects maxChars
    for (const w of slices.slice(0, -1)) assert.equal(w.end - w.start, 1000, "non-final slices are exactly maxChars long");
  });

  test("T-C6-29f: ★ a long paragraph followed by a NORMAL paragraph — no gap, and the last slice swallows the separator", () => {
    const normalTail = "紧随其后的普通段落。";
    const v = versionOf([longParagraph(3000, "LONG"), normalTail, ""].join("\n\n"));
    const normalized = normalizeText(v.rawText);
    const windows = extractionWindowFor(v, { ...DEFAULT_WINDOW_RULE, maxChars: 1000, overlapChars: 600, maxQuoteChars: 500 });

    // ① the union still covers everything (this is what rev3 got wrong)
    assert.equal(unionCovers(normalized.length, windows), true, "the separator must not be orphaned");

    // ② the LAST slice of the long paragraph ends exactly where the next paragraph starts
    const tailStart = normalized.indexOf(normalTail);
    assert.ok(tailStart > 0);
    const lastSlice = windows.filter((w) => w.splitOfParagraph === 0).at(-1);
    assert.ok(lastSlice !== undefined);
    assert.equal(lastSlice.end, tailStart, "the last slice swallows the trailing separator");

    // ③ ...and its text really ends with the separator
    assert.ok(lastSlice.text.endsWith("\n\n"), "the last slice text ends with the paragraph separator");

    // ④ every OTHER window respects the text budget (only the separator-swallowing slice may exceed)
    for (const w of windows) {
      if (w === lastSlice) continue;
      assert.ok(w.text.length <= 1000, `window ${w.index} exceeded maxChars (${w.text.length})`);
    }

    // ⑤ the normal paragraph is a window of its own, starting exactly at its own start
    const tailWindows = windows.filter((w) => w.splitOfParagraph === undefined);
    assert.equal(tailWindows.length, 1);
    assert.equal(tailWindows[0]!.start, tailStart);
  });

  test("T-C6-29g: a text with no separator at all still yields one covering window", () => {
    const v = versionOf("单段文本，没有任何空行分隔符。");
    const normalized = normalizeText(v.rawText);
    const windows = extractionWindowFor(v);
    assert.equal(windows.length, 1);
    assert.equal(windows[0]!.start, 0);
    assert.equal(windows[0]!.end, normalized.length);
    assert.equal(unionCovers(normalized.length, windows), true);
  });

  test("T-C6-29h: an empty material yields exactly one empty window (no crash, no special case)", () => {
    const windows = extractionWindowFor(versionOf(""));
    assert.equal(windows.length, 1);
    assert.equal(windows[0]!.start, 0);
    assert.equal(windows[0]!.end, 0);
    assert.equal(windows[0]!.text, "");
  });

  test("T-C6-29i: the rule really drives the split — different maxChars ⇒ different windows", () => {
    const v = versionOf([longParagraph(4000, "LONG"), ""].join("\n\n"));
    const coarse = extractionWindowFor(v, { ...DEFAULT_WINDOW_RULE, maxChars: 2000, overlapChars: 600, maxQuoteChars: 500 });
    const fine = extractionWindowFor(v, { ...DEFAULT_WINDOW_RULE, maxChars: 1000, overlapChars: 600, maxQuoteChars: 500 });
    assert.ok(fine.length > coarse.length, "a smaller maxChars must produce more windows");
    assert.notDeepEqual(
      fine.map((w) => w.windowId),
      coarse.map((w) => w.windowId),
      "windows carry different identities under a different rule",
    );
  });

  test("T-C6-29j: windowId is deterministic and rule-dependent; windowRuleKey is stable", () => {
    const v = versionOf([longParagraph(3000, "LONG"), ""].join("\n\n"));
    const a = extractionWindowFor(v);
    const b = extractionWindowFor(v);
    assert.deepEqual(
      a.map((w) => w.windowId),
      b.map((w) => w.windowId),
    );
    const otherRule: WindowRule = { ...DEFAULT_WINDOW_RULE, maxChars: 1500 };
    assert.notDeepEqual(
      a.map((w) => w.windowId),
      extractionWindowFor(v, otherRule).map((w) => w.windowId),
      "a different rule ⇒ different window ids",
    );
    assert.equal(windowRuleKey(DEFAULT_WINDOW_RULE), `${WINDOW_RULE_VERSION}|2000|600|500`);
    assert.notEqual(windowRuleKey(otherRule), windowRuleKey(DEFAULT_WINDOW_RULE));
  });

  test("T-C6-29k: an invalid rule is REFUSED, never silently clamped (§M4.3 constraints)", () => {
    const base = DEFAULT_WINDOW_RULE;
    assert.throws(() => assertValidWindowRule({ ...base, maxChars: 0 }), WindowRuleError);
    assert.throws(() => assertValidWindowRule({ ...base, maxChars: -1 }), WindowRuleError);
    assert.throws(() => assertValidWindowRule({ ...base, maxChars: 10.5 }), WindowRuleError);
    assert.throws(() => assertValidWindowRule({ ...base, overlapChars: -1 }), WindowRuleError);
    assert.throws(() => assertValidWindowRule({ ...base, overlapChars: base.maxChars }), WindowRuleError);
    assert.throws(() => assertValidWindowRule({ ...base, maxQuoteChars: 0 }), WindowRuleError);
    // the third constraint: a quote must still fit inside one slice
    assert.throws(
      () => assertValidWindowRule({ ...base, overlapChars: 100, maxQuoteChars: 500 }),
      /must be >= maxQuoteChars/,
    );
    assert.throws(() => assertValidWindowRule({ ...base, version: "  " }), WindowRuleError);
    // ...and the refusal reaches the entry point too
    const v = versionOf("一段。");
    assert.throws(() => extractionWindowFor(v, { ...base, overlapChars: 100, maxQuoteChars: 500 }), WindowRuleError);
    // the shipped defaults are valid
    assert.doesNotThrow(() => assertValidWindowRule(base));
  });
});
