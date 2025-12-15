/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
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

  describe("init", () => {
    it("should create streaming state for a conversation", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      await t.mutation(api.stream.init, { conversationId });

      const content = await t.query(api.stream.getContent, { conversationId });
      expect(content).not.toBeNull();
      expect(content?.content).toBe("");
    });

    it("should reset existing streaming state", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      // Initialize and update
      await t.mutation(api.stream.init, { conversationId });
      await t.mutation(api.stream.update, {
        conversationId,
        content: "Some content",
      });

      // Re-initialize should reset
      await t.mutation(api.stream.init, { conversationId });

      const content = await t.query(api.stream.getContent, { conversationId });
      expect(content?.content).toBe("");
    });
  });

  describe("update", () => {
    it("should update streaming content", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      await t.mutation(api.stream.init, { conversationId });
      await t.mutation(api.stream.update, {
        conversationId,
        content: "Hello",
      });

      const content = await t.query(api.stream.getContent, { conversationId });
      expect(content?.content).toBe("Hello");
    });

    it("should accumulate content across updates", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      await t.mutation(api.stream.init, { conversationId });

      // Simulate streaming tokens
      await t.mutation(api.stream.update, {
        conversationId,
        content: "Hello",
      });
      await t.mutation(api.stream.update, {
        conversationId,
        content: "Hello, world",
      });
      await t.mutation(api.stream.update, {
        conversationId,
        content: "Hello, world!",
      });

      const content = await t.query(api.stream.getContent, { conversationId });
      expect(content?.content).toBe("Hello, world!");
    });

    it("should update the updatedAt timestamp", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      await t.mutation(api.stream.init, { conversationId });
      const before = await t.query(api.stream.getContent, { conversationId });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await t.mutation(api.stream.update, {
        conversationId,
        content: "Updated",
      });
      const after = await t.query(api.stream.getContent, { conversationId });

      expect(after?.updatedAt).toBeGreaterThan(before!.updatedAt);
    });
  });

  describe("clear", () => {
    it("should remove streaming state", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      await t.mutation(api.stream.init, { conversationId });
      await t.mutation(api.stream.update, {
        conversationId,
        content: "Some content",
      });

      await t.mutation(api.stream.clear, { conversationId });

      const content = await t.query(api.stream.getContent, { conversationId });
      expect(content).toBeNull();
    });

    it("should be idempotent (no error if already cleared)", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      // Clear without init should not throw
      await expect(
        t.mutation(api.stream.clear, { conversationId })
      ).resolves.toBeNull();
    });
  });

  describe("getContent", () => {
    it("should return null if no streaming state exists", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      const content = await t.query(api.stream.getContent, { conversationId });
      expect(content).toBeNull();
    });

    it("should return content and updatedAt", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);

      await t.mutation(api.stream.init, { conversationId });
      await t.mutation(api.stream.update, {
        conversationId,
        content: "Streaming...",
      });

      const result = await t.query(api.stream.getContent, { conversationId });

      expect(result).not.toBeNull();
      expect(result?.content).toBe("Streaming...");
      expect(typeof result?.updatedAt).toBe("number");
    });
  });
});

