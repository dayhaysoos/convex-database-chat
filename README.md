# DatabaseChat Component

> **Alpha Release** - A Convex component for adding natural language database queries to your app.

DatabaseChat lets users ask questions about your data in plain English. The LLM calls tools you define to query your database and returns helpful, actionable responses.

## Table of Contents

- [What It Does](#what-it-does)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Defining Tools](#defining-tools)
- [Implementing Query Functions](#implementing-query-functions)
- [Creating the Chat Integration](#creating-the-chat-integration)
- [Writing System Prompts](#writing-system-prompts)
- [Building the UI](#building-the-ui)
- [Patterns](#patterns)
- [API Reference](#api-reference)
- [Railway Deployments](#railway-deployments)
- [Testing](#testing)

---

## What It Does

The component provides:

| Feature | Description |
|---------|-------------|
| **Conversation storage** | Stores chat history in `conversations` and `messages` tables |
| **Delta-based streaming** | Efficient O(n) streaming via delta accumulation |
| **Abort support** | Stop generation mid-stream with proper cleanup |
| **Tool calling** | LLM can call your Convex queries to fetch data |
| **React hooks** | `useDatabaseChat`, `useMessagesWithStreaming`, etc. |
| **Client wrapper** | `defineDatabaseChat()` for type-safe integration |

**You implement:**

| Your Code | Description |
|-----------|-------------|
| **Tool definitions** | What queries the LLM can call |
| **Query functions** | The actual Convex queries |
| **Chat integration** | Wire tools to the component |
| **System prompt** | Instructions for your domain |
| **UI component** | Chat interface (or use the hooks) |

### How Delta-Based Streaming Works

Traditional streaming sends the full accumulated content on every update, resulting in O(n²) bandwidth:
- Update 1: "H" (1 byte)
- Update 2: "He" (2 bytes)
- Update 3: "Hel" (3 bytes)
- ...for a 1000 character response, you send ~500,000 bytes total

Delta-based streaming sends only new content, resulting in O(n) bandwidth:
- Delta 1: "H" (1 byte)
- Delta 2: "e" (1 byte)
- Delta 3: "l" (1 byte)
- ...for a 1000 character response, you send ~1000 bytes total

The client accumulates deltas locally and the server cleans them up when the stream finishes.

---

## Installation

### 1. Add the component to your app

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import databaseChat from "./components/databaseChat/convex.config";

const app = defineApp();
app.use(databaseChat);

export default app;
```

### 2. Set up OpenRouter API key

Add `OPENROUTER_API_KEY` to your Convex environment variables:

```bash
npx convex env set OPENROUTER_API_KEY your_key_here
```

---

## Quick Start

Here's the minimum to get a working chat:

### 1. Create a simple query tool

```typescript
// convex/chatTools.ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const countRecords = query({
  args: { table: v.string() },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, args) => {
    if (args.table === "users") {
      const users = await ctx.db.query("users").collect();
      return { count: users.length };
    }
    if (args.table === "orders") {
      const orders = await ctx.db.query("orders").collect();
      return { count: orders.length };
    }
    return { count: 0 };
  },
});
```

### 2. Create the chat integration

```typescript
// convex/chat.ts
import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { components, api } from "./_generated/api";

const SYSTEM_PROMPT = `You are a helpful assistant. Use the available tools to answer questions about the database.`;

const TOOLS = [
  {
    name: "countRecords",
    description: "Count records in a table. Available tables: users, orders",
    parameters: {
      type: "object",
      properties: {
        table: { type: "string", enum: ["users", "orders"] },
      },
      required: ["table"],
    },
    handler: "countRecords",
  },
];

// Create conversation
export const createConversation = mutation({
  args: { title: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.databaseChat.conversations.create, {
      externalId: "user-id", // Use your auth system
      title: args.title ?? "New Chat",
    });
  },
});

// Get messages
export const getMessages = query({
  args: { conversationId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.databaseChat.messages.list, {
      conversationId: args.conversationId as any,
    });
  },
});

// Get stream state (for real-time UI updates)
export const getStreamState = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.databaseChat.stream.getStream, {
      conversationId: args.conversationId as any,
    });
  },
});

