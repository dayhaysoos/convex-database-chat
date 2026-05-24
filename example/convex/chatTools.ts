import { action, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  formatVectorResults,
  generateEmbedding,
} from "@dayhaysoos/convex-database-chat/vector";
import type { DatabaseChatToolResult } from "@dayhaysoos/convex-database-chat/resultContract";

type ProductSummary = {
  _id: Id<"products">;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
};

type ProductSearchResult = {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  inStock: boolean;
  viewUrl: string;
  score?: number;
};

type LegacyVectorProductResult = ProductSummary & {
  id: string;
  inStock: boolean;
  viewUrl: string;
};

type ProductFilters = {
  searchQuery?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
};

const DEFAULT_STORE_ID = "demo-store";
const DEFAULT_STORE_LABEL = "Demo Store";
const DEFAULT_LIST_LIMIT = 5;
const MAX_LIST_LIMIT = 20;
const DEFAULT_SEMANTIC_LIMIT = 5;
const MAX_SEMANTIC_LIMIT = 12;

const productRowValidator = v.object({
  id: v.string(),
  name: v.string(),
  description: v.string(),
  category: v.string(),
  price: v.number(),
  stock: v.number(),
  inStock: v.boolean(),
  viewUrl: v.string(),
  score: v.optional(v.number()),
});

const resultMetaValidator = v.object({
  scope: v.object({
    type: v.string(),
    id: v.optional(v.string()),
    label: v.optional(v.string()),
  }),
  appliedFilters: v.optional(v.any()),
  count: v.optional(v.number()),
  returned: v.number(),
  exhaustive: v.boolean(),
  truncated: v.boolean(),
  truncationReason: v.optional(v.string()),
  sampled: v.boolean(),
  sampleMethod: v.optional(v.string()),
  pagination: v.optional(
    v.object({
      cursor: v.optional(v.union(v.string(), v.null())),
      hasMore: v.boolean(),
      nextCursor: v.optional(v.union(v.string(), v.null())),
      pageSize: v.optional(v.number()),
    }),
  ),
});

const productResultContractValidator = v.object({
  data: v.array(productRowValidator),
  meta: resultMetaValidator,
});

const productFiltersValidator = v.object({
  searchQuery: v.optional(v.string()),
  category: v.optional(v.string()),
  minPrice: v.optional(v.number()),
  maxPrice: v.optional(v.number()),
  inStockOnly: v.optional(v.boolean()),
});

function normalizeFilters(filters: ProductFilters = {}): ProductFilters {
  const normalized: ProductFilters = {};

  if (filters.searchQuery?.trim()) {
    normalized.searchQuery = filters.searchQuery.trim();
  }
  if (filters.category?.trim()) {
    normalized.category = filters.category.trim().toLowerCase();
  }
  if (filters.minPrice !== undefined) {
    normalized.minPrice = filters.minPrice;
  }
  if (filters.maxPrice !== undefined) {
    normalized.maxPrice = filters.maxPrice;
  }
  if (filters.inStockOnly !== undefined) {
    normalized.inStockOnly = filters.inStockOnly;
  }

  return normalized;
}

function applyProductFilters<T extends ProductSummary>(
  products: T[],
  filters: ProductFilters,
): T[] {
  let filtered = products;

  if (filters.category) {
    filtered = filtered.filter(
      (product) => product.category.toLowerCase() === filters.category,
    );
  }

  if (filters.minPrice !== undefined) {
    filtered = filtered.filter((product) => product.price >= filters.minPrice!);
  }

  if (filters.maxPrice !== undefined) {
    filtered = filtered.filter((product) => product.price <= filters.maxPrice!);
  }

  if (filters.inStockOnly) {
    filtered = filtered.filter((product) => product.stock > 0);
  }

  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (product) =>
        product.name.toLowerCase().includes(query) ||
        product.description.toLowerCase().includes(query),
    );
  }

  return filtered;
}

function productToResultRow(
  product: ProductSummary,
  score?: number,
): ProductSearchResult {
  const row: ProductSearchResult = {
    id: product._id,
    name: product.name,
    description: product.description,
    category: product.category,
    price: product.price,
    stock: product.stock,
    inStock: product.stock > 0,
    viewUrl: `/products/${product._id}`,
  };
  if (score !== undefined) {
    row.score = score;
  }
  return row;
}

