import { OpenRouterError } from "./errors.js";
import { DEFAULT_RETRY_OPTIONS, type RetryOptions } from "./retry.js";
import { runAttempt, DEFAULT_REQUEST_TIMEOUT_MS } from "./attempt.js";
import { DEFAULT_HTTP_REFERER, DEFAULT_X_TITLE } from "./streaming.js";

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export interface GenerateEmbeddingOptions {
  apiKey: string;
  text: string;
  model?: string;
  httpReferer?: string;
  xTitle?: string;
  maxRetries?: number;
  requestTimeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  abortSignal?: AbortSignal;
}

export async function generateEmbedding(
  options: GenerateEmbeddingOptions
): Promise<number[]> {
  if (!options.apiKey) {
    throw new OpenRouterError("OpenRouter API key is required", {
      code: "invalid_request",
      retryable: false,
    });
  }

  const retry: RetryOptions = {
    maxRetries: options.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs,
  };

  return runAttempt({
    url: OPENROUTER_EMBEDDINGS_URL,
    init: {
      method: "POST",
      headers: headersFor(options),
      body: JSON.stringify({
        model: options.model ?? DEFAULT_EMBEDDING_MODEL,
        input: options.text,
      }),
    },
    callerSignal: options.abortSignal,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    retry,
    consume: async ({ response }) => parseEmbedding(response),
  });
}

function headersFor(options: GenerateEmbeddingOptions): Record<string, string> {
  return {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": options.httpReferer ?? DEFAULT_HTTP_REFERER,
    "X-Title": options.xTitle ?? DEFAULT_X_TITLE,
  };
}

async function parseEmbedding(response: Response): Promise<number[]> {
  let data: { data?: Array<{ embedding?: unknown }> };
  try {
    data = await response.json();
  } catch {
    throw new OpenRouterError(
      "OpenRouter embeddings response was not valid JSON",
      { code: "unknown", retryable: false }
    );
  }

  const embedding = data.data?.[0]?.embedding;
  if (
    !Array.isArray(embedding) ||
    !embedding.every((v) => typeof v === "number")
  ) {
    throw new OpenRouterError("OpenRouter embeddings response missing data", {
      code: "unknown",
      retryable: false,
    });
  }

  return embedding;
}
