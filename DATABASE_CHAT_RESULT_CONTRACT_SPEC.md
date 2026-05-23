# Convex Database Chat Result Contracts

## Context

This spec captures a proposed upstream feature for Convex Database Chat. It is motivated by a generic failure mode observed in downstream apps: users ask factual questions that combine totals, filtered lists, and follow-up pagination.

- "How many records match this filter?"
- "Show me the matching records."
- "Show me more."

The failure mode is that an LLM may confuse a limited list, semantic top-N result, or capped scan with a complete answer. Convex Database Chat can reduce this risk by standardizing result metadata and generic prompt behavior, while each app still owns its domain-specific queries and privacy rules.

Domain-specific examples in this document are non-normative. The library should not know about any particular downstream product, schema, workflow, or business object.

## Goal

Add a standard result contract for tool outputs so the model can distinguish:

- A deterministic count from a page of rows.
- A complete row set from a paginated subset.
- A deterministic page from a semantic/vector sample.
- A broad answer from a narrower scoped answer.

This is especially important when a user asks for both a count and a list. For example, if there are 200 matching records for a normalized location filter, the assistant should be able to say:

> There are 200 matching records for Boston, MA. Here are the first 20.

Then, if the user asks "show me more," the assistant should call the same paginated list tool with the returned cursor.

## Non-Goals

Convex Database Chat should not implement app-specific data access.

For any app, the app still owns:

- The Convex queries over its own tables.
- Auth and app-owned scope enforcement.
- Domain-specific normalization and matching.
- Privacy filtering and safe row shapes.
- Index choices and sort order.
- Which tools are exposed to the model.

The library should own the shared contract, tool-builder ergonomics, and generic prompt rules for interpreting metadata.

## Result Shape

Proposed tool output shape:

```ts
type DatabaseChatToolResult<Row = unknown> = {
  data: Row[];
  meta: DatabaseChatResultMeta;
};
```

V1 should use this single envelope for count, list, semantic search, and detail-style outputs. Separate top-level result shapes are deferred unless the standard envelope proves ambiguous in real integrations.

## Result Contract Module Scope

The first implementation slice should introduce a narrow result contract module at `convex/component/resultContract.ts`. Its interface should own only the standard result contract types and invariants:

- `DatabaseChatToolResult<Row>`
- `DatabaseChatResultMeta`
- `DatabaseChatScope`
- `DatabaseChatResultValidationError`
- `validateToolResultContract(result)`
- `isDatabaseChatToolResult(result)`

It should not own tool definitions, builder functions, prompt guidance text, cursor session state, app-specific row helpers, or Convex validators for app handlers.

The module should be TypeScript-only in v1. It may expose lightweight runtime validation for plain JSON values, but it should not expose Convex `v` validators. App handlers own any Convex `args` or `returns` validators they need.

Later packaging can decide whether to re-export these types from `src/index.ts` or another public entry. Do not let packaging concerns broaden the module's first interface.

Do not include result constructors in the contract-only slice. Helpers such as `createCountResult`, `createPaginatedListResult`, or `createSemanticSearchResult` belong with typed builders or a later app-facing helper slice if real usage shows they add leverage.

Validation should be non-throwing by default:

```ts
type DatabaseChatResultValidationError = {
  code: string;
  path: string;
  message: string;
};

function validateToolResultContract(
  result: unknown
): DatabaseChatResultValidationError[];

function isDatabaseChatToolResult(
  result: unknown
): result is DatabaseChatToolResult;
```

Returning all structured errors is better for tests and optional future execution checks than throwing on the first issue. The `isDatabaseChatToolResult` type guard should be derived from validation, equivalent to `validateToolResultContract(result).length === 0`, so the module has one definition of validity.

The first slice should export and test validation, but should not call `validateToolResultContract` from `chat.send`, `toolExecution`, or `DatabaseChatClient` execution paths yet. Runtime integration needs separate policy decisions about whether validation failures should be logged, ignored, exposed for debugging, or fail a tool call.

Required invariants:

- `returned` must equal `data.length`.
- `count`, when present, means a known exact count for the same `scope` and `appliedFilters`.
- Approximate counts are out of scope for v1. If an app cannot cheaply provide an exact count, it should omit `count` rather than guess.
- `data` should remain bounded by the tool's `limit` or app-enforced maximum, even when `count` is very large.
- Result metadata is authoritative for the specific call. Tool metadata describes the default expectation for the tool, but prompt guidance should follow `result.meta` when a standard result contract is present.

V1 validation should check only contract-level invariants:

