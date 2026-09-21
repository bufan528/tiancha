/**
 * ResearchContextProviderPort -maps the research slice onto Pi prompt channels:
 * systemPrompt / appendSystemPrompt / promptsOverride / agentsFilesOverride.
 */

import type { ResearchContext } from "../domain/research-context.js";
import type { ResourceLoaderOptionsSubset } from "./agent-session-factory.port.js";

export interface ResearchContextProviderPort {
  build(context: ResearchContext): Promise<ResourceLoaderOptionsSubset>;
}
