/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  isDatabaseChatToolResult,
  shapeToolResult,
  validateToolResultContract,
  type DatabaseChatToolResult,
} from "./resultContract";

describe("result contract", () => {
  it("accepts a count-only result with an exact count and no rows", () => {
    const result: DatabaseChatToolResult = {
      data: [],
      meta: {
        scope: { type: "workspace", id: "workspace_123" },
        appliedFilters: { status: "active" },
        count: 200,
        returned: 0,
        exhaustive: true,
        truncated: false,
        sampled: false,
      },
    };

    expect(validateToolResultContract(result)).toEqual([]);
    expect(isDatabaseChatToolResult(result)).toBe(true);
  });

  it("rejects a result whose returned count does not match data length", () => {
    const errors = validateToolResultContract({
      data: [{ id: "record_1" }],
      meta: {
        scope: { type: "workspace" },
        returned: 2,
        exhaustive: true,
        truncated: false,
        sampled: false,
      },
    });

    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "returned_mismatch",
        path: "$.meta.returned",
      })
    );
    expect(
      isDatabaseChatToolResult({
        data: [{ id: "record_1" }],
        meta: {
          scope: { type: "workspace" },
          returned: 2,
          exhaustive: true,
          truncated: false,
          sampled: false,
        },
      })
    ).toBe(false);
  });

  it("accepts a deterministic first page with an exact count and next cursor", () => {
    const result: DatabaseChatToolResult<{ id: string }> = {
      data: Array.from({ length: 20 }, (_, index) => ({
        id: `record_${index + 1}`,
      })),
      meta: {
        scope: { type: "workspace", label: "Example Workspace" },
        appliedFilters: { status: "active" },
        count: 200,
        returned: 20,
        exhaustive: false,
        truncated: true,
        truncationReason: "row_limit",
        sampled: false,
        pagination: {
          cursor: null,
          hasMore: true,
          nextCursor: "cursor_2",
          pageSize: 20,
        },
      },
    };

    expect(validateToolResultContract(result)).toEqual([]);
  });

  it("accepts semantic top-K results as sampled results without count", () => {
    const result: DatabaseChatToolResult<{ id: string; score: number }> = {
      data: [{ id: "record_1", score: 0.92 }],
      meta: {
        scope: { type: "workspace" },
        appliedFilters: { query: "database reliability" },
        returned: 1,
        exhaustive: false,
        truncated: true,
        truncationReason: "semantic_top_k_limit",
        sampled: true,
        sampleMethod: "semantic_top_k",
      },
    };

    expect(validateToolResultContract(result)).toEqual([]);
  });

  it("returns all contract errors for contradictory metadata", () => {
    const errors = validateToolResultContract({
      data: [{ id: "record_1" }],
      meta: {
        scope: { type: "workspace" },
        count: 10,
        returned: 1,
        exhaustive: true,
        truncated: true,
        sampled: true,
        pagination: { hasMore: true },
      },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "sampled_exhaustive_conflict" }),
        expect.objectContaining({ code: "sampled_count_conflict" }),
        expect.objectContaining({ code: "pagination_sampled_conflict" }),
        expect.objectContaining({ code: "pagination_cursor_required" }),
        expect.objectContaining({ code: "pagination_exhaustive_conflict" }),
        expect.objectContaining({ code: "exhaustive_truncated_conflict" }),
        expect.objectContaining({ code: "missing_truncation_reason" }),
        expect.objectContaining({ code: "missing_sample_method" }),
      ])
    );
  });

  it("rejects invalid optional metadata shapes without validating app semantics", () => {
    const errors = validateToolResultContract({
      data: [],
      meta: {
        scope: { type: "", id: "", label: "" },
        appliedFilters: [],
        returned: 0,
        count: -1,
        exhaustive: false,
        truncated: false,
        truncationReason: "",
        sampled: false,
        sampleMethod: "",
        pagination: {
          cursor: 123,
          hasMore: false,
          nextCursor: "",
          pageSize: 1.5,
        },
      },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_scope" }),
        expect.objectContaining({ code: "invalid_scope_id" }),
        expect.objectContaining({ code: "invalid_scope_label" }),
        expect.objectContaining({ code: "invalid_applied_filters" }),
        expect.objectContaining({ code: "invalid_count" }),
        expect.objectContaining({ code: "invalid_truncation_reason" }),
        expect.objectContaining({ code: "invalid_sample_method" }),
        expect.objectContaining({ code: "invalid_pagination_cursor" }),
        expect.objectContaining({ code: "invalid_pagination_next_cursor" }),
        expect.objectContaining({ code: "invalid_pagination_page_size" }),
      ])
    );
  });
});

describe("shapeToolResult", () => {
  const conformingResult: DatabaseChatToolResult = {
    data: [{ id: "record_1" }],
    meta: {
      scope: { type: "workspace", id: "workspace_123" },
      returned: 1,
      exhaustive: true,
      truncated: false,
      sampled: false,
    },
  };
  const violatingResult = {
    data: [{ id: "record_1" }],
    meta: { returned: 5, exhaustive: true, truncated: false, sampled: false },
  };
  const standardTool = {
    name: "listProducts",
    metadata: { resultContract: "standard" as const },
  };
  const rawTool = { name: "rawSearch" };

  it("passes results through for tools without the standard marker", () => {
    const shaped = shapeToolResult(rawTool, violatingResult, {
      validation: "enforce",
      maxChars: 16000,
    });

    expect(shaped.toolResult).toBe(JSON.stringify(violatingResult));
    expect(shaped.record).toBe(violatingResult);
    expect(shaped.violation).toBeUndefined();
  });

  it("passes conforming standard results through unchanged", () => {
    const shaped = shapeToolResult(standardTool, conformingResult, {
      validation: "enforce",
      maxChars: 16000,
    });

    expect(shaped.toolResult).toBe(JSON.stringify(conformingResult));
    expect(shaped.record).toBe(conformingResult);
    expect(shaped.violation).toBeUndefined();
  });

  it("skips validation entirely in off mode", () => {
    const shaped = shapeToolResult(standardTool, violatingResult, {
      validation: "off",
      maxChars: 16000,
    });

    expect(shaped.violation).toBeUndefined();
    expect(shaped.toolResult).toBe(JSON.stringify(violatingResult));
  });

  it("enforce replaces a violating result with a capped error envelope", () => {
    const shaped = shapeToolResult(standardTool, violatingResult, {
      validation: "enforce",
      maxChars: 16000,
    });

    const parsed = JSON.parse(shaped.toolResult);
    expect(parsed.error).toContain("standard result contract");
    expect(parsed.contractErrors.length).toBeGreaterThan(0);
    expect(shaped.record).toEqual({
      contractErrors: expect.any(Array),
    });
  });

  it("caps the enforce error envelope when maxChars is tiny", () => {
    const shaped = shapeToolResult(standardTool, violatingResult, {
      validation: "enforce",
      maxChars: 10,
    });

    const parsed = JSON.parse(shaped.toolResult);
    expect(parsed.truncated).toBe(true);
    expect(parsed.data.length).toBe(10);
  });

  it("warn keeps the raw result but reports the violation", () => {
    const shaped = shapeToolResult(standardTool, violatingResult, {
      validation: "warn",
      maxChars: 16000,
    });

    expect(shaped.toolResult).toBe(JSON.stringify(violatingResult));
    expect(shaped.record).toBe(violatingResult);
    expect(shaped.violation?.message).toContain("listProducts");
    expect(shaped.violation?.errors.length).toBeGreaterThan(0);
  });
});
