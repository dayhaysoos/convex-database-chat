/**
 * OpenRouter provider module.
 *
 * Backend-safe (no Convex runtime imports): consumable from Convex actions,
 * app code, and tests alike. All failures are {@link OpenRouterError}s with
 * a machine-readable `code` and a `retryable` flag.
 */

export {
  OpenRouterError,
  type OpenRouterErrorCode,
  isAbortError,
  parseRetryAfterMs,
  statusToErrorCode,
} from "./errors.js";
export { DEFAULT_RETRY_OPTIONS, type RetryOptions } from "./retry.js";
export {
  streamChatCompletion,
  DEFAULT_HTTP_REFERER,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_X_TITLE,
  type ChatCompletionMessage,
  type ChatCompletionTool,
  type OpenRouterAttribution,
  type StreamChatCompletionOptions,
  type StreamChatCompletionResult,
} from "./streaming.js";
export {
  generateEmbedding,
  DEFAULT_EMBEDDING_MODEL,
  type GenerateEmbeddingOptions,
} from "./embeddings.js";
