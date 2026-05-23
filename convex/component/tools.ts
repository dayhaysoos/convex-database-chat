/**
 * Tool definitions for DatabaseChat.
 *
 * Supports two approaches:
 * 1. Explicit tools - you define exactly what queries the LLM can call
 * 2. Auto-tools - generated from your Convex schema
 *
 * @example Explicit tool
 * ```typescript
 * const searchTool: DatabaseChatTool = {
 *   name: "searchApplications",
 *   description: "Search applications by skill or candidate name",
 *   parameters: {
 *     type: "object",
 *     properties: {
 *       query: { type: "string", description: "Search query" },
 *       limit: { type: "number", description: "Max results" }
 *     },
 *     required: ["query"]
 *   },
 *   // Function handle string - created via createFunctionHandle()
 *   handler: functionHandleString,
 * };
 * ```
 */

import { v } from "convex/values";
import type { DatabaseChatToolResult } from "./resultContract";

// =============================================================================
// Tool Types
// =============================================================================

export type ToolParameterPropertySchema = {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: { type: string };
  properties?: Record<string, ToolParameterPropertySchema>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
};

/**
 * JSON Schema for tool parameters (OpenAI function calling format).
 */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, ToolParameterPropertySchema>;
  required?: string[];
}

export type DatabaseChatToolKind =
  | "count"
  | "paginated_list"
  | "semantic_search"
  | "detail"
  | "unknown";

export type DatabaseChatToolMetadata = {
  kind: DatabaseChatToolKind;
  resultContract?: "standard";
};

/**
 * A tool that the LLM can call.
 */
export interface DatabaseChatTool {
  /** Unique name for the tool (used by LLM to call it) */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema describing the parameters */
  parameters: ToolParameterSchema;
  /**
   * Function type for the handler (default: "query").
   * Use "action" for tools that call ctx.vectorSearch or external APIs.
   */
  handlerType?: "query" | "mutation" | "action";
  /**
   * Function handle string to execute.
   * Create this using `createFunctionHandle(api.myQuery)` in your app code,
   * then pass the string to the component. Use `handlerType` for actions or
   * mutations (default: "query").
   */
  handler: string;
  /**
   * Optional reliability metadata. Raw tools without metadata are treated as
   * kind "unknown" by prompt guidance.
   */
  metadata?: DatabaseChatToolMetadata;
}

/**
 * Configuration for auto-generated tools.
 */
export interface AutoToolsConfig {
  /**
   * Tables to expose for querying.
   * Only these tables will have tools generated.
   */
  allowedTables: string[];
  /**
   * Fields to exclude from each table.
   * Use this to hide sensitive data like SSN, passwords, etc.
   */
  excludeFields?: Record<string, string[]>;
  /**
   * Custom descriptions for tables.
   * Helps the LLM understand what each table contains.
   */
  tableDescriptions?: Record<string, string>;
  /**
   * Custom descriptions for fields.
   * Format: { "tableName.fieldName": "description" }
   */
  fieldDescriptions?: Record<string, string>;
}

/**
 * Full tools configuration for DatabaseChat.
 */
export interface ToolsConfig {
  /** Explicitly defined tools */
  tools?: DatabaseChatTool[];
  /** Auto-generate tools from schema */
  autoTools?: AutoToolsConfig;
}

// =============================================================================
// Tool Validators (for Convex args)
// =============================================================================

export const toolParameterSchemaValidator = v.object({
  type: v.literal("object"),
  properties: v.any(), // Complex nested structure
  required: v.optional(v.array(v.string())),
});

export const databaseChatToolValidator = v.object({
  name: v.string(),
  description: v.string(),
  parameters: toolParameterSchemaValidator,
  handlerType: v.optional(
    v.union(v.literal("query"), v.literal("mutation"), v.literal("action"))
  ),
  handler: v.string(),
  metadata: v.optional(
    v.object({
      kind: v.union(
        v.literal("count"),
        v.literal("paginated_list"),
        v.literal("semantic_search"),
        v.literal("detail"),
        v.literal("unknown")
      ),
      resultContract: v.optional(v.literal("standard")),
    })
  ),
});

// =============================================================================
// Typed Tool Builder Types
// =============================================================================

declare const modelArgsSymbol: unique symbol;
declare const handlerArgsSymbol: unique symbol;
declare const resultSymbol: unique symbol;

export type FilterDefinition<
  Kind extends "string" | "number" | "boolean" | "enum",
  Value,
  Required extends boolean = false,
