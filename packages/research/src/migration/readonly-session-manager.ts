/**
 * ReadOnlySessionManager -wraps a real Pi SessionManager for opening legacy
 * sessions in read-only mode. Write paths are rejected:
 *  - message write / tool result write  -> throw ReadOnlySessionError
 *  - fork / branch                      -> redirect (thrown with the new-dir hint)
 *  - compaction                         -> no-op
 *
 * research never imports coding-agent: the wrapped object is a structural type.
 * The composition root passes the real SessionManager.open(...) instance in.
 */

import type { ReadableSession, SessionEntry } from "../ports/session.port.js";

export class ReadOnlySessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlySessionError";
  }
}

/** Structural shape of a writable SessionManager we guard against. */
export interface WritableSessionHandle {
  getCwd(): string;
  getSessionId(): string;
  getSessionFile(): string | undefined;
  isPersisted(): boolean;
  getEntries(): SessionEntry[];
  getEntry(id: string): SessionEntry | undefined;
  appendMessage(...args: unknown[]): unknown;
  branch(...args: unknown[]): unknown;
  appendCompaction?(...args: unknown[]): unknown;
  appendBranchSummary?(...args: unknown[]): unknown;
}

export class ReadOnlySessionManager implements ReadableSession {
  constructor(private readonly inner: WritableSessionHandle) {}

  getCwd(): string {
    return this.inner.getCwd();
  }

  getSessionId(): string {
    return this.inner.getSessionId();
  }

  getSessionFile(): string | undefined {
    return this.inner.getSessionFile();
  }

  isPersisted(): boolean {
    return this.inner.isPersisted();
  }

  getEntries(): SessionEntry[] {
    return this.inner.getEntries();
  }

  getEntry(id: string): SessionEntry | undefined {
    return this.inner.getEntry(id);
  }

  /** T1/T2: reject message + tool-result writes. */
  appendMessage(..._args: unknown[]): never {
    throw new ReadOnlySessionError(
      `read-only session ${this.getSessionFile() ?? this.getSessionId()}: appendMessage rejected (T1)`,
    );
  }

  /** T3: fork/branch is redirected, never written back to the legacy path. */
  branch(): never {
    throw new ReadOnlySessionError(
      `read-only session: branch/fork redirected to a new Tiancha session (T3); legacy path left untouched`,
    );
  }

  /** T4: compaction is a no-op (no write-back to the legacy file). */
  appendCompaction(): undefined {
    return undefined;
  }

  appendBranchSummary(): undefined {
    return undefined;
  }
}
