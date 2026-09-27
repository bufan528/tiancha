/**
 * ★ §29.6.1 (5a) / §29.14 / §29.15 — the REVERSE INDEX behind "a Claim is confirmed evidence".
 *
 * A material that is NOT `completed` may already have projected some of its Claims (5a accepts that
 * partial visibility on purpose), but those Claims are NOT "已确认材料证据": any aggregation that
 * claims to summarise confirmed evidence must leave them out.
 *
 * ★ §29.15 (review finding): the index is built from the material's OWNERSHIP (refs + ledger), not
 * from `claimRefs` alone. `claimRefs` is only written when a block's projection CALLBACK runs, so a
 * crash between "projection succeeded" and "ledger updated" used to make a Claim look confirmed.
 * Every reserved `claimId` belongs to the material from P1 on.
 *
 * ★ §29.15 (review finding): a pre-R1 `legacy_failed`残骸 wrote its Claims with RANDOM ids and no
 * ledger, so they cannot be attributed from the material side. While such a残骸 exists we stay
 * CONSERVATIVE: anything not positively attributable to a `completed` material is not confirmed.
 * (Cost: on such a subject a Claim filled in directly — not via a material — is also withheld from
 * the summary until the残骸 is resolved. That is the safe direction.)
 *
 * Derived, read-only, synchronous: `material` already records both the refs and the ledger, so no
 * new table, column or index is needed.
 */

import type { ResearchRepository } from "../storage/research-repository.js";

const CLAIM_REF_PREFIX = "artifact:claim/";

export interface MaterialEvidenceIndex {
  /** Claim refs owned by a material that is NOT `completed` — never confirmed evidence. */
  unconfirmed: Set<string>;
  /** Claim refs positively attributable to a `completed` material. */
  confirmed: Set<string>;
  /** §29.15: a `legacy_failed`残骸 exists whose Claims cannot be attributed from the material. */
  hasResidual: boolean;
}

/** Build the (confirmed / unconfirmed) index for one subject. */
export function materialEvidenceIndex(
  repo: ResearchRepository,
  subjectId: string,
): MaterialEvidenceIndex {
  const unconfirmed = new Set<string>();
  const confirmed = new Set<string>();
  let hasResidual = false;

  for (const material of repo.listMaterials(subjectId)) {
    if (material.ingestStatus === "completed") {
      for (const claimId of material.claimRefs) confirmed.add(`${CLAIM_REF_PREFIX}${claimId}`);
      continue;
    }
    // ★ §29.15: EVERY claim id this material owns — including ids merely RESERVED in the ledger.
    for (const claimId of material.claimRefs) unconfirmed.add(`${CLAIM_REF_PREFIX}${claimId}`);
    for (const block of material.ingestBlocks) unconfirmed.add(`${CLAIM_REF_PREFIX}${block.claimId}`);
    if (material.ingestStatus === "legacy_failed") hasResidual = true;
  }
  return { unconfirmed, confirmed, hasResidual };
}

/** The ONE predicate every aggregation must use (§29.14 + §29.15). */
export function isUnconfirmedEvidence(index: MaterialEvidenceIndex, claimRef: string): boolean {
  if (index.unconfirmed.has(claimRef)) return true;
  // ★ §29.15: with an unattributable残骸 present, "not provably confirmed" ⇒ not confirmed.
  return index.hasResidual && !index.confirmed.has(claimRef);
}
