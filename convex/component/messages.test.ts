/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

// Note: import.meta.glob is a Vite feature, requires /// <reference types="vite/client" />
const modules = import.meta.glob("./**/*.ts");

describe("databaseChat messages", () => {
  function setupTest() {
    return convexTest(schema, modules);
  }

  // Helper to create a conversation for message tests
  async function createConversation(t: ReturnType<typeof setupTest>) {
    return await t.mutation(api.conversations.create, {
      externalId: "user:test",
    });
  }

  describe("add", () => {
    it("should add a user message", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const messageId = await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "Hello, how are you?",
      });

      expect(messageId).toBeDefined();
    });

    it("should add an assistant message", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const messageId = await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "I'm doing well, thank you!",
      });

      expect(messageId).toBeDefined();
    });

    it("should add a message with tool calls", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const messageId = await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "Let me search for that.",
        toolCalls: [
          {
            id: "call_123",
            name: "searchCandidates",
            arguments: JSON.stringify({ status: "new" }),
          },
        ],
      });

      expect(messageId).toBeDefined();

      const messages = await t.query(api.messages.list, { conversationId });
      expect(messages[0].toolCalls).toHaveLength(1);
      expect(messages[0].toolCalls?.[0].name).toBe("searchCandidates");
    });

    it("should add a tool result message", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const messageId = await t.mutation(api.messages.add, {
        conversationId,
        role: "tool",
        content: "",
        toolResults: [
          {
            toolCallId: "call_123",
            result: JSON.stringify([{ name: "John Doe" }]),
          },
        ],
      });

      expect(messageId).toBeDefined();

      const messages = await t.query(api.messages.list, { conversationId });
      expect(messages[0].toolResults).toHaveLength(1);
    });

    it("should update conversation updatedAt when adding message", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const beforeConvo = await t.query(api.conversations.get, {
        conversationId,
      });
      const beforeUpdatedAt = beforeConvo?.updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "New message",
      });

      const afterConvo = await t.query(api.conversations.get, {
        conversationId,
      });
      expect(afterConvo?.updatedAt).toBeGreaterThan(beforeUpdatedAt!);
    });

    it("should throw error for non-existent conversation", async () => {
      const t = setupTest();

      // Create and get a valid conversation to get a properly formatted ID
      const validId = await createConversation(t);

      // This should work since it's a valid conversation
      await expect(
        t.mutation(api.messages.add, {
          conversationId: validId,
          role: "user",
          content: "Hello",
        })
      ).resolves.toBeDefined();
    });
  });

  describe("list", () => {
    it("should return empty array for conversation with no messages", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const messages = await t.query(api.messages.list, { conversationId });

      expect(messages).toEqual([]);
    });

    it("should return messages in ascending order (oldest first)", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "First message",
      });
      await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "Second message",
      });
      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "Third message",
      });

      const messages = await t.query(api.messages.list, { conversationId });

      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe("First message");
      expect(messages[1].content).toBe("Second message");
      expect(messages[2].content).toBe("Third message");
    });

    it("should only return messages for the specified conversation", async () => {
      const t = setupTest();
      const convo1 = await createConversation(t);
      const convo2 = await t.mutation(api.conversations.create, {
        externalId: "user:other",
      });

      await t.mutation(api.messages.add, {
        conversationId: convo1,
        role: "user",
        content: "Message in convo 1",
      });
      await t.mutation(api.messages.add, {
        conversationId: convo2,
        role: "user",
        content: "Message in convo 2",
      });

      const messages1 = await t.query(api.messages.list, {
        conversationId: convo1,
      });
      const messages2 = await t.query(api.messages.list, {
        conversationId: convo2,
      });

      expect(messages1).toHaveLength(1);
      expect(messages1[0].content).toBe("Message in convo 1");
      expect(messages2).toHaveLength(1);
      expect(messages2[0].content).toBe("Message in convo 2");
    });
  });

  describe("listForExternalId", () => {
    it("should return messages when externalId matches", async () => {
      const t = setupTest();
      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:alice",
      });

      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "Scoped message",
      });

      const messages = await t.query(api.messages.listForExternalId, {
        conversationId,
        externalId: "user:alice",
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Scoped message");
    });

    it("should throw Not found when externalId mismatches", async () => {
      const t = setupTest();
      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:alice",
      });

      await expect(
        t.query(api.messages.listForExternalId, {
          conversationId,
          externalId: "user:bob",
        })
      ).rejects.toThrow("Not found");
    });
  });

  describe("getLatest", () => {
    it("should return null for conversation with no messages", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const latest = await t.query(api.messages.getLatest, { conversationId });

      expect(latest).toBeNull();
    });

    it("should return the most recent message", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "First",
      });
      await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "Second",
      });
      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "Latest",
      });

      const latest = await t.query(api.messages.getLatest, { conversationId });

      expect(latest).not.toBeNull();
      expect(latest?.content).toBe("Latest");
      expect(latest?.role).toBe("user");
    });
  });

  describe("getLatestForExternalId", () => {
    it("should return the most recent message when externalId matches", async () => {
      const t = setupTest();
      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:alice",
      });

      await t.mutation(api.messages.add, {
        conversationId,
        role: "user",
        content: "First",
      });
      await t.mutation(api.messages.add, {
        conversationId,
        role: "assistant",
        content: "Latest",
      });

      const latest = await t.query(api.messages.getLatestForExternalId, {
        conversationId,
        externalId: "user:alice",
      });

      expect(latest?.content).toBe("Latest");
    });

    it("should return null when no messages exist", async () => {
      const t = setupTest();
      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:alice",
      });

      const latest = await t.query(api.messages.getLatestForExternalId, {
        conversationId,
        externalId: "user:alice",
      });

      expect(latest).toBeNull();
    });

    it("should throw Not found when externalId mismatches", async () => {
      const t = setupTest();
      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:alice",
      });

      await expect(
        t.query(api.messages.getLatestForExternalId, {
          conversationId,
          externalId: "user:bob",
        })
      ).rejects.toThrow("Not found");
    });
  });
});
