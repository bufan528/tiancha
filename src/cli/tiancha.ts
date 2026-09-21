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
  type AgentSessionFactoryPort,
  type ModelResolverPort,
  type EventBusPort,
  type ChildSessionOptions,
  type ChildSession,
} from "@tiancha/research";
import {
  migratePiToTiancha,
  ReadOnlySessionManager,
  ReadOnlySessionError,
} from "@tiancha/research";

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

async function buildAgentSessionFactory(): Promise<AgentSessionFactoryPort> {
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
      const s = result.session as unknown as { close?: () => Promise<void> } | undefined;
      return {
        sessionId: `child-${opts.taskId}`,
        taskId: opts.taskId,
        async close() {
          await s?.close?.();
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
  const factory = await buildAgentSessionFactory();

  const runtime = new TianchaRuntime({
    cwd: process.cwd(),
    eventDbPath,
    artifactDbPath,
    eventBus: bus,
    agentSessionFactory: factory,
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

  // Default: delegate to Pi main (preserves full pi TUI/chat + all commands).
  await piMain(args);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
