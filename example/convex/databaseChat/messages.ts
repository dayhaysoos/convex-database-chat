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
 * List messages in a conversation (oldest first for chat display)
 */
export const list = query({
  args: {
    conversationId: v.id("conversations"),
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
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("asc") // Oldest first for chat display
      .collect();
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
