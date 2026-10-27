// Kinds of notebook (data/notebook-types.json, #48): how a notebook's scans
// become pages and how its pages are read. A notebook names its type; one
// without names the first.
import { readFileSync } from "node:fs";

export const TYPES = JSON.parse(readFileSync(new URL("../../data/notebook-types.json", import.meta.url), "utf8")).types;

// The type with this id or label, or null.
export const findType = (name) => TYPES.find((t) => t.id === name || t.label === name) ?? null;

// A notebook's type.
export const typeOf = (notebook) => (notebook?.type ? findType(notebook.type) : TYPES[0]);

// What the import can't do yet for a type, or null when it can do all of it.
export function unsupported(type) {
  if (type.scan.pages !== 2) return "single-sheet scans";
  if (type.form !== "stamped") return "notebooks without the stamped form (#109)";
  return null;
}
