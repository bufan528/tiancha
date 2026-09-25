/**
 * Tiancha research tools (Phase 2B).
 *
 * These are custom tools injected into the single Tiancha AgentSession. The
 * main model semantically chooses when to call them — there is NO intent
 * classifier and NO keyword matching. Tool implementations delegate to the
 * Application Service / Repository layer; they never open SQLite directly.
 *
 * Boundary: Echo-derived evidence is placeholder. Tools return structured
 * facts only; the Agent (system prompt) is responsible for natural-language
 * phrasing and for never producing a real investment judgment from Echo data.
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { ResearchRepository } from "@tiancha/research";
import type { OpportunityDiscoveryService } from "@tiancha/research";
import type { MethodologyService } from "@tiancha/research";
import type { PriorityService } from "@tiancha/research";
import type { ReportService } from "@tiancha/research";
import type { MaterialIngestService } from "@tiancha/research";
import type { TargetService } from "@tiancha/research";
import type { ResearchNeedService } from "@tiancha/research";
import type { QuestionTargetFitService } from "@tiancha/research";
import type { DiligencePreparationService } from "@tiancha/research";
// ★ C2: current/retired question predicates (single source of truth in the domain).
import { currentPreparationView, currentQuestions, retiredQuestions } from "@tiancha/research";
// ★ C2 Step 2-A: the SHARED read-only coverage derivation. The Agent deliberately has no chain
// projection service injected (B5 governance), so it derives coverage from the repository via the
// SAME domain function the CLI uses — the two surfaces cannot drift (T-C2-36).
// ★ C2 Step 2-C: `ResearchPlanService` is the ONE plan build path (value import — the tool
// constructs the same implementation when it is not injected).
import { ActiveRequirementResolver, positionCoverages, ResearchPlanService } from "@tiancha/research";

export interface ResearchToolDeps {
  repo: ResearchRepository;
  service: OpportunityDiscoveryService;
  methodology: MethodologyService;
  /** S7: READ-ONLY face for priorities (S6-R1) — the tool never recomputes. */
  priority: PriorityService;
  /** S7: generates a read-only projection (appends a snapshot; touches no SoT). */
  reports: ReportService;
  /** C-MVP: the material input pipe (writes a Material, then the existing claim pipeline). */
  materials: MaterialIngestService;
  /** B5: READ-ONLY target listing (the ONLY writer of targets stays CLI-only). */
  targets: TargetService;
  /** B5: READ-ONLY derivation of `ResearchNeed`. */
  needs: ResearchNeedService;
  /** B5: READ-ONLY fit counts per target (B3 aggregation). */
  fits: QuestionTargetFitService;
  /** B5: READ-ONLY access to already-assembled preparations. */
  diligence: DiligencePreparationService;
  /** ★ C2 Step 2-C: the ONE plan projection/build path (READ-ONLY). Production injects it; the tool
   *  otherwise constructs the SAME `ResearchPlanService` from `repo.db` (one implementation). */
  plans?: ResearchPlanService;
  // ★ B5 deliberately injects NO chain-projection service: the Agent reads the projected
  //   chain but never projects it (that stays a human CLI action, `tiancha research chain`).
}

