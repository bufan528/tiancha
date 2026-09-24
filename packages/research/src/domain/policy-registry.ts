/**
 * Immutable policy registry (S4.5).
 *
 * Provenance is only real if a version id can never silently change meaning:
 * if `agg-v1` means one matrix today and a different one tomorrow, then every
 * historical InvestmentEvaluation that recorded `agg-v1` is lying.
 *
 * `register()` therefore refuses to overwrite an existing version with different
 * content. Changing a rule REQUIRES a new versionId (v1 -> v2); the old version
 * stays resolvable forever.
 */

export interface VersionedPolicy {
  versionId: string;
}

export class PolicyRegistry<T extends VersionedPolicy> {
  private readonly byVersion = new Map<string, T>();

  constructor(private readonly kind: string) {}

  /**
   * Register a policy version. Re-registering the SAME versionId with identical
   * content is a no-op (idempotent re-import); with different content it throws.
   */
  register(policy: T): void {
    const existing = this.byVersion.get(policy.versionId);
    if (existing && stableStringify(existing) !== stableStringify(policy)) {
      throw new Error(
        `${this.kind} policy version '${policy.versionId}' is immutable: ` +
          "re-registering it with different content is forbidden — create a new versionId instead",
      );
    }
    this.byVersion.set(policy.versionId, policy);
  }

  get(versionId: string): T | undefined {
    return this.byVersion.get(versionId);
  }

  has(versionId: string): boolean {
    return this.byVersion.has(versionId);
  }

  list(): T[] {
    return [...this.byVersion.values()];
  }
}

/**
 * Deterministic stringify with sorted keys. Functions are serialised by source
 * text so that two different scoring/decision rules are NOT considered equal.
 */
function stableStringify(value: unknown): string {
  if (typeof value === "function") return `fn:${String(value)}`;
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
