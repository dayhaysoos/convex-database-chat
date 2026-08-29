import { v, type Infer } from "convex/values";
import { chatOptionsValidator, type ChatOptions } from "./chatOptions";

export type { ChatOptions };
import {
  providerOptionsValidator,
  type ProviderOptions,
} from "../../src/openrouter/options.js";

export const sendOptionsValidator = v.object({
  apiKey: v.string(),
  chat: v.optional(chatOptionsValidator),
  provider: v.optional(providerOptionsValidator),
});

export type SendOptions = Infer<typeof sendOptionsValidator>;

export type OptionOverrides = {
  chat?: Partial<ChatOptions>;
  provider?: Partial<ProviderOptions>;
};

export function mergeOptionLayers<T extends object>(
  ...layers: Array<T | undefined>
): T {
  const merged = {} as Record<string, unknown>;
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged as T;
}
