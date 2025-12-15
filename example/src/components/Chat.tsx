import { useState, useEffect, useRef, FormEvent } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

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
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Convex hooks
  const createConversation = useMutation(api.chat.createConversation);
  const sendMessage = useAction(api.chat.sendMessage);

  const messages = useQuery(
    api.chat.getMessages,
    conversationId ? { conversationId } : "skip"
  ) as Message[] | undefined;

  const streamingContent = useQuery(
    api.chat.getStreaming,
    conversationId ? { conversationId } : "skip"
  );

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

    const message = inputValue.trim();
    setInputValue("");
    setIsLoading(true);
    setError(null);

    try {
      const result = await sendMessage({ conversationId, message });
      if (!result.success) {
        setError(result.error ?? "Failed to send message");
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

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>🛒 E-commerce Assistant</h2>
        <button onClick={handleNewChat} className="new-chat-btn">
          New Chat
        </button>
      </div>

      <div className="chat-messages">
        {!messages || messages.length === 0 ? (
          <div className="chat-welcome">
            <h3>Welcome! 👋</h3>
            <p>
              I can help you explore your product inventory. Try asking me:
            </p>
            <ul>
              <li>"Show me all electronics under $50"</li>
              <li>"What products are low on stock?"</li>
              <li>"Give me an inventory overview"</li>
              <li>"Find running shoes"</li>
            </ul>
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
          placeholder="Ask about your inventory..."
          disabled={isLoading || !conversationId}
          className="chat-input"
        />
        <button
          type="submit"
          disabled={isLoading || !inputValue.trim() || !conversationId}
          className="chat-submit"
        >
          {isLoading ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
