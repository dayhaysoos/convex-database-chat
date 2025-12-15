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
 * // Get streaming content (for real-time UI)
 * export const getStreaming = query({
 *   args: { conversationId: v.string() },
 *   handler: async (ctx, args) => {
 *     return await chat.getStreamingContent(ctx, args.conversationId);
 *   },
 * });
 * ```
 *
 * ## Advanced: Using your own LLM SDK (Vercel AI, OpenAI, etc.)
 *
 * ```typescript
 * import { streamText } from "ai";
 * import { openai } from "@ai-sdk/openai";
 *
 * export const sendMessageCustom = action({
 *   args: { conversationId: v.string(), message: v.string() },
 *   handler: async (ctx, args) => {
 *     // 1. Save user message
 *     await chat.addMessage(ctx, args.conversationId, "user", args.message);
 *
 *     // 2. Get conversation history formatted for LLM
 *     const messages = await chat.getMessagesForLLM(ctx, args.conversationId);
 *
 *     // 3. Init streaming
 *     await chat.initStream(ctx, args.conversationId);
 *
 *     // 4. Call YOUR LLM SDK
 *     let fullContent = "";
 *     const result = await streamText({
 *       model: openai("gpt-4o"),
 *       messages,
 *       onChunk: async ({ chunk }) => {
 *         if (chunk.type === "text-delta") {
 *           fullContent += chunk.text;
 *           await chat.updateStream(ctx, args.conversationId, fullContent);
 *         }
 *       },
 *     });
 *
 *     // 5. Clear streaming & save response
 *     await chat.clearStream(ctx, args.conversationId);
 *     await chat.addMessage(ctx, args.conversationId, "assistant", result.text);
 *
 *     return { success: true, content: result.text };
 *   },
 * });
 * ```
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
      // Call the function handle
      // Note: The handler is a function handle string, we need to call it
      // using ctx.runQuery or ctx.runMutation with the handle
      const result = await ctx.runQuery(tool.handler as any, args);
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
   * Create a new conversation.
   */
  async createConversation(
    ctx: MutationCtx,
    options: { externalId: string; title?: string }
  ): Promise<string> {
    return await ctx.runMutation(this.component.conversations.create, options);
  }

  /**
   * Get a conversation by ID.
   */
  async getConversation(ctx: QueryCtx, conversationId: string) {
    return await ctx.runQuery(this.component.conversations.get, {
      conversationId: conversationId as any,
    });
  }

  /**
   * List conversations for an external ID (e.g., user ID).
   */
  async listConversations(ctx: QueryCtx, externalId: string) {
    return await ctx.runQuery(this.component.conversations.list, {
      externalId,
    });
  }

  /**
   * Get messages in a conversation.
   */
  async getMessages(ctx: QueryCtx, conversationId: string) {
    return await ctx.runQuery(this.component.messages.list, {
      conversationId: conversationId as any,
    });
  }

  /**
   * Get current streaming content (for real-time UI updates).
   */
  async getStreamingContent(ctx: QueryCtx, conversationId: string) {
    return await ctx.runQuery(this.component.stream.getContent, {
      conversationId: conversationId as any,
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
    return await ctx.runAction(this.component.chat.send, {
      conversationId: options.conversationId as any,
      message: options.message,
      config: {
        apiKey: options.apiKey,
        model: options.model ?? this.config.model,
        systemPrompt: options.systemPrompt ?? this.config.systemPrompt,
        tools: this.tools.length > 0 ? this.tools : undefined,
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
   * Initialize streaming state. Call before starting to stream.
   */
  async initStream(ctx: MutationCtx, conversationId: string): Promise<void> {
    await ctx.runMutation(this.component.stream.init, {
      conversationId: conversationId as any,
    });
  }

  /**
   * Update streaming content. Call as tokens arrive.
   * The content should be the FULL accumulated content so far.
   */
  async updateStream(
    ctx: MutationCtx,
    conversationId: string,
    content: string
  ): Promise<void> {
    await ctx.runMutation(this.component.stream.update, {
      conversationId: conversationId as any,
      content,
    });
  }

  /**
   * Clear streaming state. Call when streaming is complete.
   */
  async clearStream(ctx: MutationCtx, conversationId: string): Promise<void> {
    await ctx.runMutation(this.component.stream.clear, {
      conversationId: conversationId as any,
    });
  }

  /**
   * Get messages formatted for LLM API calls.
   * Returns messages in the format expected by most LLM APIs.
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
    options?: { systemPrompt?: string; includeTools?: boolean }
  ): Promise<{
    messages: Array<{ role: string; content: string }>;
    tools?: ReturnType<typeof formatToolsForLLM>;
  }> {
    const messages = await this.getMessages(ctx, conversationId);

    const formatted: Array<{ role: string; content: string }> = [];

    // Build system prompt with tool descriptions if tools are configured
    let systemPrompt = options?.systemPrompt ?? this.config.systemPrompt ?? "";

    if (this.hasTools() && options?.includeTools !== false) {
      const toolDescriptions = this.tools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");
      systemPrompt += systemPrompt
        ? `\n\nYou have access to the following tools to query the database:\n${toolDescriptions}`
        : `You have access to the following tools to query the database:\n${toolDescriptions}`;
    }

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
  getSystemPromptWithTools(basePrompt?: string): string {
    const prompt = basePrompt ?? this.config.systemPrompt ?? "";

    if (!this.hasTools()) {
      return prompt;
    }

    const toolDescriptions = this.tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    return prompt
      ? `${prompt}\n\nYou have access to the following tools to query the database:\n${toolDescriptions}`
      : `You have access to the following tools to query the database:\n${toolDescriptions}`;
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