- The result is an object with a `data` array and `meta` object.
- `meta.returned === data.length`.
- `meta.scope` is required and must be an object with non-empty string `type`.
- `count`, when present, is a non-negative safe integer.
- `returned` is a non-negative safe integer.
- `exhaustive`, `truncated`, and `sampled` are booleans.
- `sampled === true` must not also report `exhaustive === true`.
- `sampled === true` must not include `count` in v1.
- `pagination.hasMore === true` requires non-empty `nextCursor`.
- `pagination` is valid only when `sampled === false`.
- `pagination.hasMore === true` must not also report `exhaustive === true`.
- `exhaustive === true` must not also report `truncated === true`.
- `appliedFilters` may be absent; if present, it must be a non-array object.
- `truncationReason` must be present as a non-empty string when `truncated === true`; when `truncated === false`, it may be absent, but if present it must still be non-empty.
- `sampleMethod` must be present as a non-empty string when `sampled === true`; when `sampled === false`, it may be absent, but if present it must still be non-empty.
- `sampled` and `truncated` are independent except that `sampled === true` must not also report `exhaustive === true`.
- `pagination.cursor` may be absent, `null`, or a string.
- `pagination.nextCursor` may be absent or `null` only when `hasMore === false`; it must be a non-empty string when `hasMore === true`.
- `pagination.pageSize` may be absent; if present, it must be a non-negative safe integer.
- `scope.id` and `scope.label` may be absent; if present, they must be non-empty strings.

V1 validation should not check app-owned or semantic facts:

- Whether `count` is actually exact.
- Whether `scope.type` is a known enum.
- Whether `appliedFilters` match the user's words.
- Whether `truncationReason` or `sampleMethod` values are from a fixed enum.
- Whether row fields are safe or complete.

For count-only tools, `data` can be an empty array:

```ts
{
  data: [],
  meta: {
    count: 200,
    returned: 0,
    exhaustive: true,
    truncated: false,
    sampled: false,
    scope: { type: "workspace", id: "workspace_123", label: "Example Workspace" },
    appliedFilters: { location: "Boston, MA" }
  }
}
```

## Metadata Fields

### `scope`

The structured universe the tool queried.

V1 should use an object, not a plain string:

```ts
export type DatabaseChatScope = {
  type: string;
  id?: string;
  label?: string;
};
```

The library should not define or interpret built-in `type` values in v1. Apps own the meaning of scope types, ids, and labels. Apps may use values such as `tenant`, `org`, `workspace`, `project`, `user`, `conversation`, `global`, or any other vocabulary that matches their domain.

Examples:

```ts
scope: { type: "global" }
scope: { type: "workspace", id: "workspace_123", label: "Example Workspace" }
scope: { type: "conversation" }
scope: { type: "custom", label: "Current user access scope" }
```

Value:

- Prevents ambiguous answers like "200 records" when the real answer is "200 records across a broad app-owned scope" or "200 records inside this narrower scope."
- Lets the assistant include scope in the answer when helpful.
- `scope` is required for standard result contracts. Apps should avoid `scope: { type: "unknown" }` except as a migration fallback.
- Future prompt guidance should tell the assistant to treat answers as applying only to `meta.scope`, and to include scope in the answer when it prevents ambiguity.

### `appliedFilters`

The filters the backend actually applied after validation and normalization.

Example:

```ts
appliedFilters: {
  location: "Boston, MA",
  status: "analyzed",
  minScore: 70
}
```

Value:

- Confirms what the backend understood.
- Allows apps to normalize user input, such as "Boston" to "Boston, MA."
- Helps the assistant answer precisely without guessing.
- `appliedFilters` is optional. Some tools have no filters, some tools are scoped entirely by app context, and some apps may not want to expose normalized filter details in every result.

### `count`

The exact total number of matching records in the queried scope, when known.

Example:

```ts
count: 200
returned: 20
```

Value:

- The assistant should use `meta.count` for "how many" questions.
- The assistant should not infer counts from `data.length` when `count` is present or when rows are paginated/sampled.
- `count` can be much larger than `returned`. A result with `count: 50000` and `returned: 20` is valid and should be answered as "50,000 matching records; here are the first 20."
- Paginated list tools may include `count` only when it is the exact total for the same scope and filters as the returned page.
- Semantic search tools should omit `count` in v1. Do not return `count: undefined`; absence means unknown or not applicable.
- Sampled results must not include `count` in v1. If an app needs both an exact count and sampled examples, it should use separate tool calls or a deterministic list result.

### `returned`

The number of rows included in `data`.

Keep the field name `returned`. Do not rename it to `rowCount` or `dataCount`; `returned` stays generic across rows, records, search results, and detail-like outputs.

Example:

```ts
returned: 20
```

Value:

- Makes it explicit that the tool returned 20 rows, even if 200 matched.
- Must equal `data.length`.
- Must equal the actual returned JSON `data.length`; privacy filtering, internal row filtering, or row hiding must happen before constructing `data`.
- Useful in prompt guidance: "Here are the first 20" rather than implying the list is complete.

