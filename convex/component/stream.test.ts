/// <reference types="vite/client" />
import { describe, it, expect, beforeEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

describe("databaseChat streaming", () => {
  function setupTest() {
    return convexTest(schema, modules);
  }

  async function createConversation(t: ReturnType<typeof setupTest>) {
    return await t.mutation(api.conversations.create, {
      externalId: "user:test",
    });
  }

  // ===========================================================================
  // New Delta-Based Streaming Tests
  // ===========================================================================

  describe("create (new delta-based)", () => {
    it("should create a new stream for a conversation", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const streamId = await t.mutation(api.stream.create, { conversationId });

      expect(streamId).toBeDefined();

      const state = await t.query(api.stream.getStream, { conversationId });
      expect(state).not.toBeNull();
      expect(state?.streamId).toBe(streamId);
      expect(state?.status).toBe("streaming");
      expect(state?.startedAt).toBeTypeOf("number");
    });

    it("should abort existing stream when creating a new one", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const streamId1 = await t.mutation(api.stream.create, { conversationId });
      const streamId2 = await t.mutation(api.stream.create, { conversationId });

      expect(streamId1).not.toBe(streamId2);

      const state = await t.query(api.stream.getStream, { conversationId });
      expect(state?.streamId).toBe(streamId2);
      expect(state?.status).toBe("streaming");
    });
  });

  describe("addDelta", () => {
    it("should add a delta to the stream", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      const success = await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [{ type: "text-delta", text: "Hello" }],
      });

      expect(success).toBe(true);

      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });

      expect(deltas).toHaveLength(1);
      expect(deltas[0].parts[0]).toEqual({ type: "text-delta", text: "Hello" });
    });

    it("should add multiple deltas in sequence", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [{ type: "text-delta", text: "Hello" }],
      });
      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 1,
        end: 2,
        parts: [{ type: "text-delta", text: ", " }],
      });
      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 2,
        end: 3,
        parts: [{ type: "text-delta", text: "world!" }],
      });

      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });

      expect(deltas).toHaveLength(3);
    });

    it("should return false if stream does not exist", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });
      
      // Finish the stream first
      await t.mutation(api.stream.finish, { streamId });

      const success = await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [{ type: "text-delta", text: "Hello" }],
      });

      expect(success).toBe(false);
    });

    it("should support tool-call parts", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [
          {
            type: "tool-call",
            toolCallId: "call_123",
            toolName: "search",
            args: '{"query": "test"}',
          },
        ],
      });

      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });

      expect(deltas[0].parts[0]).toEqual({
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "search",
        args: '{"query": "test"}',
      });
    });

    it("should support tool-result parts", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [
          {
            type: "tool-result",
            toolCallId: "call_123",
            result: '{"data": "result"}',
          },
        ],
      });

      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });

      expect(deltas[0].parts[0]).toEqual({
        type: "tool-result",
        toolCallId: "call_123",
        result: '{"data": "result"}',
      });
    });

    it("should support error parts", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [{ type: "error", error: "Something went wrong" }],
      });

      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });

      expect(deltas[0].parts[0]).toEqual({
        type: "error",
        error: "Something went wrong",
      });
    });
  });

  describe("listDeltas", () => {
    it("should return deltas from cursor position", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      // Add 5 deltas
      for (let i = 0; i < 5; i++) {
        await t.mutation(api.stream.addDelta, {
          streamId,
          start: i,
          end: i + 1,
          parts: [{ type: "text-delta", text: `chunk${i}` }],
        });
      }

      // Fetch from cursor 0 - should get all
      const allDeltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });
      expect(allDeltas).toHaveLength(5);

      // Fetch from cursor 3 - should get last 2
      const partialDeltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 3,
      });
      expect(partialDeltas).toHaveLength(2);
      expect(partialDeltas[0].parts[0]).toEqual({
        type: "text-delta",
        text: "chunk3",
      });
    });

    it("should return empty array for non-existent stream", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });
      
      // Finish and wait for cleanup
      await t.mutation(api.stream.finish, { streamId });

      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });
      expect(deltas).toHaveLength(0);
    });
  });

  describe("getStream", () => {
    it("should return current stream state", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      const state = await t.query(api.stream.getStream, { conversationId });

      expect(state).not.toBeNull();
      expect(state?.streamId).toBe(streamId);
      expect(state?.status).toBe("streaming");
      expect(state?.startedAt).toBeTypeOf("number");
      expect(state?.endedAt).toBeUndefined();
    });

    it("should return null for conversation with no stream", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const state = await t.query(api.stream.getStream, { conversationId });
      expect(state).toBeNull();
    });

    it("should return finished state after stream completes", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.finish, { streamId });

      const state = await t.query(api.stream.getStream, { conversationId });
      expect(state?.status).toBe("finished");
      expect(state?.endedAt).toBeTypeOf("number");
    });
  });

  describe("finish", () => {
    it("should mark stream as finished", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.finish, { streamId });

      const state = await t.query(api.stream.getStream, { conversationId });
      expect(state?.status).toBe("finished");
      expect(state?.endedAt).toBeTypeOf("number");
    });

    it("should delete all deltas when finished", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      // Add some deltas
      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [{ type: "text-delta", text: "Hello" }],
      });

      await t.mutation(api.stream.finish, { streamId });

      // Deltas should be deleted
      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });
      expect(deltas).toHaveLength(0);
    });

    it("should be idempotent (no error if already finished)", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.finish, { streamId });
      await expect(
        t.mutation(api.stream.finish, { streamId })
      ).resolves.toBeNull();
    });
  });

  describe("abort", () => {
    it("should mark stream as aborted with reason", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.abort, {
        streamId,
        reason: "User cancelled",
      });

      const state = await t.query(api.stream.getStream, { conversationId });
      expect(state?.status).toBe("aborted");
      expect(state?.abortReason).toBe("User cancelled");
      expect(state?.endedAt).toBeTypeOf("number");
    });

    it("should delete all deltas when aborted", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [{ type: "text-delta", text: "Hello" }],
      });

      await t.mutation(api.stream.abort, {
        streamId,
        reason: "Test abort",
      });

      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });
      expect(deltas).toHaveLength(0);
    });
  });

  describe("abortByConversation", () => {
    it("should abort stream by conversation ID", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      await t.mutation(api.stream.create, { conversationId });

      const success = await t.mutation(api.stream.abortByConversation, {
        conversationId,
        reason: "Client abort",
      });

      expect(success).toBe(true);

      const state = await t.query(api.stream.getStream, { conversationId });
      expect(state?.status).toBe("aborted");
      expect(state?.abortReason).toBe("Client abort");
    });

    it("should return false if no active stream", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const success = await t.mutation(api.stream.abortByConversation, {
        conversationId,
        reason: "No stream",
      });

      expect(success).toBe(false);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("should handle empty content deltas", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [{ type: "text-delta", text: "" }],
      });

      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });
      const content = deltas
        .flatMap((d) => d.parts)
        .filter((p) => p.type === "text-delta")
        .map((p) => p.text)
        .join("");
      expect(content).toBe("");
    });

    it("should handle multiple parts in single delta", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const streamId = await t.mutation(api.stream.create, { conversationId });

      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 3,
        parts: [
          { type: "text-delta", text: "Hello" },
          { type: "text-delta", text: " " },
          { type: "text-delta", text: "world" },
        ],
      });

      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });
      const content = deltas
        .flatMap((d) => d.parts)
        .filter((p) => p.type === "text-delta")
        .map((p) => p.text)
        .join("");
      expect(content).toBe("Hello world");
    });

    it("should handle rapid sequential creates", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      // Create multiple streams in rapid succession
      await t.mutation(api.stream.create, { conversationId });
      await t.mutation(api.stream.create, { conversationId });
      const finalStreamId = await t.mutation(api.stream.create, {
        conversationId,
      });

      const state = await t.query(api.stream.getStream, { conversationId });
      expect(state?.streamId).toBe(finalStreamId);
      expect(state?.status).toBe("streaming");
    });
  });
});
