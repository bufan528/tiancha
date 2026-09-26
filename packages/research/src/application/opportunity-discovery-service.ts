/**
 * OpportunityDiscoveryService — Phase 2A minimal business pipeline.
 *
 * ingestMaterial(materialText, industryName, sourceType):
 *   Material → Source/Document → Industry(match or create)
 *     → per Methodology dimension: ResearchQuestion + InformationRequirement
 *     → InformationPool (initially unknown)
 *     → DataProvider (Echo placeholder) → Claims (as Artifacts)
 *     → ResearchGap (dimensions without evidence)
 *     → ResearchState refresh
 *     → NextAction (executable)
 *
 * T9 discipline: new evidence NEVER overwrites old claims. A newer claim is
 * written alongside; the older one is marked temporalRelation=old/superseded
 * but retained with its provenance and evidence.
 */

import { randomUUID } from "node:crypto";
import type {
  Industry,
  ResearchQuestion,
  InformationRequirement,
  InformationPoolSlot,
  ResearchState,
  ResearchSource,
  ResearchDocument,
  MethodologyVersion,
  Claim,
  ClaimTemporalRelation,
  Provenance,
} from "../domain/index.js";
import { createIndustry } from "../domain/industry.js";
import { dimensionImportance } from "../domain/methodology.js";
import { questionKey, requirementKey, poolSlotKey } from "../domain/identity.js";
import { METHODOLOGY_V1 } from "../methodology/methodology-v1.js";
import { SUFFICIENCY_POLICY_V1 } from "../domain/index.js";
import { KnowledgeProjectionService } from "./knowledge-projection-service.js";
import { MethodologyService } from "./methodology-service.js";
import type { ResearchRepository } from "../storage/research-repository.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import type { DataProviderPort } from "../ports/data-provider.port.js";

export interface IngestMaterialInput {
  materialText: string;
  industryName: string;
  sourceType?: ResearchSource["type"];
}

export interface IngestResult {
  industry: Industry;
  questionCount: number;
  requirementCount: number;
  poolEntryCount: number;
  gapCount: number;
  nextActionCount: number;
  state: ResearchState;
  /** Artifact ids of the claims persisted by this ingest (for traceability). */
  claimIds: string[];
}

export class OpportunityDiscoveryService {
  private readonly knowledge: KnowledgeProjectionService;
  private readonly methodologyService: MethodologyService;

  constructor(
    private readonly repo: ResearchRepository,
    private readonly provider: DataProviderPort,
    private readonly artifactStore: ArtifactStore,
    /** Frozen baseline used only to bootstrap the DB when no version is active. */
    private readonly methodology: MethodologyVersion = METHODOLOGY_V1,
  ) {
    this.knowledge = new KnowledgeProjectionService(repo.db);
    this.methodologyService = new MethodologyService(repo);
  }