### `exhaustive`

Whether the result is complete for the requested operation.

For list-like results, `exhaustive` means `data` includes every matching record in the queried scope. For count-only results, `data` is intentionally empty, but the result may still be exhaustive because `meta.count` is the complete answer.

Examples:

```ts
count: 14
returned: 14
exhaustive: true
```

```ts
count: 200
returned: 20
exhaustive: false
```

Value:

- If `exhaustive` is false, the assistant should not summarize the complete population from `data` alone.
- The assistant can still answer counts from `meta.count`.
- `pagination` may be present when `exhaustive === true` if `pagination.hasMore === false`, such as a final page or a small result set that fits in one page.
- `pagination.hasMore === true` implies `exhaustive === false`.
- Count-only tools should use `data: []`, `returned: 0`, exact `count`, and `exhaustive: true`.

### `truncated`

Whether the tool intentionally omitted matching rows or omitted parts of returned values due to size, page, model, policy, timeout, or app cost limits.

Examples:

```ts
truncated: true
truncationReason: "row_limit"
```

```ts
truncated: true
truncationReason: "field_size"
```

Value:

- Makes incomplete row data explicit.
- Helps avoid pretending a row contains full analysis when fields were omitted or shortened.
- Covers both row-set truncation and field/content truncation in v1. `truncationReason` disambiguates the cause.
- If `truncated === true`, `truncationReason` must be a non-empty string.
- Do not validate `truncationReason` as an enum in v1. Example app-owned values include `row_limit`, `field_size`, `token_budget`, `semantic_top_k_limit`, `max_limit_clamped`, `privacy_redaction`, `timeout`, and `cost_limit`.

### `sampled`

Whether `data` is a heuristic or representative subset rather than a deterministic page.

Examples:

```ts
sampled: true
sampleMethod: "semantic_top_k"
```

```ts
sampled: false
pagination: { hasMore: true, nextCursor: "abc123" }
```

Value:

- Distinguishes vector search top-N from deterministic pagination.
- The assistant should never answer "how many" from sampled result length.
- Sampled results must not include `count` in v1.
- If `sampled === true`, `sampleMethod` must be a non-empty string.
- Do not validate `sampleMethod` as an enum in v1. Example app-owned values include `semantic_top_k`, `random_sample`, and `representative_sample`.
- Top-K means the tool returns the K best-scoring results by relevance, not every matching result.
- A semantic top-K result should use `sampled: true` because it is a relevance sample, but it does not have to use `truncated: true` unless the app also wants to report a hard row, field, token, policy, timeout, or cost limit.

### `pagination`

Cursor metadata for deterministic list tools.

Example:

```ts
pagination: {
  cursor: null,
  hasMore: true,
  nextCursor: "abc123",
  pageSize: 20
}
```

Value:

- Allows the assistant to continue listing results when the user asks "show more."
- Gives the assistant enough context to say "Here are the first 20."
- Keeps deterministic pagination separate from sampled semantic search.
- Handles large result sets by limiting `data` to one deterministic page. The `count` may be thousands or millions, but the returned rows should still be capped by `limit`, `pageSize`, and the tool builder's max limit.
- `nextCursor` should be opaque to the model. The assistant should pass it back unchanged when continuing the same list.
- If `hasMore` is true, `nextCursor` must be present.
- `hasMore === true` must not be combined with `exhaustive === true`.
- V1 pagination follow-up is best effort: the model should use `nextCursor` from recent tool results. The library should not persist separate pagination session state in the first slice.

Deferred durable pagination state:

- The library may later store active pagination state per conversation to support "show more" after long gaps, after the original tool result leaves the model context, or when multiple paginated lists are active.
- A durable design would need to define pagination sessions, disambiguation rules, cursor expiry, and how stored state is exposed back to the model.
- Do not add this state management to v1 unless immediate follow-up via recent tool results proves insufficient.

## Full Example: Count and First Page

Input tool call:

```ts
listRecords({
  filters: { location: "Boston, MA" },
  limit: 20
})
```

Output:

```ts
{
  data: [
    {
      id: "record_1",
      title: "Example record",
      location: "Boston, MA",
      status: "active",
      viewUrl: "/records/record_1"
    }
  ],
  meta: {
    scope: { type: "workspace", id: "workspace_123", label: "Example Workspace" },
    appliedFilters: { location: "Boston, MA" },
    count: 200,
    returned: 20,
    exhaustive: false,
    truncated: true,
    truncationReason: "row_limit",
    sampled: false,
    pagination: {
      cursor: null,
      hasMore: true,
      nextCursor: "abc123",
      pageSize: 20
    }
  }
}
```

Expected assistant behavior:

> There are 200 matching records for Boston, MA. Here are the first 20.