> = {
  kind: Kind;
  description?: string;
  required?: Required;
  min?: number;
  max?: number;
  values?: readonly string[];
  readonly __filterValue?: Value;
};

export type StringFilter<Required extends boolean = false> = FilterDefinition<
  "string",
  string,
  Required
>;

export type NumberFilter<Required extends boolean = false> = FilterDefinition<
  "number",
  number,
  Required
>;

export type BooleanFilter<Required extends boolean = false> = FilterDefinition<
  "boolean",
  boolean,
  Required
>;

export type EnumFilter<
  Values extends readonly string[],
  Required extends boolean = false,
> = FilterDefinition<"enum", Values[number], Required> & {
  values: Values;
};

export type AnyFilterDefinition = FilterDefinition<
  "string" | "number" | "boolean" | "enum",
  unknown,
  boolean
>;

export type FilterDefinitions = Record<string, AnyFilterDefinition>;

export type InjectedArg<Kind extends "string"> = {
  kind: Kind;
  description?: string;
  readonly __injectedValue?: Kind extends "string" ? string : never;
};

export type InjectedArgDefinitions = Record<string, InjectedArg<"string">>;

export type LimitOptions = {
  defaultLimit?: number;
  maxLimit?: number;
};

export interface DatabaseChatDefinedTool<
  Kind extends DatabaseChatToolKind,
  Row,
  ModelArgs,
  HandlerArgs,
> extends DatabaseChatTool {
  metadata: {
    kind: Kind;
    resultContract: "standard";
  };
  readonly [modelArgsSymbol]?: ModelArgs;
  readonly [handlerArgsSymbol]?: HandlerArgs;
  readonly [resultSymbol]?: DatabaseChatToolResult<Row>;
}

export type InferToolModelArgs<Tool> = Tool extends {
  readonly [modelArgsSymbol]?: infer Args;
}
  ? Args
  : Record<string, unknown>;

export type InferToolHandlerArgs<Tool> = Tool extends {
  readonly [handlerArgsSymbol]?: infer Args;
}
  ? Args
  : Record<string, unknown>;

export type InferToolResult<Tool> = Tool extends {
  readonly [resultSymbol]?: infer Result;
}
  ? Result
  : unknown;

type FilterValue<TFilter> = TFilter extends { readonly __filterValue?: infer V }
  ? V
  : never;

type InjectedValue<TInjected> = TInjected extends {
  readonly __injectedValue?: infer V;
}
  ? V
  : never;

type RequiredFilterKeys<Filters extends FilterDefinitions> = {
  [Key in keyof Filters]-?: Filters[Key] extends FilterDefinition<
    "string" | "number" | "boolean" | "enum",
    unknown,
    true
  >
    ? Key
    : never;
}[keyof Filters];

type OptionalFilterKeys<Filters extends FilterDefinitions> = Exclude<
  keyof Filters,
  RequiredFilterKeys<Filters>
>;

type HasRequiredFilters<Filters extends FilterDefinitions> =
  [RequiredFilterKeys<Filters>] extends [never] ? false : true;

type FilterArgs<Filters extends FilterDefinitions> = {
  [Key in RequiredFilterKeys<Filters>]: FilterValue<Filters[Key]>;
} & {
  [Key in OptionalFilterKeys<Filters>]?: FilterValue<Filters[Key]>;
};

type EmptyObject = Record<never, never>;

type Expand<T> = { [Key in keyof T]: T[Key] };

type WithFilters<Filters extends FilterDefinitions> =
  keyof Filters extends never
    ? EmptyObject
    : HasRequiredFilters<Filters> extends true
      ? { filters: Expand<FilterArgs<Filters>> }
      : { filters?: Expand<FilterArgs<Filters>> };

type InjectedArgs<Injected extends InjectedArgDefinitions> = {
  [Key in keyof Injected]: InjectedValue<Injected[Key]>;
};

type CountModelArgs<Filters extends FilterDefinitions> = Expand<
  WithFilters<Filters>
>;

type CountHandlerArgs<
  Filters extends FilterDefinitions,
  Injected extends InjectedArgDefinitions,
> = Expand<CountModelArgs<Filters> & InjectedArgs<Injected>>;

type PaginatedListModelArgs<Filters extends FilterDefinitions> = Expand<
  WithFilters<Filters> & {
    limit?: number;
    cursor?: string;
  }
>;

type PaginatedListHandlerArgs<
  Filters extends FilterDefinitions,
  Injected extends InjectedArgDefinitions,
> = Expand<PaginatedListModelArgs<Filters> & InjectedArgs<Injected>>;

