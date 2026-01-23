import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { components, api } from "./_generated/api";

// =============================================================================
// System Prompt
// =============================================================================

const SYSTEM_PROMPT = `You are a helpful e-commerce inventory assistant. You help store managers understand their product inventory and find items.

You have access to tools that let you:
- Search products by name, category, or price range
- Get overall inventory statistics
- Find low-stock products that need reordering

Available categories: electronics, clothing, home, sports

When answering:
- Be concise and use specific numbers from the data
- Always include product links using the viewUrl field: [Product Name](viewUrl)
- Format prices with $ symbol (e.g., $29.99)
- If stock is low (< 10), highlight it with "⚠️ Low Stock"
- When showing multiple products, use a bulleted list

Example response format:
"Found 3 electronics under $50:
- [Wireless Mouse](/products/abc123) - $29.99 (89 in stock)
- [Phone Stand](/products/def456) - $24.99 (120 in stock)
- [HDMI Cable](/products/ghi789) - $12.99 (200 in stock)"`;

// =============================================================================
// Tool Definitions
// =============================================================================

const TOOLS = [
  {
    name: "searchProducts",
    description:
      "Search products by name, description, category, or price range. Use this to find specific products or browse inventory.",
    parameters: {
      type: "object",
      properties: {
        searchQuery: {
          type: "string",
          description: "Text to search in product name or description",
        },
        category: {
          type: "string",
          description: "Filter by category",
          enum: ["electronics", "clothing", "home", "sports"],
        },
        minPrice: {
          type: "number",
          description: "Minimum price filter",
        },
        maxPrice: {
          type: "number",
          description: "Maximum price filter",
        },
        inStockOnly: {
          type: "boolean",
          description: "Only show products that are in stock",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20, max: 50)",
        },
      },
      required: [],
    },
    handler: "searchProducts",
  },
  {
    name: "getProductStats",
    description:
      "Get overall inventory statistics including total products, category breakdown, price ranges, and inventory value. Use this for summary/overview questions.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    handler: "getProductStats",
  },
  {
    name: "getLowStockProducts",
    description:
      "Find products that are running low on stock and may need reordering. Returns products sorted by stock level (lowest first).",
    parameters: {
      type: "object",
      properties: {
        threshold: {
          type: "number",
          description:
            "Stock threshold to consider 'low' (default: 10). Products with stock below this number are returned.",
        },
      },
      required: [],
    },
    handler: "getLowStockProducts",
  },
];

// =============================================================================
// Conversation Management
// =============================================================================

export const createConversation = mutation({
  args: {
    externalId: v.string(),
    title: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const id = await ctx.runMutation(
      components.databaseChat.conversations.create,
      {
        externalId: args.externalId,
        title: args.title ?? "New Chat",
      },
    );
    return id as string;
  },
});

export const listConversations = query({
  args: { externalId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.databaseChat.conversations.list, {
      externalId: args.externalId,
    });
  },
});

// =============================================================================
// Message Management
// =============================================================================

export const getMessages = query({
  args: { conversationId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.databaseChat.messages.list, {
      conversationId: args.conversationId as any,
    });
  },
});

// =============================================================================
// Delta-Based Streaming (New, Efficient)
// Note: Using type assertions because generated types may be outdated.
// Run `npx convex dev` to regenerate types.
// =============================================================================

// Type for the component's stream functions (including new delta-based API)
type StreamComponent = typeof components.databaseChat.stream & {
  // Query functions
  getStream: any;
  listDeltas: any;
  // Mutation functions
  create: any;
  addDelta: any;
  finish: any;
  abort: any;
  abortByConversation: any;
};

const streamApi = components.databaseChat.stream as StreamComponent;

