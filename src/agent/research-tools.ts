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

export interface ResearchToolDeps {
  repo: ResearchRepository;
  service: OpportunityDiscoveryService;
}

function json(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

const NameParam = Type.Object({
  name: Type.String({ description: "行业标准名（canonical name），如：人形机器人" }),
});

export function buildResearchTools(deps: ResearchToolDeps) {
  const { repo, service } = deps;

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
        pool: repo.listPoolEntries(ind.industryId).length,
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

  return [
    research_industry_ingest,
    research_industry_show,
    research_question_list,
    research_gap_list,
    research_next_action_list,
    research_state_show,
  ];
}