If the user asks "show more," the assistant should call:

```ts
listRecords({
  filters: { location: "Boston, MA" },
  cursor: "abc123",
  limit: 20
})
```

## Full Example: Semantic Search

Input tool call:

```ts
semanticSearchRecords({
  query: "records related to database reliability",
  limit: 20
})
```

Output:

```ts
{
  data: [
    {
      id: "record_1",
      title: "Database reliability note",
      snippet: "..."
    }
  ],
  meta: {
    scope: { type: "workspace", id: "workspace_123", label: "Example Workspace" },
    appliedFilters: { query: "records related to database reliability" },
    returned: 20,
    exhaustive: false,
    truncated: true,
    truncationReason: "semantic_top_k_limit",
    sampled: true,
    sampleMethod: "semantic_top_k"
  }
}
```

Expected assistant behavior:

- Do not answer "There are 20."
- Say these are relevant records or search results.
- Use deterministic count/list tools for factual count questions.

## Library Responsibilities

Convex Database Chat should provide:

### 1. Public Result Types

Export types such as:

```ts
export type DatabaseChatToolResult<Row> = {
  data: Row[];
  meta: DatabaseChatResultMeta;
};

export type DatabaseChatResultMeta = {
  scope: DatabaseChatScope;
  appliedFilters?: Record<string, unknown>;
  count?: number;
  returned: number;
  exhaustive: boolean;
  truncated: boolean;
  truncationReason?: string;
  sampled: boolean;
  sampleMethod?: string;
  pagination?: {
    cursor?: string | null;
    hasMore: boolean;
    nextCursor?: string | null;
    pageSize?: number;
  };
};
```

### 2. Tool Builders With Metadata Semantics

Potential helper APIs:

```ts
defineCountTool(...)
definePaginatedListTool(...)
defineSemanticSearchTool(...)
defineDetailTool(...)
```

These should generate:

- LLM parameter schema.
- Tool descriptions.
- Reliability metadata such as deterministic vs sampled.
- Standard prompt hints for result interpretation.

### 3. Prompt Guidance

The component should inject reusable prompt guidance automatically, with an app-facing override or disable option:

- Use `meta.count` for count questions.
- Never infer counts from `data.length` when `sampled`, `truncated`, or `exhaustive === false`.
- If `pagination.hasMore` is true, say the rows are the first page.
- If the user asks for more, call the same tool with `pagination.nextCursor`.
- If `scope` is narrow, include the scope in the answer.
- If `appliedFilters` differ from the user's wording due to normalization, mention the normalized filter when helpful.

### 4. Optional Validation Helpers

The library can include runtime helpers to validate that tool results match the contract:

```ts
validateToolResultContract(result)
```

Potential checks:

- `returned === data.length`.
- `sampled === true` should not also report `exhaustive === true`.
- `pagination.hasMore === true` should include `nextCursor`.
- `exhaustive === true` should imply `truncated === false`.

## App Responsibilities

Apps should implement:

- The handler that returns the contract.
- Domain-specific filters.
- Cursor queries.
- Counts.
- Safe row shapes.
- Result sorting.
- Privacy boundaries.

For example, an app would implement a handler like:

```ts
export const listRecords = internalQuery({
  args: {
    scopeId: v.string(),
    filters: recordFilterValidator,
    limit: v.optional(v.number()),
    cursor: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<DatabaseChatToolResult<RecordRow>> => {
    // App-owned implementation:
    // - verify app-owned scope
    // - normalize filters
    // - run deterministic count
    // - run cursor-paginated list
    // - return safe rows plus metadata
  }
});
```

## Recommended First Slice

Start with a contract-only upstream slice:

1. Export public result contract types.
2. Export lightweight runtime validation helpers for the standard contract if the implementation remains small.
3. Add tests showing:
   - `returned === data.length`;
   - count-only result with `data: []`, exact `count`, and `returned: 0`;
   - deterministic first page with `count: 200`, `returned: 20`, `hasMore: true`;
   - semantic top-K with `sampled: true` and no `count`.

Defer typed builders and component-injected prompt guidance to separate slices unless a later vertical-slice plan deliberately groups them.

---

# Typed Tool Builders

## Context

The result contract solves how tool outputs should be interpreted. Typed tool builders solve a different but related problem: app authors currently hand-write several representations of the same tool capability.

For each tool, an app may need to keep these aligned:

- LLM-facing JSON schema.
- Tool description.
- Tool reliability metadata.
- Handler argument expectations.
- Result contract expectations.
- System prompt guidance.
- App-owned Convex validators.

This is a drift risk. The library should make common tool kinds easy to define without taking ownership of app-specific queries.

## Goal

Add public builder functions that let app authors define tool capabilities once. The builders should generate:

