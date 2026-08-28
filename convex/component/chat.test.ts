/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { createFunctionHandle, getFunctionName } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";
import { executeToolWithContext } from "./toolExecution";
import { buildMessagesWithTools, capToolResult } from "./chat";
import { DeltaStreamer } from "./deltaStreamer";
import {
  contentChunk,
  sseResponse,
  toolCallChunk,
} from "../../src/testing/sse.js";
import type { DatabaseChatTool } from "./tools";


function stubFetch(mock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", mock);
  return mock;
}

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

  describe("buildMessagesWithTools", () => {
    it("preserves tool calls and results in conversation history", () => {
      const messages = [
        { role: "user" as const, content: "Find React candidates" },
        {
          role: "assistant" as const,
          content: "",
          toolCalls: [
            { id: "call_1", name: "searchRecords", arguments: '{"query":"react"}' },
          ],
        },
        {
          role: "tool" as const,
          content: "",
          toolResults: [
            {
              toolCallId: "call_1",
              result: '[{"id":"1","name":"Alice"}]',
            },
          ],
        },
        {
          role: "assistant" as const,
          content: "I found Alice.",
        },
      ];

      const result = buildMessagesWithTools(messages, "system prompt");

      expect(result).toHaveLength(5);
      expect(result[0]).toEqual({ role: "system", content: "system prompt" });
      expect(result[1]).toEqual({
        role: "user",
        content: "Find React candidates",
      });

      // Assistant message with tool calls must replay its tool_calls
      expect(result[2]).toEqual({
        role: "assistant",
        content: undefined,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "searchRecords",
              arguments: '{"query":"react"}',
            },
          },
        ],
      });

      // Tool results must carry their tool_call_id
      expect(result[3]).toEqual({
        role: "tool",
        content: '[{"id":"1","name":"Alice"}]',
        tool_call_id: "call_1",
      });

      expect(result[4]).toEqual({
        role: "assistant",
        content: "I found Alice.",
      });
    });

    it("replays plain assistant messages without tool_calls", () => {
      const messages = [
        { role: "assistant" as const, content: "Hello!" },
      ];

      const result = buildMessagesWithTools(messages, "sys");

      expect(result).toEqual([
        { role: "system", content: "sys" },
        { role: "assistant", content: "Hello!" },
      ]);
    });

    it("omits empty assistant content when tool calls are present", () => {
      const messages = [
        {
          role: "assistant" as const,
          content: "",
          toolCalls: [
            { id: "c1", name: "t", arguments: "{}" },
          ],
        },
      ];

      const result = buildMessagesWithTools(messages, "sys");

      expect(result[1].content).toBeUndefined();
      expect(result[1].tool_calls).toHaveLength(1);
    });

    it("drops leading tool results orphaned by history truncation", () => {
      const messages = [
        {
          role: "tool" as const,
          content: "",
          toolResults: [{ toolCallId: "c9", result: '{"stale":true}' }],
        },
        { role: "assistant" as const, content: "Answer" },
      ];

      const result = buildMessagesWithTools(messages, "sys");

      expect(result).toEqual([
        { role: "system", content: "sys" },
        { role: "assistant", content: "Answer" },
      ]);
    });

    it("keeps tool results that follow their assistant tool_calls in the window", () => {
      const messages = [
        { role: "user" as const, content: "hi" },
        {
          role: "assistant" as const,
          content: "",
          toolCalls: [{ id: "c1", name: "t", arguments: "{}" }],
        },
        {
          role: "tool" as const,
          content: "",
          toolResults: [{ toolCallId: "c1", result: "{}" }],
        },
      ];

      const result = buildMessagesWithTools(messages, "sys");

      expect(result).toHaveLength(4);
      expect(result[3].tool_call_id).toBe("c1");
    });
  });

  describe("capToolResult", () => {
    it("passes small results through unchanged", () => {
      const result = { items: [1, 2, 3] };
      expect(capToolResult(result, 16000)).toBe(JSON.stringify(result));
    });

    it("truncates oversized results into a valid JSON envelope", () => {
      const big = { items: "x".repeat(50000) };
      const capped = capToolResult(big, 100);

      const parsed = JSON.parse(capped);
      expect(parsed.truncated).toBe(true);
      expect(parsed.originalLength).toBeGreaterThan(100);
      expect(parsed.data.length).toBe(100);
    });
  });

  describe("DeltaStreamer rotation", () => {
    function fakeMutationCtx() {
      let streamCounter = 0;
      const createdStreams: string[] = [];
      const deltas: Array<{ start: number; end: number; parts: unknown[] }> = [];
      const finished: string[] = [];

      const ctx = {
        runMutation: async (handler: unknown, args: any) => {
          const name = getFunctionName(handler as any);
          if (name === "stream:create") {
            const id = `stream_${++streamCounter}` as any;
            createdStreams.push(id);
            return id;
          }
          if (name === "stream:addDelta") {
            deltas.push(args);
            return true;
          }
          if (name === "stream:finish" || name === "stream:abort") {
            finished.push(name);
            return null;
          }
          throw new Error("Unexpected mutation: " + name);
        },
      };

      return { ctx, createdStreams, deltas, finished };
    }

    it("resetForNewRound starts a fresh stream and resets the cursor", async () => {
      const { ctx, createdStreams, deltas } = fakeMutationCtx();
      const conversationId = "conv1" as any;
      const streamer = new DeltaStreamer(ctx as any, api, conversationId, {});

      await streamer.addParts([{ type: "text-delta", text: "round one" }]);
      await streamer.resetForNewRound();
      await streamer.addParts([{ type: "text-delta", text: "round two" }]);

      // Two distinct streams were created (rotation)
      expect(createdStreams).toHaveLength(2);
      expect(createdStreams[0]).not.toBe(createdStreams[1]);

      // Cursor restarted at 0 for the new round
      expect(deltas[0].start).toBe(0);
      expect(deltas[1].start).toBe(0);
    });
  });

  describe("chat.send integration", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function createTool() {
      const handle = await createFunctionHandle(api.messages.getLatest);
      const tool: DatabaseChatTool = {
        name: "getLatest",
        description: "Get the latest message in the conversation",
        parameters: {
          type: "object",
          properties: {
            conversationId: { type: "string", description: "Conversation ID" },
          },
          required: ["conversationId"],
        },
        handler: handle,
      };
      return tool;
    }

    it("should send a message and get a streaming response", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const fetchMock = stubFetch(
        vi.fn(async () =>
          sseResponse([contentChunk("Hello!"), contentChunk(" How can I help?")])
        )
      );

      const result = await t.action(api.chat.send, {
        conversationId,
        message: "Hi",
        config: { apiKey: "test-key", systemPrompt: "Be helpful." },
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe("Hello! How can I help?");
      expect(result.errorCode).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const messages = await t.query(api.messages.list, { conversationId });
      expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(messages[1].content).toBe("Hello! How can I help?");

      const streamState = await t.query(api.stream.getStream, {
        conversationId,
      });
      expect(streamState?.status).toBe("finished");
    });

    it("should handle OpenRouter errors gracefully with typed codes", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      stubFetch(
        vi.fn(async () => new Response("bad key", { status: 401 }))
      );

      const result = await t.action(api.chat.send, {
        conversationId,
        message: "Hi",
        config: { apiKey: "invalid-key", systemPrompt: "Be helpful." },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("401");
      expect(result.errorCode).toBe("unauthorized");
      expect(result.retryable).toBe(false);
    });

    it("should retry transient provider errors and succeed", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const fetchMock = vi.fn(async () => new Response("boom", { status: 503 }));
      fetchMock.mockImplementationOnce(async () =>
        new Response("boom", { status: 503 })
      );
      fetchMock.mockImplementationOnce(async () =>
        sseResponse([contentChunk("recovered")])
      );
      stubFetch(fetchMock);

      const result = await t.action(api.chat.send, {
        conversationId,
        message: "Hi",
        config: {
          apiKey: "test-key",
          systemPrompt: "Be helpful.",
          maxRetries: 2,
          baseDelayMs: 1,
          maxDelayMs: 1,
        },
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe("recovered");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("should execute tool calls and return the final answer", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const tool = await createTool();
      const argsJson = JSON.stringify({ conversationId });

      let call = 0;
      stubFetch(
        vi.fn(async () => {
          call++;
          if (call === 1) {
            return sseResponse([toolCallChunk("call_1", "getLatest", argsJson)]);
          }
          return sseResponse([
            contentChunk("The latest message is from the user."),
          ]);
        })
      );

      const result = await t.action(api.chat.send, {
        conversationId,
        message: "What is the latest message?",
        config: {
          apiKey: "test-key",
          systemPrompt: "Be helpful.",
          tools: [tool],
        },
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe("The latest message is from the user.");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls?.[0].name).toBe("getLatest");

      const messages = await t.query(api.messages.list, { conversationId });
      expect(messages.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
      ]);
      const toolResult = JSON.parse(messages[2].toolResults![0].result);
      expect(toolResult.role).toBe("user");
    });

    it("should enforce the standard result contract when configured", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const tool = {
        ...(await createTool()),
        metadata: { kind: "detail" as const, resultContract: "standard" as const },
      };
      const argsJson = JSON.stringify({ conversationId });

      let call = 0;
      stubFetch(
        vi.fn(async () => {
          call++;
          if (call === 1) {
            return sseResponse([toolCallChunk("call_1", "getLatest", argsJson)]);
          }
          return sseResponse([contentChunk("The tool result was invalid.")]);
        })
      );

      const result = await t.action(api.chat.send, {
        conversationId,
        message: "What is the latest message?",
        config: {
          apiKey: "test-key",
          systemPrompt: "Be helpful.",
          tools: [tool],
          validateResultContract: "enforce",
        },
      });

      expect(result.success).toBe(true);
      expect(result.toolCalls?.[0].result).toHaveProperty("contractErrors");
      const toolResult = JSON.parse(
        (
          await t.query(api.messages.list, { conversationId })
        )[2].toolResults![0].result
      );
      expect(toolResult.error).toContain("standard result contract");
    });

    it("warn keeps the raw tool result and logs the violation", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const tool = {
        ...(await createTool()),
        metadata: { kind: "detail" as const, resultContract: "standard" as const },
      };
      const argsJson = JSON.stringify({ conversationId });

      let call = 0;
      stubFetch(
        vi.fn(async () => {
          call++;
          if (call === 1) {
            return sseResponse([toolCallChunk("call_1", "getLatest", argsJson)]);
          }
          return sseResponse([contentChunk("Noted.")]);
        })
      );

      const result = await t.action(api.chat.send, {
        conversationId,
        message: "What is the latest message?",
        config: {
          apiKey: "test-key",
          systemPrompt: "Be helpful.",
          tools: [tool],
          validateResultContract: "warn",
        },
      });

      expect(result.success).toBe(true);
      const record = result.toolCalls?.[0].result as Record<string, unknown>;
      expect(record).not.toHaveProperty("contractErrors");
      expect(record.role).toBe("user");
    });

    it("should report max_tool_loops and never persist an empty final message", async () => {
      const t = setupTest();
      const conversationId = await createConversation(t);
      const tool = await createTool();
      const argsJson = JSON.stringify({ conversationId });

      stubFetch(
        vi.fn(async () =>
          sseResponse([toolCallChunk("call_1", "getLatest", argsJson)])
        )
      );

      const result = await t.action(api.chat.send, {
        conversationId,
        message: "What is the latest message?",
        config: {
          apiKey: "test-key",
          systemPrompt: "Be helpful.",
          tools: [tool],
          maxToolLoops: 2,
        },
      });

      expect(result.success).toBe(true);
      expect(result.stoppedReason).toBe("max_tool_loops");
      expect(result.content).toContain("Stopped after 2 tool rounds");
    });
  });
});
