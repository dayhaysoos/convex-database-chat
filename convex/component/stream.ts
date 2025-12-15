import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Initialize streaming state for a conversation.
 * Clears any existing streaming state and creates a fresh one.
 */
export const init = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Clear any existing streaming state
    const existing = await ctx.db
      .query("streamingChunks")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        content: "",
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("streamingChunks", {
        conversationId: args.conversationId,
        content: "",
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Update the streaming content (called as tokens arrive).
 */
export const update = mutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const chunk = await ctx.db
      .query("streamingChunks")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .first();

    if (chunk) {
      await ctx.db.patch(chunk._id, {
        content: args.content,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Clear streaming state when done.
 */
export const clear = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const chunk = await ctx.db
      .query("streamingChunks")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .first();

    if (chunk) {
      await ctx.db.delete(chunk._id);
    }

    return null;
  },
});

/**
 * Get the current streaming content.
 * React components subscribe to this for real-time updates.
 */
export const getContent = query({
  args: {
    conversationId: v.id("conversations"),
  },
  returns: v.union(
    v.object({
      content: v.string(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const chunk = await ctx.db
      .query("streamingChunks")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .first();

    if (!chunk) {
      return null;
    }

    return {
      content: chunk.content,
      updatedAt: chunk.updatedAt,
    };
  },
});
