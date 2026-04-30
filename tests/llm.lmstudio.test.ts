/**
 * LM Studio provider parity tests.
 *
 * Verifies that DREAMGRAPH_LLM_PROVIDER=lmstudio resolves to the
 * OpenAI-compat code path with LM-Studio-specific defaults, and that
 * an LM-Studio-shaped response parses cleanly into LlmResponse.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseLlmConfig, initLlmProvider, getLlmProvider } from "../src/cognitive/llm.js";

function withEnv(overrides: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> {
  const originals: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) {
    originals[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

describe("parseLlmConfig — lmstudio", () => {
  it("resolves provider=lmstudio with LM Studio defaults when no other vars set", async () => {
    await withEnv(
      {
        DREAMGRAPH_LLM_PROVIDER: "lmstudio",
        DREAMGRAPH_LLM_URL: undefined,
        DREAMGRAPH_LLM_API_KEY: undefined,
        DREAMGRAPH_LLM_MODEL: undefined,
      },
      () => {
        const cfg = parseLlmConfig();
        expect(cfg.provider).toBe("lmstudio");
        expect(cfg.baseUrl).toBe("http://localhost:1234/v1");
        expect(cfg.apiKey).toBe("lm-studio");
        expect(cfg.model).toBe("");
      },
    );
  });

  it("respects user-supplied URL/model/API key overrides", async () => {
    await withEnv(
      {
        DREAMGRAPH_LLM_PROVIDER: "lmstudio",
        DREAMGRAPH_LLM_URL: "http://10.0.0.5:9999/v1",
        DREAMGRAPH_LLM_API_KEY: "custom-key",
        DREAMGRAPH_LLM_MODEL: "qwen2.5-coder-7b-instruct",
      },
      () => {
        const cfg = parseLlmConfig();
        expect(cfg.baseUrl).toBe("http://10.0.0.5:9999/v1");
        expect(cfg.apiKey).toBe("custom-key");
        expect(cfg.model).toBe("qwen2.5-coder-7b-instruct");
      },
    );
  });
});

describe("initLlmProvider — lmstudio", () => {
  it("constructs an OpenAI-compat provider whose name is reported as 'lmstudio'", async () => {
    await withEnv(
      {
        DREAMGRAPH_LLM_PROVIDER: "lmstudio",
        DREAMGRAPH_LLM_URL: undefined,
        DREAMGRAPH_LLM_API_KEY: undefined,
        DREAMGRAPH_LLM_MODEL: "test-model",
      },
      () => {
        const p = initLlmProvider();
        expect(p.name).toBe("lmstudio");
        // factory wires through the singleton getter as well
        expect(getLlmProvider().name).toBe("lmstudio");
      },
    );
  });

  it("hits /chat/completions on the LM Studio base URL and parses LM-Studio-shaped responses", async () => {
    const fetchMock = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe("http://localhost:1234/v1/chat/completions");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string> | undefined;
      // Auth header is sent unconditionally (LM Studio ignores it but our
      // dialect sends it). Default key is "lm-studio".
      expect(headers?.Authorization).toBe("Bearer lm-studio");

      const body = JSON.parse(init!.body as string) as { model: string; messages: unknown[] };
      expect(body.model).toBe("test-model");
      expect(body.messages).toHaveLength(1);

      return new Response(
        JSON.stringify({
          // LM Studio echoes the long file-path-shaped model id
          model: "test-model",
          choices: [
            {
              message: { role: "assistant", content: "hi from lm studio" },
              finish_reason: "stop",
            },
          ],
          usage: { completion_tokens: 7 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    try {
      await withEnv(
        {
          DREAMGRAPH_LLM_PROVIDER: "lmstudio",
          DREAMGRAPH_LLM_URL: undefined,
          DREAMGRAPH_LLM_API_KEY: undefined,
          DREAMGRAPH_LLM_MODEL: "test-model",
        },
        async () => {
          const p = initLlmProvider();
          const r = await p.complete([{ role: "user", content: "hello" }]);
          expect(r.text).toBe("hi from lm studio");
          expect(r.model).toBe("test-model");
          expect(r.tokensUsed).toBe(7);
          expect(r.stopReason).toBe("stop");
          expect(fetchMock).toHaveBeenCalledOnce();
        },
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