// Get stream deltas (efficient O(n) streaming)
export const getStreamDeltas = query({
  args: { streamId: v.string(), cursor: v.number() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.databaseChat.stream.listDeltas, {
      streamId: args.streamId as any,
      cursor: args.cursor,
    });
  },
});

// Abort a stream (stop generation)
export const abortStream = mutation({
  args: { conversationId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.databaseChat.stream.abortByConversation, {
      conversationId: args.conversationId as any,
      reason: args.reason ?? "User cancelled",
    });
  },
});

// Send message (see full implementation in "Creating the Chat Integration")
export const sendMessage = action({
  args: { conversationId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    // Implementation shown below
  },
});
```

---

## Defining Tools

Tools tell the LLM what queries it can call. Each tool needs:

```typescript
interface Tool {
  name: string;           // Unique identifier
  description: string;    // What the tool does (LLM reads this!)
  parameters: {           // JSON Schema for arguments
    type: "object";
    properties: Record<string, {
      type: "string" | "number" | "boolean" | "array" | "object";
      description?: string;
      enum?: string[];    // For constrained values
    }>;
    required?: string[];
  };
  handlerType?: "query" | "mutation" | "action"; // Default: "query"
  handler: string;        // Function handle string (createFunctionHandle)
}
```

Note: When passing tools to the component chat action, `handler` should be a
function handle created via `createFunctionHandle(...)`. Set `handlerType` to
"action" for tools that run `ctx.vectorSearch`.

### Example: E-commerce - Search products

```typescript
const searchProductsTool = {
  name: "searchProducts",
  description: "Search products by name, category, or price range",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search text to match against product name",
      },
      category: {
        type: "string",
        description: "Filter by category",
        enum: ["electronics", "clothing", "home", "sports"],
      },
      minPrice: {
        type: "number",
        description: "Minimum price",
      },
      maxPrice: {
        type: "number",
        description: "Maximum price",
      },
      limit: {
        type: "number",
        description: "Maximum results (default: 20)",
      },
    },
    required: [],
  },
  handler: "searchProducts",
};
```

### Example: Project management - Get tasks

```typescript
const getTasksTool = {
  name: "getTasks",
  description: "Get tasks with optional filters for status, assignee, or project",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Filter by task status",
        enum: ["todo", "in_progress", "review", "done"],
      },
      assigneeId: {
        type: "string",
        description: "Filter by assigned user ID",
      },
      projectId: {
        type: "string",
        description: "Filter by project ID",
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high", "urgent"],
      },
    },
    required: [],
  },
  handler: "getTasks",
};
```

### Example: Content platform - Search articles

```typescript
const searchArticlesTool = {
  name: "searchArticles",
  description: "Search published articles by title, author, or tags",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search text for title or content",
      },
      authorId: {
        type: "string",
        description: "Filter by author",
      },
      tags: {
        type: "array",
        description: "Filter by tags",
        items: { type: "string" },
      },
      publishedAfter: {
        type: "string",
        description: "ISO date string - only articles after this date",
      },
    },
    required: [],
  },
  handler: "searchArticles",
};
```

### Tips for tool descriptions

- **Be specific**: "Search products by name, category, or price" is better than "Search products"
- **List available options**: "Available categories: electronics, clothing, home, sports"
- **Explain what each parameter does**: The LLM uses descriptions to decide which to use

---

## Implementing Query Functions

Your query functions do the actual database work. They receive the arguments the LLM provides.

### Example: E-commerce - Search with filters

```typescript
// convex/chatTools.ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const searchProducts = query({
  args: {
    query: v.optional(v.string()),
    category: v.optional(v.string()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      category: v.string(),
      price: v.number(),
      inStock: v.boolean(),
      viewUrl: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 100);
    let products = await ctx.db.query("products").collect();

    // Apply filters
    if (args.category) {
      products = products.filter((p) => p.category === args.category);
    }
    if (args.minPrice !== undefined) {
      products = products.filter((p) => p.price >= args.minPrice!);
    }
    if (args.maxPrice !== undefined) {
      products = products.filter((p) => p.price <= args.maxPrice!);
    }
    if (args.query) {
      const q = args.query.toLowerCase();
      products = products.filter((p) => p.name.toLowerCase().includes(q));
    }

    return products.slice(0, limit).map((p) => ({
      id: p._id,
      name: p.name,
      category: p.category,
      price: p.price,
      inStock: p.stockCount > 0,
      viewUrl: `/products/${p._id}`,
    }));
  },
});
```

### Example: Aggregation query

```typescript
export const getOrderStats = query({
  args: { period: v.optional(v.string()) },
  returns: v.object({
    totalOrders: v.number(),
    totalRevenue: v.number(),
    averageOrderValue: v.number(),
    statusBreakdown: v.object({
      pending: v.number(),
      processing: v.number(),
      shipped: v.number(),
      delivered: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    let orders = await ctx.db.query("orders").collect();

    // Filter by period if provided
    if (args.period === "today") {
      const today = new Date().setHours(0, 0, 0, 0);
      orders = orders.filter((o) => o.createdAt >= today);
    } else if (args.period === "week") {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      orders = orders.filter((o) => o.createdAt >= weekAgo);
    }

    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);

    return {
      totalOrders: orders.length,
      totalRevenue,
      averageOrderValue: orders.length > 0 ? totalRevenue / orders.length : 0,
      statusBreakdown: {
        pending: orders.filter((o) => o.status === "pending").length,
        processing: orders.filter((o) => o.status === "processing").length,
        shipped: orders.filter((o) => o.status === "shipped").length,
        delivered: orders.filter((o) => o.status === "delivered").length,
      },
    };
  },
});
```

---

## Creating the Chat Integration

The chat integration wires your tools to the component and handles the LLM interaction.

### Full sendMessage implementation

```typescript
// convex/chat.ts
import { v } from "convex/values";
import { action } from "./_generated/server";
import { components, api } from "./_generated/api";

// Your tools array and system prompt
const TOOLS = [/* your tools */];
const SYSTEM_PROMPT = `/* your prompt */`;

export const sendMessage = action({
  args: {
    conversationId: v.string(),
    message: v.string(),
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
        { conversationId: args.conversationId as any }
      );

      // 3. Build messages array
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...rawMessages.map((m) => ({ role: m.role, content: m.content })),
      ];

      // 4. Create stream for delta-based streaming
      const streamId = await ctx.runMutation(components.databaseChat.stream.create, {
        conversationId: args.conversationId as any,
      });

      // 5. Call LLM with tools using delta-based streaming
      let deltaCursor = 0;
      const response = await callLLMWithTools(
        apiKey,
        messages,
        TOOLS,
        async (deltaText) => {
          // Send only new text (delta), not accumulated content
          const success = await ctx.runMutation(components.databaseChat.stream.addDelta, {
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
        async (toolName, toolArgs) => {
          return await executeToolCall(ctx, toolName, toolArgs);
        }
      );

      // 6. Finish streaming (cleans up deltas)
      await ctx.runMutation(components.databaseChat.stream.finish, { streamId });

      // 7. Save assistant response
      await ctx.runMutation(components.databaseChat.messages.add, {
        conversationId: args.conversationId as any,
        role: "assistant",
        content: response.content,
      });

      return { success: true, content: response.content };
    } catch (error) {
      // Abort stream on error (if we have a streamId)
      // Note: In production, you'd track streamId in a ref or closure
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Route tool calls to your queries
async function executeToolCall(
  ctx: any,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "searchProducts":
      return await ctx.runQuery(api.chatTools.searchProducts, args);
    case "getOrderStats":
      return await ctx.runQuery(api.chatTools.getOrderStats, args);
    // Add your other tools here
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

### LLM calling with tool loop

```typescript
async function callLLMWithTools(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  tools: any[],
  onDelta: (deltaText: string) => Promise<void>, // Note: receives delta, not accumulated content
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
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
      onDelta
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

  return { content: "Hit tool call limit." };
}
```

---

## Writing System Prompts

The system prompt tells the LLM how to behave. Customize it for your domain.

### Structure of a good prompt

```
1. Role definition - What the assistant is
2. Available capabilities - What it can do
3. Response format - How to structure answers
4. Domain-specific rules - Your business logic
```

### Example: E-commerce assistant

```typescript
const SYSTEM_PROMPT = `You are a helpful e-commerce assistant. You help store managers understand their inventory and sales.

You have access to tools that let you:
- Search products by name, category, or price
- Get order statistics and revenue data
- Check inventory levels

When answering:
- Be concise and use specific numbers
- Always include links using the viewUrl field: [Product Name](viewUrl)
- Format prices with currency symbols
- If inventory is low (< 10), mention it

Example response:
"Found 3 products under $50 in Electronics:
- [Wireless Mouse](/products/abc123) - $29.99 (In Stock)
- [USB Cable](/products/def456) - $12.99 (Low Stock: 5 left)
- [Phone Stand](/products/ghi789) - $19.99 (In Stock)"`;
```

### Example: Project management assistant

```typescript
const SYSTEM_PROMPT = `You are a project management assistant. You help team leads track tasks and project progress.

You have access to tools that let you:
- Search and filter tasks by status, assignee, or project
- Get project statistics and completion rates
- Find overdue or blocked tasks

When answering:
- Prioritize actionable information
- Include links to tasks: [Task Title](viewUrl)
- Highlight urgent or overdue items
- Show completion percentages when relevant

Example response:
"Project 'Website Redesign' has 12 open tasks:
- 3 urgent: [Fix checkout bug](/tasks/abc), [Update SSL](/tasks/def), [Mobile nav](/tasks/ghi)
- 5 in review
- 4 in progress
Overall: 68% complete"`;
```

### Example: Content platform assistant

```typescript
const SYSTEM_PROMPT = `You are a content analytics assistant. You help editors understand article performance.

You have access to tools that let you:
- Search articles by title, author, or tags
- Get engagement statistics (views, shares, comments)
- Find trending or underperforming content

When answering:
- Include article links: [Article Title](viewUrl)
- Show key metrics inline
- Compare to averages when helpful
- Suggest actionable insights

Example response:
"Your top 3 articles this week:
1. [Getting Started with React](/articles/abc) - 12.5k views, 342 shares
2. [CSS Grid Tutorial](/articles/def) - 8.2k views, 256 shares  
3. [TypeScript Tips](/articles/ghi) - 6.1k views, 189 shares

All performing above your 5k average!"`;
```

---

## Building the UI

### Using the React hooks

```typescript
import {
  DatabaseChatProvider,
  useDatabaseChat,
  useMessagesWithStreaming,
} from "@dayhaysoos/convex-database-chat";
```

### Minimal chat component with delta-based streaming

The component uses efficient delta-based streaming. Here's how to implement it:

```tsx
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

// Hook for delta-based streaming with client-side accumulation
function useDeltaStreaming(conversationId: string | null) {
  const [cursor, setCursor] = useState(0);
  const [accumulatedContent, setAccumulatedContent] = useState("");
  const lastStreamIdRef = useRef<string | null>(null);
  const lastProcessedEndRef = useRef(0);

  // Subscribe to stream state
  const streamState = useQuery(
    api.chat.getStreamState,
    conversationId ? { conversationId } : "skip"
  );

  const streamId = streamState?.streamId ?? null;
  const status = streamState?.status ?? null;

  // Reset when stream changes
  useEffect(() => {
    if (streamId !== lastStreamIdRef.current) {
      lastStreamIdRef.current = streamId;
      lastProcessedEndRef.current = 0;
      setCursor(0);
      setAccumulatedContent("");
    }
  }, [streamId]);

  // Fetch deltas from cursor
  const deltas = useQuery(
    api.chat.getStreamDeltas,
    streamId && status === "streaming" ? { streamId, cursor } : "skip"
  );

  // Accumulate new deltas
  useEffect(() => {
    if (!deltas || deltas.length === 0) return;

    const newDeltas = deltas.filter(d => d.start >= lastProcessedEndRef.current);
    if (newDeltas.length === 0) return;

    let maxEnd = lastProcessedEndRef.current;
    let newText = "";

    for (const delta of newDeltas) {
      if (delta.end > maxEnd) maxEnd = delta.end;
      for (const part of delta.parts) {
        if (part.type === "text-delta" && part.text) {
          newText += part.text;
        }
      }
    }

    if (newText) {
      setAccumulatedContent(prev => prev + newText);
    }
    lastProcessedEndRef.current = maxEnd;
    if (maxEnd > cursor) setCursor(maxEnd);
  }, [deltas, cursor]);

  return {
    content: status === "streaming" && accumulatedContent ? accumulatedContent : null,
    isStreaming: status === "streaming",
  };
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const createConversation = useMutation(api.chat.createConversation);
  const sendMessage = useAction(api.chat.sendMessage);
  const abortStream = useMutation(api.chat.abortStream);
  
  const messages = useQuery(
    api.chat.getMessages,
    conversationId ? { conversationId } : "skip"
  );
  
  // Use delta-based streaming
  const { content: streamingContent, isStreaming } = useDeltaStreaming(conversationId);

  // Create conversation on open
  useEffect(() => {
    if (isOpen && !conversationId) {
      createConversation({}).then(setConversationId);
    }
  }, [isOpen, conversationId]);

  const handleSubmit = async () => {
    if (!inputValue.trim() || isLoading || !conversationId) return;

    const message = inputValue;
    setInputValue("");
    setIsLoading(true);

    await sendMessage({ conversationId, message });
    setIsLoading(false);
  };

  const handleAbort = async () => {
    if (!conversationId) return;
    await abortStream({ conversationId });
    setIsLoading(false);
  };

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)}>
        Open Chat
      </button>
    );
  }

  return (
    <div>
      {/* Messages */}
      {messages?.map((msg) => (
        <div key={msg._id}>
          <strong>{msg.role}:</strong>
          <MarkdownContent content={msg.content} />
        </div>
      ))}
      
      {/* Streaming */}
      {streamingContent && (
        <div>
          <strong>assistant:</strong>
          <MarkdownContent content={streamingContent} />
        </div>
      )}

      {/* Input */}
      <input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        disabled={isLoading || isStreaming}
      />
      {isLoading || isStreaming ? (
        <button onClick={handleAbort}>Stop</button>
      ) : (
        <button onClick={handleSubmit} disabled={!inputValue.trim()}>
          Send
        </button>
      )}
    </div>
  );
}
```

### Text smoothing with `useSmoothText`

The `useSmoothText` hook creates a typewriter effect for streaming text, making it feel more natural instead of jumping in chunks:

```tsx
import { useSmoothText, SmoothText } from "@dayhaysoos/convex-database-chat";

// Using the hook
function StreamingMessage({ text, isStreaming }) {
  const [visibleText] = useSmoothText(text, {
    // Start streaming immediately for active streams
    startStreaming: isStreaming,
    // Optional: customize speed (default: 200 chars/sec)
    initialCharsPerSecond: 200,
  });
  
  return <div>{visibleText}</div>;
}

// Or use the component directly
function Message({ text, isStreaming }) {
  return (
    <SmoothText 
      text={text} 
      startStreaming={isStreaming}
    />
  );
}
```

**Options:**
- `startStreaming` - Set to `true` for streaming messages, `false` for completed messages (shows immediately)
- `initialCharsPerSecond` - Starting speed, adapts over time to match text arrival rate
- `minDelayMs` / `maxDelayMs` - Bounds for character delay

### Rendering markdown links

The LLM returns markdown links like `[Name](url)`. Parse and render them:

```tsx
function MarkdownContent({ content }: { content: string }) {
  const parts = content.split(/(\[[^\]]+\]\([^)]+\))/g);

  return (
    <>
      {parts.map((part, i) => {
        const linkMatch = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          const [, text, url] = linkMatch;
          return (
            <a key={i} href={url} className="text-blue-600 underline">
              {text}
            </a>
          );
        }
        // Handle **bold**
        return part.split(/(\*\*[^*]+\*\*)/g).map((p, j) => {
          const bold = p.match(/\*\*([^*]+)\*\*/);
          if (bold) return <strong key={`${i}-${j}`}>{bold[1]}</strong>;
          return <span key={`${i}-${j}`}>{p}</span>;
        });
      })}
    </>
  );
}
```

---

## Patterns

### Vector search helpers

Use the helper utilities to reduce boilerplate while keeping your schema and
actions fully in your app code:

```typescript
// convex/semanticSearch.ts
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  generateEmbedding,
  formatVectorResults,
} from "@dayhaysoos/convex-database-chat/vector";

