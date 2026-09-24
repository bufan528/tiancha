/**
 * DATA-R1 — legacy `mw-v1` repair migration.
 *
 * A database bootstrapped before S1 holds a frozen-v1 row WITHOUT weight/criticality.
 * The repair restores the already-approved baseline's own values under its own
 * versionId/versionTag/activatedAt — it must never act as a methodology change:
 * no new version, no re-activation, no candidate, no human gate.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchDb } from "./storage/research-db.js";
import { METHODOLOGY_V1 } from "./methodology/methodology-v1.js";

/** The pre-S1 shape: same 12 keys, no weight / criticality. */
function legacyDimensions() {
  return METHODOLOGY_V1.dimensions.map((d) => ({
    key: d.key,
    name: d.name,
    description: d.description,
    whyNeeded: d.whyNeeded,
    requiredInfo: d.requiredInfo,
    confirmedCondition: d.confirmedCondition,
    uncertainCondition: d.uncertainCondition,
    unknownCondition: d.unknownCondition,
  }));
}

interface SeedRow {
  id?: string;
  tag?: string;
  activated?: string | null;
  dims?: unknown;
}

function withTempDb(fn: (path: string) => void, seed: SeedRow): void {
  const dir = mkdtempSync(join(tmpdir(), "tiancha-datar1-"));
  const path = join(dir, "tiancha.sqlite");
  try {
    const db = new ResearchDb({ path });
    db.db.exec("DELETE FROM methodology");
    db.db
      .prepare(
        `INSERT OR REPLACE INTO methodology
         (methodology_id, version_tag, is_human_approved_baseline, created_at, activated_at, dimensions_json)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        seed.id ?? "mw-v1",
        seed.tag ?? "v1",
        1,
        "2026-09-22T00:00:00.000Z",
        seed.activated === undefined ? "2026-09-22T00:00:00.000Z" : seed.activated,
        JSON.stringify(seed.dims ?? legacyDimensions()),
      );
    db.close();
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const row = (db: ResearchDb, id = "mw-v1") =>
  db.db.prepare("SELECT * FROM methodology WHERE methodology_id = ?").get(id) as any;
const count = (db: ResearchDb, table: string) =>
  (db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n;

describe("DATA-R1 legacy mw-v1 repair", () => {
  test("a legacy mw-v1 is completed on reopen; identity + activatedAt unchanged; idempotent", () => {
    withTempDb((path) => {
      const db = new ResearchDb({ path });
      const r = row(db);
      const dims = JSON.parse(r.dimensions_json);

      assert.equal(dims.length, 12, "still 12 dimensions");
      assert.ok(
        dims.every((d: any) => typeof d.weight === "number" && d.weight > 0 && d.weight <= 1),
        "every dimension now carries a weight",
      );
      assert.ok(
        dims.every((d: any) => d.criticality === "normal" || d.criticality === "critical"),
        "every dimension now carries a criticality",
      );
      // the repaired values come from the FROZEN baseline, item for item
      for (const frozen of METHODOLOGY_V1.dimensions) {
        const stored = dims.find((d: any) => d.key === frozen.key);
        assert.equal(stored.weight, frozen.weight, `${frozen.key}.weight`);
        assert.equal(stored.criticality, frozen.criticality, `${frozen.key}.criticality`);
      }

      // identity / activation untouched
      assert.equal(r.methodology_id, "mw-v1");
      assert.equal(r.version_tag, "v1");
      assert.equal(r.activated_at, "2026-09-22T00:00:00.000Z");
      assert.equal(r.is_human_approved_baseline, 1);

      // and NOTHING else was created
      assert.equal(count(db, "methodology"), 1, "no new version");
      assert.equal(count(db, "methodology_candidate"), 0, "no candidate");
      assert.equal(count(db, "human_gate"), 0, "no gate");

      const after = r.dimensions_json;
      db.close();

      // idempotent: reopening changes nothing further
      const again = new ResearchDb({ path });
      assert.equal(row(again).dimensions_json, after, "repair is idempotent");
      again.close();
    }, {});
  });

  test("an ALREADY-complete mw-v1 is left untouched", () => {
    withTempDb((path) => {
      const db = new ResearchDb({ path });
      const before = row(db).dimensions_json;
      db.close();
      const again = new ResearchDb({ path });
      assert.equal(row(again).dimensions_json, before, "complete rows are never rewritten");
      again.close();
    }, { dims: METHODOLOGY_V1.dimensions });
  });

  test("rows that are NOT clearly legacy are never repaired", () => {
    const cases: Array<[string, SeedRow]> = [
      ["activated_at IS NULL", { activated: null }],
      ["version_tag != v1", { tag: "v9" }],
      [
        "key drift",
        {
          dims: legacyDimensions().map((d, i) => (i === 0 ? { ...d, key: "not_a_real_dimension" } : d)),
        },
      ],
      ["wrong count", { dims: legacyDimensions().slice(0, 11) }],
    ];

    for (const [label, seed] of cases) {
      withTempDb((path) => {
        const before = (() => {
          const db = new ResearchDb({ path });
          const snapshot = JSON.stringify(
            db.db.prepare("SELECT * FROM methodology").all(),
          );
          db.close();
          return snapshot;
        })();
        const db = new ResearchDb({ path });
        const after = JSON.stringify(db.db.prepare("SELECT * FROM methodology").all());
        assert.equal(after, before, `${label}: must be left untouched`);
        db.close();
      }, seed);
    }
  });

  test("a fresh database with no methodology row is unaffected", () => {
    const dir = mkdtempSync(join(tmpdir(), "tiancha-datar1-"));
    const path = join(dir, "tiancha.sqlite");
    try {
      const db = new ResearchDb({ path });
      assert.equal(count(db, "methodology"), 0);
      db.close();
      const again = new ResearchDb({ path });
      assert.equal(count(again, "methodology"), 0, "repair does not invent a version");
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
