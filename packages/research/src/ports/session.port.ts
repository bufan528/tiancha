/**
 * Minimal read-only structural view of a Pi SessionManager. The composition
 * root wraps the real SessionManager.open(...) in this shape. research never
 * imports coding-agent; write paths are guarded by ReadOnlySessionManager.
 */

export interface SessionEntry {
  id: string;
  type: string;
  parentId?: string;
  timestamp?: string;
  [k: string]: unknown;
}

export interface ReadableSession {
  getCwd(): string;
  getSessionId(): string;
  getSessionFile(): string | undefined;
  isPersisted(): boolean;
  getEntries(): SessionEntry[];
  getEntry(id: string): SessionEntry | undefined;
}
