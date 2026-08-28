/**
 * Typed error taxonomy for OpenRouter API failures.
 *
 * Every failure surfaced by the provider module is an {@link OpenRouterError},
 * so callers can branch on `code` instead of parsing error strings.
 */

export type OpenRouterErrorCode =
  /** 401/403 - the API key is missing, invalid, or lacks access. */
  | "unauthorized"
  /** 429 - rate limited by the provider. */
  | "rate_limited"
  /** 5xx - the provider failed server-side. */
  | "provider_error"
  /** The request never reached the provider (DNS, socket, TLS...). */
  | "network_error"
  /** The request exceeded the configured timeout. */
  | "timeout"
  /** The caller's abort signal fired. */
  | "aborted"
  /** Any other 4xx - the request itself was rejected. */
  | "invalid_request"
  /** Anything that does not fit the codes above. */
  | "unknown";

export interface OpenRouterErrorOptions {
  code: OpenRouterErrorCode;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;
}

/**
 * Error thrown by the OpenRouter provider module. `retryable` reflects the
 * classification only - whether a retry is safe is also bounded by the
 * caller's state (e.g. content already streamed is never re-sent).
 */
export class OpenRouterError extends Error {
  readonly code: OpenRouterErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(message: string, options: OpenRouterErrorOptions) {
    super(message);
    this.name = "OpenRouterError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Statuses that are worth retrying with backoff. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function statusToErrorCode(status: number): OpenRouterErrorCode {
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 408) {
    return "timeout";
  }
  if (status >= 500) {
    return "provider_error";
  }
  return "invalid_request";
}

/**
 * Parse a Retry-After header value (delta-seconds form). HTTP-date form is
 * deliberately unsupported - it would require a clock assumption this module
 * does not want; the backoff ceiling bounds the wait instead.
 */
export function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds * 1000;
}

/**
 * Build an OpenRouterError from a non-OK response, reading enough of the body
 * to make the message diagnosable without pulling a huge payload into memory.
 */
export async function httpErrorFromResponse(
  response: {
    status: number;
    headers: { get(name: string): string | null };
    text(): Promise<string>;
  }
): Promise<OpenRouterError> {
  const status = response.status;
  const code = statusToErrorCode(status);
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  let bodyText = "";
  try {
    bodyText = (await response.text()).slice(0, 500);
  } catch {
    // Body unreadable - the status alone still classifies the failure.
  }
  const suffix = bodyText ? ` - ${bodyText}` : "";
  return new OpenRouterError(`OpenRouter API error: ${status}${suffix}`, {
    code,
    status,
    retryable: RETRYABLE_STATUSES.has(status),
    retryAfterMs,
  });
}

/**
 * Recognize an AbortError from a fetch or reader call. Runtime-dependent
 * shapes (DOMException on some runtimes, Error on others) are both covered.
 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
