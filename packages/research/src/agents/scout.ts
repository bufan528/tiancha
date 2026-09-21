/**
 * Scout agent -Phase 2 placeholder (industry/scan discovery).
 * Contract only; NO business logic in Phase 1.
 */
import type { AgentRole } from "../domain/index.js";

export interface ScoutAgent {
  readonly role: AgentRole;
}

export const scoutAgentRole: AgentRole = "scout";
