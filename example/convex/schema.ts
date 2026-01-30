import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { DEFAULT_EMBEDDING_DIMENSIONS } from "@dayhaysoos/convex-database-chat/vector";

export default defineSchema({
  products: defineTable({
    name: v.string(),
    description: v.string(),
    category: v.string(),
    price: v.number(),
    stock: v.number(),
    imageUrl: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_category", ["category"])
    .index("by_price", ["price"])
    .vectorIndex("by_description_embedding", {
      vectorField: "embedding",
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    }),

  rateLimits: defineTable({
    fingerprint: v.string(),
    messageCount: v.number(),
    lastResetTime: v.number(),
  }).index("by_fingerprint", ["fingerprint"]),
});
