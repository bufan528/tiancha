/**
 * C6 · RMA (§R2) — credential resolution, strictly inside the provider boundary.
 *
 * Sources (§R2.1, only two): ① the env variable `TIANCHA_MODEL_API_KEY`, ② the project-EXTERNAL file
 * named by `TIANCHA_MODEL_CREDENTIAL_FILE`. Lookup order is frozen, first hit wins.
 *
 * ★ AUTH MODE (§R2.1, rev3): "no auth" is NOT "credential missing" — it is an EXPLICITLY SELECTED
 * execution mode (`TIANCHA_MODEL_AUTH_MODE="none"`), only allowed against a loopback endpoint, and it
 * must enter the identity (the caller does that; see `AdapterIdentity.authMode`).
 *
 * ★ A credential NEVER leaves this boundary: it is not persisted, not logged, not put into a snapshot
 * and never enters `RunResult.error` (§R2.2 / §R2.4). Failure messages below are deliberately
 * credential-free: they may name a VARIABLE or a FILE PATH, never a value, length or fragment.
 */

import { readFileSync } from "node:fs";
import { ProviderError, type ProviderErrorCode } from "./model-provider-errors.js";

export const MODEL_API_KEY_ENV = "TIANCHA_MODEL_API_KEY";
export const MODEL_CREDENTIAL_FILE_ENV = "TIANCHA_MODEL_CREDENTIAL_FILE";
export const MODEL_AUTH_MODE_ENV = "TIANCHA_MODEL_AUTH_MODE";

export type AuthMode = "api-key" | "none";

/** The resolved credential (inside the boundary only). */
export interface ResolvedCredential {
  readonly authMode: AuthMode;
  /** Present iff `authMode === "api-key"`. Never logged, never persisted. */
  readonly apiKey?: string;
}

export type CredentialEnvironment = Readonly<Record<string, string | undefined>>;

/** Read one file as a single-line credential WITHOUT echoing its content on failure. */
export type CredentialFileReader = (path: string) => string;

const defaultReadFile: CredentialFileReader = (path) => readFileSync(path, "utf8");

function fail(code: ProviderErrorCode, message: string): never {
  throw new ProviderError(code, message);
}

/**
 * Resolve the credential for this process.
 *
 *  • `AUTH_MODE` unset or `"api-key"` ⇒ a key is REQUIRED (env first, then the file); missing ⇒
 *    `configuration`.
 *  • `AUTH_MODE="none"` ⇒ no key; the CALLER must additionally prove the endpoint is loopback and
 *    must carry `authMode` into the identity.
 *  • an unknown `AUTH_MODE` value ⇒ `configuration` (never silently treated as "api-key" or "none").
 */
export function resolveModelCredential(
  env: CredentialEnvironment,
  readFile: CredentialFileReader = defaultReadFile,
): ResolvedCredential {
  const rawMode = (env[MODEL_AUTH_MODE_ENV] ?? "").trim();
  if (rawMode !== "" && rawMode !== "api-key" && rawMode !== "none") {
    fail("configuration", `${MODEL_AUTH_MODE_ENV} must be "api-key" or "none"`);
  }
  const authMode: AuthMode = rawMode === "none" ? "none" : "api-key";
  if (authMode === "none") return Object.freeze({ authMode });

  // ① env
  const fromEnv = env[MODEL_API_KEY_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return Object.freeze({ authMode, apiKey: fromEnv.trim() });
  }

  // ② project-external file
  const filePath = env[MODEL_CREDENTIAL_FILE_ENV];
  if (typeof filePath === "string" && filePath.trim() !== "") {
    let content: string;
    try {
      content = readFile(filePath.trim());
    } catch {
      // ★ No file content, no errno detail: only the fact that the named file could not be read.
      fail("configuration", `${MODEL_CREDENTIAL_FILE_ENV} names a file that could not be read`);
    }
    const key = content.split(/\r?\n/, 1)[0]!.trim();
    if (key === "") fail("configuration", `${MODEL_CREDENTIAL_FILE_ENV} is empty`);
    return Object.freeze({ authMode, apiKey: key });
  }

  fail("configuration", `no model credential: neither ${MODEL_API_KEY_ENV} nor ${MODEL_CREDENTIAL_FILE_ENV} is set`);
}

/**
 * §R2.1 — `AUTH_MODE="none"` is only ever allowed against a LOOPBACK endpoint. Non-loopback ⇒ refuse
 * at assembly time (never fall back to "try it without auth anyway").
 */
export function assertNoAuthEndpointIsLoopback(endpoint: URL): void {
  const host = endpoint.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");
  if (!loopback) fail("configuration", `${MODEL_AUTH_MODE_ENV}="none" is only allowed for a loopback endpoint`);
}
