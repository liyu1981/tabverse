/**
 * Reading a constrained JSON reply, and the fallbacks a model needs.
 *
 * The AI calls that want a shape (`naming`, `summarize`, `rewriteNote`) pass a
 * JSON schema as `responseConstraint`. Not every API shape honours it, and a
 * model that ignores it answers in prose anyway, so the parsers take the JSON
 * field first and fall back to the text. `naming.ts` has its own reader (it
 * wants an array of strings, not one); this is the one-field case the other two
 * share.
 */

/** The body of a ``` fence that wraps the whole reply, or the text itself. */
export function stripOuterFence(text: string): string {
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(text);
  return fenced ? fenced[1] : text;
}

/**
 * The string at `field` of a JSON reply, or null when the reply is not JSON or
 * the field is not a string.
 */
export function stringFieldFromJson(
  text: string,
  field: string,
): string | null {
  try {
    const value: unknown = JSON.parse(stripOuterFence(text));
    if (value !== null && typeof value === 'object') {
      const found = (value as Record<string, unknown>)[field];
      if (typeof found === 'string') {
        return found;
      }
    }
  } catch {
    // Not JSON: the caller's text path handles it.
  }
  return null;
}
