import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { windQuery } from "../wind-bridge.js";

const Params = Type.Object({
  industry: Type.String({ description: "要查询的行业名称，如 人形机器人" }),
});

export const wind_query = defineTool({
  name: "wind_query",
  label: "Wind 行业指标",
  description: "通过 wind_query.py 查询某行业的市场规模、增速、上市公司数、PE、头部玩家；WindPy 不可用时自动 mock 降级。",
  promptSnippet: "查询行业市场规模/增速/估值/头部玩家",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>) {
    const data = await windQuery({ industry: params.industry });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      details: { industry: params.industry, source: data.source },
    };
  },
});
