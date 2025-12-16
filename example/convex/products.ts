import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get all products for display in the products grid.
 */
export const getAllProducts = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("products"),
      _creationTime: v.number(),
      name: v.string(),
      description: v.string(),
      category: v.string(),
      price: v.number(),
      stock: v.number(),
    }),
  ),
  handler: async (ctx) => {
    return await ctx.db.query("products").collect();
  },
});

/**
 * Get a single product by ID.
 */
export const getProduct = query({
  args: { id: v.id("products") },
  returns: v.union(
    v.object({
      _id: v.id("products"),
      _creationTime: v.number(),
      name: v.string(),
      description: v.string(),
      category: v.string(),
      price: v.number(),
      stock: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Get unique categories for filtering.
 */
export const getCategories = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();
    const categories = [...new Set(products.map((p) => p.category))];
    return categories.sort();
  },
});
