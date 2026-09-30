/**
 * C6 · RMA (§R7) — provider error classification and the error PROTOCOL.
 *
 * Internal shape (§R7.3): `ProviderError { code, retryable, message }`.
 * Upward carriage (§R7.3): `RunResult.error` is a STRING, so the frozen format is
 * `${code}: ${message}` — with ONE frozen historical exception: a timeout keeps F2's existing
 * `extraction timed out after Nms` text, which this slice must NOT "tidy up".
 *
 * ★ Sensitive-information isolation (§R7.4): a message must NEVER carry a credential (not even a
 * prefix/length/fragment), a raw provider response body, a request body, HTTP headers, a request URL
 * that may embed a token, or a vendor error object/stack. Building a `ProviderError` from a vendor
 * error must go through `providerErrorFrom` below, which keeps only the classification + a safe text.
 */

/** The CLOSED set of machine-readable codes (§R7.1). Nothing outside this set may be emitted. */
export type ProviderErrorCode =
  | "configuration"
  | "authentication"
  | "capability_unsupported"
  | "invalid_request"
  | "rate_limited"
  | "provider_unavailable"
  | "network"
  | "timeout"
  | "abort"
  | "malformed_response";

export const PROVIDER_ERROR_CODES: readonly ProviderErrorCode[] = Object.freeze([
  "configuration",
  "authentication",
  "capability_unsupported",
  "invalid_request",
  "rate_limited",
  "provider_unavailable",
  "network",
  "timeout",
  "abort",
  "malformed_response",
]);

/**
 * v1: EVERY code is non-retryable (§R7.2 / §R8.1 `maxAttempts = 1`). The flag is kept as an explicit
 * property for the future, but no code may ever be used for an automatic retry in v1.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: ProviderErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
  }

  /** §R7.3 — the frozen upward format for `RunResult.error`. */
  toRunResultError(): string {
    return `${this.code}: ${this.message}`;
  }
}

/**
 * Classify a NON-caller abort failure. When the caller's signal already aborted, the caller MUST use
 * `ProviderError("abort" | "timeout", …)` instead (§R6.5) — a vendor cancellation error must never
 * leak as `network` / `provider_unavailable` / `malformed_response`.
 */
export function providerErrorFrom(err: unknown, fallbackCode: ProviderErrorCode, message: string): ProviderError {
  if (err instanceof ProviderError) return err;
  return new ProviderError(fallbackCode, message);
}

/** Is this a `ProviderError`? (Used by the assembly layer to distinguish its three paths, §R7.5.) */
export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}
