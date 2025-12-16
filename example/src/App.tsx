import { useState, useEffect } from "react";
import { Chat } from "./components/Chat";
import { ProductsGrid } from "./components/ProductsGrid";
import { ProductModal } from "./components/ProductModal";
import "./App.css";

function getProductIdFromUrl(): string | null {
  const path = window.location.pathname;
  const match = path.match(/^\/products\/(.+)$/);
  return match ? match[1] : null;
}

function App() {
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    getProductIdFromUrl,
  );

  // Listen for popstate (browser back/forward)
  useEffect(() => {
    const handlePopState = () => {
      setSelectedProductId(getProductIdFromUrl());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Listen for clicks on product links
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a");

      if (link) {
        const href = link.getAttribute("href");
        if (href?.startsWith("/products/")) {
          e.preventDefault();
          const productId = href.replace("/products/", "");
          setSelectedProductId(productId);
          window.history.pushState({}, "", href);
        }
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const closeModal = () => {
    setSelectedProductId(null);
    window.history.pushState({}, "", "/");
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>Database Chat Demo</h1>
          <p>
            Browse the product catalog or use the chat to query with natural
            language
          </p>
        </div>
        <div className="header-links">
          <a
            href="https://github.com/dayhaysoos/convex-database-chat"
            target="_blank"
            rel="noopener noreferrer"
            className="github-link"
          >
            View on GitHub
          </a>
        </div>
      </header>

      <main className="app-main">
        <ProductsGrid />
      </main>

      <footer className="app-footer">
        <p>
          Powered by{" "}
          <a
            href="https://convex.dev"
            target="_blank"
            rel="noopener noreferrer"
          >
            Convex
          </a>{" "}
          +{" "}
          <a
            href="https://openrouter.ai"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenRouter
          </a>
        </p>
      </footer>

      {/* Floating chat widget */}
      <Chat />

      {/* Product detail modal */}
      {selectedProductId && (
        <ProductModal productId={selectedProductId} onClose={closeModal} />
      )}
    </div>
  );
}

export default App;
