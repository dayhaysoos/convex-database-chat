import { action, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  formatVectorResults,
  generateEmbedding,
} from "@dayhaysoos/convex-database-chat/vector";

type ProductSummary = {
  _id: Id<"products">;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
};

type ProductSearchResult = ProductSummary & {
  inStock: boolean;
  viewUrl: string;
};

/**
 * Search products by various filters.
 * Used by the LLM to find products matching user queries.
 */
export const searchProducts = query({
  args: {
    searchQuery: v.optional(v.string()),
    category: v.optional(v.string()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    inStockOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      description: v.string(),
      category: v.string(),
      price: v.number(),
      stock: v.number(),
      inStock: v.boolean(),
      viewUrl: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 50);
    let products = await ctx.db.query("products").collect();

    // Filter by category
    if (args.category) {
      const cat = args.category.toLowerCase();
      products = products.filter((p) => p.category.toLowerCase() === cat);
    }

    // Filter by price range
    if (args.minPrice !== undefined) {
      products = products.filter((p) => p.price >= args.minPrice!);
    }
    if (args.maxPrice !== undefined) {
      products = products.filter((p) => p.price <= args.maxPrice!);
    }

    // Filter by stock
    if (args.inStockOnly) {
      products = products.filter((p) => p.stock > 0);
    }

    // Filter by search query (name or description)
    if (args.searchQuery) {
      const q = args.searchQuery.toLowerCase();
      products = products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q),
      );
    }

    return products.slice(0, limit).map((p) => ({
      id: p._id,
      name: p.name,
      description: p.description,
      category: p.category,
      price: p.price,
      stock: p.stock,
      inStock: p.stock > 0,
      viewUrl: `/products/${p._id}`,
    }));
  },
});

/**
 * Semantic search using embeddings and vector search.
 * Use this for fuzzy queries like "travel essentials" or "home office setup".
 */
export const semanticSearchProducts = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("products"),
      name: v.string(),
      description: v.string(),
      category: v.string(),
      price: v.number(),
      stock: v.number(),
      inStock: v.boolean(),
      viewUrl: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY not configured");
    }

    const embedding = await generateEmbedding({
      apiKey,
      text: args.query,
    });

    const limit = Math.min(args.limit ?? 12, 32);
    const results = await ctx.vectorSearch(
      "products",
      "by_description_embedding",
      {
        vector: embedding,
        limit,
      },
    );

    const chatToolsApi = api.chatTools as any;
    const docs = (await ctx.runQuery(chatToolsApi.fetchProductsByIds, {
      ids: results.map((result) => result._id),
    })) as ProductSummary[];

    const docsWithUrls: ProductSearchResult[] = docs.map((doc) => ({
      ...doc,
      inStock: doc.stock > 0,
      viewUrl: `/products/${doc._id}`,
    }));

    const fields = [
      "name",
      "description",
      "category",
      "price",
      "stock",
      "inStock",
      "viewUrl",
    ] as const;

    return formatVectorResults<
      ProductSearchResult,
      Id<"products">,
      typeof fields
    >(results, docsWithUrls, {
      snippetLength: 200,
      fields,
    });
  },
});

/**
 * Get overall product statistics.
 * Useful for inventory overview questions.
 */
export const getProductStats = query({
  args: {},
  returns: v.object({
    totalProducts: v.number(),
    totalValue: v.number(),
    averagePrice: v.number(),
    categoryBreakdown: v.array(
      v.object({
        category: v.string(),
        count: v.number(),
        totalStock: v.number(),
      }),
    ),
    priceRanges: v.object({
      under25: v.number(),
      from25to50: v.number(),
      from50to100: v.number(),
      over100: v.number(),
    }),
  }),
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();

    const totalProducts = products.length;
    const totalValue = products.reduce((sum, p) => sum + p.price * p.stock, 0);
    const averagePrice =
      totalProducts > 0
        ? products.reduce((sum, p) => sum + p.price, 0) / totalProducts
        : 0;

    // Category breakdown
    const categoryMap = new Map<
      string,
      { count: number; totalStock: number }
    >();
    for (const p of products) {
      const existing = categoryMap.get(p.category) || {
        count: 0,
        totalStock: 0,
      };
      categoryMap.set(p.category, {
        count: existing.count + 1,
        totalStock: existing.totalStock + p.stock,
      });
    }
    const categoryBreakdown = Array.from(categoryMap.entries()).map(
      ([category, data]) => ({
        category,
        count: data.count,
        totalStock: data.totalStock,
      }),
    );

    // Price ranges
    const priceRanges = {
      under25: products.filter((p) => p.price < 25).length,
      from25to50: products.filter((p) => p.price >= 25 && p.price < 50).length,
      from50to100: products.filter((p) => p.price >= 50 && p.price < 100)
        .length,
      over100: products.filter((p) => p.price >= 100).length,
    };

    return {
      totalProducts,
      totalValue: Math.round(totalValue * 100) / 100,
      averagePrice: Math.round(averagePrice * 100) / 100,
      categoryBreakdown,
      priceRanges,
    };
  },
});

/**
 * Get products with low stock (less than threshold).
 * Useful for inventory management questions.
 */
export const getLowStockProducts = query({
  args: {
    threshold: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      category: v.string(),
      price: v.number(),
      stock: v.number(),
      viewUrl: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const threshold = args.threshold ?? 10;
    const products = await ctx.db.query("products").collect();

    return products
      .filter((p) => p.stock < threshold)
      .sort((a, b) => a.stock - b.stock)
      .map((p) => ({
        id: p._id,
        name: p.name,
        category: p.category,
        price: p.price,
        stock: p.stock,
        viewUrl: `/products/${p._id}`,
      }));
  },
});

/**
 * Fetch products by ID in a stable order for vector search results.
 */
export const fetchProductsByIds = query({
  args: { ids: v.array(v.id("products")) },
  returns: v.array(
    v.object({
      _id: v.id("products"),
      name: v.string(),
      description: v.string(),
      category: v.string(),
      price: v.number(),
      stock: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const results = [];
    for (const id of args.ids) {
      const product = await ctx.db.get(id);
      if (!product) {
        continue;
      }
      results.push({
        _id: product._id,
        name: product.name,
        description: product.description,
        category: product.category,
        price: product.price,
        stock: product.stock,
      });
    }
    return results;
  },
});
