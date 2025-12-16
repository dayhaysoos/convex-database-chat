import { useState, useEffect, useRef, FormEvent } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useRateLimit } from "../hooks/useRateLimit";

interface Message {
  _id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: number;
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

export function Chat() {
  const [isOpen, setIsOpen] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Rate limiting
  const {
    fingerprint,
    remaining,
    canSendMessage,
    recordMessage,
    getResetTimeDisplay,
    messageLimit,
    isLoading: rateLimitLoading,
  } = useRateLimit();

  // Convex hooks
  const createConversation = useMutation(api.chat.createConversation);
  const sendMessage = useAction(api.chat.sendMessage);

  const messages = useQuery(
    api.chat.getMessages,
    conversationId ? { conversationId } : "skip",
  ) as Message[] | undefined;

  const streamingContent = useQuery(
    api.chat.getStreaming,
    conversationId ? { conversationId } : "skip",
  );

  // Create conversation on mount
  useEffect(() => {
    if (!conversationId) {
      createConversation({ externalId: "demo-user", title: "Demo Chat" }).then(
        setConversationId,
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
        `Rate limit reached. Resets in ${getResetTimeDisplay()}. This is a demo with limited usage.`,
      );
      return;
    }

    const message = inputValue.trim();
    setInputValue("");
    setIsLoading(true);
    setError(null);

    try {
      // Server enforces rate limit with fingerprint
      const result = await sendMessage({
        conversationId,
        message,
        fingerprint: fingerprint ?? undefined,
      });
      if (!result.success) {
        setError(result.error ?? "Failed to send message");
      } else {
        // Update local rate limit after successful send
        await recordMessage();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
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
              {!rateLimitLoading && (
                <span
                  className={`rate-limit-badge ${isRateLimited ? "exhausted" : ""}`}
                >
                  {remaining}/{messageLimit} messages
                </span>
              )}
            </div>
            <div className="chat-header-right">
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

          <div className="chat-messages">
            {!messages || messages.length === 0 ? (
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
              messages.map((msg) => (
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
            {streamingContent?.content && (
              <div className="chat-message assistant streaming">
                <div className="message-role">Assistant</div>
                <div className="message-content">
                  <MarkdownContent content={streamingContent.content} />
                  <span className="typing-indicator">▌</span>
                </div>
              </div>
            )}

            {/* Loading indicator when no streaming yet */}
            {isLoading && !streamingContent?.content && (
              <div className="chat-message assistant">
                <div className="message-role">Assistant</div>
                <div className="message-content">
                  <span className="thinking">Thinking...</span>
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
              disabled={isLoading || !conversationId || isRateLimited}
              className="chat-input"
            />
            <button
              type="submit"
              disabled={
                isLoading ||
                !inputValue.trim() ||
                !conversationId ||
                isRateLimited
              }
              className="chat-submit"
            >
              {isLoading ? "..." : "Send"}
            </button>
          </form>

          {isRateLimited && (
            <div className="rate-limit-footer">
              This demo has a {messageLimit}-message limit per 24 hours.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
