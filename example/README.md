# E-commerce Database Chat Demo

A simple demo showing how to use the `@dayhaysoo/convex-database-chat` component to query an e-commerce product database using natural language.

## Features

- 🛒 50 mock e-commerce products across 4 categories
- 💬 Natural language queries powered by Claude via OpenRouter
- ⚡ Real-time streaming responses
- 🔍 Search by name, category, price range
- 🧠 Semantic search with vector embeddings
- 📊 Get inventory statistics and low-stock alerts

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Convex

```bash
npx convex dev
```

This will prompt you to create a new Convex project and set up your environment.

### 3. Add OpenRouter API Key

Get an API key from [OpenRouter](https://openrouter.ai/) and add it to your Convex environment:

```bash
npx convex env set OPENROUTER_API_KEY your_key_here
```

### 4. Seed the database

```bash
npm run seed
```

This populates the database with 50 mock products.

### 5. Generate embeddings for semantic search (optional)

```bash
npm run seed:embeddings
```

This generates vector embeddings for each product so semantic search can return
meaning-based results.

### 6. Run the app

```bash
npm run dev
```

This runs both the Convex dev server and the Vite UI in one command.
Open [http://localhost:3000](http://localhost:3000) in your browser.

Tip: use the **Tools** button in the chat header to see which tools are being
called (including semantic search).

If you only want one side:

```bash
# Convex only
npm run convex

# UI only
npm run dev:ui
```

## Local package development

If you want the example to use the local package (without publishing), you can
use the helper script:

```bash
# From repo root
./dev-link.sh link
```

Or use `npm link` directly:

```bash
# From repo root
npm run build:watch
npm link

# From example/
npm link @dayhaysoos/convex-database-chat
```

To go back to the published package:

```bash
npm unlink @dayhaysoos/convex-database-chat
npm install
```

## Example Queries

Try asking:

- "Show me all electronics under $50"
- "What products are low on stock?"
- "Give me an inventory overview"
- "Find running shoes"
- "Find items for a home office setup"
- "What are good travel essentials?"
- "How many products do we have in each category?"
- "What's the most expensive item in sports?"

## Project Structure

```
example/
├── src/
│   ├── main.tsx          # App entry with ConvexProvider
│   ├── App.tsx           # Main app component
│   ├── App.css           # Styles
│   └── components/
│       └── Chat.tsx      # Chat UI component
└── convex/
    ├── convex.config.ts  # Mounts databaseChat component
    ├── schema.ts         # Products table schema
    ├── seed.ts           # Mock product data
    ├── chatTools.ts      # Query functions for LLM
    └── chat.ts           # Chat integration
```

## How It Works

1. **User asks a question** → Sent to Convex action
2. **Action calls DatabaseChat component** → LLM with tool definitions
3. **LLM decides to call tools** → e.g., `searchProducts({ category: "electronics" })`
4. **Tool executes Convex query** → Returns product data
5. **LLM formats response** → With markdown links to products
6. **Response streamed to UI** → Real-time updates via Convex subscriptions
