/**
 * Vector search helpers for DatabaseChat.
 *
 * These utilities are designed for use inside Convex actions and do not
 * import Convex runtime types. You own your schema, actions, and vector indexes.
 */

/** Default OpenRouter embedding model. */
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
/** Default embedding vector dimensions for the default model. */
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
/** Alias for the common OpenAI small embedding dimensions. */
export const OPENAI_SMALL_DIMENSIONS = DEFAULT_EMBEDDING_DIMENSIONS;

export type ToolParameterType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object";

export interface ToolParameterSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: ToolParameterType;
      description?: string;
      enum?: string[];
      items?: { type: ToolParameterType };
    }
  >;
  required?: string[];
}

/**
 * A vector search result from ctx.vectorSearch.
 */
export type VectorSearchResult<IdType = string> = {
  _id: IdType;
  _score: number;
};

/**
 * Tool definition compatible with DatabaseChat tools.
 */
export interface VectorToolDefinition {
  /** Unique name for the tool (used by the LLM to call it). */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /** JSON Schema describing parameters. */
  parameters: ToolParameterSchema;
  /** Function type for the handler (default: "query"). */
  handlerType?: "query" | "mutation" | "action";
  /** Convex function handle string to execute. */
  handler: string;
}

/**
 * Options for generateEmbedding.
 */
export interface GenerateEmbeddingOptions {
  /** OpenRouter API key. */
  apiKey: string;
  /** Text to embed. */
  text: string;
  /** Embedding model ID (OpenRouter). */
  model?: string;
  /** Optional HTTP-Referer header for OpenRouter analytics. */
  referer?: string;
  /** Optional X-Title header for OpenRouter analytics. */
  title?: string;
}

/**
 * Options for defineVectorSearchTool.
 */
export interface DefineVectorSearchToolOptions {
  name: string;
  description: string;
  /** Name of the Convex action to call. */
  handler: string;
  /** Tool parameters. Defaults include query and optional limit. */
  parameters?: Record<
    string,
    {
      type: ToolParameterType;
      description: string;
      optional?: boolean;
      enum?: string[];
      items?: { type: ToolParameterType };
    }
  >;
}

/**
 * Options for formatVectorResults.
 */
export interface FormatOptions<Fields extends readonly string[] | undefined = undefined> {
  /** Include similarity score in each result. */
  includeScore?: boolean;
  /** Maximum length of string fields before truncation. */
  snippetLength?: number;
  /** Specific fields to include from each document. */
  fields?: Fields;
}

/**
 * Formatted vector result ready for LLM context.
 */
export type FormattedVectorResult<
  TDoc extends Record<string, unknown>,
  IdType = string,
  Fields extends readonly (keyof TDoc & string)[] | undefined = undefined
> = {
  _id: IdType;
  _score?: number;
} & (Fields extends readonly (keyof TDoc & string)[] ? Pick<TDoc, Fields[number]> : TDoc);

/**
 * Generate an embedding using OpenRouter's embeddings API.
 */
export async function generateEmbedding(
  options: GenerateEmbeddingOptions
): Promise<number[]> {
  if (!options.apiKey) {
    throw new Error("OpenRouter API key is required");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
  };

  if (options.referer) {
    headers["HTTP-Referer"] = options.referer;
  }

  if (options.title) {
    headers["X-Title"] = options.title;
  }

  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: options.model ?? DEFAULT_EMBEDDING_MODEL,
      input: options.text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter embeddings error: ${response.status} - ${errorText}`
    );
  }

  let data: { data?: Array<{ embedding?: unknown }> };
  try {
    data = await response.json();
  } catch {
    throw new Error("OpenRouter embeddings response was not valid JSON");
  }

  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || !embedding.every((v) => typeof v === "number")) {
    throw new Error("OpenRouter embeddings response missing data");
  }

  return embedding;
}

/**
 * Define a vector search tool compatible with DatabaseChat.
 * Sets handlerType to "action" for ctx.vectorSearch compatibility.
 */
export function defineVectorSearchTool(
  options: DefineVectorSearchToolOptions
): VectorToolDefinition {
  const defaultParameters: NonNullable<
    DefineVectorSearchToolOptions["parameters"]
  > = {
    query: {
      type: "string",
      description: "Semantic search query",
    },
    limit: {
      type: "number",
      description: "Maximum number of results to return",
      optional: true,
    },
  };

  const mergedParameters = {
    ...defaultParameters,
    ...(options.parameters ?? {}),
  };

  const properties: ToolParameterSchema["properties"] = {};
  const required: string[] = [];

  for (const [name, config] of Object.entries(mergedParameters)) {
    properties[name] = {
      type: config.type,
      description: config.description,
      enum: config.enum,
      items: config.items,
    };

    if (!config.optional) {
      required.push(name);
    }
  }

  return {
    name: options.name,
    description: options.description,
    handlerType: "action",
    handler: options.handler,
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };
}

/**
 * Format vector search results for LLM context.
 *
 * Results without matching documents are skipped.
 */
export function formatVectorResults<
  TDoc extends Record<string, unknown>,
  IdType = string,
  Fields extends readonly (keyof TDoc & string)[] | undefined = undefined
>(
  results: Array<VectorSearchResult<IdType>>,
  documents: Array<(TDoc & { _id?: IdType }) | null | undefined>,
  options: FormatOptions<Fields> = {}
): Array<FormattedVectorResult<TDoc, IdType, Fields>> {
  const { includeScore = false, snippetLength = 300, fields } = options;
  const docMap = new Map<IdType, TDoc>();

  for (const doc of documents) {
    if (!doc || doc._id === undefined || doc._id === null) {
      continue;
    }
    docMap.set(doc._id as IdType, doc);
  }

  const formatted: Array<FormattedVectorResult<TDoc, IdType, Fields>> = [];
  const normalizedSnippetLength = Math.max(0, snippetLength);

  for (const result of results) {
    const doc = docMap.get(result._id);
    if (!doc) {
      continue;
    }

    const output: Record<string, unknown> = {
      _id: result._id,
    };

    if (includeScore) {
      output._score = result._score;
    }

    const keys = fields !== undefined
      ? [...fields]
      : (Object.keys(doc) as Array<keyof TDoc & string>);

    for (const key of keys) {
      if (key === "_id") {
        continue;
      }
      const value = (doc as Record<string, unknown>)[key];
      output[key] = truncateValue(value, normalizedSnippetLength);
    }

    formatted.push(output as FormattedVectorResult<TDoc, IdType, Fields>);
  }

  return formatted;
}

function truncateValue(value: unknown, snippetLength: number): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (snippetLength <= 0) {
    return "";
  }

  if (value.length <= snippetLength) {
    return value;
  }

  return `${value.slice(0, snippetLength)}...`;
}
