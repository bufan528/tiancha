/**
 * ResearchContext — the formal, standalone research slice that a child session
 * receives. It is NOT a Pi AgentMessage/entry. It is mapped by the composition
 * root onto Pi resource-loader channels (systemPrompt / appendSystemPrompt /
 * promptsOverride / agentsFilesOverride) — never passed as a raw session arg.
 *
 * Phase 1: contract only. No LLM business logic lives here.
 */

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ModelTier = "cheap" | "strong" | "default";

/** Model policy resolved for a task. Structural — no pi types imported. */
export interface ModelPolicy {
  /** Logical tier; resolved by ModelResolverPort into a concrete model id. */
  tier: ModelTier;
  thinkingLevel: ThinkingLevel;
}

/**
 * The research context handed to a child session. The composition root turns
 * `systemPrompt` / `appendSystemPrompt` / `agentsFilesOverride` into Pi
 * resource-loader options.
 */
export interface ResearchContext {
  runId: string;
  roundId?: string;
  taskId?: string;
  /** Human-readable research goal, e.g. "评估具身智能行业是否入池". */
  objective: string;
  /** Industry / company / question slice relevant to the task. */
  scope: ResearchContextScope;
  /** Free-form fact/claim/evidence summary injected as appendSystemPrompt. */
  systemPrompt?: string;
  appendSystemPrompt?: string[];
  /** AGENTS.md channel overrides ({ path, content }). */
  agentsFilesOverride?: Array<{ path: string; content: string }>;
}

export interface ResearchContextScope {
  industryId?: string;
  industryName?: string;
  companyId?: string;
  companyName?: string;
  /** Open questions / evidence gaps this task should address. */
  openQuestions?: string[];
}
