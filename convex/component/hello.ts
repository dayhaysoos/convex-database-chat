import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Simple hello world to verify the component is working
 */
export const world = query({
  args: {},
  returns: v.string(),
  handler: async () => {
    return "Hello from DatabaseChat component!";
  },
});
