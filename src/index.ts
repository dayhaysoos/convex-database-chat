/**
 * DatabaseChat React hooks and components.
 *
 * Import from here for all React-related functionality:
 *
 * ```tsx
 * import {
 *   DatabaseChatProvider,
 *   useDatabaseChat,
 *   useConversations,
 * } from "@/lib/databaseChat";
 * ```
 */

export {
  // Provider
  DatabaseChatProvider,
  // Hooks
  useDatabaseChat,
  useConversations,
  useStreamingContent,
  useMessagesWithStreaming,
  // Types
  type DatabaseChatApi,
  type DatabaseChatProviderProps,
  type Message,
  type StreamingState,
  type UseDatabaseChatOptions,
  type UseDatabaseChatReturn,
  type UseConversationsOptions,
  type UseConversationsReturn,
} from "./react";
