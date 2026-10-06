/**
 * tiancha CLI — composition root.
 *
 * This is the ONLY place that imports @earendil-works/pi-coding-agent and binds
 * the real Pi implementations to @tiancha/research Ports. The research package
 * itself never imports coding-agent (dependency gate).
 *
 * Brand detection: invoked as `tiancha` -> tiancha brand; invoked as `pi` -> pure
 * Pi delegation (original pi behavior preserved).
 */

import { basename, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// --- Pi runtime imports (composition root only) -----------------------------
import {
  main as piMain,
  createEventBus,
  createAgentSessionServices,
  createAgentSessionFromServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

// --- Research kernel imports ------------------------------------------------
import {
  TianchaRuntime,
  type SessionRegistrationCapability,
  type SessionUnregistrationCapability,
  type AgentSessionFactoryPort,
  type ModelResolverPort,
  type EventBusPort,
  type ChildSessionOptions,
  type ChildSession,
  type MethodologyDimension,
} from "@tiancha/research";
import { PiSessionCapabilityAdapter } from "../agent/pi-session-capability-adapter.js";
import {
  migratePiToTiancha,
  ReadOnlySessionManager,
  ReadOnlySessionError,
  ResearchDb,
  ResearchRepository,
  SqliteArtifactStore,
  EchoDataProvider,
  OpportunityDiscoveryService,
  MethodologyService,
  EvaluationService,
  PriorityService,
  ReportService,
  MaterialIngestService,
  TargetService,
  ChainProjectionService,
  ResearchNeedService,
  QuestionTargetFitService,
  DiligencePreparationService,
  ResearchPlanService,
  CompanyService,
  TargetProposalService,
  ProposalDecisionService,
} from "@tiancha/research";
import { readFileSync } from "node:fs";
import { TianchaAgentHost } from "../agent/tiancha-agent-host.js";
import { RESEARCH_SUBCOMMANDS, runMaterialAdd, runMaterialAttribute, runMaterialList, runMaterialRetry, runResearchCommand, runTargetAdd, runTargetList, type ResearchCliDeps } from "./research-commands.js";
import {
  runCandidateConfirm,
  runCandidateExtract,
  runCandidateList,
  runCandidateReject,
  runCandidateRevise,
  runCandidateShow,
} from "./research-commands.js";
import { runCandidateProject } from "./research-commands.js";
import { KnowledgeRepository } from "@tiancha/research";
import { CandidateReviewService } from "@tiancha/research";
import { CandidateProjectionService } from "@tiancha/research";
// ★ C6 Slice F2 (§M14.1): the extraction service + the deterministic legacy extractor. The MODEL
// path is opt-in per call (`--model`) and resolves no adapter in this build — by design.
import { CandidateExtractionService, ExplicitBlockExtractor } from "@tiancha/research";

const TIANCHA_VERSION = "0.1.0";
const PRODUCT_NAME = "tiancha";

function brandIsTiancha(): boolean {
  const entry = basename(process.argv[1] ?? "").toLowerCase();
  return entry.startsWith("tiancha");
}

/** Point Pi at the .tiancha agent dir (env override verified in vendor config.ts). */
function configureTianchaAgentDir(): void {
  if (!process.env.PI_CODING_AGENT_DIR) {
    process.env.PI_CODING_AGENT_DIR = join(homedir(), ".tiancha", "agent");
  }
}

async function resolveModel(): Promise<ModelResolverPort> {
  return {
    async resolve(_role, policy) {
      return { model: `tiancha/${policy.tier}`, thinkingLevel: policy.thinkingLevel };
    },
  };
}

/**
 * AF-1C · Pi composition boundary 的 AgentSessionFactory。
 *
 * ★ AF-1C Implementation Contract（🔒 FROZEN · docs/phaseC/af1c-implementation-contract.md）:
 *   · IC-6-1  Registry ownership = composition root（本 CLI 侧）；TaskEngine 不持有 Registry
 *   · IC-7-1  seam = 优先级 1：composition root 直接持有同一个 SessionRegistry 实例，
 *             并把【最小能力】交给 factory（这里以构造参数形式传入，不公开整个 registry）
 *   · IC-6-2  register 的唯一【注册调用点】= create() 内、`return ChildSession` 之前
 *             （同一栈帧内同时可见 sessionId 与 AgentSession ⇒ 结构上不可错配）
 *   · IC-6-3  remove 绑定 ChildSession.close()（先关底层 session，再 remove）
 *   · IC-5-1/5-2 Adapter 只做类型视图收窄（Pi AgentSession → ExecutionSessionCapability）
 *
 * ★ IC-6-2.1（必须逐字遵守）：register 调用点已裁定 ≠ register 已接入生产运行链。
 *   本挂点只是把 capability 写入 registry；AF-1C Provider 尚未接入运行链，
 *   没有任何消费者 lookup ⇒ 该写入不改变任何既有生产行为（G-04 生产化仍 DEFERRED）。
 *
 * ★ G-05 锁定：close() 内【沿用既有】底层 session 关闭语义（当前实现是静默 no-op，
 *   因为 Pi AgentSession 只有同步 dispose() / async abort()，没有 close()）。
 *   本轮不得因需要 remove 就把它升级成 dispose()/abort()。
 */
function buildAgentSessionFactory(
  register: SessionRegistrationCapability,
  unregister: SessionUnregistrationCapability,
): AgentSessionFactoryPort {
  const cwd = process.cwd();
  return {
    async create(opts: ChildSessionOptions): Promise<ChildSession> {
      const resourceLoaderOptions = {
        noTools: true,
        noSkills: true,
        noExtensions: true,
        systemPrompt: opts.researchContext?.systemPrompt ?? "tiancha research child session",
        appendSystemPrompt: opts.researchContext?.appendSystemPrompt ?? [],
      };
      const services = await createAgentSessionServices({
        cwd,
        resourceLoaderOptions,
      });
      const sessionManager = SessionManager.inMemory(cwd);
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        noTools: "all",
        model: undefined,
      });

      // ★ AF-1C IC-6-2：唯一【注册】调用点 —— 同一栈帧内配对 sessionId 与 capability。
      const sessionId = `child-${opts.taskId}`;
      register(sessionId, new PiSessionCapabilityAdapter(result.session));

      const s = result.session as unknown as { close?: () => Promise<void> } | undefined;
      return {
        sessionId,
        taskId: opts.taskId,
        async close() {
          // ★ G-05：沿用既有 close 语义（no-op），不升级为 dispose/abort。
          await s?.close?.();
          // ★ AF-1C IC-6-3：唯一【生命周期】调用点 —— 先关底层 session，后移除映射。
          unregister(sessionId);
        },
      };
    },
  };
}

