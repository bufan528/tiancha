import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { ROOT } from "./store.js";
import investExtension from "./invest-extension.js";
import { wind_query } from "./tools/wind_query.js";
import { memory_search } from "./tools/memory_search.js";
import { profile_read } from "./tools/profile_read.js";
import { profile_write } from "./tools/profile_write.js";
import { material_ingest } from "./tools/material_ingest.js";
import { pool_list } from "./tools/pool_list.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const INVEST_SYSTEM_PROMPT = `你是「投研工作台」的一级市场投研助手。

# 人设
你服务于早期投资团队，负责行业识别、七维评分、调研提纲/报告撰写与研究规划。回答必须结构化、结论可追溯。

# 六环节工作流
1. 信息召回：先用 memory_search 检索历史证据，必要时 wind_query 取行业指标。
2. 行业评分：严格按 config/scoring.json 的七维权重与锚点打分（市场空间与增速20/政策15/竞争15/技术15/商业化15/退出10/风险逆向10），输出 0-100 总分与 A/B/C/D 评级。
3. 档案维护：用 profile_read / profile_write 维护行业档案，不覆盖历史评分留痕。
4. 资料录入：用 material_ingest 把研报/网页切块入材料库。
5. 提纲/报告：生成实地调研提纲或调研报告，末尾必须有「自检」小节。
6. 规划：用 pool_list 盘点储备库，给出研究规划建议。

# 质量要求
- 所有结论必须标注来源（研报标题 / Wind 字段 / 材料库 id）。
- 评分必须引用当前 scoring.json 的锚点描述，保证「改配置即改打分口径」。
- 报告/规划类交付物末尾必须有「自检」小节：事实一致性、逻辑完整性、依据充分性。
- Windows 环境，不要尝试调用 bash；可用工具为 wind_query / memory_search / profile_read / profile_write / material_ingest / pool_list。
`;

export interface InvestAgent {
  session: AgentSession;
  modelLabel: string;
}

let cached: InvestAgent | null = null;

export async function initInvestAgent(): Promise<InvestAgent> {
  if (cached) return cached;

  const cwd = ROOT;
  const agentDir = join(ROOT, ".pi");

  // 1) 服务：用进程内 extensionFactories 注册 doubao + offline-mock（不再运行时 jiti 动态加载 .ts）
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: {
      extensionFactories: [investExtension],
      systemPromptOverride: () => INVEST_SYSTEM_PROMPT,
    },
  });

  // 2) 选模型：有 DOUBAO_API_KEY 用 doubao，否则离线演示
  const hasKey = !!process.env.DOUBAO_API_KEY;
  const doubaoId = process.env.DOUBAO_MODEL ?? "doubao-seed-1-6-250615";
  let model = hasKey ? services.modelRuntime.getModel("doubao", doubaoId) : undefined;
  if (!model) {
    model = services.modelRuntime.getModel("offline-mock", "offline-demo");
  }
  if (!model) {
    throw new Error("未找到可用模型：请检查 src/invest-extension.ts 是否已注册 provider");
  }

  // 3) 会话：仅启用自定义投研工具（Windows 用 noTools:builtin 关掉内置 bash/edit/write，保留自定义工具）
  const sessionManager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    model,
    noTools: "builtin",
    customTools: [wind_query, memory_search, profile_read, profile_write, material_ingest, pool_list],
  });

  await session.bindExtensions({
    mode: "print",
    onError: (err: any) => {
      console.error("[extension-error]", err?.message ?? err);
    },
  });

  cached = { session, modelLabel: `${model.provider}/${model.id}` };
  console.log(`[agent] 就绪，模型=${cached.modelLabel}${hasKey ? "" : "（offline-mock，无 DOUBAO_API_KEY）"}`);
  return cached;
}
