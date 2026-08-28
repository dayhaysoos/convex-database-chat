import {
  OpenRouterError,
  isAbortError,
  httpErrorFromResponse,
} from "./errors.js";
import {
  DEFAULT_RETRY_OPTIONS,
  abortableSleep,
  backoffDelayMs,
  type RetryOptions,
} from "./retry.js";

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;

export interface GenerateEmbeddingOptions {
  apiKey: string;
  text: string;
  model?: string;
  referer?: string;
  title?: string;
  maxRetries?: number;
  requestTimeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
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
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;

  for (let attempt = 1; ; attempt++) {
    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    const dispose = () => clearTimeout(timer);

    let response: Response;
    try {
      response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
        method: "POST",
        headers: headersFor(options),
        body: JSON.stringify({
          model: options.model ?? DEFAULT_EMBEDDING_MODEL,
          input: options.text,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      dispose();
      const timeout = timedOut
        ? new OpenRouterError(
            `Embedding request timed out after ${requestTimeoutMs}ms`,
            { code: "timeout", retryable: true }
          )
        : isAbortError(error)
          ? new OpenRouterError("Embedding request was aborted", {
              code: "aborted",
              retryable: false,
            })
          : undefined;
      if (timeout) {
        await failOrRetry(timeout, { attempt, retry });
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      await failOrRetry(
        new OpenRouterError(`Network error: ${message}`, {
          code: "network_error",
          retryable: true,
        }),
        { attempt, retry }
      );
      continue;
    }

    if (!response.ok) {
      dispose();
      const error = await httpErrorFromResponse(response);
      await failOrRetry(error, { attempt, retry });
      continue;
    }

    try {
      return await parseEmbedding(response);
    } catch (error) {
      if (timedOut || isAbortError(error)) {
        await failOrRetry(
          new OpenRouterError(
            `Embedding request timed out after ${requestTimeoutMs}ms`,
            { code: "timeout", retryable: true }
          ),
          { attempt, retry }
        );
        continue;
      }
      throw error;
    } finally {
      dispose();
    }
  }
}

function headersFor(options: GenerateEmbeddingOptions): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
  };
  if (options.referer) {
    headers["HTTP-Referer"] = options.referer;
  }
  if (options.title) {
    headers["X-Title"] = options.title;
  }
  return headers;
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

async function failOrRetry(
  error: OpenRouterError,
  context: { attempt: number; retry: RetryOptions }
): Promise<void> {
  if (!error.retryable || context.attempt > context.retry.maxRetries) {
    throw error;
  }
  await abortableSleep(
    backoffDelayMs(context.attempt, context.retry, error.retryAfterMs)
  );
}
