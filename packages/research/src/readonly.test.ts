import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadOnlySessionManager, ReadOnlySessionError, type WritableSessionHandle } from "./migration/readonly-session-manager.js";

function fakeHandle(): WritableSessionHandle {
  return {
    getCwd: () => "/proj",
    getSessionId: () => "sess-1",
    getSessionFile: () => "/proj/.pi/sessions/sess-1.jsonl",
    isPersisted: () => true,
    getEntries: () => [{ id: "e1", type: "message" }],
    getEntry: (id: string) => ({ id, type: "message" }),
    appendMessage: () => "should-not-be-called",
    branch: () => "should-not-be-called",
  };
}

test("readonly: read works, write/fork/compaction guarded", () => {
  const ro = new ReadOnlySessionManager(fakeHandle());
  // read OK
  assert.equal(ro.getEntries().length, 1);

  // T1/T2 message write rejected
  assert.throws(() => ro.appendMessage({} as never), ReadOnlySessionError);

  // T3 fork/branch redirected
  assert.throws(() => ro.branch(), ReadOnlySessionError);

  // T4 compaction no-op
  assert.equal(ro.appendCompaction(), undefined);
});
