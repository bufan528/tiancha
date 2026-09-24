/**
 * E2 (S2): deterministic identity keys for the research skeleton.
 *
 * HARD RULE — these keys must NOT contain:
 *   - timestamps
 *   - random UUIDs
 *   - LLM output order
 *   - any non-stable array order
 * Otherwise a later migration (S3) would re-derive a SECOND identity for the
 * same logical object, and idempotency would silently break.
 *
 * Key shape follows 07 §8 (subject + dimension):
 *   question    : q-<subjectId>-<dimensionKey>
 *   requirement : ir-<subjectId>-<dimensionKey>
 *   pool entry  : pe-<subjectId>-<dimensionKey>
 *
 * NOTE (S2 scope): the pool key keeps the EXISTING `pe-` prefix because S2 does
 * not restructure the pool (that is S3's Slot+Item redesign). The prefix can be
 * renamed to `slot-` at S3, but the *identity rule* (subject+dimension) is fixed
 * here so S3 has something stable to depend on.
 */

export function questionKey(subjectId: string, dimension: string): string {
  return `q-${subjectId}-${dimension}`;
}

export function requirementKey(subjectId: string, dimension: string): string {
  return `ir-${subjectId}-${dimension}`;
}

export function poolEntryKey(subjectId: string, dimension: string): string {
  return `pe-${subjectId}-${dimension}`;
}

/**
 * S3: pool SLOT identity — the same logical key as the legacy entry, with the
 * `slot-` prefix. Migration maps `pe-X` -> `slot-X` (same suffix) so the logical
 * research slot is preserved, never re-generated.
 */
export function poolSlotKey(subjectId: string, dimension: string): string {
  return `slot-${subjectId}-${dimension}`;
}
