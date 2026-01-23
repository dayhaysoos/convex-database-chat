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

  // Active streams (one per conversation during streaming)
  // Uses delta-based approach for O(n) bandwidth instead of O(n²)
  streamingMessages: defineTable({
    conversationId: v.id("conversations"),
    status: v.union(
      v.literal("streaming"),
      v.literal("finished"),
      v.literal("aborted")
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    abortReason: v.optional(v.string()),
    // Timeout handling - heartbeat updated on each delta write
    lastHeartbeat: v.number(),
    timeoutFnId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_status", ["conversationId", "status"]),

  // Stream deltas (batched chunks of content)
  // Clients subscribe to these and accumulate content client-side
  streamDeltas: defineTable({
    streamId: v.id("streamingMessages"),
    start: v.number(), // Cursor position (inclusive)
    end: v.number(), // Cursor position (exclusive)
    // Parts are stream chunks - text deltas, tool calls, tool results, or errors
    parts: v.array(
      v.object({
        type: v.union(
          v.literal("text-delta"),
          v.literal("tool-call"),
          v.literal("tool-result"),
          v.literal("error")
        ),
        // For text-delta
        text: v.optional(v.string()),
        // For tool-call and tool-result
        toolCallId: v.optional(v.string()),
        toolName: v.optional(v.string()),
        args: v.optional(v.string()), // JSON string of arguments
        result: v.optional(v.string()), // JSON string of result
        // For error
        error: v.optional(v.string()),
      })
    ),
  }).index("by_stream_cursor", ["streamId", "start"]),
});
