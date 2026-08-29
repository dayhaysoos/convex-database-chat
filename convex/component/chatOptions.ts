import { v, type Infer } from "convex/values";
import { databaseChatToolValidator } from "./tools";

export const resultContractValidator = v.union(
  v.literal("off"),
  v.literal("warn"),
  v.literal("enforce")
);

export type ResultContractValidation = Infer<typeof resultContractValidator>;

export const chatOptionsValidator = v.object({
  systemPrompt: v.optional(v.string()),
  toolGuidance: v.optional(v.string()),
  tools: v.optional(v.array(databaseChatToolValidator)),
  maxMessagesForLLM: v.optional(v.number()),
  toolContext: v.optional(v.any()),
  maxToolLoops: v.optional(v.number()),
  streamThrottleMs: v.optional(v.number()),
  maxToolResultChars: v.optional(v.number()),
  validateResultContract: v.optional(resultContractValidator),
});

export type ChatOptions = Infer<typeof chatOptionsValidator>;
