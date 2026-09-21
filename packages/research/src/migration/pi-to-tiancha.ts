/**
 * .pi → .tiancha migration. Copies (never moves) global (~/.pi/agent →
 * ~/.tiancha/agent) and project (<cwd>/.pi → <cwd>/.tiancha) resources.
 * Idempotent via a marker file. research never imports coding-agent here.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  statSync,
} from "node:fs";

const MARKER_NAME = ".tiancha-migrated.json";

export interface MigrationPaths {
  oldGlobalAgent: string;
  newGlobalAgent: string;
  oldProjectDir: string;
  newProjectDir: string;
}

export interface MigrationResult {
  migrated: boolean;
  global: boolean;
  project: boolean;
  markerPath: string;
  copied: string[];
}

export function defaultPaths(cwd: string): MigrationPaths {
  return {
    oldGlobalAgent: join(homedir(), ".pi", "agent"),
    newGlobalAgent: join(homedir(), ".tiancha", "agent"),
    oldProjectDir: join(resolve(cwd), ".pi"),
    newProjectDir: join(resolve(cwd), ".tiancha"),
  };
}

function markerPath(dir: string): string {
  return join(dir, MARKER_NAME);
}

export function isMigrated(dir: string): boolean {
  return existsSync(markerPath(dir));
}

function writeMarker(dir: string): void {
  writeFileSync(
    markerPath(dir),
    JSON.stringify({ migratedAt: new Date().toISOString(), tool: "tiancha" }, null, 2),
  );
}

/** Copy a directory tree recursively if it exists. Returns copied rel paths. */
function copyTree(src: string, dest: string): string[] {
  if (!existsSync(src) || !statSync(src).isDirectory()) return [];
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  return [src];
}

/** Copy a single file if it exists. */
function copyFile(src: string, dest: string): string[] {
  if (!existsSync(src) || !statSync(src).isFile()) return [];
  mkdirSync(dirOf(dest), { recursive: true });
  cpSync(src, dest, { recursive: false });
  return [src];
}

function dirOf(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return parts.join("/");
}

/**
 * Run migration for a given cwd. Idempotent: if both marker files exist, no-op.
 * Global migration is gated by the global marker; project migration runs per cwd.
 */
export function migratePiToTiancha(cwd: string, paths: MigrationPaths = defaultPaths(cwd)): MigrationResult {
  const copied: string[] = [];
  let global = false;
  let project = false;

  // Global scope: ~/.pi/agent → ~/.tiancha/agent (auth/models/settings/skills/extensions/sessions read-only)
  if (!isMigrated(paths.newGlobalAgent) && existsSync(paths.oldGlobalAgent)) {
    mkdirSync(paths.newGlobalAgent, { recursive: true });
    for (const name of ["auth.json", "models.json", "settings.json", "models-store.json"]) {
      copied.push(...copyFile(join(paths.oldGlobalAgent, name), join(paths.newGlobalAgent, name)));
    }
    for (const name of ["skills", "extensions", "sessions"]) {
      copied.push(...copyTree(join(paths.oldGlobalAgent, name), join(paths.newGlobalAgent, name)));
    }
    writeMarker(paths.newGlobalAgent);
    global = true;
  }

  // Project scope: <cwd>/.pi → <cwd>/.tiancha (skills/extensions/context)
  if (!isMigrated(paths.newProjectDir) && existsSync(paths.oldProjectDir)) {
    mkdirSync(paths.newProjectDir, { recursive: true });
    for (const name of ["skills", "extensions"]) {
      copied.push(...copyTree(join(paths.oldProjectDir, name), join(paths.newProjectDir, name)));
    }
    // copy top-level json context files
    if (existsSync(paths.oldProjectDir) && statSync(paths.oldProjectDir).isDirectory()) {
      // keep it conservative: only known resource dirs above
    }
    writeMarker(paths.newProjectDir);
    project = true;
  }

  return {
    migrated: global || project,
    global,
    project,
    markerPath: markerPath(paths.newProjectDir),
    copied,
  };
}

/** Read an existing migration marker (for diagnostics). */
export function readMarker(dir: string): Record<string, unknown> | undefined {
  const p = markerPath(dir);
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
}
