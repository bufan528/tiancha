import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHumanGate,
  consumeResumeToken,
  hashResumeToken,
  decideHumanGate,
} from "./runtime/human-gate.js";

const scope = { projectId: "p1", runId: "r1", gateId: "g1" };

test("human-gate: token hashed, single-use, scope+expiry enforced", () => {
  const { gate, resumeToken } = createHumanGate({
    gateId: "g1",
    taskId: "t1",
    type: "before_reserve",
    scope,
    ttlMs: 60_000,
  });
  // plaintext not stored
  assert.equal(gate.resumeTokenHash, hashResumeToken(resumeToken));
  assert.notEqual(gate.resumeTokenHash, resumeToken);

  // consume once ok
  const ok = consumeResumeToken(gate, resumeToken, scope);
  assert.equal(ok.ok, true);

  // replay rejected (single-use)
  const replay = consumeResumeToken(ok.gate!, resumeToken, scope);
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "consumed");

  // wrong scope
  const g2 = createHumanGate({ gateId: "g2", taskId: "t2", type: "before_reserve", scope, ttlMs: 60_000 });
  const badScope = consumeResumeToken(g2.gate, g2.resumeToken, { ...scope, runId: "other" });
  assert.equal(badScope.ok, false);
  assert.equal(badScope.reason, "bad_scope");

  // expired
  const past = new Date(Date.now() - 1000);
  const g3 = createHumanGate({ gateId: "g3", taskId: "t3", type: "before_reserve", scope, ttlMs: -1 });
  void past;
  const expired = consumeResumeToken(g3.gate, g3.resumeToken, scope);
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, "expired");

  // decide
  const decided = decideHumanGate(gate, "approved", "operator-1");
  assert.equal(decided.status, "approved");
});
