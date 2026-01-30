import { useState, useEffect, useRef, FormEvent } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useRateLimit } from "../hooks/useRateLimit";

interface Message {
  _id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolResults?: Array<{ toolCallId: string; result: string }>;
  createdAt: number;
}

interface StreamState {
  streamId: string;
  status: "streaming" | "finished" | "aborted";
  startedAt: number;
  endedAt?: number;
  abortReason?: string;
}

interface StreamDelta {
  start: number;
  end: number;
  parts: Array<{
    type: "text-delta" | "tool-call" | "tool-result" | "error";
    text?: string;
  }>;
}

/**
 * Parse markdown-style links and bold text for rendering
 */
function MarkdownContent({ content }: { content: string }) {
  // Split by markdown links
  const parts = content.split(/(\[[^\]]+\]\([^)]+\))/g);

  return (
    <>
      {parts.map((part, i) => {
        // Check for links [text](url)
        const linkMatch = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          const [, text, url] = linkMatch;
          return (
            <a
              key={i}
              href={url}
              className="chat-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              {text}
            </a>
          );
        }

        // Handle **bold** and regular text
        return part.split(/(\*\*[^*]+\*\*)/g).map((p, j) => {
          const boldMatch = p.match(/\*\*([^*]+)\*\*/);
          if (boldMatch) {
            return <strong key={`${i}-${j}`}>{boldMatch[1]}</strong>;
          }
          return <span key={`${i}-${j}`}>{p}</span>;
        });
      })}
    </>
  );
}

/**
 * Hook for delta-based streaming with client-side accumulation.
 * This provides O(n) bandwidth instead of O(n²).
 */
function useDeltaStreaming(conversationId: string | null) {
  const [cursor, setCursor] = useState(0);
  const [accumulatedContent, setAccumulatedContent] = useState("");
  const lastStreamIdRef = useRef<string | null>(null);
  // Track the last processed end position to prevent duplicate processing
  const lastProcessedEndRef = useRef(0);

  // Subscribe to stream state
  const streamState = useQuery(
    api.chat.getStreamState,
    conversationId ? { conversationId } : "skip"
  ) as StreamState | null | undefined;

  const streamId = streamState?.streamId ?? null;
  const status = streamState?.status ?? null;

  // Reset accumulation when stream changes
  useEffect(() => {
    if (streamId !== lastStreamIdRef.current) {
      lastStreamIdRef.current = streamId;
      lastProcessedEndRef.current = 0;
      setCursor(0);
      setAccumulatedContent("");
    }
  }, [streamId]);

  // Fetch deltas from cursor position
  const deltas = useQuery(
    api.chat.getStreamDeltas,
    streamId && status === "streaming" ? { streamId, cursor } : "skip"
  ) as StreamDelta[] | undefined;

  // Accumulate new deltas with deduplication
  useEffect(() => {
    if (!deltas || deltas.length === 0) {
      return;
    }

    // Filter out already-processed deltas to prevent duplicates
    const newDeltas = deltas.filter(
      (d) => d.start >= lastProcessedEndRef.current
    );

    if (newDeltas.length === 0) {
      return;
    }

    // Find the highest end position and accumulate text from new deltas only
    let maxEnd = lastProcessedEndRef.current;
    let newText = "";

    for (const delta of newDeltas) {
      if (delta.end > maxEnd) {
        maxEnd = delta.end;
      }
      for (const part of delta.parts) {
        if (part.type === "text-delta" && part.text) {
          newText += part.text;
        }
      }
    }

    if (newText) {
      setAccumulatedContent((prev) => prev + newText);
    }

    // Update ref immediately to prevent re-processing
    lastProcessedEndRef.current = maxEnd;

    // Update cursor state for next query
    if (maxEnd > cursor) {
      setCursor(maxEnd);
    }
  }, [deltas, cursor]);

  // Return null content when not streaming or no content
  const content =
    status === "streaming" && accumulatedContent.length > 0
      ? accumulatedContent
      : null;

  const isStreaming = status === "streaming";

  return { content, isStreaming, status };
}