- The existing `DatabaseChatTool` shape consumed by the component.
- LLM JSON schema for tool calling.
- Tool reliability metadata.
- Standard prompt guidance.
- TypeScript inference helpers for model args, handler args, and result shape.

The builders should not generate or execute app-specific database queries.

## Public API Choice

Use split public functions:

```ts
defineCountTool(...)
definePaginatedListTool(...)
defineSemanticSearchTool(...)
```

These should be thin wrappers over one internal discriminated core, but the public API should stay explicit.

Rationale:

- The function name carries the truth contract.
- `defineCountTool` means totals.
- `definePaginatedListTool` means deterministic rows with cursor pagination.
- `defineSemanticSearchTool` means relevant top-K results, not exhaustive counts.
- This reduces the chance that app authors accidentally configure contradictory reliability flags.

Avoid a loose generic API like:

```ts
defineTool({ sampled: true, supportsCount: false, ... })
```

That pushes too much correctness burden onto each app.

## Tool Kinds

Internally, the library can still represent these as tool kinds:

```ts
type ToolKind = "count" | "paginated_list" | "semantic_search";
```

Each kind should imply different defaults:

```ts
// count
{
  supportsCount: true,
  paginated: false,
  sampled: false
}

// paginated_list
{
  supportsCount: true,
  paginated: true,
  sampled: false
}

// semantic_search
{
  supportsCount: false,
  paginated: false,
  sampled: true
}
```

## Filters

Filters must be fully generic and app-defined. The library should not know about domain-specific concepts such as locations, scores, accounts, jobs, applications, tickets, or any other app-owned entity.

Filters should be flat and optional by default.

Example:

```ts
filters: {
  status: enumFilter({
    values: ["active", "inactive", "archived"] as const,
    description: "Record status."
  }),
  createdAfter: numberFilter({
    description: "Only include records created after this timestamp."
  })
}
```

Generated model args:

```ts
{
  filters?: {
    status?: "active" | "inactive" | "archived";
    createdAfter?: number;
  };
}
```

### Filter Defaults

- Filters are optional unless marked `required: true`.
- Filters are nested under `filters`; do not flatten them at the top level.
- Nested filters and boolean query logic are out of scope for v1.
- Range filters should be represented as app-defined flat filters, such as `createdAfter` and `createdBefore`, rather than a nested range object.

## Builder Limits

Builders should always have effective default and max limits, but app-provided limit config should be optional because the library supplies conservative defaults.

Recommended defaults:

```ts
definePaginatedListTool(...) -> {
  defaultLimit: 20,
  maxLimit: 100
}

defineSemanticSearchTool(...) -> {
  defaultLimit: 10,
  maxLimit: 50
}
```

Apps can override these defaults:

```ts
definePaginatedListTool({
  // ...
  pagination: {
    defaultLimit: 25,
    maxLimit: 75
  }
})
```

Count tools should not expose `limit`.

Builder behavior:

- Expose `limit?: number` to the model for paginated list and semantic search tools.
- Include the effective default and max in the generated JSON schema description.
- Extend JSON schema with numeric constraints if the local `ToolParameterSchema` supports them; otherwise describe the bounds in plain language.
- Generated helpers may clamp model-provided `limit` before invoking the handler, but app handlers must still enforce max limits because the app owns data access and cost controls.

## Filter Helpers

Recommended v1 helper names and signatures:

```ts
function stringFilter(options?: {
  description?: string;
  required?: boolean;
}): StringFilter;

function numberFilter(options?: {
  description?: string;
  required?: boolean;
  min?: number;
  max?: number;
}): NumberFilter;

function booleanFilter(options?: {
  description?: string;
  required?: boolean;
}): BooleanFilter;

function enumFilter<const Values extends readonly string[]>(options: {
  values: Values;
  description?: string;
  required?: boolean;
}): EnumFilter<Values>;
```

Defer `idFilter` in v1. App-specific ids can be modeled as strings until there is a clear need for a Convex-aware id helper.

## Injected Args

Some handler args should be required by the app but invisible to the model. Examples include tenant ids, org ids, user ids, and external auth ids.

Use typed injected args, not just a string list:

```ts
injectedArgs: {
  orgId: injectedString({
    description: "Current organization id, injected by the app."
  }),
  externalId: injectedString({
    description: "Current external user id, injected by the app."
  })
}
```

Recommended v1 helper:

```ts
function injectedString(options?: {
  description?: string;
}): InjectedArg<"string">;
```

Why this matters:

- The model should not choose injected values.
- The LLM JSON schema should not expose injected values.
- The handler should still receive injected values through `toolContext`.
- Type inference should distinguish model args from handler args.

## TypeScript Inference

Expose these inference helpers:

```ts
type InferToolModelArgs<Tool> = ...
type InferToolHandlerArgs<Tool> = ...
type InferToolResult<Tool> = ...
```

