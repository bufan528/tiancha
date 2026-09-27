/**
 * C6 slice ① acceptance — the located provenance chain:
 *   material_version → fragment → fragment_evidence   (§C6.3 / §C6.4 / §C6.7)
 *
 *   T-C6-1   every fragment recomputes back to EXACTLY its text in the raw material
 *   T-C6-1b  ONE changed character turns the LOCATION check RED; raw/normalized hashes never mixed
 *   T-C6-1c  normalization is pinned to nfkc-lf-v1 (CRLF → LF, NFKC) and is idempotent
 *   T-C6-1d  v1 rejects page/timestamp AND malformed char ranges (empty / negative / out of range)
 *   T-C6-1e  INTEGRITY and LOCATION are SEPARATE checks (NFKC can hide a change in the raw text)
 *   T-C6-1f  W1 is ATOMIC: version + fragments commit together (a failing fragment leaves NO version)
 *   T-C6-1g  a version can only be registered for an EXISTING material, and takes its subject from it
 *   T-C6-1h  versions are IMMUTABLE: same id + different content ⇒ an error, never an overwrite
 *   §C6.7    deterministic identity ⇒ idempotent version / fragment / evidence writes
 *
 * Assertions are behavioural: recomputation, row counts, ids, thrown errors — never log wording.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { MaterialVersionService } from "./application/material-version-service.js";
import {
  NORMALIZATION_VERSION,
  normalizeText,
  sha256Hex,
  verifyFragmentLocation,
  verifyFragmentRef,
  verifyVersionIntegrity,
  type MaterialFragment,
} from "./domain/material-source.js";

const AT = "2026-09-27T00:00:00.000Z";
const RAW = "第一段：市场规模约 500 亿元。\r\n\r\n第二段：增速预计 40% 以上。\r\n\r\n第三段：风险是良率。\r\n";
// BOTH constants are the NORMALIZED form: nfkc-lf-v1 maps the full-width colon to ASCII ":"
// (fragments are located over the normalized text - see the explicit assertion in T-C6-1).
const P1 = "第二段:增速预计 40% 以上。";
const P2 = "第三段:风险是良率。";

interface Env {
  db: ResearchDb;
  repo: ResearchRepository;
  svc: MaterialVersionService;
}

function setup(): Env {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  return { db, repo, svc: new MaterialVersionService(repo) };
}

/** Seed the C-MVP material a version must hang off (§C6.3). */
function seedMaterial(
  repo: ResearchRepository,
  opts: {
    materialId?: string;
    subjectKind?: "industry" | "company" | "general";
    subjectId?: string;
    rawText?: string;
  } = {},
): string {
  const materialId = opts.materialId ?? "mat-1";
  repo.upsertMaterial({
    materialId,
    subjectKind: opts.subjectKind ?? "industry",
    subjectId: opts.subjectId ?? "ind-1",
    kind: "text",
    title: "report.md",
    filename: "report.md",
    contentHash: sha256Hex(opts.rawText ?? RAW),
    rawText: opts.rawText ?? RAW,
    claimRefs: [],
    receivedAt: AT,
    createdAt: AT,
    ingestStatus: "completed",
    ingestAttempts: 1,
    ingestGeneration: 1,
    ingestBlocks: [],
    ingestOverlaps: [],
  });
  return materialId;
}

function env(withMaterial = true): Env {
  const e = setup();
  if (withMaterial) seedMaterial(e.repo);
  return e;
}

function register(e: Env, rawText: string = RAW) {
  return e.svc.registerVersion({ materialId: "mat-1", rawText, createdAt: AT });
}

function byLocator(fragments: MaterialFragment[], kind: string, index: number): MaterialFragment {
  const hit = fragments.find(
    (f) => f.locator.kind === kind && (f.locator as { index?: number }).index === index,
  );
  assert.ok(hit !== undefined, `expected a ${kind}:${index} fragment`);
  return hit;
}

