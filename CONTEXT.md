# Convex Database Chat

Convex Database Chat lets apps expose app-owned data access tools to a chat assistant while the library owns generic chat, tool, and result semantics.

## Language

**Standard Result Contract**:
A generic tool-result envelope whose metadata tells the assistant how complete, scoped, counted, sampled, truncated, and paginated a specific tool result is.
_Avoid_: Sift result contract, app result shape

**Tool Result**:
The JSON-serializable value returned by an app-owned tool handler after the assistant calls a tool.
_Avoid_: response, payload

**Tool Capability**:
The model-visible description of what a tool can do before it is called, including its arguments, handler, and generic reliability kind.
_Avoid_: tool API, function schema

## Relationships

- A **Tool Capability** produces a **Tool Result** when the assistant calls it.
- A **Standard Result Contract** is an optional shape for a **Tool Result**.
- A **Standard Result Contract** describes a specific call; **Tool Capability** metadata describes the default expectation before a call.

## Example Dialogue

> **Dev:** "Can the assistant count matching records from a paginated list?"
> **Domain expert:** "Only if the **Tool Result** uses the **Standard Result Contract** and includes an exact `meta.count`; otherwise it should not infer totals from row length."

## Flagged Ambiguities

- Domain-specific examples are non-normative; the library should not name or depend on downstream app concepts.
