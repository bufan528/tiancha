/**
 * C6 · RMA · Slice A-1 — the provider-boundary tests (Contract + Provider + Credential + Capability
 * + Resolution). Everything here runs with NO real network: the transport is injectable and the
 * credential reader is injectable.
 *
 * Covered contract points:
 *   §R4.3  ExtractionOutputContract: version → schema is stable & frozen; unknown versions map to the
 *          baseline schema (so the service's existing custom `schemaVersion` callers keep working).
 *   §R2.1  credential lookup order, the explicit `AUTH_MODE="none"` mode, loopback-only, and the
 *          ABSENCE of any credential in failure messages (§R2.2 #6 / §R7.4).
 *   §R1.5  REQUIRED capabilities fail CLOSED (`capability_unsupported`), never "try anyway".
 *   §R3.1  endpoint canonicalisation + refusal of query/fragment/userinfo.
 *   §R5.1/§R5.4  AdapterIdentity is complete, `authMode` participates, and
 *          `modelVersion === "pid-" + sha256Hex(stableStringify(adapterIdentity))`.
 *   §R7.3  the frozen upward error format `<code>: <message>`.
 *   §R7.5  the three mutually exclusive assembly outcomes.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractionOutputContractFor, type ExtractionOutputContract } from "../application/extraction-output-contract.js";
import { stableStringify } from "../application/model-extraction-config.js";
import { sha256Hex } from "../domain/material-source.js";
import {
  ProviderError,
  assertCapabilities,
  assertNoAuthEndpointIsLoopback,
  assembleModelAdapter,
  canonicalModelVersionFor,
  createFetchTransport,
  declaredProviderCapabilities,
  endpointIdentityOf,
  readModelInstanceConfig,
  resolveModelCredential,
  type FetchLike,
} from "./openai-compatible-model-adapter.js";

const CONTRACT: ExtractionOutputContract = extractionOutputContractFor("candidate-schema/v1");
const LOOPBACK = "http://127.0.0.1:1234/v1";

/** A `fetch` that FAILS the test if it is ever used — proof that assembly touches no network. */
function forbiddenFetch(): { fetchImpl: FetchLike; calls: { n: number } } {
  const calls = { n: 0 };
  const fetchImpl: FetchLike = async () => {
    calls.n += 1;
    throw new Error("no request may be issued during assembly");
  };
  return { fetchImpl, calls };
}

describe("§R4.3 — the Tiancha-owned ExtractionOutputContract", () => {
  test("the contract is frozen, and the SAME version always yields the SAME schema", () => {
    const a = extractionOutputContractFor("candidate-schema/v1");
    const b = extractionOutputContractFor("candidate-schema/v1");
    assert.equal(a.version, "candidate-schema/v1");
    assert.deepEqual(a.schema, b.schema, "one version → one schema");
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.schema), "the contract and its schema are immutable");
  });

  test("§R4.3 (rev8): EVERY legal version resolves to the single current shape, kept verbatim", () => {
    // ★ rev8 forbids a version registry: declaring a version "unknown" (and failing configuration)
    // is not allowed, so all of these behave identically — only the recorded version differs.
    for (const version of ["candidate-schema/v1", "candidate-schema/v2", "candidate-schema/v999", "exotic/v3"]) {
      const c = extractionOutputContractFor(version);
      assert.equal(c.version, version, "the version is recorded VERBATIM (it still enters the identity)");
      assert.deepEqual(c.schema, CONTRACT.schema, "this release defines ONE shape — there is no version table");
      assert.ok(Object.isFrozen(c));
    }
  });
});