function json(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

const NameParam = Type.Object({
  name: Type.String({ description: "行业标准名（canonical name），如：人形机器人" }),
});

const DimensionParam = Type.Object({
  key: Type.String({ description: "维度 key，如 market" }),
  name: Type.String({ description: "维度中文名" }),
  description: Type.String(),
  whyNeeded: Type.String(),
  requiredInfo: Type.String(),
  confirmedCondition: Type.String(),
  uncertainCondition: Type.String(),
  unknownCondition: Type.String(),
  weight: Type.Number({ description: "该维度的评估权重（0..1；12 维合计≈1）", minimum: 0, maximum: 1 }),
  criticality: Type.Union([Type.Literal("normal"), Type.Literal("critical")], {
    description: "是否为关键维度（critical：证据不足时不得直接得出储备结论）",
  }),
});

const ProposeMethodologyParams = Type.Object({
  rationale: Type.String({ description: "为什么提出这个修订（来自哪些材料或调研反例）" }),
  dimensions: Type.Array(DimensionParam, { description: "修订后的完整维度列表（含原有维度）" }),
});

export function buildResearchTools(deps: ResearchToolDeps) {
  const {
    repo,
    service,
    methodology,
    priority,
    reports,
    materials,
    targets: targetService,
    needs: needService,
    fits,
    diligence,
  } = deps;

  const research_industry_show = defineTool({
    name: "research_industry_show",
    label: "查看行业研究状态",
    description:
      "按行业名查看该行业的研究概况：问题数、信息需求数、信息池覆盖、研究缺口、下一步动作。当用户问某行业“现在怎么样/研究到哪了/值不值得研究”时使用。",
    promptSnippet: "查看某行业研究状态",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。可用 research_industry_ingest 新建。`);
      const out = {
        canonicalName: ind.canonicalName,
        reserveStatus: ind.reserveStatus,
        questions: repo.listQuestions(ind.industryId).length,
        requirements: repo.listRequirements(ind.industryId).length,
        pool: repo.listPoolSlots(ind.industryId).length,
        gaps: repo.listGaps(ind.industryId).length,
        nextActions: repo.listNextActions(ind.industryId).length,
      };
      return json(JSON.stringify(out, null, 2));
    },
  });

  const research_question_list = defineTool({
    name: "research_question_list",
    label: "列出研究问题",
    description: "列出某行业当前的研究问题（Key Questions）。当用户问“还有什么没搞清楚/在研究什么问题”时使用。",
    promptSnippet: "列出研究问题",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const qs = repo.listQuestions(ind.industryId).map((q) => ({ statement: q.statement, status: q.status }));
      return json(JSON.stringify(qs, null, 2));
    },
  });

  const research_gap_list = defineTool({
    name: "research_gap_list",
    label: "列出研究缺口",
    description: "列出某行业当前未填补的研究缺口（哪些维度信息缺失/不确定）。当用户问“还有什么没搞清/缺什么信息”时使用。",
    promptSnippet: "列出研究缺口",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const gaps = repo.listGaps(ind.industryId).map((g) => ({ description: g.description, uncertainty: g.uncertainty, status: g.status }));
      return json(JSON.stringify(gaps, null, 2));
    },
  });

  const research_next_action_list = defineTool({
    name: "research_next_action_list",
    label: "列出下一步研究动作",
    description: "列出某行业系统建议的下一步研究动作（可执行）。当用户问“下一步怎么办/下一步研究什么/该找谁验证”时使用。",
    promptSnippet: "列下一步动作",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const acts = repo.listNextActions(ind.industryId).map((a) => ({ kind: a.kind, rationale: a.rationale, status: a.status }));
      return json(JSON.stringify(acts, null, 2));
    },
  });

  const research_state_show = defineTool({
    name: "research_state_show",
    label: "查看研究认知状态",
    description: "查看某行业的 ResearchState：已知/确认/未知/关键问题/缺口/下一步。用于回答“现在知道什么、还缺什么”。",
    promptSnippet: "查看研究状态",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const st = repo.getStateBySubject("industry", ind.industryId);
      if (!st) return json(`行业「${params.name}」尚无 ResearchState。`);
      const out = {
        version: st.version,
        knownCount: st.known.length,
        unknown: st.unknown.map((u) => u.ref),
        keyQuestionCount: st.keyQuestionIds.length,
        gapCount: st.researchGapIds.length,
        nextActionCount: st.nextActionIds.length,
      };
      return json(JSON.stringify(out, null, 2));
    },
  });

  const research_industry_ingest = defineTool({
    name: "research_industry_ingest",
    label: "纳入行业研究材料",
    description:
      "把一段行业观察/材料纳入研究系统：建立或匹配行业，并基于研究框架生成问题、信息需求、信息池。当用户给一段新材料或要求开始研究某行业时使用。注意：本工具连接的是占位数据源，产出不构成真实投资判断。",
    promptSnippet: "纳入行业材料",
    parameters: Type.Object({
      name: Type.String({ description: "行业标准名" }),
      text: Type.String({ description: "行业材料正文" }),
    }),
    async execute(_id, params: { name: string; text: string }) {
      const res = await service.ingestMaterial({ materialText: params.text, industryName: params.name });
      const out = {
        industry: res.industry.canonicalName,
        questions: res.questionCount,
        requirements: res.requirementCount,
        gaps: res.gapCount,
        nextActions: res.nextActionCount,
      };
      return json(JSON.stringify(out, null, 2));
    },
  });

  const research_methodology_show = defineTool({
    name: "research_methodology_show",
    label: "查看研究方法论",
    description:
      "查看当前已激活的行业研究方法论（研究框架）版本与维度。当用户问“你是怎么研究一个行业的 / 你的研究框架是什么 / 从哪些维度看”时使用。",
    promptSnippet: "查看研究方法论",
    parameters: Type.Object({}),
    async execute() {
      const active = methodology.getActive();
      return json(
        JSON.stringify(
          {
            versionTag: active.versionTag,
            versionId: active.versionId,
            activatedAt: active.activatedAt,
            dimensions: active.dimensions.map((d) => ({ key: d.key, name: d.name, whyNeeded: d.whyNeeded })),
          },
          null,
          2,
        ),
      );
    },
  });

  const research_methodology_list = defineTool({
    name: "research_methodology_list",
    label: "列出方法论版本与提案",
    description:
      "列出研究框架的历史版本，以及仍在等待人工审批的修订提案。当用户问“方法论改过吗 / 有没有待批准的修订”时使用。",
    promptSnippet: "列出方法论版本与提案",
    parameters: Type.Object({}),
    async execute() {
      return json(
        JSON.stringify(
          {
            versions: methodology.history().map((v) => ({
              versionTag: v.versionTag,
              dims: v.dimensions.length,
              activatedAt: v.activatedAt,
            })),
            pendingCandidates: methodology.pendingCandidates().map((c) => ({
              candidateId: c.candidateId,
              baseVersionId: c.baseVersionId,
              dims: c.proposedDimensions.length,
              rationale: c.rationale,
            })),
          },
          null,
          2,
        ),
      );
    },
  });

  // NOTE: there is deliberately NO "decide/activate" tool. The model may only
  // PROPOSE; activation requires a human decision via `tiancha methodology decide`
  // (Invariant 6). The approval token is never exposed to the model.
  const research_methodology_propose = defineTool({
    name: "research_methodology_propose",
    label: "提出方法论修订提案",
    description:
      "当你发现现有研究框架缺少某个维度、或某个维度的判据不适用时，提出方法论修订提案（给出修订后的完整维度列表）。重要：提案不会立即生效，必须由人工审批后才能激活；不要向用户声称它已生效。",
    promptSnippet: "提出方法论修订提案",
    parameters: ProposeMethodologyParams,
    async execute(_id, params: Static<typeof ProposeMethodologyParams>) {
      const res = methodology.propose({
        proposedDimensions: params.dimensions,
        rationale: params.rationale,
        createdBy: "agent",
      });
      return json(
        JSON.stringify(
          {
            candidateId: res.candidate.candidateId,
            baseVersionId: res.candidate.baseVersionId,
            dimensionCount: res.candidate.proposedDimensions.length,
            status: "pending",
            note: "提案已记录，等待人工审批（tiancha methodology decide）。目前尚未生效。",
          },
          null,
          2,
        ),
      );
    },
  });

  // ---- S7: capability exposure (read-only) ----------------------------------
  // The Agent must NEVER change research state:
  //   - evaluate / priority / pool READ what already exists (no recomputation);
  //   - report appends a PROJECTION only (report_snapshot), never Knowledge/Pool/Gap.

  const research_pool_show = defineTool({
    name: "research_pool_show",
    label: "查看信息池槽位",
    description:
      "查看某行业的信息池：每个维度的槽位状态（unknown/partial/sufficient/conflicting）与已整理的条目（含口径差异）。当用户问“现在知道什么/覆盖到什么程度/资料整理得怎么样”时使用。",
    promptSnippet: "查看信息池槽位",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const view = repo.listPoolSlots(ind.industryId).map((s) => ({
        dimension: s.dimension,
        status: s.status,
        judgement: s.coverageJudgement,
        items: repo.listPoolItems(s.slotId).map((i) => ({ claimRef: i.claimRef, relation: i.relation })),
      }));
      return json(JSON.stringify(view, null, 2));
    },
  });

  const research_evaluate = defineTool({
    name: "research_evaluate",
    label: "查看投资评估",
    description:
      "查看某行业最近一次已落库的投资评估（覆盖度、各维度评价状态与分值、决策状态）。本工具只读取已产生的评估，不会重新计算；若尚无评估，会提示先由研究者执行评估命令。维度状态里的“证据不足”仅表示该维度证据不足，不构成任何结论。",
    promptSnippet: "查看投资评估",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const ev = repo.getLatestEvaluation("industry", ind.industryId);
      if (!ev) {
        return json("当前暂无已落库的投资评估，请先由研究者执行 `tiancha research evaluate <行业>`。");
      }
      return json(JSON.stringify(ev, null, 2));
    },
  });

  const research_priority = defineTool({
    name: "research_priority",
    label: "查看研究优先级",
    description:
      "查看某行业当前的研究优先级（哪个缺口应当优先补，含分数与依据）。读取的是系统已产生的优先级结果；若尚无，会提示暂无。",
    promptSnippet: "查看研究优先级",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const ps = priority.currentPriorities(ind.industryId);
      if (ps.length === 0) {
        return json("当前暂无已产生的研究优先级（尚无已落库的缺口优先级）。");
      }
      return json(
        JSON.stringify(
          ps.map((p) => ({
            gapId: p.gapId,
            score: p.score,
            rationale: p.rationale,
            policyVersionId: p.policyVersionId,
          })),
          null,
          2,
        ),
      );
    },
  });

  const research_report = defineTool({
    name: "research_report",
    label: "生成研究报告投影",
    description:
      "为某行业生成一份只读的研究报告投影（当前认知/关键事实/主要判断/主要冲突/缺口/最近变化/最近证据/当前评价/优先级/下一步）。报告只是当前研究状态的快照，不改变任何研究数据；上游尚未产生的内容在该节显示为空。",
    promptSnippet: "生成研究报告投影",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const dossier = reports.generateDossier(ind.industryId);
      const s = dossier.sections;
      return json(
        JSON.stringify(
          {
            dossierId: dossier.dossierId,
            knowledgeVersion: dossier.knowledgeVersion,
            sections: {
              currentKnowledge: s.currentKnowledge.length,
              keyFacts: s.keyFacts.length,
              mainJudgments: s.mainJudgments.length,
              conflicts: s.conflicts.length,
              gaps: s.gaps.length,
              recentChanges: s.recentChanges.length,
              recentEvidence: s.recentEvidence.length,
              evaluation: s.evaluation ? s.evaluation.decisionStatus : null,
              priority: s.priority.length,
              nextActions: s.nextActions.length,
            },
            note: "报告为只读投影，已追加一份快照；未改变任何研究数据。",
          },
          null,
          2,
        ),
      );
    },
  });

  // ---- C-MVP: the material input pipe ---------------------------------------
  // The Agent may now WRITE exactly one kind of thing: a user-supplied Material.
  // It cannot write an Evaluation (that stays CLI-only) and it never recomputes
  // priorities. The claims are read from explicit [CLAIM] blocks — no model involved.
  const research_material_add = defineTool({
    name: "research_material_add",
    label: "把研究材料加入行业",
    description:
      "把一份真实研究材料（调研纪要 / 访谈整理 / 报告摘录）加入某个行业的研究系统。材料中请用 [CLAIM]…[/CLAIM] 块写明可从材料中确认的断言（dimension / content），只有块内内容会成为可追溯的事实，其余仅作为材料留存。加入后系统会重新计算信息池、缺口、优先级与报告。当用户说“把这份材料/纪要加入某行业的研究”时使用。",
    promptSnippet: "把研究材料加入行业",
    parameters: Type.Object({
      name: Type.String({ description: "行业标准名（canonical name），如：人形机器人" }),
      title: Type.String({ description: "材料标题，如：某公司专家访谈纪要 2026-03" }),
      content: Type.String({ description: "材料正文（Markdown/纯文本）；可用 [CLAIM] 块声明结论" }),
    }),
    async execute(_id, params: { name: string; title: string; content: string }) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。请先用 research_industry_ingest 建立该行业。`);

      // ★ C2 Step 2-A: shared predicate (same source as Need / Fit / coverage).
      const openGaps = () => ActiveRequirementResolver.activeGaps(repo.listGaps(ind.industryId)).length;
      const before = { openGaps: openGaps(), priorities: priority.currentPriorities(ind.industryId).length };

      const result = await materials.ingest({
        subjectKind: "industry",
        subjectId: ind.industryId,
        title: params.title,
        text: params.content,
      });

      const after = { openGaps: openGaps(), priorities: priority.currentPriorities(ind.industryId).length };
      return json(
        JSON.stringify(
          {
            industry: ind.canonicalName,
            materialId: result.material.materialId,
            created: result.created,
            parsedClaims: result.parsedClaims,
            parseErrors: result.parseErrors,
            before,
            after,
            note: result.created
              ? "材料已入库，并已驱动研究状态更新。"
              : "相同材料已存在，本次未重复写入。",
          },
          null,
          2,
        ),
      );
    },
  });

  // ---- B5: chain / need / target / diligence exposure (READ-ONLY) ------------
  // B5 exposes what B1–B4 already computed. The Agent READS the projected chain, the
  // derived needs, the human-confirmed targets and the assembled preparations — it never
  // projects a chain, never creates/selects a target and never assembles an outline.
  // When the upstream artefact does not exist yet, the tool says WHO must produce it
  // (the researcher, via CLI) instead of producing it itself (same governance as S7
  // `research_evaluate`).

  const research_chain_show = defineTool({
    name: "research_chain_show",
    label: "查看调研链条（建议研究哪些位置）",
    description:
      "查看某行业已生成的调研链条：当前方法论建议从产业链哪些位置获取信息、每个位置为什么重要、建议研究哪类对象、适合提供什么证据、服务多少个研究问题。注意：它是「建议研究哪类对象」的模板实例，不是该行业客观的链条，也不含任何具体公司/专家名单——具体对象必须由人确认后录入。本工具只读取已生成的链条；若尚未生成，会提示由研究者执行生成命令。",
    promptSnippet: "查看调研链条",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const positions = repo.listPositions(ind.industryId);
      if (positions.length === 0) {
        return json(
          `行业「${ind.canonicalName}」尚未生成调研链条（没有已投影的研究位置）。请先由研究者执行 \`tiancha research chain ${ind.canonicalName}\`；本工具不会自行生成研究数据。`,
        );
      }
      const coverageByRef = new Map(
        positionCoverages(
          positions,
          repo.listGaps(ind.industryId),
          repo.listRequirements(ind.industryId),
        ).map((c) => [c.positionRef, c]),
      );
      const view = positions.map((p) => ({
        positionRef: p.positionRef,
        label: p.label,
        kind: p.kind,
        whyImportant: p.whyImportant,
        suggestedTargetKinds: p.suggestedTargetKinds,
        suitableEvidenceKinds: p.suitableEvidenceKinds,
        limitations: p.limitations,
        importance: p.importance,
        // `servesRequirementCount` = all (capability) — kept unchanged for existing callers;
        // ★ C2 Step 2-A adds the CURRENT coverage (shared derivation, never recomputed here).
        servesRequirementCount: p.satisfiesRequirementRefs.length,
        activeRequirementCount: coverageByRef.get(p.positionRef)?.activeRequirementRefs.length ?? 0,
        chainTemplateId: p.chainTemplateId,
        chainVersion: p.chainVersion,
      }));
      return json(JSON.stringify(view, null, 2));
    },
  });

  const research_need_list = defineTool({
    name: "research_need_list",
    label: "列出研究需求（为什么需要调研）",
    description:
      "列出某行业由研究缺口派生出的研究需求：每条包含维度、问题原文、『为什么这个缺口需要调研而不只是抓数据』的规则解释、当前优先级分数，以及可服务该需求的位置。当用户问『为什么还要去调研/该去问谁/先解决哪个缺口』时使用。只读派生，不会修改缺口或优先级。",
    promptSnippet: "列出研究需求",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const needs = needService.list(ind.industryId);
      if (needs.length === 0) return json(`行业「${ind.canonicalName}」当前没有开放的研究缺口，因此暂无研究需求。`);
      return json(JSON.stringify(needs, null, 2));
    },
  });

  const research_target_list = defineTool({
    name: "research_target_list",
    label: "列出已确认的研究对象",
    description:
      "列出某行业已由人确认的研究对象（公司/专家/机构等），每个对象附带只读的适配概况：它能覆盖多少个问题（强/部分/弱/无）以及有多少个重要问题需要更换更合适的对象。当用户问『我们确认了哪些调研对象/能问谁』时使用。本工具不会新增、选择或修改研究对象——对象必须由人确认后录入。",
    promptSnippet: "列出已确认的研究对象",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const list = targetService.list(ind.industryId);
      if (list.length === 0) {
        return json(`行业「${ind.canonicalName}」尚无已确认的研究对象（对象由人确认后录入，系统不会自行产生主体）。`);
      }
      const view = list.map((target) => ({ target, fit: fits.summarize(target.targetRef) }));
      return json(JSON.stringify(view, null, 2));
    },
  });

  const DiligenceParams = Type.Object({
    name: Type.String({ description: "行业标准名（canonical name），如：人形机器人" }),
    target: Type.Optional(
      Type.String({ description: "研究对象 ref（tgt-…）；给出时查看该对象的调研准备，省略时列出本行业已有的调研准备" }),
    ),
  });

  const research_diligence_show = defineTool({
    name: "research_diligence_show",
    label: "查看调研准备（提纲与提醒）",
    description:
      "查看某行业已生成的调研准备：调研目的、对象简介、当前理解、为什么选这个对象、需要的数据与材料、已知局限、提醒事项，以及问题清单（行业通用 / 对象定制 / 适配度派生三类，每条可溯源）。当用户问『这次调研要问什么/提纲准备好了吗』时使用。本工具只读取已生成的准备；若尚未生成，会提示由研究者执行生成命令。",
    promptSnippet: "查看调研准备",
    parameters: DiligenceParams,
    async execute(_id, params: Static<typeof DiligenceParams>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const preparations = diligence.list(ind.industryId);
      if (params.target) {
        const preparation = preparations.find((p) => p.targetRef === params.target);
        if (!preparation) {
          return json(
            `研究对象「${params.target}」尚无调研准备。请先由研究者执行 \`tiancha research diligence ${ind.canonicalName} --target ${params.target}\`；本工具不会自行生成。`,
          );
        }
        // ★ C2 / I-C2-12: only the CURRENT projection is exposed (retired ⇒ counted, not listed).
        return json(JSON.stringify(currentPreparationView(preparation), null, 2));
      }
      if (preparations.length === 0) {
        return json(
          `行业「${ind.canonicalName}」暂无调研准备。请先由研究者确认研究对象（tiancha research target add）并生成调研准备（tiancha research diligence ${ind.canonicalName} --target <targetRef>）。`,
        );
      }
      const view = preparations.map((p) => ({
        preparationRef: p.preparationRef,
        targetRef: p.targetRef,
        targetBrief: p.targetBrief,
        status: p.status,
        questionCount: currentQuestions(p.questions).length,
        retiredQuestionCount: retiredQuestions(p.questions).length,
        cautionCount: p.cautions.length,
      }));
      return json(JSON.stringify(view, null, 2));
    },
  });

  // ★ C2 Step 2-C: the research plan — a READ-ONLY projection over the SAME build path the CLI
  //   uses (`ResearchPlanService.build`). There is deliberately NO "not generated yet" branch:
  //   while the industry exists the plan is always renderable, and nothing is refreshed or written.
  const research_plan_show = defineTool({
    name: "research_plan_show",
    label: "查看研究计划",
    description:
      "查看某行业当前的研究计划：当前认知状态、开放缺口（含优先级与「为什么需要调研」）、建议研究位置（含覆盖 active/all）、已确认对象（含适配与调研准备）、不属于任何开放缺口的行业级对象，以及系统建议的下一步动作。它是只读投影：不会刷新研究状态，不会重新计算缺口 / 位置 / 优先级，也不写任何数据；没有对象、没有缺口、没有调研准备都是正常状态。当用户问「现在研究到哪了 / 下一步做什么 / 这个行业还缺什么」时使用。",
    promptSnippet: "查看研究计划",
    parameters: NameParam,
    async execute(_id, params: Static<typeof NameParam>) {
      const ind = repo.findIndustryByName(params.name);
      if (!ind) return json(`未找到行业「${params.name}」。`);
      const plans = deps.plans ?? new ResearchPlanService(repo.db);
      return json(JSON.stringify(plans.build(ind.industryId), null, 2));
    },
  });

  return [
    research_industry_ingest,
    research_industry_show,
    research_question_list,
    research_gap_list,
    research_next_action_list,
    research_state_show,
    research_pool_show,
    research_evaluate,
    research_priority,
    research_report,
    research_material_add,
    research_chain_show,
    research_need_list,
    research_target_list,
    research_diligence_show,
    research_plan_show,
    research_methodology_show,
    research_methodology_list,
    research_methodology_propose,
  ];
}
