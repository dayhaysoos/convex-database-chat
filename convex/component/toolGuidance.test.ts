/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  buildSystemPromptWithTools,
  buildToolReliabilityGuidance,
} from "./toolGuidance";
import {
  defineCountTool,
  definePaginatedListTool,
  defineSemanticSearchTool,
  type DatabaseChatTool,
} from "./tools";

describe("tool guidance", () => {
  it("generates reliability guidance from tool metadata kinds", () => {
    const tools = [
      defineCountTool({
        name: "countRecords",
        description: "Count records.",
        handler: "count_handler",
      }),
      definePaginatedListTool({
        name: "listRecords",
        description: "List records.",
        handler: "list_handler",
      }),
      defineSemanticSearchTool({
        name: "semanticSearchRecords",
        description: "Find semantically relevant records.",
        handler: "semantic_handler",
      }),
      {
        name: "rawTool",
        description: "Raw app-owned tool.",
        parameters: { type: "object", properties: {} },
        handler: "raw_handler",
      } satisfies DatabaseChatTool,
    ];

    const guidance = buildToolReliabilityGuidance(tools);

    expect(guidance).toContain("Use count tools");
    expect(guidance).toContain("meta.count");
    expect(guidance).toContain("Paginated list tools");
    expect(guidance).toContain("meta.pagination.nextCursor");
    expect(guidance).toContain("Semantic search tools");
    expect(guidance).toContain("Do not use semantic search result length");
    expect(guidance).toContain("Tools without metadata");
    expect(guidance).toContain("result metadata for that specific call is authoritative");
  });

  it("appends automatic, disabled, or custom guidance to the system prompt", () => {
    const tools = [
      defineCountTool({
        name: "countRecords",
        description: "Count records.",
        handler: "count_handler",
      }),
    ];

    const automatic = buildSystemPromptWithTools("Base prompt.", tools);
    expect(automatic).toContain("You have access to the following tools");
    expect(automatic).toContain("- countRecords: Count records.");
    expect(automatic).toContain("Tool result reliability:");

    const disabled = buildSystemPromptWithTools("Base prompt.", tools, {
      toolGuidance: "disabled",
    });
    expect(disabled).toContain("- countRecords: Count records.");
    expect(disabled).not.toContain("Tool result reliability:");

    const custom = buildSystemPromptWithTools("Base prompt.", tools, {
      toolGuidance: "Always mention exact scope labels.",
    });
    expect(custom).toContain("Always mention exact scope labels.");
    expect(custom).not.toContain("Tool result reliability:");
  });
});
