import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { getIndustry, readProfile } from "../store.js";

const Params = Type.Object({
  industry: Type.String({ description: "行业名称" }),
});

export const profile_read = defineTool({
  name: "profile_read",
  label: "读取行业档案",
  description: "读取某行业的档案 markdown 与入池状态、历史评分留痕。",
  promptSnippet: "读取行业档案与评分历史",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>) {
    const ind = getIndustry(params.industry);
    const profile = readProfile(params.industry);
    const out = {
      industry: params.industry,
      pool: ind ?? null,
      profileMd: profile?.md ?? "",
      history: profile?.history ?? [],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      details: { industry: params.industry, hasProfile: !!profile },
    };
  },
});
