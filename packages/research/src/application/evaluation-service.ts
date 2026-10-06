/**
 * EvaluationService (S4 / S4.5) — the FOUR-FACE model, each face its own method.
 *
 *   evaluate()          orchestration only (no business rules inline)
 *   ├─ evaluateDimension()  ② (+ ① via assessEvidence)
 *   ├─ aggregate()          ③ 12 → 7, driven entirely by AggregationPolicy
 *   └─ decide()             ④ driven entirely by EvaluationPolicy.decision
 *
 * LOCKED INVARIANTS:
 *  - A dimension carries a `score` ONLY when status === "evaluated".
 *    `insufficient_evidence` / `conflicting` => NO score (never a silent 0/low).
 *  - `insufficient_evidence` is an EVALUATION status; the DECISION for it is `pending`.
 *  - Critical dimensions are checked BEFORE any averaging (they cannot be averaged away).
 *  - Scoring / aggregation / decision rules come from the injected policy — nothing here
 *    hard-codes a formula.
 *
 * S4.5:
 *  - Face ① judges with the SHARED SufficiencyPolicy (domain/sufficiency.ts) — the
 *    same rule the Pool uses, so the two never drift apart.
 *  - The produced InvestmentEvaluation records the exact `evaluationPolicyVersionId`
 *    and `aggregationPolicyVersionId` used (immutable provenance).
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ResearchRepository } from "../storage/research-repository.js";
import { KnowledgeRepository } from "../storage/knowledge-repository.js";
import { isUnconfirmedEvidence, materialEvidenceIndex } from "./material-confirmation.js";
import { MethodologyService } from "./methodology-service.js";
import { poolSlotKey } from "../domain/identity.js";
import {
  AGGREGATION_POLICY_V1,
  EVALUATION_POLICY_V1,
  type AggregationPolicy,
  type DecisionInput,
  type EvaluationPolicy,
} from "../domain/evaluation-policy.js";
import { isSufficient, resolveSufficiencyPolicy, sufficiencyFacts } from "../domain/sufficiency.js";
import type {
  Aggregation,
  DimensionEvalStatus,
  DimensionEvaluation,
  EvaluationCoverage,
  EvidenceSufficiency,
  InformationRequirement,
  InvestmentEvaluation,
  MethodologyDimension,
  ReserveDecision,
} from "../domain/index.js";

export interface EvidenceAssessment {
  status: DimensionEvalStatus;
  sufficiency: EvidenceSufficiency;
  evidenceRefs: string[];
  conflictingClaimRefs?: string[];
  /**
   * ★ H-1（H1-INV-5）：本次判定实际采用的 sufficiency policy provenance。
   *   无 requirement ⇒ 二者均为 undefined（无可判据 ⇒ 只能 insufficient_evidence）。
   */
  sufficiencyPolicyRef?: string;
  sufficiencyPolicyVersionId?: string;
}

