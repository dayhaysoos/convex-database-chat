export type DatabaseChatScope = {
  type: string;
  id?: string;
  label?: string;
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

export type DatabaseChatToolResult<Row = unknown> = {
  data: Row[];
  meta: DatabaseChatResultMeta;
};

export type DatabaseChatResultValidationError = {
  code: string;
  path: string;
  message: string;
};

export function validateToolResultContract(
  result: unknown
): DatabaseChatResultValidationError[] {
  const errors: DatabaseChatResultValidationError[] = [];
  const addError = (
    code: string,
    path: string,
    message: string
  ): void => {
    errors.push({ code, path, message });
  };

  if (!isRecord(result)) {
    return [
      {
        code: "invalid_result",
        path: "$",
        message: "Result must be an object.",
      },
    ];
  }

  if (!Array.isArray(result.data)) {
    addError("invalid_data", "$.data", "Result data must be an array.");
  }

  if (!isRecord(result.meta)) {
    addError("invalid_meta", "$.meta", "Result meta must be an object.");
    return errors;
  }

  const meta = result.meta;
  const dataLength = Array.isArray(result.data) ? result.data.length : 0;

  if (!isNonNegativeSafeInteger(meta.returned)) {
    addError(
      "invalid_returned",
      "$.meta.returned",
      "meta.returned must be a non-negative safe integer."
    );
  } else if (meta.returned !== dataLength) {
    addError(
      "returned_mismatch",
      "$.meta.returned",
      "meta.returned must equal data.length."
    );
  }

  if (!isRecord(meta.scope)) {
    addError(
      "invalid_scope",
      "$.meta.scope",
      "meta.scope must include a non-empty string type."
    );
  } else {
    if (!isNonEmptyString(meta.scope.type)) {
      addError(
        "invalid_scope",
        "$.meta.scope.type",
        "meta.scope.type must be a non-empty string."
      );
    }
    if (meta.scope.id !== undefined && !isNonEmptyString(meta.scope.id)) {
      addError(
        "invalid_scope_id",
        "$.meta.scope.id",
        "meta.scope.id must be a non-empty string when present."
      );
    }
    if (
      meta.scope.label !== undefined &&
      !isNonEmptyString(meta.scope.label)
    ) {
      addError(
        "invalid_scope_label",
        "$.meta.scope.label",
        "meta.scope.label must be a non-empty string when present."
      );
    }
  }

  if (meta.count !== undefined && !isNonNegativeSafeInteger(meta.count)) {
    addError(
      "invalid_count",
      "$.meta.count",
      "meta.count must be a non-negative safe integer when present."
    );
  }

  for (const field of ["exhaustive", "truncated", "sampled"] as const) {
    if (typeof meta[field] !== "boolean") {
      addError(
        `invalid_${field}`,
        `$.meta.${field}`,
        `meta.${field} must be a boolean.`
      );
    }
  }

  if (meta.appliedFilters !== undefined && !isRecord(meta.appliedFilters)) {
    addError(
      "invalid_applied_filters",
      "$.meta.appliedFilters",
      "meta.appliedFilters must be an object when present."
    );
  }

  if (meta.sampled === true && meta.exhaustive === true) {
    addError(
      "sampled_exhaustive_conflict",
      "$.meta",
      "Sampled results cannot also be exhaustive."
    );
  }

  if (meta.sampled === true && meta.count !== undefined) {
    addError(
      "sampled_count_conflict",
      "$.meta.count",
      "Sampled results must not include meta.count in v1."
    );
  }

  if (meta.exhaustive === true && meta.truncated === true) {
    addError(
      "exhaustive_truncated_conflict",
      "$.meta",
      "Exhaustive results cannot also be truncated."
    );
  }

  validateReasonField({
    errors,
    fieldName: "truncationReason",
    path: "$.meta.truncationReason",
    value: meta.truncationReason,
    required: meta.truncated === true,
    missingCode: "missing_truncation_reason",
    invalidCode: "invalid_truncation_reason",
    missingMessage:
      "meta.truncationReason is required when meta.truncated is true.",
    invalidMessage:
      "meta.truncationReason must be a non-empty string when present.",
  });

  validateReasonField({
    errors,
    fieldName: "sampleMethod",
    path: "$.meta.sampleMethod",
    value: meta.sampleMethod,
    required: meta.sampled === true,
    missingCode: "missing_sample_method",
    invalidCode: "invalid_sample_method",
    missingMessage: "meta.sampleMethod is required when meta.sampled is true.",
    invalidMessage: "meta.sampleMethod must be a non-empty string when present.",
  });

  if (meta.pagination !== undefined) {
    validatePagination(meta.pagination, meta, errors);
  }

  return errors;
}

export function isDatabaseChatToolResult(
  result: unknown
): result is DatabaseChatToolResult {
  return validateToolResultContract(result).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function validateReasonField(options: {
  errors: DatabaseChatResultValidationError[];
  fieldName: string;
  path: string;
  value: unknown;
  required: boolean;
  missingCode: string;
  invalidCode: string;
  missingMessage: string;
  invalidMessage: string;
}) {
  const {
    errors,
    path,
    value,
    required,
    missingCode,
    invalidCode,
    missingMessage,
    invalidMessage,
  } = options;

  if (required && value === undefined) {
    errors.push({ code: missingCode, path, message: missingMessage });
    return;
  }

  if (value !== undefined && !isNonEmptyString(value)) {
    errors.push({ code: invalidCode, path, message: invalidMessage });
  }
}

function validatePagination(
  pagination: unknown,
  meta: Record<string, unknown>,
  errors: DatabaseChatResultValidationError[]
) {
  const addError = (
    code: string,
    path: string,
    message: string
  ): void => {
    errors.push({ code, path, message });
  };

  if (!isRecord(pagination)) {
    addError(
      "invalid_pagination",
      "$.meta.pagination",
      "meta.pagination must be an object when present."
    );
    return;
  }

  if (meta.sampled === true) {
    addError(
      "pagination_sampled_conflict",
      "$.meta.pagination",
      "Pagination is only valid for non-sampled results."
    );
  }

  if (typeof pagination.hasMore !== "boolean") {
    addError(
      "invalid_pagination_has_more",
      "$.meta.pagination.hasMore",
      "meta.pagination.hasMore must be a boolean."
    );
  }

  if (
    pagination.cursor !== undefined &&
    pagination.cursor !== null &&
    typeof pagination.cursor !== "string"
  ) {
    addError(
      "invalid_pagination_cursor",
      "$.meta.pagination.cursor",
      "meta.pagination.cursor must be a string or null when present."
    );
  }

  if (pagination.hasMore === true) {
    if (!isNonEmptyString(pagination.nextCursor)) {
      addError(
        "pagination_cursor_required",
        "$.meta.pagination.nextCursor",
        "meta.pagination.nextCursor must be a non-empty string when hasMore is true."
      );
    }

    if (meta.exhaustive === true) {
      addError(
        "pagination_exhaustive_conflict",
        "$.meta.pagination",
        "A result with more pages cannot also be exhaustive."
      );
    }
  } else if (
    pagination.nextCursor !== undefined &&
    pagination.nextCursor !== null &&
    !isNonEmptyString(pagination.nextCursor)
  ) {
    addError(
      "invalid_pagination_next_cursor",
      "$.meta.pagination.nextCursor",
      "meta.pagination.nextCursor must be a non-empty string or null when present."
    );
  }

  if (
    pagination.pageSize !== undefined &&
    !isNonNegativeSafeInteger(pagination.pageSize)
  ) {
    addError(
      "invalid_pagination_page_size",
      "$.meta.pagination.pageSize",
      "meta.pagination.pageSize must be a non-negative safe integer when present."
    );
  }
}
