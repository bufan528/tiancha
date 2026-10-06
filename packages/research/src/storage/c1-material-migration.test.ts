/**
 * C-1 · material migration correctness — regression guard.
 *
 * 契约依据：`docs/phaseC/c1-migration-remediation-contract.md`（🔒 FROZEN rev1）。
 *
 * 守护的长期不变量（C1-MIG-01…08）：
 *   · fresh DB 与「最新升级后的 legacy DB」在 material 表的 schema projection 上等价；
 *   · `ingest_overlaps_json` 在 CREATE TABLE / upgrade path / 写入路径三处闭合；
 *   · 该列属性精确为 { name, type: TEXT, notnull: 1, dflt_value: '[]' }；
 *   · legacy 既有行在迁移后读到 DEFAULT `'[]'`；
 *   · 迁移后【真实 material 写入】成功（不是"迁移成功"）；
 *   · 迁移幂等（重复执行不失败）。
 *
 * ★ 本文件只守护 material；不得泛化为全库 schema 守卫（C1-MIG-01 scope discipline）。
 * ★ 比较对象是结构化 projection（name/type/notnull/dflt_value，C1-Q-2），
 *   刻意【不】比较 CREATE TABLE 的 ddl 字符串（格式/空白不是本项目标）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ResearchDb } from "./research-db.js";
import { ResearchRepository } from "./research-repository.js";
import type { Material } from "../domain/material.js";

const COLUMN = "ingest_overlaps_json";

/** C1-Q-2：归一化后的列 projection（不比较 ddl 字符串）。 */
interface ColumnProjection {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

function materialColumns(db: DatabaseSync): ColumnProjection[] {
  const rows = db.prepare("PRAGMA table_info(material)").all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    notnull: r.notnull,
    dflt_value: r.dflt_value,
  }));
}

function columnOf(db: DatabaseSync, name: string): ColumnProjection | undefined {
  return materialColumns(db).find((c) => c.name === name);
}

/** 全新库（CREATE TABLE 路径）。 */
function freshDb(): ResearchDb {
  return new ResearchDb({ path: ":memory:" });
}

/** 需要 close/reopen 的场景必须落在真实文件上。 */
function fileDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "c1-material-")), "research.db");
}

function makeMaterial(materialId: string): Material {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    materialId,
    subjectKind: "industry",
    subjectId: "industry-c1",
    kind: "text",
    title: "C-1 fixture",
    contentHash: `hash-${materialId}`,
    rawText: "C-1 迁移回归素材（内容与迁移无关，仅用于真实写入）",
    claimRefs: [],
    receivedAt: now,
    createdAt: now,
    ingestStatus: "received",
    ingestAttempts: 0,
    ingestGeneration: 0,
    ingestBlocks: [],
    ingestOverlaps: [],
  };
}

/** 构造 legacy 形态：建全库 → （可选）写 legacy 行 → 丢掉目标列 → 关闭。 */
function buildLegacyDb(path: string, withLegacyRow: boolean): void {
  const db = new ResearchDb({ path });
  try {
    if (withLegacyRow) {
      new ResearchRepository(db.db).upsertMaterial(makeMaterial("m-legacy"));
    }
    db.db.exec(`ALTER TABLE material DROP COLUMN ${COLUMN}`);
    assert.equal(columnOf(db.db, COLUMN), undefined, "fixture must真的缺列");
  } finally {
    db.close();
  }
}