export const getStreamState = query({
  args: { conversationId: v.string() },
  returns: v.union(
    v.object({
      streamId: v.string(),
      status: v.union(
        v.literal("streaming"),
        v.literal("finished"),
        v.literal("aborted")
      ),
      startedAt: v.number(),
      endedAt: v.optional(v.number()),
      abortReason: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(streamApi.getStream, {
      conversationId: args.conversationId as any,
    });
    if (!result) return null;
    return {
      streamId: result.streamId as string,
      status: result.status,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      abortReason: result.abortReason,
    };
  },
});

export const getStreamDeltas = query({
  args: { streamId: v.string(), cursor: v.number() },
  returns: v.array(
    v.object({
      start: v.number(),
      end: v.number(),
      parts: v.array(
        v.object({
          type: v.union(
            v.literal("text-delta"),
            v.literal("tool-call"),
            v.literal("tool-result"),
            v.literal("error")
          ),
          text: v.optional(v.string()),
          toolCallId: v.optional(v.string()),
          toolName: v.optional(v.string()),
          args: v.optional(v.string()),
          result: v.optional(v.string()),
          error: v.optional(v.string()),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    return await ctx.runQuery(streamApi.listDeltas, {
      streamId: args.streamId as any,
      cursor: args.cursor,
    });
  },
});

export const abortStream = mutation({
  args: {
    conversationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(streamApi.abortByConversation, {
      conversationId: args.conversationId as any,
      reason: args.reason ?? "User cancelled",
    });
  },
});

// =============================================================================
// Send Message Action
// =============================================================================

export const sendMessage = action({
  args: {
    conversationId: v.string(),
    message: v.string(),
    fingerprint: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    content: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { success: false, error: "OPENROUTER_API_KEY not configured" };
    }

    // Server-side rate limiting
    if (args.fingerprint) {
      const rateLimitResult = await ctx.runMutation(
        api.rateLimit.incrementRateLimit,
        { fingerprint: args.fingerprint },
      );
      if (!rateLimitResult.allowed) {
        return {
          success: false,
          error: "Rate limit exceeded. Please try again later.",
        };
      }
    }

    // Use type assertions for new delta-based API functions
    const streamCreate = streamApi.create as any;
    const streamAddDelta = streamApi.addDelta as any;
    const streamFinish = streamApi.finish as any;
    const streamAbort = streamApi.abort as any;

    let streamId: string | null = null;

    try {
      // 1. Save user message
      await ctx.runMutation(components.databaseChat.messages.add, {
        conversationId: args.conversationId as any,
        role: "user",
        content: args.message,
      });

      // 2. Get conversation history
      const rawMessages = await ctx.runQuery(
        components.databaseChat.messages.list,
        { conversationId: args.conversationId as any },
      );

      // 3. Build messages array for LLM
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...rawMessages.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      // 4. Create stream (new delta-based API for O(n) bandwidth)
      streamId = await ctx.runMutation(streamCreate, {
        conversationId: args.conversationId as any,
      });

      // 5. Call LLM with tools using delta-based streaming
      let deltaCursor = 0;
      const response = await callLLMWithTools(
        apiKey,
        messages,
        TOOLS,
        async (deltaText: string) => {
          // Add delta (only new text, not accumulated content)
          const success = await ctx.runMutation(streamAddDelta, {
            streamId,
            start: deltaCursor,
            end: deltaCursor + 1,
            parts: [{ type: "text-delta", text: deltaText }],
          });
          deltaCursor++;
          // If addDelta returns false, stream was aborted
          if (!success) {
            throw new Error("Stream aborted");
          }
        },
        async (toolName: string, toolArgs: Record<string, unknown>) => {
          return await executeToolCall(ctx, toolName, toolArgs);
        },
      );

      // 6. Finish streaming (deletes deltas, marks as finished)
      await ctx.runMutation(streamFinish, { streamId });

      // 7. Save assistant response
      await ctx.runMutation(components.databaseChat.messages.add, {
        conversationId: args.conversationId as any,
        role: "assistant",
        content: response.content,
      });

      return { success: true, content: response.content };
    } catch (error) {
      // Abort streaming on error
      if (streamId) {
        try {
          await ctx.runMutation(streamAbort, {
            streamId,
            reason: error instanceof Error ? error.message : "Unknown error",
          });
        } catch {
          // Ignore abort errors
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// =============================================================================
// Tool Execution
// =============================================================================

async function executeToolCall(
  ctx: any,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case "searchProducts":
      return await ctx.runQuery(api.chatTools.searchProducts, args);
    case "getProductStats":
      return await ctx.runQuery(api.chatTools.getProductStats, args);
    case "getLowStockProducts":
      return await ctx.runQuery(api.chatTools.getLowStockProducts, args);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// =============================================================================
// LLM Integration (OpenRouter)
// =============================================================================

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
}

async function callLLMWithTools(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  tools: typeof TOOLS,
  onDelta: (deltaText: string) => Promise<void>,
  executeTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>,
): Promise<{ content: string }> {
  const formattedTools = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  let currentMessages = [...messages];
  let loopCount = 0;
  const MAX_LOOPS = 5;

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    const response = await callOpenRouter(
      apiKey,
      currentMessages,
      formattedTools,
      onDelta,
    );

    // If no tool calls, we're done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return { content: response.content };
    }

    // Execute tool calls
    const toolResults: Array<{ id: string; result: string }> = [];
    for (const tc of response.toolCalls) {
      try {
        const args = JSON.parse(tc.arguments);
        const result = await executeTool(tc.name, args);
        toolResults.push({ id: tc.id, result: JSON.stringify(result) });
      } catch (error) {
        toolResults.push({
          id: tc.id,
          result: JSON.stringify({ error: String(error) }),
        });
      }
    }

    // Add assistant message with tool calls
    currentMessages.push({
      role: "assistant",
      content: response.content || "",
      tool_calls: response.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    } as any);

    // Add tool results
    for (const tr of toolResults) {
      currentMessages.push({
        role: "tool",
        content: tr.result,
        tool_call_id: tr.id,
      } as any);
    }
  }

  return {
    content:
      "I've reached the maximum number of tool calls. Please try a simpler question.",
  };
}

async function callOpenRouter(
  apiKey: string,
  messages: any[],
  tools: any[],
  onDelta: (deltaText: string) => Promise<void>,
): Promise<LLMResponse> {
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://convex-database-chat.example.com",
        "X-Title": "E-commerce Chat Demo",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4",
        messages,
        tools,
        stream: true,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  let fullContent = "";
  let toolCalls: ToolCall[] = [];
  const toolCallsInProgress: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map();

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

    for (const line of lines) {
      const data = line.slice(6);
      if (data === "[DONE]") continue;

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        // Skip malformed JSON
        continue;
      }

      const delta = parsed.choices?.[0]?.delta;

      if (delta?.content) {
        // Send only the delta (new text), not accumulated content
        // This enables O(n) bandwidth instead of O(n²)
        // NOTE: onDelta may throw "Stream aborted" - let it propagate to stop streaming
        await onDelta(delta.content);
        fullContent += delta.content;
      }

      // Handle tool calls in streaming
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index ?? 0;
          if (!toolCallsInProgress.has(index)) {
            toolCallsInProgress.set(index, {
              id: tc.id || "",
              name: tc.function?.name || "",
              arguments: "",
            });
          }
          const existing = toolCallsInProgress.get(index)!;
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments)
            existing.arguments += tc.function.arguments;
        }
      }
    }
  }

  // Convert tool calls map to array
  toolCalls = Array.from(toolCallsInProgress.values()).filter(
    (tc) => tc.id && tc.name,
  );

  return { content: fullContent, toolCalls };
}
