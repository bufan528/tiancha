import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratePiToTiancha, isMigrated, type MigrationPaths } from "./migration/pi-to-tiancha.js";

function buildPaths(cwd: string): MigrationPaths {
  return {
    oldGlobalAgent: join(cwd, "home", ".pi", "agent"),
    newGlobalAgent: join(cwd, "home", ".tiancha", "agent"),
    oldProjectDir: join(cwd, "proj", ".pi"),
    newProjectDir: join(cwd, "proj", ".tiancha"),
  };
}

test("migration copies .pi -> .tiancha and is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "mig-"));
  const paths = buildPaths(root);
  mkdirSync(paths.oldGlobalAgent, { recursive: true });
  writeFileSync(join(paths.oldGlobalAgent, "auth.json"), "{}");
  mkdirSync(join(paths.oldGlobalAgent, "skills"), { recursive: true });
  writeFileSync(join(paths.oldGlobalAgent, "skills", "s1.md"), "# skill");
  mkdirSync(paths.oldProjectDir, { recursive: true });
  mkdirSync(join(paths.oldProjectDir, "skills"), { recursive: true });
  writeFileSync(join(paths.oldProjectDir, "skills", "ps.md"), "# proj skill");

  const r1 = migratePiToTiancha(join(root, "proj"), paths);
  assert.equal(r1.migrated, true);
  assert.ok(existsSync(join(paths.newGlobalAgent, "auth.json")), "auth.json copied");
  assert.ok(existsSync(join(paths.newGlobalAgent, "skills", "s1.md")), "global skills copied");
  assert.ok(existsSync(join(paths.newProjectDir, "skills", "ps.md")), "project skills copied");
  assert.ok(isMigrated(paths.newGlobalAgent), "global marker written");
  assert.ok(isMigrated(paths.newProjectDir), "project marker written");

  // idempotent second run
  const r2 = migratePiToTiancha(join(root, "proj"), paths);
  assert.equal(r2.migrated, false, "second run is a no-op");
});
