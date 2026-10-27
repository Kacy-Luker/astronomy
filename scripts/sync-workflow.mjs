// Keep the dropdowns on the Import, Complete notebook and Remove notebook
// forms in step with the data: notebooks from data/notebooks/, categories
// from data/categories.json, and the notebook types the import can handle
// from data/notebook-types.json.
//
//   node scripts/sync-workflow.mjs          rewrite the lists
//   node scripts/sync-workflow.mjs --check  exit 1 if one is out of date
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { CATEGORIES } from "./lib/categories.mjs";
import { TYPES, unsupported } from "./lib/notebook-types.mjs";

const WORKFLOWS = ["import-notebook", "complete-notebook", "remove-notebook"]
  .map((name) => `.github/workflows/${name}.yml`);
export const NEW = "new-notebook";
export const AUTO = "Detect automatically";

const files = existsSync("data/notebooks") ? await readdir("data/notebooks") : [];
const ids = files.filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, "")).sort().reverse(); // newest notebook first

// Front cover routes the import to scripts/import-cover.mjs.
const categories = [AUTO, ...CATEGORIES.map((c) => c.label)];

// Import also offers new-notebook, chosen deliberately to create one; the
// other forms only take existing notebooks (a dropdown can't be empty).
const lists = {
  notebooks: [...ids, NEW],
  "existing-notebooks": ids.length ? ids : ["none"],
  categories,
  "notebook-types": TYPES.filter((t) => !unsupported(t)).map((t) => t.label),
};
let stale = [];
for (const workflow of WORKFLOWS) {
  const yaml = await readFile(workflow, "utf8");
  let updated = yaml;
  // Each form has the lists it needs between start/end markers.
  for (const [name, items] of Object.entries(lists)) {
    const [start, end] = [`# ${name}:start`, `# ${name}:end`];
    const block = new RegExp(`^( *)${start}\\n[\\s\\S]*?^ *${end}$`, "m");
    const match = updated.match(block);
    if (!match) continue;
    const indent = match[1];
    updated = updated.replace(block,
      [`${indent}${start}`, ...items.map((item) => `${indent}- ${item}`), `${indent}${end}`].join("\n"));
  }
  if (updated === yaml) continue;
  stale.push(workflow);
  if (!process.argv.includes("--check")) await writeFile(workflow, updated);
}

if (process.argv.includes("--check") && stale.length) {
  console.error(`${stale.join(", ")}: a dropdown list is out of date; run node scripts/sync-workflow.mjs`);
  process.exit(1);
} else if (stale.length) {
  console.log(`Updated the dropdown lists in ${stale.join(", ")}`);
}
