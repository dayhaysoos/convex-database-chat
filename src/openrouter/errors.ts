export const openRouterErrorCodes = [
  "unauthorized",
  "rate_limited",
  "provider_error",
  "network_error",
  "timeout",
  "aborted",
  "invalid_request",
  "unknown",
] as const;

export type OpenRouterErrorCode = (typeof openRouterErrorCodes)[number];

export interface OpenRouterErrorOptions {
  code: OpenRouterErrorCode;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;
}

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

export function parseRetryAfterMs(
  value: string | null | undefined
): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds * 1000;
}

export async function httpErrorFromResponse(response: {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}): Promise<OpenRouterError> {
  const status = response.status;
  const code = statusToErrorCode(status);
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  let bodyText = "";
  try {
    bodyText = (await response.text()).slice(0, 500);
  } catch {
    bodyText = "";
  }
  const suffix = bodyText ? ` - ${bodyText}` : "";
  return new OpenRouterError(`OpenRouter API error: ${status}${suffix}`, {
    code,
    status,
    retryable: RETRYABLE_STATUSES.has(status),
    retryAfterMs,
  });
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
