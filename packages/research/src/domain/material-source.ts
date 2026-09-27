/**
 * C6 (§C6.3 / §C6.4) — Material provenance chain: **MaterialVersion → Fragment → Evidence**.
 *
 * Why a NEW type set instead of extending `DocumentFragment` / `Evidence`:
 *  - `DocumentFragment.documentId` is REQUIRED and `Evidence.claimId` is REQUIRED — C6's fragments
 *    hang off a `materialVersionId` and its evidence points at a FRAGMENT (no claim exists yet).
 *  - Adding optional fields to those types would weaken their existing guarantees for zero gain.
 *  ⇒ separate, self-contained types; Phase 2A types are untouched (see contract §C6.16.1 note).
 *
 * Red lines honoured here:
 *  - `rawHash` (raw bytes) and `normalizedHash` (normalized text) are SEPARATE and never mixed
 *    (§C6.3); fragment verification uses the NORMALIZED text + `nfkc-lf-v1`.
 *  - Identities are DETERMINISTIC (§C6.7): same input ⇒ same id ⇒ re-runs reuse rows, never duplicate.
 *  - No LLM, no claim, no projection: this module is pure text/identity plumbing.
 */

import { createHash } from "node:crypto";

/** §C6.3: the ONLY normalization version understood by this contract (v1). */
export const NORMALIZATION_VERSION = "nfkc-lf-v1" as const;

/** sha256 hex of the UTF-8 bytes of `s` (used for every hash below). */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Deterministic id helper: `prefix-<sha256(payload)[0..32]>`. */
export function deterministicId(prefix: string, payload: string): string {
  return `${prefix}-${sha256Hex(payload).slice(0, 32)}`;
}

/**
 * §C6.3 normalization: newline unification FIRST, then Unicode NFKC.
 * The order is fixed, so `normalizeText` is a pure, idempotent function of the raw text.
 * ONLY the normalized text is used for locating, slicing and `textHash`.
 */
export function normalizeText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").normalize("NFKC");
}

/** §C6.3 locator — a discriminated union. v1 ENABLES `char_range` and `paragraph` only. */
export type FragmentLocator =
  | { kind: "char_range"; start: number; end: number }
  | { kind: "paragraph"; index: number }
  // v1 keeps these DEFINED but NOT enabled (contract §C6.15 D-C6-A = (a)).
  | { kind: "page"; page: number; start?: number; end?: number }
  | { kind: "timestamp"; startMs: number; endMs: number };

/** The locator kinds actually supported in v1 (everything else must be rejected loudly). */
export const V1_LOCATOR_KINDS = ["char_range", "paragraph"] as const;

export function isV1Locator(l: FragmentLocator): boolean {
  return l.kind === "char_range" || l.kind === "paragraph";
}

/** Canonical, stable string form of a locator — the identity key of a fragment. */
export function locatorKey(l: FragmentLocator): string {
  switch (l.kind) {
    case "char_range":
      return `char_range:${l.start}:${l.end}`;
    case "paragraph":
      return `paragraph:${l.index}`;
    case "page":
      return `page:${l.page}:${l.start ?? ""}:${l.end ?? ""}`;
    case "timestamp":
      return `timestamp:${l.startMs}:${l.endMs}`;
  }
}

/**
 * A trailing line break ends the LAST line of a paragraph; it is not paragraph content.
 * Stripping it keeps `paragraph` locators equal to what a reader would call the paragraph text,
 * while `resolveLocator` applies exactly the same rule (so verification stays exact).
 */
function trimTrailingNewlines(s: string): string {
  return s.replace(/\n+$/, "");
}

/**
 * Split NORMALIZED text into paragraphs (contract §C6.3 says "按 \\n\\n 切分"; we accept one or
 * more blank lines, which is the same thing for well-formed text and steadier for real files).
 * Always returns at least one entry; indices are 0-based and stable for a given text.
 */
export function splitParagraphs(text: string): { index: number; start: number; end: number; text: string }[] {
  const out: { index: number; start: number; end: number; text: string }[] = [];
  const re = /\n{2,}/g;
  let start = 0;
  let index = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ index, start, end: m.index, text: trimTrailingNewlines(text.slice(start, m.index)) });
    index += 1;
    start = m.index + m[0].length;
  }
  out.push({ index, start, end: text.length, text: trimTrailingNewlines(text.slice(start)) });
  return out;
}

