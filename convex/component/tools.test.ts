/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import {
  formatToolsForLLM,
  findTool,
  validateToolArgs,
  createQueryTableTool,
  createCountTool,
  createAggregateTool,
  createSearchTool,
  type DatabaseChatTool,
} from "./tools";

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

    it("allows null for optional fields", () => {
      const error = validateToolArgs(sampleTool, { skill: "JavaScript", limit: null });
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
});

