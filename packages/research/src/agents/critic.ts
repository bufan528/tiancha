/** Critic agent -Phase 2 placeholder (quality gate). Contract only. */
import type { AgentRole } from "../domain/index.js";
export interface CriticAgent { readonly role: AgentRole }
export const criticAgentRole: AgentRole = "critic";
