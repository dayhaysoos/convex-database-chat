/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    chat: {
      send: FunctionReference<
        "action",
        "internal",
        {
          config: {
            apiKey: string;
            chat?: {
              maxMessagesForLLM?: number;
              maxToolLoops?: number;
              maxToolResultChars?: number;
              streamThrottleMs?: number;
              systemPrompt?: string;
              toolContext?: any;
              toolGuidance?: string;
              tools?: Array<{
                description: string;
                handler: string;
                handlerType?: "query" | "mutation" | "action";
                metadata?: {
                  kind:
                    | "count"
                    | "paginated_list"
                    | "semantic_search"
                    | "detail"
                    | "unknown";
                  resultContract?: "standard";
                };
                name: string;
                parameters: {
                  additionalProperties?: boolean;
                  properties: any;
                  required?: Array<string>;
                  type: "object";
                };
              }>;
              validateResultContract?: "off" | "warn" | "enforce";
            };
            provider?: {
              baseDelayMs?: number;
              httpReferer?: string;
              maxDelayMs?: number;
              maxRetries?: number;
              model?: string;
              requestTimeoutMs?: number;
              xTitle?: string;
            };
          };
          conversationId: string;
          message: string;
        },
        {
          content?: string;
          error?: string;
          errorCode?:
            | "unauthorized"
            | "rate_limited"
            | "provider_error"
            | "network_error"
            | "timeout"
            | "aborted"
            | "invalid_request"
            | "unknown";
          retryable?: boolean;
          stoppedReason?: "max_tool_loops";
          success: boolean;
          toolCalls?: Array<{ args: any; name: string; result: any }>;
        },
        Name
      >;
      sendForExternalId: FunctionReference<
        "action",
        "internal",
        {
          config: {
            apiKey: string;
            chat?: {
              maxMessagesForLLM?: number;
              maxToolLoops?: number;
              maxToolResultChars?: number;
              streamThrottleMs?: number;
              systemPrompt?: string;
              toolContext?: any;
              toolGuidance?: string;
              tools?: Array<{
                description: string;
                handler: string;
                handlerType?: "query" | "mutation" | "action";
                metadata?: {
                  kind:
                    | "count"
                    | "paginated_list"
                    | "semantic_search"
                    | "detail"
                    | "unknown";
                  resultContract?: "standard";
                };
                name: string;
                parameters: {
                  additionalProperties?: boolean;
                  properties: any;
                  required?: Array<string>;
                  type: "object";
                };
              }>;
              validateResultContract?: "off" | "warn" | "enforce";
            };
            provider?: {
              baseDelayMs?: number;
              httpReferer?: string;
              maxDelayMs?: number;
              maxRetries?: number;
              model?: string;
              requestTimeoutMs?: number;
              xTitle?: string;
            };
          };
          conversationId: string;
          externalId: string;
          message: string;
        },
        {
          content?: string;
          error?: string;
          errorCode?:
            | "unauthorized"
            | "rate_limited"
            | "provider_error"
            | "network_error"
            | "timeout"
            | "aborted"
            | "invalid_request"
            | "unknown";
          retryable?: boolean;
          stoppedReason?: "max_tool_loops";
          success: boolean;
          toolCalls?: Array<{ args: any; name: string; result: any }>;
        },
        Name
      >;
    };
    conversations: {
      create: FunctionReference<
        "mutation",
        "internal",
        { externalId: string; title?: string },
        string,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { conversationId: string },
        {
          _creationTime: number;
          _id: string;
          createdAt: number;
          externalId: string;
          title?: string;
          updatedAt: number;
        } | null,
        Name
      >;
      getForExternalId: FunctionReference<
        "query",
        "internal",
        { conversationId: string; externalId: string },
        {
          _creationTime: number;
          _id: string;
          createdAt: number;
          externalId: string;
          title?: string;
          updatedAt: number;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { externalId: string },
        Array<{
          _creationTime: number;
          _id: string;
          createdAt: number;
          externalId: string;
          title?: string;
          updatedAt: number;
        }>,
        Name
      >;
    };
    messages: {
      add: FunctionReference<
        "mutation",
        "internal",
        {
          content: string;
          conversationId: string;
          partial?: boolean;
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        },
        string,
        Name
      >;
      addForExternalId: FunctionReference<
        "mutation",
        "internal",
        {
          content: string;
          conversationId: string;
          externalId: string;
          partial?: boolean;
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        },
        string,
        Name
      >;
      getLatest: FunctionReference<
        "query",
        "internal",
        { conversationId: string },
        {
          _creationTime: number;
          _id: string;
          content: string;
          conversationId: string;
          createdAt: number;
          partial?: boolean;
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        } | null,
        Name
      >;
      getLatestForExternalId: FunctionReference<
        "query",
        "internal",
        { conversationId: string; externalId: string },
        {
          _creationTime: number;
          _id: string;
          content: string;
          conversationId: string;
          createdAt: number;
          partial?: boolean;
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { conversationId: string; limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          content: string;
          conversationId: string;
          createdAt: number;
          partial?: boolean;
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        }>,
        Name
      >;
      listForExternalId: FunctionReference<
        "query",
        "internal",
        { conversationId: string; externalId: string; limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          content: string;
          conversationId: string;
          createdAt: number;
          partial?: boolean;
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        }>,
        Name
      >;
    };
    stream: {
      abort: FunctionReference<
        "mutation",
        "internal",
        { reason: string; streamId: string },
        null,
        Name
      >;
      abortByConversation: FunctionReference<
        "mutation",
        "internal",
        { conversationId: string; reason: string },
        boolean,
        Name
      >;
      abortForExternalId: FunctionReference<
        "mutation",
        "internal",
        { conversationId: string; externalId: string; reason: string },
        boolean,
        Name
      >;
      addDelta: FunctionReference<
        "mutation",
        "internal",
        {
          end: number;
          parts: Array<{
            args?: string;
            error?: string;
            result?: string;
            text?: string;
            toolCallId?: string;
            toolName?: string;
            type: "text-delta" | "tool-call" | "tool-result" | "error";
          }>;
          start: number;
          streamId: string;
        },
        boolean,
        Name
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        { conversationId: string },
        string,
        Name
      >;
      finish: FunctionReference<
        "mutation",
        "internal",
        { streamId: string },
        null,
        Name
      >;
      getStream: FunctionReference<
        "query",
        "internal",
        { conversationId: string },
        {
          abortReason?: string;
          endedAt?: number;
          startedAt: number;
          status: "streaming" | "finished" | "aborted";
          streamId: string;
        } | null,
        Name
      >;
      getStreamForExternalId: FunctionReference<
        "query",
        "internal",
        { conversationId: string; externalId: string },
        {
          abortReason?: string;
          endedAt?: number;
          startedAt: number;
          status: "streaming" | "finished" | "aborted";
          streamId: string;
        } | null,
        Name
      >;
      listDeltas: FunctionReference<
        "query",
        "internal",
        { cursor: number; streamId: string },
        Array<{
          end: number;
          parts: Array<{
            args?: string;
            error?: string;
            result?: string;
            text?: string;
            toolCallId?: string;
            toolName?: string;
            type: "text-delta" | "tool-call" | "tool-result" | "error";
          }>;
          start: number;
        }>,
        Name
      >;
      listDeltasForExternalId: FunctionReference<
        "query",
        "internal",
        { cursor: number; externalId: string; streamId: string },
        Array<{
          end: number;
          parts: Array<{
            args?: string;
            error?: string;
            result?: string;
            text?: string;
            toolCallId?: string;
            toolName?: string;
            type: "text-delta" | "tool-call" | "tool-result" | "error";
          }>;
          start: number;
        }>,
        Name
      >;
    };
  };
