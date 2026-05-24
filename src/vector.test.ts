import { describe, expect, it } from "vitest";
import { defineVectorSearchTool } from "./vector";

describe("vector helpers", () => {
  it("marks vector search tools as semantic search without claiming the standard result contract", () => {
    const tool = defineVectorSearchTool({
      name: "semanticSearchRecords",
      description: "Search records by semantic relevance.",
      handler: "handler_string",
    });

    expect(tool).toMatchObject({
      handlerType: "action",
      metadata: {
        kind: "semantic_search",
      },
    });
    expect(tool.metadata).not.toHaveProperty("resultContract");
  });
});
