/**
 * C6 slice ① — MaterialVersion / Fragment / Evidence service (contract §C6.3 / §C6.4 / §C6.7).
 *
 * Scope of this slice (W1–W2 only): material versions, located fragments and fragment evidence.
 *  - NO candidate, NO review, NO extraction run (slice ②), NO projection (slice ④), NO report (§⑤).
 *  - Everything here is idempotent BY DETERMINISTIC IDENTITY (§C6.7): re-running the same input
 *    reuses the same rows instead of appending duplicates — the property T-C6-6/T-C6-8 rely on.
 */

import {
  buildFragmentEvidence,
  buildMaterialFragment,
  buildMaterialVersion,
  materialVersionIdFor,
  NORMALIZATION_VERSION,
  sha256Hex,
  verifyFragmentLocation,
  verifyVersionIntegrity,
  type VersionIntegrity,
  type FragmentEvidence,
  type FragmentEvidenceStance,
  type FragmentLocator,
  type MaterialFragment,
  type MaterialVersion,
} from "../domain/material-source.js";
import type { ResearchRepository } from "../storage/research-repository.js";

export type MaterialSubjectKind = "industry" | "company" | "general";

export interface RegisterVersionInput {
  /** The C-MVP material this version belongs to. It MUST already exist (§C6.3). */
  materialId: string;
  /** The raw text exactly as provided; it is stored verbatim. */
  rawText: string;
  createdAt?: string;
}

export interface RegisterVersionResult {
  version: MaterialVersion;
  /** `false` = an identical version already existed (same material + raw bytes + normalization). */
  created: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class MaterialVersionService {
  constructor(private readonly repo: ResearchRepository) {}

  /**
   * W1 — register an immutable version of a material.
   * Identity = `(materialId, rawHash, normalizationVersion)` ⇒ registering the same bytes twice
   * returns the SAME version (idempotent); changed bytes ⇒ a NEW version (old ones are never deleted).
   */
  registerVersion(input: RegisterVersionInput): RegisterVersionResult {
    // ★ §C6.3: a version is a version STREAM OF an existing C-MVP material. Read the material and
    // TAKE its subject from there — a caller can no longer pair an arbitrary subject with a
    // mistyped materialId (slice-1 review).
    const material = this.repo.getMaterial(input.materialId);
    if (material === undefined) {
      throw new Error(
        `material not found: ${input.materialId} — a material version belongs to an existing ` +
          "C-MVP material (§C6.3)",
      );
    }
    const version = buildMaterialVersion({
      materialId: material.materialId,
      subjectKind: material.subjectKind as MaterialSubjectKind,
      subjectId: material.subjectId,
      rawText: input.rawText,
      createdAt: input.createdAt ?? nowIso(),
    });
    const existing = this.repo.findMaterialVersionByRawHash(
      version.materialId,
      version.rawHash,
      version.normalizationVersion,
    );
    if (existing !== undefined) return { version: existing, created: false };
    this.repo.insertMaterialVersion(version);
    return { version, created: true };
  }

  /**
   * W1 — create located fragments for `locators` (idempotent per fragment identity).
   * Returns ALL fragments of the version, in locator order, so callers can re-run safely.
   */
  addFragments(version: MaterialVersion, locators: FragmentLocator[], createdAt?: string): MaterialFragment[] {
    const at = createdAt ?? nowIso();
    const built = locators.map((l) => buildMaterialFragment(version, l, at));
    this.repo.insertFragments(built);
    return this.repo.listFragments(version.materialVersionId);
  }

  /** W2 — attach one stance on one fragment (idempotent per evidence identity). */
  addEvidence(
    version: MaterialVersion,
    fragmentId: string,
    stance: FragmentEvidenceStance,
    note?: string,
    createdAt?: string,
  ): FragmentEvidence {
    const fragment = this.repo.getFragment(fragmentId);
    if (fragment === undefined) throw new Error(`fragment not found: ${fragmentId}`);
    const evidence = buildFragmentEvidence(version, fragment, stance, createdAt ?? nowIso(), note);
    this.repo.upsertFragmentEvidence(evidence);
    return this.repo.getFragmentEvidence(evidence.evidenceId) ?? evidence;
  }

  /** Evidence for the statements in a version that are supported / refuted / contextualised. */
  addEvidenceForLocator(
    version: MaterialVersion,
    locator: FragmentLocator,
    stance: FragmentEvidenceStance,
    note?: string,
    createdAt?: string,
  ): FragmentEvidence {
    const fragment = buildMaterialFragment(version, locator, createdAt ?? nowIso());
    const stored = this.repo.getFragment(fragment.fragmentId);
    if (stored === undefined) {
      this.repo.insertFragments([fragment]);
    }
    return this.addEvidence(version, fragment.fragmentId, stance, note, createdAt);
  }

  listVersions(materialId: string): MaterialVersion[] {
    return this.repo.listMaterialVersions(materialId);
  }

  getVersion(materialVersionId: string): MaterialVersion | undefined {
    return this.repo.getMaterialVersion(materialVersionId);
  }

  listFragments(materialVersionId: string): MaterialFragment[] {
    return this.repo.listFragments(materialVersionId);
  }

  listEvidence(materialVersionId: string): FragmentEvidence[] {
    return this.repo.listFragmentEvidence(materialVersionId);
  }

  /**
   * §C6.3 machine re-computation over an entire version: every fragment must still point at exactly
   * its text inside the raw text. A single changed character turns the corresponding entry red.
   */
  verifyVersion(version: MaterialVersion): {
    integrity: VersionIntegrity;
    fragments: { fragmentId: string; locator: FragmentLocator; locationOk: boolean }[];
    ok: boolean;
  } {
    const integrity = verifyVersionIntegrity(version);
    const fragments = this.listFragments(version.materialVersionId).map((f) => ({
      fragmentId: f.fragmentId,
      locator: f.locator,
      locationOk: verifyFragmentLocation(version, f),
    }));
    const ok =
      integrity.rawHashOk &&
      integrity.normalizedHashOk &&
      integrity.normalizationVersionOk &&
      fragments.every((f) => f.locationOk);
    return { integrity, fragments, ok };
  }

  /** Convenience for tests/CLI: register + fragment in one call (still idempotent). */
  registerWithFragments(input: RegisterVersionInput & { locators: FragmentLocator[] }): {
    version: MaterialVersion;
    created: boolean;
    fragments: MaterialFragment[];
  } {
    // ★ W1 (§C6.7): the version AND its initial fragments commit in ONE transaction — a crash in
    // between can no longer leave a version row with no fragments (slice-1 review).
    return this.repo.transaction(() => {
      const { version, created } = this.registerVersion(input);
      const fragments = this.addFragments(version, input.locators, input.createdAt);
      return { version, created, fragments };
    });
  }
}

/** Re-exported so callers can compute the same identity without importing the domain module. */
export { materialVersionIdFor, NORMALIZATION_VERSION, sha256Hex };
export type { FragmentEvidence, FragmentEvidenceStance, FragmentLocator, MaterialFragment, MaterialVersion };
