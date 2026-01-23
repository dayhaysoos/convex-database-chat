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
 * } from "@dayhaysoos/convex-database-chat";
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
  useSmoothText,
  // Components
  SmoothText,
  // Types
  type DatabaseChatApi,
  type DatabaseChatProviderProps,
  type Message,
  type StreamState,
  type StreamDelta,
  type StreamPart,
  type UseDatabaseChatOptions,
  type UseDatabaseChatReturn,
  type UseConversationsOptions,
  type UseConversationsReturn,
  type UseSmoothTextOptions,
  type SmoothTextProps,
} from "./react";
