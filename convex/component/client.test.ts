/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";
import { DatabaseChatClient, defineDatabaseChat } from "./client";
import { definePaginatedListTool } from "./tools";

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

    it("builds system prompts with automatic tool reliability guidance by default", () => {
      const listTool = definePaginatedListTool({
        name: "listRecords",
        description: "List records.",
        handler: "handler_string",
      });

      const automatic = defineDatabaseChat(api, {
        options: { chat: { systemPrompt: "Base prompt." } },
        tools: [listTool],
      });

      expect(automatic.getSystemPromptWithTools()).toContain(
        "Tool result reliability:"
      );
      expect(automatic.getSystemPromptWithTools()).toContain(
        "meta.pagination.nextCursor"
      );

      const disabled = defineDatabaseChat(api, {
        options: {
          chat: { systemPrompt: "Base prompt.", toolGuidance: "disabled" },
        },
        tools: [listTool],
      });
      expect(disabled.getSystemPromptWithTools()).not.toContain(
        "Tool result reliability:"
      );

      const custom = defineDatabaseChat(api, {
        options: {
          chat: {
            systemPrompt: "Base prompt.",
            toolGuidance: "Always mention exact scope labels.",
          },
        },
        tools: [listTool],
      });
      expect(custom.getSystemPromptWithTools()).toContain(
        "Always mention exact scope labels."
      );
      expect(custom.getSystemPromptWithTools()).not.toContain(
        "Tool result reliability:"
      );
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

  describe("getExternalId resolver", () => {
    function fakeQueryCtx(resolvedExternalId: string) {
      const calls: Array<{ name: string; args: any }> = [];
      const ctx = {
        runQuery: async (handler: unknown, args: any) => {
          calls.push({ name: getFunctionName(handler as any), args });
          return null;
        },
        config: { getExternalId: async () => resolvedExternalId },
      };
      return { ctx: ctx as any, calls };
    }

    it("throws a clear error when no identity is available", async () => {
      const client = defineDatabaseChat(api, {});
      const t = setupTest();
      const conversationId = await t.mutation(api.conversations.create, {
        externalId: "user:test",
      });

      await expect(
        client.getMessages({ db: {} } as any, conversationId as any)
      ).rejects.toThrow(/getExternalId/);
    });

    it("routes getMessages through the scoped endpoint with the resolver", async () => {
      const client = defineDatabaseChat(api, {
        getExternalId: async () => "user:resolved",
      });
      const { ctx, calls } = fakeQueryCtx("user:resolved");

      await client.getMessages(ctx, "conv123" as any);

      expect(calls[0].name).toBe("messages:listForExternalId");
      expect(calls[0].args.externalId).toBe("user:resolved");
    });

    it("routes send through sendForExternalId", async () => {
      const client = defineDatabaseChat(api, {
        getExternalId: async () => "user:resolved",
      });

      const calls: Array<{ name: string; args: any }> = [];
      const ctx = {
        runAction: async (handler: unknown, args: any) => {
          calls.push({ name: getFunctionName(handler as any), args });
          return { success: true };
        },
      } as any;

      await client.send(ctx, {
        conversationId: "conv123" as any,
        message: "hello",
        apiKey: "key",
      });

      expect(calls[0].name).toBe("chat:sendForExternalId");
      expect(calls[0].args.externalId).toBe("user:resolved");
    });

    it("explicit externalId overrides the resolver", async () => {
      const client = defineDatabaseChat(api, {
        getExternalId: async () => "user:from-resolver",
      });
      const { ctx, calls } = fakeQueryCtx("ignored");

      await client.getMessages(ctx, "conv123" as any, {
        externalId: "user:explicit",
      });

      expect(calls[0].args.externalId).toBe("user:explicit");
    });

    it("addMessage requires an identity", async () => {
      const client = defineDatabaseChat(api, {});

      await expect(
        client.addMessage({} as any, "conv123" as any, "user", "hello")
      ).rejects.toThrow(/getExternalId/);
    });

    it("addMessage routes through the scoped endpoint with the resolver", async () => {
      const client = defineDatabaseChat(api, {
        getExternalId: async () => "user:resolved",
      });
      const calls: Array<{ name: string; args: any }> = [];
      const ctx = {
        runMutation: async (handler: unknown, args: any) => {
          calls.push({ name: getFunctionName(handler as any), args });
          return "msg123";
        },
      } as any;

      await client.addMessage(ctx, "conv123", "user", "hello");

      expect(calls[0].name).toBe("messages:addForExternalId");
      expect(calls[0].args.externalId).toBe("user:resolved");
      expect(calls[0].args.content).toBe("hello");
    });

    it("addMessage explicit externalId overrides the resolver", async () => {
      const client = defineDatabaseChat(api, {
        getExternalId: async () => "user:from-resolver",
      });
      const calls: Array<{ name: string; args: any }> = [];
      const ctx = {
        runMutation: async (handler: unknown, args: any) => {
          calls.push({ name: getFunctionName(handler as any), args });
          return "msg123";
        },
      } as any;

      await client.addMessage(ctx, "conv123", "user", "hello", {
        externalId: "user:explicit",
      });

      expect(calls[0].args.externalId).toBe("user:explicit");
    });

    it("getMessagesForLLM requires an identity", async () => {
      const client = defineDatabaseChat(api, {});

      await expect(
        client.getMessagesForLLM({} as any, "conv123" as any)
      ).rejects.toThrow(/getExternalId/);
    });

    it("getMessagesForLLM routes through the scoped endpoint with the resolver", async () => {
      const client = defineDatabaseChat(api, {
        getExternalId: async () => "user:resolved",
      });
      const calls: Array<{ name: string; args: any }> = [];
      const ctx = {
        runQuery: async (handler: unknown, args: any) => {
          calls.push({ name: getFunctionName(handler as any), args });
          return [];
        },
      } as any;

      await client.getMessagesForLLM(ctx, "conv123");

      expect(calls[0].name).toBe("messages:listForExternalId");
      expect(calls[0].args.externalId).toBe("user:resolved");
    });

    it("getMessagesForLLM replays assistant tool calls", async () => {
      const client = defineDatabaseChat(api, {
        getExternalId: async () => "user:resolved",
      });
      const ctx = {
        runQuery: async () => [
          {
            _id: "m1",
            role: "assistant",
            content: "Let me check.",
            toolCalls: [{ id: "c1", name: "t", arguments: "{}" }],
            createdAt: 1,
          },
          {
            _id: "m2",
            role: "tool",
            content: "",
            toolResults: [{ toolCallId: "c1", result: "{}" }],
            createdAt: 2,
          },
        ],
      } as any;

      const result = await client.getMessagesForLLM(ctx, "conv123");

      const assistantWithCalls = result.messages.find(
        (m) => m.role === "assistant",
      );
      expect(assistantWithCalls?.tool_calls).toHaveLength(1);
      const toolMsg = result.messages.find((m) => m.role === "tool");
      expect(toolMsg?.tool_call_id).toBe("c1");
    });

    it("passes config overrides through to chat.send", async () => {
      const client = defineDatabaseChat(api, {
        getExternalId: async () => "user:resolved",
        maxToolResultChars: 100,
      });

      const calls: Array<{ name: string; args: any }> = [];
      const ctx = {
        runAction: async (handler: unknown, args: any) => {
          calls.push({ name: getFunctionName(handler as any), args });
          return { success: true };
        },
      } as any;

      await client.send(ctx, {
        conversationId: "conv123" as any,
        message: "hello",
        apiKey: "key",
        options: {
          chat: { maxToolLoops: 2, streamThrottleMs: 50, maxToolResultChars: 200 },
        },
      });

      const config = calls[0].args.config;
      expect(config.chat.maxToolLoops).toBe(2);
      expect(config.chat.streamThrottleMs).toBe(50);
      expect(config.chat.maxToolResultChars).toBe(200);
    });
  });
});