/**
 * Locator validity (slice-1 review). A `char_range` handed straight to `slice()` can silently
 * produce an empty-but-"valid" fragment, so v1 demands integers, non-empty spans and in-range ends.
 */
export function assertValidLocator(l: FragmentLocator, normalizedLength: number): void {
  const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
  switch (l.kind) {
    case "char_range":
      if (!isInt(l.start) || !isInt(l.end)) throw new Error("char_range must use integers");
      if (l.start < 0) throw new Error(`char_range.start must be >= 0 (got ${l.start})`);
      if (l.end <= l.start) throw new Error(`char_range must be non-empty: start < end (got ${l.start}..${l.end})`);
      if (l.end > normalizedLength) {
        throw new Error(`char_range.end ${l.end} exceeds the normalized text length ${normalizedLength}`);
      }
      return;
    case "paragraph":
      if (!isInt(l.index)) throw new Error("paragraph.index must be an integer");
      if (l.index < 0) throw new Error(`paragraph.index must be >= 0 (got ${l.index})`);
      return;
    case "page":
    case "timestamp":
      throw new Error(
        `locator kind "${l.kind}" is not enabled in v1 (contract §C6.15 D-C6-A = (a); ` +
          `enabled: ${V1_LOCATOR_KINDS.join(", ")})`,
      );
  }
}

/** Resolve a locator against NORMALIZED text. `undefined` = not resolvable (v1-disabled kinds included). */
export function resolveLocator(normalizedText: string, l: FragmentLocator): string | undefined {
  switch (l.kind) {
    case "char_range":
      return normalizedText.slice(l.start, l.end);
    case "paragraph":
      return splitParagraphs(normalizedText)[l.index]?.text;
    case "page":
    case "timestamp":
      return undefined;
  }
}

// ---- objects -------------------------------------------------------------

/** §C6.3 `material_version` — immutable version of a C-MVP material. */
export interface MaterialVersion {
  materialVersionId: string;
  /** The C-MVP `material` this version belongs to (parent; the material row is NOT modified). */
  materialId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  /** The raw text as provided. Kept verbatim — normalization never overwrites it. */
  rawText: string;
  /** Reserved for large-file storage (PDF/audio); ALWAYS `null` in v1. */
  rawTextRef: null;
  /** sha256 over the RAW bytes (utf-8 encoding of `rawText`). Never used for fragment checks. */
  rawHash: string;
  /** sha256 over the NORMALIZED text. This is what fragment verification uses. */
  normalizedHash: string;
  normalizationVersion: string;
  byteLength: number;
  /** Length in UTF-16 code units (= `String#length`), the unit used by `char_range`. */
  charLength: number;
  createdAt: string;
}

/** §C6.3 `fragment` — a located span of a material version. */
export interface MaterialFragment {
  fragmentId: string;
  materialVersionId: string;
  locator: FragmentLocator;
  /** The referenced text = normalized text sliced by the locator. */
  text: string;
  textHash: string;
  createdAt: string;
}

/** §C6.4 stance of a fragment evidence (一个片段上的一个立场). */
export type FragmentEvidenceStance = "supports" | "refutes" | "context";

/** §C6.4 `fragment_evidence` — one stance on one fragment. */
export interface FragmentEvidence {
  evidenceId: string;
  materialVersionId: string;
  fragmentId: string;
  stance: FragmentEvidenceStance;
  /** The quoted fragment text (redundant with `fragment.text` on purpose: auditable). */
  quoteText: string;
  quoteHash: string;
  note?: string;
  createdAt: string;
}

// ---- deterministic identities (§C6.7) -----------------------------------

export function materialVersionIdFor(
  materialId: string,
  rawHash: string,
  normalizationVersion: string,
): string {
  return deterministicId("mver", `${materialId}|${rawHash}|${normalizationVersion}`);
}

export function materialFragmentIdFor(materialVersionId: string, l: FragmentLocator): string {
  return deterministicId("frag", `${materialVersionId}|${locatorKey(l)}`);
}

export function fragmentEvidenceIdFor(
  materialVersionId: string,
  fragmentId: string,
  stance: FragmentEvidenceStance,
  quoteHash: string,
): string {
  return deterministicId("ev", `${materialVersionId}|${fragmentId}|${stance}|${quoteHash}`);
}

