// Remove stamp show-through from every page of a notebook.
//
//   node scripts/clean-notebook.mjs <notebook-id>
//
// Writes scans/<id>/NN.clean.jpg beside each page image that could be
// cleaned (see scripts/lib/showthrough.mjs). Imports do this automatically
// for the pages they touch.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pageImage } from "./lib/pages.mjs";
import { cleanPages } from "./lib/showthrough.mjs";

const [id] = process.argv.slice(2);
if (!id) {
  console.error("usage: node scripts/clean-notebook.mjs <notebook-id>");
  process.exit(2);
}
const count = (await readdir(join("scans", id))).filter((f) => /^\d+\.jpg$/.test(f)).length;
const cleaned = await cleanPages(id, [...Array(count).keys()], pageImage);
console.log(`Cleaned ${cleaned.length} of ${count} pages in scans/${id}/`);
