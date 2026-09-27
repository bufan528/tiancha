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
  verifyFragmentRef,
  type FragmentEvidence,
  type FragmentEvidenceStance,
  type FragmentLocator,
  type MaterialFragment,
  type MaterialVersion,
} from "../domain/material-source.js";
import type { ResearchRepository } from "../storage/research-repository.js";

export type MaterialSubjectKind = "industry" | "company" | "general";

export interface RegisterVersionInput {
  materialId: string;
  subjectKind: MaterialSubjectKind;
  subjectId: string;
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
    const version = buildMaterialVersion({
      materialId: input.materialId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      rawText: input.rawText,
      createdAt: input.createdAt ?? nowIso(),
    });
    const existing = this.repo.findMaterialVersionByRawHash(
      input.materialId,
      version.rawHash,
      version.normalizationVersion,
    );
    if (existing !== undefined) return { version: existing, created: false };
    this.repo.upsertMaterialVersion(version);
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
  verifyVersion(version: MaterialVersion): { fragmentId: string; locator: FragmentLocator; ok: boolean }[] {
    return this.listFragments(version.materialVersionId).map((f) => ({
      fragmentId: f.fragmentId,
      locator: f.locator,
      ok: verifyFragmentRef(version, f),
    }));
  }

  /** Convenience for tests/CLI: register + fragment in one call (still idempotent). */
  registerWithFragments(input: RegisterVersionInput & { locators: FragmentLocator[] }): {
    version: MaterialVersion;
    created: boolean;
    fragments: MaterialFragment[];
  } {
    const { version, created } = this.registerVersion(input);
    const fragments = this.addFragments(version, input.locators, input.createdAt);
    return { version, created, fragments };
  }
}

/** Re-exported so callers can compute the same identity without importing the domain module. */
export { materialVersionIdFor, NORMALIZATION_VERSION, sha256Hex };
export type { FragmentEvidence, FragmentEvidenceStance, FragmentLocator, MaterialFragment, MaterialVersion };
