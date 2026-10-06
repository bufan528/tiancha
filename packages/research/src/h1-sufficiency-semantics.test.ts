/**
 * H-1 · Sufficiency Semantics — regression guard.
 *
 * 契约依据：`docs/phaseC/h1-sufficiency-remediation-contract.md`（🔒 FROZEN rev1）。
 *
 * 守护的不变量（H1-INV-1…6）：
 *   · Evaluation 经 `listCurrentBeliefs()` 取 current cognition（非 current 不计入）；
 *   · sufficiency policy 经 `Requirement.sufficiencyPolicyRef → PolicyRegistry` 解析；
 *   · 无 ref / 未知 ref ⇒ deterministic failure（不 fallback）；无 requirement ⇒ 不 sufficient；
 *   · facts / score / evidenceRefs 同源；
 *   · provenance 可追溯，且与 `evaluationPolicyVersionId`（eval-*）相互独立。
 *
 * 用例 A–G 按契约 §5；另含一条 Static Guard（negative architecture test）。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ResearchDb } from "./storage/research-db.js";
import { ResearchRepository } from "./storage/research-repository.js";
import { KnowledgeRepository } from "./storage/knowledge-repository.js";
import { EvaluationService } from "./application/evaluation-service.js";
import { METHODOLOGY_V1 } from "./methodology/methodology-v1.js";
import { poolSlotKey } from "./domain/identity.js";
import { beliefIdFor } from "./domain/knowledge-belief.js";
import { SUFFICIENCY_POLICY_V1, sufficiencyPolicies } from "./domain/sufficiency.js";
import type { KnowledgeBeliefState } from "./domain/knowledge-belief.js";
import type { MethodologyDimension } from "./domain/index.js";

const NOW = "2026-01-01T00:00:00.000Z";
const SID = "ind-h1";

/** 测试专用第二个 sufficiency 版本：比 v1 严格（要求 ≥2 独立来源）。 */
const STRICT_V2 = { ...SUFFICIENCY_POLICY_V1, versionId: "suf-v2-h1", minIndependentSources: 2 };

function dim(key: string): MethodologyDimension {
  return METHODOLOGY_V1.dimensions.find((d) => d.key === key)!;
}

