/**
 * React hooks for DatabaseChat component.
 *
 * NOTE: This file is for FRONTEND use only. Import from your React app.
 *
 * @example
 * ```tsx
 * import { useDatabaseChat, DatabaseChatProvider } from "./convex/components/databaseChat/react";
 *
 * function ChatApp() {
 *   return (
 *     <DatabaseChatProvider api={api.chat}>
 *       <ChatInterface />
 *     </DatabaseChatProvider>
 *   );
 * }
 *
 * function ChatInterface() {
 *   const { messages, streamingContent, send, isLoading, error } = useDatabaseChat();
 *   // ...
 * }
 * ```
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";

// =============================================================================
// Types
// =============================================================================

export interface DatabaseChatApi {
  // Queries
  getMessages: FunctionReference<"query">;
  getStreaming: FunctionReference<"query">;
  listConversations: FunctionReference<"query">;
  // Mutations
  createConversation: FunctionReference<"mutation">;
  // Actions
  sendMessage: FunctionReference<"action">;
}

export interface Message {
  _id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolResults?: Array<{ toolCallId: string; result: string }>;
  createdAt: number;
}

export interface StreamingState {
  content: string;
  updatedAt: number;
}

export interface UseDatabaseChatOptions {
  /** Conversation ID to chat in */
  conversationId: string | null;
  /** Callback when a message is sent successfully */
  onMessageSent?: (content: string) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
}

export interface UseDatabaseChatReturn {
  /** Messages in the conversation */
  messages: Message[] | undefined;
  /** Current streaming content (while assistant is responding) */
  streamingContent: string | null;
  /** Whether the assistant is currently responding */
  isStreaming: boolean;
  /** Whether a message is being sent */
  isLoading: boolean;
  /** Current error, if any */
  error: Error | null;
  /** Send a message */
  send: (message: string) => Promise<void>;
  /** Clear the current error */
  clearError: () => void;
  /** Retry the last failed message */
  retry: () => Promise<void>;
}

export interface UseConversationsOptions {
  /** External ID to filter conversations (e.g., user ID) */
  externalId: string;
}

export interface UseConversationsReturn {
  /** List of conversations */
  conversations:
    | Array<{
        _id: string;
        title?: string;
        createdAt: number;
        updatedAt: number;
      }>
    | undefined;
  /** Create a new conversation */
  create: (title?: string) => Promise<string>;
  /** Whether a conversation is being created */
  isCreating: boolean;
  /** Current error, if any */
  error: Error | null;
}

// =============================================================================
// Context
// =============================================================================

interface DatabaseChatContextValue {
  api: DatabaseChatApi;
}

const DatabaseChatContext = createContext<DatabaseChatContextValue | null>(
  null
);

export interface DatabaseChatProviderProps {
  /** The API object with chat functions */
  api: DatabaseChatApi;
  children: ReactNode;
}

/**
 * Provider for DatabaseChat hooks.
 * Wrap your app or chat section with this provider.
 */
export function DatabaseChatProvider({
  api,
  children,
}: DatabaseChatProviderProps) {
  return (
    <DatabaseChatContext.Provider value={{ api }}>
      {children}
    </DatabaseChatContext.Provider>
  );
}

