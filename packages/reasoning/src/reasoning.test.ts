import { describe, expect, it, vi } from "vitest";
import {
  ReasoningError,
  createJsonHttpReasoningProvider,
  reasoningProviderFromEnvironment,
  type ReasoningRequest,
} from "./index.js";

const request: ReasoningRequest = {
  input: { risk: "critical" },
  instructions: "Find failure modes.",
  maxCostUsd: 1,
  maxOutputTokens: 1_000,
  outputSchema: { type: "object" },
  requestId: "challenge-001",
  schemaVersion: 1,
  task: "challenger-analysis",
};

describe("JSON HTTP reasoning provider", () => {
  it("sends one bounded structured request and records provider usage", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: { summary: "Two failure modes." },
          usage: {
            estimatedCostUsd: 0.0123,
            inputTokens: 250,
            outputTokens: 80,
          },
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const provider = createJsonHttpReasoningProvider({
      apiKey: "secret-value",
      endpoint: "https://reasoning.example.test/v1/reason",
      fetch,
      model: "challenger-1",
      providerId: "example-gateway",
    });

    await expect(provider.reason(request)).resolves.toEqual({
      output: { summary: "Two failure modes." },
      provider: { id: "example-gateway", model: "challenger-1" },
      requestId: "challenge-001",
      usage: {
        durationMs: expect.any(Number),
        estimatedCostUsd: 0.0123,
        inputTokens: 250,
        outputTokens: 80,
        totalTokens: 330,
      },
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://reasoning.example.test/v1/reason");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      authorization: "Bearer secret-value",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({ ...request, model: "challenger-1" });
  });

  it("rejects insecure remote endpoints before making a request", () => {
    expect(() =>
      createJsonHttpReasoningProvider({
        endpoint: "http://reasoning.example.test/v1/reason",
        fetch: vi.fn(),
        model: "challenger-1",
        providerId: "example-gateway",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ReasoningError>>({ code: "REASONING_CONFIG_INVALID" }),
    );
  });

  it("accepts loopback HTTP for local provider gateways", () => {
    expect(() =>
      createJsonHttpReasoningProvider({
        endpoint: "http://127.0.0.1:11434/v1/reason",
        fetch: vi.fn(),
        model: "local-model",
        providerId: "local-gateway",
      }),
    ).not.toThrow();
  });

  it("returns typed failures for non-success, invalid, and oversized responses", async () => {
    const cases = [
      new Response("upstream unavailable", { status: 503 }),
      new Response(JSON.stringify({ output: {}, usage: { inputTokens: -1, outputTokens: 2 } }), {
        status: 200,
      }),
      new Response("x".repeat(1_000_001), { status: 200 }),
    ];
    for (const response of cases) {
      const provider = createJsonHttpReasoningProvider({
        endpoint: "https://reasoning.example.test/v1/reason",
        fetch: vi.fn().mockResolvedValue(response),
        model: "challenger-1",
        providerId: "example-gateway",
      });
      await expect(provider.reason(request)).rejects.toEqual(
        expect.objectContaining<Partial<ReasoningError>>({
          code: "REASONING_PROVIDER_FAILED",
        }),
      );
    }
  });

  it("loads an explicitly configured provider without requiring an API key", () => {
    expect(
      reasoningProviderFromEnvironment(
        {
          MARU_REASONING_MODEL: "local-model",
          MARU_REASONING_PROVIDER: "local-gateway",
          MARU_REASONING_URL: "http://localhost:11434/v1/reason",
        },
        vi.fn(),
      ),
    ).toEqual(expect.objectContaining({ id: "local-gateway", model: "local-model" }));
    expect(reasoningProviderFromEnvironment({}, vi.fn())).toBeUndefined();
    expect(() =>
      reasoningProviderFromEnvironment({ MARU_REASONING_URL: "https://example.test" }, vi.fn()),
    ).toThrowError(
      expect.objectContaining<Partial<ReasoningError>>({ code: "REASONING_CONFIG_INVALID" }),
    );
  });
});
