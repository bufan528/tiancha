import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Message,
  type Model,
  type TranscriptContext,
} from "@earendil-works/pi-ai";

/**
 * 进程内投研扩展工厂（不再由 jiti 运行时动态加载 .ts 文件）：
 *  - doubao：火山方舟 OpenAI 兼容端点，apiKey 取自 $DOUBAO_API_KEY
 *  - offline-mock：本地确定性 streamSimple，按用户消息意图分流到五类模板
 */

function emptyUsage() {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function lastRole(messages: Message[]): string | undefined {
  return messages[messages.length - 1]?.role;
}

function userText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      return typeof m.content === "string"
        ? m.content
        : m.content.map((c: any) => (c && typeof c.text === "string" ? c.text : "")).join(" ");
    }
  }
  return "";
}

function newAssistant(model: Model<any>): AssistantMessage {
  return {
    role: "assistant", content: [], api: model.api, provider: model.provider,
    model: model.id, usage: emptyUsage(), stopReason: "pending", timestamp: Date.now(),
  };
}

/* 从 data/pool/industries.json 读已入池行业名，失败则用内置兜底词表 */
let cachedPoolNames: string[] | null = null;
function poolIndustryNames(): string[] {
  if (cachedPoolNames) return cachedPoolNames;
  const fallback = ["人形机器人", "固态电池", "低空经济", "储能", "合成生物", "商业航天", "脑机接口"];
  try {
    const raw = readFileSync(join(process.cwd(), "data", "pool", "industries.json"), "utf8");
    const arr = JSON.parse(raw) as { name?: string }[];
    const names = arr.map((x) => (x && typeof x.name === "string" ? x.name.trim() : "")).filter(Boolean);
    cachedPoolNames = names.length ? names : fallback;
  } catch {
    cachedPoolNames = fallback;
  }
  // 长名优先，避免短词误命中
  return [...cachedPoolNames].sort((a, b) => b.length - a.length);
}

/* ---------------- 行业抽取与意图分类 ---------------- */
function extractIndustry(text: string): string {
  // 1) 与 pool 已有行业名做包含匹配，命中即用（长名优先）
  for (const k of poolIndustryNames()) {
    if (k && text.includes(k)) return k;
  }
  // 2) 命中不到：中性占位；公司类语境用「该公司」，否则「该行业」
  //    绝不贪婪切词，避免把「帮我/撰写/调研/报告」等动作词片段当行业名
  return /公司|企业|标的|项目|团队/.test(text) ? "该公司" : "该行业";
}

type Intent = "score" | "outline" | "report" | "planning" | "qa";

function classifyIntent(text: string): Intent {
  if (/提纲|实地调研|访谈|走访|尽调问题|尽调/.test(text)) return "outline";
  if (/调研报告|撰写.*报告|写报告|生成报告/.test(text)) return "report";
  if (/研究规划|储备库|优先级|排期|做规划|规划/.test(text)) return "planning";
  if (/评分|打分|评级/.test(text)) return "score";
  return "qa";
}

function planToolCalls(intent: Intent, industry: string): { name: string; args: Record<string, unknown> }[] {
  switch (intent) {
    case "score":
      return [
        { name: "memory_search", args: { query: industry, limit: 5 } },
        { name: "wind_query", args: { industry } },
        { name: "profile_read", args: { industry } },
      ];
    case "outline":
      return [
        { name: "memory_search", args: { query: industry, limit: 5 } },
        { name: "profile_read", args: { industry } },
      ];
    case "report":
      return [
        { name: "memory_search", args: { query: industry, limit: 5 } },
        { name: "wind_query", args: { industry } },
        { name: "profile_read", args: { industry } },
      ];
    case "planning":
      return [
        { name: "pool_list", args: {} },
        { name: "memory_search", args: { query: "储备库 优先级", limit: 5 } },
      ];
    default:
      return [
        { name: "memory_search", args: { query: industry, limit: 5 } },
        { name: "profile_read", args: { industry } },
      ];
  }
}

