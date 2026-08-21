/**
 * Client wrapper for the DatabaseChat component.
 *
 * Apps use this to interact with the component in a type-safe way.
 *
 * ## Setup (in your app's convex/ folder)
 *
 * ```typescript
 * // convex/chat.ts
 * import { v } from "convex/values";
 * import { action, mutation, query } from "./_generated/server";
 * import { components } from "./_generated/api";
 * import { defineDatabaseChat } from "./components/databaseChat/client";
 *
 * // Initialize with default config
 * const chat = defineDatabaseChat(components.databaseChat, {
 *   model: "anthropic/claude-sonnet-4",
 *   systemPrompt: "You are a helpful assistant.",
 * });
 *
 * // Create conversation
 * export const createConversation = mutation({
 *   args: { title: v.optional(v.string()) },
 *   handler: async (ctx, args) => {
 *     const userId = await getAuthUserId(ctx); // Your auth
 *     return await chat.createConversation(ctx, {
 *       externalId: `user:${userId}`,
 *       title: args.title,
 *     });
 *   },
 * });
 *
 * // Get messages
 * export const getMessages = query({
 *   args: { conversationId: v.string() },
 *   handler: async (ctx, args) => {
 *     return await chat.getMessages(ctx, args.conversationId);
 *   },
 * });
 *
 * // Send message (action because it calls external API)
 * export const sendMessage = action({
 *   args: { conversationId: v.string(), message: v.string() },
 *   handler: async (ctx, args) => {
 *     return await chat.send(ctx, {
 *       conversationId: args.conversationId,
 *       message: args.message,
 *       apiKey: process.env.OPENROUTER_API_KEY!, // From app env
 *     });
 *   },
 * });
 *
 * // Get stream state (for real-time UI)
 * export const getStreamState = query({
 *   args: { conversationId: v.string() },
 *   handler: async (ctx, args) => {
 *     return await chat.getStreamState(ctx, args.conversationId);
 *   },
 * });
 *
 * // Get stream deltas (for efficient delta-based streaming)
 * export const getStreamDeltas = query({
 *   args: { streamId: v.string(), cursor: v.number() },
 *   handler: async (ctx, args) => {
 *     return await chat.getStreamDeltas(ctx, args.streamId, args.cursor);
 *   },
 * });
 * ```
 *
 * ## Advanced: Using your own LLM SDK (Vercel AI, OpenAI, etc.)
 *
 * For custom LLM integrations, use the DeltaStreamer class from the component.
 * See the component's chat.ts for an example of delta-based streaming.
 */

