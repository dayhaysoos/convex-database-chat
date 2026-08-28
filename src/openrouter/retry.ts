export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8000,
};

export function backoffDelayMs(
  attempt: number,
  options: RetryOptions,
  retryAfterMs?: number
): number {
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, options.maxDelayMs);
  }
  const exponential = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** (attempt - 1)
  );
  return Math.random() * exponential;
}

export function abortableSleep(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    signal?.addEventListener("abort", onAbort);
  });
}