/* ---------------- 五类回复模板 ---------------- */
function tplScore(ind: string): string {
  return [
    `## 行业评分 · ${ind}（offline-mock）`,
    ``,
    `已结合 Wind 行业指标与材料库证据，按 config/scoring.json 七维权重打分如下：`,
    ``,
    `| 维度 | 子分(0-10) | 依据 |`,
    `|---|---|---|`,
    `| 市场空间与增速(20%) | 8 | TAM 数百亿级，未来 3 年 CAGR 约 20% |`,
    `| 政策与监管环境(15%) | 8 | 国家战略鼓励、监管口径清晰 |`,
    `| 竞争格局与壁垒(15%) | 6 | 头部初现但仍有混战，壁垒未稳固 |`,
    `| 技术成熟度与趋势(15%) | 7 | 路线确定，仍有代际迭代 |`,
    `| 商业化与产业链(15%) | 7 | 标杆客户落地，尚未规模放量 |`,
    `| 退出与资本环境(10%) | 7 | 科创板/港股通道可预期 |`,
    `| 风险因素(逆向,10%) | 6 | 量产/需求证伪风险中等 |`,
    ``,
    `**加权总分 ≈ 71 / 100，评级 B（重点关注）**，建议进入 reserve 持续跟踪。`,
    ``,
    `### 来源标注`,
    `- Wind：市场规模/增速/PE（mock 字段）`,
    `- 材料库：memory_search 命中历史研报`,
    `- 评分口径：config/scoring.json 锚点`,
    ``,
    `### 自检`,
    `- 事实一致性：每维均锚定证据，缺证据维度按中性处理。`,
    `- 逻辑完整性：七维齐全，加权求和可复算。`,
    `- 依据充分性：二级证据为主，一手访谈待补。`,
  ].join("\n");
}

function tplOutline(ind: string): string {
  return [
    `## 实地调研提纲 · ${ind}（offline-mock）`,
    ``,
    `> 用途：FA/投资经理尽调访谈。每条标注「想验证的假设 → 问题」。`,
    ``,
    `### 一、行业与市场`,
    `1. [真实需求] 下游客户过去 12 个月的实际采购量与复购如何？`,
    `2. [TAM] 当前可服务市场（SAM）口径是什么？乐观/中性/保守情景各多少？`,
    `3. [增速] 行业增速的真实驱动来自存量替代还是新增需求？`,
    `4. [周期] 当前处于渗透率曲线的哪个位置（0-5% / 5-15%）？`,
    `5. [季节性/区域性] 订单是否集中于某季度或某区域？`,
    ``,
    `### 二、技术与产品`,
    `1. [路线] 主流技术路线为何胜出？是否存在被替代的第二代路线？`,
    `2. [良率] 当前量产良率/一致性指标？良率爬坡曲线如何？`,
    `3. [代际] 核心专利与 know-how 壁垒在何处？绕开难度？`,
    `4. [研发] 研发团队规模、在研管线与里程碑？`,
    `5. [BOM] 关键零部件自供 vs 外采比例？单台 BOM 成本下降曲线？`,
    ``,
    `### 三、商业化与客户`,
    `1. [付费意愿] 标杆客户是谁？采购决策链条与预算科目？`,
    `2. [客单价] 平均客单价、销售周期、续费/复购率？`,
    `3. [毛利] 产品毛利率与交付/服务成本占比？`,
    `4. [渠道] 直销 vs 渠道？获客成本（CAC）与回收周期？`,
    `5. [案例] 是否有可对外披露的标杆项目 ROI 数据？`,
    ``,
    `### 四、竞争格局`,
    `1. [份额] 前三大玩家市占率？本公司排名与差距？`,
    `2. [差异化] 相对头部的核心差异（成本/性能/场景/客户绑定）？`,
    `3. [新进入者] 产业链上下游是否在向下/向上延伸切入？`,
    `4. [护城河] 客户切换成本、牌照、资源稀缺性？`,
    ``,
    `### 五、团队与治理`,
    `1. [背景] 创始团队相关履历与过往创业/产业化成果？`,
    `2. [股权] 当前股权结构、期权池、历史代持/对赌是否清晰？`,
    `3. [核心人依赖] 技术/销售是否高度依赖个人？`,
    `4. [治理] 董事席位、重大决策机制、信息披露意愿？`,
    ``,
    `### 六、财务与运营`,
    `1. [收入] 近三年收入结构、增速、应收账款与回款周期？`,
    `2. [现金流] 经营性现金流、现金储备、可支撑月数？`,
    `3. [融资] 历轮估值、投资人、本轮投后预期与资金用途？`,
    `4. [产能] 产能利用率、扩产计划与资本开支节奏？`,
    ``,
    `### 七、合规与政策`,
    `1. [监管] 是否处于监管收紧或鼓励类目录？资质牌照要求？`,
    `2. [出口/数据] 是否涉及出口管制、数据合规、网络安全审查？`,
    `3. [补贴] 收入中政府补贴/订单占比？政策退坡敏感性？`,
    ``,
    `### 自检`,
    `- 事实一致性：提纲聚焦本行业弱证据维度（量产良率、客户付费）。`,
    `- 逻辑完整性：行业/技术/商业/竞争/团队/财务/政策七模块无缺。`,
    `- 可执行性：每条均有明确判据，建议访谈对象（创始人/客户/供应商/专家）。`,
  ].join("\n");
}

