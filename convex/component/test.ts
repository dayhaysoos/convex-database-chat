/**
 * Test utilities for the databaseChat component.
 * 
 * NOTE: This file is for npm package export only. The import.meta.glob
 * feature is Vite-specific and not supported in Convex runtime.
 * 
 * When this becomes an npm package, apps can import this to register
 * the component with their test instances:
 * 
 * ```typescript
 * import { register } from "@convex-dev/database-chat/test";
 * import { convexTest } from "convex-test";
 * 
 * const t = convexTest(appSchema, appModules);
 * register(t, "databaseChat");
 * ```
 */

// TODO: Uncomment when extracting to npm package
// This code uses import.meta.glob which only works in Vite/Node.js environments,
// not in Convex's serverless runtime.
//
// /// <reference types="vite/client" />
// import type { TestConvex } from "convex-test";
// import type { GenericSchema, SchemaDefinition } from "convex/server";
// import schema from "./schema";
//
// const modules = import.meta.glob("./**/*.ts");
//
// /**
//  * Register the databaseChat component with a test convex instance.
//  * 
//  * @param t - The test convex instance from convexTest()
//  * @param name - The component name as registered in convex.config.ts (default: "databaseChat")
//  */
// export function register(
//   t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
//   name: string = "databaseChat"
// ) {
//   t.registerComponent(name, schema, modules);
// }
//
// export default { register, schema, modules };

// Placeholder export to make this a valid module
export {};

