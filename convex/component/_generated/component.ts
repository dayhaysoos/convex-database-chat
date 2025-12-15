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
            model?: string;
            systemPrompt?: string;
            tools?: Array<{
              description: string;
              handler: string;
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
    hello: {
      world: FunctionReference<"query", "internal", {}, string, Name>;
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
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { conversationId: string },
        Array<{
          _creationTime: number;
          _id: string;
          content: string;
          conversationId: string;
          createdAt: number;
          role: "user" | "assistant" | "tool";
          toolCalls?: Array<{ arguments: string; id: string; name: string }>;
          toolResults?: Array<{ result: string; toolCallId: string }>;
        }>,
        Name
      >;
    };
    stream: {
      clear: FunctionReference<
        "mutation",
        "internal",
        { conversationId: string },
        null,
        Name
      >;
      getContent: FunctionReference<
        "query",
        "internal",
        { conversationId: string },
        { content: string; updatedAt: number } | null,
        Name
      >;
      init: FunctionReference<
        "mutation",
        "internal",
        { conversationId: string },
        null,
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        { content: string; conversationId: string },
        null,
        Name
      >;
    };
  };
