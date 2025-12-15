# E-commerce Database Chat Demo

A simple demo showing how to use the `@dayhaysoo/convex-database-chat` component to query an e-commerce product database using natural language.

## Features

- 🛒 50 mock e-commerce products across 4 categories
- 💬 Natural language queries powered by Claude via OpenRouter
- ⚡ Real-time streaming responses
- 🔍 Search by name, category, price range
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

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Example Queries

Try asking:

- "Show me all electronics under $50"
- "What products are low on stock?"
- "Give me an inventory overview"
- "Find running shoes"
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
2. **Action calls OpenRouter** → LLM with tool definitions
3. **LLM decides to call tools** → e.g., `searchProducts({ category: "electronics" })`
4. **Tool executes Convex query** → Returns product data
5. **LLM formats response** → With markdown links to products
6. **Response streamed to UI** → Real-time updates via Convex subscriptions
