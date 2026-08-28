import {
  OpenRouterError,
  isAbortError,
  httpErrorFromResponse,
} from "./errors.js";
import {
  type RetryOptions,
  abortableSleep,
  backoffDelayMs,
} from "./retry.js";

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface AttemptSession {
  controller: AbortController;
  readonly callerAborted: boolean;
  readonly timedOut: boolean;
  dispose: () => void;
}

export interface AttemptSafety {
  markEmitted: () => void;
  emitted: () => boolean;
}

export interface AttemptContext {
  response: Response;
  session: AttemptSession;
  safety: AttemptSafety;
}

export interface AttemptOptions<T> {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  };
  callerSignal?: AbortSignal;
  requestTimeoutMs: number;
  retry: RetryOptions;
  consume: (context: AttemptContext) => Promise<T>;
}

export async function runAttempt<T>(options: AttemptOptions<T>): Promise<T> {
  const callerSignal = options.callerSignal;
  let emitted = false;
  const safety: AttemptSafety = {
    markEmitted: () => {
      emitted = true;
    },
    emitted: () => emitted,
  };

  for (let attempt = 1; ; attempt++) {
    const session = beginAttempt(callerSignal, options.requestTimeoutMs);
    let response: Response;

    try {
      response = await fetch(options.url, {
        method: options.init.method,
        headers: options.init.headers,
        body: options.init.body,
        signal: session.controller.signal,
      });
    } catch (error) {
      session.dispose();
      await failOrRetry(
        classifyFetchRejection(error, session, options.requestTimeoutMs),
        { attempt, retry: options.retry, callerSignal, emitted: () => emitted }
      );
      continue;
    }

    if (!response.ok) {
      session.dispose();
      const error = await httpErrorFromResponse(response);
      await failOrRetry(error, {
        attempt,
        retry: options.retry,
        callerSignal,
        emitted: () => emitted,
      });
      continue;
    }

    try {
      const result = await options.consume({ response, session, safety });
      session.dispose();
      return result;
    } catch (error) {
      session.dispose();
      await failOrRetry(
        classifyConsumptionError(error, session, emitted),
        { attempt, retry: options.retry, callerSignal, emitted: () => emitted }
      );
      continue;
    }
  }
}

function beginAttempt(
  callerSignal: AbortSignal | undefined,
  requestTimeoutMs: number
): AttemptSession {
  let callerAborted = false;
  let timedOut = false;
  const controller = new AbortController();

  const onCallerAbort = () => {
    callerAborted = true;
    controller.abort();
  };
  callerSignal?.addEventListener("abort", onCallerAbort);
  if (callerSignal?.aborted) {
    onCallerAbort();
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);

  return {
    controller,
    get callerAborted() {
      return callerAborted;
    },
    get timedOut() {
      return timedOut;
    },
    dispose() {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

function classifyFetchRejection(
  error: unknown,
  session: AttemptSession,
  requestTimeoutMs: number
): OpenRouterError {
  if (session.callerAborted || session.controller.signal.aborted) {
    if (session.timedOut && !session.callerAborted) {
      return timeoutError(requestTimeoutMs, true);
    }
    return abortedError();
  }
  if (isAbortError(error)) {
    return abortedError();
  }
  const message = error instanceof Error ? error.message : String(error);
  return new OpenRouterError(`Network error: ${message}`, {
    code: "network_error",
    retryable: true,
  });
}

function classifyConsumptionError(
  error: unknown,
  session: AttemptSession,
  contentEmitted: boolean
): OpenRouterError {
  if (session.callerAborted) {
    return abortedError();
  }
  if (session.timedOut) {
    return new OpenRouterError(
      "No response received within the request timeout",
      { code: "timeout", retryable: !contentEmitted }
    );
  }
  if (error instanceof OpenRouterError) {
    return error;
  }
  if (isAbortError(error)) {
    return abortedError();
  }
  const message = error instanceof Error ? error.message : String(error);
  return new OpenRouterError(`Stream failed after connecting: ${message}`, {
    code: "network_error",
    retryable: false,
  });
}

function timeoutError(
  requestTimeoutMs: number,
  retryable: boolean
): OpenRouterError {
  return new OpenRouterError(
    `No response received within ${requestTimeoutMs}ms`,
    { code: "timeout", retryable }
  );
}

function abortedError(): OpenRouterError {
  return new OpenRouterError("Request aborted", {
    code: "aborted",
    retryable: false,
  });
}

async function failOrRetry(
  error: OpenRouterError,
  context: {
    attempt: number;
    retry: RetryOptions;
    callerSignal?: AbortSignal;
    emitted: () => boolean;
  }
): Promise<void> {
  const canRetry =
    error.retryable &&
    !context.emitted() &&
    context.attempt <= context.retry.maxRetries &&
    !context.callerSignal?.aborted;

  if (!canRetry) {
    throw error;
  }

  await abortableSleep(
    backoffDelayMs(context.attempt, context.retry, error.retryAfterMs),
    context.callerSignal
  );
  if (context.callerSignal?.aborted) {
    throw abortedError();
  }
}
