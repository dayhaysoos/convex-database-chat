/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as chat from "../chat.js";
import type * as chatTools from "../chatTools.js";
import type * as products from "../products.js";
import type * as rateLimit from "../rateLimit.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  chat: typeof chat;
  chatTools: typeof chatTools;
  products: typeof products;
  rateLimit: typeof rateLimit;
  seed: typeof seed;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  databaseChat: {
    chat: {
      send: FunctionReference<
        "action",
        "internal",
        {
          config: {
            apiKey: string;
            maxMessagesForLLM?: number;
            model?: string;
            systemPrompt?: string;
            tools?: Array<{
              description: string;
              handler: string;
              handlerType?: "query" | "mutation" | "action";
              name: string;
              parameters: {
                properties: any;
                required?: Array<string>;
                type: "object";
              };
            }>;
          };
          conversationId: string;
          message: string;
        },
        {
          content?: string;
          error?: string;
          success: boolean;
          toolCalls?: Array<{ args: any; name: string; result: any }>;
        }
      >;
      sendForExternalId: FunctionReference<
        "action",
        "internal",
        {
          config: {
            apiKey: string;
            maxMessagesForLLM?: number;
            model?: string;
            systemPrompt?: string;
            tools?: Array<{
              description: string;
              handler: string;
              handlerType?: "query" | "mutation" | "action";
              name: string;
              parameters: {
                properties: any;
                required?: Array<string>;
                type: "object";
              };
            }>;
          };
          conversationId: string;
          externalId: string;
          message: string;
        },
        {
          content?: string;
          error?: string;
          success: boolean;
          toolCalls?: Array<{ args: any; name: string; result: any }>;
        }
      >;
    };
    conversations: {
      create: FunctionReference<
        "mutation",
        "internal",
        { externalId: string; title?: string },
        string
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
        } | null
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
        }
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
        }>
      >;
    };
    messages: {
      add: FunctionReference<
        "mutation",
        "internal",
        {
          content: string;
          conversationId: string;
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        },
        string
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
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        } | null
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
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        } | null
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
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        }>
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
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        }>
      >;
    };
    stream: {
      abort: FunctionReference<
        "mutation",
        "internal",
        { reason: string; streamId: string },
        null
      >;
      abortByConversation: FunctionReference<
        "mutation",
        "internal",
        { conversationId: string; reason: string },
        boolean
      >;
      abortForExternalId: FunctionReference<
        "mutation",
        "internal",
        { conversationId: string; externalId: string; reason: string },
        boolean
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
        boolean
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        { conversationId: string },
        string
      >;
      finish: FunctionReference<
        "mutation",
        "internal",
        { streamId: string },
        null
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
        } | null
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
        } | null
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
        }>
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
        }>
      >;
    };
  };
};
