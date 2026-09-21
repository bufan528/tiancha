/**
 * ToolProviderPort -maps a role/task onto Pi tool selection fields:
 * tools / excludeTools / noTools / customTools.
 */

import type { AgentRole } from "../domain/index.js";

export interface ToolSelection {
  tools?: string[];
  excludeTools?: unknown;
  noTools?: boolean;
  customTools?: unknown[];
}

export interface ToolProviderPort {
  resolve(role: AgentRole, taskType: string): Promise<ToolSelection>;
}
