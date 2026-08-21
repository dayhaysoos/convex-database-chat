import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
  GenericMutationCtx,
} from "convex/server";
import type { DataModel } from "./_generated/dataModel";

/**
 * Minimal context shapes shared by component helpers. Typed against the
 * component's DataModel so db reads/writes and index callbacks are checked.
 */
export type ReadContext = { db: GenericDatabaseReader<DataModel> };

export type WriteContext = { db: GenericDatabaseWriter<DataModel> };

export type SchedulingContext = {
  scheduler: GenericMutationCtx<DataModel>["scheduler"];
};
