import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireConversationExternalId } from "./access";

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
    return await listMessages(ctx, args.conversationId, args.limit);
  },
});

/**
 * List messages in a conversation scoped to externalId.
 * Throws "Not found" if the conversation is missing or not owned by externalId.
 */
export const listForExternalId = query({
  args: {
    conversationId: v.id("conversations"),
    externalId: v.string(),
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
    await requireConversationExternalId(
      ctx,
      args.conversationId,
      args.externalId
    );
    return await listMessages(ctx, args.conversationId, args.limit);
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
    return await getLatestMessage(ctx, args.conversationId);
  },
});

/**
 * Get the latest message in a conversation scoped to externalId.
 * Throws "Not found" if the conversation is missing or not owned by externalId.
 */
export const getLatestForExternalId = query({
  args: {
    conversationId: v.id("conversations"),
    externalId: v.string(),
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
    await requireConversationExternalId(
      ctx,
      args.conversationId,
      args.externalId
    );
    return await getLatestMessage(ctx, args.conversationId);
  },
});

async function listMessages(
  ctx: { db: any },
  conversationId: Id<"conversations">,
  rawLimit?: number
) {
  // Ensure limit is a positive integer with reasonable bounds
  // Handle NaN case by defaulting to 100
  const safeRawLimit = rawLimit ?? 100;
  const safeLimit = Number.isNaN(safeRawLimit) ? 100 : safeRawLimit;
  const limit = Math.min(1000, Math.max(1, Math.floor(safeLimit)));

  // Fetch most recent N messages (desc order), then reverse for chronological display
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q: any) => q.eq("conversationId", conversationId))
    .order("desc")
    .take(limit);

  return messages.reverse();
}

async function getLatestMessage(
  ctx: { db: any },
  conversationId: Id<"conversations">
) {
  return await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q: any) => q.eq("conversationId", conversationId))
    .order("desc")
    .first();
}
