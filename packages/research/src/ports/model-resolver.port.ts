/**
 * ModelResolverPort -resolves an AgentRole + ModelPolicy into a concrete model
 * id + thinkingLevel. Backed by Pi's ModelRegistry/ScopedModel in the impl.
 */

import type { AgentRole, ModelPolicy } from "../domain/index.js";

export interface ResolvedModel {
  model: string;
  thinkingLevel: string;
}

export interface ModelResolverPort {
  resolve(role: AgentRole, modelPolicy: ModelPolicy): Promise<ResolvedModel>;
}