export const semanticSearchCandidates = action({
  args: {
    query: v.string(),
    orgId: v.id("orgs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const embedding = await generateEmbedding({
      apiKey: process.env.OPENROUTER_API_KEY!,
      text: args.query,
      // model: "your-embedding-model",
    });

    const results = await ctx.vectorSearch("applications", "by_resume_embedding", {
      vector: embedding,
      limit: args.limit ?? 20,
    });

    const docs = await ctx.runQuery(internal.semanticSearch.fetchByIds, {
      ids: results.map((r) => r._id),
    });

    return formatVectorResults(results, docs, {
      includeScore: true,
      snippetLength: 200,
      fields: ["candidateName", "topStrengths", "viewUrl"],
    });
  },
});
```

**Notes:**
- Vector search is only available in actions.
- Vector index dimensions must match the embedding model you choose.
- Use `fields` to avoid returning large vector fields like embeddings.
- Set `fields: []` to include no document fields (only `_id` and optional `_score`).

You can also define a tool entry with the helper:

```typescript
import { defineVectorSearchTool } from "@dayhaysoos/convex-database-chat/vector";

const TOOLS = [
  defineVectorSearchTool({
    name: "semanticSearch",
    description: "Find candidates by meaning or concept",
    handler: "semanticSearchCandidates",
  }),
];
```

### Including actionable URLs

Make responses actionable by including URLs that link to detail pages:

```typescript
// In your query handler, include viewUrl in results
return items.map((item) => ({
  id: item._id,
  name: item.name,
  // Include the URL to view this item
  viewUrl: `/items/${item._id}`,
}));
```

Then instruct the LLM to use it in your system prompt:

```
Always include links using the viewUrl field from the data.
Format as markdown: [Item Name](viewUrl)
```

**Before (not actionable):**
> "Found 2 products under $50"

**After (actionable):**
> "Found 2 products under $50:
> - [Wireless Mouse](/products/abc123) - $29.99
> - [USB Cable](/products/def456) - $12.99"

---

## Security & Multi-tenant Access

This component is auth-agnostic. You must supply `externalId` from your own
auth system and never accept it directly from untrusted clients.

Use the scoped endpoints below to enforce ownership checks server-side. These
throw `Not found` if the conversation or stream is missing or not owned by the
provided `externalId` to avoid leaking existence across tenants.

- `conversations.getForExternalId`
- `messages.listForExternalId`
- `messages.getLatestForExternalId`
- `stream.getStreamForExternalId`
- `stream.listDeltasForExternalId`
- `stream.abortForExternalId`
- `chat.sendForExternalId`

Unscoped endpoints are low-level helpers and should only be used if you already
enforce access control in your app.

---

## Injecting trusted context into tools

Some tool handlers need server-only context (orgId, externalId, userId) that
should never appear in the tool schema or LLM prompt. Pass that data via
`toolContext` in `chat.send` or `chat.sendForExternalId`. The context is merged
into tool args after validation, and `toolContext` wins on conflicts.

```typescript
await ctx.runAction(components.databaseChat.chat.sendForExternalId, {
  conversationId,
  externalId,
  message,
  config: {
    apiKey: process.env.OPENROUTER_API_KEY!,
    systemPrompt: SYSTEM_PROMPT,
    tools,
    toolContext: {
      orgId,
      userId,
      externalId,
    },
  },
});
```

Note: Do not include fields like `orgId` in the tool schema so the LLM never
sees them.

---

## API Reference

### Component Functions

| Function | Type | Description |
|----------|------|-------------|
| `conversations.create` | Mutation | Create a new conversation |
| `conversations.get` | Query | Get conversation by ID |
| `conversations.getForExternalId` | Query | Get conversation by ID scoped to externalId |
| `conversations.list` | Query | List conversations by externalId |
| `messages.add` | Mutation | Add a message |
| `messages.list` | Query | List messages in conversation |
| `messages.listForExternalId` | Query | List messages scoped to externalId |
| `messages.getLatestForExternalId` | Query | Get latest message scoped to externalId |
| `stream.create` | Mutation | Create a new stream for delta-based streaming |
| `stream.addDelta` | Mutation | Add a delta (batch of parts) to a stream |
| `stream.finish` | Mutation | Mark stream as finished, clean up deltas |
| `stream.abort` | Mutation | Abort a stream by stream ID |
| `stream.abortByConversation` | Mutation | Abort a stream by conversation ID |
| `stream.abortForExternalId` | Mutation | Abort a stream by conversation ID scoped to externalId |
| `stream.getStream` | Query | Get current stream state for a conversation |
| `stream.listDeltas` | Query | Get deltas from a cursor position |
| `stream.getStreamForExternalId` | Query | Get current stream state scoped to externalId |
| `stream.listDeltasForExternalId` | Query | Get deltas scoped to externalId |
| `chat.send` | Action | Send a message via OpenRouter |
| `chat.sendForExternalId` | Action | Send a message scoped to externalId |

### React Hooks & Components

| Export | Type | Description |
|--------|------|-------------|
| `useDatabaseChat` | Hook | Send messages, track loading/streaming state, abort |
| `useConversations` | Hook | List/create conversations |
| `useStreamingContent` | Hook | Subscribe to streaming updates with delta accumulation |
| `useMessagesWithStreaming` | Hook | Messages + current streaming merged |
| `useSmoothText` | Hook | Typewriter effect for streaming text |
| `SmoothText` | Component | Renders text with smooth typewriter effect |

### Stream States

| Status | Description |
|--------|-------------|
| `streaming` | Stream is active, deltas being written |
| `finished` | Stream completed successfully |
| `aborted` | Stream was cancelled (user abort, error, or timeout) |

---

## Railway Deployments

This repo hosts two Railway services, each with its own config file:

- Example app: Root Directory `/example`, Railway Config File `/example/railway.toml`
- Docs site: Root Directory `/docs`, Railway Config File `/docs/railway.toml`

Note: Railway does not automatically follow the Root Directory when selecting a
config file, so you must set the absolute config path per service. A root
`railway.toml` is intentionally not used.

---

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch
```

---

## File Structure

```
convex/component/                  # Backend (Convex component)
├── convex.config.ts               # Component definition
├── schema.ts                      # Tables (conversations, messages, streamingMessages, streamDeltas)
├── conversations.ts               # Conversation CRUD
├── messages.ts                    # Message CRUD
├── stream.ts                      # Delta-based streaming (create, addDelta, finish, abort)
├── deltaStreamer.ts               # DeltaStreamer class for batched writes
├── chat.ts                        # Main send action with OpenRouter
├── tools.ts                       # Tool types & helpers
├── schemaTools.ts                 # Auto-tool generation
├── client.ts                      # Client wrapper (defineDatabaseChat)
└── *.test.ts                      # Tests

src/                               # Frontend (React)
├── react.tsx                      # React hooks (useDatabaseChat, useConversations, etc.)
├── react.test.tsx                 # Hook tests
└── index.ts                       # Package exports
```

---

## License

MIT
