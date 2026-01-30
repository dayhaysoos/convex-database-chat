import { v } from "convex/values";
import { createFunctionHandle } from "convex/server";
import { action, mutation, query } from "./_generated/server";
import { components, api } from "./_generated/api";
import { defineVectorSearchTool } from "@dayhaysoos/convex-database-chat/vector";

// =============================================================================
// System Prompt
// =============================================================================

const SYSTEM_PROMPT = `You are a helpful e-commerce inventory assistant. You help store managers understand their product inventory and find items.

You have access to tools that let you:
- Search products by name, category, or price range
- Run semantic search for fuzzy, concept-based queries
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

type ToolParameters = {
  type: "object";
  properties: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "array" | "object";
      description?: string;
      enum?: string[];
      items?: { type: "string" | "number" | "boolean" | "array" | "object" };
    }
  >;
  required?: string[];
};

type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameters;
  handler: string;
  handlerType?: "query" | "mutation" | "action";
};

const TOOL_SPECS: Record<
  string,
  { name: string; description: string; parameters: ToolParameters }
> = {
  searchProducts: {
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
  },
  getProductStats: {
    name: "getProductStats",
    description:
      "Get overall inventory statistics including total products, category breakdown, price ranges, and inventory value. Use this for summary/overview questions.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  getLowStockProducts: {
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
  },
};

const SEMANTIC_TOOL_DESCRIPTION =
  "Semantic search across product names and descriptions. Use for fuzzy queries like 'home office setup' or 'travel essentials'.";

let toolsPromise: Promise<ToolDefinition[]> | null = null;

async function getTools(): Promise<ToolDefinition[]> {
  if (!toolsPromise) {
    toolsPromise = (async () => {
      const chatToolsApi = api.chatTools as any;
      const [searchHandle, semanticHandle, statsHandle, lowStockHandle] =
        (await Promise.all([
          createFunctionHandle(api.chatTools.searchProducts),
          createFunctionHandle(chatToolsApi.semanticSearchProducts),
          createFunctionHandle(api.chatTools.getProductStats),
          createFunctionHandle(api.chatTools.getLowStockProducts),
        ])) as string[];

      return [
        {
          ...TOOL_SPECS.searchProducts,
          handler: searchHandle,
        },
        defineVectorSearchTool({
          name: "semanticSearchProducts",
          description: SEMANTIC_TOOL_DESCRIPTION,
          handler: semanticHandle,
        }),
        {
          ...TOOL_SPECS.getProductStats,
          handler: statsHandle,
        },
        {
          ...TOOL_SPECS.getLowStockProducts,
          handler: lowStockHandle,
        },
      ] as ToolDefinition[];
    })();
  }

  return toolsPromise;
}

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

    const tools = await getTools();

    const result = (await ctx.runAction(components.databaseChat.chat.send, {
      conversationId: args.conversationId as any,
      message: args.message,
      config: {
        apiKey,
        model: "anthropic/claude-sonnet-4",
        systemPrompt: SYSTEM_PROMPT,
        tools,
      },
    })) as { success: boolean; content?: string; error?: string };

    return {
      success: result.success,
      content: result.content,
      error: result.error,
    };
  },
});
