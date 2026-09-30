/**
 * C6 · RMA — the first REAL provider adapter (profile = OpenAI-compatible HTTP, §R1.4 / D-RMA-A).
 *
 * It is the ONLY new business capability of this slice and it lives entirely inside the provider
 * boundary: the application layer sees nothing but `ModelExtractionAdapter` (§R1.1 / §R1.2).
 *
 * What it does NOT do (each is a contract rule):
 *   - no retry of any kind (§R8.1 `maxAttempts = 1`, §R8.4 no hidden/SDK retry);
 *   - no streaming, no tool-calling, no multi-provider routing (§R1.5 / §R11.2);
 *   - it never owns the schema: it CONSUMES the Tiancha `ExtractionOutputContract` it was assembled
 *     with, holds it read-only, and may not widen/replace it (§R4.3 / T-RMA-22);
 *   - it never repairs/trims/caches a quote (§R10.2) and never validates a quote itself — V1–V4 stay
 *     the service's job (§R10.1);
 *   - it never computes `mxcfg-`: it only supplies its identity and generation parameters into the
 *     EXISTING identity machinery (§R5.6 — the final identity invariant).
 *
 * This module also re-exports the sibling boundary pieces, so `src/index.ts` can expose the whole
 * boundary with the ONE `export *` line §R12.2 allows.
 */

import type { ExtractionOutputContract } from "../application/extraction-output-contract.js";
import type { AdapterIdentity, ModelBatchInput, ModelBatchResult, ModelCandidateDraft, ModelExtractionAdapter, ModelQuote } from "../application/model-extraction.js";
import type { ModelGenerationParams } from "../application/model-extraction-config.js";
import { ProviderError, type ProviderErrorCode } from "./model-provider-errors.js";
import type { AuthMode } from "./model-credentials.js";
import type { ProviderTransport } from "./openai-compatible-transport.js";
// The EXISTING identity primitives — reused, never duplicated (§R5.6).
import { sha256Hex } from "../domain/material-source.js";
import { stableStringify } from "../application/model-extraction-config.js";

export { ProviderError, isProviderError, providerErrorFrom, PROVIDER_ERROR_CODES } from "./model-provider-errors.js";
export type { ProviderErrorCode } from "./model-provider-errors.js";
export {
  MODEL_API_KEY_ENV,
  MODEL_CREDENTIAL_FILE_ENV,
  MODEL_AUTH_MODE_ENV,
  resolveModelCredential,
  assertNoAuthEndpointIsLoopback,
} from "./model-credentials.js";
export type { AuthMode, ResolvedCredential, CredentialEnvironment, CredentialFileReader } from "./model-credentials.js";
export { createFetchTransport, MissingFetchError } from "./openai-compatible-transport.js";
export {
  MODEL_BASE_URL_ENV,
  MODEL_NAME_ENV,
  MODEL_DEPLOYMENT_ENV,
  readModelInstanceConfig,
  declaredProviderCapabilities,
  assembleModelAdapter,
} from "./model-adapter-assembly.js";
export type { ModelEnvironment } from "./model-adapter-assembly.js";
export type { FetchLike, ProviderHttpRequest, ProviderHttpResponse, ProviderTransport } from "./openai-compatible-transport.js";

/** The adapter implementation's own version — part of `AdapterIdentity` (§R3.1). */
export const ADAPTER_VERSION = "openai-compatible-adapter/v1";
/**
 * The prompt/template version and the response-parser version (§R4.3). Module-private on purpose: they
 * are the adapter's own implementation identity, surfaced through `promptVersion` / `parserVersion`,
 * and exporting them would collide with the domain's unrelated same-named symbols.
 */
const PROMPT_VERSION = "candidate-extraction-prompt/v1";
const PARSER_VERSION = "openai-compatible-parser/v1";

