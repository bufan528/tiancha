/**
 * ModelRouter -resolves a task's ModelPolicy into a concrete model + thinking
 * level via ModelResolverPort. Phase 1: thin skeleton, no policy heuristics.
 */

import type { AgentRole, ModelPolicy } from "../domain/index.js";
import type { ModelResolverPort, ResolvedModel } from "../ports/model-resolver.port.js";

export class ModelRouter {
  constructor(private readonly resolver: ModelResolverPort) {}

  async resolve(role: AgentRole, policy: ModelPolicy): Promise<ResolvedModel> {
    return this.resolver.resolve(role, policy);
  }
}
