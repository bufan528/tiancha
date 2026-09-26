/**
 * Target-kind vocabulary (C5-A) — a STATIC, VERSIONED value object.
 *
 * Contract: `docs/phaseC/c5-implementation-contract.md` §5.2 / §11 / §7.2.
 *
 * ★ Why static and not resolved per-industry through `ChainProjectionService`:
 *   a `Company` is a **candidate-enterprise fact** (§5.1 SoT), and its `targetKinds` must
 *   never become unreadable merely because a chain template changed later. C5-A therefore
 *   derives the vocabulary ONCE from the frozen `CHAIN_TEMPLATE_GENERAL_V1` and versions it.
 *
 * ★ The version string is part of the recommendation identity
 *   (`revisionInput.kindVocabularyVersion`, §7.2) — bump it in the same change that edits the
 *   vocabulary, or existing proposalIds would silently keep their old meaning.
 *
 * ★ Explicitly NOT `Company.chainPosition`: that column has no vocabulary and no writer
 *   (§5.2), and it must never be silently treated as a kind.
 */

import { CHAIN_TEMPLATE_GENERAL_V1 } from "./chain-template.js";

export const KIND_VOCABULARY_VERSION = "kind-vocab-v1";

/**
 * Deterministic order: template position order first, then declaration order within each
 * position; duplicates (`头部客户`/`标杆客户` may repeat across positions) are collapsed.
 */
export const TARGET_KIND_VOCABULARY: readonly string[] = Object.freeze([
  ...new Set(CHAIN_TEMPLATE_GENERAL_V1.positions.flatMap((p) => p.suggestedTargetKinds)),
]);

export function isKnownTargetKind(kind: string): boolean {
  return TARGET_KIND_VOCABULARY.includes(kind);
}