function tplReport(ind: string): string {
  return [
    `## 行业调研报告 · ${ind}（offline-mock）`,
    ``,
    `### 摘要与核心结论`,
    `${ind}处于从样机/PoC 向小规模量产过渡的窗口。初步判断中长期高成长，但短期商业化受制于成本与场景闭环。**投资建议：B 级重点关注，建议安排供应链与标杆客户尽调后再定档。**`,
    ``,
    `### 行业空间与增速`,
    `- 2025 年全球出货约 2.5 万台，中国占比约 35%（Wind mock）。`,
    `- 未来 3 年出货 CAGR 预计 >40%，2030 年乐观情形突破百万台量级。`,
    ``,
    `### 产业链与竞争`,
    `- 价值量集中于执行器（无刷电机、行星滚柱丝杠、减速器）与控制系统。`,
    `- 国内整机格局未定，国产化率提升是核心主线；海外玩家主导高端叙事。`,
    ``,
    `### 技术与产品`,
    `- 整机技术路线趋于收敛，AI 大模型驱动的运动/操作能力是主要变量。`,
    `- 单台 BOM 仍在数十万元区间，降本曲线决定放量节奏。`,
    ``,
    `### 商业化与落地`,
    `- 汽车厂、物流等 ToB 场景率先闭环；ToC 付费意愿未被验证。`,
    `- 标杆客户已落地，但复购与采购节奏仍需一手确认。`,
    ``,
    `### 团队与风险`,
    `- 风险：量产良率/成本不及预期、头部客户集中、技术替代。`,
    `- 团队履历、股权清晰度与核心人依赖需尽调确认。`,
    ``,
    `### 投资建议`,
    `- 评级 B（71 分），进入 reserve；优先走访 1-2 家核心零部件供应商与 1 家集成客户。`,
    ``,
    `### 来源标注`,
    `- Wind：市场规模/增速/PE（mock）`,
    `- 材料库：memory_search 命中研报与笔记`,
    `- 评分：config/scoring.json 七维模型`,
    ``,
    `### 自检`,
    `- 事实一致性：数据与档案、材料库一致。`,
    `- 逻辑完整性：证据→分析→结论链条闭合。`,
    `- 依据充分性：关键结论以二级证据为主，一手访谈列入下一步。`,
  ].join("\n");
}

function tplPlanning(ind: string): string {
  return [
    `## 研究规划（offline-mock）`,
    ``,
    `### 一、储备库现状盘点`,
    `- reserve：人形机器人（A/84，待深度尽调）`,
    `- watch：固态电池（C/58，等待量产爬坡证据）`,
    `- 其他候选：${ind}、低空经济、合成生物（证据不足）`,
    ``,
    `### 二、行业优先级排序（含理由）`,
    `1. **人形机器人（P0）**：A 级、成长确定性高、供应链投资主线清晰，证据缺口在量产成本与客户付费。`,
    `2. **固态电池（P1）**：C 级但政策/产业催化密集，需补量产良率与降本证据。`,
    `3. **${ind}（P2）**：初步识别，先做桌面研究与专家访谈，暂不投入尽调预算。`,
    ``,
    `### 三、分阶段时间表`,
    `- **近 1 个月**：完成人形机器人供应链走访提纲（见 outline）；固态电池更新评分证据。`,
    `- **本季度**：人形机器人 1-2 家零部件供应商 + 1 家集成客户尽调，出具完整调研报告。`,
    `- **半年内**：${ind}桌面研究结论；判断是否升级入 reserve 或归档 parked。`,
    ``,
    `### 四、资源与分工建议`,
    `- 投资经理：主导人形机器人尽调与结论定档。`,
    `- 行业研究员：维护材料库与档案评分留痕。`,
    `- FA/外部专家：补充技术路线与客户侧交叉验证。`,
    ``,
    `### 自检`,
    `- 事实一致性：优先级基于 pool_list 真实状态。`,
    `- 逻辑完整性：覆盖 reserve/watch/候选三类的下一步。`,
    `- 可执行性：每项有明确产出物与验收标准。`,
  ].join("\n");
}

