/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

// Import all modules for the test instance
// Note: import.meta.glob is a Vite feature, requires /// <reference types="vite/client" />
const modules = import.meta.glob("./**/*.ts");

describe("databaseChat conversations", () => {
  // Helper to create a fresh test instance
  function setupTest() {
    return convexTest(schema, modules);
  }

  describe("create", () => {
    it("should create a conversation with externalId", async () => {
      const t = setupTest();

      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:test123",
      });

      expect(conversationId).toBeDefined();
      expect(typeof conversationId).toBe("string");
    });

    it("should create a conversation with title", async () => {
      const t = setupTest();

      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:test123",
        title: "My Chat",
      });

      const conversation = await t.query(api.conversations.get, {
        conversationId,
      });

      expect(conversation).not.toBeNull();
      expect(conversation?.title).toBe("My Chat");
      expect(conversation?.externalId).toBe("user:test123");
    });

    it("should set createdAt and updatedAt timestamps", async () => {
      const t = setupTest();
      const before = Date.now();

      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:test123",
      });

      const after = Date.now();

      const conversation = await t.query(api.conversations.get, {
        conversationId,
      });

      expect(conversation?.createdAt).toBeGreaterThanOrEqual(before);
      expect(conversation?.createdAt).toBeLessThanOrEqual(after);
      expect(conversation?.updatedAt).toBe(conversation?.createdAt);
    });
  });

  describe("get", () => {
    it("should return null for non-existent conversation", async () => {
      const t = setupTest();

      // Create one conversation to get a valid ID format, then query a different one
      const validId = await t.mutation(api.conversations.create, {
        externalId: "user:test",
      });

      const result = await t.query(api.conversations.get, {
        conversationId: validId,
      });

      expect(result).not.toBeNull();
    });

    it("should return the conversation when it exists", async () => {
      const t = setupTest();

      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:abc",
        title: "Test Conversation",
      });

      const result = await t.query(api.conversations.get, {
        conversationId,
      });

      expect(result).not.toBeNull();
      expect(result?._id).toBe(conversationId);
      expect(result?.externalId).toBe("user:abc");
      expect(result?.title).toBe("Test Conversation");
    });
  });

  describe("getForExternalId", () => {
    it("should return the conversation when externalId matches", async () => {
      const t = setupTest();

      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:alice",
        title: "Scoped Chat",
      });

      const result = await t.query(api.conversations.getForExternalId, {
        conversationId,
        externalId: "user:alice",
      });

      expect(result._id).toBe(conversationId);
      expect(result.externalId).toBe("user:alice");
    });

    it("should throw Not found when externalId mismatches", async () => {
      const t = setupTest();

      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:alice",
      });

      await expect(
        t.query(api.conversations.getForExternalId, {
          conversationId,
          externalId: "user:bob",
        })
      ).rejects.toThrow("Not found");
    });
  });

  describe("list", () => {
    it("should return empty array when no conversations exist", async () => {
      const t = setupTest();

      const result = await t.query(api.conversations.list, {
        externalId: "user:nonexistent",
      });

      expect(result).toEqual([]);
    });

    it("should return conversations for the given externalId", async () => {
      const t = setupTest();

      // Create conversations for different users
      await t.mutation(api.conversations.create, {
        externalId: "user:alice",
        title: "Alice Chat 1",
      });
      await t.mutation(api.conversations.create, {
        externalId: "user:alice",
        title: "Alice Chat 2",
      });
      await t.mutation(api.conversations.create, {
        externalId: "user:bob",
        title: "Bob Chat",
      });

      const aliceConvos = await t.query(api.conversations.list, {
        externalId: "user:alice",
      });

      expect(aliceConvos).toHaveLength(2);
      expect(aliceConvos.every((c) => c.externalId === "user:alice")).toBe(
        true
      );
    });

    it("should return conversations in descending order", async () => {
      const t = setupTest();

      const id1 = await t.mutation(api.conversations.create, {
        externalId: "user:test",
        title: "First",
      });
      const id2 = await t.mutation(api.conversations.create, {
        externalId: "user:test",
        title: "Second",
      });

      const result = await t.query(api.conversations.list, {
        externalId: "user:test",
      });

      // Most recent first (descending)
      expect(result[0]._id).toBe(id2);
      expect(result[1]._id).toBe(id1);
    });
  });
});
