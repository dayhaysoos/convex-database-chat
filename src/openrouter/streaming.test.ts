import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenRouterError,
  streamChatCompletion,
  type StreamChatCompletionOptions,
} from "./index.js";

const encoder = new TextEncoder();

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentChunk(text: string): string {
  return sseData({ choices: [{ delta: { content: text } }] });
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function hangingResponse(init?: { signal?: AbortSignal }): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      init?.signal?.addEventListener("abort", () => {
        controller.error(
          Object.assign(new Error("The operation was aborted"), {
            name: "AbortError",
          })
        );
      });
    },
  });
  return new Response(stream, { status: 200 });
}

function baseOptions(
  overrides?: Partial<StreamChatCompletionOptions>
): StreamChatCompletionOptions {
  return {
    apiKey: "test-key",
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
    onChunk: async () => {},
    baseDelayMs: 1,
    maxDelayMs: 1,
    ...overrides,
  };
}

describe("streamChatCompletion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams deltas through onChunk and returns accumulated content", async () => {
    const deltas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          contentChunk("Hello"),
          contentChunk(" world"),
          "data: [DONE]\n\n",
        ])
      )
    );

    const result = await streamChatCompletion(
      baseOptions({ onChunk: async (delta) => deltas.push(delta) })
    );

    expect(result.content).toBe("Hello world");
    expect(result.toolCalls).toBeUndefined();
    expect(deltas).toEqual(["Hello", " world"]);
  });

  it("flushes a trailing SSE line that lacks a terminating newline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([contentChunk("end"), `data: ${JSON.stringify({ choices: [{ delta: { content: "!" } }] })}`])
      )
    );

    const result = await streamChatCompletion(baseOptions());

    expect(result.content).toBe("end!");
  });

  it("accumulates tool call deltas split across chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: { name: "search", arguments: '{"qu' },
                    },
                  ],
                },
              },
            ],
          }),
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: 'ery":"react"}' } }],
                },
              },
            ],
          }),
        ])
      )
    );

    const result = await streamChatCompletion(baseOptions());

    expect(result.content).toBe("");
    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "search", arguments: '{"query":"react"}' },
    ]);
  });

  it("retries a retryable status and succeeds on the next attempt", async () => {
    const fetchMock = vi.fn(
      async () => new Response("server exploded", { status: 500 })
    );
    fetchMock.mockImplementationOnce(async () =>
      new Response("server exploded", { status: 500 })
    );
    fetchMock.mockImplementationOnce(async () =>
      sseResponse([contentChunk("recovered")])
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamChatCompletion(baseOptions({ maxRetries: 2 }));

    expect(result.content).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable statuses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("bad key", { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await streamChatCompletion(baseOptions()).catch((e) => e);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("unauthorized");
    expect(error.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces Retry-After from a rate limit when retries are exhausted", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("slow down", {
        status: 429,
        headers: { "Retry-After": "120" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await streamChatCompletion(
      baseOptions({ maxRetries: 0 })
    ).catch((e) => e);

    expect(error.code).toBe("rate_limited");
    expect(error.retryAfterMs).toBe(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries once content has been emitted", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(contentChunk("partial")));
        controller.error(new Error("connection reset"));
      },
    });
    const fetchMock = vi.fn(async () => new Response(stream, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await streamChatCompletion(
      baseOptions({ maxRetries: 3 })
    ).catch((e) => e);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out when the first byte never arrives", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, init?: { signal?: AbortSignal }) =>
        hangingResponse(init)
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await streamChatCompletion(
      baseOptions({ requestTimeoutMs: 30, maxRetries: 0 })
    ).catch((e) => e);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("timeout");
  });

  it("retries a first-byte timeout when nothing was emitted", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, init?: { signal?: AbortSignal }) =>
        hangingResponse(init)
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await streamChatCompletion(
      baseOptions({ requestTimeoutMs: 20, maxRetries: 1 })
    ).catch((e) => e);

    expect(error.code).toBe("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a pre-aborted signal as aborted without attempting a retry", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn(
      async (_url: unknown, init?: { signal?: AbortSignal }) => {
        if (init?.signal?.aborted) {
          throw Object.assign(new Error("The operation was aborted"), {
            name: "AbortError",
          });
        }
        return sseResponse([contentChunk("nope")]);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await streamChatCompletion(
      baseOptions({ abortSignal: controller.signal, maxRetries: 3 })
    ).catch((e) => e);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
