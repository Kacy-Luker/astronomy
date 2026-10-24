// Keep the Import workflow's dropdowns in step with the data: notebooks from
// data/notebooks/, and categories from data/categories.json.
//
//   node scripts/sync-workflow.mjs          rewrite the lists
//   node scripts/sync-workflow.mjs --check  exit 1 if one is out of date
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { CATEGORIES } from "./lib/categories.mjs";

const WORKFLOW = ".github/workflows/import-notebook.yml";
export const NEW = "new-notebook";
export const AUTO = "Detect automatically";

const files = existsSync("data/notebooks") ? await readdir("data/notebooks") : [];
const ids = files.filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, "")).sort().reverse(); // newest notebook first
ids.push(NEW); // chosen, deliberately, to create a notebook

// Front cover routes the import to scripts/import-cover.mjs.
const categories = [AUTO, ...CATEGORIES.map((c) => c.label)];

const lists = { notebooks: ids, categories };
const yaml = await readFile(WORKFLOW, "utf8");
let updated = yaml;
for (const [name, items] of Object.entries(lists)) {
  const [start, end] = [`# ${name}:start`, `# ${name}:end`];
  const block = new RegExp(`^( *)${start}\\n[\\s\\S]*?^ *${end}$`, "m");
  const match = updated.match(block);
  if (!match) throw new Error(`${WORKFLOW} has no ${start} / ${end} block`);
  const indent = match[1];
  updated = updated.replace(block,
    [`${indent}${start}`, ...items.map((item) => `${indent}- ${item}`), `${indent}${end}`].join("\n"));
}

if (process.argv.includes("--check")) {
  if (updated !== yaml) {
    console.error(`${WORKFLOW}: a dropdown list is out of date; run node scripts/sync-workflow.mjs`);
    process.exit(1);
  }
} else if (updated !== yaml) {
  await writeFile(WORKFLOW, updated);
  console.log(`Updated the dropdown lists in ${WORKFLOW}`);
}