/** Build a `MaterialVersion` (identity + both hashes). Pure. */
export function buildMaterialVersion(input: {
  materialId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  rawText: string;
  createdAt: string;
}): MaterialVersion {
  const normalized = normalizeText(input.rawText);
  const rawHash = sha256Hex(input.rawText);
  const normalizedHash = sha256Hex(normalized);
  return {
    materialVersionId: materialVersionIdFor(input.materialId, rawHash, NORMALIZATION_VERSION),
    materialId: input.materialId,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    rawText: input.rawText,
    rawTextRef: null,
    rawHash,
    normalizedHash,
    normalizationVersion: NORMALIZATION_VERSION,
    byteLength: Buffer.byteLength(input.rawText, "utf8"),
    charLength: normalized.length,
    createdAt: input.createdAt,
  };
}

/** Build a `MaterialFragment` for `locator` against `version`. Pure. */
export function buildMaterialFragment(
  version: MaterialVersion,
  locator: FragmentLocator,
  createdAt: string,
): MaterialFragment {
  if (!isV1Locator(locator)) {
    throw new Error(
      `locator kind "${locator.kind}" is not enabled in v1 (contract §C6.15 D-C6-A = (a); ` +
        `enabled: ${V1_LOCATOR_KINDS.join(", ")})`,
    );
  }
  const normalized = normalizeText(version.rawText);
  assertValidLocator(locator, normalized.length);
  const text = resolveLocator(normalized, locator);
  if (text === undefined) {
    throw new Error(`locator ${locatorKey(locator)} does not resolve against version ${version.materialVersionId}`);
  }
  return {
    fragmentId: materialFragmentIdFor(version.materialVersionId, locator),
    materialVersionId: version.materialVersionId,
    locator,
    text,
    textHash: sha256Hex(text),
    createdAt,
  };
}

/** Build a `FragmentEvidence`; the quote is taken FROM the fragment (never free-typed). */
export function buildFragmentEvidence(
  version: MaterialVersion,
  fragment: MaterialFragment,
  stance: FragmentEvidenceStance,
  createdAt: string,
  note?: string,
): FragmentEvidence {
  if (fragment.materialVersionId !== version.materialVersionId) {
    throw new Error("fragment does not belong to this material version (§C6.3: no cross-version fragments)");
  }
  const quoteHash = sha256Hex(fragment.text);
  if (quoteHash !== fragment.textHash) {
    throw new Error("fragment text does not match its own textHash — refusing to build evidence");
  }
  return {
    evidenceId: fragmentEvidenceIdFor(version.materialVersionId, fragment.fragmentId, stance, quoteHash),
    materialVersionId: version.materialVersionId,
    fragmentId: fragment.fragmentId,
    stance,
    quoteText: fragment.text,
    quoteHash,
    ...(note === undefined ? {} : { note }),
    createdAt,
  };
}

/**
 * VERSION INTEGRITY - are BOTH hashes consistent with the stored raw text?
 * Kept apart from the location check on purpose (slice-1 review): NFKC maps some distinct raw
 * byte sequences onto the same normalized text, so a location check alone could stay green while
 * the raw material had actually changed. Integrity is its own, separately assertable check.
 */
export interface VersionIntegrity {
  rawHashOk: boolean;
  normalizedHashOk: boolean;
  normalizationVersionOk: boolean;
}

export function verifyVersionIntegrity(version: {
  rawText: string;
  rawHash: string;
  normalizedHash: string;
  normalizationVersion: string;
}): VersionIntegrity {
  return {
    rawHashOk: sha256Hex(version.rawText) === version.rawHash,
    normalizedHashOk: sha256Hex(normalizeText(version.rawText)) === version.normalizedHash,
    normalizationVersionOk: version.normalizationVersion === NORMALIZATION_VERSION,
  };
}

/**
 * LOCATION check ONLY - does `fragment` still point at exactly this text inside the (normalized)
 * raw text? It deliberately does NOT re-check the version hashes; combine it with
 * `verifyVersionIntegrity` when both properties are needed. One changed character makes it false.
 */
export function verifyFragmentLocation(version: { rawText: string }, fragment: MaterialFragment): boolean {
  const normalized = normalizeText(version.rawText);
  let span: string | undefined;
  try {
    assertValidLocator(fragment.locator, normalized.length);
    span = resolveLocator(normalized, fragment.locator);
  } catch {
    return false;
  }
  if (span === undefined) return false;
  return span === fragment.text && sha256Hex(fragment.text) === fragment.textHash;
}

/** Back-compat alias: the historical name of the location check. */
export const verifyFragmentRef = verifyFragmentLocation;
