import { OpenRouterError } from "./errors.js";
import { DEFAULT_RETRY_OPTIONS, type RetryOptions } from "./retry.js";
import {
  runAttempt,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type AttemptSession,
  type AttemptSafety,
} from "./attempt.js";
import { type ProviderOptions } from "./options.js";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterAttribution {
  httpReferer?: string;
  xTitle?: string;
}

export const DEFAULT_HTTP_REFERER =
  "https://github.com/dayhaysoos/convex-database-chat";
export const DEFAULT_X_TITLE = "DatabaseChat";

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

export interface StreamChatCompletionOptions extends ProviderOptions {
  apiKey: string;
  model: string;
  messages: ChatCompletionMessage[];
  tools?: ChatCompletionTool[];
  onChunk: (delta: string) => Promise<void>;
  abortSignal?: AbortSignal;
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

  return runAttempt({
    url: OPENROUTER_CHAT_URL,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": options.httpReferer ?? DEFAULT_HTTP_REFERER,
        "X-Title": options.xTitle ?? DEFAULT_X_TITLE,
      },
      body: JSON.stringify(bodyFor(options)),
    },
    callerSignal: options.abortSignal,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    retry,
    consume: ({ response, session, safety }) =>
      consumeSseStream({
        response,
        onChunk: markedOnChunk(options.onChunk, safety),
        session,
      }),
  });
}

function markedOnChunk(
  onChunk: (delta: string) => Promise<void>,
  safety: AttemptSafety
): (delta: string) => Promise<void> {
  return async (delta: string) => {
    safety.markEmitted();
    await onChunk(delta);
  };
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
