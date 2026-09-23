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
  ResearchGap,
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
import { emptyResearchState } from "../domain/research-state.js";
import { METHODOLOGY_V1 } from "../methodology/methodology-v1.js";
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
}

export class OpportunityDiscoveryService {
  constructor(
    private readonly repo: ResearchRepository,
    private readonly provider: DataProviderPort,
    private readonly artifactStore: ArtifactStore,
    private readonly methodology: MethodologyVersion = METHODOLOGY_V1,
  ) {}

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
      // mark matching pool entry partial
      const entries = this.repo.listPoolEntries(industry.industryId);
      const hit = entries.find((e) => e.topic === c.dimension);
      if (hit && hit.status === "unknown") {
        this.repo.upsertPoolEntry({
          ...hit,
          status: "partial",
          evidenceRefs: [...hit.evidenceRefs, claim.claimId],
          note: obs.isRealExternalData
            ? "部分掌握（真实数据）"
            : "部分掌握（echo 占位，待真实数据验证）",
          updatedAt: nowIso,
        });
      }
    }

    // 5. Gaps: dimensions whose pool entry is still unknown
    const poolEntries = this.repo.listPoolEntries(industry.industryId);
    const openTopics = poolEntries.filter((e) => e.status === "unknown");
    const gapIds: string[] = [];
    for (const topic of openTopics) {
      const gap: ResearchGap = {
        gapId: `gap-${randomUUID()}`,
        subjectKind: "industry",
        subjectId: industry.industryId,
        description: `「${industry.canonicalName}」在 ${topic.topic} 维度信息缺失`,
        importance: 5,
        uncertainty: 0.9,
        relatedRequirementIds: topic.relatedRequirementIds,
        relatedQuestionIds: questionIds,
        status: "open",
        discoveredAt: nowIso,
        updatedAt: nowIso,
      };
      this.repo.upsertGap(gap);
      gapIds.push(gap.gapId);
    }

    // 6. NextAction for each open gap
    const actionIds: string[] = [];
    for (const gap of gapIds) {
      const a: NextAction = {
        actionId: `act-${randomUUID()}`,
        subjectKind: "industry",
        subjectId: industry.industryId,
        kind: "retrieve_data",
        params: { gapId: gap },
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

    // 7. ResearchState refresh
    let state = this.repo.getStateBySubject("industry", industry.industryId);
    if (!state) {
      state = emptyResearchState({
        stateId: `st-${randomUUID()}`,
        subjectKind: "industry",
        subjectId: industry.industryId,
        now,
      });
    }
    state = {
      ...state,
      known: evidenceClaimIds.map((ref) => ({ ref, confidence: 0.1 })),
      confirmed: [],
      uncertain: [],
      conflicting: [],
      unknown: openTopics.map((e) => ({ ref: e.topic })),
      keyQuestionIds: questionIds,
      researchGapIds: gapIds,
      nextActionIds: actionIds,
      version: state.version + 1,
      updatedAt: nowIso,
    };
    this.repo.upsertState(state);
    this.repo.upsertIndustry({ ...industry, currentStateId: state.stateId, updatedAt: nowIso });

    return {
      industry,
      questionCount: questionIds.length,
      requirementCount: requirementIds.length,
      poolEntryCount: poolEntries.length,
      gapCount: gapIds.length,
      nextActionCount: actionIds.length,
      state,
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
