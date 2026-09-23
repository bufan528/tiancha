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
  NextAction,
  MethodologyVersion,
  Claim,
  ClaimTemporalRelation,
  Provenance,
} from "../domain/index.js";
import { createIndustry } from "../domain/industry.js";
import { METHODOLOGY_V1 } from "../methodology/methodology-v1.js";
import { KnowledgeProjectionService } from "./knowledge-projection-service.js";
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

  constructor(
    private readonly repo: ResearchRepository,
    private readonly provider: DataProviderPort,
    private readonly artifactStore: ArtifactStore,
    private readonly methodology: MethodologyVersion = METHODOLOGY_V1,
  ) {
    this.knowledge = new KnowledgeProjectionService(repo.db);
  }

  async ingestMaterial(input: IngestMaterialInput): Promise<IngestResult> {
    const now = new Date();
    const nowIso = now.toISOString();

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
    const questionIds: string[] = [];
    const requirementIds: string[] = [];
    for (const dim of this.methodology.dimensions) {
      const q: ResearchQuestion = {
        questionId: `q-${randomUUID()}`,
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
      questionIds.push(q.questionId);

      const req: InformationRequirement = {
        requirementId: `ir-${randomUUID()}`,
        questionId: q.questionId,
        subjectKind: "industry",
        subjectId: industry.industryId,
        dimension: dim.key,
        description: dim.requiredInfo,
        importance: 5,
        requiredEvidenceType: dim.requiredInfo,
        status: "open",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.repo.upsertRequirement(req);
      requirementIds.push(req.requirementId);

      const pool: InformationPoolEntry = {
        entryId: `pe-${randomUUID()}`,
        subjectKind: "industry",
        subjectId: industry.industryId,
        topic: dim.key,
        status: "unknown",
        relatedRequirementIds: [req.requirementId],
        evidenceRefs: [],
        note: dim.unknownCondition,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.repo.upsertPoolEntry(pool);
    }

    // 4. DataProvider → Claims (as Artifacts). Echo must flag non-real.
    const obs = await this.provider.retrieve({
      purpose: "initial",
      subjectKind: "industry",
      subjectId: industry.industryId,
      subjectName: industry.canonicalName,
      metrics: this.methodology.dimensions.map((d) => d.key),
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

    // 5. One-way Knowledge -> Pool -> State -> Gap projection (2C).
    this.knowledge.reconcilePool(industry.industryId, "industry");
    this.knowledge.refreshGaps(industry.industryId, "industry");
    this.knowledge.refreshState(industry.industryId, "industry");

    // 6. NextAction for each active gap (retrieve the missing information).
    const gaps = this.repo
      .listGaps(industry.industryId)
      .filter((g) => g.status === "open" || g.status === "mitigating");
    const actionIds: string[] = [];
    for (const gap of gaps) {
      const a: NextAction = {
        actionId: `act-${randomUUID()}`,
        subjectKind: "industry",
        subjectId: industry.industryId,
        kind: "retrieve_data",
        params: { gapId: gap.gapId },
        dependsOn: [],
        priority: 0,
        rationale: "信息缺失，需补全",
        status: "open",
        createdBy: "planner",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.repo.upsertNextAction(a);
      actionIds.push(a.actionId);
    }

    // 7. Attach aux ids (questions/gaps/actions) to the projected state.
    //    known/confirmed/uncertain/conflicting/unknown come from refreshState;
    //    these ids are maintained here (refreshState preserves, never creates).
    const projected = this.repo.getStateBySubject("industry", industry.industryId)!;
    const state: ResearchState = {
      ...projected,
      keyQuestionIds: questionIds,
      researchGapIds: gaps.map((g) => g.gapId),
      nextActionIds: actionIds,
      updatedAt: nowIso,
    };
    this.repo.upsertState(state);
    this.repo.upsertIndustry({ ...industry, currentStateId: state.stateId, updatedAt: nowIso });

    const poolEntries = this.repo.listPoolEntries(industry.industryId);
    return {
      industry,
      questionCount: questionIds.length,
      requirementCount: requirementIds.length,
      poolEntryCount: poolEntries.length,
      gapCount: gaps.length,
      nextActionCount: actionIds.length,
      state,
      claimIds: evidenceClaimIds,
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
