import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterError, generateEmbedding } from "./index.js";

function embeddingResponse(): Response {
  return new Response(
    JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    { status: 200 }
  );
}

describe("generateEmbedding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the embedding from a successful response", async () => {
    const fetchMock = vi.fn(async () => embeddingResponse());
    vi.stubGlobal("fetch", fetchMock);

    const embedding = await generateEmbedding({
      apiKey: "test-key",
      text: "hello",
      baseDelayMs: 1,
      maxDelayMs: 1,
    });

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      model: "openai/text-embedding-3-small",
      input: "hello",
    });
  });

  it("retries a retryable status and succeeds", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
    fetchMock.mockImplementationOnce(async () =>
      new Response("nope", { status: 503 })
    );
    fetchMock.mockImplementationOnce(async () => embeddingResponse());
    vi.stubGlobal("fetch", fetchMock);

    const embedding = await generateEmbedding({
      apiKey: "test-key",
      text: "hello",
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 1,
    });

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable statuses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("forbidden", { status: 403 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await generateEmbedding({
      apiKey: "test-key",
      text: "hello",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("unauthorized");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-JSON body as unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>not json</html>", { status: 200 }))
    );

    const error = await generateEmbedding({
      apiKey: "test-key",
      text: "hello",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("unknown");
    expect(error.message).toContain("not valid JSON");
  });

  it("rejects a response missing the embedding array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ embedding: "nope" }] }), {
          status: 200,
        })
      )
    );

    const error = await generateEmbedding({
      apiKey: "test-key",
      text: "hello",
    }).catch((e) => e);

    expect(error.code).toBe("unknown");
    expect(error.message).toContain("missing data");
  });

  it("times out when the provider never responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          })
      )
    );

    const error = await generateEmbedding({
      apiKey: "test-key",
      text: "hello",
      requestTimeoutMs: 20,
      maxRetries: 0,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("timeout");
  });
});
