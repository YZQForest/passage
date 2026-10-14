import { describe, expect, it } from "vitest";
// Protocol fixture tests validate adapters, not live provider access.
import {
  complete,
  normalizeUsage,
  estimateCost,
  endpoint,
  parseSSE,
} from "../desktop/providers.mjs";
const request = {
  system: "Evidence only",
  prompt: "Explain [S1]",
  maxTokens: 100,
};
const config = {
  id: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "test-model",
};
const response = (events: unknown[]) =>
  new Response(
    events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
describe("provider protocol", () => {
  it("streams OpenAI-compatible content and final actual usage", async () => {
    let output = "";
    const r = await complete(
      config,
      "secret",
      request,
      new AbortController().signal,
      (delta: string) => (output += delta),
      async () =>
        response([
          { choices: [{ delta: { content: "answer " } }] },
          { choices: [{ delta: { content: "[S1]" } }] },
          {
            usage: {
              prompt_tokens: 45,
              completion_tokens: 8,
              prompt_cache_hit_tokens: 10,
            },
          },
        ]),
    );
    expect(output).toBe("answer [S1]");
    expect(r.usage.actual).toBe(true);
    expect(r.usage.cached).toBe(10);
  });
  it("merges Anthropic start and tail usage", async () => {
    const r = await complete(
      { ...config, id: "anthropic" },
      "key",
      request,
      new AbortController().signal,
      () => {},
      async () =>
        response([
          {
            type: "message_start",
            message: {
              usage: { input_tokens: 10, cache_read_input_tokens: 20 },
            },
          },
          {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "你好" },
          },
          { type: "message_delta", usage: { output_tokens: 5 } },
        ]),
    );
    expect(r.usage).toMatchObject({
      input: 30,
      output: 5,
      cached: 20,
      actual: true,
    });
  });
  it("does not expose Gemini thought text", async () => {
    const r = await complete(
      { ...config, id: "gemini" },
      "key",
      request,
      new AbortController().signal,
      () => {},
      async () =>
        response([
          {
            candidates: [
              {
                content: {
                  parts: [
                    { text: "hidden", thought: true },
                    { text: "answer" },
                  ],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 20,
              candidatesTokenCount: 4,
              thoughtsTokenCount: 6,
            },
          },
        ]),
    );
    expect(r.text).toBe("answer");
    expect(r.usage.output).toBe(10);
  });
  it("handles UTF8 across stream chunks", async () => {
    const encoded = new TextEncoder().encode('data: {"text":"中文"}\n\n');
    const body = new ReadableStream({
      start(c) {
        for (const byte of encoded) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    });
    const rows = [];
    for await (const item of parseSSE(body)) rows.push(item);
    expect(rows).toEqual([{ text: "中文" }]);
  });
  it("maps invalid credentials to user-facing errors", async () => {
    await expect(
      complete(
        config,
        "bad",
        request,
        new AbortController().signal,
        () => {},
        async () => new Response("", { status: 401 }),
      ),
    ).rejects.toThrow("API Key");
  });
  it("rejects insecure remote URLs and does not allow URL credentials", () => {
    expect(() =>
      endpoint({ ...config, baseUrl: "http://evil.test" }, "key", request),
    ).toThrow("HTTPS");
    expect(() =>
      endpoint(
        { ...config, baseUrl: "https://user:pass@evil.test" },
        "key",
        request,
      ),
    ).toThrow("密码");
    expect(
      endpoint(
        { ...config, id: "custom", baseUrl: "http://localhost:11434/v1" },
        "",
        request,
      ).url,
    ).toContain("chat/completions");
  });
  it("distinguishes estimated usage and missing pricing", () => {
    const u = normalizeUsage("openai", null, "123456", "abc");
    expect(u.actual).toBe(false);
    expect(estimateCost(u, {})).toBeNull();
    expect(
      estimateCost(
        { input: 100, output: 50, cached: 10 },
        { inputPrice: 2, outputPrice: 4, cachedPrice: 1 },
      ),
    ).toBeCloseTo(0.00039);
  });
  it("rejects truncated generation but preserves returned usage for logging", async () => {
    await expect(
      complete(
        config,
        "key",
        request,
        new AbortController().signal,
        () => {},
        async () =>
          response([
            {
              choices: [
                { delta: { content: "truncated" }, finish_reason: "length" },
              ],
              usage: { prompt_tokens: 20, completion_tokens: 100 },
            },
          ]),
      ),
    ).rejects.toMatchObject({
      usage: { input: 20, output: 100, actual: true },
    });
  });
});
