/**
 * OpenAI-compatible provider — strict json_schema → json_object fallback.
 *
 * Provider-agnostic safeguard: when an OpenAI-compat endpoint (LM Studio,
 * Ollama-behind-shim, etc.) rejects `response_format: json_schema strict:true`,
 * the provider should retry once with `{ type: "json_object" }`, log a warning,
 * and cache the downgrade for the rest of the process to avoid wasting a
 * round trip on every subsequent call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initLlmProvider, _resetJsonSchemaDowngradeForTest } from "../src/cognitive/llm.js";

function envScope(overrides: Record<string, string | undefined>): () => void {
  const originals: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) {
    originals[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  return () => {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

describe("OpenAI-compat — strict json_schema fallback", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    _resetJsonSchemaDowngradeForTest();
    restoreEnv = envScope({
      DREAMGRAPH_LLM_PROVIDER: "lmstudio",
      DREAMGRAPH_LLM_URL: undefined,
      DREAMGRAPH_LLM_API_KEY: undefined,
      DREAMGRAPH_LLM_MODEL: "fallback-model",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it("retries with json_object after a 400 'response_format json_schema not supported'", async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (_url: Request | string | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      calls.push({ body });

      // First call: strict schema → reject
      if (calls.length === 1) {
        expect(body.response_format).toEqual({
          type: "json_schema",
          json_schema: { name: "test_schema", strict: true, schema: { type: "object" } },
        });
        return new Response(
          JSON.stringify({
            error: {
              message: "response_format json_schema is not supported by this model",
              type: "invalid_request_error",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Second call: must be the downgraded json_object form
      expect(body.response_format).toEqual({ type: "json_object" });
      return new Response(
        JSON.stringify({
          model: "fallback-model",
          choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
          usage: { completion_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const p = initLlmProvider();
    const r = await p.complete([{ role: "user", content: "test" }], {
      jsonSchema: { name: "test_schema", schema: { type: "object" } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.text).toBe("{\"ok\":true}");
  });

  it("caches the downgrade so subsequent requests skip the strict attempt", async () => {
    const fetchMock = vi.fn(async (_url: Request | string | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);

      // First-ever call: reject strict schema
      if (fetchMock.mock.calls.length === 1) {
        expect(body.response_format.type).toBe("json_schema");
        return new Response(
          JSON.stringify({ error: { message: "json_schema unsupported" } }),
          { status: 400 },
        );
      }

      // All subsequent calls: must be json_object on first try
      expect(body.response_format).toEqual({ type: "json_object" });
      return new Response(
        JSON.stringify({
          model: "fallback-model",
          choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const p = initLlmProvider();
    const opts = { jsonSchema: { name: "s", schema: { type: "object" } } };

    // First request: strict (400) + retry json_object → 2 calls
    await p.complete([{ role: "user", content: "1" }], opts);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second request: cached downgrade → 1 call only, json_object straight away
    await p.complete([{ role: "user", content: "2" }], opts);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Third request: same
    await p.complete([{ role: "user", content: "3" }], opts);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not downgrade on non-schema 4xx errors (e.g. auth failures)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const p = initLlmProvider();
    await expect(
      p.complete([{ role: "user", content: "x" }], {
        jsonSchema: { name: "s", schema: { type: "object" } },
      }),
    ).rejects.toThrow(/401/);

    // No retry — auth errors must surface immediately.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