export class EvaluationService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly policy: EvaluationPolicy = EVALUATION_POLICY_V1,
    private readonly aggregationPolicy: AggregationPolicy = AGGREGATION_POLICY_V1,
  ) {}

  // ---- Orchestration ---------------------------------------------------------

  evaluate(
    subjectKind: "industry" | "company" | "general",
    subjectId: string,
    knowledgeId: string,
  ): InvestmentEvaluation {
    const repo = new ResearchRepository(this.db);
    const methodology = new MethodologyService(repo).getActive();

    // ★ H-1（H1-INV-2 / H1-Q-3）：requirement 来源必须与 Pool 侧【同一入口】，
    //   不得从 Pool 反推、不得另立第二套 discovery。
    const requirementByDimension = new Map<string, InformationRequirement>(
      repo.listRequirements(subjectId).map((r) => [r.dimension, r]),
    );

    // ① + ②
    const dimensionEvaluations = methodology.dimensions.map((dim) =>
      this.evaluateDimension(subjectId, knowledgeId, dim, requirementByDimension),
    );
    // ③
    const aggregation = this.aggregate(dimensionEvaluations);

    const coverage: EvaluationCoverage = {
      evaluated: dimensionEvaluations.filter((d) => d.status === "evaluated").length,
      insufficient: dimensionEvaluations.filter((d) => d.status === "insufficient_evidence").length,
      conflicting: dimensionEvaluations.filter((d) => d.status === "conflicting").length,
      notApplicable: dimensionEvaluations.filter((d) => d.status === "not_applicable").length,
      total: dimensionEvaluations.length,
    };

    const sufficiencySummary = {
      minIndependentSources: dimensionEvaluations.length
        ? Math.min(...dimensionEvaluations.map((d) => d.sufficiency.independentSources))
        : 0,
      anyFirstHand: dimensionEvaluations.some((d) => d.sufficiency.firstHand),
    };

    // ④ Critical dimensions must be able to block a plain "reserve".
    const criticalFlags: Record<string, boolean> = {};
    for (const dim of methodology.dimensions) {
      if (dim.criticality === "critical") {
        const ev = dimensionEvaluations.find((d) => d.dimension === dim.key);
        criticalFlags[dim.key] = ev?.status === "evaluated";
      }
    }

    // S4.5: investment-dimension weights come from the Aggregation Policy, so
    // `AggregationRule.weight` actually participates in the decision (was unused).
    const sevenDimWeights: Record<string, number> = {};
    for (const rule of this.aggregationPolicy.rules) sevenDimWeights[rule.sevenDim] = rule.weight;

    const decision = this.decide({ dimensionEvaluations, aggregation, criticalFlags, sevenDimWeights });

    const evaluation: InvestmentEvaluation = {
      evaluationId: `eval-${randomUUID()}`,
      subjectKind,
      subjectId,
      methodologyVersionId: methodology.versionId,
      // S4.5 provenance: record the EXACT rules this evaluation was computed with.
      evaluationPolicyVersionId: this.policy.versionId,
      aggregationPolicyVersionId: this.aggregationPolicy.versionId,
      dimensionEvaluations,
      aggregation,
      coverage,
      sufficiencySummary,
      criticalFlags,
      decision,
      createdAt: new Date().toISOString(),
    };
    repo.upsertEvaluation(evaluation);
    return evaluation;
  }

  // ---- ① Evidence Assessment -------------------------------------------------

  /**
   * Face ①: is the evidence ENOUGH? Pure judgement — **never** produces a score.
   * Uses the SHARED sufficiency policy (same rule the Pool judges with).
   *
   * ★ H-1（H1-INV-1/2/3/4 + H1-INV-6）：
   *   · current 输入经 `KnowledgeRepository.listCurrentBeliefs()` 取得（C-FIX-12 唯一访问器），
   *     Evaluation【不】自行判断 `state === "confirmed"`；
   *   · sufficiency policy 经 `resolveSufficiencyPolicy(requirement)` 解析
   *     （NEVER 硬编码版本；ref 缺失/未知 ⇒ THROW）；
   *   · facts / evidenceRefs 来自【同一组】已解析的 current 输入证据（同源，H1-INV-4）；
   *   · 无 requirement ⇒ 无 policy ⇒ 只能 `insufficient_evidence`（与 Pool 的 partial 语义对齐）。
   */
  assessEvidence(
    subjectId: string,
    knowledgeId: string,
    dim: MethodologyDimension,
    requirementByDimension: ReadonlyMap<string, InformationRequirement>,
  ): EvidenceAssessment {
    const repo = new ResearchRepository(this.db);
    const knowledge = new KnowledgeRepository(this.db);
    const slotId = poolSlotKey(subjectId, dim.key);
    const slot = repo.getPoolSlot(slotId);

    // ★ H1-INV-1 / H1-INV-3：current cognition 的唯一来源；非 current belief（candidate /
    //   rejected / revised / conflicting / superseded）不得贡献 sufficiency。
    const currentClaimRefs = new Set(
      knowledge
        .listCurrentBeliefs(knowledgeId)
        .filter((b) => b.dimension === dim.key)
        .map((b) => b.claimRef),
    );

    // ★ H1-INV-4：facts / evidenceRefs / score 必须来自这【同一个】已解析输入集合。
    const items = (slot ? repo.listPoolItems(slotId) : []).filter((it) =>
      currentClaimRefs.has(it.claimRef),
    );

    // ★ H1-INV-2 / H1-INV-6：共享 resolver；无 req ⇒ undefined；ref 缺失/未知 ⇒ THROW。
    const requirement = requirementByDimension.get(dim.key);
    const policy = resolveSufficiencyPolicy(requirement);
    const provenance = {
      sufficiencyPolicyRef: requirement?.sufficiencyPolicyRef,
      sufficiencyPolicyVersionId: policy?.versionId,
    };

    const sufficiency = sufficiencyFacts(items);
    const evidenceRefs = items.map((i) => i.claimRef);

    if (!slot || items.length === 0) {
      return { status: "insufficient_evidence", sufficiency, evidenceRefs, ...provenance };
    }
    if (slot.status === "conflicting") {
      return {
        status: "conflicting",
        sufficiency,
        evidenceRefs,
        conflictingClaimRefs: items.filter((i) => i.relation === "contradicts").map((i) => i.claimRef),
        ...provenance,
      };
    }
    if (policy === undefined) {
      // ★ H1-Q-4：无 requirement ⇒ 无可判据 ⇒ 与 Pool 的 partial 语义对齐（永不 sufficient）。
      return { status: "insufficient_evidence", sufficiency, evidenceRefs, ...provenance };
    }
    if (isSufficient(sufficiency, policy)) {
      return { status: "evaluated", sufficiency, evidenceRefs, ...provenance };
    }
    return { status: "insufficient_evidence", sufficiency, evidenceRefs, ...provenance };
  }

  // ---- ② Dimension Evaluation ------------------------------------------------

  /** Face ②: score ONLY when face ① says the evidence is sufficient. */
  evaluateDimension(
    subjectId: string,
    knowledgeId: string,
    dim: MethodologyDimension,
    requirementByDimension: ReadonlyMap<string, InformationRequirement>,
  ): DimensionEvaluation {
    const assessment = this.assessEvidence(subjectId, knowledgeId, dim, requirementByDimension);

    // ★ §29.14 (5a): split the evidence into CONFIRMED and UNCONFIRMED — a Claim from a material
    // that is not `completed` is not confirmed evidence. It stays VISIBLE (its own optional field)
    // but it is no longer counted as `evidenceRefs`. The union is unchanged, so nothing is lost.
    const evidenceIndex = materialEvidenceIndex(new ResearchRepository(this.db), subjectId);
    const confirmedRefs = assessment.evidenceRefs.filter((ref) => !isUnconfirmedEvidence(evidenceIndex, ref));
    const unconfirmedRefs = assessment.evidenceRefs.filter((ref) => isUnconfirmedEvidence(evidenceIndex, ref));

    const evaluation: DimensionEvaluation = {
      dimension: dim.key,
      status: assessment.status,
      rationale: rationaleFor(assessment.status, dim, assessment.sufficiency),
      evidenceRefs: confirmedRefs,
      sufficiency: assessment.sufficiency,
    };
    // ★ H-1（H1-INV-5）：按 additive / optional 方式记录本次 sufficiency 判定的 provenance。
    //   无 requirement ⇒ 二者保持 undefined（不压写、不 fallback）。
    if (assessment.sufficiencyPolicyRef !== undefined) {
      evaluation.sufficiencyPolicyRef = assessment.sufficiencyPolicyRef;
    }
    if (assessment.sufficiencyPolicyVersionId !== undefined) {
      evaluation.sufficiencyPolicyVersionId = assessment.sufficiencyPolicyVersionId;
    }
    if (unconfirmedRefs.length > 0) evaluation.unconfirmedEvidenceRefs = unconfirmedRefs;
    if (assessment.conflictingClaimRefs && assessment.conflictingClaimRefs.length > 0) {
      evaluation.conflictingClaimRefs = assessment.conflictingClaimRefs;
    }

    // score is attached ONLY for `evaluated` (and only if a scoring rule exists)
    if (assessment.status === "evaluated" && this.policy.scoring) {
      evaluation.score = this.policy.scoring({
        dimension: dim.key,
        scoreScale: this.policy.scoreScale,
        sufficiency: assessment.sufficiency,
      });
      evaluation.scoreScale = this.policy.scoreScale;
    }
    return evaluation;
  }

  // ---- ③ Investment Aggregation (12 → 7) ------------------------------------

  /** Face ③: 12 research dimensions → 7 investment dimensions, via AggregationPolicy. */
  aggregate(dimensionEvaluations: DimensionEvaluation[]): Aggregation {
    const byDim = new Map(dimensionEvaluations.map((d) => [d.dimension, d]));
    const sevenDimScores: Record<string, number | null> = {};

    for (const rule of this.aggregationPolicy.rules) {
      if (rule.sources.length === 0) {
        // no research dimension feeds it (v1: exit_env) -> evidence insufficient, not faked
        sevenDimScores[rule.sevenDim] = null;
        continue;
      }
      let weighted = 0;
      let totalContribution = 0;
      let allEvaluated = true;
      for (const src of rule.sources) {
        const ev = byDim.get(src.dimension);
        if (!ev || ev.status !== "evaluated" || ev.score === undefined) {
          allEvaluated = false;
          break;
        }
        weighted += ev.score * src.contribution;
        totalContribution += src.contribution;
      }
      sevenDimScores[rule.sevenDim] = allEvaluated && totalContribution > 0 ? weighted / totalContribution : null;
    }
    return { sevenDimScores };
  }

  // ---- ④ Decision ------------------------------------------------------------

  /** Face ④: the decision comes from the policy (critical-first, coverage-aware). */
  decide(input: DecisionInput): ReserveDecision {
    return this.policy.decision(input);
  }
}

// ---- helpers -----------------------------------------------------------------

function rationaleFor(status: DimensionEvalStatus, dim: MethodologyDimension, s: EvidenceSufficiency): string {
  switch (status) {
    case "evaluated":
      return `${dim.name}：证据充分（${s.itemCount} 条，${s.independentSources} 个独立来源）`;
    case "conflicting":
      return `${dim.name}：存在未解冲突，暂不评分`;
    case "not_applicable":
      return `${dim.name}：不适用`;
    default:
      return `${dim.name}：证据不足，暂不评分`;
  }
}
