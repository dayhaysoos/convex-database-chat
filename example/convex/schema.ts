import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  products: defineTable({
    name: v.string(),
    description: v.string(),
    category: v.string(),
    price: v.number(),
    stock: v.number(),
    imageUrl: v.optional(v.string()),
  })
    .index("by_category", ["category"])
    .index("by_price", ["price"]),
});
