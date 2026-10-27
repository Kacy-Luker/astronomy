// Import a notebook's outside front cover: a scan of the closed notebook.
//
//   node scripts/import-cover.mjs <notebook-id> <scan> [--summary out.md]
//
// The scanner lid around the notebook is trimmed off, the cover is turned
// upright (portrait), and it's saved as scans/<id>/cover-front.jpg. Running
// it again replaces the cover, which is how it's rescanned on completion.
// A closed-notebook scan among the pages is found by the page import too.
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { coverImage } from "./lib/cover.mjs";
import { readJSON, writeJSON } from "./lib/files.mjs";
import { webImage } from "./lib/pages.mjs";
import { listSpreads } from "./lib/scans.mjs";

const { positionals: [id, source], values: opts } = parseArgs({
  allowPositionals: true,
  options: { summary: { type: "string" } },
});
if (!id || !source) {
  console.error("usage: node scripts/import-cover.mjs <notebook-id> <scan> [--summary out.md]");
  process.exit(2);
}

const notebookPath = join("data", "notebooks", `${id}.json`);
if (!existsSync(notebookPath)) throw new Error(`there is no notebook ${id}; import its pages with new-notebook picked first`);
const notebook = await readJSON(notebookPath);

const work = await mkdtemp(join(tmpdir(), "cover-"));
const files = await listSpreads(source, work);
if (files.length > 1) throw new Error(`${basename(source)} has ${files.length} images; upload just the front cover`);
const cover = await coverImage(files[0], notebook.scan?.rotate ?? 90);
await rm(work, { recursive: true, force: true });

const replaced = Boolean(notebook.front_cover);
await writeFile(join("scans", id, "cover-front.jpg"), await webImage(cover));
// Recreate the notebook with front_cover just before its pages, keeping the
// key order of the hand-edited file.
const { pages, front_cover: _, ...rest } = notebook;
await writeJSON(notebookPath, { ...rest, front_cover: {}, pages });

const summary = [
  `${replaced ? "Replaced" : "Added"} the front cover of **${notebook.title}** from \`${basename(source)}\`.`,
  "",
  "Check in the preview that it's upright and trimmed to the cover. The scanner lid around it is cut off automatically.",
].join("\n") + "\n";
if (opts.summary) await writeFile(opts.summary, summary);
console.log(summary);