type SemanticSearchModelArgs<Filters extends FilterDefinitions> = Expand<
  WithFilters<Filters> & {
    query: string;
    limit?: number;
  }
>;

type SemanticSearchHandlerArgs<
  Filters extends FilterDefinitions,
  Injected extends InjectedArgDefinitions,
> = Expand<SemanticSearchModelArgs<Filters> & InjectedArgs<Injected>>;

type BaseToolBuilderOptions<
  Filters extends FilterDefinitions,
  Injected extends InjectedArgDefinitions,
> = {
  name: string;
  description: string;
  handler: string;
  handlerType?: DatabaseChatTool["handlerType"];
  filters?: Filters;
  injectedArgs?: Injected;
};

export type CountToolBuilderOptions<
  Filters extends FilterDefinitions = EmptyObject,
  Injected extends InjectedArgDefinitions = EmptyObject,
> = BaseToolBuilderOptions<Filters, Injected>;

export type PaginatedListToolBuilderOptions<
  Filters extends FilterDefinitions = EmptyObject,
  Injected extends InjectedArgDefinitions = EmptyObject,
> = BaseToolBuilderOptions<Filters, Injected> & {
  pagination?: LimitOptions;
};

export type SemanticSearchToolBuilderOptions<
  Filters extends FilterDefinitions = EmptyObject,
  Injected extends InjectedArgDefinitions = EmptyObject,
> = BaseToolBuilderOptions<Filters, Injected> & {
  limit?: LimitOptions;
};

// =============================================================================
// Tool Helpers
// =============================================================================

/**
 * Format tools for OpenAI/OpenRouter function calling.
 */
