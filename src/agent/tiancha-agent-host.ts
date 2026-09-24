/**
 * TianchaAgentHost — Phase 2B product entry.
 *
 * Single shared assembly used by BOTH the interactive REPL (no args) and
 * `tiancha ask "<prompt>"`. There is exactly ONE AgentSession lifecycle, ONE
 * set of custom research tools, ONE system prompt. IO shape differs only.
 *
 * Red lines:
 *  - Does NOT build a second agent loop / session / reducer. It calls the
 *    standard Pi session chain: createAgentSessionServices -> createAgentSessionFromServices.
 *  - Does NOT do keyword intent routing. The main model semantically chooses
 *    among the injected research tools.
 *  - Does NOT query SQLite itself to answer users; tools delegate to the
 *    Application/Repository layer.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import * as readline from "node:readline";
import {
  createAgentSessionServices,
  createAgentSessionFromServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  ResearchDb,
  ResearchRepository,
  SqliteArtifactStore,
  EchoDataProvider,
  OpportunityDiscoveryService,
  MethodologyService,
  PriorityService,
  ReportService,
  MaterialIngestService,
  TargetService,
  ResearchNeedService,
  QuestionTargetFitService,
  DiligencePreparationService,
} from "@tiancha/research";
import { buildResearchTools } from "./research-tools.js";

const TIANCHA_SYSTEM_PROMPT = `你是「天查」，一个面向一级市场投资研究的个人研究助手。

你的工作方式：像一个懂行的研究伙伴那样和用户用自然语言对话，帮助用户发现行业机会、梳理已知与未知、规划下一步研究。

你可以调用以下研究工具来管理研究记忆（由主模型根据用户语义自行决定何时调用，不要机械匹配关键词）：
- research_industry_ingest：把一段行业材料纳入研究系统
- research_industry_show / research_state_show：查看某行业研究概况与认知状态
- research_question_list：列出在研究什么问题
- research_gap_list：列出还有哪些没搞清
- research_next_action_list：列出系统建议的下一步
- research_pool_show：查看信息池槽位与条目（现在知道什么）
- research_evaluate：查看已落库的投资评估（覆盖度与各维度状态）
- research_priority：查看研究优先级（下一步应当先补哪个缺口）
- research_report：生成只读的研究报告投影
- research_chain_show：查看调研链条（当前方法论建议从哪些产业链位置获取信息、建议研究哪类对象）
- research_need_list：列出研究需求（每条缺口为什么需要调研而不只是抓数据）
- research_target_list：列出已由人确认的研究对象及其只读适配概况
- research_diligence_show：查看已生成的调研准备（目的、提问清单、提醒）

重要边界：
1. 当前连接的是占位数据源（echo/placeholder，非真实外部数据）。绝不能据此给出"值得投资/不值得/打多少分"这类真实价值判断。
2. 回复要自然、有结构（可用小标题或列表），主动区分"已建立的研究框架"与"尚未被真实数据验证的内容"。
3. 禁止向用户暴露内部实现：不要输出 Intent 标签、ResearchState 的原始 JSON、TaskGraph、工具名、service 名或任何内部模型转储。
4. 如果信息不足或用户表述含糊，可以追问，但不要编造数字。
5. 解读评估结果时，"证据不足"只表示该维度信息不足，不等于对该行业的负面判断；不要把"证据不足"讲成"不看好"之类的结论，也不要把系统输出表述成投资建议。
6. 你只能查看研究状态、不能改变它：不要声称自己触发了评估、优先级或报告之外的任何写入；报告是只读投影，不改变研究数据。
7. 调研链条与可研究的位置是「建议研究哪类对象」，不是具体公司/专家名单；具体调研对象必须由人确认后录入（你没有录入对象的工具），不要自行编造任何公司名、专家名或机构名，也不要声称已经选定对象。
8. 用自然语言总结，不要直接粘贴工具返回的 JSON 原始内容。`;

export class TianchaAgentHost {
  private constructor(private readonly session: AgentSession) {}

  static async create(): Promise<TianchaAgentHost> {
    configureTianchaAgentDir();
    const cwd = process.cwd();
    const agentDir = join(homedir(), ".tiancha", "agent");
    const { dbPath, artifactDbPath } = foundationPaths();

    const db = new ResearchDb({ path: dbPath });
    const artifacts = new SqliteArtifactStore({ path: artifactDbPath });
    const repo = new ResearchRepository(db.db);
    const service = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
    const methodology = new MethodologyService(repo);
    // S7: the shared assembly also exposes the READ-ONLY priority face and the report
    // projection generator. The Agent deliberately gets NO EvaluationService — it can
    // never append an InvestmentEvaluation (R3: only a human running the CLI may).
    const customTools = buildResearchTools({
      repo,
      service,
      methodology,
      priority: new PriorityService(db.db),
      reports: new ReportService(db.db),
      materials: new MaterialIngestService(repo, new EchoDataProvider(), artifacts),
      // B5: READ-ONLY exposure of the chain / needs / confirmed targets / preparations.
      // No ChainProjectionService is injected: the Agent never projects a chain, and the
      // TargetService here is read-only in practice (there is NO target-write tool).
      targets: new TargetService(db.db),
      needs: new ResearchNeedService(db.db),
      fits: new QuestionTargetFitService(db.db),
      diligence: new DiligencePreparationService(db.db),
    });

    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        systemPrompt: TIANCHA_SYSTEM_PROMPT,
        noSkills: true,
        noExtensions: true,
      },
    });
    const sessionManager = SessionManager.inMemory(cwd);
    const result = await createAgentSessionFromServices({
      services,
      sessionManager,
      noTools: "builtin",
      customTools,
    });
    return new TianchaAgentHost(result.session);
  }

  /** Single non-interactive turn. Returns the assistant's final text. */
  async askOneShot(prompt: string): Promise<string> {
    const captured: string[] = [];
    const unsub = this.session.subscribe((ev: any) => {
      if (ev?.type === "agent_end" && Array.isArray(ev.messages)) {
        const last = [...ev.messages].reverse().find((m: any) => m?.role === "assistant");
        const text = extractText(last);
        if (text) captured.push(text);
      }
    });
    try {
      await this.session.prompt(prompt);
    } finally {
      unsub();
    }
    return captured.join("\n").trim() || "(no response)";
  }

  /** Interactive REPL. Blocks on stdin until exit/quit/Ctrl+C. */
  async startInteractive(): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "天查> " });
    console.log("天查 · 一级市场投资研究助手（输入 exit 退出）");
    rl.prompt();
    for await (const line of rl) {
      const input = line.trim();
      if (!input) { rl.prompt(); continue; }
      if (input === "exit" || input === "quit") { break; }
      try {
        const reply = await this.askOneShot(input);
        console.log(reply);
      } catch (err) {
        console.error("（处理出错）", (err as Error).message);
      }
      rl.prompt();
    }
    rl.close();
  }
}

function configureTianchaAgentDir(): void {
  if (!process.env.PI_CODING_AGENT_DIR) {
    process.env.PI_CODING_AGENT_DIR = join(homedir(), ".tiancha", "agent");
  }
}

function foundationPaths() {
  const root = join(homedir(), ".tiancha");
  return {
    dbPath: join(root, "db", "tiancha.sqlite"),
    artifactDbPath: join(root, "db", "artifacts.sqlite"),
  };
}

function extractText(msg: any): string {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.filter((b: any) => b?.type === "text" && b?.text).map((b: any) => b.text).join("\n");
  }
  return "";
}
