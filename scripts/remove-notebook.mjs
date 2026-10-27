// Remove a notebook from the site: its notebook file, page images, and every
// session written in it.
//
//   node scripts/remove-notebook.mjs <notebook-id> [--summary out.md]
//
// The original scans in the private astronomy-scans repo are left alone.
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { readJSON, readJSONDir, writeJSON } from "./lib/files.mjs";

const { positionals: [id], values: opts } = parseArgs({
  allowPositionals: true,
  options: { summary: { type: "string" } },
});
if (!id) {
  console.error("usage: node scripts/remove-notebook.mjs <notebook-id> [--summary out.md]");
  process.exit(2);
}

const notebookPath = join("data", "notebooks", `${id}.json`);
if (!existsSync(notebookPath)) throw new Error(`there is no notebook ${id}`);
const notebook = await readJSON(notebookPath);

const sessions = (await readJSONDir(join("data", "sessions")))
  .filter(({ data }) => data.notebook === id).map(({ path, data }) => ({ file: basename(path), session: data }));

await rm(notebookPath);
await rm(join("scans", id), { recursive: true, force: true });
for (const { file } of sessions) await rm(join("data", "sessions", file));

// Drop catalog info for objects no remaining session observed.
const objectsPath = join("data", "objects.json");
if (existsSync(objectsPath)) {
  const doc = await readJSON(objectsPath);
  const seen = new Set();
  for (const { data: s } of await readJSONDir(join("data", "sessions"))) {
    for (const o of s.observations ?? []) for (const x of o.ids ?? [o.catalog_id]) seen.add(x);
  }
  doc.objects = Object.fromEntries(Object.entries(doc.objects).filter(([, o]) => o.ids.some((x) => seen.has(x))));
  await writeJSON(objectsPath, doc);
}

const lines = [
  `Removes **${notebook.title}** (\`${id}\`) from the site:`,
  "",
  `- \`${notebookPath}\``,
  `- \`scans/${id}/\` (${notebook.pages.length} page images)`,
  ...sessions.map(({ file, session }) => `- \`data/sessions/${file}\`: ${session.date}, ` +
    `${session.observations.map((o) => o.catalog_id).join(", ") || "no observations"}`),
  "",
  "Nothing is deleted until this pull request is merged; close it to keep the notebook.",
  "The original scans in astronomy-scans are not touched.",
];
const summary = lines.join("\n") + "\n";
if (opts.summary) await writeFile(opts.summary, summary);
console.log(summary);
