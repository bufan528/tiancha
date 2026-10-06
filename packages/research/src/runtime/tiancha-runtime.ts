/**
 * TianchaRuntime -the assembled research runtime. The composition root creates
 * the Ports (bound to real Pi implementations) and the storage paths, then
 * constructs this. Phase 1 skeleton: no LLM business logic.
 */

import { ModelRouter } from "./model-router.js";
import { TaskEngine } from "./task-engine.js";
import { Orchestrator } from "./orchestrator.js";
import { ResearchEventAdapter } from "./research-event-adapter.js";
import { SessionRegistry } from "./session-registry.js";
import type { ExecutionSessionCapability } from "./execution-session.js";
import {
  SqliteResearchEventStore,
  type ResearchEventStore,
} from "../storage/research-event-store.js";
import { SqliteArtifactStore, type ArtifactStore } from "../storage/artifact-store.js";
import type { AgentSessionFactoryPort } from "../ports/agent-session-factory.port.js";
import type { ModelResolverPort } from "../ports/model-resolver.port.js";
import type { EventBusPort } from "../ports/event-bus.port.js";

/**
 * ★ R-2B-A（R2BA-Q1 · §18 Amendment 1）：最小受控 registration 能力。
 *
 * 这是 composition wiring seam —— 【不是】product-level Port（不入 `ports/`，
 * 也不是 interface）。Runtime 只把这一条能力交给 src/ 侧的 session factory，
 * 而【不】公开整个 `SessionRegistry` 实例（不暴露 lookup / 不转移 ownership）。
 */
export type SessionRegistrationCapability = (
  sessionId: string,
  session: ExecutionSessionCapability,
) => void;

/**
 * ★ R-2B-A（R2BA-Q1 · §18 Amendment 1）：最小受控 unregistration 能力。
 *
 * 仅供 `ChildSession.close()` 的【机械映射移除】（AF-1C IC-6-3）；
 * 它是移除映射，不是 lifecycle 决策（lifecycle 语义归 G-05）。
 */
export type SessionUnregistrationCapability = (sessionId: string) => void;

export interface TianchaRuntimeDeps {
  cwd: string;
  /** Path to the durable research-event sqlite db. */
  eventDbPath: string;
  /** Path to the artifact sqlite db. */
  artifactDbPath: string;
  eventBus: EventBusPort;
  /**
   * ★ R-2B-A：factory 由 Runtime 用【它自己持有的】registry 的受控能力构建；
   * 不再由外部注入 registry 实例（Composition Contract §C CSO-C-1）。
   * `AgentSessionFactoryPort.create()` 的签名与 `ChildSessionOptions` 形状不变。
   */
  agentSessionFactory: (
    register: SessionRegistrationCapability,
    unregister: SessionUnregistrationCapability,
  ) => AgentSessionFactoryPort;
  modelResolver: ModelResolverPort;
}

export class TianchaRuntime {
  readonly events: ResearchEventAdapter;
  readonly engine: TaskEngine;
  readonly orchestrator: Orchestrator;
  readonly eventStore: ResearchEventStore;
  readonly artifactStore: ArtifactStore;
  /**
   * ★ R-2B-A：SessionRegistry 由 composition root（本类）创建并持有
   * （AF-1C AI-5-1）。它【不】对外公开（R2BA-Q1）—— 只提供 §18 Amendment 1
   * 的最小受控能力给 factory composition。
   */
  private readonly registry: SessionRegistry;

  constructor(deps: TianchaRuntimeDeps) {
    this.eventStore = new SqliteResearchEventStore({ path: deps.eventDbPath });
    this.artifactStore = new SqliteArtifactStore({ path: deps.artifactDbPath });
    this.events = new ResearchEventAdapter({ store: this.eventStore, bus: deps.eventBus });
    this.events.start();

    // ★ R-2B-A：唯一 SessionRegistry 实例由本 composition root 创建并持有；
    //   只把最小受控能力交给 factory（不公开实例 · R2BA-Q1 / §18 Amendment 1）。
    this.registry = new SessionRegistry();
    const register: SessionRegistrationCapability = (sessionId, session) =>
      this.registry.register(sessionId, session);
    const unregister: SessionUnregistrationCapability = (sessionId) =>
      this.registry.remove(sessionId);

    const factory = deps.agentSessionFactory(register, unregister);
    const modelRouter = new ModelRouter(deps.modelResolver);
    this.engine = new TaskEngine({
      cwd: deps.cwd,
      factory,
      modelRouter,
      events: this.events,
    });
    this.orchestrator = new Orchestrator(this.engine, this.events);
  }

  async close(): Promise<void> {
    this.events.stop();
    await this.eventStore.close();
    await this.artifactStore.close();
  }
}
