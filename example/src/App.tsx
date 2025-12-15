import { Chat } from "./components/Chat";

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>🛍️ E-commerce Database Chat Demo</h1>
        <p>Ask questions about your product inventory using natural language</p>
      </header>

      <main className="app-main">
        <Chat />
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
          + OpenRouter
        </p>
      </footer>
    </div>
  );
}

export default App;
