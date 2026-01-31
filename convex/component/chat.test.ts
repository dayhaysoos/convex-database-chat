/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { executeToolWithContext } from "./toolExecution";
import type { DatabaseChatTool } from "./tools";

const modules = import.meta.glob("./**/*.ts");

describe("databaseChat chat", () => {
  function setupTest() {
    return convexTest(schema, modules);
  }

  async function createConversation(t: ReturnType<typeof setupTest>) {
    return await t.mutation(api.conversations.create, {
      externalId: "user:test",
    });
  }

  // Note: Full integration tests for chat.send would require mocking OpenRouter.
  // These tests verify the supporting infrastructure works correctly.

  describe("chat infrastructure", () => {
    it("conversation and messages work together for chat flow", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      // Simulate what chat.send does (minus the LLM call)

      // 1. User sends a message
      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "Hello, can you help me?",
      });

      // 2. Get conversation history
      const messagesBefore = await t.query(api.messages.list, {
        conversationId,
      });
      expect(messagesBefore).toHaveLength(1);
      expect(messagesBefore[0].role).toBe("user");

      // 3. Create stream (delta-based API)
      const streamId = await t.mutation(api.stream.create, { conversationId });
      const streamState = await t.query(api.stream.getStream, {
        conversationId,
      });
      expect(streamState?.status).toBe("streaming");

      // 4. Simulate streaming updates using delta-based API
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
        parts: [{ type: "text-delta", text: "! I'd be happy to help." }],
      });

      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });
      const midStreamContent = deltas
        .flatMap((d) => d.parts)
        .filter((p) => p.type === "text-delta")
        .map((p) => p.text)
        .join("");
      expect(midStreamContent).toBe("Hello! I'd be happy to help.");

      // 5. Finish streaming
      await t.mutation(api.stream.finish, { streamId });
      const afterFinish = await t.query(api.stream.getStream, {
        conversationId,
      });
      expect(afterFinish?.status).toBe("finished");

      // 6. Save assistant response
      await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "Hello! I'd be happy to help. What do you need?",
      });

      // Verify final state
      const messagesAfter = await t.query(api.messages.list, {
        conversationId,
      });
      expect(messagesAfter).toHaveLength(2);
      expect(messagesAfter[0].role).toBe("user");
      expect(messagesAfter[1].role).toBe("assistant");
    });

    it("handles multiple back-and-forth messages", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      // Simulate a conversation
      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "Hi",
      });
      await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "Hello! How can I help?",
      });
      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "Find me candidates with React skills",
      });
      await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "I found 5 candidates with React skills.",
      });

      const messages = await t.query(api.messages.list, { conversationId });

      expect(messages).toHaveLength(4);
      expect(messages.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
    });
  });

  describe("tool context injection", () => {
    it("merges toolContext into tool args before execution", async () => {
      const ctx = {
        runQuery: async (_handler: string, args: Record<string, unknown>) => args,
        runMutation: async (
          _handler: string,
          args: Record<string, unknown>
        ) => args,
        runAction: async (_handler: string, args: Record<string, unknown>) =>
          args,
      };

      const tool: DatabaseChatTool = {
        name: "searchRecords",
        description: "Search records",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
        handler: "testHandler",
      };

      const { result, args } = await executeToolWithContext(
        ctx,
        tool,
        { query: "react", orgId: "llm-org" },
        { orgId: "org123", externalId: "user:1" }
      );

      expect(result).toEqual({
        query: "react",
        orgId: "org123",
        externalId: "user:1",
      });
      expect(args).toEqual(result);
    });
  });

  // TODO: Add integration test with mocked fetch for chat.send
  // This would require setting up MSW or similar to mock OpenRouter responses
  describe.skip("chat.send integration", () => {
    it("should send a message and get a response", async () => {
      // Would need to mock fetch to OpenRouter
    });

    it("should handle OpenRouter errors gracefully", async () => {
      // Would need to mock fetch to return an error
    });
  });
});
