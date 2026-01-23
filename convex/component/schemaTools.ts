/**
 * Schema introspection for auto-generating tools.
 *
 * Automatically creates query tools from your Convex schema.
 *
 * @example
 * ```typescript
 * import schema from "./schema";
 * import { generateToolsFromSchema } from "./schemaTools";
 *
 * const tools = generateToolsFromSchema({
 *   schema,
 *   allowedTables: ["applications", "jobs"],
 *   excludeFields: { applications: ["ssn"] },
 *   handlers: {
 *     query: queryHandleString,
 *     count: countHandleString,
 *     aggregate: aggregateHandleString,
 *   }
 * });
 * ```
 */

import type { DatabaseChatTool, AutoToolsConfig } from "./tools";

// =============================================================================
// Types
// =============================================================================

/**
 * Simplified schema info extracted from Convex schema.
 */
export interface TableInfo {
  name: string;
  fields: FieldInfo[];
  indexes: IndexInfo[];
  searchIndexes: SearchIndexInfo[];
}

export interface FieldInfo {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object" | "id" | "unknown";
  optional: boolean;
  description?: string;
}

export interface IndexInfo {
  name: string;
  fields: string[];
}

export interface SearchIndexInfo {
  name: string;
  searchField: string;
  filterFields: string[];
}

/**
 * Handler function strings for generated tools.
 */
export interface SchemaToolHandlers {
  /** Handler for queryTable tool */
  query: string;
  /** Handler for countRecords tool */
  count: string;
  /** Handler for aggregate tool (optional) */
  aggregate?: string;
  /** Handler for searchRecords tool (optional) */
  search?: string;
  /** Handler for getById tool (optional) */
  getById?: string;
}

export interface GenerateToolsOptions extends AutoToolsConfig {
  /** Table information (extracted from schema) */
  tables: TableInfo[];
  /** Function handle strings for each tool type */
  handlers: SchemaToolHandlers;
}

// =============================================================================
// Schema Extraction Helpers
// =============================================================================

/**
 * Map Convex validator types to JSON Schema types.
 */
function _convexTypeToJsonType(
  convexType: string
): "string" | "number" | "boolean" | "array" | "object" {
  const typeMap: Record<string, "string" | "number" | "boolean" | "array" | "object"> = {
    string: "string",
    number: "number",
    float64: "number",
    int64: "number",
    boolean: "boolean",
    array: "array",
    object: "object",
    id: "string", // IDs are strings externally
    bytes: "string",
    null: "string",
  };
  return typeMap[convexType] || "string";
}

/**
 * Extract table info from schema definition.
 * Note: This is a simplified extraction - full schema parsing would need
 * access to the actual validator internals.
 */
export function extractTableInfo(
  tableName: string,
  tableDefinition: unknown,
  config: Pick<AutoToolsConfig, "excludeFields" | "fieldDescriptions">
): TableInfo {
  const excludedFields = config.excludeFields?.[tableName] || [];

  // Default fields that exist on all documents
  const defaultFields: FieldInfo[] = [
    { name: "_id", type: "id", optional: false, description: "Document ID" },
    {
      name: "_creationTime",
      type: "number",
      optional: false,
      description: "Creation timestamp",
    },
  ];

  // Try to extract fields from the table definition
  // This is a simplified approach - real implementation would need
  // to introspect the validator
  const fields: FieldInfo[] = [...defaultFields];

  // Filter out excluded fields
  const filteredFields = fields.filter((f) => !excludedFields.includes(f.name));

  // Add custom descriptions
  for (const field of filteredFields) {
    const descKey = `${tableName}.${field.name}`;
    if (config.fieldDescriptions?.[descKey]) {
      field.description = config.fieldDescriptions[descKey];
    }
  }

  return {
    name: tableName,
    fields: filteredFields,
    indexes: [],
    searchIndexes: [],
  };
}

// =============================================================================
// Tool Generation
// =============================================================================

/**
 * Generate a query tool for a specific table.
 */
function generateQueryTool(
  table: TableInfo,
  handler: string,
  tableDescription?: string
): DatabaseChatTool {
  const fieldNames = table.fields.map((f) => f.name);
  const description =
    tableDescription ||
    `Query the ${table.name} table. Available fields: ${fieldNames.join(", ")}`;

  return {
    name: `query_${table.name}`,
    description,
    parameters: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description: `Filter by field values. Available fields: ${fieldNames.join(", ")}`,
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10, max: 100)",
        },
        orderBy: {
          type: "string",
          description: "Field to order results by",
          enum: fieldNames,
        },
        order: {
          type: "string",
          description: "Sort order",
          enum: ["asc", "desc"],
        },
      },
      required: [],
    },
    handler,
  };
}

