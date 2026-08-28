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

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterAttribution {
  httpReferer?: string;
  xTitle?: string;
}

export const DEFAULT_HTTP_REFERER =
  "https://github.com/dayhaysoos/convex-database-chat";
export const DEFAULT_X_TITLE = "DatabaseChat";

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface ChatCompletionMessage {
  role: string;
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ChatCompletionTool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface StreamChatCompletionOptions {
  apiKey: string;
  model: string;
  messages: ChatCompletionMessage[];
  tools?: ChatCompletionTool[];
  onChunk: (delta: string) => Promise<void>;
  abortSignal?: AbortSignal;
  attribution?: OpenRouterAttribution;
  maxRetries?: number;
  requestTimeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface StreamChatCompletionResult {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export async function streamChatCompletion(
  options: StreamChatCompletionOptions
): Promise<StreamChatCompletionResult> {
  const retry: RetryOptions = {
    maxRetries: options.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs,
  };
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const callerSignal = options.abortSignal;

  let contentEmitted = false;
  const onChunk = async (delta: string) => {
    contentEmitted = true;
    await options.onChunk(delta);
  };

  for (let attempt = 1; ; attempt++) {
    const session = beginAttempt(callerSignal, requestTimeoutMs);
    let response: Response;

    try {
      response = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            options.attribution?.httpReferer ?? DEFAULT_HTTP_REFERER,
          "X-Title": options.attribution?.xTitle ?? DEFAULT_X_TITLE,
        },
        body: JSON.stringify(bodyFor(options)),
        signal: session.controller.signal,
      });
    } catch (error) {
      session.dispose();
      await failOrRetry(
        classifyFetchRejection(error, session, requestTimeoutMs),
        { attempt, retry, callerSignal, contentEmitted: () => contentEmitted }
      );
      continue;
    }

    if (!response.ok) {
      session.dispose();
      const error = await httpErrorFromResponse(response);
      await failOrRetry(error, {
        attempt,
        retry,
        callerSignal,
        contentEmitted: () => contentEmitted,
      });
      continue;
    }

    try {
      return await consumeSseStream({
        response,
        onChunk,
        session,
      });
    } catch (error) {
      session.dispose();
      await failOrRetry(
        classifyConsumptionError(error, session, contentEmitted),
        {
          attempt,
          retry,
          callerSignal,
          contentEmitted: () => contentEmitted,
        }
      );
      continue;
    }
  }
}

interface AttemptSession {
  controller: AbortController;
  readonly callerAborted: boolean;
  readonly timedOut: boolean;
  dispose: () => void;
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

  const ttfbTimer = setTimeout(() => {
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
      clearTimeout(ttfbTimer);
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
    contentEmitted: () => boolean;
  }
): Promise<void> {
  const canRetry =
    error.retryable &&
    !context.contentEmitted() &&
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

async function consumeSseStream(context: {
  response: Response;
  onChunk: (delta: string) => Promise<void>;
  session: AttemptSession;
}): Promise<StreamChatCompletionResult> {
  const { response, onChunk, session } = context;
  const body = response.body;
  if (!body) {
    throw new OpenRouterError("No response body from OpenRouter", {
      code: "unknown",
      retryable: false,
    });
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";
  let firstByteSeen = false;

  const toolCallsMap = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  const handleLine = async (line: string) => {
    if (!line.startsWith("data: ")) {
      return;
    }
    const data = line.slice(6);
    if (data === "[DONE]") {
      return;
    }

    try {
      const parsed = JSON.parse(data);
      const choice = parsed.choices?.[0];

      const content = choice?.delta?.content;
      if (content) {
        fullContent += content;
        await onChunk(content);
      }

      const toolCallsDelta = choice?.delta?.tool_calls;
      if (toolCallsDelta) {
        for (const tcDelta of toolCallsDelta) {
          const index = tcDelta.index ?? 0;

          if (!toolCallsMap.has(index)) {
            toolCallsMap.set(index, {
              id: tcDelta.id ?? "",
              name: tcDelta.function?.name ?? "",
              arguments: "",
            });
          }

          const existing = toolCallsMap.get(index)!;
          if (tcDelta.id) existing.id = tcDelta.id;
          if (tcDelta.function?.name) existing.name = tcDelta.function.name;
          if (tcDelta.function?.arguments) {
            existing.arguments += tcDelta.function.arguments;
          }
        }
      }
    } catch {}
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (!firstByteSeen) {
        firstByteSeen = true;
        session.dispose();
      }
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        await handleLine(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      await handleLine(buffer);
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }

  const toolCalls = Array.from(toolCallsMap.values()).filter(
    (tc) => tc.id && tc.name
  );

  return {
    content: fullContent,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function bodyFor(options: StreamChatCompletionOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  return body;
}
