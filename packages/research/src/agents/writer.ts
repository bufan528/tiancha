/** Writer agent -Phase 2 placeholder (report writing). Contract only. */
import type { AgentRole } from "../domain/index.js";
export interface WriterAgent { readonly role: AgentRole }
export const writerAgentRole: AgentRole = "writer";