describe("C-1 · material migration correctness", () => {
  test("fresh DB：ingest_overlaps_json 以基线属性声明", () => {
    const db = freshDb();
    try {
      const col = columnOf(db.db, COLUMN);
      assert.ok(col, "fresh schema 必须声明 ingest_overlaps_json");
      assert.equal(col.type, "TEXT");
      assert.equal(col.notnull, 1);
      assert.equal(col.dflt_value, "'[]'");
    } finally {
      db.close();
    }
  });

  test("legacy DB（缺列）→ migration 补列，属性精确（C1-MIG-02 / C1-MIG-03）", () => {
    const path = fileDbPath();
    buildLegacyDb(path, false);

    const migrated = new ResearchDb({ path }); // 构造即触发 migrate()
    try {
      const col = columnOf(migrated.db, COLUMN);
      assert.ok(col, "migration 必须补上 ingest_overlaps_json");
      assert.equal(col.type, "TEXT");
      assert.equal(col.notnull, 1);
      assert.equal(col.dflt_value, "'[]'");
    } finally {
      migrated.close();
    }
  });

  test("legacy 既有行在迁移后读到 '[]'（C1-Q-3 · 显式断言）", () => {
    const path = fileDbPath();
    buildLegacyDb(path, true);

    const migrated = new ResearchDb({ path });
    try {
      const rows = migrated.db.prepare(`SELECT ${COLUMN} AS v FROM material`).all() as Array<{
        v: unknown;
      }>;
      assert.equal(rows.length, 1, "legacy 行必须存活");
      assert.equal(rows[0].v, "[]", "既有行必须被填为 DEFAULT '[]'");

      // NOT NULL 语义：经 repository 读回时也是合法数组，而不是 null
      const back = new ResearchRepository(migrated.db).getMaterial("m-legacy");
      assert.ok(back, "legacy 行必须可经 repository 读回");
      assert.deepEqual(back.ingestOverlaps, []);
    } finally {
      migrated.close();
    }
  });

  test("迁移后【真实 material 写入】成功（C1-MIG-05）", () => {
    const path = fileDbPath();
    buildLegacyDb(path, false);

    const migrated = new ResearchDb({ path });
    try {
      const repo = new ResearchRepository(migrated.db);
      repo.upsertMaterial(makeMaterial("m-write")); // ★ 真实写入（走 repository 路径）
      const back = repo.getMaterial("m-write");
      assert.ok(back, "写入必须可读回");
      assert.deepEqual(back.ingestOverlaps, []);
    } finally {
      migrated.close();
    }
  });

  test("migration 重复执行幂等（C1-MIG-04）", () => {
    const path = fileDbPath();
    buildLegacyDb(path, false);

    new ResearchDb({ path }).close(); // 第一次迁移
    const second = new ResearchDb({ path }); // 再次迁移（不得因列已存在而失败）
    try {
      const col = columnOf(second.db, COLUMN);
      assert.ok(col, "列必须仍存在");
      assert.equal(col.type, "TEXT");
      assert.equal(col.notnull, 1);
      assert.equal(col.dflt_value, "'[]'");
    } finally {
      second.close();
    }
  });

  test("fresh DB 与 migrated DB 的 material 列 projection 等价（C1-MIG-01）", () => {
    const path = fileDbPath();
    buildLegacyDb(path, false);
    const migrated = new ResearchDb({ path });
    const fresh = freshDb();
    try {
      const byName = (cols: ColumnProjection[]) =>
        [...cols].sort((a, b) => a.name.localeCompare(b.name));

      const freshCols = byName(materialColumns(fresh.db));
      const migratedCols = byName(materialColumns(migrated.db));

      assert.deepEqual(
        migratedCols,
        freshCols,
        "migrated 的 material 列 projection 必须与 fresh 等价（name/type/notnull/dflt_value）",
      );

      // ★ 已知且无害的物理差异：`ADD COLUMN` 会把新列置于末尾，因此 legacy 迁移后的
      //   **物理列序**与 fresh（CREATE TABLE 声明序）不同。C1-MIG-01 的判定对象是
      //   列 projection 【集合】（name/type/notnull/dflt_value），不含物理顺序；
      //   且写入路径（upsertMaterial）与读取路径（rowToMaterial）均按【列名】取值，
      //   不受物理列序影响 —— 故此处显式记录该差异，而不断言列序相等。
      const names = (cols: ColumnProjection[]) => cols.map((c) => c.name).sort();
      assert.deepEqual(names(migratedCols), names(freshCols), "列名集合必须一致");
    } finally {
      fresh.close();
      migrated.close();
    }
  });

  test("fresh DB 真实写入成功（C1-MIG-06 · 未破坏全新库路径）", () => {
    const db = freshDb();
    try {
      const repo = new ResearchRepository(db.db);
      repo.upsertMaterial(makeMaterial("m-fresh"));
      assert.ok(repo.getMaterial("m-fresh"), "fresh 路径写入必须成功");
    } finally {
      db.close();
    }
  });
});
