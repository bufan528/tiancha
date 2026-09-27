/**
 * ★ §29.6.1 (5a) / §29.14 — the REVERSE INDEX behind "a Claim is confirmed evidence".
 *
 * A material that is NOT `completed` may already have projected some of its Claims (5a accepts
 * that partial visibility on purpose), but those Claims are NOT "已确认材料证据": any aggregation
 * that claims to summarise confirmed evidence must leave them out.
 *
 * The index is derived, read-only and cheap: `material.claim_refs_json` already records the bare
 * claim ids (contract §15), so no new table, column or index is needed.
 */

import type { ResearchRepository } from "../storage/research-repository.js";

/** `artifact:claim/<id>` is the ONLY prefix a belief's `claimRef` may use (§15 CR-10). */
const CLAIM_REF_PREFIX = "artifact:claim/";

/**
 * Every Claim that belongs to a material of `subjectId` whose `ingestStatus !== "completed"`.
 * Returns the ids in the SAME shape as `belief.claimRef`, so callers can filter directly.
 */
export function unconfirmedClaimRefs(repo: ResearchRepository, subjectId: string): Set<string> {
  const refs = new Set<string>();
  for (const material of repo.listMaterials(subjectId)) {
    // §29.14.1: only a COMPLETED material makes its Claims "confirmed evidence".
    if (material.ingestStatus === "completed") continue;
    for (const claimId of material.claimRefs) refs.add(`${CLAIM_REF_PREFIX}${claimId}`);
  }
  return refs;
}