For a paginated list tool:

```ts
const listRecordsTool = definePaginatedListTool<RecordRow>({
  name: "listRecords",
  description: "List records matching deterministic filters.",
  handler: handles.listRecords,
  filters: {
    status: enumFilter({
      values: ["active", "inactive"] as const
    })
  },
  injectedArgs: {
    tenantId: injectedString()
  },
  pagination: {
    defaultLimit: 20,
    maxLimit: 100
  }
});
```

`InferToolModelArgs<typeof listRecordsTool>` should infer:

```ts
{
  filters?: {
    status?: "active" | "inactive";
  };
  limit?: number;
  cursor?: string;
}
```

`InferToolHandlerArgs<typeof listRecordsTool>` should infer:

```ts
{
  filters?: {
    status?: "active" | "inactive";
  };
  limit?: number;
  cursor?: string;
  tenantId: string;
}
```

`InferToolResult<typeof listRecordsTool>` should infer:

```ts
DatabaseChatToolResult<RecordRow>
```

## Convex Validators

Do not generate Convex `v` validators in v1.

The builders should generate LLM JSON schema because model tool calling requires JSON schema. Convex validators are a separate runtime validation layer owned by the app.

Reasons to defer Convex validator generation:

- It couples the tool builder more tightly to Convex validator APIs.
- Complex validators, unions, optional/null behavior, and ids need more design work.
- The first slice can deliver value through JSON schema, metadata, prompt guidance, and TypeScript inference.

Apps can still write Convex validators manually:

```ts
export const listRecords = internalQuery({
  args: {
    filters: v.optional(v.object({
      status: v.optional(v.union(v.literal("active"), v.literal("inactive")))
    })),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    tenantId: v.string()
  },
  handler: async (ctx, args): Promise<InferToolResult<typeof listRecordsTool>> => {
    // app-owned implementation
  }
});
```

Convex validator generation can be considered later as an optional helper if duplication becomes painful.

## Prompt Guidance

Tool reliability guidance should be injected automatically by the component based on builder metadata.

For example, the component can append guidance like:

- Count tools provide totals; use `meta.count` for "how many" questions.
- Paginated list tools return deterministic rows and may include only the first page.
- If `meta.pagination.hasMore` is true, tell the user this is a page and use `nextCursor` if they ask for more.
- Semantic search tools are sampled top-K results and must not be used for factual counts.
- Never infer totals from `data.length` when `sampled`, `truncated`, or `exhaustive === false`.

Default should be automatic, with an escape hatch:

```ts
includeToolReliabilityGuidance?: boolean;
```

or:

```ts
toolGuidance?: "auto" | "disabled";
```

## Effect

Do not require Effect for v1 unless the Convex Database Chat repo already wants it.

Effect could be useful later for:

- Structured result-contract validation.
- Typed parse errors.
- Contract validation tests.
- Retry, timeout, or cancellation policies around external model calls.

Effect is not necessary for:

- Simple builder functions.
- JSON schema generation.
- Cursor pagination metadata.
- Basic prompt guidance formatting.

For v1, use lightweight runtime validation and normal Vitest tests. If validation grows more complex, Effect Schema could be considered as an optional internal implementation detail.

## Example: Generic App Tool

```ts
const listRecordsTool = definePaginatedListTool<RecordRow>({
  name: "listRecords",
  description: "List records matching deterministic filters.",
  handler: handles.listRecords,
  filters: {
    status: enumFilter({
      values: ["active", "inactive", "archived"] as const,
      description: "Record status."
    }),
    createdAfter: numberFilter({
      description: "Only include records created after this timestamp."
    })
  },
  injectedArgs: {
    tenantId: injectedString({
      description: "Current tenant id, injected by the app."
    })
  },
  pagination: {
    defaultLimit: 20,
    maxLimit: 100
  }
});
```

The LLM sees:

```ts
{
  filters?: {
    status?: "active" | "inactive" | "archived";
    createdAfter?: number;
  };
  limit?: number;
  cursor?: string;
}
```

The handler receives:

```ts
{
  filters?: {
    status?: "active" | "inactive" | "archived";
    createdAfter?: number;
  };
  limit?: number;
  cursor?: string;
  tenantId: string;
}
```

## Example: Domain App Tool

A downstream app could use the same generic API with app-owned filter names:

```ts
const listRecordsTool = definePaginatedListTool<RecordRow>({
  name: "listRecords",
  description: "List records matching deterministic filters.",
  handler: handles.listRecords,
  filters: {
    location: stringFilter({
      description: "Record location. The app normalizes this before querying."
    }),
    status: enumFilter({
      values: ["active", "inactive", "archived"] as const,
      description: "Record status."
    }),
    minScore: numberFilter({
      min: 0,
      max: 100,
      description: "Minimum app-defined score."
    }),
    maxScore: numberFilter({
      min: 0,
      max: 100,
      description: "Maximum app-defined score."
    })
  },
  injectedArgs: {
    orgId: injectedString(),
    userId: injectedString(),
    externalId: injectedString()
  },
  pagination: {
    defaultLimit: 20,
    maxLimit: 50
  }
});
```

