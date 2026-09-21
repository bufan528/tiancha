import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { writeProfile, upsertIndustry } from "../store.js";

const Params = Type.Object({
  industry: Type.String({ description: "行业名称" }),
  profile_md: Type.String({ description: "更新后的行业档案 markdown 全文" }),
  status: Type.Optional(Type.String({ description: "入池状态：reserve/watch/parked" })),
  grade: Type.Optional(Type.String({ description: "评级 A/B/C/D" })),
  score: Type.Optional(Type.Number({ description: "0-100 总分" })),
});

export const profile_write = defineTool({
  name: "profile_write",
  label: "写入行业档案",
  description: "更新某行业档案 markdown 并记录变更历史；可同时更新入池状态/评级/总分（不覆盖历史评分留痕）。",
  promptSnippet: "写入/更新行业档案与评级",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>) {
    writeProfile(params.industry, params.profile_md);
    const patch: Record<string, unknown> = { name: params.industry, updatedAt: new Date().toISOString().slice(0, 10) };
    if (params.status) patch.status = params.status;
    if (params.grade) patch.grade = params.grade;
    if (typeof params.score === "number") patch.score = params.score;
    upsertIndustry(patch);
    return {
      content: [{ type: "text", text: `已写入 ${params.industry} 档案（${params.profile_md.length} 字符）` }],
      details: { industry: params.industry, bytes: params.profile_md.length },
    };
  },
});
