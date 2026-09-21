/**
 * AgentSessionFactoryPort -the ONLY sanctioned way to get LLM inference for a
 * research task (lock (4). The composition root implements it against Pi's real
 * createAgentSessionServices + createAgentSessionFromServices. research itself
 * never imports coding-agent and never calls agentLoop directly.
 *
 * Resource injection flows through `resourceLoaderOptions` (the real Pi channel):
 *   skillsOverride / additionalSkillPaths / noSkills /
 *   extensionFactories / additionalExtensionPaths / extensionsOverride / noExtensions /
 *   systemPrompt / appendSystemPrompt / additionalPromptTemplatePaths /
 *   promptsOverride / agentsFilesOverride / systemPromptOverride / appendSystemPromptOverride
 *
 * These are produced by ResourceLoaderFactoryPort + ResearchContextProviderPort.
 */

import type { AgentRole, ModelPolicy } from "../domain/index.js";
import type { ResearchContext } from "../domain/research-context.js";

/** Opaque resource-loader options subset (structural; Pi-specific at runtime). */
export type ResourceLoaderOptionsSubset = Record<string, unknown>;

export interface ChildSessionOptions {
  cwd: string;
  taskId: string;
  runId: string;
  roundId?: string;
  role: AgentRole;
  modelPolicy: ModelPolicy;
  /** Resolved concrete model id (from ModelResolverPort). */
  model?: string;
  thinkingLevel?: string;
  tools?: string[];
  excludeTools?: unknown;
  noTools?: boolean;
  customTools?: unknown[];
  /** Merged resource-loader options (skills/extensions/prompts/research context). */
  resourceLoaderOptions?: ResourceLoaderOptionsSubset;
  /** Research context slice (mapped into resourceLoaderOptions by the impl). */
  researchContext?: ResearchContext;
}

/**
 * Minimal lifecycle wrapper around a Pi AgentSession. Deliberately does NOT
 * expose the full pi session surface to research.
 */
export interface ChildSession {
  sessionId: string;
  taskId: string;
  /** Dispose/close the child session (no LLM run in Phase 1 smoke). */
  close(): Promise<void>;
}

export interface AgentSessionFactoryPort {
  create(opts: ChildSessionOptions): Promise<ChildSession>;
}
