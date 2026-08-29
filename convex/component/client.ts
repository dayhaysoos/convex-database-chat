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

import type { FunctionReference } from "convex/server";
import type { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { DatabaseChatTool, AutoToolsConfig } from "./tools";
import type { TableInfo, SchemaToolHandlers } from "./schemaTools";
import type { DatabaseChatSendResult } from "./chat";
import { buildMessagesWithTools } from "./chat";
import {
  mergeOptionLayers,
  type ChatOptions,
  type OptionOverrides,
} from "./options";
import { generateToolsFromSchema } from "./schemaTools";
import { formatToolsForLLM, findTool, validateToolArgs } from "./tools";
import { executeToolHandler } from "./toolExecution";
import {
  buildSystemPromptWithTools,
  type ToolGuidanceOption,
} from "./toolGuidance";

// Type for the component API (what apps get from components.databaseChat)
type ComponentApi = typeof api;

interface ClientQueryCtx {
  runQuery: <Args extends Record<string, unknown>, Result>(
    query: FunctionReference<"query", "public" | "internal", Args, Result>,
    args: Args,
  ) => Promise<Result>;
}

interface ClientMutationCtx {
  runMutation: <Args extends Record<string, unknown>, Result>(
    mutation: FunctionReference<
      "mutation",
      "public" | "internal",
      Args,
      Result
    >,
    args: Args,
  ) => Promise<Result>;
}

interface ClientActionCtx {
  runAction: <Args extends Record<string, unknown>, Result>(
    action: FunctionReference<"action", "public" | "internal", Args, Result>,
    args: Args,
  ) => Promise<Result>;
}

type QueryCtx = ClientQueryCtx;
type MutationCtx = ClientMutationCtx;
type ActionCtx = ClientActionCtx;

const asConversationId = (id: string): Id<"conversations"> =>
  id as Id<"conversations">;
const asStreamId = (id: string): Id<"streamingMessages"> =>
  id as Id<"streamingMessages">;

export interface DatabaseChatConfig {
  /**
   * Option defaults for every send. Per-call options in
   * `SendMessageOptions.options` override these field by field. Sections:
   * `chat` holds the chat-loop knobs (systemPrompt, maxToolLoops,
   * validateResultContract, ...), `provider` holds the transport knobs
   * (model, maxRetries, requestTimeoutMs, httpReferer, xTitle).
   */
  options?: OptionOverrides;
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
  /**
   * Per-call option overrides, merged field by field over the
   * `defineDatabaseChat` defaults. Sections: `chat`, `provider`.
   */
  options?: OptionOverrides;
  /**
   * Explicit externalId. Overrides the configured getExternalId resolver.
   * Only use this if the value is derived server-side, never from client input.
   */
  externalId?: string;
}

export type SendMessageResult = DatabaseChatSendResult;

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
    ctx: ClientActionCtx & ClientQueryCtx & ClientMutationCtx,
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
      conversationId: asConversationId(conversationId),
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
      conversationId: asConversationId(conversationId),
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
      conversationId: asConversationId(conversationId),
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
      streamId: asStreamId(streamId),
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
      conversationId: asConversationId(conversationId),
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
    const config = {
      apiKey: options.apiKey,
      chat: mergeOptionLayers(
        this.config.options?.chat,
        options.options?.chat,
        { tools: this.tools.length > 0 ? this.tools : undefined }
      ),
      provider: mergeOptionLayers(
        this.config.options?.provider,
        options.options?.provider
      ),
    };
    return await ctx.runAction(this.component.chat.sendForExternalId, {
      conversationId: asConversationId(options.conversationId),
      externalId,
      message: options.message,
      config,
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
    options: {
      externalId?: string;
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      toolResults?: Array<{ toolCallId: string; result: string }>;
    } = {}
  ): Promise<string> {
    const externalId = await this.resolveExternalId(ctx, options.externalId);
    return await ctx.runMutation(this.component.messages.addForExternalId, {
      conversationId: asConversationId(conversationId),
      externalId,
      role,
      content,
      toolCalls: options.toolCalls,
      toolResults: options.toolResults,
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
      externalId?: string;
      systemPrompt?: string;
      includeTools?: boolean;
      toolGuidance?: ToolGuidanceOption;
    }
  ): Promise<{
    messages: ReturnType<typeof buildMessagesWithTools>;
    tools?: ReturnType<typeof formatToolsForLLM>;
  }> {
    const externalId = await this.resolveExternalId(ctx, options?.externalId);
    const chatOptions = this.config.options?.chat;

    // Use LLM-specific limit for context window efficiency
    const messages = await ctx.runQuery(
      this.component.messages.listForExternalId,
      {
        conversationId: asConversationId(conversationId),
        externalId,
        limit: chatOptions?.maxMessagesForLLM ?? 50,
      },
    );

    const basePrompt =
      options?.systemPrompt ?? chatOptions?.systemPrompt ?? "";
    const systemPrompt =
      this.hasTools() && options?.includeTools !== false
        ? buildSystemPromptWithTools(basePrompt, this.tools, {
            toolGuidance: options?.toolGuidance ?? chatOptions?.toolGuidance,
          })
        : basePrompt;

    const result: {
      messages: Array<{
        role: string;
        content?: string;
        tool_calls?: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }>;
        tool_call_id?: string;
      }>;
      tools?: ReturnType<typeof formatToolsForLLM>;
    } = {
      messages: buildMessagesWithTools(messages, systemPrompt),
    };

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
    const prompt =
      basePrompt ?? this.config.options?.chat?.systemPrompt ?? "";

    if (!this.hasTools()) {
      return prompt;
    }

    return buildSystemPromptWithTools(prompt, this.tools, {
      toolGuidance:
        toolGuidance ?? this.config.options?.chat?.toolGuidance,
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
