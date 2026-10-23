// Turn a notebook scan into one web-sized image per page.
//
//   node scripts/split-notebook.mjs <notebook-id> <scan.pdf | folder of images>
//
// Each scan is a two-page spread. It is rotated upright, cut at its fold
// (found in each spread), and written to scans/<notebook-id>/01.jpg, 02.jpg,
// ... in page order. Rotation, the fallback fold position, and blurred
// regions come from data/notebooks/<notebook-id>.json when it exists.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanShowThrough, listSpreads, pageImage, redact, splitSpreads, webImage } from "./lib/pages.mjs";

const [id, source] = process.argv.slice(2);
if (!id || !source) {
  console.error("usage: node scripts/split-notebook.mjs <notebook-id> <scan.pdf | folder>");
  process.exit(2);
}

const notebookPath = join("data", "notebooks", `${id}.json`);
const notebook = existsSync(notebookPath) ? JSON.parse(await readFile(notebookPath, "utf8")) : {};

const work = await mkdtemp(join(tmpdir(), "notebook-"));
const spreads = await listSpreads(source, work);

await rm(join("scans", id), { recursive: true, force: true });
await mkdir(join("scans", id), { recursive: true });

const { pages } = await splitSpreads(spreads, notebook.scan);
let n = 0;
for (const page of pages) {
  const boxes = notebook.pages?.[n]?.redact;
  await writeFile(pageImage(id, n), await webImage(await redact(page, boxes)));
  n++;
}
await rm(work, { recursive: true, force: true });

console.log(`Wrote ${n} pages from ${spreads.length} spreads to scans/${id}/`);
cleanShowThrough(id);
if (notebook.pages && notebook.pages.length !== n) {
  console.warn(`Warning: ${notebookPath} lists ${notebook.pages.length} pages, the scan has ${n}.`);
}