  async ingestMaterial(input: IngestMaterialInput): Promise<IngestResult> {
    const now = new Date();
    const nowIso = now.toISOString();
    // Always the version ACTIVE in the DB (bootstraps the frozen baseline if none).
    const activeMethodology = this.methodologyService.getActive(this.methodology);

    // 1. Source + Document
    const source: ResearchSource = {
      sourceId: `src-${randomUUID()}`,
      type: input.sourceType ?? "user_self",
      title: `material for ${input.industryName}`,
      isRealExternalData: input.sourceType === "echo_placeholder" ? false : true,
      createdAt: nowIso,
    };
    this.repo.upsertSource(source);
    const doc: ResearchDocument = {
      documentId: `doc-${randomUUID()}`,
      sourceId: source.sourceId,
      title: input.industryName,
      rawTextLocator: `inline:${source.sourceId}`,
      createdAt: nowIso,
    };
    this.repo.upsertDocument(doc);

    // 2. Industry: match by canonical name or create
    let industry = this.repo.findIndustryByName(input.industryName);
    if (!industry) {
      industry = createIndustry({
        industryId: `ind-${randomUUID()}`,
        canonicalName: input.industryName,
        description: input.materialText.slice(0, 200),
        now,
      });
    } else {
      industry = { ...industry, updatedAt: nowIso };
    }
    this.repo.upsertIndustry(industry);

    // 3. Per methodology dimension: Question + Requirement + Pool entry(unknown)
    //    E2 (S2): match-or-create on DETERMINISTIC identity keys (subject + dimension)
    //    so a repeated ingest never creates a second copy of the research skeleton.
    const questionIds: string[] = [];
    const requirementIds: string[] = [];
    for (const dim of activeMethodology.dimensions) {
      const questionId = questionKey(industry.industryId, dim.key);
      if (!this.repo.getQuestion(questionId)) {
        const q: ResearchQuestion = {
          questionId,
          subjectKind: "industry",
          subjectId: industry.industryId,
          statement: `研究「${industry.canonicalName}」在 ${dim.name}（${dim.key}）上：${dim.requiredInfo}`,
          origin: "material",
          status: "open",
          priority: 0,
          dependsOn: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        this.repo.upsertQuestion(q);
      }
      questionIds.push(questionId);

      const requirementId = requirementKey(industry.industryId, dim.key);
      if (!this.repo.getRequirement(requirementId)) {
        const req: InformationRequirement = {
          requirementId,
          questionId,
          subjectKind: "industry",
          subjectId: industry.industryId,
          dimension: dim.key,
          description: dim.requiredInfo,
          // E1: importance + judgement conditions come from the ACTIVE methodology,
          // never hard-coded (was: importance = 5).
          importance: dimensionImportance(dim.weight),
          requiredEvidenceType: dim.requiredInfo,
          // S4.5: the machine-executable sufficiency rule the Pool/Gap judge with.
          sufficiencyPolicyRef: SUFFICIENCY_POLICY_V1.versionId,
          confirmedCondition: dim.confirmedCondition,
          uncertainCondition: dim.uncertainCondition,
          unknownCondition: dim.unknownCondition,
          preferredPositionKinds: [],
          status: "open",
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        this.repo.upsertRequirement(req);
      }
      requirementIds.push(requirementId);

      const slotId = poolSlotKey(industry.industryId, dim.key);
      if (!this.repo.getPoolSlot(slotId)) {
        const slot: InformationPoolSlot = {
          slotId,
          subjectKind: "industry",
          subjectId: industry.industryId,
          dimension: dim.key,
          status: "unknown",
          coverageJudgement: `${dim.key}: 尚无信息`,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        this.repo.upsertPoolSlot(slot);
      }
    }

    // 4. DataProvider → Claims (as Artifacts). Echo must flag non-real.
    const obs = await this.provider.retrieve({
      purpose: "initial",
      subjectKind: "industry",
      subjectId: industry.industryId,
      subjectName: industry.canonicalName,
      metrics: activeMethodology.dimensions.map((d) => d.key),
    });

    const evidenceClaimIds: string[] = [];
    for (const c of obs.claims) {
      const claim: Claim = {
        claimId: `claim-${randomUUID()}`,
        statement: c.statement,
        claimType: "descriptive",
        provenance: (obs.sourceType === "echo_placeholder" ? "user" : "analyst") as Provenance,
        conflictOfInterest: false,
        factIds: [],
        evidenceIds: [],
        subjectKind: "industry",
        subjectId: industry.industryId,
        temporalRelation: "current",
        isRealExternalData: obs.isRealExternalData,
      };
      await this.artifactStore.put({
        artifact: {
          artifactId: claim.claimId,
          kind: "claim",
          schemaVersion: "2",
          ref: { artifactId: claim.claimId, kind: "claim", locator: { type: "sqlite", id: claim.claimId } },
          createdAt: nowIso,
          taskId: "opportunity-discovery",
          attemptId: "ingest",
          runId: `ingest-${randomUUID()}`,
        },
        blob: claim,
      });
      evidenceClaimIds.push(claim.claimId);
      // Project into Knowledge. Placeholder claims (Echo, isRealExternalData=false)
      // are auto-SKIPPED and never become beliefs (Invariant 5). Pool/State/Gap
      // are refreshed from the current projection in step 5.
      this.knowledge.projectFromClaim({
        claim,
        dimension: c.dimension,
        topic: c.dimension,
        sourceRef: source.sourceId,
        confidence: c.confidence ?? 0.5,
      });
    }

    // 5-6. One-way Knowledge -> Pool -> Gaps -> NextActions -> State (2C).
    this.knowledge.refreshSubject(industry.industryId, "industry");

    // 7. Attach keyQuestionIds (questions are created by ingest; refreshSubject preserves them).
    const projected = this.repo.getStateBySubject("industry", industry.industryId)!;
    const state: ResearchState = {
      ...projected,
      keyQuestionIds: questionIds,
      updatedAt: nowIso,
    };
    this.repo.upsertState(state);
    this.repo.upsertIndustry({ ...industry, currentStateId: state.stateId, updatedAt: nowIso });

    const gaps = this.repo
      .listGaps(industry.industryId)
      .filter((g) => g.status === "open" || g.status === "mitigating");
    const actions = this.repo.listNextActions(industry.industryId).filter((a) => a.status === "open");
    const poolSlots = this.repo.listPoolSlots(industry.industryId);
    return {
      industry,
      questionCount: questionIds.length,
      requirementCount: requirementIds.length,
      poolEntryCount: poolSlots.length,
      gapCount: gaps.length,
      nextActionCount: actions.length,
      state,
      claimIds: evidenceClaimIds,
    };
  }

  /**
   * Backfill an existing subject with new claims (Phase 2C: field research
   * return path). Persists each claim and projects it into Knowledge, then runs
   * the full one-way refresh. Placeholder claims are auto-SKIPPED.
   */
  async ingestClaims(input: {
    subjectKind: "industry" | "company" | "general";
    subjectId: string;
    claims: Array<{
      statement: string;
      dimension: string;
      confidence?: number;
      provenance?: Claim["provenance"];
      sourceRef?: string;
      relationHint?: { kind: "SUPPORT" } | { kind: "REVISE" } | { kind: "CONFLICT"; note?: string } | { kind: "SUPERSEDE"; supersedesClaimRef: string };
    }>;
    sourceType?: ResearchSource["type"];
    sourceTitle?: string;
    /**
     * ★ C-MVP-R1 (§29.5b) — OPTIONAL inputs that make this method reusable by the resumable
     * material pipeline. Omitted (every historical call site) the behaviour is unchanged:
     *  - `sourceId`  reuse a STABLE source row, so a resume never creates a second Source;
     *  - `claimIds`  claim ids pre-allocated in the P1 ledger — a resume REUSES them, which is
     *                what makes "retry never produces a second Claim" true across two DBs;
     *  - `runId`     stable artifact run id, for the same reason;
     *  - `skipBlocks` block indexes already `projected` (skipped ⇒ no re-write at all);
     *  - `onBlockCommitted` per-block progress callback: the ledger writer.
     */
    sourceId?: string;
    claimIds?: string[];
    runId?: string;
    skipBlocks?: ReadonlySet<number> | number[];
    onBlockCommitted?: (
      blockIndex: number,
      claimId: string,
      phase: "artifact_written" | "projected",
    ) => void;
  }): Promise<{ claimIds: string[]; state: ResearchState | undefined }> {
    const nowIso = new Date().toISOString();
    const claimIds: string[] = [];
    const skip =
      input.skipBlocks instanceof Set ? input.skipBlocks : new Set<number>(input.skipBlocks ?? []);
    const runId = input.runId ?? `backfill-${randomUUID()}`;

    // Field-research material provenance (Invariant 7: belief -> source -> document).
    const source: ResearchSource = {
      sourceId: input.sourceId ?? `src-${randomUUID()}`,
      type: input.sourceType ?? "customer_expert",
      title: input.sourceTitle ?? "field research material",
      isRealExternalData: true,
      createdAt: nowIso,
    };
    this.repo.upsertSource(source);

    for (let index = 0; index < input.claims.length; index += 1) {
      const c = input.claims[index]!;
      const claim: Claim = {
        claimId: input.claimIds?.[index] ?? `claim-${randomUUID()}`,
        statement: c.statement,
        claimType: "descriptive",
        provenance: c.provenance ?? "user",
        conflictOfInterest: false,
        factIds: [],
        evidenceIds: [],
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        temporalRelation: "current",
        isRealExternalData: true,
      };
      if (skip.has(index)) {
        // Already projected in an earlier attempt: report it, write NOTHING (§29.5b P3).
        claimIds.push(claim.claimId);
        continue;
      }
      await this.artifactStore.put({
        artifact: {
          artifactId: claim.claimId,
          kind: "claim",
          schemaVersion: "2",
          ref: { artifactId: claim.claimId, kind: "claim", locator: { type: "sqlite", id: claim.claimId } },
          createdAt: nowIso,
          taskId: "field-research-ingest",
          attemptId: "ingest-claims",
          runId,
        },
        blob: claim,
      });
      // P2 done for this block (the put is idempotent by artifactId) — record BEFORE projecting
      // so a crash in the projection step resumes from `artifact_written`, not from scratch.
      input.onBlockCommitted?.(index, claim.claimId, "artifact_written");
      claimIds.push(claim.claimId);
      this.knowledge.projectFromClaim({
        claim,
        dimension: c.dimension,
        topic: c.dimension,
        sourceRef: c.sourceRef ?? source.sourceId,
        confidence: c.confidence ?? 0.5,
        relationHint: c.relationHint,
      });
      input.onBlockCommitted?.(index, claim.claimId, "projected");
    }

    this.knowledge.refreshSubject(input.subjectId, input.subjectKind);
    return {
      claimIds,
      state: this.repo.getStateBySubject(input.subjectKind, input.subjectId),
    };
  }

  /**
   * T9: apply new evidence about an existing claim topic WITHOUT overwriting.
   * The prior claim (if any) is retained and marked temporalRelation=old;
   * a new claim is written alongside it as current. Nothing is deleted.
   */
  async supersedeClaim(opts: {
    oldClaimId: string;
    newStatement: string;
    subjectKind: "industry" | "company" | "general";
    subjectId: string;
    now?: Date;
  }): Promise<{ oldClaimId: string; newClaimId: string }> {
    const now = (opts.now ?? new Date()).toISOString();
    const prior = await this.artifactStore.get(opts.oldClaimId);
    if (prior) {
      const oldBlob = { ...(prior.blob as Claim), temporalRelation: "old" as ClaimTemporalRelation };
      await this.artifactStore.put({
        artifact: {
          artifactId: oldBlob.claimId,
          kind: "claim",
          schemaVersion: "2",
          ref: { artifactId: oldBlob.claimId, kind: "claim", locator: { type: "sqlite", id: oldBlob.claimId } },
          createdAt: now,
          taskId: "opportunity-discovery",
          attemptId: "supersede",
          runId: "supersede",
        },
        blob: oldBlob,
      });
    }
    const newClaim: Claim = {
      claimId: `claim-${randomUUID()}`,
      statement: opts.newStatement,
      claimType: "descriptive",
      provenance: "user",
      conflictOfInterest: false,
      factIds: [],
      evidenceIds: [],
      subjectKind: opts.subjectKind,
      subjectId: opts.subjectId,
      temporalRelation: "current",
      isRealExternalData: true,
    };
    await this.artifactStore.put({
      artifact: {
        artifactId: newClaim.claimId,
        kind: "claim",
        schemaVersion: "2",
        ref: { artifactId: newClaim.claimId, kind: "claim", locator: { type: "sqlite", id: newClaim.claimId } },
        createdAt: now,
        taskId: "opportunity-discovery",
        attemptId: "supersede",
        runId: "supersede",
      },
      blob: newClaim,
    });
    return { oldClaimId: opts.oldClaimId, newClaimId: newClaim.claimId };
  }
}