function clampLimit(
  requestedLimit: number | undefined,
  defaultLimit: number,
  maxLimit: number,
): number {
  return Math.max(1, Math.min(requestedLimit ?? defaultLimit, maxLimit));
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function scopeForStore(storeId: string | undefined) {
  return {
    type: "store",
    id: storeId ?? DEFAULT_STORE_ID,
    label: DEFAULT_STORE_LABEL,
  };
}

/**
 * Legacy raw product search with top-level arguments.
 * Kept in the example to verify backwards-compatible raw tool behavior.
 */
export const searchProducts = query({
  args: {
    searchQuery: v.optional(v.string()),
    category: v.optional(v.string()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    inStockOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    storeId: v.optional(v.string()),
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
    const limit = clampLimit(args.limit, 20, 50);
    const products = await ctx.db.query("products").collect();
    const filters = normalizeFilters(args);
    return applyProductFilters(products, filters)
      .slice(0, limit)
      .map((product) => productToResultRow(product));
  },
});

/**
 * Exact count tool using the standard DatabaseChat result contract.
 */
export const countProducts = query({
  args: {
    filters: v.optional(productFiltersValidator),
    storeId: v.string(),
  },
  returns: productResultContractValidator,
  handler: async (
    ctx,
    args,
  ): Promise<DatabaseChatToolResult<ProductSearchResult>> => {
    const products = await ctx.db.query("products").collect();
    const filters = normalizeFilters(args.filters);
    const count = applyProductFilters(products, filters).length;

    return {
      data: [],
      meta: {
        scope: scopeForStore(args.storeId),
        appliedFilters: filters,
        count,
        returned: 0,
        exhaustive: true,
        truncated: false,
        sampled: false,
      },
    };
  },
});

/**
 * Deterministic cursor-paginated list using the standard result contract.
 */
export const listProducts = query({
  args: {
    filters: v.optional(productFiltersValidator),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    storeId: v.string(),
  },
  returns: productResultContractValidator,
  handler: async (
    ctx,
    args,
  ): Promise<DatabaseChatToolResult<ProductSearchResult>> => {
    const products = await ctx.db.query("products").collect();
    const filters = normalizeFilters(args.filters);
    const matchingProducts = applyProductFilters(products, filters);
    const offset = parseCursor(args.cursor);
    const limit = clampLimit(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const page = matchingProducts.slice(offset, offset + limit);
    const returned = page.length;
    const nextOffset = offset + returned;
    const hasMore = nextOffset < matchingProducts.length;

    return {
      data: page.map((product) => productToResultRow(product)),
      meta: {
        scope: scopeForStore(args.storeId),
        appliedFilters: filters,
        count: matchingProducts.length,
        returned,
        exhaustive: !hasMore,
        truncated: hasMore,
        ...(hasMore ? { truncationReason: "row_limit" } : {}),
        sampled: false,
        pagination: {
          cursor: args.cursor ?? null,
          hasMore,
          nextCursor: hasMore ? String(nextOffset) : null,
          pageSize: limit,
        },
      },
    };
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
    storeId: v.optional(v.string()),
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

    const docsWithUrls: LegacyVectorProductResult[] = docs.map((doc) => ({
      ...doc,
      id: doc._id,
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
      LegacyVectorProductResult,
      Id<"products">,
      typeof fields
    >(results, docsWithUrls, {
      snippetLength: 200,
      fields,
    });
  },
});

/**
 * Semantic search using the standard result contract.
 * This path exercises sampled top-K metadata and automatic prompt guidance.
 */
export const semanticSearchProductsStandard = action({
  args: {
    query: v.string(),
    filters: v.optional(
      v.object({
        category: v.optional(v.string()),
        inStockOnly: v.optional(v.boolean()),
      }),
    ),
    limit: v.optional(v.number()),
    storeId: v.string(),
  },
  returns: productResultContractValidator,
  handler: async (
    ctx,
    args,
  ): Promise<DatabaseChatToolResult<ProductSearchResult>> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY not configured");
    }

    const embedding = await generateEmbedding({
      apiKey,
      text: args.query,
    });

    const limit = clampLimit(
      args.limit,
      DEFAULT_SEMANTIC_LIMIT,
      MAX_SEMANTIC_LIMIT,
    );
    const filters = normalizeFilters(args.filters);
    const vectorLimit = filters.inStockOnly ? Math.min(limit * 4, 256) : limit;
    const results = await ctx.vectorSearch(
      "products",
      "by_description_embedding",
      {
        vector: embedding,
        limit: vectorLimit,
        ...(filters.category
          ? { filter: (q) => q.eq("category", filters.category!) }
          : {}),
      },
    );

    const chatToolsApi = api.chatTools as any;
    const docs = (await ctx.runQuery(chatToolsApi.fetchProductsByIds, {
      ids: results.map((result) => result._id),
    })) as ProductSummary[];
    const scoresById = new Map(
      results.map((result) => [result._id, result._score]),
    );
    const data = applyProductFilters(docs, filters)
      .slice(0, limit)
      .map((product) =>
        productToResultRow(product, scoresById.get(product._id)),
      );

    return {
      data,
      meta: {
        scope: scopeForStore(args.storeId),
        appliedFilters: {
          query: args.query,
          ...filters,
        },
        returned: data.length,
        exhaustive: false,
        truncated: true,
        truncationReason: "semantic_top_k_limit",
        sampled: true,
        sampleMethod: "semantic_top_k",
      },
    };
  },
});

/**
 * Get overall product statistics.
 * Useful for inventory overview questions.
 */
export const getProductStats = query({
  args: {
    storeId: v.optional(v.string()),
  },
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
    storeId: v.optional(v.string()),
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
