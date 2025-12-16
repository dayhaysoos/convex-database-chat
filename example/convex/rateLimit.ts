import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const MESSAGE_LIMIT = 3;
const RESET_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

export const checkRateLimit = query({
  args: { fingerprint: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("rateLimits")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
      .first();

    const now = Date.now();

    if (!record) {
      return {
        allowed: true,
        remaining: MESSAGE_LIMIT,
        resetTime: now + RESET_PERIOD_MS,
      };
    }

    // Check if reset period has passed
    if (now - record.lastResetTime >= RESET_PERIOD_MS) {
      return {
        allowed: true,
        remaining: MESSAGE_LIMIT,
        resetTime: now + RESET_PERIOD_MS,
      };
    }

    const remaining = Math.max(0, MESSAGE_LIMIT - record.messageCount);
    return {
      allowed: remaining > 0,
      remaining,
      resetTime: record.lastResetTime + RESET_PERIOD_MS,
    };
  },
});

export const incrementRateLimit = mutation({
  args: { fingerprint: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const record = await ctx.db
      .query("rateLimits")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
      .first();

    if (!record) {
      // Create new record
      await ctx.db.insert("rateLimits", {
        fingerprint: args.fingerprint,
        messageCount: 1,
        lastResetTime: now,
      });
      return {
        allowed: true,
        remaining: MESSAGE_LIMIT - 1,
        resetTime: now + RESET_PERIOD_MS,
      };
    }

    // Check if reset period has passed
    if (now - record.lastResetTime >= RESET_PERIOD_MS) {
      // Reset the counter
      await ctx.db.patch(record._id, {
        messageCount: 1,
        lastResetTime: now,
      });
      return {
        allowed: true,
        remaining: MESSAGE_LIMIT - 1,
        resetTime: now + RESET_PERIOD_MS,
      };
    }

    // Check if limit exceeded
    if (record.messageCount >= MESSAGE_LIMIT) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: record.lastResetTime + RESET_PERIOD_MS,
      };
    }

    // Increment counter
    const newCount = record.messageCount + 1;
    await ctx.db.patch(record._id, {
      messageCount: newCount,
    });

    return {
      allowed: true,
      remaining: MESSAGE_LIMIT - newCount,
      resetTime: record.lastResetTime + RESET_PERIOD_MS,
    };
  },
});