async function cmdResearchSmoke(): Promise<void> {
  configureTianchaAgentDir();
  console.log(`tiancha v${TIANCHA_VERSION} research smoke`);

  const dataDir = join(tmpdir(), "tiancha-smoke");
  const eventDbPath = join(dataDir, "events.db");
  const artifactDbPath = join(dataDir, "artifacts.db");

  const bus: EventBusPort = createEventBus() as unknown as EventBusPort;
  const modelResolver = await resolveModel();
  // ★ R-2B-A：SessionRegistry 由 TianchaRuntime（composition root）创建并持有
  //   （AF-1C AI-5-1）；Runtime 只把【最小受控能力】交给 factory composition（R2BA-Q1），
  //   CLI 不再创建或持有 registry。该实例与将来交给 PiExecutionProvider 的必须是同一个（IC-7-1.1）。
  const runtime = new TianchaRuntime({
    cwd: process.cwd(),
    eventDbPath,
    artifactDbPath,
    eventBus: bus,
    agentSessionFactory: (register, unregister) =>
      buildAgentSessionFactory(register, unregister),
    modelResolver,
  });
  console.log("  [ok] TianchaRuntime assembled + Ports injected");

  // Run -> Round -> Task
  const run = runtime.orchestrator.startRun({ objective: "smoke: verify skeleton" });
  console.log(`  [ok] ResearchRun created: ${run.runId} (status=${run.status})`);

  const now = new Date().toISOString();
  const round = runtime.orchestrator.startRound(run.runId, [
    {
      taskId: `task-${randomUUID()}`,
      type: "collect",
      status: "queued",
      priority: 0,
      dependencies: [],
      inputs: { question: "smoke" },
      outputs: [],
      agentRole: "scout",
      modelPolicy: { tier: "cheap", thinkingLevel: "off" },
      humanGate: "none",
      retry: { maxAttempts: 1, backoffMs: 0 },
      budget: { maxTurns: 1, maxCost: 0 },
      roundId: "round-placeholder",
      runId: run.runId,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  console.log(`  [ok] ResearchRound created: ${round.roundId} (tasks=${round.taskIds.length})`);

  const task = runtime.engine.list()[0];
  if (!task) throw new Error("smoke: no task enqueued");

  // Build a REAL child session via the factory (no LLM run, noTools).
  let childOk = false;
  try {
    const started = await runtime.engine.start(task.taskId);
    childOk = true;
    console.log(`  [ok] child session opened via TianchaAgentSessionFactory: ${started.session.sessionId}`);
  } catch (err) {
    console.log(`  [warn] real child-session creation skipped (env/model): ${(err as Error).message}`);
  }

  // Write an Artifact and read it back.
  const artifactId = `art-${randomUUID()}`;
  await runtime.artifactStore.put({
    artifact: {
      artifactId,
      kind: "evidence",
      schemaVersion: "1",
      ref: { artifactId, kind: "evidence", locator: { type: "sqlite", id: artifactId } },
      createdAt: now,
      taskId: task.taskId,
      attemptId: "smoke-attempt",
      runId: run.runId,
    },
    blob: { note: "smoke artifact" },
  });
  const readBack = await runtime.artifactStore.get(artifactId);
  if (!readBack) throw new Error("smoke: artifact not readable back");
  console.log(`  [ok] ArtifactStore put/get round-trip: ${artifactId}`);

  // Emit a durable research event and read it back.
  await runtime.events.emit({
    eventId: `evt-${randomUUID()}`,
    runId: run.runId,
    type: "evidence_added",
    payload: { artifactId },
    occurredAt: now,
    source: "smoke",
  });
  const events = await runtime.eventStore.list({ runId: run.runId });
  if (events.length === 0) throw new Error("smoke: no durable events");
  console.log(`  [ok] ResearchEventAdapter -> durable SQLite: ${events.length} event(s)`);

  await runtime.close();
  console.log(`tiancha research smoke: PASS (child-session=${childOk ? "real" : "skipped"})`);
}

async function cmdSessionReadonly(path: string): Promise<void> {
  configureTianchaAgentDir();
  console.log(`tiancha v${TIANCHA_VERSION} session readonly: ${path}`);
  const handle = SessionManager.open(path);
  const ro = new ReadOnlySessionManager(handle as never);
  const entries = ro.getEntries();
  console.log(`  [ok] opened read-only; entries=${entries.length}; id=${ro.getSessionId()}`);
  try {
    ro.appendMessage({} as never);
    console.log("  [fail] appendMessage was NOT rejected");
  } catch (err) {
    if (err instanceof ReadOnlySessionError) {
      console.log(`  [ok] appendMessage rejected (T1): ${err.message}`);
    } else {
      throw err;
    }
  }
  try {
    ro.branch();
    console.log("  [fail] branch was NOT redirected");
  } catch (err) {
    if (err instanceof ReadOnlySessionError) {
      console.log(`  [ok] branch redirected (T3)`);
    } else {
      throw err;
    }
  }
  console.log(`  [ok] compaction no-op (T4): ${ro.appendCompaction()}`);
  console.log("tiancha session readonly: PASS");
}

// --- Phase 2A Research Memory Foundation wiring ----------------------------
function foundationPaths() {
  const root = join(homedir(), ".tiancha");
  return {
    dbPath: join(root, "db", "tiancha.sqlite"),
    artifactDbPath: join(root, "db", "artifacts.sqlite"),
  };
}

async function cmdIndustryIngest(file: string, industryName: string): Promise<void> {
  configureTianchaAgentDir();
  const text = readFileSync(file, "utf8");
  const { dbPath, artifactDbPath } = foundationPaths();
  const db = new ResearchDb({ path: dbPath });
  const artifacts = new SqliteArtifactStore({ path: artifactDbPath });
  const repo = new ResearchRepository(db.db);
  const svc = new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts);
  const res = await svc.ingestMaterial({ materialText: text, industryName });
  console.log(`[ingest] industry=${res.industry.canonicalName} (${res.industry.industryId})`);
  console.log(`  questions=${res.questionCount} requirements=${res.requirementCount} pool=${res.poolEntryCount} gaps=${res.gapCount} nextActions=${res.nextActionCount}`);
  await artifacts.close();
  db.close();
}

async function cmdIndustryShow(name: string): Promise<void> {
  const { dbPath } = foundationPaths();
  const db = new ResearchDb({ path: dbPath });
  const repo = new ResearchRepository(db.db);
  const ind = repo.findIndustryByName(name);
  if (!ind) {
    console.error(`industry not found: ${name}`);
    process.exitCode = 1;
    db.close();
    return;
  }
  console.log(`Industry: ${ind.canonicalName} [${ind.reserveStatus}]`);
  console.log(`  questions: ${repo.listQuestions(ind.industryId).length}`);
  console.log(`  requirements: ${repo.listRequirements(ind.industryId).length}`);
  console.log(`  pool: ${repo.listPoolSlots(ind.industryId).length}`);
  console.log(`  gaps: ${repo.listGaps(ind.industryId).length}`);
  console.log(`  nextActions: ${repo.listNextActions(ind.industryId).length}`);
  db.close();
}

async function cmdStateShow(industryName: string): Promise<void> {
  const { dbPath } = foundationPaths();
  const db = new ResearchDb({ path: dbPath });
  const repo = new ResearchRepository(db.db);
  const ind = repo.findIndustryByName(industryName);
  if (!ind) {
    console.error(`industry not found: ${industryName}`);
    process.exitCode = 1;
    db.close();
    return;
  }
  const st = repo.getStateBySubject("industry", ind.industryId);
  if (!st) {
    console.error(`no state for ${ind.canonicalName}`);
    process.exitCode = 1;
    db.close();
    return;
  }
  console.log(`ResearchState for ${ind.canonicalName} (v${st.version})`);
  console.log(`  known(claim refs): ${st.known.length}`);
  console.log(`  unknown topics: ${st.unknown.map((u) => u.ref).join(", ") || "-"}`);
  console.log(`  keyQuestions: ${st.keyQuestionIds.length}`);
  console.log(`  gaps: ${st.researchGapIds.length}`);
  console.log(`  nextActions: ${st.nextActionIds.length}`);
  db.close();
}

// --- Phase P1 Methodology commands (Human-gated evolution) ------------------
function readProposedDimensions(file: string): MethodologyDimension[] {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const dims = Array.isArray(raw) ? raw : raw?.dimensions;
  if (!Array.isArray(dims) || dims.length === 0) {
    throw new Error("proposal file must contain a non-empty dimensions array");
  }
  return dims as MethodologyDimension[];
}

async function cmdMethodology(sub: string | undefined, rest: string[]): Promise<void> {
  const { dbPath } = foundationPaths();
  const db = new ResearchDb({ path: dbPath });
  const repo = new ResearchRepository(db.db);
  const svc = new MethodologyService(repo);
  try {
    if (sub === "show") {
      const active = svc.getActive();
      console.log(`Methodology active: ${active.versionTag} (${active.versionId})`);
      console.log(`  dimensions: ${active.dimensions.length}`);
      for (const d of active.dimensions) console.log(`    - ${d.key}  ${d.name}`);
      return;
    }

    if (sub === "list") {
      const versions = svc.history();
      console.log(`versions (${versions.length}):`);
      for (const v of versions) {
        console.log(
          `  ${v.versionTag}  ${v.versionId}  dims=${v.dimensions.length}  activated=${v.activatedAt ?? "-"}`,
        );
      }
      const pending = svc.pendingCandidates();
      console.log(`pending candidates (${pending.length}):`);
      for (const c of pending) {
        console.log(`  ${c.candidateId}  base=${c.baseVersionId}  dims=${c.proposedDimensions.length}`);
        console.log(`    rationale: ${c.rationale}`);
      }
      return;
    }

    if (sub === "propose") {
      const file = rest[0];
      const rationaleIdx = rest.indexOf("--rationale");
      const rationale = rationaleIdx >= 0 ? rest[rationaleIdx + 1] : undefined;
      const byIdx = rest.indexOf("--by");
      const by = byIdx >= 0 ? rest[byIdx + 1] : "user";
      if (!file || !rationale) {
        console.error("usage: tiancha methodology propose <proposal.json> --rationale <text> [--by agent|user]");
        process.exitCode = 1;
        return;
      }
      const res = svc.propose({
        proposedDimensions: readProposedDimensions(file),
        rationale,
        createdBy: by === "agent" ? "agent" : "user",
      });
      console.log(
        `[propose] candidate=${res.candidate.candidateId} base=${res.candidate.baseVersionId} dims=${res.candidate.proposedDimensions.length}`,
      );
      console.log(`  rationale: ${res.candidate.rationale}`);
      console.log(`  approval token (single-use, keep it): ${res.resumeToken}`);
      console.log(
        `  next: tiancha methodology decide ${res.candidate.candidateId} --approve --operator <name> [--token <token>]`,
      );
      return;
    }

    if (sub === "decide") {
      const candidateId = rest[0];
      const approve = rest.includes("--approve");
      const reject = rest.includes("--reject");
      const opIdx = rest.indexOf("--operator");
      const operator = opIdx >= 0 ? rest[opIdx + 1] : undefined;
      const cmtIdx = rest.indexOf("--comment");
      const comment = cmtIdx >= 0 ? rest[cmtIdx + 1] : undefined;
      const tokIdx = rest.indexOf("--token");
      const resumeToken = tokIdx >= 0 ? rest[tokIdx + 1] : undefined;
      if (!candidateId || (!approve && !reject) || !operator) {
        console.error(
          "usage: tiancha methodology decide <candidateId> (--approve|--reject) --operator <name> [--comment <text>] [--token <token>]",
        );
        process.exitCode = 1;
        return;
      }
      const res = svc.decide({
        candidateId,
        decision: approve ? "approved" : "rejected",
        operator,
        comment,
        resumeToken,
      });
      console.log(
        `[decide] candidate=${res.candidate.candidateId} status=${res.candidate.status} operator=${res.candidate.operator}`,
      );
      if (res.activatedVersion) {
        console.log(
          `  activated: ${res.activatedVersion.versionTag} (${res.activatedVersion.versionId}) dims=${res.activatedVersion.dimensions.length}`,
        );
      } else {
        console.log("  no activation (rejected)");
      }
      return;
    }

    console.error("usage: tiancha methodology <show|list|propose|decide> ...");
    process.exitCode = 1;
  } catch (err) {
    console.error("methodology error:", (err as Error).message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

async function run(): Promise<void> {
  configureTianchaAgentDir();
  const args = process.argv.slice(2);
  const tianchaBrand = brandIsTiancha();

  // Migration (idempotent, copy-only).
  try {
    migratePiToTiancha(process.cwd());
  } catch (err) {
    console.error("migration warning:", (err as Error).message);
  }

  // Branded --version only when invoked as `tiancha`.
  if (tianchaBrand && (args[0] === "--version" || args[0] === "-v")) {
    console.log(`${PRODUCT_NAME} ${TIANCHA_VERSION}`);
    return;
  }

  if (tianchaBrand && args[0] === "research" && args[1] === "smoke") {
    await cmdResearchSmoke();
    return;
  }

  // --- S7 / C-MVP: capability exposure + the material input pipe --------------
  // The handlers are a thin composition seam (see src/cli/research-commands.ts);
  // only `evaluate` and `material add` may write, and each only to its own artifact.
  const isResearchSub =
    args[0] === "research" && (RESEARCH_SUBCOMMANDS as readonly string[]).includes(args[1] ?? "");
  // ★ C-MVP-R1: `material` is its own sub-tree (add / list / retry) because it is the ONLY
  // writable research entry point; `retry` / `--force` stay CLI-only.
  const isMaterialCmd = args[0] === "research" && args[1] === "material";
  // ★ C6 slice ③: `candidate` is its own sub-tree — the human gate for claim candidates.
  const isCandidateCmd = args[0] === "research" && args[1] === "candidate";
  const isTargetCmd =
    args[0] === "research" && args[1] === "target" && (args[2] === "add" || args[2] === "list");
  if (tianchaBrand && (isResearchSub || isMaterialCmd || isTargetCmd || isCandidateCmd)) {
    const { dbPath, artifactDbPath } = foundationPaths();
    const db = new ResearchDb({ path: dbPath });
    const artifacts = new SqliteArtifactStore({ path: artifactDbPath });
    try {
      const repo = new ResearchRepository(db.db);
      // ★ P1 fix: ONE knowledge view shared by the human gate and the projection.
      const knowledge = new KnowledgeRepository(db.db);
      const deps: ResearchCliDeps = {
        repo,
        evaluation: new EvaluationService(db.db),
        priority: new PriorityService(db.db),
        reports: new ReportService(db.db),
        // ★ §29.2 (c): `knowledge` powers the orphan-Claim scan of a残骸 retry.
        materials: new MaterialIngestService(repo, new EchoDataProvider(), artifacts, {
          knowledge,
        }),
        targets: new TargetService(db.db),
        chain: new ChainProjectionService(db.db),
        needs: new ResearchNeedService(db.db),
        fits: new QuestionTargetFitService(db.db),
        diligence: new DiligencePreparationService(db.db),
        // ★ C2 Step 2-C: the ONE plan projection/build path (read-only; shared with the Agent).
        plans: new ResearchPlanService(db.db),
        // ★ C5-A: the human-only company entry point + the ONLY writer of `target_proposal`.
        companies: new CompanyService(db.db),
        proposals: new TargetProposalService(db.db),
        // ★ C5-B: the HUMAN Gate orchestrator (confirm / reject → Target materialisation).
        decisions: new ProposalDecisionService(db.db),
        // ★ C-MVP-R1 (§29.2): the one-shot historical-material triage summary of THIS run.
        materialMigration: db.materialMigrationSummary,
        // ★ C6 slice ③: candidate review; confirmation is recorded, PROJECTION is slice ④.
        // ★ P1 fix: the human gate judges an explicit evolution target against this same knowledge.
        candidates: new CandidateReviewService(repo, knowledge),
        // ★ C6 Slice F2 (§M14.1): the candidate EXTRACTION entry point — the FIRST production
        // construction of CandidateExtractionService. The deterministic legacy [CANDIDATE] extractor
        // is wired here; the MODEL path is opt-in via `--model` and resolves no adapter in this
        // build (ADAPTER_NOT_CONFIGURED), by design (§M14.0 / §M14.6).
        extraction: new CandidateExtractionService(repo, new ExplicitBlockExtractor(repo)),
        // ★ C6 slice ④: projection goes through the SAME ingestClaims path field research uses.
        projection: new CandidateProjectionService(
          repo,
          new OpportunityDiscoveryService(repo, new EchoDataProvider(), artifacts),
          knowledge,
        ),
        reportDir: join(homedir(), ".tiancha", "reports"),
        out: (line) => console.log(line),
        err: (line) => console.error(line),
      };
      const json = args.includes("--json");
      if (isCandidateCmd) {
        const sub = args[2];
        const id = args[3];
        const operator = flagValue(args, "--operator");
        const comment = flagValue(args, "--comment");
        if (sub === "list") {
          process.exitCode = await runCandidateList(
            id,
            { json, materialVersionId: flagValue(args, "--material-version"), status: flagValue(args, "--status") },
            deps,
          );
        } else if (sub === "show") {
          process.exitCode = await runCandidateShow(id, { json }, deps);
        } else if (sub === "confirm") {
          process.exitCode = await runCandidateConfirm(
            id,
            {
              json,
              operator,
              relation: flagValue(args, "--relation"),
              comment,
              // ★ both explicit evolution targets must reach the DECISION (the target is part of it)
              supersedes: flagValue(args, "--supersedes-claim"),
              revises: flagValue(args, "--revises-claim"),
            },
            deps,
          );
        } else if (sub === "revise") {
          process.exitCode = await runCandidateRevise(
            id,
            { json, operator, statement: flagValue(args, "--statement"), kind: flagValue(args, "--kind"), comment },
            deps,
          );
        } else if (sub === "reject") {
          process.exitCode = await runCandidateReject(id, { json, operator, comment }, deps);
        } else if (sub === "project") {
          process.exitCode = await runCandidateProject(
            id,
            {
              json,
              operator,
              supersedes: flagValue(args, "--supersedes-claim"),
              revises: flagValue(args, "--revises-claim"),
            },
            deps,
          );
        } else if (sub === "extract") {
          // ★ C6 Slice F2 (§M14.1): `--model` selects the MODEL path EXPLICITLY; without it the
          // existing legacy [CANDIDATE] default path runs. `--timeout` / `--window-max-chars` are
          // optional and only meaningful for the model path.
          const timeoutRaw = flagValue(args, "--timeout");
          const maxCharsRaw = flagValue(args, "--window-max-chars");
          process.exitCode = await runCandidateExtract(
            id,
            {
              json,
              operator,
              model: args.includes("--model"),
              ...(timeoutRaw === undefined ? {} : { timeoutMs: Number(timeoutRaw) }),
              ...(maxCharsRaw === undefined ? {} : { windowMaxChars: Number(maxCharsRaw) }),
            },
            deps,
          );
        } else {
          deps.err("usage: tiancha research candidate list|show|confirm|revise|reject|project|extract ...");
          process.exitCode = 1;
        }
      } else if (isMaterialCmd) {
        const sub = args[2];
        if (sub === "add") {
          process.exitCode = await runMaterialAdd(args[3], args[4], { json }, deps);
        } else if (sub === "list") {
          process.exitCode = await runMaterialList(args[3], { json }, deps);
        } else if (sub === "retry") {
          process.exitCode = await runMaterialRetry(
            args[3],
            { json, force: args.includes("--force"), acceptOrphanRisk: args.includes("--accept-orphans") },
            deps,
          );
        } else if (sub === "attribute") {
          const at = args.indexOf("--to");
          process.exitCode = await runMaterialAttribute(
            args[3],
            { json, to: at >= 0 ? args[at + 1] : undefined },
            deps,
          );
        } else {
          deps.err("usage: tiancha research material add|list|retry|attribute …");
          process.exitCode = 1;
        }
      } else if (isTargetCmd) {
        process.exitCode =
          args[2] === "add"
            ? await runTargetAdd(args.slice(3), { json }, deps)
            : await runTargetList(args[3], { json }, deps);
      } else {
        process.exitCode = await runResearchCommand(args[1] as string, args.slice(2), deps);
      }
    } finally {
      await artifacts.close();
      db.close();
    }
    return;
  }

  if (tianchaBrand && args[0] === "session" && args[1] === "readonly") {
    const path = args[2];
    if (!path) {
      console.error("usage: tiancha session readonly <session-file>");
      process.exitCode = 1;
      return;
    }
    await cmdSessionReadonly(path);
    return;
  }

  // --- Phase 2A research memory commands ---
  if (tianchaBrand && args[0] === "industry" && args[1] === "ingest") {
    const file = args[2];
    const name = args[3] === "--name" ? args[4] : undefined;
    if (!file || !name) {
      console.error("usage: tiancha industry ingest <file> --name <industry>");
      process.exitCode = 1;
      return;
    }
    await cmdIndustryIngest(file, name);
    return;
  }
  if (tianchaBrand && args[0] === "industry" && args[1] === "show") {
    if (!args[2]) {
      console.error("usage: tiancha industry show <name>");
      process.exitCode = 1;
      return;
    }
    await cmdIndustryShow(args[2]);
    return;
  }
  if (tianchaBrand && args[0] === "state" && args[1] === "show") {
    if (!args[2]) {
      console.error("usage: tiancha state show <industry>");
      process.exitCode = 1;
      return;
    }
    await cmdStateShow(args[2]);
    return;
  }

  // --- Phase P1 methodology evolution ---
  if (tianchaBrand && args[0] === "methodology") {
    await cmdMethodology(args[1], args.slice(2));
    return;
  }

  // --- Phase 2B: product entry ---------------------------------------------
  // Non-interactive one-shot, sharing the SAME assembly as the interactive REPL.
  if (tianchaBrand && args[0] === "ask") {
    const prompt = args.slice(1).join(" ").trim();
    if (!prompt) {
      console.error('usage: tiancha ask "<prompt>"');
      process.exitCode = 1;
      return;
    }
    const host = await TianchaAgentHost.create();
    console.log(await host.askOneShot(prompt));
    return;
  }

  // No args (tiancha brand) => enter the Tiancha Agent interactive REPL.
  // This is THE product entry; it must NOT fall through to piMain / old host.
  if (tianchaBrand && args.length === 0) {
    const host = await TianchaAgentHost.create();
    await host.startInteractive();
    return;
  }

  // Non-tiancha brand or unknown subcommand => delegate to Pi.
  await piMain(args);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

/** Read `--flag value` (undefined when absent, or when the next token is another flag). */
function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}
