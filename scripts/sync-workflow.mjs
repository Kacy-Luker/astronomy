// Keep the Import workflow's notebook dropdown in step with data/notebooks/.
//
//   node scripts/sync-workflow.mjs          rewrite the list
//   node scripts/sync-workflow.mjs --check  exit 1 if it's out of date
import { readFile, readdir, writeFile } from "node:fs/promises";

const WORKFLOW = ".github/workflows/import-notebook.yml";
const START = "# notebooks:start";
const END = "# notebooks:end";

const ids = (await readdir("data/notebooks")).filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, "")).sort().reverse(); // newest notebook first

const yaml = await readFile(WORKFLOW, "utf8");
const block = new RegExp(`^( *)${START}\\n[\\s\\S]*?^ *${END}$`, "m");
const match = yaml.match(block);
if (!match) throw new Error(`${WORKFLOW} has no ${START} / ${END} block`);
const indent = match[1];
const updated = yaml.replace(block,
  [`${indent}${START}`, ...ids.map((id) => `${indent}- ${id}`), `${indent}${END}`].join("\n"));

if (process.argv.includes("--check")) {
  if (updated !== yaml) {
    console.error(`${WORKFLOW}: the notebook list is out of date; run node scripts/sync-workflow.mjs`);
    process.exit(1);
  }
} else if (updated !== yaml) {
  await writeFile(WORKFLOW, updated);
  console.log(`Updated the notebook list in ${WORKFLOW}: ${ids.join(", ")}`);
}