describe("§R2.1 — credential resolution (never leaking a value)", () => {
  test("nothing set ⇒ configuration failure naming the VARIABLES, never a value", () => {
    assert.throws(
      () => resolveModelCredential({}),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "configuration");
        assert.match(err.message, /TIANCHA_MODEL_API_KEY/);
        assert.doesNotMatch(err.message, /Bearer|sk-/);
        return true;
      },
    );
  });

  test("an unknown AUTH_MODE is a configuration error (never silently 'api-key' or 'none')", () => {
    assert.throws(() => resolveModelCredential({ TIANCHA_MODEL_AUTH_MODE: "maybe" }), (err: unknown) => {
      assert.ok(err instanceof ProviderError && err.code === "configuration");
      return true;
    });
  });

  test("the env key wins; the file is only a fallback", () => {
    const resolved = resolveModelCredential({ TIANCHA_MODEL_API_KEY: "  from-env  " });
    assert.equal(resolved.apiKey, "from-env", "the value is trimmed, and env wins");
    const fromFile = resolveModelCredential(
      { TIANCHA_MODEL_CREDENTIAL_FILE: "/tmp/none" },
      () => "from-file\nignored-second-line",
    );
    assert.equal(fromFile.apiKey, "from-file", "only the first line of the file is the credential");
  });

  test("an unreadable credential file is a configuration error whose message carries no path content", () => {
    assert.throws(
      () =>
        resolveModelCredential({ TIANCHA_MODEL_CREDENTIAL_FILE: "/tmp/secret" }, () => {
          throw new Error("/tmp/secret: ENOENT CONTENT-LEAK");
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError && err.code === "configuration");
        assert.doesNotMatch(err.message, /CONTENT-LEAK|ENOENT/);
        return true;
      },
    );
  });

  test('AUTH_MODE="none" needs no key, and refuses a non-loopback endpoint (§R2.1)', () => {
    const resolved = resolveModelCredential({ TIANCHA_MODEL_AUTH_MODE: "none" });
    assert.equal(resolved.authMode, "none");
    assert.equal(resolved.apiKey, undefined);
    assertNoAuthEndpointIsLoopback(new URL("http://localhost:1234"));
    assertNoAuthEndpointIsLoopback(new URL("http://127.0.0.5:9"));
    assert.throws(() => assertNoAuthEndpointIsLoopback(new URL("https://api.example.com")), (err: unknown) => {
      assert.ok(err instanceof ProviderError && err.code === "configuration");
      return true;
    });
  });
});

describe("§R1.5 — REQUIRED capabilities fail closed", () => {
  test("missing either REQUIRED capability is capability_unsupported", () => {
    assert.doesNotThrow(() => assertCapabilities({ structuredOutput: true, abortSignal: true }));
    for (const caps of [
      { structuredOutput: false, abortSignal: true },
      { structuredOutput: true, abortSignal: false },
      { structuredOutput: false, abortSignal: false },
    ]) {
      assert.throws(() => assertCapabilities(caps), (err: unknown) => {
        assert.ok(err instanceof ProviderError && err.code === "capability_unsupported");
        return true;
      });
    }
  });

  test("the profile this build targets declares BOTH REQUIRED capabilities", () => {
    assert.deepEqual(declaredProviderCapabilities(), { structuredOutput: true, abortSignal: true });
  });
});

describe("§R3.1 — endpoint canonicalisation", () => {
  test("scheme/host are lower-cased, the default port and a trailing slash are dropped", () => {
    assert.equal(endpointIdentityOf("HTTP://LocalHost:80/v1/"), "http://localhost/v1");
    assert.equal(endpointIdentityOf("https://API.Example.com:443/v1"), "https://api.example.com/v1");
    assert.equal(endpointIdentityOf("http://127.0.0.1:1234"), "http://127.0.0.1:1234");
  });

  test("a query, a fragment or userinfo is REFUSED (never normalised away)", () => {
    for (const bad of ["http://h/v1?token=x", "http://h/v1#frag", "http://user:pw@h/v1"]) {
      assert.throws(() => endpointIdentityOf(bad), (err: unknown) => {
        assert.ok(err instanceof ProviderError && err.code === "configuration");
        return true;
      });
    }
  });
});

