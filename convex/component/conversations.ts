import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Create a new conversation
 */
export const create = mutation({
  args: {
    externalId: v.string(),
    title: v.optional(v.string()),
  },
  returns: v.id("conversations"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("conversations", {
      externalId: args.externalId,
      title: args.title,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Get a conversation by ID
 */
export const get = query({
  args: {
    conversationId: v.id("conversations"),
  },
  returns: v.union(
    v.object({
      _id: v.id("conversations"),
      _creationTime: v.number(),
      externalId: v.string(),
      title: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

/**
 * List conversations for an external ID (e.g., user)
 */
export const list = query({
  args: {
    externalId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("conversations"),
      _creationTime: v.number(),
      externalId: v.string(),
      title: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversations")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .order("desc")
      .collect();
  },
});