export function formatToolsForLLM(tools: DatabaseChatTool[]): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
}> {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Find a tool by name.
 */
export function findTool(
  tools: DatabaseChatTool[],
  name: string
): DatabaseChatTool | undefined {
  return tools.find((t) => t.name === name);
}

/**
 * Validate tool call arguments against the schema.
 * Returns an error message if invalid, null if valid.
 */
export function validateToolArgs(
  tool: DatabaseChatTool,
  args: Record<string, unknown>
): string | null {
  return validateObjectArgs(tool.parameters, args);
}

function validateObjectArgs(
  schema: ToolParameterSchema | ToolParameterPropertySchema,
  args: Record<string, unknown>,
  path = ""
): string | null {
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const field of required) {
    if (!(field in args)) {
      return `Missing required field: ${joinPath(path, field)}`;
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const propertySchema = properties[key];
    if (!propertySchema) {
      continue;
    }

    const fieldPath = joinPath(path, key);
    const requiredField = required.includes(key);
    const typeError = validateValueType(propertySchema, value, fieldPath, {
      required: requiredField,
    });
    if (typeError) {
      return typeError;
    }
    if (value === null && !requiredField) {
      continue;
    }

    if (
      propertySchema.type === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof value === "object" &&
      propertySchema.properties
    ) {
      const nestedError = validateObjectArgs(
        propertySchema,
        value as Record<string, unknown>,
        fieldPath
      );
      if (nestedError) {
        return nestedError;
      }
    }

    if (propertySchema.enum && !propertySchema.enum.includes(value as string)) {
      return `Field ${fieldPath} must be one of: ${propertySchema.enum.join(", ")}`;
    }
  }

  return null;
}

function validateValueType(
  schema: ToolParameterPropertySchema,
  value: unknown,
  path: string,
  options: { required: boolean }
): string | null {
  const expectedType = schema.type;
  const actualType =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

  if (expectedType !== actualType) {
    if (value === null && !options.required) {
      return null;
    }
    return `Field ${path} expected ${expectedType}, got ${actualType}`;
  }

  return null;
}

function joinPath(base: string, field: string): string {
  return base ? `${base}.${field}` : field;
}

// =============================================================================
// Typed Tool Builder Helpers
// =============================================================================

export function stringFilter<const Required extends boolean = false>(
  options?: {
    description?: string;
    required?: Required;
  }
): StringFilter<Required> {
  return {
    kind: "string",
    description: options?.description,
    required: options?.required,
  };
}

export function numberFilter<const Required extends boolean = false>(
  options?: {
    description?: string;
    required?: Required;
    min?: number;
    max?: number;
  }
): NumberFilter<Required> {
  return {
    kind: "number",
    description: options?.description,
    required: options?.required,
    min: options?.min,
    max: options?.max,
  };
}

export function booleanFilter<const Required extends boolean = false>(
  options?: {
    description?: string;
    required?: Required;
  }
): BooleanFilter<Required> {
  return {
    kind: "boolean",
    description: options?.description,
    required: options?.required,
  };
}

export function enumFilter<
  const Values extends readonly string[],
  const Required extends boolean = false,
>(options: {
  values: Values;
  description?: string;
  required?: Required;
}): EnumFilter<Values, Required> {
  return {
    kind: "enum",
    values: options.values,
    description: options.description,
    required: options.required,
  };
}

export function injectedString(options?: {
  description?: string;
}): InjectedArg<"string"> {
  return {
    kind: "string",
    description: options?.description,
  };
}

export function defineCountTool<
  Row = unknown,
  const Filters extends FilterDefinitions = EmptyObject,
  const Injected extends InjectedArgDefinitions = EmptyObject,
>(
  options: CountToolBuilderOptions<Filters, Injected>
): DatabaseChatDefinedTool<
  "count",
  Row,
  CountModelArgs<Filters>,
  CountHandlerArgs<Filters, Injected>
> {
  return defineDatabaseTool({
    ...options,
    kind: "count",
    resultContract: "standard",
  }) as DatabaseChatDefinedTool<
    "count",
    Row,
    CountModelArgs<Filters>,
    CountHandlerArgs<Filters, Injected>
  >;
}

export function definePaginatedListTool<
  Row = unknown,
  const Filters extends FilterDefinitions = EmptyObject,
  const Injected extends InjectedArgDefinitions = EmptyObject,
>(
  options: PaginatedListToolBuilderOptions<Filters, Injected>
): DatabaseChatDefinedTool<
  "paginated_list",
  Row,
  PaginatedListModelArgs<Filters>,
  PaginatedListHandlerArgs<Filters, Injected>
> {
  const limits = resolveLimits(options.pagination, {
    defaultLimit: 20,
    maxLimit: 100,
  });
  return defineDatabaseTool({
    ...options,
    kind: "paginated_list",
    resultContract: "standard",
    limit: limits,
    cursor: true,
  }) as DatabaseChatDefinedTool<
    "paginated_list",
    Row,
    PaginatedListModelArgs<Filters>,
    PaginatedListHandlerArgs<Filters, Injected>
  >;
}

export function defineSemanticSearchTool<
  Row = unknown,
  const Filters extends FilterDefinitions = EmptyObject,
  const Injected extends InjectedArgDefinitions = EmptyObject,
>(
  options: SemanticSearchToolBuilderOptions<Filters, Injected>
): DatabaseChatDefinedTool<
  "semantic_search",
  Row,
  SemanticSearchModelArgs<Filters>,
  SemanticSearchHandlerArgs<Filters, Injected>
> {
  const limits = resolveLimits(options.limit, {
    defaultLimit: 10,
    maxLimit: 50,
  });
  return defineDatabaseTool({
    ...options,
    kind: "semantic_search",
    resultContract: "standard",
    query: true,
    limit: limits,
  }) as DatabaseChatDefinedTool<
    "semantic_search",
    Row,
    SemanticSearchModelArgs<Filters>,
    SemanticSearchHandlerArgs<Filters, Injected>
  >;
}

function defineDatabaseTool<
  Filters extends FilterDefinitions,
  Injected extends InjectedArgDefinitions,
>(options: BaseToolBuilderOptions<Filters, Injected> & {
  kind: Exclude<DatabaseChatToolKind, "detail" | "unknown">;
  resultContract: "standard";
  query?: boolean;
  cursor?: boolean;
  limit?: Required<LimitOptions>;
}): DatabaseChatTool {
  const parameters = buildParameters(options);

  return {
    name: options.name,
    description: options.description,
    parameters,
    handlerType: options.handlerType,
    handler: options.handler,
    metadata: {
      kind: options.kind,
      resultContract: options.resultContract,
    },
  };
}

function buildParameters<
  Filters extends FilterDefinitions,
  Injected extends InjectedArgDefinitions,
>(
  options: BaseToolBuilderOptions<Filters, Injected> & {
    query?: boolean;
    cursor?: boolean;
    limit?: Required<LimitOptions>;
  }
): ToolParameterSchema {
  const properties: Record<string, ToolParameterPropertySchema> = {};
  const required: string[] = [];

  if (options.query) {
    properties.query = {
      type: "string",
      description: "Semantic search query.",
    };
    required.push("query");
  }

  const filters = options.filters ?? ({} as Filters);
  const filterKeys = Object.keys(filters);
  if (filterKeys.length > 0) {
    const filterSchema = buildFiltersSchema(filters);
    properties.filters = filterSchema;
    if ((filterSchema.required ?? []).length > 0) {
      required.push("filters");
    }
  }

  if (options.cursor) {
    properties.cursor = {
      type: "string",
      description:
        "Opaque cursor from the previous result page. Omit this for the first page.",
    };
  }

  if (options.limit) {
    properties.limit = {
      type: "number",
      description: `Maximum number of results to return (default: ${options.limit.defaultLimit}, max: ${options.limit.maxLimit}).`,
      minimum: 0,
      maximum: options.limit.maxLimit,
    };
  }

  return {
    type: "object",
    properties,
    required,
  };
}

function buildFiltersSchema(
  filters: FilterDefinitions
): ToolParameterPropertySchema {
  const properties: Record<string, ToolParameterPropertySchema> = {};
  const required: string[] = [];

  for (const [name, filter] of Object.entries(filters)) {
    properties[name] = filterToSchema(filter);
    if (filter.required === true) {
      required.push(name);
    }
  }

  return {
    type: "object",
    description: "App-defined filters to apply.",
    properties,
    required,
    additionalProperties: false,
  };
}

function filterToSchema(filter: AnyFilterDefinition): ToolParameterPropertySchema {
  switch (filter.kind) {
    case "number":
      return {
        type: "number",
        description: filter.description,
        minimum: filter.min,
        maximum: filter.max,
      };
    case "boolean":
      return {
        type: "boolean",
        description: filter.description,
      };
    case "enum":
      return {
        type: "string",
        description: filter.description,
        enum: filter.values ? [...filter.values] : [],
      };
    case "string":
    default:
      return {
        type: "string",
        description: filter.description,
      };
  }
}

function resolveLimits(
  options: LimitOptions | undefined,
  defaults: Required<LimitOptions>
): Required<LimitOptions> {
  return {
    defaultLimit: options?.defaultLimit ?? defaults.defaultLimit,
    maxLimit: options?.maxLimit ?? defaults.maxLimit,
  };
}

// =============================================================================
// Built-in Generic Tools
// =============================================================================

/**
 * Create a generic "query table" tool.
 * This is useful when you want flexible querying without defining many tools.
 */
export function createQueryTableTool(
  allowedTables: string[],
  handler: string
): DatabaseChatTool {
  return {
    name: "queryTable",
    description: `Query a database table with optional filters. Available tables: ${allowedTables.join(
      ", "
    )}`,
    parameters: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "The table to query",
          enum: allowedTables,
        },
        filters: {
          type: "object",
          description:
            "Key-value filters to apply (e.g., { status: 'active' })",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
        },
        orderBy: {
          type: "string",
          description: "Field to order by",
        },
        order: {
          type: "string",
          description: "Sort order",
          enum: ["asc", "desc"],
        },
      },
      required: ["table"],
    },
    handler,
  };
}

