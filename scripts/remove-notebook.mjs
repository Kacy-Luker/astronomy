// Remove a notebook from the site: its notebook file, page images, and every
// session written in it.
//
//   node scripts/remove-notebook.mjs <notebook-id> [--summary out.md]
//
// The original scans in the private astronomy-scans repo are left alone.
import { existsSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatJSON } from "./lib/format-json.mjs";

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
const notebook = JSON.parse(await readFile(notebookPath, "utf8"));

const sessions = [];
for (const file of (await readdir(join("data", "sessions"))).filter((f) => f.endsWith(".json"))) {
  const session = JSON.parse(await readFile(join("data", "sessions", file), "utf8"));
  if (session.notebook === id) sessions.push({ file, session });
}

await rm(notebookPath);
await rm(join("scans", id), { recursive: true, force: true });
for (const { file } of sessions) await rm(join("data", "sessions", file));

// Drop catalog info for objects no remaining session observed.
const objectsPath = join("data", "objects.json");
if (existsSync(objectsPath)) {
  const doc = JSON.parse(await readFile(objectsPath, "utf8"));
  const seen = new Set();
  for (const file of (await readdir(join("data", "sessions"))).filter((f) => f.endsWith(".json"))) {
    const s = JSON.parse(await readFile(join("data", "sessions", file), "utf8"));
    for (const o of s.observations ?? []) for (const x of o.ids ?? [o.catalog_id]) seen.add(x);
  }
  doc.objects = Object.fromEntries(Object.entries(doc.objects).filter(([, o]) => o.ids.some((x) => seen.has(x))));
  await writeFile(objectsPath, formatJSON(doc) + "\n");
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
