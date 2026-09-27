/**
 * C6 slice ① acceptance — the located provenance chain:
 *   material_version → fragment → fragment_evidence   (§C6.3 / §C6.4 / §C6.7)
 *
 *   T-C6-1   every fragment recomputes back to EXACTLY its text in the raw material
 *   T-C6-1b  ONE changed character turns verification RED; rawHash / normalizedHash never mixed
 *   T-C6-1c  normalization is pinned to nfkc-lf-v1 (CRLF → LF, NFKC) and is idempotent
 *   T-C6-1d  v1 rejects the not-yet-enabled locator kinds loudly (page / timestamp)
 *
 *   Identity & idempotency (§C6.7) — the property slices ②–⑤ (and T-C6-6 / T-C6-8) build on:
 *     same material + same bytes  ⇒ SAME version (no second row)
 *     changed raw bytes           ⇒ NEW version, the old one still present (never deleted)
 *     same version + same locator ⇒ SAME fragment
 *     same (fragment, stance)     ⇒ SAME evidence; a different stance ⇒ a second row
 *
 * Assertions are behavioural: recomputation results, row counts, ids — never log wording.
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
  verifyFragmentRef,
  type MaterialFragment,
} from "./domain/material-source.js";

const AT = "2026-09-27T00:00:00.000Z";
const RAW = "第一段：市场规模约 500 亿元。\r\n\r\n第二段：增速预计 40% 以上。\r\n\r\n第三段：风险是良率。\r\n";
// BOTH constants are the NORMALIZED form: nfkc-lf-v1 maps the full-width colon to ASCII ":"
// (fragments are located over the normalized text - see the explicit assertion below).
const P1 = "第二段:增速预计 40% 以上。";
const P2 = "第三段:风险是良率。";

function setup(): { repo: ResearchRepository; svc: MaterialVersionService; db: ResearchDb } {
  const db = new ResearchDb({ path: ":memory:" });
  const repo = new ResearchRepository(db.db);
  return { db, repo, svc: new MaterialVersionService(repo) };
}

function register(svc: MaterialVersionService, rawText: string = RAW) {
  return svc.registerVersion({
    materialId: "mat-1",
    subjectKind: "industry",
    subjectId: "ind-1",
    rawText,
    createdAt: AT,
  });
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
    const { svc } = setup();
    const { version, created } = register(svc);
    assert.equal(created, true);

    const normalized = normalizeText(RAW);
    const fragments = svc.addFragments(
      version,
      [{ kind: "char_range", start: 0, end: 12 }, { kind: "paragraph", index: 1 }, { kind: "paragraph", index: 2 }],
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
    assert.ok(version.rawText.includes("："));
    assert.ok(!para1.text.includes("："));

    // raw text is NOT rewritten by normalization (the CRLF from the source file is still there)
    assert.ok(version.rawText.includes("\r\n"));
    assert.equal(version.normalizationVersion, NORMALIZATION_VERSION);
    assert.equal(version.rawTextRef, null);
    assert.equal(version.charLength, normalized.length);
    assert.equal(version.byteLength, Buffer.byteLength(RAW, "utf8"));
  });

  test("ONE changed character turns verification RED; raw/normalized hashes are distinct口径", () => {
    const { svc } = setup();
    const { version } = register(svc);
    const para1 = svc.addFragments(version, [{ kind: "paragraph", index: 1 }], AT)[0];
    assert.equal(verifyFragmentRef(version, para1), true);

    // (a) tamper with the MATERIAL text ⇒ the fragment no longer matches its location
    const tamperedMaterial = { ...version, rawText: version.rawText.replace("40%", "41%") };
    assert.equal(verifyFragmentRef(tamperedMaterial, para1), false);

    // (b) tamper with the FRAGMENT text only ⇒ the textHash check fails
    const tamperedFragment: MaterialFragment = { ...para1, text: P1.replace("40%", "41%") };
    assert.equal(verifyFragmentRef(version, tamperedFragment), false);

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

  test("v1 rejects the not-yet-enabled locator kinds (page / timestamp)", () => {
    const { svc } = setup();
    const { version } = register(svc);
    assert.throws(() => svc.addFragments(version, [{ kind: "page", page: 1 }], AT), /not enabled in v1/);
    assert.throws(
      () => svc.addFragments(version, [{ kind: "timestamp", startMs: 0, endMs: 1000 }], AT),
      /not enabled in v1/,
    );
  });
});

describe("§C6.7 — deterministic identity makes every write idempotent", () => {
  test("same material + same bytes ⇒ SAME version; changed bytes ⇒ NEW version kept alongside", () => {
    const { svc, repo } = setup();
    const a = register(svc);
    const b = register(svc);
    assert.equal(a.created, true);
    assert.equal(b.created, false, "an identical re-registration must NOT create a version");
    assert.equal(a.version.materialVersionId, b.version.materialVersionId);
    assert.equal(repo.listMaterialVersions("mat-1").length, 1);

    // changed content ⇒ a new version; the previous one is still readable (nothing is deleted)
    const c = register(svc, `${RAW}第四段：补充口径。\n`);
    assert.equal(c.created, true);
    assert.notEqual(c.version.materialVersionId, a.version.materialVersionId);
    assert.equal(repo.listMaterialVersions("mat-1").length, 2);
    assert.equal(repo.getMaterialVersion(a.version.materialVersionId)?.rawText, RAW);

    // CRLF vs LF is the same NORMALIZED text but different RAW bytes ⇒ a distinct version.
    // (This is exactly why the two hashes are kept apart: rawHash answers "did the material change?".)
    const d = register(svc, RAW.replace(/\r\n/g, "\n"));
    assert.equal(d.created, true);
    assert.equal(d.version.normalizedHash, a.version.normalizedHash);
    assert.notEqual(d.version.rawHash, a.version.rawHash);
  });

  test("same version + same locator ⇒ SAME fragment (re-running never duplicates)", () => {
    const { svc, repo } = setup();
    const { version } = register(svc);
    const first = svc.addFragments(version, [{ kind: "paragraph", index: 1 }], AT);
    const again = svc.addFragments(version, [{ kind: "paragraph", index: 1 }], AT);
    assert.deepEqual(
      again.map((f) => f.fragmentId),
      first.map((f) => f.fragmentId),
    );
    assert.equal(repo.listFragments(version.materialVersionId).length, 1);

    // adding a second locator together with an existing one is still idempotent per fragment
    const mixed = svc.addFragments(version, [{ kind: "paragraph", index: 1 }, { kind: "paragraph", index: 2 }], AT);
    assert.equal(mixed.length, 2);
    assert.equal(repo.listFragments(version.materialVersionId).length, 2);
  });

  test("evidence quotes the fragment (never free text) and is idempotent per (fragment, stance)", () => {
    const { svc, repo } = setup();
    const { version } = register(svc);
    const para1 = svc.addFragments(version, [{ kind: "paragraph", index: 1 }], AT)[0];

    const e1 = svc.addEvidence(version, para1.fragmentId, "supports", "来自报告第二段", AT);
    const e2 = svc.addEvidence(version, para1.fragmentId, "supports", "来自报告第二段", AT);
    assert.equal(e1.evidenceId, e2.evidenceId);
    assert.equal(repo.listFragmentEvidence(version.materialVersionId).length, 1);

    // the quote IS the fragment text — evidence can never be detached from its原文证据
    assert.equal(e1.quoteText, para1.text);
    assert.equal(e1.quoteHash, para1.textHash);

    const refuting = svc.addEvidence(version, para1.fragmentId, "refutes", undefined, AT);
    assert.notEqual(refuting.evidenceId, e1.evidenceId);
    assert.equal(repo.listFragmentEvidence(version.materialVersionId).length, 2);
    assert.equal(repo.getFragmentEvidence(e1.evidenceId)?.stance, "supports");
    assert.equal(refuting.note, undefined);
  });

  test("evidence cannot be attached across versions", () => {
    const { svc } = setup();
    const a = register(svc);
    const b = register(svc, `${RAW}追加一段。\n`);
    const fragmentOfA = svc.addFragments(a.version, [{ kind: "paragraph", index: 1 }], AT)[0];
    assert.throws(() => svc.addEvidence(b.version, fragmentOfA.fragmentId, "supports", undefined, AT), /cross-version|not found/);
  });

  test("the three C6 tables live next to the existing schema (migration is additive)", () => {
    const { db } = setup();
    const names = (
      db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of ["material_version", "fragment", "fragment_evidence"]) assert.ok(names.includes(t), t);
    // untouched neighbours (additive migration must not disturb Phase 2A / C-MVP)
    for (const t of ["material", "report_snapshot", "knowledge_belief", "information_pool_item"]) {
      assert.ok(names.includes(t), t);
    }
  });
});
