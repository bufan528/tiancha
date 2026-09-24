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

export interface ResearchToolDeps {
  repo: ResearchRepository;
  service: OpportunityDiscoveryService;
  methodology: MethodologyService;
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
  const { repo, service, methodology } = deps;

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

  return [
    research_industry_ingest,
    research_industry_show,
    research_question_list,
    research_gap_list,
    research_next_action_list,
    research_state_show,
    research_methodology_show,
    research_methodology_list,
    research_methodology_propose,
  ];
}