function tplQA(ind: string): string {
  return [
    `## 行业档案与资料摘要 · ${ind}（offline-mock）`,
    ``,
    `根据材料库检索与行业档案，${ind}当前要点：`,
    `- 入池状态：reserve（A/84，核心储备）。`,
    `- 市场：TAM 数百亿级、CAGR 约 20%（Wind mock）。`,
    `- 风险：量产成本与客户付费节奏需一手验证。`,
    `- 历史证据：材料库已收录相关研报与笔记，可在「材料库」页查看。`,
    ``,
    `如需进一步操作，可对我说：「给${ind}打分」「写实地调研提纲」「写调研报告」「做研究规划」。`,
    ``,
    `### 自检`,
    `- 事实一致性：摘要与 profile_read 档案一致。`,
    `- 逻辑完整性：状态/市场/风险/证据四要素齐全。`,
    `- 依据充分性：引用材料库与 Wind mock 来源。`,
  ].join("\n");
}

function buildReply(intent: Intent, ind: string): string {
  switch (intent) {
    case "score": return tplScore(ind);
    case "outline": return tplOutline(ind);
    case "report": return tplReport(ind);
    case "planning": return tplPlanning(ind);
    default: return tplQA(ind);
  }
}

/* ---------------- streamSimple ---------------- */
function streamOfflineMock(model: Model<any>, context: TranscriptContext): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output = newAssistant(model);
  const messages = context.messages ?? [];
  const role = lastRole(messages);
  const text = userText(messages);
  const ind = extractIndustry(text);
  const intent = classifyIntent(text);

  (async () => {
    stream.push({ type: "start", partial: output });

    if (role === "toolResult") {
      const reply = buildReply(intent, ind);
      output.content.push({ type: "text", text: reply });
      stream.push({ type: "text_start", contentIndex: 0, partial: output });
      const chunks = reply.match(/.{1,16}/gs) ?? [reply];
      for (const c of chunks) stream.push({ type: "text_delta", contentIndex: 0, delta: c, partial: output });
      stream.push({ type: "text_end", contentIndex: 0, content: reply, partial: output });
      output.stopReason = "stop";
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
      return;
    }

    const calls = planToolCalls(intent, ind);
    let idx = 0;
    for (const call of calls) {
      const block: any = { type: "toolCall", id: `call_${Date.now()}_${idx++}`, name: call.name, arguments: call.args };
      output.content.push(block);
      stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
      stream.push({ type: "toolcall_end", contentIndex: output.content.length - 1, toolCall: block, partial: output });
    }
    output.stopReason = "toolUse";
    stream.push({ type: "done", reason: "toolUse", message: output });
    stream.end();
  })();

  return stream;
}

export default function investExtension(pi: ExtensionAPI) {
  pi.registerProvider("doubao", {
    name: "豆包",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: "$DOUBAO_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: process.env.DOUBAO_MODEL ?? "doubao-seed-1-6-250615",
        name: "豆包",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 256000,
        maxTokens: 8192,
      },
    ],
  });

  pi.registerProvider("offline-mock", {
    name: "离线演示",
    baseUrl: "http://127.0.0.1/offline-mock",
    apiKey: "offline",
    api: "openai-completions",
    models: [
      {
        id: "offline-demo",
        name: "Offline Mock（确定性演示）",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
    streamSimple: streamOfflineMock,
  });
}
