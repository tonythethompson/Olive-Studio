/**
 * Request-body boundary parser for route handlers.
 *
 * Express's `express.json()` middleware leaves `req.body` as `any`: a client
 * can send a number where the handler expects a string, or an array where it
 * expects an object. `parseBody` converts that untyped value into a
 * discriminated result so handlers only ever touch trusted, field-typed data
 * (Law 2: parse at the boundary, don't validate deep in the handler).
 */
export type BodyFieldType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "string[]"
  | "json"
  | "unknown";

export interface BodyFieldSpec {
  /** The shape the field must have when present. */
  type: BodyFieldType;
  /** Whether the field must be present. Defaults to `true`. */
  required?: boolean;
  /**
   * Overrides the error returned when a required field is absent.
   * Type mismatches always use the generated `"<field> must be <type>"` message.
   */
  message?: string;
}

export type BodySpec<T extends Record<string, unknown>> = {
  [K in keyof T]: BodyFieldSpec;
};

export type ParseBodyResult<T> =
  | { parsed: T; error?: never }
  | { error: string; parsed?: never };

/** Narrows a `parseBody` result to the error branch for safe early returns. */
export function isParseBodyError<T>(result: ParseBodyResult<T>): result is { error: string } {
  return "error" in result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonString(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

const TYPE_CHECKERS: Record<BodyFieldType, (value: unknown) => boolean> = {
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  boolean: (value) => typeof value === "boolean",
  object: (value) => isPlainObject(value),
  "string[]": (value) =>
    Array.isArray(value) && value.every((item) => typeof item === "string"),
  // Recipes arrive either pre-parsed or as a JSON string.
  json: (value) => isPlainObject(value) || (typeof value === "string" && isJsonString(value)),
  // Pass-through fields with their own lenient handling downstream (e.g. clamps).
  // Does not narrow the parsed generic — callers must treat these as `unknown`.
  unknown: () => true,
};

const TYPE_DESCRIPTIONS: Record<BodyFieldType, string> = {
  string: "a string",
  number: "a number",
  boolean: "a boolean",
  object: "an object",
  "string[]": "an array of strings",
  json: "a string or JSON object",
  unknown: "a value",
};

/** Undefined, null, and empty strings for string-like fields count as absent. */
function isFieldMissing(spec: BodyFieldSpec, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return (spec.type === "string" || spec.type === "json") && value === "";
}

export function parseBody<T extends Record<string, unknown>>(
  body: unknown,
  spec: BodySpec<T>,
): ParseBodyResult<T> {
  if (!isPlainObject(body)) {
    return { error: "Request body must be a JSON object" };
  }

  const parsed: Record<string, unknown> = {};
  for (const field of Object.keys(spec) as Array<keyof T & string>) {
    const fieldSpec = spec[field];
    const value = body[field];
    if (isFieldMissing(fieldSpec, value)) {
      if (fieldSpec.required ?? true) {
        return {
          error:
            fieldSpec.message ??
            `${field} is required and must be ${TYPE_DESCRIPTIONS[fieldSpec.type]}`,
        };
      }
      continue;
    }
    if (!TYPE_CHECKERS[fieldSpec.type](value)) {
      return { error: `${field} must be ${TYPE_DESCRIPTIONS[fieldSpec.type]}` };
    }
    parsed[field] = value;
  }

  return { parsed: parsed as T };
}