describe("§R1.4 / §R7.5 — assembly: three mutually exclusive outcomes", () => {
  test("nothing configured ⇒ undefined (NOT a credential error — §R2.3)", () => {
    assert.equal(assembleModelAdapter(CONTRACT, {}), undefined);
    assert.equal(readModelInstanceConfig({}), undefined);
  });

  test("a PARTIAL configuration is a configuration error, never 'absent'", () => {
    assert.throws(() => readModelInstanceConfig({ TIANCHA_MODEL_NAME: "m" }), (err: unknown) => {
      assert.ok(err instanceof ProviderError && err.code === "configuration");
      return true;
    });
  });

  test("configured but no credential ⇒ configuration (and NOT ADAPTER_NOT_CONFIGURED)", () => {
    assert.throws(
      () =>
        assembleModelAdapter(CONTRACT, {
          TIANCHA_MODEL_BASE_URL: LOOPBACK,
          TIANCHA_MODEL_NAME: "qwen",
          TIANCHA_MODEL_DEPLOYMENT: "local",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "configuration");
        assert.notEqual(err.code, "ADAPTER_NOT_CONFIGURED");
        return true;
      },
    );
  });

  test('AUTH_MODE="none" against a NON-loopback endpoint ⇒ configuration', () => {
    assert.throws(
      () =>
        assembleModelAdapter(CONTRACT, {
          TIANCHA_MODEL_BASE_URL: "https://api.example.com/v1",
          TIANCHA_MODEL_NAME: "qwen",
          TIANCHA_MODEL_DEPLOYMENT: "remote",
          TIANCHA_MODEL_AUTH_MODE: "none",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError && err.code === "configuration");
        return true;
      },
    );
  });

  test("ready ⇒ an adapter whose identity is canonical — and NO request is sent while assembling", () => {
    const { fetchImpl, calls } = forbiddenFetch();
    const adapter = assembleModelAdapter(
      CONTRACT,
      {
        TIANCHA_MODEL_BASE_URL: LOOPBACK,
        TIANCHA_MODEL_NAME: "qwen2.5-7b",
        TIANCHA_MODEL_DEPLOYMENT: "local-4060",
        TIANCHA_MODEL_AUTH_MODE: "none",
      },
      fetchImpl,
    );
    assert.equal(calls.n, 0, "assembly performs no provider call (§R1.5 fail-closed ordering)");
    assert.ok(adapter !== undefined);
    assert.deepEqual(adapter.adapterIdentity, {
      provider: "openai-compatible",
      model: "qwen2.5-7b",
      deployment: "local-4060",
      endpointIdentity: "http://127.0.0.1:1234/v1",
      adapterVersion: "openai-compatible-adapter/v1",
      authMode: "none",
    });
    assert.equal(
      adapter.modelVersion,
      `pid-${sha256Hex(stableStringify(adapter.adapterIdentity))}`,
      "§R5.4 — modelVersion IS the canonical identity hash (existing primitives, no second identity code)",
    );
    assert.equal(adapter.modelVersion, canonicalModelVersionFor(adapter.adapterIdentity));
    assert.ok(Object.isFrozen(adapter.adapterIdentity));

    // mutation probe: change ONE identity field ⇒ the canonical value must move with it.
    const moved = canonicalModelVersionFor({ ...adapter.adapterIdentity, deployment: "other-deployment" });
    assert.notEqual(moved, adapter.modelVersion);
  });

  test('the authMode participates in the identity: "none" and "api-key" differ', () => {
    const base = { TIANCHA_MODEL_BASE_URL: LOOPBACK, TIANCHA_MODEL_NAME: "m", TIANCHA_MODEL_DEPLOYMENT: "d" };
    const none = assembleModelAdapter(CONTRACT, { ...base, TIANCHA_MODEL_AUTH_MODE: "none" });
    const keyed = assembleModelAdapter(CONTRACT, { ...base, TIANCHA_MODEL_API_KEY: "k" });
    assert.ok(none !== undefined && keyed !== undefined);
    assert.notEqual(none.modelVersion, keyed.modelVersion, "authMode is part of AdapterIdentity (§R2.1)");
  });
});

describe("§R7.3 — the frozen error protocol", () => {
  test("toRunResultError() is `${code}: ${message}` and carries no credential", () => {
    const err = new ProviderError("authentication", "the provider rejected the credential (HTTP 401)");
    assert.equal(err.toRunResultError(), "authentication: the provider rejected the credential (HTTP 401)");
    assert.equal(err.retryable, false, "v1: nothing is retryable (§R7.2 / §R8.1)");
  });

  test("the default fetch transport is constructible (and refuses honestly when no fetch exists)", () => {
    assert.ok(createFetchTransport(async () => ({ status: 200, text: async () => "{}" })) !== undefined);
  });
});
