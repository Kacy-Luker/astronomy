// Turn a notebook scan into one web-sized image per page.
//
//   node scripts/split-notebook.mjs <notebook-id> <scan.pdf | folder of images>
//
// Each scan is a two-page spread. It is rotated upright, cut at the fold,
// and written to scans/<notebook-id>/01.jpg, 02.jpg, ... in page order.
// Rotation, fold position, and blurred regions come from
// data/notebooks/<notebook-id>.json when it exists.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import sharp from "sharp";

const PAGE_HEIGHT = 1600;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);

const [id, source] = process.argv.slice(2);
if (!id || !source) {
  console.error("usage: node scripts/split-notebook.mjs <notebook-id> <scan.pdf | folder>");
  process.exit(2);
}

const notebookPath = join("data", "notebooks", `${id}.json`);
const notebook = existsSync(notebookPath) ? JSON.parse(await readFile(notebookPath, "utf8")) : {};
const rotate = notebook.scan?.rotate ?? 90;
const split = notebook.scan?.split ?? 0.47;

// Collect the spreads in order: embedded images from a PDF, or a folder.
const work = await mkdtemp(join(tmpdir(), "notebook-"));
let spreads;
if (extname(source).toLowerCase() === ".pdf") {
  // pdfimages (poppler-utils) extracts the scanned JPEGs without re-encoding.
  execFileSync("pdfimages", ["-j", source, join(work, "spread")]);
  spreads = (await readdir(work)).sort().map((f) => join(work, f));
} else {
  spreads = (await readdir(source))
    .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
    .sort()
    .map((f) => join(source, f));
}

// Blur each [x, y, w, h] box (fractions of the page) beyond recognition.
async function redact(page, boxes) {
  const { width, height } = await sharp(page).metadata();
  const patches = [];
  for (const [x, y, w, h] of boxes) {
    const box = {
      left: Math.round(x * width), top: Math.round(y * height),
      width: Math.round(w * width), height: Math.round(h * height),
    };
    const coarse = await sharp(page).extract(box)
      .resize(Math.max(1, box.width >> 5), Math.max(1, box.height >> 5)).toBuffer();
    const input = await sharp(coarse).resize(box.width, box.height).blur(12).toBuffer();
    patches.push({ input, left: box.left, top: box.top });
  }
  return sharp(page).composite(patches).toBuffer();
}

const outDir = join("scans", id);
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

let n = 0;
for (const file of spreads) {
  const upright = await sharp(file).rotate(rotate).toBuffer();
  const { width, height } = await sharp(upright).metadata();
  const fold = Math.round(width * split);
  const halves = [
    { left: 0, top: 0, width: fold, height },
    { left: fold, top: 0, width: width - fold, height },
  ];
  for (const half of halves) {
    let page = await sharp(upright).extract(half).toBuffer();
    const boxes = notebook.pages?.[n]?.redact;
    if (boxes?.length) page = await redact(page, boxes);
    n++;
    const out = join(outDir, `${String(n).padStart(2, "0")}.jpg`);
    await writeFile(out, await sharp(page)
      .resize({ height: PAGE_HEIGHT, withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer());
  }
}
await rm(work, { recursive: true, force: true });

console.log(`Wrote ${n} pages from ${spreads.length} spreads to ${outDir}/`);
if (notebook.pages && notebook.pages.length !== n) {
  console.warn(`Warning: ${notebookPath} lists ${notebook.pages.length} pages, the scan has ${n}.`);
}