function useDatabaseChatContext() {
  const context = useContext(DatabaseChatContext);
  if (!context) {
    throw new Error(
      "useDatabaseChat must be used within a DatabaseChatProvider"
    );
  }
  return context;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Main hook for chat functionality.
 *
 * @example
 * ```tsx
 * function Chat({ conversationId }) {
 *   const {
 *     messages,
 *     streamingContent,
 *     isLoading,
 *     error,
 *     send,
 *   } = useDatabaseChat({ conversationId });
 *
 *   return (
 *     <div>
 *       {messages?.map(msg => <Message key={msg._id} {...msg} />)}
 *       {streamingContent && <StreamingMessage content={streamingContent} />}
 *       <ChatInput onSend={send} disabled={isLoading} />
 *       {error && <ErrorBanner error={error} />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useDatabaseChat(
  options: UseDatabaseChatOptions
): UseDatabaseChatReturn {
  const { conversationId, onMessageSent, onError } = options;
  const { api } = useDatabaseChatContext();

  // Local state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  // Refs for race condition handling
  const isMountedRef = useRef(true);
  const currentRequestRef = useRef<number>(0);

  // Track mounted state for cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Server state via Convex reactive queries
  const messages = useQuery(
    api.getMessages,
    conversationId ? { conversationId } : "skip"
  ) as Message[] | undefined;

  const streamingState = useQuery(
    api.getStreaming,
    conversationId ? { conversationId } : "skip"
  ) as StreamingState | null | undefined;

  // Derive streaming content
  const streamingContent = streamingState?.content ?? null;
  const isStreaming = streamingContent !== null && streamingContent.length > 0;

  // Get the action
  const sendMessageAction = useAction(api.sendMessage);

  // Send message with race condition protection
  const send = useCallback(
    async (message: string) => {
      if (!conversationId) {
        const err = new Error("No conversation selected");
        setError(err);
        onError?.(err);
        return;
      }

      if (!message.trim()) {
        return;
      }

      // Increment request counter for race condition handling
      const requestId = ++currentRequestRef.current;

      setIsLoading(true);
      setError(null);
      setLastMessage(message);

      try {
        const result = await sendMessageAction({
          conversationId,
          message: message.trim(),
        });

        // Check if this is still the current request and component is mounted
        if (requestId !== currentRequestRef.current || !isMountedRef.current) {
          return;
        }

        if (!result.success) {
          const err = new Error(result.error ?? "Failed to send message");
          setError(err);
          onError?.(err);
        } else {
          setLastMessage(null);
          onMessageSent?.(result.content ?? "");
        }
      } catch (err) {
        // Check if this is still the current request and component is mounted
        if (requestId !== currentRequestRef.current || !isMountedRef.current) {
          return;
        }

        const error =
          err instanceof Error ? err : new Error("Failed to send message");
        setError(error);
        onError?.(error);
      } finally {
        // Only update loading state if this is the current request
        if (requestId === currentRequestRef.current && isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [conversationId, sendMessageAction, onMessageSent, onError]
  );

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Retry last failed message
  const retry = useCallback(async () => {
    if (lastMessage) {
      await send(lastMessage);
    }
  }, [lastMessage, send]);

  return {
    messages,
    streamingContent,
    isStreaming,
    isLoading,
    error,
    send,
    clearError,
    retry,
  };
}

/**
 * Hook for managing conversations.
 *
 * @example
 * ```tsx
 * function ConversationList({ userId }) {
 *   const { conversations, create, isCreating } = useConversations({
 *     externalId: `user:${userId}`,
 *   });
 *
 *   return (
 *     <div>
 *       <button onClick={() => create("New Chat")} disabled={isCreating}>
 *         New Conversation
 *       </button>
 *       {conversations?.map(conv => (
 *         <ConversationItem key={conv._id} {...conv} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useConversations(
  options: UseConversationsOptions
): UseConversationsReturn {
  const { externalId } = options;
  const { api } = useDatabaseChatContext();

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Ref for mounted state
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Server state
  const conversations = useQuery(api.listConversations, { externalId }) as
    | Array<{
        _id: string;
        title?: string;
        createdAt: number;
        updatedAt: number;
      }>
    | undefined;

  // Create conversation mutation
  const createConversationMutation = useMutation(api.createConversation);

  const create = useCallback(
    async (title?: string): Promise<string> => {
      setIsCreating(true);
      setError(null);

      try {
        const conversationId = await createConversationMutation({
          externalId,
          title,
        });

        if (!isMountedRef.current) {
          return conversationId as string;
        }

        return conversationId as string;
      } catch (err) {
        if (!isMountedRef.current) {
          throw err;
        }

        const error =
          err instanceof Error
            ? err
            : new Error("Failed to create conversation");
        setError(error);
        throw error;
      } finally {
        if (isMountedRef.current) {
          setIsCreating(false);
        }
      }
    },
    [externalId, createConversationMutation]
  );

  return {
    conversations,
    create,
    isCreating,
    error,
  };
}

/**
 * Hook for just streaming content (useful for optimized re-renders).
 *
 * Use this if you want to isolate streaming updates to a specific component
 * to avoid re-rendering the entire message list.
 *
 * @example
 * ```tsx
 * function StreamingIndicator({ conversationId }) {
 *   const { content, isStreaming } = useStreamingContent({ conversationId });
 *
 *   if (!isStreaming) return null;
 *
 *   return <div className="streaming">{content}</div>;
 * }
 * ```
 */
export function useStreamingContent(options: {
  conversationId: string | null;
}): {
  content: string | null;
  isStreaming: boolean;
} {
  const { conversationId } = options;
  const { api } = useDatabaseChatContext();

  const streamingState = useQuery(
    api.getStreaming,
    conversationId ? { conversationId } : "skip"
  ) as StreamingState | null | undefined;

  const content = streamingState?.content ?? null;
  const isStreaming = content !== null && content.length > 0;

  return { content, isStreaming };
}

// =============================================================================
// Utility Components
// =============================================================================

/**
 * Combine streaming content with completed messages for display.
 * Useful for rendering the full conversation including in-progress responses.
 */
export function useMessagesWithStreaming(options: {
  conversationId: string | null;
}): {
  allMessages: Array<
    Message | { _id: "streaming"; role: "assistant"; content: string }
  >;
  isStreaming: boolean;
} {
  const { conversationId } = options;
  const { api } = useDatabaseChatContext();

  const messages = useQuery(
    api.getMessages,
    conversationId ? { conversationId } : "skip"
  ) as Message[] | undefined;

  const streamingState = useQuery(
    api.getStreaming,
    conversationId ? { conversationId } : "skip"
  ) as StreamingState | null | undefined;

  const streamingContent = streamingState?.content ?? null;
  const isStreaming = streamingContent !== null && streamingContent.length > 0;

  // Combine messages with streaming content
  const allMessages = [
    ...(messages ?? []),
    ...(isStreaming
      ? [
          {
            _id: "streaming" as const,
            role: "assistant" as const,
            content: streamingContent!,
          },
        ]
      : []),
  ];

  return { allMessages, isStreaming };
}
