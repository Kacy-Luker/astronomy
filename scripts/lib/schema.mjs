// Data formats (docs/DEPENDENCIES.md): the one place that uses the schema
// library (zod), so it can be swapped by rewriting this file. Formats are
// built with z, as in scripts/lib/reading.mjs; check() tests a value
// against one, and asJSONSchema() gives one as a JSON Schema for a prompt.
import { z } from "zod";

export { z };

// { ok: true, data } with the value as the format reads it, or
// { ok: false, problem } saying what doesn't fit.
export function check(format, value) {
  const result = format.safeParse(value);
  return result.success ? { ok: true, data: result.data } : { ok: false, problem: z.prettifyError(result.error) };
}

export const asJSONSchema = (format) => z.toJSONSchema(format);
