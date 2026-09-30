/**
 * C6 · RMA (§R1.1 / §R6.2 / §R13.0) — the provider TRANSPORT seam.
 *
 * Everything that touches the network lives behind this interface, so:
 *   - no HTTP/SDK detail reaches the application layer (§R1.2);
 *   - tests inject their own transport and therefore run with ZERO real network (§R13.0 / T-RMA-27);
 *   - the caller's `AbortSignal` reaches the wire (§R6.2) — it is passed straight to `fetch`, so an
 *     abort really interrupts the request instead of merely abandoning the promise.
 */

export interface ProviderHttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** ★ The caller's signal — an adapter must propagate it, never swallow it (§R6.2). */
  readonly signal: AbortSignal;
}

export interface ProviderHttpResponse {
  readonly status: number;
  readonly body: string;
}

export interface ProviderTransport {
  send(request: ProviderHttpRequest): Promise<ProviderHttpResponse>;
}

/** The `fetch` shape we depend on (injectable / swappable, and narrow on purpose). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export class MissingFetchError extends Error {
  constructor() {
    super("no global fetch is available to build the default provider transport");
    this.name = "MissingFetchError";
  }
}

/**
 * The default transport: plain HTTP through `fetch`. `fetchImpl` is injectable so a caller (a test,
 * or a future runtime without a global fetch) can supply its own without changing the adapter.
 */
export function createFetchTransport(fetchImpl?: FetchLike): ProviderTransport {
  const impl = fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (impl === undefined) throw new MissingFetchError();
  return {
    async send(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
      const response = await impl(request.url, {
        method: request.method,
        headers: { ...request.headers },
        body: request.body,
        signal: request.signal,
      });
      return { status: response.status, body: await response.text() };
    },
  };
}