/**
 * Create a generic "count records" tool.
 */
export function createCountTool(
  allowedTables: string[],
  handler: string
): DatabaseChatTool {
  return {
    name: "countRecords",
    description: `Count records in a table with optional filters. Available tables: ${allowedTables.join(
      ", "
    )}`,
    parameters: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "The table to count",
          enum: allowedTables,
        },
        filters: {
          type: "object",
          description: "Key-value filters to apply",
        },
      },
      required: ["table"],
    },
    handler,
  };
}

/**
 * Create a generic "aggregate" tool for stats.
 */
export function createAggregateTool(
  allowedTables: string[],
  handler: string
): DatabaseChatTool {
  return {
    name: "aggregate",
    description: `Calculate aggregations (sum, avg, min, max) on a numeric field. Available tables: ${allowedTables.join(
      ", "
    )}`,
    parameters: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "The table to aggregate",
          enum: allowedTables,
        },
        field: {
          type: "string",
          description: "The numeric field to aggregate",
        },
        operation: {
          type: "string",
          description: "The aggregation operation",
          enum: ["sum", "avg", "min", "max", "count"],
        },
        filters: {
          type: "object",
          description: "Optional filters to apply before aggregating",
        },
      },
      required: ["table", "field", "operation"],
    },
    handler,
  };
}

/**
 * Create a generic "search" tool using text search.
 */
export function createSearchTool(
  allowedTables: string[],
  handler: string
): DatabaseChatTool {
  return {
    name: "searchRecords",
    description: `Full-text search across records. Available tables: ${allowedTables.join(
      ", "
    )}`,
    parameters: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "The table to search",
          enum: allowedTables,
        },
        query: {
          type: "string",
          description: "The search query",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 10)",
        },
      },
      required: ["table", "query"],
    },
    handler,
  };
}
