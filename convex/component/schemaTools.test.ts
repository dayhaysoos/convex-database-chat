/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import {
  generateToolsFromSchema,
  defineTable,
  type TableInfo,
  type SchemaToolHandlers,
} from "./schemaTools";

describe("schemaTools", () => {
  const sampleTable: TableInfo = {
    name: "applications",
    fields: [
      { name: "_id", type: "id", optional: false },
      { name: "_creationTime", type: "number", optional: false },
      { name: "candidateName", type: "string", optional: false },
      { name: "email", type: "string", optional: false },
      { name: "score", type: "number", optional: true },
      { name: "status", type: "string", optional: false },
    ],
    indexes: [],
    searchIndexes: [],
  };

  const handlers: SchemaToolHandlers = {
    query: "query_handler",
    count: "count_handler",
    aggregate: "aggregate_handler",
    search: "search_handler",
    getById: "getById_handler",
  };

  describe("generateToolsFromSchema", () => {
    it("generates query and count tools for each allowed table", () => {
      const tools = generateToolsFromSchema({
        tables: [sampleTable],
        allowedTables: ["applications"],
        handlers: { query: "q", count: "c" },
      });

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual([
        "query_applications",
        "count_applications",
      ]);
    });

    it("generates aggregate tool when handler provided", () => {
      const tools = generateToolsFromSchema({
        tables: [sampleTable],
        allowedTables: ["applications"],
        handlers: { query: "q", count: "c", aggregate: "a" },
      });

      expect(tools).toHaveLength(3);
      expect(tools.some((t) => t.name === "aggregate_applications")).toBe(true);
    });

    it("generates getById tool when handler provided", () => {
      const tools = generateToolsFromSchema({
        tables: [sampleTable],
        allowedTables: ["applications"],
        handlers: { query: "q", count: "c", getById: "g" },
      });

      expect(tools).toHaveLength(3);
      expect(tools.some((t) => t.name === "get_applications_by_id")).toBe(true);
    });

    it("generates search tool only for tables with search indexes", () => {
      const tableWithSearch: TableInfo = {
        ...sampleTable,
        searchIndexes: [
          {
            name: "search_applications",
            searchField: "candidateName",
            filterFields: [],
          },
        ],
      };

      const tools = generateToolsFromSchema({
        tables: [tableWithSearch],
        allowedTables: ["applications"],
        handlers: { query: "q", count: "c", search: "s" },
      });

      expect(tools.some((t) => t.name === "search_applications")).toBe(true);
    });

    it("does not generate search tool for tables without search indexes", () => {
      const tools = generateToolsFromSchema({
        tables: [sampleTable], // No search index
        allowedTables: ["applications"],
        handlers: { query: "q", count: "c", search: "s" },
      });

      expect(tools.some((t) => t.name === "search_applications")).toBe(false);
    });

    it("only generates tools for allowed tables", () => {
      const jobsTable: TableInfo = {
        name: "jobs",
        fields: [{ name: "_id", type: "id", optional: false }],
        indexes: [],
        searchIndexes: [],
      };

      const tools = generateToolsFromSchema({
        tables: [sampleTable, jobsTable],
        allowedTables: ["applications"], // Only applications allowed
        handlers: { query: "q", count: "c" },
      });

      expect(tools.every((t) => t.name.includes("applications"))).toBe(true);
      expect(tools.every((t) => !t.name.includes("jobs"))).toBe(true);
    });

    it("uses custom table descriptions", () => {
      const tools = generateToolsFromSchema({
        tables: [sampleTable],
        allowedTables: ["applications"],
        handlers: { query: "q", count: "c" },
        tableDescriptions: {
          applications: "Candidate job applications with status tracking",
        },
      });

      const queryTool = tools.find((t) => t.name === "query_applications");
      expect(queryTool?.description).toBe(
        "Candidate job applications with status tracking"
      );
    });
  });

  describe("defineTable", () => {
    it("creates TableInfo with default fields", () => {
      const table = defineTable("users", [
        { name: "email", type: "string" },
        { name: "age", type: "number", optional: true },
      ]);

      expect(table.name).toBe("users");
      expect(table.fields).toHaveLength(4); // _id, _creationTime, email, age
      expect(table.fields[0].name).toBe("_id");
      expect(table.fields[1].name).toBe("_creationTime");
      expect(table.fields[2]).toEqual({
        name: "email",
        type: "string",
        optional: false,
        description: undefined,
      });
      expect(table.fields[3].optional).toBe(true);
    });

    it("creates TableInfo with search index", () => {
      const table = defineTable(
        "articles",
        [{ name: "title", type: "string" }],
        { searchIndex: { field: "title", filterFields: ["status"] } }
      );

      expect(table.searchIndexes).toHaveLength(1);
      expect(table.searchIndexes[0]).toEqual({
        name: "search_articles",
        searchField: "title",
        filterFields: ["status"],
      });
    });
  });
});

