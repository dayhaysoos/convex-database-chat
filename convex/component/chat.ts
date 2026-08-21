import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import type { GenericActionCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import {
  databaseChatToolValidator,
  formatToolsForLLM,
  findTool,
  validateToolArgs,
} from "./tools";
import type { DatabaseChatTool } from "./tools";
import {
  buildSystemPromptWithTools,
  type ToolGuidanceOption,
} from "./toolGuidance";
import { DeltaStreamer } from "./deltaStreamer";
import { executeToolWithContext } from "./toolExecution";

const sendConfigValidator = v.object({
  apiKey: v.string(),
  model: v.optional(v.string()),
  systemPrompt: v.optional(v.string()),
  toolGuidance: v.optional(v.string()),
  // Tools the LLM can call
  tools: v.optional(v.array(databaseChatToolValidator)),
  // Max messages to include in LLM context (default: 50)
  maxMessagesForLLM: v.optional(v.number()),
  toolContext: v.optional(v.any()),
  // Max tool-calling rounds per message before giving up (default: 5)
  maxToolLoops: v.optional(v.number()),
  // Minimum ms between stream delta writes (default: 100)
  streamThrottleMs: v.optional(v.number()),
  // Max characters of a serialized tool result sent to the LLM (default: 16000)
  maxToolResultChars: v.optional(v.number()),
  // OpenRouter attribution headers (sent as HTTP-Referer / X-Title)
  httpReferer: v.optional(v.string()),
  xTitle: v.optional(v.string()),
});

const sendReturnValidator = v.object({
  success: v.boolean(),
  content: v.optional(v.string()),
  error: v.optional(v.string()),
  // Tool calls that were made (for debugging/logging)
  toolCalls: v.optional(
    v.array(
      v.object({
        name: v.string(),
        args: v.any(),
        result: v.any(),
      })
    )
  ),
});

/**
 * Send a message and get a streaming response.
 * This is the core chat action that orchestrates the LLM call.
 *
 * Supports tool calling: when tools are provided, the LLM can request
 * to call them, and this action will execute them and return results.
 */
export const send = action({
  args: {
    conversationId: v.id("conversations"),
    message: v.string(),
    // Config passed from the app
    config: sendConfigValidator,
  },
  returns: sendReturnValidator,
  handler: async (ctx, args) => {
    return await sendInternal(ctx, args);
  },
});

/**
 * Send a message scoped to externalId.
 * Throws "Not found" if the conversation is missing or not owned by externalId.
 */
export const sendForExternalId = action({
  args: {
    conversationId: v.id("conversations"),
    externalId: v.string(),
    message: v.string(),
    config: sendConfigValidator,
  },
  returns: sendReturnValidator,
  handler: async (ctx, args) => {
    await ctx.runQuery(api.conversations.getForExternalId, {
      conversationId: args.conversationId,
      externalId: args.externalId,
    });
    return await sendInternal(ctx, {
      conversationId: args.conversationId,
      message: args.message,
      config: args.config,
    });
  },
});

async function sendInternal(
  ctx: GenericActionCtx<DataModel>,
  args: {
    conversationId: Id<"conversations">;
    message: string;
    config: {
      apiKey: string;
      model?: string;
      systemPrompt?: string;
      toolGuidance?: ToolGuidanceOption;
      tools?: DatabaseChatTool[];
      maxMessagesForLLM?: number;
      toolContext?: Record<string, unknown>;
      maxToolLoops?: number;
      streamThrottleMs?: number;
      maxToolResultChars?: number;
      httpReferer?: string;
      xTitle?: string;
    };
  }
) {
  const { conversationId, message, config } = args;
  const tools = (config.tools ?? []) as DatabaseChatTool[];
  const maxToolLoops = config.maxToolLoops ?? DEFAULT_MAX_TOOL_LOOPS;
  const maxToolResultChars = config.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;
  const executedToolCalls: Array<{
    name: string;
    args: unknown;
    result: unknown;
  }> = [];

  // Create DeltaStreamer for efficient streaming (O(n) instead of O(n²) bandwidth)
  const streamer = new DeltaStreamer(ctx, api, conversationId, {
    throttleMs: config.streamThrottleMs ?? DEFAULT_STREAM_THROTTLE_MS,
    onAbort: async (reason) => {
      console.warn("Stream aborted:", reason);
    },
  });

  try {
    // 1. Save the user message
    await ctx.runMutation(api.messages.add, {
      conversationId,
      role: "user",
      content: message,
    });

    // 2. Get conversation history (bounded by limit)
    const messagesLimit = config.maxMessagesForLLM ?? 50;
    const messages = await ctx.runQuery(api.messages.list, {
      conversationId,
      limit: messagesLimit,
    });

    // 3. Initialize streaming (creates stream record)
    await streamer.getStreamId();

    // 4. Build messages for OpenRouter
    const systemPrompt = buildSystemPromptWithTools(
      config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      tools,
      { toolGuidance: config.toolGuidance }
    );
    const openRouterMessages = buildMessagesWithTools(messages, systemPrompt);

    // 5. Call OpenRouter with streaming (and tools if provided)
    // DeltaStreamer batches token writes for efficiency
    let response = await callOpenRouter({
      apiKey: config.apiKey,
      model: config.model ?? "openai/gpt-4o",
      messages: openRouterMessages,
      tools: tools.length > 0 ? formatToolsForLLM(tools) : undefined,
      onChunk: async (delta: string) => {
        // Add delta as a text part - DeltaStreamer batches these
        await streamer.addParts([{ type: "text-delta", text: delta }]);
      },
      abortSignal: streamer.abortController.signal,
      attribution: {
        httpReferer: config.httpReferer,
        xTitle: config.xTitle,
      },
    });

    // 6. Handle tool calls (loop until no more tool calls)
    let loopCount = 0;

    while (
      response.toolCalls &&
      response.toolCalls.length > 0 &&
      loopCount < maxToolLoops &&
      !streamer.abortController.signal.aborted
    ) {
      // Detect external aborts that happened while no deltas were being
      // written (tool-call generation, tool execution). Without this check,
      // a user pressing Stop during those windows goes unnoticed: the loop
      // rotates to a fresh stream and generation continues as a zombie.
      const activeStreamId = await streamer.getStreamId();
      const streamState = await ctx.runQuery(api.stream.getStream, {
        conversationId,
      });
      if (
        !streamState ||
        streamState.status !== "streaming" ||
        streamState.streamId !== activeStreamId
      ) {
        // Mark our controller aborted so the catch block's fail() is a no-op
        // and the fetch in flight (if any) gets cancelled.
        streamer.abortController.abort();
        throw new Error("Stream aborted");
      }

      loopCount++;

      // Execute each tool call
      const toolResults: Array<{ toolCallId: string; result: string }> = [];

      for (const toolCall of response.toolCalls) {
        const tool = findTool(tools, toolCall.name);

        if (!tool) {
          toolResults.push({
            toolCallId: toolCall.id,
            result: JSON.stringify({
              error: `Unknown tool: ${toolCall.name}`,
            }),
          });
          continue;
        }

        // Parse and validate arguments
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = JSON.parse(toolCall.arguments);
        } catch {
          toolResults.push({
            toolCallId: toolCall.id,
            result: JSON.stringify({ error: "Invalid JSON arguments" }),
          });
          continue;
        }

        const validationError = validateToolArgs(tool, parsedArgs);
        if (validationError) {
          toolResults.push({
            toolCallId: toolCall.id,
            result: JSON.stringify({ error: validationError }),
          });
          continue;
        }

        // Execute the tool
        try {
          const { result, args: mergedArgs } = await executeToolWithContext(
            ctx,
            tool,
            parsedArgs,
            config.toolContext
          );
          toolResults.push({
            toolCallId: toolCall.id,
            result: capToolResult(result, maxToolResultChars),
          });
          executedToolCalls.push({
            name: toolCall.name,
            args: mergedArgs,
            result,
          });
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Tool execution failed";
          toolResults.push({
            toolCallId: toolCall.id,
            result: JSON.stringify({ error: errorMsg }),
          });
        }
      }

      // Save the assistant message with tool calls
      await ctx.runMutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: response.content || "",
        toolCalls: response.toolCalls,
      });

      // Save tool results
      await ctx.runMutation(api.messages.add, {
        conversationId,
        role: "tool",
        content: "", // Tool messages primarily carry results
        toolResults,
      });

      // Build updated messages for next LLM call
      const updatedMessages = await ctx.runQuery(api.messages.list, {
        conversationId,
        limit: messagesLimit,
      });
      const nextOpenRouterMessages = buildMessagesWithTools(
        updatedMessages,
        systemPrompt
      );

      // Discard this round's streamed content - only the final round's text
      // should reach clients. Rotate eagerly: abort the old stream and create
      // the next one up front, so the loop-top liveness check below never has
      // to create a stream as a side effect.
      await streamer.resetForNewRound();
      await streamer.getStreamId();

      // Call LLM again with tool results
      response = await callOpenRouter({
        apiKey: config.apiKey,
        model: config.model ?? "openai/gpt-4o",
        messages: nextOpenRouterMessages,
        tools: formatToolsForLLM(tools),
        onChunk: async (delta: string) => {
          await streamer.addParts([{ type: "text-delta", text: delta }]);
        },
        abortSignal: streamer.abortController.signal,
        attribution: {
          httpReferer: config.httpReferer,
          xTitle: config.xTitle,
        },
      });
    }

    // 7. Finish streaming (this cleans up deltas)
    await streamer.finish();

    // 8. Save final assistant message
    await ctx.runMutation(api.messages.add, {
      conversationId,
      role: "assistant",
      content: response.content,
    });

    return {
      success: true,
      content: response.content,
      toolCalls: executedToolCalls.length > 0 ? executedToolCalls : undefined,
    };
  } catch (error) {
    // Abort streaming on error
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await streamer.fail(errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant that can search and query a database.
When users ask questions, use the available tools to find relevant information.
If you don't have access to a tool that can answer the question, say so.
Always explain what you found in a clear, helpful way.`;

const DEFAULT_MAX_TOOL_RESULT_CHARS = 16000;
const DEFAULT_MAX_TOOL_LOOPS = 5;
const DEFAULT_STREAM_THROTTLE_MS = 100;

/**
 * OpenRouter attribution headers (HTTP-Referer / X-Title).
 */
interface OpenRouterAttribution {
  httpReferer?: string;
  xTitle?: string;
}

/**
 * Serialize a tool result for the LLM, truncating oversized results so a
 * single large payload can't blow up the context window. The returned value
 * is always valid JSON.
 */
export function capToolResult(result: unknown, maxChars: number): string {
  const json = JSON.stringify(result);
  if (json.length <= maxChars) {
    return json;
  }
  return JSON.stringify({
    truncated: true,
    originalLength: json.length,
    data: json.slice(0, maxChars),
  });
}

/**
 * Build messages array for OpenRouter API, preserving tool calls and results
 * so multi-turn conversations replay faithfully.
 */
export function buildMessagesWithTools(
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    toolResults?: Array<{ toolCallId: string; result: string }>;
  }>,
  systemPrompt: string
): Array<{
  role: string;
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}> {
  const result: Array<{
    role: string;
    content?: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }> = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Assistant message with tool calls
        result.push({
          role: "assistant",
          content: msg.content || undefined,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        });
      } else {
        result.push({ role: "assistant", content: msg.content });
      }
    } else if (msg.role === "tool" && msg.toolResults) {
      // Tool result messages
      for (const tr of msg.toolResults) {
        result.push({
          role: "tool",
          content: tr.result,
          tool_call_id: tr.toolCallId,
        });
      }
    }
  }

  return result;
}

const DEFAULT_HTTP_REFERER = "https://github.com/dayhaysoos/convex-database-chat";
const DEFAULT_X_TITLE = "DatabaseChat";

/**
 * Call OpenRouter API with streaming (and optional tools)
 */
async function callOpenRouter(options: {
  apiKey: string;
  model: string;
  messages: Array<{
    role: string;
    content?: string;
    tool_calls?: unknown;
    tool_call_id?: string;
  }>;
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  }>;
  /** Called with each text delta (not accumulated content) */
  onChunk: (delta: string) => Promise<void>;
  /** Optional abort signal to cancel the request */
  abortSignal?: AbortSignal;
  /** OpenRouter attribution headers */
  attribution?: OpenRouterAttribution;
}): Promise<{
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": options.attribution?.httpReferer ?? DEFAULT_HTTP_REFERER,
        "X-Title": options.attribution?.xTitle ?? DEFAULT_X_TITLE,
      },
      body: JSON.stringify(body),
      signal: options.abortSignal,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
  }

  if (!response.body) {
    throw new Error("No response body from OpenRouter");
  }

  // Process the stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";

  // Track tool calls across chunks
  const toolCallsMap = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];

          // Handle content delta - pass just the delta, not accumulated
          const content = choice?.delta?.content;
          if (content) {
            fullContent += content;
            await options.onChunk(content); // Pass delta, not accumulated
          }

          // Handle tool calls delta
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
        } catch {
          // Ignore parse errors for malformed chunks
        }
      }
    }
  }

  // Convert tool calls map to array
  const toolCalls = Array.from(toolCallsMap.values()).filter(
    (tc) => tc.id && tc.name
  );

  return {
    content: fullContent,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
