/**
 * C6 · RMA (§R1.4 / §R1.5 / §R2 / §R7.5) — the model-adapter ASSEMBLY, inside the provider boundary.
 *
 * It lives in the package (not in the CLI seam) on purpose: the CLI's `resolveModelAdapter()` stays a
 * thin, provider-name-free call, so the long-standing architectural assertion that the CLI seam
 * introduces no model call and no external data source keeps holding.
 *
 * The THREE mutually exclusive outcomes of §R7.5 are produced here:
 *   (1) nothing configured            → `undefined`  ⇒ the caller reports ADAPTER_NOT_CONFIGURED
 *   (2) configured but unusable       → THROWS a `ProviderError` (credential / capability / config)
 *   (3) ready                         → the adapter
 *
 * `outputContract` is the service-resolved, READ-ONLY Tiancha contract (§R4.3): this function must
 * NOT resolve `schemaVersion` itself (T-RMA-33) — it only injects the value it was handed.
 */

import type { ExtractionOutputContract } from "../application/extraction-output-contract.js";
import type { ModelExtractionAdapter } from "../application/model-extraction.js";
import { ProviderError } from "./model-provider-errors.js";
import { assertNoAuthEndpointIsLoopback, resolveModelCredential } from "./model-credentials.js";
import { createFetchTransport, type FetchLike } from "./openai-compatible-transport.js";
import {
  OpenAiCompatibleModelAdapter,
  assertCapabilities,
  type ModelInstanceConfig,
  type ProviderCapabilities,
} from "./openai-compatible-model-adapter.js";

/** §R1.4 / D-RMA-J — the instance config lives in env; the three variables must be given together. */
export const MODEL_BASE_URL_ENV = "TIANCHA_MODEL_BASE_URL";
export const MODEL_NAME_ENV = "TIANCHA_MODEL_NAME";
export const MODEL_DEPLOYMENT_ENV = "TIANCHA_MODEL_DEPLOYMENT";

export type ModelEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Read the instance config. NOTHING configured ⇒ `undefined` ("not assembled in this build"); a
 * PARTIAL configuration is a configuration error (never silently treated as absent — §R2.3).
 */
export function readModelInstanceConfig(env: ModelEnvironment): ModelInstanceConfig | undefined {
  const baseUrl = (env[MODEL_BASE_URL_ENV] ?? "").trim();
  const model = (env[MODEL_NAME_ENV] ?? "").trim();
  const deployment = (env[MODEL_DEPLOYMENT_ENV] ?? "").trim();
  if (baseUrl === "" && model === "" && deployment === "") return undefined;
  if (baseUrl === "" || model === "" || deployment === "") {
    throw new ProviderError(
      "configuration",
      `${MODEL_BASE_URL_ENV} / ${MODEL_NAME_ENV} / ${MODEL_DEPLOYMENT_ENV} must be set together`,
    );
  }
  return { baseUrl, model, deployment };
}

/** §R1.5 — the profile's declared capabilities; v1 targets a profile with BOTH REQUIRED ones. */
export function declaredProviderCapabilities(): ProviderCapabilities {
  return { structuredOutput: true, abortSignal: true };
}

/**
 * Assemble the adapter (§R7.5). `fetchImpl` is injectable so tests never touch the real network
 * (§R13.0) and so a runtime without a global `fetch` can still be served.
 */
export function assembleModelAdapter(
  outputContract: ExtractionOutputContract,
  env: ModelEnvironment,
  fetchImpl?: FetchLike,
): ModelExtractionAdapter | undefined {
  const instance = readModelInstanceConfig(env);
  if (instance === undefined) return undefined; // (1)
  const credential = resolveModelCredential(env); // (2) credential 不满足 ⇒ 抛 configuration
  if (credential.authMode === "none") assertNoAuthEndpointIsLoopback(new URL(instance.baseUrl));
  const capabilities = declaredProviderCapabilities();
  assertCapabilities(capabilities); // (2) REQUIRED 能力不满足 ⇒ fail closed（不发起任何调用）
  return new OpenAiCompatibleModelAdapter({
    transport: createFetchTransport(fetchImpl),
    outputContract,
    instance,
    credential,
    capabilities,
  });
}