/**
 * Generate a count tool for a specific table.
 */
function generateCountTool(
  table: TableInfo,
  handler: string
): DatabaseChatTool {
  const fieldNames = table.fields.map((f) => f.name);

  return {
    name: `count_${table.name}`,
    description: `Count records in the ${table.name} table with optional filters.`,
    parameters: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description: `Filter by field values. Available fields: ${fieldNames.join(", ")}`,
        },
      },
      required: [],
    },
    handler,
  };
}

/**
 * Generate an aggregate tool for a specific table.
 */
function generateAggregateTool(
  table: TableInfo,
  handler: string
): DatabaseChatTool {
  const numericFields = table.fields
    .filter((f) => f.type === "number")
    .map((f) => f.name);

  return {
    name: `aggregate_${table.name}`,
    description: `Calculate aggregations on ${table.name}. Numeric fields: ${numericFields.join(", ") || "none"}`,
    parameters: {
      type: "object",
      properties: {
        field: {
          type: "string",
          description: "The field to aggregate",
          enum: numericFields.length > 0 ? numericFields : undefined,
        },
        operation: {
          type: "string",
          description: "Aggregation operation",
          enum: ["sum", "avg", "min", "max", "count"],
        },
        filters: {
          type: "object",
          description: "Optional filters before aggregating",
        },
      },
      required: ["operation"],
    },
    handler,
  };
}

/**
 * Generate a search tool for a table with a search index.
 */
function generateSearchTool(
  table: TableInfo,
  handler: string
): DatabaseChatTool | null {
  if (table.searchIndexes.length === 0) {
    return null;
  }

  const searchIndex = table.searchIndexes[0];

  return {
    name: `search_${table.name}`,
    description: `Full-text search in ${table.name} on the "${searchIndex.searchField}" field.`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 10)",
        },
      },
      required: ["query"],
    },
    handler,
  };
}

/**
 * Generate a getById tool for a specific table.
 */
function generateGetByIdTool(
  table: TableInfo,
  handler: string
): DatabaseChatTool {
  return {
    name: `get_${table.name}_by_id`,
    description: `Get a single ${table.name} record by its ID.`,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: `The document ID`,
        },
      },
      required: ["id"],
    },
    handler,
  };
}

// =============================================================================
// Main Generation Function
// =============================================================================

/**
 * Generate tools from schema configuration.
 */
export function generateToolsFromSchema(
  options: GenerateToolsOptions
): DatabaseChatTool[] {
  const {
    tables,
    allowedTables,
    excludeFields: _excludeFields,
    tableDescriptions,
    handlers,
  } = options;

  const tools: DatabaseChatTool[] = [];

  // Filter to only allowed tables
  const filteredTables = tables.filter((t) => allowedTables.includes(t.name));

  for (const table of filteredTables) {
    // Query tool (always)
    tools.push(
      generateQueryTool(table, handlers.query, tableDescriptions?.[table.name])
    );

    // Count tool (always)
    tools.push(generateCountTool(table, handlers.count));

    // Aggregate tool (if handler provided)
    if (handlers.aggregate) {
      tools.push(generateAggregateTool(table, handlers.aggregate));
    }

    // Search tool (if handler provided and table has search index)
    if (handlers.search) {
      const searchTool = generateSearchTool(table, handlers.search);
      if (searchTool) {
        tools.push(searchTool);
      }
    }

    // GetById tool (if handler provided)
    if (handlers.getById) {
      tools.push(generateGetByIdTool(table, handlers.getById));
    }
  }

  return tools;
}

/**
 * Helper to create a simple table info for manual configuration.
 * Use this when you want auto-tools but don't want to parse the full schema.
 */
export function defineTable(
  name: string,
  fields: Array<{
    name: string;
    type: FieldInfo["type"];
    optional?: boolean;
    description?: string;
  }>,
  options?: {
    searchIndex?: { field: string; filterFields?: string[] };
  }
): TableInfo {
  return {
    name,
    fields: [
      { name: "_id", type: "id", optional: false },
      { name: "_creationTime", type: "number", optional: false },
      ...fields.map((f) => ({
        name: f.name,
        type: f.type,
        optional: f.optional ?? false,
        description: f.description,
      })),
    ],
    indexes: [],
    searchIndexes: options?.searchIndex
      ? [
          {
            name: `search_${name}`,
            searchField: options.searchIndex.field,
            filterFields: options.searchIndex.filterFields || [],
          },
        ]
      : [],
  };
}