The library remains agnostic. It only sees filter names, basic schema types, injected args, pagination config, and reliability metadata. The app still owns the Convex query, domain normalization, privacy-safe rows, and indexes.

## Recommended First Slice

Builder work should be implemented after the contract-only slice.

1. Export split builder functions:
   - `defineCountTool`
   - `definePaginatedListTool`
   - `defineSemanticSearchTool`
2. Export filter helpers:
   - `stringFilter`
   - `numberFilter`
   - `booleanFilter`
   - `enumFilter`
   - `injectedString`
3. Generate LLM JSON schema with model args under `filters`.
4. Exclude `injectedArgs` from the LLM JSON schema while including them in handler arg inference.
5. Export inference helpers:
   - `InferToolModelArgs`
   - `InferToolHandlerArgs`
   - `InferToolResult`
6. Attach reliability metadata to built tools, but leave component prompt-guidance injection to the prompt-guidance slice unless the chosen vertical slice explicitly includes both.
7. Do not generate Convex validators yet.
8. Add tests for:
   - optional filters by default;
   - required filters;
   - enum inference;
   - injected args excluded from model schema;
   - injected args included in handler arg inference;
   - paginated list metadata;
   - semantic search metadata.

---

# Tool Reliability Metadata and Prompt Guidance

## Context

The result contract describes what happened in a specific tool call. Tool reliability metadata describes what kind of tool this is expected to be before a call is made.

This metadata should let Convex Database Chat automatically add generic prompt guidance such as:

- Use count tools for totals.
- Treat paginated list tools as deterministic pages.
- Treat semantic search tools as sampled top-K results.
- Do not infer totals from row count unless the result includes an explicit `meta.count`.

## Design Principle

Keep public metadata small and deterministic.

Avoid exposing a loose set of overlapping flags such as:

```ts
{
  reliability: "deterministic",
  supportsCount: true,
  sampled: false,
  paginated: true
}
```

Those flags can conflict or drift. For v1, expose one primary kind field and let the library derive behavior internally.

## Public Metadata Shape

Recommended v1 shape:

```ts
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
```

Built tools should attach metadata directly to the tool entity:

```ts
{
  name: "listRecords",
  description: "...",
  parameters: { ... },
  handler: "...",
  metadata: {
    kind: "paginated_list",
    resultContract: "standard"
  }
}
```

## Derived Internal Behavior

The library may derive behavior from `metadata.kind` internally:

```ts
const TOOL_KIND_BEHAVIOR = {
  count: {
    supportsCount: true,
    paginated: false,
    sampled: false
  },
  paginated_list: {
    supportsCount: true,
    paginated: true,
    sampled: false
  },
  semantic_search: {
    supportsCount: false,
    paginated: false,
    sampled: true
  },
  detail: {
    supportsCount: false,
    paginated: false,
    sampled: false
  },
  unknown: {
    supportsCount: false,
    paginated: false,
    sampled: undefined
  }
};
```

These booleans should be internal implementation details in v1, not public knobs.

## Builder Defaults

The split builders should set metadata automatically:

```ts
defineCountTool(...) -> metadata.kind = "count"
definePaginatedListTool(...) -> metadata.kind = "paginated_list"
defineSemanticSearchTool(...) -> metadata.kind = "semantic_search"
```

If a detail tool is added in v1 or later:

```ts
defineDetailTool(...) -> metadata.kind = "detail"
```

All builders that expect the standard result contract should set:

```ts
metadata.resultContract = "standard"
```

## Backward Compatibility

Existing raw tools without metadata must continue to work.

Treat missing metadata as:

```ts
metadata: {
  kind: "unknown"
}
```

Do not throw, fail validation, or require migration.

Prompt guidance for unknown tools should be conservative:

> Tools without metadata may be incomplete, sampled, or app-specific. Do not infer totals from returned row count unless the result explicitly includes `meta.count`.

## Result Metadata Wins

Tool metadata is the default expectation. Result metadata is the source of truth for a specific tool call.

If they conflict, result metadata wins for that call.

Example:

```ts
tool.metadata.kind = "paginated_list"
result.meta.sampled = true
```

The assistant should treat the specific result as sampled because the result contract says so.

This allows handlers to be precise about unusual runtime cases without requiring a large public metadata flag surface.

## Prompt Guidance Injection

Tool reliability guidance should be injected automatically by the component.