describe("T-C6-1 — located fragments recompute back to the raw material", () => {
  test("every v1 locator resolves to exactly its text, and the raw text is kept verbatim", () => {
    const e = env();
    const { version, created } = register(e);
    assert.equal(created, true);

    const normalized = normalizeText(RAW);
    const fragments = e.svc.addFragments(
      version,
      [
        { kind: "char_range", start: 0, end: 12 },
        { kind: "paragraph", index: 1 },
        { kind: "paragraph", index: 2 },
      ],
      AT,
    );
    assert.equal(fragments.length, 3);

    // ★ the whole point: EVERY fragment recomputes (machine-checkable, not a stored claim of truth)
    for (const f of fragments) assert.equal(verifyFragmentRef(version, f), true, f.fragmentId);

    const para1 = byLocator(fragments, "paragraph", 1);
    assert.equal(para1.text, P1);
    assert.equal(para1.textHash, sha256Hex(P1));
    assert.equal(byLocator(fragments, "paragraph", 2).text, P2);

    const range = fragments.find((f) => f.locator.kind === "char_range");
    assert.ok(range !== undefined);
    // char_range is measured in UTF-16 code units over the NORMALIZED text
    assert.equal(range.text, normalized.slice(0, 12));

    // ★ NFKC is part of v1 normalization: the full-width colon of the source becomes ASCII ":"
    assert.ok(version.rawText.includes("\uff1a"));
    assert.ok(!para1.text.includes("\uff1a"));

    // raw text is NOT rewritten by normalization (the CRLF from the source file is still there)
    assert.ok(version.rawText.includes("\r\n"));
    assert.equal(version.normalizationVersion, NORMALIZATION_VERSION);
    assert.equal(version.rawTextRef, null);
    assert.equal(version.charLength, normalized.length);
    assert.equal(version.byteLength, Buffer.byteLength(RAW, "utf8"));
  });

  test("ONE changed character turns the LOCATION check RED; raw/normalized hashes are distinct口径", () => {
    const e = env();
    const { version } = register(e);
    const para1 = e.svc.addFragments(version, [{ kind: "paragraph", index: 1 }], AT)[0];
    assert.equal(verifyFragmentLocation(version, para1), true);

    // (a) tamper with the MATERIAL text ⇒ the fragment no longer matches its location
    const tamperedMaterial = { ...version, rawText: version.rawText.replace("40%", "41%") };
    assert.equal(verifyFragmentLocation(tamperedMaterial, para1), false);

    // (b) tamper with the FRAGMENT text only ⇒ the textHash check fails
    const tamperedFragment: MaterialFragment = { ...para1, text: P1.replace("40%", "41%") };
    assert.equal(verifyFragmentLocation(version, tamperedFragment), false);

    // (c) the two hashes measure different things — the fragment check must use the normalized one
    assert.equal(version.rawHash, sha256Hex(RAW));
    assert.equal(version.normalizedHash, sha256Hex(normalizeText(RAW)));
    assert.notEqual(version.rawHash, version.normalizedHash);
  });

  test("normalization is pinned to nfkc-lf-v1 and is idempotent", () => {
    assert.equal(normalizeText("a\r\nb\rc"), "a\nb\nc");
    assert.equal(normalizeText("ＡＢＣ１２３"), "ABC123"); // NFKC
    const once = normalizeText("Ａ\r\nＢ");
    assert.equal(normalizeText(once), once);
  });

  test("v1 rejects page/timestamp and MALFORMED char ranges (empty / negative / out of range)", () => {
    const e = env();
    const { version } = register(e);
    assert.throws(() => e.svc.addFragments(version, [{ kind: "page", page: 1 }], AT), /not enabled in v1/);
    assert.throws(
      () => e.svc.addFragments(version, [{ kind: "timestamp", startMs: 0, endMs: 1000 }], AT),
      /not enabled in v1/,
    );
    const len = normalizeText(RAW).length;
    // ★ an EMPTY span used to pass and "verify" — it must be refused now
    assert.throws(() => e.svc.addFragments(version, [{ kind: "char_range", start: 5, end: 5 }], AT), /non-empty/);
    assert.throws(() => e.svc.addFragments(version, [{ kind: "char_range", start: 9, end: 5 }], AT), /non-empty/);
    assert.throws(() => e.svc.addFragments(version, [{ kind: "char_range", start: -1, end: 5 }], AT), />= 0/);
    assert.throws(
      () => e.svc.addFragments(version, [{ kind: "char_range", start: 0, end: len + 1 }], AT),
      /exceeds/,
    );
    assert.throws(() => e.svc.addFragments(version, [{ kind: "char_range", start: 0.5, end: 5 }], AT), /integers/);
    // nothing may have been written by any of the rejected calls
    assert.equal(e.repo.listFragments(version.materialVersionId).length, 0);
  });

  test("T-C6-1e: INTEGRITY and LOCATION are separate checks (NFKC can hide a raw-text change)", () => {
    const e = env();
    const { version } = register(e);
    const para1 = e.svc.addFragments(version, [{ kind: "paragraph", index: 1 }], AT)[0];

    // swap the ASCII colon for its full-width twin: DIFFERENT raw bytes, but NFKC maps both to ":"
    const sneaky = { ...version, rawText: version.rawText.replace("\uff1a", ":") };
    assert.notEqual(sha256Hex(sneaky.rawText), version.rawHash);

    const integrity = verifyVersionIntegrity(sneaky);
    // ★ the version INTEGRITY check catches it...
    assert.equal(integrity.rawHashOk, false);
    // ...while the LOCATION check alone would NOT have (same normalized text ⇒ same slice)
    assert.equal(verifyFragmentLocation(sneaky, para1), true);

    // and for an untouched version both parts are green
    const clean = verifyVersionIntegrity(version);
    assert.deepEqual(clean, { rawHashOk: true, normalizedHashOk: true, normalizationVersionOk: true });
    assert.equal(
      e.svc.verifyVersion(version).ok,
      true,
      "verifyVersion must combine integrity AND every fragment location",
    );
  });

  test("T-C6-1f: W1 is ATOMIC — a failing fragment leaves NO version row behind", () => {
    const e = env();
    assert.throws(() =>
      e.svc.registerWithFragments({
        materialId: "mat-1",
        rawText: RAW,
        createdAt: AT,
        locators: [{ kind: "paragraph", index: 1 }, { kind: "char_range", start: 0, end: 999999 }],
      }),
    );
    // ★ the version was written inside the same transaction ⇒ it must be gone as well
    assert.equal(e.repo.listMaterialVersions("mat-1").length, 0);
    assert.equal((e.db.db.prepare("SELECT COUNT(*) AS c FROM material_version").get() as { c: number }).c, 0);
    assert.equal((e.db.db.prepare("SELECT COUNT(*) AS c FROM fragment").get() as { c: number }).c, 0);

    // the happy path still commits everything together
    const okRun = e.svc.registerWithFragments({
      materialId: "mat-1",
      rawText: RAW,
      createdAt: AT,
      locators: [{ kind: "paragraph", index: 1 }],
    });
    assert.equal(okRun.created, true);
    assert.equal(e.repo.listMaterialVersions("mat-1").length, 1);
    assert.equal(e.repo.listFragments(okRun.version.materialVersionId).length, 1);
  });

  test("T-C6-1g: a version needs an EXISTING material and takes its subject from it", () => {
    const e = env(false); // ★ no material seeded
    assert.throws(() => register(e), /material not found/);
    assert.equal(e.repo.listMaterialVersions("mat-1").length, 0);

    seedMaterial(e.repo, { materialId: "mat-2", subjectKind: "company", subjectId: "co-9" });
    const { version } = e.svc.registerVersion({ materialId: "mat-2", rawText: RAW, createdAt: AT });
    // the caller can no longer pair an arbitrary subject with a material id
    assert.equal(version.subjectKind, "company");
    assert.equal(version.subjectId, "co-9");
  });

  test("T-C6-1h: versions are IMMUTABLE — the storage entry refuses to overwrite one", () => {
    const e = env();
    const { version } = register(e);

    // same id + same content ⇒ idempotent no-op
    e.repo.insertMaterialVersion(version);
    assert.equal(e.repo.listMaterialVersions("mat-1").length, 1);

    // same id + DIFFERENT immutable content ⇒ a loud error, never a silent overwrite
    const other = "换成别的正文";
    const tampered = { ...version, rawText: other, rawHash: sha256Hex(other), normalizedHash: sha256Hex(normalizeText(other)) };
    assert.throws(() => e.repo.insertMaterialVersion(tampered), /immutable/);
    assert.equal(e.repo.getMaterialVersion(version.materialVersionId)?.rawText, RAW);
  });
});

