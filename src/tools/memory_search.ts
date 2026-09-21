import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { memorySearch } from "../store.js";

const Params = Type.Object({
  query: Type.String({ description: "检索关键词" }),
  limit: Type.Optional(Type.Number({ description: "返回条数上限，默认 5" })),
});

export const memory_search = defineTool({
  name: "memory_search",
  label: "记忆检索",
  description: "对储备库行业与已录入材料做关键词检索（无 embedding 时关键词打分），用于召回历史证据与档案。",
  promptSnippet: "检索储备库/材料库历史证据",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>) {
    const hits = memorySearch(params.query, params.limit ?? 5);
    return {
      content: [{ type: "text", text: JSON.stringify(hits, null, 2) }],
      details: { query: params.query, count: hits.length },
    };
  },
});
