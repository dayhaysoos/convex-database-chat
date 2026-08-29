import { v, type Infer } from "convex/values";

export const DEFAULT_MODEL = "openai/gpt-4o";

export const providerOptionsValidator = v.object({
  model: v.optional(v.string()),
  httpReferer: v.optional(v.string()),
  xTitle: v.optional(v.string()),
  maxRetries: v.optional(v.number()),
  requestTimeoutMs: v.optional(v.number()),
  baseDelayMs: v.optional(v.number()),
  maxDelayMs: v.optional(v.number()),
});

export type ProviderOptions = Infer<typeof providerOptionsValidator>;