/** 建立 subject 的 knowledge anchor；返回 knowledgeId。 */
function seedKnowledge(repo: ResearchRepository, sid: string): string {
  const knowledge = new KnowledgeRepository(repo.db);
  const knowledgeId = `know-${sid}`;
  knowledge.upsertKnowledge({
    knowledgeId,
    subjectKind: "industry",
    subjectId: sid,
    beliefs: [],
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return knowledgeId;
}

function addBelief(
  repo: ResearchRepository,
  knowledgeId: string,
  claimRef: string,
  dimension: string,
  state: KnowledgeBeliefState,
  sourceRef?: string,
): void {
  new KnowledgeRepository(repo.db).insertBelief({
    beliefId: beliefIdFor(knowledgeId, claimRef),
    knowledgeId,
    claimRef,
    sourceRef,
    dimension,
    confidence: 0.9,
    state,
    historicalRelations: [],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function addSlotAndItem(
  repo: ResearchRepository,
  sid: string,
  dimension: string,
  claimRef: string,
  sourceRef?: string,
): void {
  const slotId = poolSlotKey(sid, dimension);
  repo.upsertPoolSlot({
    slotId,
    subjectKind: "industry",
    subjectId: sid,
    dimension,
    status: "partial",
    coverageJudgement: "t",
    createdAt: NOW,
    updatedAt: NOW,
  });
  repo.upsertPoolItem({
    itemId: `item-${slotId}-${claimRef}`,
    slotId,
    valueText: claimRef,
    claimRef,
    sourceRef,
    relation: "consistent",
    createdAt: NOW,
  });
}

function addRequirement(
  repo: ResearchRepository,
  sid: string,
  dimension: string,
  policyRef: string | undefined,
): void {
  repo.upsertRequirement({
    requirementId: `ir-${sid}-${dimension}`,
    questionId: `q-${sid}-${dimension}`,
    subjectKind: "industry",
    subjectId: sid,
    dimension,
    description: "t",
    importance: 3,
    requiredEvidenceType: "text",
    ...(policyRef === undefined ? {} : { sufficiencyPolicyRef: policyRef }),
    confirmedCondition: "c",
    uncertainCondition: "u",
    unknownCondition: "n",
    preferredPositionKinds: [],
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function evaluateDim(repo: ResearchRepository, svc: EvaluationService, sid: string, knowledgeId: string, dimension: string) {
  return svc.evaluateDimension(
    sid,
    knowledgeId,
    dim(dimension),
    new Map([[dimension, repo.listRequirements(sid).find((r) => r.dimension === dimension)!]]),
  );
}

describe("H-1 · Sufficiency semantics", () => {
  test("Case A: confirmed + revised ⇒ revised 条目不计入", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const svc = new EvaluationService(db.db);
    const knowledgeId = seedKnowledge(repo, SID);
    addSlotAndItem(repo, SID, "market", "artifact:claim/c1", "s1");
    addBelief(repo, knowledgeId, "artifact:claim/c1", "market", "confirmed", "s1");
    addSlotAndItem(repo, SID, "market", "artifact:claim/c2", "s2");
    addBelief(repo, knowledgeId, "artifact:claim/c2", "market", "revised", "s2"); // ★ 非 current
    addRequirement(repo, SID, "market", SUFFICIENCY_POLICY_V1.versionId);

    const ev = evaluateDim(repo, svc, SID, knowledgeId, "market");
    assert.equal(ev.sufficiency.itemCount, 1, "revised 不计入 itemCount");
    assert.deepEqual(ev.evidenceRefs, ["artifact:claim/c1"], "evidenceRefs 不含 revised-away claim");
    db.close();
  });

  test("Case B: confirmed + superseded ⇒ superseded 不计入", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const svc = new EvaluationService(db.db);
    const knowledgeId = seedKnowledge(repo, SID);
    addSlotAndItem(repo, SID, "market", "artifact:claim/c1");
    addBelief(repo, knowledgeId, "artifact:claim/c1", "market", "confirmed");
    addSlotAndItem(repo, SID, "market", "artifact:claim/c2");
    addBelief(repo, knowledgeId, "artifact:claim/c2", "market", "superseded");
    addRequirement(repo, SID, "market", SUFFICIENCY_POLICY_V1.versionId);

    const ev = evaluateDim(repo, svc, SID, knowledgeId, "market");
    assert.equal(ev.sufficiency.itemCount, 1);
    assert.deepEqual(ev.evidenceRefs, ["artifact:claim/c1"]);
    db.close();
  });

  test("Case C: confirmed + conflicting ⇒ conflicting 不计入", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const svc = new EvaluationService(db.db);
    const knowledgeId = seedKnowledge(repo, SID);
    addSlotAndItem(repo, SID, "market", "artifact:claim/c1");
    addBelief(repo, knowledgeId, "artifact:claim/c1", "market", "confirmed");
    addSlotAndItem(repo, SID, "market", "artifact:claim/c2");
    addBelief(repo, knowledgeId, "artifact:claim/c2", "market", "conflicting");
    addRequirement(repo, SID, "market", SUFFICIENCY_POLICY_V1.versionId);

    const ev = evaluateDim(repo, svc, SID, knowledgeId, "market");
    assert.equal(ev.sufficiency.itemCount, 1);
    assert.deepEqual(ev.evidenceRefs, ["artifact:claim/c1"]);
    db.close();
  });

  test("Case D: Requirement 声明 suf-v2 ⇒ Evaluation 必须用 suf-v2（不是 suf-v1）", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const svc = new EvaluationService(db.db);
    const knowledgeId = seedKnowledge(repo, SID);
    // 注册测试用的第二版本（PolicyRegistry 允许同 versionId 幂等注册不同 id）
    sufficiencyPolicies.register(STRICT_V2);
    // 只有 1 个独立来源：v1 判 sufficient，v2（≥2）判 insufficient
    addSlotAndItem(repo, SID, "market", "artifact:claim/c1", "s1");
    addBelief(repo, knowledgeId, "artifact:claim/c1", "market", "confirmed", "s1");
    addRequirement(repo, SID, "market", STRICT_V2.versionId);

    const ev = evaluateDim(repo, svc, SID, knowledgeId, "market");
    assert.equal(ev.sufficiencyPolicyVersionId, STRICT_V2.versionId, "用的是 v2");
    assert.notEqual(ev.sufficiencyPolicyVersionId, SUFFICIENCY_POLICY_V1.versionId);
    assert.equal(ev.status, "insufficient_evidence", "v2 的 ≥2 独立来源未满足");
    db.close();
  });

  test("Case E: 未知 policy ref ⇒ deterministic failure（不 fallback）", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const svc = new EvaluationService(db.db);
    const knowledgeId = seedKnowledge(repo, SID);
    addSlotAndItem(repo, SID, "market", "artifact:claim/c1");
    addBelief(repo, knowledgeId, "artifact:claim/c1", "market", "confirmed");
    addRequirement(repo, SID, "market", "suf-does-not-exist");

    assert.throws(
      () => evaluateDim(repo, svc, SID, knowledgeId, "market"),
      /unknown sufficiency policy version/,
      "未知 ref 必须显式失败，绝不静默 fallback",
    );
    db.close();
  });

  test("Case E2: requirement 无 ref ⇒ deterministic failure（migration 必须 pin 它）", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const svc = new EvaluationService(db.db);
    const knowledgeId = seedKnowledge(repo, SID);
    addSlotAndItem(repo, SID, "market", "artifact:claim/c1");
    addBelief(repo, knowledgeId, "artifact:claim/c1", "market", "confirmed");
    addRequirement(repo, SID, "market", undefined); // ★ 无 sufficiencyPolicyRef

    assert.throws(
      () => evaluateDim(repo, svc, SID, knowledgeId, "market"),
      /has no sufficiencyPolicyRef/,
    );
    db.close();
  });

  test("Case E3: 无 requirement ⇒ 不 sufficient（与 Pool 的 partial 语义对齐）", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const svc = new EvaluationService(db.db);
    const knowledgeId = seedKnowledge(repo, SID);
    addSlotAndItem(repo, SID, "market", "artifact:claim/c1");
    addBelief(repo, knowledgeId, "artifact:claim/c1", "market", "confirmed");
    // 不 seed requirement

    const ev = svc.evaluateDimension(SID, knowledgeId, dim("market"), new Map());
    assert.equal(ev.status, "insufficient_evidence", "无可判据 ⇒ 永不 sufficient");
    assert.equal(ev.sufficiencyPolicyRef, undefined);
    assert.equal(ev.sufficiencyPolicyVersionId, undefined);
    db.close();
  });

  test("Case F: score / sufficiencyFacts / evidenceRefs 同源（同一 resolved current input set）", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const svc = new EvaluationService(db.db);
    const sid = "ind-h1-src";
    const knowledgeId = seedKnowledge(repo, sid);
    // 两条 current + 一条非 current
    addSlotAndItem(repo, sid, "market", "artifact:claim/a", "s1");
    addBelief(repo, knowledgeId, "artifact:claim/a", "market", "confirmed", "s1");
    addSlotAndItem(repo, sid, "market", "artifact:claim/b", "s2");
    addBelief(repo, knowledgeId, "artifact:claim/b", "market", "confirmed", "s2");
    addSlotAndItem(repo, sid, "market", "artifact:claim/c", "s3");
    addBelief(repo, knowledgeId, "artifact:claim/c", "market", "revised", "s3");
    addRequirement(repo, sid, "market", SUFFICIENCY_POLICY_V1.versionId);

    const ev = evaluateDim(repo, svc, sid, knowledgeId, "market");
    // 三者必须都只看到 2 条 current（itemCount = 2，evidenceRefs = 2，score 由同 2 条算出）
    assert.equal(ev.sufficiency.itemCount, 2, "facts 输入 = 2 条 current");
    assert.equal(ev.evidenceRefs.length, 2, "evidenceRefs 与 facts 同源");
    assert.deepEqual([...ev.evidenceRefs].sort(), ["artifact:claim/a", "artifact:claim/b"]);
    // eval-v1 scoring: 40 + 20×independentSources(=2) + 0 = 80
    assert.equal(ev.score, 80, "score 由同一输入集合算出");
    db.close();
  });

  test("Case G: Audit-2026 复现 —— 一次 REVISE 后 80 → 60，且 evidenceRefs 不含被取代的 claim", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const svc = new EvaluationService(db.db);
    const sid = "ind-h1-repro";
    const knowledgeId = seedKnowledge(repo, sid);
    const a = "artifact:claim/399a4301";
    const b = "artifact:claim/b";
    addSlotAndItem(repo, sid, "market", a, "src-1");
    addBelief(repo, knowledgeId, a, "market", "confirmed", "src-1");
    addSlotAndItem(repo, sid, "market", b, "src-2");
    addBelief(repo, knowledgeId, b, "market", "confirmed", "src-2");
    addRequirement(repo, sid, "market", SUFFICIENCY_POLICY_V1.versionId);

    const before = evaluateDim(repo, svc, sid, knowledgeId, "market");
    assert.equal(before.sufficiency.independentSources, 2);
    assert.equal(before.score, 80, "修复前：2 个独立来源 ⇒ 80");

    // 一次 REVISE：a 变为历史态（不再 current）
    const knowledge = new KnowledgeRepository(db.db);
    const beliefA = knowledge.listBeliefs(knowledgeId).find((x) => x.claimRef === a)!;
    knowledge.updateBeliefState(beliefA.beliefId, "revised", NOW);

    const after = evaluateDim(repo, svc, sid, knowledgeId, "market");
    assert.equal(after.sufficiency.independentSources, 1, "revised 后只剩 1 个独立来源");
    assert.equal(after.score, 60, "修复后：40 + 20×1 = 60");
    assert.ok(!after.evidenceRefs.includes(a), "evidenceRefs 不再引用被 revised-away 的 claim");
    assert.deepEqual(after.evidenceRefs, [b]);
    db.close();
  });

  test("H1-INV-5: provenance 与 evaluationPolicyVersionId（eval-*）相互独立", () => {
    const db = new ResearchDb({ path: ":memory:" });
    const repo = new ResearchRepository(db.db);
    const svc = new EvaluationService(db.db);
    const sid = "ind-h1-prov";
    const knowledgeId = seedKnowledge(repo, sid);
    for (const d of METHODOLOGY_V1.dimensions) {
      addSlotAndItem(repo, sid, d.key, `artifact:claim/${d.key}`);
      addBelief(repo, knowledgeId, `artifact:claim/${d.key}`, d.key, "confirmed");
      addRequirement(repo, sid, d.key, SUFFICIENCY_POLICY_V1.versionId);
    }

    const ev = svc.evaluate("industry", sid, knowledgeId);
    const market = ev.dimensionEvaluations.find((d) => d.dimension === "market")!;
    assert.equal(market.sufficiencyPolicyRef, SUFFICIENCY_POLICY_V1.versionId, "记录 requirement 声明的 ref");
    assert.equal(market.sufficiencyPolicyVersionId, SUFFICIENCY_POLICY_V1.versionId, "记录解析出的版本");
    assert.equal(ev.evaluationPolicyVersionId, "eval-v1", "eval-* 仍是评分规则版本");
    assert.notEqual(market.sufficiencyPolicyVersionId, ev.evaluationPolicyVersionId, "两者不得压写");
    db.close();
  });

  test("Static Guard: Evaluation 侧不得硬编码 SUFFICIENCY_POLICY_V1 / 绕过 PolicyRegistry", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "application/evaluation-service.ts"), "utf8");
    // 排除注释行后再检查真实 code path
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    for (const forbidden of ["SUFFICIENCY_POLICY_V1", "sufficiencyPolicies"]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `Evaluation 不得直接使用 ${forbidden}（必须经 Requirement → PolicyRegistry 解析）`,
      );
    }
    assert.ok(code.includes("resolveSufficiencyPolicy"), "必须经共享 resolver 解析");
  });
});