export function Chat() {
  const [isOpen, setIsOpen] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Track if current request was aborted to ignore its completion
  const wasAbortedRef = useRef(false);

  // Rate limiting (disabled on localhost)
  const {
    fingerprint,
    remaining,
    canSendMessage,
    recordMessage,
    getResetTimeDisplay,
    messageLimit,
    isLoading: rateLimitLoading,
    isLocalDev,
  } = useRateLimit();

  // Convex hooks
  const createConversation = useMutation(api.chat.createConversation);
  const sendMessage = useAction(api.chat.sendMessage);
  const abortStreamMutation = useMutation(api.chat.abortStream);

  const messages = useQuery(
    api.chat.getMessages,
    conversationId ? { conversationId } : "skip"
  ) as Message[] | undefined;

  const toolResultIds = new Set(
    (messages ?? []).flatMap((msg) =>
      msg.toolResults ? msg.toolResults.map((result) => result.toolCallId) : []
    )
  );

  const toolCalls = (messages ?? []).flatMap((msg) =>
    msg.toolCalls
      ? msg.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          args: call.arguments,
          createdAt: msg.createdAt,
        }))
      : []
  );

  const displayMessages = (messages ?? []).filter(
    (msg) => msg.role !== "tool" && !msg.toolCalls
  );

  // Use delta-based streaming for efficient O(n) bandwidth
  const { content: streamingContent, isStreaming } =
    useDeltaStreaming(conversationId);

  // Create conversation on mount
  useEffect(() => {
    if (!conversationId) {
      createConversation({ externalId: "demo-user", title: "Demo Chat" }).then(
        setConversationId
      );
    }
  }, [conversationId, createConversation]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading || !conversationId) return;

    // Quick client-side check (server also enforces)
    if (!canSendMessage()) {
      setError(
        `Rate limit reached. Resets in ${getResetTimeDisplay()}. This is a demo with limited usage.`
      );
      return;
    }

    const message = inputValue.trim();
    setInputValue("");
    setIsLoading(true);
    setError(null);
    wasAbortedRef.current = false;

    try {
      // Server enforces rate limit with fingerprint
      const result = await sendMessage({
        conversationId,
        message,
        fingerprint: fingerprint ?? undefined,
      });
      
      // Ignore result if request was aborted
      if (wasAbortedRef.current) {
        return;
      }
      
      if (!result.success) {
        // Don't show "Stream aborted" as an error - it's expected when user stops
        if (!result.error?.includes("aborted")) {
          setError(result.error ?? "Failed to send message");
        }
      } else {
        // Update local rate limit after successful send
        await recordMessage();
      }
    } catch (err) {
      // Ignore errors from aborted requests
      if (wasAbortedRef.current) {
        return;
      }
      const errorMessage = err instanceof Error ? err.message : "Failed to send message";
      // Don't show abort-related errors
      if (!errorMessage.toLowerCase().includes("abort")) {
        setError(errorMessage);
      }
    } finally {
      // Only update loading state if not aborted (abort handler already did it)
      if (!wasAbortedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleAbort = async () => {
    if (!conversationId || isStopping) return;
    
    // Mark as aborted so handleSubmit ignores the result
    wasAbortedRef.current = true;
    
    // Immediate feedback
    setIsStopping(true);
    
    try {
      await abortStreamMutation({ conversationId, reason: "User cancelled" });
    } catch (err) {
      console.warn("Failed to abort stream:", err);
    } finally {
      setIsStopping(false);
      setIsLoading(false);
    }
  };

  const handleNewChat = async () => {
    setConversationId(null);
    setError(null);
  };

  const isRateLimited = !canSendMessage();

  return (
    <div className={`chat-widget ${isOpen ? "open" : "closed"}`}>
      {/* Toggle button when closed */}
      {!isOpen && (
        <button className="chat-toggle-btn" onClick={() => setIsOpen(true)}>
          <span className="chat-toggle-icon">💬</span>
          <span className="chat-toggle-text">Chat with Database</span>
        </button>
      )}

      {/* Chat container when open */}
      {isOpen && (
        <div className="chat-container">
          <div className="chat-header">
            <div className="chat-header-left">
              <h2>💬 Database Chat</h2>
              {!rateLimitLoading && !isLocalDev && (
                <span
                  className={`rate-limit-badge ${isRateLimited ? "exhausted" : ""}`}
                >
                  {remaining}/{messageLimit} messages
                </span>
              )}
              {isLocalDev && (
                <span className="rate-limit-badge dev-mode">
                  Dev Mode
                </span>
              )}
            </div>
            <div className="chat-header-right">
              <button
                onClick={() => setShowTools((prev) => !prev)}
                className={`tools-btn ${showTools ? "active" : ""}`}
                title="Toggle tool activity"
              >
                Tools
                {toolCalls.length > 0 && (
                  <span className="tools-count">{toolCalls.length}</span>
                )}
              </button>
              <button onClick={handleNewChat} className="new-chat-btn">
                New
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="minimize-btn"
                title="Minimize"
              >
                −
              </button>
            </div>
          </div>

          {showTools && (
            <div className="chat-tools-panel">
              <div className="chat-tools-header">
                <span>Tool activity</span>
                <span className="chat-tools-count">{toolCalls.length}</span>
              </div>
              {toolCalls.length === 0 ? (
                <div className="chat-tools-empty">
                  No tool calls yet. Ask a conceptual question to trigger
                  semantic search.
                </div>
              ) : (
                <ul className="chat-tools-list">
                  {[...toolCalls]
                    .slice(-6)
                    .reverse()
                    .map((call) => (
                      <li key={call.id} className="chat-tools-item">
                        <span className="chat-tools-name">{call.name}</span>
                        <span
                          className={`chat-tools-status ${
                            toolResultIds.has(call.id) ? "ok" : "pending"
                          }`}
                        >
                          {toolResultIds.has(call.id) ? "✓" : "…"}
                        </span>
                        <code className="chat-tools-args">
                          {call.args.length > 140
                            ? `${call.args.slice(0, 140)}...`
                            : call.args}
                        </code>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          <div className="chat-messages">
            {displayMessages.length === 0 ? (
              <div className="chat-welcome">
                <h3>Welcome! 👋</h3>
                <p>Ask me about the products in the database:</p>
                <ul>
                  <li>"Show me electronics under $50"</li>
                  <li>"What products are low on stock?"</li>
                  <li>"Give me an inventory overview"</li>
                  <li>"Find running shoes"</li>
                </ul>
                {isRateLimited && (
                  <div className="rate-limit-warning">
                    ⚠️ Rate limit reached. Resets in {getResetTimeDisplay()}.
                  </div>
                )}
              </div>
            ) : (
              displayMessages.map((msg) => (
                <div key={msg._id} className={`chat-message ${msg.role}`}>
                  <div className="message-role">
                    {msg.role === "user" ? "You" : "Assistant"}
                  </div>
                  <div className="message-content">
                    <MarkdownContent content={msg.content} />
                  </div>
                </div>
              ))
            )}

            {/* Streaming content */}
            {streamingContent && (
              <div className="chat-message assistant streaming">
                <div className="message-role">Assistant</div>
                <div className="message-content">
                  <MarkdownContent content={streamingContent} />
                  <span className="typing-indicator">▌</span>
                </div>
              </div>
            )}

            {/* Loading/stopping indicator when no streaming content yet */}
            {(isLoading || isStopping) && !streamingContent && (
              <div className="chat-message assistant">
                <div className="message-role">Assistant</div>
                <div className="message-content">
                  <span className="thinking">
                    {isStopping ? "Stopping..." : "Thinking..."}
                  </span>
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="chat-error">
                <strong>Error:</strong> {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="chat-input-form">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={
                isRateLimited
                  ? `Rate limit reached. Resets in ${getResetTimeDisplay()}`
                  : "Ask about products..."
              }
              disabled={isLoading || isStreaming || !conversationId || isRateLimited}
              className="chat-input"
            />
            {isLoading || isStreaming || isStopping ? (
              <button
                type="button"
                onClick={handleAbort}
                disabled={isStopping}
                className={`chat-submit chat-stop ${isStopping ? "stopping" : ""}`}
                title={isStopping ? "Stopping..." : "Stop generation"}
              >
                {isStopping ? "Stopping..." : "Stop"}
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  !inputValue.trim() ||
                  !conversationId ||
                  isRateLimited
                }
                className="chat-submit"
              >
                Send
              </button>
            )}
          </form>

          {isRateLimited && !isLocalDev && (
            <div className="rate-limit-footer">
              This demo has a {messageLimit}-message limit per 24 hours.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
