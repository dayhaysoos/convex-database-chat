import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import {
  databaseChatToolValidator,
  formatToolsForLLM,
  findTool,
  validateToolArgs,
} from "./tools";
import type { DatabaseChatTool } from "./tools";

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
    config: v.object({
      apiKey: v.string(),
      model: v.optional(v.string()),
      systemPrompt: v.optional(v.string()),
      // Tools the LLM can call
      tools: v.optional(v.array(databaseChatToolValidator)),
    }),
  },
  returns: v.object({
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
  }),
  handler: async (ctx, args) => {
    const { conversationId, message, config } = args;
    const tools = (config.tools ?? []) as DatabaseChatTool[];
    const executedToolCalls: Array<{
      name: string;
      args: unknown;
      result: unknown;
    }> = [];

    try {
      // 1. Save the user message
      await ctx.runMutation(api.messages.add, {
        conversationId,
        role: "user",
        content: message,
      });

      // 2. Get conversation history
      const messages = await ctx.runQuery(api.messages.list, {
        conversationId,
      });

      // 3. Initialize streaming
      await ctx.runMutation(api.stream.init, { conversationId });

      // 4. Build messages for OpenRouter
      const systemPrompt = buildSystemPrompt(
        config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        tools
      );
      const openRouterMessages = buildMessages(messages, systemPrompt);

      // 5. Call OpenRouter with streaming (and tools if provided)
      let response = await callOpenRouter({
        apiKey: config.apiKey,
        model: config.model ?? "openai/gpt-4o",
        messages: openRouterMessages,
        tools: tools.length > 0 ? formatToolsForLLM(tools) : undefined,
        onChunk: async (content: string) => {
          await ctx.runMutation(api.stream.update, {
            conversationId,
            content,
          });
        },
      });

      // 6. Handle tool calls (loop until no more tool calls)
      let loopCount = 0;
      const MAX_TOOL_LOOPS = 5; // Prevent infinite loops

      while (
        response.toolCalls &&
        response.toolCalls.length > 0 &&
        loopCount < MAX_TOOL_LOOPS
      ) {
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
            const result = await ctx.runQuery(tool.handler as any, parsedArgs);
            toolResults.push({
              toolCallId: toolCall.id,
              result: JSON.stringify(result),
            });
            executedToolCalls.push({
              name: toolCall.name,
              args: parsedArgs,
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
        });
        const nextOpenRouterMessages = buildMessagesWithTools(
          updatedMessages,
          systemPrompt
        );

        // Call LLM again with tool results
        response = await callOpenRouter({
          apiKey: config.apiKey,
          model: config.model ?? "openai/gpt-4o",
          messages: nextOpenRouterMessages,
          tools: formatToolsForLLM(tools),
          onChunk: async (content: string) => {
            await ctx.runMutation(api.stream.update, {
              conversationId,
              content,
            });
          },
        });
      }

      // 7. Clear streaming state
      await ctx.runMutation(api.stream.clear, { conversationId });

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
      // Clear streaming on error
      await ctx.runMutation(api.stream.clear, { conversationId });

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: errorMessage,
      };
    }
  },
});

const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant that can search and query a database.
When users ask questions, use the available tools to find relevant information.
If you don't have access to a tool that can answer the question, say so.
Always explain what you found in a clear, helpful way.`;

/**
 * Build system prompt with tool descriptions
 */
function buildSystemPrompt(
  basePrompt: string,
  tools: DatabaseChatTool[]
): string {
  if (tools.length === 0) {
    return basePrompt;
  }

  const toolDescriptions = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  return `${basePrompt}

You have access to the following tools to query the database:
${toolDescriptions}

Use these tools to answer questions about the data. You can call multiple tools if needed.`;
}

/**
 * Build messages array for OpenRouter API (without tools)
 */
function buildMessages(
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    toolResults?: Array<{ toolCallId: string; result: string }>;
  }>,
  systemPrompt: string
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      result.push({ role: msg.role, content: msg.content });
    }
  }

  return result;
}

/**
 * Build messages array for OpenRouter API (with tool calls and results)
 */
function buildMessagesWithTools(
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
  onChunk: (content: string) => Promise<void>;
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
        "HTTP-Referer": "https://github.com/convex-dev/database-chat",
        "X-Title": "DatabaseChat",
      },
      body: JSON.stringify(body),
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

          // Handle content delta
          const content = choice?.delta?.content;
          if (content) {
            fullContent += content;
            await options.onChunk(fullContent);
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