Implement this as its own slice after result contracts and typed builders, unless the implementation plan intentionally groups builder metadata and guidance in one vertical slice.

Default:

```ts
toolGuidance: "auto"
```

Override or opt out:

```ts
toolGuidance: "disabled"
```

Suggested config field:

```ts
type SendConfig = {
  ...
  toolGuidance?: "auto" | "disabled" | string;
};
```

If `toolGuidance` is a string, append that custom guidance instead of generated guidance.

The current component already builds a system prompt from the base prompt and tool descriptions. Reliability guidance can be appended in the same path.

## Default Guidance Text

Concrete v1 guidance text can be generated from the set of tool kinds present.

Suggested wording:

```text
Tool result reliability:

- Use count tools for factual total/count questions. Prefer `meta.count` when present.
- Paginated list tools return deterministic rows, but may only return one page. If `meta.pagination.hasMore` is true, say that more results are available.
- When the user asks for more results from a paginated list, call the same tool again with the previous `meta.pagination.nextCursor` and the same relevant filters.
- Semantic search tools return sampled top-K relevance results. Do not use semantic search result length as a factual count.
- Tools without metadata may be incomplete, sampled, or app-specific. Do not infer totals from returned row count unless the result explicitly includes `meta.count`.
- For any standard result contract, the result metadata for that specific call is authoritative. Do not infer totals from `data.length` when `meta.sampled`, `meta.truncated`, or `meta.exhaustive === false`.
```

The exact wording can be tightened during implementation, but tests should assert the core semantics:

- count questions use `meta.count`;
- semantic search length is not a count;
- paginated list follow-up uses `nextCursor`;
- unknown tools are treated conservatively;
- result metadata overrides tool kind assumptions.

## Pagination Follow-Up Behavior

V1 should support immediate follow-ups on a best-effort basis by relying on the model-visible recent tool result. The library should not store separate pagination sessions in v1.

When a standard result contract includes:

```ts
meta.pagination = {
  hasMore: true,
  nextCursor: "abc123"
}
```

The prompt should instruct the model to:

1. Tell the user that only a page was shown, when relevant.
2. Reuse the same tool, same relevant filters, and `nextCursor` if the user asks for more.
3. Avoid restarting pagination from the first page unless the user changes filters or asks to start over.

Example:

User:

> How many records are active?

Tool returns:

```ts
{
  data: [/* 20 rows */],
  meta: {
    count: 200,
    returned: 20,
    sampled: false,
    exhaustive: false,
    truncated: true,
    pagination: {
      hasMore: true,
      nextCursor: "abc123"
    }
  }
}
```

Assistant:

> There are 200 active records. Here are the first 20.

User:

> Show more.

Assistant should call the same tool with:

```ts
{
  filters: { /* same relevant filters */ },
  cursor: "abc123",
  limit: 20
}
```

## Unknown Tools

Unknown tools should not fail. They should simply receive conservative guidance.

Rules:

- If a raw tool returns a standard result contract, use its `meta`.
- If a raw tool does not return a standard result contract, do not infer count/exhaustiveness from row length.
- App-specific prompt text can still explain raw tool behavior, but the library should not assume it.

## Trade-Offs

### Benefits

- Small public surface.
- Easy to understand and document.
- Builder functions set safe defaults.
- Avoids public flag conflicts.
- Backward compatible with existing tools.
- Lets result metadata stay authoritative per call.

### Costs

- Less flexible than a full capability matrix.
- Does not represent unusual cases like semantic search with approximate counts.
- Future tool kinds may need new `kind` values.
- Best-effort pagination follow-up can fail if the relevant tool result falls out of model context or if the user has multiple active paginated lists and says "show more" ambiguously.

These costs are acceptable for v1. If unusual cases appear later, the library can add carefully scoped extensions such as:

```ts
capabilities?: {
  approximateCount?: true;
}
```

Do not add this in v1 without a concrete use case.

## Recommended First Slice

1. Extend `DatabaseChatTool` with optional `metadata?: DatabaseChatToolMetadata`.
2. Add `DatabaseChatToolKind` and `DatabaseChatToolMetadata` exports.
3. Have typed builders set `metadata.kind` and `metadata.resultContract`.
4. Treat missing metadata as `kind: "unknown"`.
5. Add `toolGuidance?: "auto" | "disabled"` to send config.
6. Automatically append reliability guidance when `toolGuidance !== "disabled"`.
7. Generate guidance based on the tool kinds present.
8. Prefer result metadata over tool metadata for a specific call.
9. Add tests for:
   - builder metadata defaults;
   - raw tools treated as unknown;
   - automatic guidance includes count behavior;
   - automatic guidance includes paginated follow-up behavior;
   - automatic guidance includes semantic search count warning;
   - guidance can be disabled;
   - result metadata is documented/tested as authoritative.
