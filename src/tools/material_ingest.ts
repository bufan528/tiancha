import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { addMaterial } from "../store.js";

const Params = Type.Object({
  source_type: Type.String({ description: "来源类型：report / webpaste / url / note" }),
  content: Type.String({ description: "资料正文文本（粘贴文本或 URL 抓取结果）" }),
  title: Type.Optional(Type.String({ description: "资料标题" })),
  industry: Type.Optional(Type.String({ description: "关联行业" })),
});

export const material_ingest = defineTool({
  name: "material_ingest",
  label: "录入资料",
  description: "把研报片段/网页粘贴/笔记切块入材料库，供后续检索与评分引用。",
  promptSnippet: "录入研报/网页/笔记到材料库",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>) {
    const item = addMaterial({
      sourceType: params.source_type,
      title: params.title ?? "(未命名)",
      industry: params.industry ?? null,
      content: params.content,
    });
    return {
      content: [{ type: "text", text: `已录入材料 ${item.id}：${item.title}（${params.content.length} 字）` }],
      details: { id: item.id, sourceType: params.source_type },
    };
  },
});
