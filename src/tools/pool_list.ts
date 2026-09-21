import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { listPool } from "../store.js";

const Params = Type.Object({
  status: Type.Optional(Type.String({ description: "按状态过滤：reserve/watch/parked；缺省返回全部" })),
});

export const pool_list = defineTool({
  name: "pool_list",
  label: "储备库列表",
  description: "列出储备库行业（名称/评分/评级/状态/更新时间）。",
  promptSnippet: "列出储备库行业及评分",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>) {
    const rows = listPool(params.status);
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      details: { count: rows.length, status: params.status ?? "all" },
    };
  },
});
