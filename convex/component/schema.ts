import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Conversation threads
  conversations: defineTable({
    // App provides this to scope conversations (e.g., `user:${userId}`)
    externalId: v.string(),
    title: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_external_id", ["externalId"]),

  // Messages in conversations
  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("tool")),
    content: v.string(),
    // For tool calls made by assistant
    toolCalls: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          arguments: v.string(), // JSON string
        })
      )
    ),
    // For tool results
    toolResults: v.optional(
      v.array(
        v.object({
          toolCallId: v.string(),
          result: v.string(), // JSON string
        })
      )
    ),
    createdAt: v.number(),
  }).index("by_conversation", ["conversationId", "createdAt"]),

  // Streaming state (temporary, one per conversation during streaming)
  streamingChunks: defineTable({
    conversationId: v.id("conversations"),
    content: v.string(), // Accumulated content so far
    updatedAt: v.number(),
  }).index("by_conversation", ["conversationId"]),
});