/** The provider instance this adapter talks to (§R1.4: profile ≠ instance). */
export interface ModelInstanceConfig {
  /** Raw configured base URL. Canonicalised into `endpointIdentity`; never stored verbatim. */
  readonly baseUrl: string;
  readonly model: string;
  readonly deployment: string;
}

/**
 * What a provider can do. `structuredOutput` and `abortSignal` are REQUIRED by Tiancha (§R1.5);
 * a declaration that does not cover them must fail CLOSED at assembly time — never "try anyway".
 */
export interface ProviderCapabilities {
  readonly structuredOutput: boolean;
  readonly abortSignal: boolean;
}

export interface OpenAiCompatibleAdapterDeps {
  readonly transport: ProviderTransport;
  /** ★ Read-only: the Tiancha contract this adapter serves. Injected at assembly (§R4.3). */
  readonly outputContract: ExtractionOutputContract;
  readonly instance: ModelInstanceConfig;
  readonly credential: { readonly authMode: AuthMode; readonly apiKey?: string };
  readonly capabilities: ProviderCapabilities;
  /** Generation parameters that ENTER the identity (§R5.0). Defaults keep them explicit and stable. */
  readonly generationParams?: ModelGenerationParams;
}

/** Default generation parameters: explicit (never provider-side implicit defaults). */
export const DEFAULT_GENERATION_PARAMS: ModelGenerationParams = Object.freeze({ temperature: 0 });

/**
 * ★ §R5.0 — ONLY the four frozen, identity-bearing generation fields may enter `generationParams`
 * (`temperature` / `topP` / `maxOutputTokens` / `seed`). Provider-specific options (`toolConfig`,
 * `extra`, vendor extensions, …) must NEVER be promoted into the shared identity surface, so they are
 * dropped here instead of being carried along.
 */
