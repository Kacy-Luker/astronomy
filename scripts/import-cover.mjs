// Import a notebook's outside front cover: a scan of the closed notebook.
//
//   node scripts/import-cover.mjs <notebook-id> <scan> [--summary out.md]
//
// The scanner bed around the notebook is trimmed off, the cover is turned
// upright (portrait), and it's saved as scans/<id>/cover-front.jpg. Running
// it again replaces the cover, which is how it's rescanned on completion.
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { formatJSON } from "./lib/format-json.mjs";
import { listSpreads, webImage } from "./lib/pages.mjs";

const { positionals: [id, source], values: opts } = parseArgs({
  allowPositionals: true,
  options: { summary: { type: "string" } },
});
if (!id || !source) {
  console.error("usage: node scripts/import-cover.mjs <notebook-id> <scan> [--summary out.md]");
  process.exit(2);
}

const notebookPath = join("data", "notebooks", `${id}.json`);
if (!existsSync(notebookPath)) throw new Error(`there is no notebook ${id}; make it with Create new notebook first`);
const notebook = JSON.parse(await readFile(notebookPath, "utf8"));

const work = await mkdtemp(join(tmpdir(), "cover-"));
const files = await listSpreads(source, work);
if (files.length > 1) throw new Error(`${basename(source)} has ${files.length} images; upload just the front cover`);
// The bed is lighter than the cover; trimming can fail on an odd scan, and
// then the whole scan is kept.
let cover = await sharp(files[0]).rotate().toBuffer();
try {
  cover = await sharp(cover).trim({ threshold: 40 }).toBuffer();
} catch { /* keep it untrimmed */ }
const { width, height } = await sharp(cover).metadata();
if (width > height) cover = await sharp(cover).rotate(notebook.scan?.rotate ?? 90).toBuffer();
await rm(work, { recursive: true, force: true });

const replaced = Boolean(notebook.front_cover);
await writeFile(join("scans", id, "cover-front.jpg"), await webImage(cover));
// Recreate the notebook with front_cover just before its pages, keeping the
// key order of the hand-edited file.
const { pages, front_cover: _, ...rest } = notebook;
await writeFile(notebookPath, formatJSON({ ...rest, front_cover: {}, pages }) + "\n");

const summary = [
  `${replaced ? "Replaced" : "Added"} the front cover of **${notebook.title}** from \`${basename(source)}\`.`,
  "",
  "Check in the preview that it's upright and trimmed to the cover. The scanner bed around it is cut off automatically.",
].join("\n") + "\n";
if (opts.summary) await writeFile(opts.summary, summary);
console.log(summary);
