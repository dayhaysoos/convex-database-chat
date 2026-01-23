import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Shared validators
const toolCallValidator = v.object({
  id: v.string(),
  name: v.string(),
  arguments: v.string(),
});

const toolResultValidator = v.object({
  toolCallId: v.string(),
  result: v.string(),
});

const messageRoleValidator = v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("tool")
);

/**
 * Add a message to a conversation
 */
export const add = mutation({
  args: {
    conversationId: v.id("conversations"),
    role: messageRoleValidator,
    content: v.string(),
    toolCalls: v.optional(v.array(toolCallValidator)),
    toolResults: v.optional(v.array(toolResultValidator)),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    // Verify conversation exists
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const now = Date.now();

    // Update conversation's updatedAt
    await ctx.db.patch(args.conversationId, { updatedAt: now });

    return await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      toolCalls: args.toolCalls,
      toolResults: args.toolResults,
      createdAt: now,
    });
  },
});

/**
 * List messages in a conversation (oldest first for chat display).
 * Returns the most recent `limit` messages, bounded to prevent unbounded queries.
 */
export const list = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("messages"),
      _creationTime: v.number(),
      conversationId: v.id("conversations"),
      role: messageRoleValidator,
      content: v.string(),
      toolCalls: v.optional(v.array(toolCallValidator)),
      toolResults: v.optional(v.array(toolResultValidator)),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Ensure limit is a positive integer with reasonable bounds
    // Handle NaN case by defaulting to 100
    const rawLimit = args.limit ?? 100;
    const safeLimit = Number.isNaN(rawLimit) ? 100 : rawLimit;
    const limit = Math.min(1000, Math.max(1, Math.floor(safeLimit)));

    // Fetch most recent N messages (desc order), then reverse for chronological display
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc")
      .take(limit);

    return messages.reverse();
  },
});

/**
 * Get the latest message in a conversation
 */
export const getLatest = query({
  args: {
    conversationId: v.id("conversations"),
  },
  returns: v.union(
    v.object({
      _id: v.id("messages"),
      _creationTime: v.number(),
      conversationId: v.id("conversations"),
      role: messageRoleValidator,
      content: v.string(),
      toolCalls: v.optional(v.array(toolCallValidator)),
      toolResults: v.optional(v.array(toolResultValidator)),
      createdAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc")
      .first();
  },
});
