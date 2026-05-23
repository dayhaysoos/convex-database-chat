/// <reference types="vite/client" />
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  booleanFilter,
  definePaginatedListTool,
  formatToolsForLLM,
  findTool,
  validateToolArgs,
  createQueryTableTool,
  createCountTool,
  createAggregateTool,
  createSearchTool,
  defineCountTool,
  enumFilter,
  injectedString,
  numberFilter,
  defineSemanticSearchTool,
  stringFilter,
  type DatabaseChatTool,
  type InferToolHandlerArgs,
  type InferToolModelArgs,
  type InferToolResult,
} from "./tools";
import type { DatabaseChatToolResult } from "./resultContract";

describe("tools", () => {
  const sampleTool: DatabaseChatTool = {
    name: "searchApplications",
    description: "Search applications by skill",
    parameters: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Skill to search for" },
        limit: { type: "number", description: "Max results" },
        status: {
          type: "string",
          description: "Status filter",
          enum: ["pending", "reviewed", "hired"],
        },
      },
      required: ["skill"],
    },
    handler: "function_handle_string",
  };

  describe("formatToolsForLLM", () => {
    it("formats tools for OpenAI function calling", () => {
      const formatted = formatToolsForLLM([sampleTool]);

      expect(formatted).toHaveLength(1);
      expect(formatted[0]).toEqual({
        type: "function",
        function: {
          name: "searchApplications",
          description: "Search applications by skill",
          parameters: sampleTool.parameters,
        },
      });
    });

    it("handles empty tools array", () => {
      const formatted = formatToolsForLLM([]);
      expect(formatted).toEqual([]);
    });
  });

  describe("findTool", () => {
    it("finds a tool by name", () => {
      const found = findTool([sampleTool], "searchApplications");
      expect(found).toEqual(sampleTool);
    });

    it("returns undefined for unknown tool", () => {
      const found = findTool([sampleTool], "unknownTool");
      expect(found).toBeUndefined();
    });
  });

  describe("validateToolArgs", () => {
    it("validates required fields", () => {
      const error = validateToolArgs(sampleTool, {});
      expect(error).toBe("Missing required field: skill");
    });

    it("passes valid args", () => {
      const error = validateToolArgs(sampleTool, { skill: "JavaScript" });
      expect(error).toBeNull();
    });

    it("validates field types", () => {
      const error = validateToolArgs(sampleTool, { skill: "JavaScript", limit: "not a number" });
      expect(error).toBe("Field limit expected number, got string");
    });

    it("validates enum values", () => {
      const error = validateToolArgs(sampleTool, { skill: "JavaScript", status: "invalid" });
      expect(error).toBe("Field status must be one of: pending, reviewed, hired");
    });

    it("allows extra fields", () => {
      const error = validateToolArgs(sampleTool, { skill: "JavaScript", extraField: "value" });
      expect(error).toBeNull();
    });

    it("rejects top-level extra fields when additionalProperties is false", () => {
      const closedTool: DatabaseChatTool = {
        ...sampleTool,
        parameters: {
          ...sampleTool.parameters,
          additionalProperties: false,
        },
      };

      const error = validateToolArgs(closedTool, {
        skill: "JavaScript",
        extraField: "value",
      });

      expect(error).toBe("Unknown field: extraField");
    });

    it("allows null for optional fields", () => {
      const error = validateToolArgs(sampleTool, { skill: "JavaScript", limit: null });
      expect(error).toBeNull();
    });

    it("allows null for optional enum fields", () => {
      const error = validateToolArgs(sampleTool, {
        skill: "JavaScript",
        status: null,
      });
      expect(error).toBeNull();
    });
  });

  describe("createQueryTableTool", () => {
    it("creates a query table tool with allowed tables", () => {
      const tool = createQueryTableTool(
        ["applications", "jobs"],
        "handler_string"
      );

      expect(tool.name).toBe("queryTable");
      expect(tool.description).toContain("applications, jobs");
      expect(tool.parameters.properties.table.enum).toEqual([
        "applications",
        "jobs",
      ]);
      expect(tool.handler).toBe("handler_string");
    });
  });

  describe("createCountTool", () => {
    it("creates a count tool with allowed tables", () => {
      const tool = createCountTool(["applications", "jobs"], "handler_string");

      expect(tool.name).toBe("countRecords");
      expect(tool.description).toContain("applications, jobs");
      expect(tool.parameters.properties.table.enum).toEqual([
        "applications",
        "jobs",
      ]);
    });
  });

  describe("createAggregateTool", () => {
    it("creates an aggregate tool", () => {
      const tool = createAggregateTool(
        ["applications", "analysis"],
        "handler_string"
      );

      expect(tool.name).toBe("aggregate");
      expect(tool.parameters.properties.operation.enum).toEqual([
        "sum",
        "avg",
        "min",
        "max",
        "count",
      ]);
    });
  });

  describe("createSearchTool", () => {
    it("creates a search tool", () => {
      const tool = createSearchTool(["applications"], "handler_string");

      expect(tool.name).toBe("searchRecords");
      expect(tool.parameters.properties.query.type).toBe("string");
      expect(tool.parameters.required).toContain("query");
    });
  });

  describe("typed tool builders", () => {
    it("defines a count tool with nested app-owned filters and standard metadata", () => {
      const tool = defineCountTool({
        name: "countRecords",
        description: "Count records matching filters.",
        handler: "handler_string",
        filters: {
          status: enumFilter({
            values: ["active", "inactive"] as const,
            description: "Record status.",
            required: true,
          }),
          owner: stringFilter({ description: "Owner name." }),
        },
      });

      expect(tool).toMatchObject({
        name: "countRecords",
        description: "Count records matching filters.",
        handler: "handler_string",
        metadata: {
          kind: "count",
          resultContract: "standard",
        },
      });
      expect(tool.parameters.required).toEqual(["filters"]);
      expect(tool.parameters.properties).not.toHaveProperty("limit");
      expect(tool.parameters.properties.filters).toMatchObject({
        type: "object",
        required: ["status"],
        properties: {
          status: {
            type: "string",
            enum: ["active", "inactive"],
            description: "Record status.",
          },
          owner: {
            type: "string",
            description: "Owner name.",
          },
        },
      });

      expect(validateToolArgs(tool, { filters: { owner: "alice" } })).toBe(
        "Missing required field: filters.status"
      );
      expect(
        validateToolArgs(tool, {
          filters: { status: 123, owner: "alice" },
        })
      ).toBe("Field filters.status expected string, got number");
      expect(
        validateToolArgs(tool, {
          filters: { status: "active", unexpected: "value" },
        })
      ).toBe("Unknown field: filters.unexpected");
    });

    it("defines a paginated list tool with default cursor args and typed injected args", () => {
      type RecordRow = { id: string; title: string };

      const tool = definePaginatedListTool<RecordRow>({
        name: "listRecords",
        description: "List records matching deterministic filters.",
        handler: "handler_string",
        filters: {
          createdAfter: numberFilter({
            min: 0,
            description: "Only include records after this timestamp.",
          }),
          archived: booleanFilter({ description: "Whether the row is archived." }),
        },
        injectedArgs: {
          tenantId: injectedString({
            description: "Current tenant id, injected by the app.",
          }),
        },
        pagination: {
          defaultLimit: 25,
          maxLimit: 75,
        },
      });

      expect(tool.metadata).toEqual({
        kind: "paginated_list",
        resultContract: "standard",
      });
      expect(tool.parameters.properties).toHaveProperty("filters");
      expect(tool.parameters.properties).toHaveProperty("cursor");
      expect(tool.parameters.properties).toHaveProperty("limit");
      expect(tool.parameters.properties).not.toHaveProperty("tenantId");
      expect(tool.parameters.properties.limit).toMatchObject({
        type: "number",
        maximum: 75,
      });
      expect(tool.parameters.properties.limit.description).toContain(
        "default: 25, max: 75"
      );
      expect(validateToolArgs(tool, { limit: 76 })).toBe(
        "Field limit must be <= 75"
      );
      expect(
        validateToolArgs(tool, { filters: { createdAfter: -1 } })
      ).toBe("Field filters.createdAfter must be >= 0");

      type ModelArgs = InferToolModelArgs<typeof tool>;
      type HandlerArgs = InferToolHandlerArgs<typeof tool>;
      type Result = InferToolResult<typeof tool>;

      expectTypeOf<ModelArgs>().toEqualTypeOf<{
        filters?: {
          createdAfter?: number;
          archived?: boolean;
        };
        limit?: number;
        cursor?: string;
      }>();
      expectTypeOf<HandlerArgs>().toEqualTypeOf<{
        filters?: {
          createdAfter?: number;
          archived?: boolean;
        };
        limit?: number;
        cursor?: string;
        tenantId: string;
      }>();
      expectTypeOf<Result>().toEqualTypeOf<DatabaseChatToolResult<RecordRow>>();
    });

    it("defines a semantic search tool as sampled top-K with query and conservative limits", () => {
      const tool = defineSemanticSearchTool<{ id: string }>({
        name: "semanticSearchRecords",
        description: "Find records by semantic relevance.",
        handler: "handler_string",
        filters: {
          status: stringFilter(),
        },
      });

      expect(tool.metadata).toEqual({
        kind: "semantic_search",
        resultContract: "standard",
      });
      expect(tool.parameters.required).toEqual(["query"]);
      expect(tool.parameters.properties.query).toMatchObject({
        type: "string",
      });
      expect(tool.parameters.properties.filters).toMatchObject({
        type: "object",
        properties: {
          status: { type: "string" },
        },
      });
      expect(tool.parameters.properties.limit).toMatchObject({
        type: "number",
        maximum: 50,
      });
      expect(tool.parameters.properties.limit.description).toContain(
        "default: 10, max: 50"
      );
    });
  });
});
