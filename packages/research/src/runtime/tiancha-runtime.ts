/**
 * TianchaRuntime -the assembled research runtime. The composition root creates
 * the Ports (bound to real Pi implementations) and the storage paths, then
 * constructs this. Phase 1 skeleton: no LLM business logic.
 */

import { ModelRouter } from "./model-router.js";
import { TaskEngine } from "./task-engine.js";
import { Orchestrator } from "./orchestrator.js";
import { ResearchEventAdapter } from "./research-event-adapter.js";
import {
  SqliteResearchEventStore,
  type ResearchEventStore,
} from "../storage/research-event-store.js";
import { SqliteArtifactStore, type ArtifactStore } from "../storage/artifact-store.js";
import type { AgentSessionFactoryPort } from "../ports/agent-session-factory.port.js";
import type { ModelResolverPort } from "../ports/model-resolver.port.js";
import type { EventBusPort } from "../ports/event-bus.port.js";

export interface TianchaRuntimeDeps {
  cwd: string;
  /** Path to the durable research-event sqlite db. */
  eventDbPath: string;
  /** Path to the artifact sqlite db. */
  artifactDbPath: string;
  eventBus: EventBusPort;
  agentSessionFactory: AgentSessionFactoryPort;
  modelResolver: ModelResolverPort;
}

export class TianchaRuntime {
  readonly events: ResearchEventAdapter;
  readonly engine: TaskEngine;
  readonly orchestrator: Orchestrator;
  readonly eventStore: ResearchEventStore;
  readonly artifactStore: ArtifactStore;

  constructor(deps: TianchaRuntimeDeps) {
    this.eventStore = new SqliteResearchEventStore({ path: deps.eventDbPath });
    this.artifactStore = new SqliteArtifactStore({ path: deps.artifactDbPath });
    this.events = new ResearchEventAdapter({ store: this.eventStore, bus: deps.eventBus });
    this.events.start();

    const modelRouter = new ModelRouter(deps.modelResolver);
    this.engine = new TaskEngine({
      cwd: deps.cwd,
      factory: deps.agentSessionFactory,
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
