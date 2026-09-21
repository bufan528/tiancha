/**
 * ResourceLoaderFactoryPort -maps skills/extensions/prompts onto the real Pi
 * DefaultResourceLoaderOptions subset (the ONLY resource injection channel).
 */

import type { ResourceLoaderOptionsSubset } from "./agent-session-factory.port.js";

export interface ResourceRequest {
  taskType: string;
  /** Skill names to force-override (skillsOverride). */
  skillsOverride?: string[];
  additionalSkillPaths?: string[];
  additionalExtensionPaths?: string[];
  noSkills?: boolean;
  noExtensions?: boolean;
}

export interface ResourceLoaderFactoryPort {
  build(request: ResourceRequest): Promise<ResourceLoaderOptionsSubset>;
}
