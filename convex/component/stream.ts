import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  requireConversationExternalId,
  requireStreamExternalId,
} from "./access";

// Timeout configuration
const TIMEOUT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_DELTAS_PER_QUERY = 100;
const CLEANUP_DELAY_MS = 30 * 1000; // 30 seconds - delay before deleting finished streams

// Validator for stream parts - matches schema and StreamPart interface
const streamPartValidator = v.object({
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
  args: v.optional(v.string()),
  result: v.optional(v.string()),
  // For error
  error: v.optional(v.string()),
});

/**
 * Create a new stream for a conversation.
 * Called when starting to stream a response.
 */
export const create = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  returns: v.id("streamingMessages"),
  handler: async (ctx, args) => {
    // Check for any existing streaming streams and abort them
    const existingStream = await ctx.db
      .query("streamingMessages")
      .withIndex("by_conversation_status", (q) =>
        q.eq("conversationId", args.conversationId).eq("status", "streaming")
      )
      .first();

    if (existingStream) {
      // Cancel the existing stream's timeout
      if (existingStream.timeoutFnId) {
        try {
          await ctx.scheduler.cancel(existingStream.timeoutFnId);
        } catch {
          // Timeout may have already fired
        }
      }

      // Abort the existing stream
      await ctx.db.patch(existingStream._id, {
        status: "aborted",
        abortReason: "New stream started",
        endedAt: Date.now(),
        timeoutFnId: undefined,
      });

      // Delete its deltas
      await deleteStreamDeltas(ctx, existingStream._id);

      // Schedule cleanup of the old stream record
      await ctx.scheduler.runAfter(
        CLEANUP_DELAY_MS,
        internal.stream.cleanupStream,
        { streamId: existingStream._id }
      );
    }

    const now = Date.now();

    // Create the stream
    const streamId = await ctx.db.insert("streamingMessages", {
      conversationId: args.conversationId,
      status: "streaming",
      startedAt: now,
      lastHeartbeat: now,
    });

    // Schedule timeout check
    const timeoutFnId = await ctx.scheduler.runAfter(
      TIMEOUT_INTERVAL_MS,
      internal.stream.timeoutStream,
      { streamId }
    );

    await ctx.db.patch(streamId, { timeoutFnId });

    return streamId;
  },
});

/**
 * Add a delta (batch of parts) to a stream.
 * Called periodically by DeltaStreamer as tokens arrive.
 * Returns false if stream was aborted (signals caller to stop).
 */
export const addDelta = mutation({
  args: {
    streamId: v.id("streamingMessages"),
    start: v.number(),
    end: v.number(),
    parts: v.array(streamPartValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const stream = await ctx.db.get(args.streamId);
    if (!stream) {
      console.warn("Stream not found:", args.streamId);
      return false;
    }

    if (stream.status !== "streaming") {
      // Stream was aborted externally
      return false;
    }

    // Insert the delta
    await ctx.db.insert("streamDeltas", {
      streamId: args.streamId,
      start: args.start,
      end: args.end,
      parts: args.parts,
    });

    // Update heartbeat
    await ctx.db.patch(args.streamId, {
      lastHeartbeat: Date.now(),
    });

    return true;
  },
});

/**
 * Mark a stream as finished and clean up deltas.
 * Called when streaming completes successfully.
 */
export const finish = mutation({
  args: {
    streamId: v.id("streamingMessages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const stream = await ctx.db.get(args.streamId);
    if (!stream) {
      console.warn("Stream not found:", args.streamId);
      return null;
    }

    if (stream.status !== "streaming") {
      console.warn("Stream already finished/aborted:", args.streamId);
      return null;
    }

    // Cancel timeout
    if (stream.timeoutFnId) {
      try {
        await ctx.scheduler.cancel(stream.timeoutFnId);
      } catch {
        // Timeout may have already fired
      }
    }

    // Mark as finished
    await ctx.db.patch(args.streamId, {
      status: "finished",
      endedAt: Date.now(),
      timeoutFnId: undefined,
    });

    // Delete all deltas immediately (client reads final message from messages table)
    await deleteStreamDeltas(ctx, args.streamId);

    // Schedule cleanup of the stream record after a delay
    // This gives clients time to observe the "finished" status before deletion
    await ctx.scheduler.runAfter(
      CLEANUP_DELAY_MS,
      internal.stream.cleanupStream,
      { streamId: args.streamId }
    );

    return null;
  },
});

/**
 * Abort a stream.
 * Called when generation is cancelled or fails.
 */
export const abort = mutation({
  args: {
    streamId: v.id("streamingMessages"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const stream = await ctx.db.get(args.streamId);
    if (!stream) {
      console.warn("Stream not found:", args.streamId);
      return null;
    }

    if (stream.status !== "streaming") {
      return null;
    }

    // Cancel timeout
    if (stream.timeoutFnId) {
      try {
        await ctx.scheduler.cancel(stream.timeoutFnId);
      } catch {
        // Timeout may have already fired
      }
    }

    // Mark as aborted
    await ctx.db.patch(args.streamId, {
      status: "aborted",
      abortReason: args.reason,
      endedAt: Date.now(),
      timeoutFnId: undefined,
    });

    // Delete all deltas
    await deleteStreamDeltas(ctx, args.streamId);

    // Schedule cleanup of the stream record after a delay
    await ctx.scheduler.runAfter(
      CLEANUP_DELAY_MS,
      internal.stream.cleanupStream,
      { streamId: args.streamId }
    );

    return null;
  },
});

/**
 * Abort a stream by conversation ID.
 * Used when client wants to stop generation.
 */
export const abortByConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
    reason: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await abortStreamByConversationId(
      ctx,
      args.conversationId,
      args.reason
    );
  },
});

