/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as chat from "../chat.js";
import type * as client from "../client.js";
import type * as contextTypes from "../contextTypes.js";
import type * as conversations from "../conversations.js";
import type * as deltaStreamer from "../deltaStreamer.js";
import type * as messages from "../messages.js";
import type * as resultContract from "../resultContract.js";
import type * as schemaTools from "../schemaTools.js";
import type * as stream from "../stream.js";
import type * as toolExecution from "../toolExecution.js";
import type * as toolGuidance from "../toolGuidance.js";
import type * as tools from "../tools.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  access: typeof access;
  chat: typeof chat;
  client: typeof client;
  contextTypes: typeof contextTypes;
  conversations: typeof conversations;
  deltaStreamer: typeof deltaStreamer;
  messages: typeof messages;
  resultContract: typeof resultContract;
  schemaTools: typeof schemaTools;
  stream: typeof stream;
  toolExecution: typeof toolExecution;
  toolGuidance: typeof toolGuidance;
  tools: typeof tools;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
