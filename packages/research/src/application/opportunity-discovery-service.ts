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
  InformationPoolEntry,
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
import { questionKey, requirementKey, poolEntryKey } from "../domain/identity.js";
import { METHODOLOGY_V1 } from "../methodology/methodology-v1.js";
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

      const entryId = poolEntryKey(industry.industryId, dim.key);
      if (!this.repo.getPoolEntry(entryId)) {
        const pool: InformationPoolEntry = {
          entryId,
          subjectKind: "industry",
          subjectId: industry.industryId,
          topic: dim.key,
          status: "unknown",
          relatedRequirementIds: [requirementId],
          evidenceRefs: [],
          note: dim.unknownCondition,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        this.repo.upsertPoolEntry(pool);
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
    const poolEntries = this.repo.listPoolEntries(industry.industryId);
    return {
      industry,
      questionCount: questionIds.length,
      requirementCount: requirementIds.length,
      poolEntryCount: poolEntries.length,
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
  }): Promise<{ claimIds: string[]; state: ResearchState | undefined }> {
    const nowIso = new Date().toISOString();
    const claimIds: string[] = [];

    // Field-research material provenance (Invariant 7: belief -> source -> document).
    const source: ResearchSource = {
      sourceId: `src-${randomUUID()}`,
      type: input.sourceType ?? "customer_expert",
      title: input.sourceTitle ?? "field research material",
      isRealExternalData: true,
      createdAt: nowIso,
    };
    this.repo.upsertSource(source);

    for (const c of input.claims) {
      const claim: Claim = {
        claimId: `claim-${randomUUID()}`,
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
      await this.artifactStore.put({
        artifact: {
          artifactId: claim.claimId,
          kind: "claim",
          schemaVersion: "2",
          ref: { artifactId: claim.claimId, kind: "claim", locator: { type: "sqlite", id: claim.claimId } },
          createdAt: nowIso,
          taskId: "field-research-ingest",
          attemptId: "ingest-claims",
          runId: `backfill-${randomUUID()}`,
        },
        blob: claim,
      });
      claimIds.push(claim.claimId);
      this.knowledge.projectFromClaim({
        claim,
        dimension: c.dimension,
        topic: c.dimension,
        sourceRef: c.sourceRef ?? source.sourceId,
        confidence: c.confidence ?? 0.5,
        relationHint: c.relationHint,
      });
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
