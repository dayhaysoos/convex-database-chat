import type { DatabaseChatTool, DatabaseChatToolKind } from "./tools";

export type ToolGuidanceOption = "auto" | "disabled" | (string & {});

export function getToolKind(tool: DatabaseChatTool): DatabaseChatToolKind {
  return tool.metadata?.kind ?? "unknown";
}

export function buildToolReliabilityGuidance(
  tools: DatabaseChatTool[]
): string {
  if (tools.length === 0) {
    return "";
  }

  const kinds = new Set<DatabaseChatToolKind>(tools.map(getToolKind));
  const lines: string[] = [];

  if (kinds.has("count")) {
    lines.push(
      "- Use count tools for factual total/count questions. Prefer `meta.count` when present."
    );
  }

  if (kinds.has("paginated_list")) {
    lines.push(
      "- Paginated list tools return deterministic rows, but may only return one page. If `meta.pagination.hasMore` is true, say that more results are available."
    );
    lines.push(
      "- When the user asks for more results from a paginated list, call the same tool again with the previous `meta.pagination.nextCursor` and the same relevant filters."
    );
  }

  if (kinds.has("semantic_search")) {
    lines.push(
      "- Semantic search tools return sampled top-K relevance results. Do not use semantic search result length as a factual count."
    );
  }

  if (kinds.has("unknown")) {
    lines.push(
      "- Tools without metadata may be incomplete, sampled, or app-specific. Do not infer totals from returned row count unless the result explicitly includes `meta.count`."
    );
  }

  lines.push(
    "- For any standard result contract, the result metadata for that specific call is authoritative. Do not infer totals from `data.length` when `meta.sampled`, `meta.truncated`, or `meta.exhaustive === false`."
  );

  return `Tool result reliability:\n\n${lines.join("\n")}`;
}

export function buildSystemPromptWithTools(
  basePrompt: string,
  tools: DatabaseChatTool[],
  options?: { toolGuidance?: ToolGuidanceOption }
): string {
  if (tools.length === 0) {
    return basePrompt;
  }

  const sections = [
    basePrompt,
    buildToolDescriptionSection(tools),
    resolveToolGuidance(tools, options?.toolGuidance),
  ].filter((section) => section.trim().length > 0);

  return sections.join("\n\n");
}

export function buildToolDescriptionSection(
  tools: DatabaseChatTool[]
): string {
  const toolDescriptions = tools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");

  return `You have access to the following tools to query the database:\n${toolDescriptions}\n\nUse these tools to answer questions about the data. You can call multiple tools if needed.`;
}

export function resolveToolGuidance(
  tools: DatabaseChatTool[],
  toolGuidance: ToolGuidanceOption | undefined
): string {
  if (toolGuidance === "disabled") {
    return "";
  }

  if (toolGuidance && toolGuidance !== "auto") {
    return toolGuidance;
  }

  return buildToolReliabilityGuidance(tools);
}
