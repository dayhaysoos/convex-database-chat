/**
 * Test utilities for the DatabaseChat component.
 *
 * Use these exports to test your app's integration with DatabaseChat.
 *
 * @example
 * ```typescript
 * /// <reference types="vite/client" />
 * import { describe, it, expect } from "vitest";
 * import { convexTest } from "convex-test";
 * import { schema, modules } from "@dayhaysoos/convex-database-chat/test";
 *
 * describe("my app with DatabaseChat", () => {
 *   function setupTest() {
 *     const t = convexTest();
 *     t.registerComponent("databaseChat", schema, modules);
 *     return t;
 *   }
 *
 *   it("should work with the component", async () => {
 *     const t = setupTest();
 *     // ... your tests
 *   });
 * });
 * ```
 */

// Re-export schema for component registration in tests
export { default as schema } from "../convex/component/schema";

// Re-export the module glob for component registration
// Note: Consumers need to use import.meta.glob in their own test files
// This is exported as a convenience reference
export const componentPath = "../convex/component";
