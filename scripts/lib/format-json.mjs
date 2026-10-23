// JSON laid out for hand editing: short lists and flat objects stay on one line.
const WIDTH = 100;

// Primitives, and lists made only of them (at any depth), print inline.
const simple = (v) => v === null || typeof v !== "object" || (Array.isArray(v) && v.every(simple));
const inline = (v) => (Array.isArray(v) ? `[${v.map(inline).join(", ")}]` : JSON.stringify(v));

// prefix is how much of the line is already used (indent plus any key).
export function formatJSON(value, indent = "", prefix = indent.length) {
  if (simple(value)) return inline(value);
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    return `[\n${value.map((x) => inner + formatJSON(x, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return "{}";
  if (entries.every(([, v]) => simple(v))) {
    const oneLine = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }`;
    if (prefix + oneLine.length <= WIDTH) return oneLine;
  }
  return `{\n${entries.map(([k, v]) => {
    const key = `${inner}${JSON.stringify(k)}: `;
    return key + formatJSON(v, inner, key.length);
  }).join(",\n")}\n${indent}}`;
}