import type {
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import type { api } from "./_generated/api";
import type { DatabaseChatTool, AutoToolsConfig } from "./tools";
import type { TableInfo, SchemaToolHandlers } from "./schemaTools";
import { generateToolsFromSchema } from "./schemaTools";
import { formatToolsForLLM, findTool, validateToolArgs } from "./tools";
import {
  buildSystemPromptWithTools,
  type ToolGuidanceOption,
} from "./toolGuidance";

// Type for the component API (what apps get from components.databaseChat)
type ComponentApi = typeof api;

// Context types for different function types
type QueryCtx = GenericQueryCtx<any>;
type MutationCtx = GenericMutationCtx<any>;
type ActionCtx = GenericActionCtx<any>;

export interface DatabaseChatConfig {
  /** Default model to use (default: "openai/gpt-4o") */
  model?: string;
  /** Default system prompt */
  systemPrompt?: string;
  /** Reliability guidance for standard tool result contracts (default: "auto"). */
  toolGuidance?: ToolGuidanceOption;
  /**
   * Explicit tool definitions.
   * Use this for precise control over what queries the LLM can run.
   */
  tools?: DatabaseChatTool[];
  /**
   * Auto-generate tools from schema.
   * Provide table info and handlers to automatically create query tools.
   */
  autoTools?: {
    /** Table information (use defineTable helper or extract from schema) */
    tables: TableInfo[];
    /** Function handle strings for each tool type */
    handlers: SchemaToolHandlers;
  } & AutoToolsConfig;
  /**
   * Maximum messages to fetch for display (default: 100).
   * Fetches the most recent N messages to prevent unbounded queries.
   */
  maxMessagesForDisplay?: number;
  /**
   * Maximum messages to include in LLM context (default: 50).
   * Uses the most recent N messages for conversation history.
   */
  maxMessagesForLLM?: number;
  /**
   * Maximum tool-calling rounds per message before giving up (default: 5).
   */
  maxToolLoops?: number;
  /**
   * Minimum ms between stream delta writes (default: 100).
   */
  streamThrottleMs?: number;
  /**
   * OpenRouter attribution header (HTTP-Referer). Identifies your app to
   * OpenRouter. Defaults to the package repository URL.
   */
  httpReferer?: string;
  /**
   * OpenRouter attribution header (X-Title). Defaults to "DatabaseChat".
   */
  xTitle?: string;
  /**
   * Max characters of a serialized tool result sent to the LLM (default: 16000).
   * Oversized results are truncated and flagged with `{ truncated: true }`.
   */
  maxToolResultChars?: number;
  /**
   * Resolve the caller's externalId server-side. When configured, all client
   * methods route through ownership-checked (*ForExternalId) endpoints -
   * consumers can no longer accidentally skip access control.
   *
   * Runs inside your app's functions, so you can use Convex Auth, Clerk, or
   * any identity provider:
   *
   * ```typescript
   * const chat = defineDatabaseChat(components.databaseChat, {
   *   getExternalId: async (ctx) => {
   *     const userId = await getAuthUserId(ctx);
   *     if (!userId) throw new Error("Unauthorized");
   *     return `user:${userId}`;
   *   },
   * });
   * ```
   */
  getExternalId?: (ctx: QueryCtx | MutationCtx | ActionCtx) => Promise<string>;
}

export interface SendMessageOptions {
  conversationId: string;
  message: string;
  /** OpenRouter API key (required - get from process.env in your app) */
  apiKey: string;
  /** Override model for this message */
  model?: string;
  /** Override system prompt for this message */
  systemPrompt?: string;
  /** Override tool reliability guidance for this message */
  toolGuidance?: ToolGuidanceOption;
  /** Server-side context merged into tool args (not exposed to LLM) */
  toolContext?: Record<string, unknown>;
  /** Override max tool-calling rounds for this message */
  maxToolLoops?: number;
  /** Override stream throttle for this message */
  streamThrottleMs?: number;
  /** Override max tool result chars for this message */
  maxToolResultChars?: number;
  /**
   * Explicit externalId. Overrides the configured getExternalId resolver.
   * Only use this if the value is derived server-side, never from client input.
   */
  externalId?: string;
}

export interface SendMessageResult {
  success: boolean;
  content?: string;
  error?: string;
  /** Tool calls that were executed (for debugging/logging) */
  toolCalls?: Array<{ name: string; args: unknown; result: unknown }>;
}

/**
 * Client for interacting with the DatabaseChat component.
 */
export class DatabaseChatClient {
  private tools: DatabaseChatTool[];

  constructor(
    private component: ComponentApi,
    private config: DatabaseChatConfig = {}
  ) {
    // Combine explicit tools with auto-generated tools
    this.tools = this.initializeTools();
  }

  /**
   * Initialize tools from config (explicit + auto-generated).
   */
  private initializeTools(): DatabaseChatTool[] {
    const allTools: DatabaseChatTool[] = [];

    // Add explicit tools
    if (this.config.tools) {
      allTools.push(...this.config.tools);
    }

    // Add auto-generated tools from schema
    if (this.config.autoTools) {
      const { tables, handlers, ...autoConfig } = this.config.autoTools;
      const autoTools = generateToolsFromSchema({
        tables,
        handlers,
        ...autoConfig,
      });
      allTools.push(...autoTools);
    }

    return allTools;
  }

  /**
   * Get all configured tools.
   */
  getTools(): DatabaseChatTool[] {
    return this.tools;
  }

  /**
   * Get tools formatted for LLM API (OpenAI function calling format).
   */
  getToolsForLLM() {
    return formatToolsForLLM(this.tools);
  }

  /**
   * Find a tool by name.
   */
  findTool(name: string): DatabaseChatTool | undefined {
    return findTool(this.tools, name);
  }

  /**
   * Execute a tool by calling the function handle.
   * This is called by the chat action when the LLM requests a tool.
   */
  async executeTool(
    ctx: ActionCtx,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const tool = this.findTool(toolName);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${toolName}` };
    }

    // Validate arguments
    const validationError = validateToolArgs(tool, args);
    if (validationError) {
      return { success: false, error: validationError };
    }

    try {
      const result = await executeToolHandler(ctx, tool, args);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Tool execution failed",
      };
    }
  }

  /**
   * Check if any tools are configured.
   */
  hasTools(): boolean {
    return this.tools.length > 0;
  }

  /**
   * Resolve the externalId for a call: explicit argument first, then the
   * configured resolver. Throws when neither is available - data access
   * without an identity check is not allowed through this client.
   */
  private async resolveExternalId(
    ctx: QueryCtx | MutationCtx | ActionCtx,
    explicit?: string
  ): Promise<string> {
    if (explicit) {
      return explicit;
    }
    if (this.config.getExternalId) {
      return await this.config.getExternalId(ctx);
    }
    throw new Error(
      "defineDatabaseChat: no identity available. Configure getExternalId(ctx) " +
        "in your defineDatabaseChat config (recommended) or pass an explicit " +
        "server-derived externalId to access conversations securely."
    );
  }

  /**
   * Create a new conversation.
   */
  async createConversation(
    ctx: MutationCtx,
    options: { externalId?: string; title?: string }
  ): Promise<string> {
    const externalId = await this.resolveExternalId(ctx, options.externalId);
    return await ctx.runMutation(this.component.conversations.create, {
      externalId,
      title: options.title,
    });
  }

  /**
   * Get a conversation by ID (ownership-checked).
   */
  async getConversation(
    ctx: QueryCtx,
    conversationId: string,
    options?: { externalId?: string }
  ) {
    const externalId = await this.resolveExternalId(ctx, options?.externalId);
    return await ctx.runQuery(this.component.conversations.getForExternalId, {
      conversationId: conversationId as any,
      externalId,
    });
  }

  /**
   * List conversations for an external ID (e.g., user ID).
   */
  async listConversations(ctx: QueryCtx, explicitExternalId?: string) {
    const externalId = await this.resolveExternalId(ctx, explicitExternalId);
    return await ctx.runQuery(this.component.conversations.list, {
      externalId,
    });
  }

  /**
   * Get messages in a conversation (ownership-checked).
   * Returns the most recent messages, bounded by maxMessagesForDisplay config (default: 100).
   */
  async getMessages(
    ctx: QueryCtx,
    conversationId: string,
    options?: { externalId?: string; limit?: number }
  ) {
    const externalId = await this.resolveExternalId(ctx, options?.externalId);
    return await ctx.runQuery(this.component.messages.listForExternalId, {
      conversationId: conversationId as any,
      externalId,
      limit: options?.limit ?? this.config.maxMessagesForDisplay ?? 100,
    });
  }

  /**
   * Get the current stream state for a conversation (ownership-checked).
   * Use this to check if streaming is active and get the stream ID.
   */
  async getStreamState(
    ctx: QueryCtx,
    conversationId: string,
    options?: { externalId?: string }
  ) {
    const externalId = await this.resolveExternalId(ctx, options?.externalId);
    return await ctx.runQuery(this.component.stream.getStreamForExternalId, {
      conversationId: conversationId as any,
      externalId,
    });
  }

  /**
   * Get stream deltas from a cursor position (ownership-checked).
   * Use with getStreamState to efficiently fetch streaming content.
   *
   * @example
   * ```typescript
   * const state = await chat.getStreamState(ctx, conversationId);
   * if (state?.status === 'streaming') {
   *   const deltas = await chat.getStreamDeltas(ctx, state.streamId, cursor);
   *   // Accumulate text from deltas client-side
   * }
   * ```
   */
  async getStreamDeltas(
    ctx: QueryCtx,
    streamId: string,
    cursor: number,
    options?: { externalId?: string }
  ) {
    const externalId = await this.resolveExternalId(ctx, options?.externalId);
    return await ctx.runQuery(this.component.stream.listDeltasForExternalId, {
      streamId: streamId as any,
      externalId,
      cursor,
    });
  }

  /**
   * Abort an active stream for a conversation (ownership-checked).
   * Call this when the user wants to stop generation.
   */
  async abortStream(
    ctx: MutationCtx,
    conversationId: string,
    reason: string = "User cancelled",
    options?: { externalId?: string }
  ): Promise<boolean> {
    const externalId = await this.resolveExternalId(ctx, options?.externalId);
    return await ctx.runMutation(this.component.stream.abortForExternalId, {
      conversationId: conversationId as any,
      externalId,
      reason,
    });
  }

  /**
   * Send a message and get a streaming response.
   * This is the simple path - uses OpenRouter internally.
   *
   * If tools are configured (via explicit tools or autoTools), they will
   * automatically be included in the LLM call.
   */
  async send(
    ctx: ActionCtx,
    options: SendMessageOptions
  ): Promise<SendMessageResult> {
    const externalId = await this.resolveExternalId(ctx, options.externalId);
    return await ctx.runAction(this.component.chat.sendForExternalId, {
      conversationId: options.conversationId as any,
      externalId,
      message: options.message,
      config: {
        apiKey: options.apiKey,
        model: options.model ?? this.config.model,
        systemPrompt: options.systemPrompt ?? this.config.systemPrompt,
        toolGuidance: options.toolGuidance ?? this.config.toolGuidance,
        tools: this.tools.length > 0 ? this.tools : undefined,
        maxMessagesForLLM: this.config.maxMessagesForLLM ?? 50,
        toolContext: options.toolContext,
        maxToolLoops: options.maxToolLoops ?? this.config.maxToolLoops,
        streamThrottleMs:
          options.streamThrottleMs ?? this.config.streamThrottleMs,
        maxToolResultChars:
          options.maxToolResultChars ?? this.config.maxToolResultChars,
        httpReferer: this.config.httpReferer,
        xTitle: this.config.xTitle,
      },
    });
  }

  // ===========================================================================
  // Advanced: Lower-level primitives for custom LLM integrations
  // Use these if you want to use Vercel AI SDK, direct OpenAI, etc.
  // ===========================================================================

  /**
   * Add a message to a conversation.
   * Use this when bringing your own LLM SDK.
   *
   * @example
   * ```typescript
   * // Save user message
   * await chat.addMessage(ctx, conversationId, "user", userInput);
   *
   * // Call your LLM (Vercel AI SDK, OpenAI, etc.)
   * const response = await yourLLMCall(...);
   *
   * // Save assistant response
   * await chat.addMessage(ctx, conversationId, "assistant", response);
   * ```
   */
  async addMessage(
    ctx: MutationCtx,
    conversationId: string,
    role: "user" | "assistant" | "tool",
    content: string,
    options?: {
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      toolResults?: Array<{ toolCallId: string; result: string }>;
    }
  ): Promise<string> {
    return await ctx.runMutation(this.component.messages.add, {
      conversationId: conversationId as any,
      role,
      content,
      toolCalls: options?.toolCalls,
      toolResults: options?.toolResults,
    });
  }

  /**
   * Get messages formatted for LLM API calls.
   * Returns messages in the format expected by most LLM APIs.
   * Uses maxMessagesForLLM config to limit context (default: 50).
   *
   * @example
   * ```typescript
   * const messages = await chat.getMessagesForLLM(ctx, conversationId, {
   *   systemPrompt: "You are a helpful assistant.",
   * });
   * // Returns: [{ role: "system", content: "..." }, { role: "user", content: "..." }, ...]
   * ```
   */
  async getMessagesForLLM(
    ctx: QueryCtx,
    conversationId: string,
    options?: {
      systemPrompt?: string;
      includeTools?: boolean;
      toolGuidance?: ToolGuidanceOption;
    }
  ): Promise<{
    messages: Array<{ role: string; content: string }>;
    tools?: ReturnType<typeof formatToolsForLLM>;
  }> {
    // Use LLM-specific limit for context window efficiency
    const messages = await ctx.runQuery(this.component.messages.list, {
      conversationId: conversationId as any,
      limit: this.config.maxMessagesForLLM ?? 50,
    });

    const formatted: Array<{ role: string; content: string }> = [];

    const basePrompt = options?.systemPrompt ?? this.config.systemPrompt ?? "";
    const systemPrompt =
      this.hasTools() && options?.includeTools !== false
        ? buildSystemPromptWithTools(basePrompt, this.tools, {
            toolGuidance: options?.toolGuidance ?? this.config.toolGuidance,
          })
        : basePrompt;

    if (systemPrompt) {
      formatted.push({ role: "system", content: systemPrompt });
    }

    // Add conversation messages
    for (const msg of messages) {
      if (msg.role === "user" || msg.role === "assistant") {
        formatted.push({ role: msg.role, content: msg.content });
      }
      // Handle tool messages
      if (msg.role === "tool" && msg.toolResults) {
        for (const result of msg.toolResults) {
          formatted.push({
            role: "tool",
            content: result.result,
          });
        }
      }
    }

    const result: {
      messages: Array<{ role: string; content: string }>;
      tools?: ReturnType<typeof formatToolsForLLM>;
    } = { messages: formatted };

    // Include tools if configured and requested
    if (this.hasTools() && options?.includeTools !== false) {
      result.tools = this.getToolsForLLM();
    }

    return result;
  }

  /**
   * Build the system prompt with optional tool descriptions.
   */
  getSystemPromptWithTools(
    basePrompt?: string,
    toolGuidance?: ToolGuidanceOption
  ): string {
    const prompt = basePrompt ?? this.config.systemPrompt ?? "";

    if (!this.hasTools()) {
      return prompt;
    }

    return buildSystemPromptWithTools(prompt, this.tools, {
      toolGuidance: toolGuidance ?? this.config.toolGuidance,
    });
  }
}

/**
 * Helper function to create a DatabaseChatClient.
 *
 * Usage:
 * ```typescript
 * const chat = defineDatabaseChat(components.databaseChat, {
 *   model: "anthropic/claude-sonnet-4",
 *   systemPrompt: "You are a helpful assistant.",
 * });
 * ```
 */
export function defineDatabaseChat(
  component: ComponentApi,
  config: DatabaseChatConfig = {}
): DatabaseChatClient {
  return new DatabaseChatClient(component, config);
}

async function executeToolHandler(
  ctx: ActionCtx,
  tool: DatabaseChatTool,
  args: Record<string, unknown>
) {
  const handlerType = tool.handlerType ?? "query";
  switch (handlerType) {
    case "mutation":
      return await ctx.runMutation(tool.handler as any, args);
    case "action":
      return await ctx.runAction(tool.handler as any, args);
    case "query":
    default:
      return await ctx.runQuery(tool.handler as any, args);
  }
}
