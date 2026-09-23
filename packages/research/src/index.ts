/**
 * @tiancha/research -research kernel public API.
 * Dependency rule: this package NEVER imports @earendil-works/pi-coding-agent.
 * Ports are structural; the composition root binds real Pi implementations.
 */
export * from "./domain/index.js";
export * from "./ports/index.js";
export * from "./storage/index.js";
export * from "./runtime/index.js";
export * from "./migration/index.js";
export * from "./agents/index.js";
export * from "./planning/index.js";
export * from "./evidence/index.js";
export * from "./dossier/index.js";
export * from "./scoring/index.js";
export * from "./providers/echo-data-provider.js";
export * from "./methodology/methodology-v1.js";
export * from "./application/opportunity-discovery-service.js";
export * from "./application/knowledge-projection-service.js";
export * from "./application/methodology-service.js";