describe("§C6.7 — deterministic identity makes every write idempotent", () => {
  test("same material + same bytes ⇒ SAME version; changed bytes ⇒ NEW version kept alongside", () => {
    const e = env();
    const a = register(e);
    const b = register(e);
    assert.equal(a.created, true);
    assert.equal(b.created, false, "an identical re-registration must NOT create a version");
    assert.equal(a.version.materialVersionId, b.version.materialVersionId);
    assert.equal(e.repo.listMaterialVersions("mat-1").length, 1);

    // changed content ⇒ a new version; the previous one is still readable (nothing is deleted)
    const c = register(e, `${RAW}第四段：补充口径。\n`);
    assert.equal(c.created, true);
    assert.notEqual(c.version.materialVersionId, a.version.materialVersionId);
    assert.equal(e.repo.listMaterialVersions("mat-1").length, 2);
    assert.equal(e.repo.getMaterialVersion(a.version.materialVersionId)?.rawText, RAW);

    // CRLF vs LF is the same NORMALIZED text but different RAW bytes ⇒ a distinct version.
    // (This is exactly why the two hashes are kept apart: rawHash answers "did the material change?".)
    const d = register(e, RAW.replace(/\r\n/g, "\n"));
    assert.equal(d.created, true);
    assert.equal(d.version.normalizedHash, a.version.normalizedHash);
    assert.notEqual(d.version.rawHash, a.version.rawHash);
  });

  test("same version + same locator ⇒ SAME fragment (re-running never duplicates)", () => {
    const e = env();
    const { version } = register(e);
    const first = e.svc.addFragments(version, [{ kind: "paragraph", index: 1 }], AT);
    const again = e.svc.addFragments(version, [{ kind: "paragraph", index: 1 }], AT);
    assert.deepEqual(
      again.map((f) => f.fragmentId),
      first.map((f) => f.fragmentId),
    );
    assert.equal(e.repo.listFragments(version.materialVersionId).length, 1);

    const mixed = e.svc.addFragments(
      version,
      [{ kind: "paragraph", index: 1 }, { kind: "paragraph", index: 2 }],
      AT,
    );
    assert.equal(mixed.length, 2);
    assert.equal(e.repo.listFragments(version.materialVersionId).length, 2);
  });

  test("evidence quotes the fragment (never free text) and is idempotent per (fragment, stance)", () => {
    const e = env();
    const { version } = register(e);
    const para1 = e.svc.addFragments(version, [{ kind: "paragraph", index: 1 }], AT)[0];

    const e1 = e.svc.addEvidence(version, para1.fragmentId, "supports", "来自报告第二段", AT);
    const e2 = e.svc.addEvidence(version, para1.fragmentId, "supports", "来自报告第二段", AT);
    assert.equal(e1.evidenceId, e2.evidenceId);
    assert.equal(e.repo.listFragmentEvidence(version.materialVersionId).length, 1);

    // the quote IS the fragment text — evidence can never be detached from its原文证据
    assert.equal(e1.quoteText, para1.text);
    assert.equal(e1.quoteHash, para1.textHash);

    const refuting = e.svc.addEvidence(version, para1.fragmentId, "refutes", undefined, AT);
    assert.notEqual(refuting.evidenceId, e1.evidenceId);
    assert.equal(e.repo.listFragmentEvidence(version.materialVersionId).length, 2);
    assert.equal(e.repo.getFragmentEvidence(e1.evidenceId)?.stance, "supports");
    assert.equal(refuting.note, undefined);
  });

  test("evidence cannot be attached across versions", () => {
    const e = env();
    const a = register(e);
    const b = register(e, `${RAW}追加一段。\n`);
    const fragmentOfA = e.svc.addFragments(a.version, [{ kind: "paragraph", index: 1 }], AT)[0];
    assert.throws(
      () => e.svc.addEvidence(b.version, fragmentOfA.fragmentId, "supports", undefined, AT),
      /cross-version|not found/,
    );
  });

  test("the three C6 tables live next to the existing schema (migration is additive)", () => {
    const e = env();
    const names = (
      e.db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of ["material_version", "fragment", "fragment_evidence"]) assert.ok(names.includes(t), t);
    // untouched neighbours (additive migration must not disturb Phase 2A / C-MVP)
    for (const t of ["material", "report_snapshot", "knowledge_belief", "information_pool_item"]) {
      assert.ok(names.includes(t), t);
    }
  });
});
