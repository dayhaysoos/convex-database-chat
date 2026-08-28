/**
 * Backoff and sleep helpers shared by the OpenRouter provider calls.
 * Deliberately dependency-free and injectable with short delays for tests.
 */

export interface RetryOptions {
  /** Retries after the first attempt fails (total attempts = maxRetries + 1). */
  maxRetries: number;
  /** Base delay for exponential backoff, in ms. */
  baseDelayMs: number;
  /** Ceiling for any single backoff wait, in ms (also caps Retry-After). */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8000,
};

/**
 * Delay before retrying `attempt` (1-based). A server-provided Retry-After
 * wins and is capped by maxDelayMs; otherwise full jitter spreads retries
 * out so concurrent failures don't re-synchronize.
 */
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

/**
 * Sleep for `ms`, resolving early if the signal aborts. Never rejects -
 * callers check `signal.aborted` afterwards to decide what to do.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
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
