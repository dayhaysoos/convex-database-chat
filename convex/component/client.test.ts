/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { DatabaseChatClient, defineDatabaseChat } from "./client";

const modules = import.meta.glob("./**/*.ts");

describe("DatabaseChatClient", () => {
  function setupTest() {
    return convexTest(schema, modules);
  }

  describe("defineDatabaseChat", () => {
    it("should create a DatabaseChatClient instance", () => {
      const client = defineDatabaseChat(api, {
        model: "test-model",
        systemPrompt: "Test prompt",
      });

      expect(client).toBeInstanceOf(DatabaseChatClient);
    });

    it("should work with default config", () => {
      const client = defineDatabaseChat(api);
      expect(client).toBeInstanceOf(DatabaseChatClient);
    });
  });

  describe("conversation operations via client pattern", () => {
    // These tests verify the component functions work correctly,
    // which is what the client wraps.

    it("should create and retrieve a conversation", async () => {
      const t = setupTest();

      // This simulates what the client does internally
      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:test",
        title: "Test Chat",
      });

      const conversation = await t.query(api.conversations.get, {
        conversationId,
      });

      expect(conversation).not.toBeNull();
      expect(conversation?.title).toBe("Test Chat");
    });

    it("should list conversations for an external ID", async () => {
      const t = setupTest();

      await t.mutation(api.conversations.create, {
        externalId: "user:alice",
        title: "Chat 1",
      });
      await t.mutation(api.conversations.create, {
        externalId: "user:alice",
        title: "Chat 2",
      });

      const conversations = await t.query(api.conversations.list, {
        externalId: "user:alice",
      });

      expect(conversations).toHaveLength(2);
    });

    it("should get messages in a conversation", async () => {
      const t = setupTest();

      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:test",
      });

      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "Hello",
      });
      await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "Hi there!",
      });

      const messages = await t.query(api.messages.list, { conversationId });

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("Hello");
      expect(messages[1].content).toBe("Hi there!");
    });

    it("should get streaming content via delta-based API", async () => {
      const t = setupTest();

      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:test",
      });

      const streamId = await t.mutation(api.stream.create, { conversationId });
      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [{ type: "text-delta", text: "Streaming..." }],
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
      expect(content).toBe("Streaming...");
    });
  });

  describe("advanced: custom LLM SDK flow", () => {
    it("should support manual message flow for custom LLM integrations", async () => {
      const t = setupTest();

      // 1. Create conversation
      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:test",
      });

      // 2. Add user message (like chat.addMessage would do)
      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "What is 2+2?",
      });

      // 3. Get messages for LLM (simulating getMessagesForLLM)
      const messages = await t.query(api.messages.list, { conversationId });
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");

      // 4. Create stream (delta-based API)
      const streamId = await t.mutation(api.stream.create, { conversationId });

      // 5. Simulate streaming updates using delta-based API
      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 0,
        end: 1,
        parts: [{ type: "text-delta", text: "The" }],
      });
      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 1,
        end: 2,
        parts: [{ type: "text-delta", text: " answer" }],
      });
      await t.mutation(api.stream.addDelta, {
        streamId,
        start: 2,
        end: 3,
        parts: [{ type: "text-delta", text: " is 4." }],
      });

      // Verify streaming state via deltas
      const deltas = await t.query(api.stream.listDeltas, {
        streamId,
        cursor: 0,
      });
      const streamContent = deltas
        .flatMap((d) => d.parts)
        .filter((p) => p.type === "text-delta")
        .map((p) => p.text)
        .join("");
      expect(streamContent).toBe("The answer is 4.");

      // 6. Finish streaming
      await t.mutation(api.stream.finish, { streamId });

      // 7. Save assistant response
      await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "The answer is 4.",
      });

      // Verify final state
      const finalMessages = await t.query(api.messages.list, {
        conversationId,
      });
      expect(finalMessages).toHaveLength(2);
      expect(finalMessages[0].role).toBe("user");
      expect(finalMessages[1].role).toBe("assistant");
      expect(finalMessages[1].content).toBe("The answer is 4.");

      // Streaming should be finished (deltas deleted)
      const state = await t.query(api.stream.getStream, { conversationId });
      expect(state?.status).toBe("finished");
    });

    it("should support tool call messages", async () => {
      const t = setupTest();

      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:test",
      });

      // Assistant message with tool call
      await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "Let me search for that.",
        toolCalls: [
          {
            id: "call_123",
            name: "searchDatabase",
            arguments: JSON.stringify({ query: "test" }),
          },
        ],
      });

      // Tool result
      await t.mutation(api.messages.add, {
        conversationId,
        role: "tool",
        content: "",
        toolResults: [
          {
            toolCallId: "call_123",
            result: JSON.stringify({ found: 5 }),
          },
        ],
      });

      const messages = await t.query(api.messages.list, { conversationId });
      expect(messages).toHaveLength(2);
      expect(messages[0].toolCalls).toHaveLength(1);
      expect(messages[1].toolResults).toHaveLength(1);
    });
  });
});