export function pickFrozenGenerationParams(input?: ModelGenerationParams): ModelGenerationParams {
  // Built as a literal because `ModelGenerationParams` fields are READ-ONLY: only the four frozen
  // fields are copied, and absent ones are omitted entirely (never written as `undefined`).
  return Object.freeze({
    ...(input?.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input?.topP === undefined ? {} : { topP: input.topP }),
    ...(input?.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
    ...(input?.seed === undefined ? {} : { seed: input.seed }),
  });
}

const DEFAULT_PATHS: Readonly<Record<string, string>> = Object.freeze({ http: "80", https: "443" });

/**
 * §R3.1 — canonical endpoint identity. Refuses (never normalises away) a base URL that carries
 * a query/fragment or userinfo, because those could hide a credential or change routing silently.
 */
export function endpointIdentityOf(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ProviderError("configuration", "the configured model base URL is not a valid URL");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ProviderError("configuration", "the configured model base URL must not carry a query or fragment");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ProviderError("configuration", "the configured model base URL must not carry userinfo");
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  const host = url.hostname.toLowerCase();
  const port = url.port === "" || url.port === DEFAULT_PATHS[scheme] ? "" : `:${url.port}`;
  const path = url.pathname.replace(/\/+$/, "");
  return `${scheme}://${host}${port}${path}`;
}

/** §R3.1 / D-RMA-C — the frozen prefix of the canonical identity string. */
export const MODEL_VERSION_PREFIX = "pid-";

/**
 * The canonical `modelVersion` value = `pid-<sha256Hex(stableStringify(adapterIdentity))>` (§R3.1 /
 * §R5.4). It reuses the EXISTING `sha256Hex` + `stableStringify` — no second identity code (§R5.6).
 */
export function canonicalModelVersionFor(identity: AdapterIdentity): string {
  return `${MODEL_VERSION_PREFIX}${sha256Hex(stableStringify(identity))}`;
}

/** Capability check (§R1.5). Throws — the caller maps it to an assembly failure (§R7.5 path ②). */
export function assertCapabilities(capabilities: ProviderCapabilities): void {
  if (!capabilities.structuredOutput || !capabilities.abortSignal) {
    throw new ProviderError("capability_unsupported", "the provider does not support a REQUIRED capability");
  }
}

/**
 * The adapter. Read-only with respect to storage: it reads a window and returns candidates; it has no
 * writer, no database and no way to mint an id (§M3.4).
 */
export class OpenAiCompatibleModelAdapter implements ModelExtractionAdapter {
  readonly modelVersion: string;
  readonly promptVersion: string = PROMPT_VERSION;
  readonly parserVersion: string = PARSER_VERSION;
  readonly adapterIdentity: AdapterIdentity;
  readonly generationParams: ModelGenerationParams;
  readonly capabilities: ProviderCapabilities;

  private readonly transport: ProviderTransport;
  private readonly outputContract: ExtractionOutputContract;
  private readonly instance: ModelInstanceConfig;
  private readonly authMode: AuthMode;
  private readonly apiKey: string | undefined;

  constructor(deps: OpenAiCompatibleAdapterDeps) {
    this.transport = deps.transport;
    this.outputContract = deps.outputContract;
    this.instance = deps.instance;
    this.capabilities = Object.freeze({ ...deps.capabilities });
    this.generationParams = pickFrozenGenerationParams(deps.generationParams ?? DEFAULT_GENERATION_PARAMS);
    this.authMode = deps.credential.authMode;
    this.apiKey = deps.credential.apiKey;
    this.adapterIdentity = Object.freeze({
      provider: "openai-compatible",
      model: deps.instance.model,
      deployment: deps.instance.deployment,
      endpointIdentity: endpointIdentityOf(deps.instance.baseUrl),
      adapterVersion: ADAPTER_VERSION,
      authMode: this.authMode,
    } satisfies AdapterIdentity);
    this.modelVersion = canonicalModelVersionFor(this.adapterIdentity);
  }

  /**
   * ONE window → ONE provider request (§R4.1). Compute-only: it returns data and writes nothing.
   * `window.text` is the ONLY material body that reaches the provider — never other windows.
   */
  async extractBatch(input: ModelBatchInput, signal: AbortSignal): Promise<ModelBatchResult> {
    const request = this.buildRequest(input);
    let response: { status: number; body: string };
    try {
      response = await this.transport.send({
        url: this.instance.baseUrl.replace(/\/+$/, "") + "/chat/completions",
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(request),
        signal,
      });
    } catch (err) {
      // ★ §R6.5: when the CALLER already aborted, a cancellation-shaped failure is an abort/timeout —
      // never a provider/network failure, and the vendor error object never leaves this boundary.
      if (signal.aborted) {
        throw new ProviderError("abort", "the model request was aborted by the caller");
      }
      throw new ProviderError("network", "the model request failed in transport");
    }
    if (response.status < 200 || response.status >= 300) throw classifyHttpStatus(response.status);
    return this.parseResponse(response.body, input);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.authMode === "api-key" && this.apiKey !== undefined) {
      headers["authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * §R4.1 mapping: the window text + the methodology's DECLARED dimension order + the Tiancha schema.
   * `materialVersionId` / `windowId` deliberately do NOT travel: they are Tiancha identity, and the
   * model quotes a window by offset — Tiancha is what checks it (§M5.1 / §M5.3).
   */
  private buildRequest(input: ModelBatchInput): Record<string, unknown> {
    const instructions = [
      "Extract candidate observations from the window below.",
      "Return ONLY JSON matching the provided schema.",
      `Allowed dimensions, in order: ${input.dimensionHints.join(", ")}.`,
      "Every quote must be verbatim text from the window, with UTF-16 offsets relative to the window.",
    ].join("\n");
    return {
      model: this.instance.model,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input.window.text },
      ],
      ...this.generationParams,
      response_format: {
        type: "json_schema",
        json_schema: { name: this.outputContract.version, schema: this.outputContract.schema },
      },
    };
  }

  /** §R4.2 — refuse rather than guess. Nothing vendor-shaped survives this method. */
  private parseResponse(body: string, input: ModelBatchInput): ModelBatchResult {
    let envelope: unknown;
    try {
      envelope = JSON.parse(body);
    } catch {
      throw new ProviderError("malformed_response", "the provider response was not valid JSON");
    }
    const content = readChoiceContent(envelope);
    let payload: unknown;
    try {
      payload = JSON.parse(content);
    } catch {
      throw new ProviderError("malformed_response", "the provider message content was not valid JSON");
    }
    if (typeof payload !== "object" || payload === null) {
      throw new ProviderError("malformed_response", "the model output was not an object");
    }
    const raw = (payload as { candidates?: unknown }).candidates;
    if (!Array.isArray(raw)) throw new ProviderError("malformed_response", "the model output has no `candidates` array");
    const allowed = new Set(input.dimensionHints);
    const candidates: ModelCandidateDraft[] = raw.map((item) => normaliseCandidate(item, allowed));
    return { candidates };
  }
}

function readChoiceContent(envelope: unknown): string {
  const choices = (envelope as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError("malformed_response", "the provider response carried no choices");
  }
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  if (typeof content !== "string") throw new ProviderError("malformed_response", "the provider message content is missing");
  return content;
}

function normaliseCandidate(item: unknown, allowedDimensions: ReadonlySet<string>): ModelCandidateDraft {
  if (typeof item !== "object" || item === null) throw new ProviderError("malformed_response", "a candidate was not an object");
  const c = item as Record<string, unknown>;
  const { dimension, statement, contentKind, confidence, quotes } = c;
  if (typeof dimension !== "string" || !allowedDimensions.has(dimension)) {
    throw new ProviderError("malformed_response", "a candidate used a dimension outside the declared set");
  }
  if (typeof statement !== "string") throw new ProviderError("malformed_response", "a candidate is missing `statement`");
  if (contentKind !== "fact" && contentKind !== "judgment") {
    throw new ProviderError("malformed_response", "a candidate has an invalid `contentKind`");
  }
  if (confidence !== undefined && (typeof confidence !== "number" || !Number.isFinite(confidence))) {
    throw new ProviderError("malformed_response", "a candidate has a non-numeric `confidence`");
  }
  if (!Array.isArray(quotes) || quotes.length === 0) {
    throw new ProviderError("malformed_response", "a candidate carried no quotes");
  }
  return {
    dimension,
    statement,
    contentKind,
    ...(confidence === undefined ? {} : { confidence }),
    // ★ Quotes are passed through UNCHANGED: repairing/normalising them is forbidden (§R10.2), and
    // V1–V4 validation belongs to the service (§R10.1).
    quotes: quotes.map((q) => normaliseQuote(q)),
  };
}

function normaliseQuote(item: unknown): ModelQuote {
  const q = item as Record<string, unknown> | null;
  if (typeof q !== "object" || q === null) throw new ProviderError("malformed_response", "a quote was not an object");
  const { windowId, startInWindow, endInWindow, text } = q;
  if (typeof windowId !== "string" || typeof text !== "string") {
    throw new ProviderError("malformed_response", "a quote is missing `windowId` or `text`");
  }
  if (!Number.isInteger(startInWindow) || !Number.isInteger(endInWindow)) {
    throw new ProviderError("malformed_response", "a quote has non-integer offsets");
  }
  return { windowId, startInWindow: startInWindow as number, endInWindow: endInWindow as number, text };
}

/** §R7.1 — HTTP status → the closed code set. */
function classifyHttpStatus(status: number): ProviderError {
  const code: ProviderErrorCode =
    status === 401 || status === 403
      ? "authentication"
      : status === 429
        ? "rate_limited"
        : status >= 500
          ? "provider_unavailable"
          : status >= 400
            ? "invalid_request"
            : "provider_unavailable";
  return new ProviderError(code, `the provider rejected the request (HTTP ${status})`);
}