/**
 * Abort a stream by conversation ID, scoped to externalId.
 * Throws "Not found" if the conversation is missing or not owned by externalId.
 */
export const abortForExternalId = mutation({
  args: {
    conversationId: v.id("conversations"),
    externalId: v.string(),
    reason: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireConversationExternalId(
      ctx,
      args.conversationId,
      args.externalId
    );
    return await abortStreamByConversationId(
      ctx,
      args.conversationId,
      args.reason
    );
  },
});

/**
 * Get the current stream state for a conversation.
 * Clients subscribe to this to know when streaming starts/stops.
 * Prioritizes active "streaming" status, falls back to most recent.
 */
export const getStream = query({
  args: {
    conversationId: v.id("conversations"),
  },
  returns: v.union(
    v.object({
      streamId: v.id("streamingMessages"),
      status: v.union(
        v.literal("streaming"),
        v.literal("finished"),
        v.literal("aborted")
      ),
      startedAt: v.number(),
      endedAt: v.optional(v.number()),
      abortReason: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    return await getStreamState(ctx, args.conversationId);
  },
});

/**
 * Get the current stream state for a conversation scoped to externalId.
 * Throws "Not found" if the conversation is missing or not owned by externalId.
 */
export const getStreamForExternalId = query({
  args: {
    conversationId: v.id("conversations"),
    externalId: v.string(),
  },
  returns: v.union(
    v.object({
      streamId: v.id("streamingMessages"),
      status: v.union(
        v.literal("streaming"),
        v.literal("finished"),
        v.literal("aborted")
      ),
      startedAt: v.number(),
      endedAt: v.optional(v.number()),
      abortReason: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    await requireConversationExternalId(
      ctx,
      args.conversationId,
      args.externalId
    );
    return await getStreamState(ctx, args.conversationId);
  },
});

/**
 * List deltas for a stream from a given cursor position.
 * Clients call this to get new deltas since their last fetch.
 */
export const listDeltas = query({
  args: {
    streamId: v.id("streamingMessages"),
    cursor: v.number(),
  },
  returns: v.array(
    v.object({
      start: v.number(),
      end: v.number(),
      parts: v.array(streamPartValidator),
    })
  ),
  handler: async (ctx, args) => {
    return await listStreamDeltas(ctx, args.streamId, args.cursor);
  },
});

/**
 * List deltas for a stream scoped to externalId.
 * Throws "Not found" if the stream is missing or not owned by externalId.
 */
export const listDeltasForExternalId = query({
  args: {
    streamId: v.id("streamingMessages"),
    externalId: v.string(),
    cursor: v.number(),
  },
  returns: v.array(
    v.object({
      start: v.number(),
      end: v.number(),
      parts: v.array(streamPartValidator),
    })
  ),
  handler: async (ctx, args) => {
    await requireStreamExternalId(ctx, args.streamId, args.externalId);
    return await listStreamDeltas(ctx, args.streamId, args.cursor);
  },
});

/**
 * Internal: Handle stream timeout.
 * Called by scheduler if no heartbeat received.
 */
export const timeoutStream = internalMutation({
  args: {
    streamId: v.id("streamingMessages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const stream = await ctx.db.get(args.streamId);
    if (!stream || stream.status !== "streaming") {
      return null;
    }

    // Check if heartbeat is recent (maybe timeout was rescheduled)
    const timeSinceHeartbeat = Date.now() - stream.lastHeartbeat;
    if (timeSinceHeartbeat < TIMEOUT_INTERVAL_MS) {
      // Reschedule timeout
      const timeoutFnId = await ctx.scheduler.runAfter(
        TIMEOUT_INTERVAL_MS - timeSinceHeartbeat,
        internal.stream.timeoutStream,
        { streamId: args.streamId }
      );
      await ctx.db.patch(args.streamId, { timeoutFnId });
      return null;
    }

    // Actually timed out
    await ctx.db.patch(args.streamId, {
      status: "aborted",
      abortReason: "Timeout - no heartbeat received",
      endedAt: Date.now(),
      timeoutFnId: undefined,
    });

    // Delete deltas
    await deleteStreamDeltas(ctx, args.streamId);

    // Schedule cleanup of the stream record
    await ctx.scheduler.runAfter(
      CLEANUP_DELAY_MS,
      internal.stream.cleanupStream,
      { streamId: args.streamId }
    );

    return null;
  },
});

/**
 * Internal: Clean up a finished/aborted stream record.
 * Called after a delay to give clients time to observe final status.
 * Also cleans up any remaining deltas that weren't deleted in the initial pass.
 */
export const cleanupStream = internalMutation({
  args: {
    streamId: v.id("streamingMessages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const stream = await ctx.db.get(args.streamId);
    if (!stream) {
      // Already deleted
      return null;
    }

    // Only delete if stream is in a terminal state
    if (stream.status === "streaming") {
      // Stream is still active, don't delete
      return null;
    }

    // Clean up any remaining deltas (in case initial deletion was batched)
    await deleteStreamDeltas(ctx, args.streamId);

    // Check if there are still deltas remaining (very long stream)
    const remainingDeltas = await ctx.db
      .query("streamDeltas")
      .withIndex("by_stream_cursor", (q: any) => q.eq("streamId", args.streamId))
      .first();

    if (remainingDeltas) {
      // More deltas to delete, reschedule cleanup
      await ctx.scheduler.runAfter(
        1000, // 1 second delay between batches
        internal.stream.cleanupStream,
        { streamId: args.streamId }
      );
      return null;
    }

    // All deltas deleted, now delete the stream record
    await ctx.db.delete(args.streamId);

    return null;
  },
});

/**
 * Helper: Delete all deltas for a stream.
 * Uses .take() with a reasonable limit to avoid hitting mutation limits
 * on very long streams. For typical streams, this deletes all deltas.
 */
async function deleteStreamDeltas(
  ctx: { db: any },
  streamId: Id<"streamingMessages">
): Promise<void> {
  // Delete in batches to avoid hitting Convex mutation limits
  // For typical streams (< 500 deltas), this completes in one pass
  const MAX_DELTAS_TO_DELETE = 500;
  
  const deltas = await ctx.db
    .query("streamDeltas")
    .withIndex("by_stream_cursor", (q: any) => q.eq("streamId", streamId))
    .take(MAX_DELTAS_TO_DELETE);

  for (const delta of deltas) {
    await ctx.db.delete(delta._id);
  }

  // If there were more deltas, they'll be cleaned up by the scheduled
  // cleanupStream mutation, which will re-run deleteStreamDeltas
}

async function getStreamState(
  ctx: { db: any },
  conversationId: Id<"conversations">
) {
  // First, try to find an active streaming stream
  const activeStream = await ctx.db
    .query("streamingMessages")
    .withIndex("by_conversation_status", (q: any) =>
      q.eq("conversationId", conversationId).eq("status", "streaming")
    )
    .first();

  if (activeStream) {
    return {
      streamId: activeStream._id,
      status: activeStream.status,
      startedAt: activeStream.startedAt,
      endedAt: activeStream.endedAt,
      abortReason: activeStream.abortReason,
    };
  }

  // If no active stream, find the most recent one (for status updates)
  const stream = await ctx.db
    .query("streamingMessages")
    .withIndex("by_conversation", (q: any) =>
      q.eq("conversationId", conversationId)
    )
    .order("desc")
    .first();

  if (!stream) {
    return null;
  }

  return {
    streamId: stream._id,
    status: stream.status,
    startedAt: stream.startedAt,
    endedAt: stream.endedAt,
    abortReason: stream.abortReason,
  };
}

async function listStreamDeltas(
  ctx: { db: any },
  streamId: Id<"streamingMessages">,
  cursor: number
) {
  // Ensure cursor is non-negative for defensive programming
  const safeCursor = Math.max(0, cursor);

  const deltas = await ctx.db
    .query("streamDeltas")
    .withIndex("by_stream_cursor", (q: any) =>
      q.eq("streamId", streamId).gte("start", safeCursor)
    )
    .take(MAX_DELTAS_PER_QUERY);

  return deltas.map((d: { start: number; end: number; parts: any }) => ({
    start: d.start,
    end: d.end,
    parts: d.parts,
  }));
}

async function abortStreamByConversationId(
  ctx: { db: any; scheduler: any },
  conversationId: Id<"conversations">,
  reason: string
) {
  const stream = await ctx.db
    .query("streamingMessages")
    .withIndex("by_conversation_status", (q: any) =>
      q.eq("conversationId", conversationId).eq("status", "streaming")
    )
    .first();

  if (!stream) {
    return false;
  }

  // Cancel timeout
  if (stream.timeoutFnId) {
    try {
      await ctx.scheduler.cancel(stream.timeoutFnId);
    } catch {
      // Timeout may have already fired
    }
  }

  // Mark as aborted
  await ctx.db.patch(stream._id, {
    status: "aborted",
    abortReason: reason,
    endedAt: Date.now(),
    timeoutFnId: undefined,
  });

  // Delete all deltas
  await deleteStreamDeltas(ctx, stream._id);

  // Schedule cleanup of the stream record
  await ctx.scheduler.runAfter(CLEANUP_DELAY_MS, internal.stream.cleanupStream, {
    streamId: stream._id,
  });

  return true;
}
