/** Planner (LLM role) -Phase 2 placeholder. Distinct from the deterministic
 * planning/ engine. Contract only. */
import type { AgentRole } from "../domain/index.js";
export interface PlannerAgent { readonly role: AgentRole }
export const plannerAgentRole: AgentRole = "planner";
