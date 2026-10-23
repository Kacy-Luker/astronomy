// Image steps shared by the notebook scripts: spreads in, pages out.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import sharp from "sharp";

export const PAGE_HEIGHT = 1600;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);

export const pageImage = (notebookId, index) =>
  join("scans", notebookId, `${String(index + 1).padStart(2, "0")}.jpg`);

// What a file really is, from its first bytes rather than its name.
async function sniff(path) {
  const handle = await open(path);
  const { buffer, bytesRead } = await handle.read(Buffer.alloc(64), 0, 64, 0);
  await handle.close();
  const head = buffer.subarray(0, bytesRead);
  const text = head.toString("latin1");
  if (text.startsWith("%PDF")) return "pdf";
  if (head[0] === 0xff && head[1] === 0xd8) return "jpeg";
  if (text.startsWith("\x89PNG")) return "png";
  if (text.startsWith("II*\0") || text.startsWith("MM\0*")) return "tiff";
  if (/^....ftyp(heic|heix|mif1|hevc)/s.test(text)) return "heic";
  if (text.startsWith("version https://git-lfs")) return "lfs-pointer";
  return `unknown (starts with ${JSON.stringify(text.slice(0, 24))}, ${(await stat(path)).size} bytes)`;
}

// The scanned spreads in order: embedded images from a PDF, a single image,
// or a folder of images.
export async function listSpreads(source, workDir) {
  if ((await stat(source)).isFile()) {
    const type = await sniff(source);
    if (type === "pdf") {
      // pdfimages (poppler-utils) extracts the scanned JPEGs without re-encoding.
      execFileSync("pdfimages", ["-j", source, join(workDir, "spread")]);
      const spreads = (await readdir(workDir)).filter((f) => f.startsWith("spread")).sort()
        .map((f) => join(workDir, f));
      if (!spreads.length) throw new Error(`${source} is a PDF with no scanned images in it`);
      return spreads;
    }
    if (["jpeg", "png", "tiff"].includes(type)) return [source];
    if (type === "heic") {
      throw new Error(`${source} is an iPhone HEIC photo; export it as JPEG or PDF and upload that`);
    }
    if (type === "lfs-pointer") {
      throw new Error(`${source} is a Git LFS pointer, not the scan; upload the file without LFS`);
    }
    throw new Error(`${source} isn't a PDF or image: ${type}. Open it on GitHub to check the upload worked`);
  }
  return (await readdir(source))
    .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
    .sort()
    .map((f) => join(source, f));
}

const FOLD_RANGE = [0.40, 0.56]; // where the fold can be, as a share of the spread's width
const MIN_FOLD_SCORE = 0.2; // weaker detections fall back to the other spreads' fold

// Where the fold is in an upright spread, as a share of its width. The fold is
// a thin crease a little darker than both sides for most of the page's height,
// and the cut must not go through writing. Scanner placement moves it from
// spread to spread, so it's found in each one.
export async function findFold(upright) {
  const { data, info } = await sharp(upright).grayscale().resize({ width: Math.round((await sharp(upright).metadata()).width / 2) })
    .raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // Smooth along the fold's direction (a 9-row running mean).
  const g = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < h + 4; y++) {
      if (y < h) sum += data[y * w + x];
      if (y >= 9) sum -= data[(y - 9) * w + x];
      const cy = y - 4;
      if (cy >= 0 && cy < h) g[cy * w + x] = sum / Math.min(9, y + 1, h - (y - 9 + 1) + 9);
    }
  }
  const [lo, hi] = FOLD_RANGE.map((f) => Math.round(f * w));
  const y0 = Math.round(h * 0.05), y1 = Math.round(h * 0.95);
  const scores = [];
  for (let x = lo; x < hi; x++) {
    let crease = 0, ink = 0;
    for (let y = y0; y < y1; y++) {
      const row = y * w, v = g[row + x];
      if (v < Math.min(g[row + x - 6], g[row + x + 6]) - 1.5) crease++;
      let brightest = 0;
      for (let k = x - 15; k <= x + 15; k++) brightest = Math.max(brightest, g[row + k]);
      if (v < 0.7 * brightest) ink++;
    }
    scores.push((crease - 2 * ink) / (y1 - y0));
  }
  const smooth = scores.map((_, i) => (scores[Math.max(i - 1, 0)] + scores[i] + scores[Math.min(i + 1, scores.length - 1)]) / 3);
  const best = smooth.indexOf(Math.max(...smooth));
  return { fold: (lo + best) / w, confident: smooth[best] >= MIN_FOLD_SCORE };
}

// Rotate each spread upright, find its fold, and cut it into [left, right]
// pages. A spread whose fold can't be seen uses the median of the others',
// or the notebook's usual position when none can be seen.
export async function splitSpreads(files, { rotate = 90, split = 0.47 } = {}) {
  const uprights = await Promise.all(files.map((f) => sharp(f).rotate(rotate).toBuffer()));
  const found = await Promise.all(uprights.map(findFold));
  const sure = found.filter((f) => f.confident).map((f) => f.fold).sort((a, b) => a - b);
  const fallback = sure.length ? sure[Math.floor(sure.length / 2)] : split;
  const pages = [];
  for (const [i, upright] of uprights.entries()) {
    const { width, height } = await sharp(upright).metadata();
    const fold = Math.round(width * (found[i].confident ? found[i].fold : fallback));
    pages.push(...await Promise.all([
      { left: 0, top: 0, width: fold, height },
      { left: fold, top: 0, width: width - fold, height },
    ].map((half) => sharp(upright).extract(half).toBuffer())));
  }
  return { pages, folds: found.map((f) => (f.confident ? f.fold : null)) };
}

// Blur each [x, y, w, h] box (fractions of the page) beyond recognition.
export async function redact(page, boxes = []) {
  if (!boxes.length) return page;
  const { width, height } = await sharp(page).metadata();
  const patches = [];
  for (const [x, y, w, h] of boxes) {
    const left = Math.max(0, Math.round(x * width));
    const top = Math.max(0, Math.round(y * height));
    const box = {
      left, top,
      width: Math.max(1, Math.min(width - left, Math.round(w * width))),
      height: Math.max(1, Math.min(height - top, Math.round(h * height))),
    };
    const coarse = await sharp(page).extract(box)
      .resize(Math.max(1, box.width >> 5), Math.max(1, box.height >> 5)).toBuffer();
    const input = await sharp(coarse).resize(box.width, box.height).blur(12).toBuffer();
    patches.push({ input, left: box.left, top: box.top });
  }
  return sharp(page).composite(patches).toBuffer();
}

// The published, web-sized JPEG for a page.
export function webImage(page, height = PAGE_HEIGHT) {
  return sharp(page)
    .resize({ height, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

// Remove stamp show-through from the sheets touching these page positions
// (all pages when none are given), writing scans/<id>/NN.clean.jpg. The work
// is done by scripts/showthrough.py; see requirements.txt.
export function cleanShowThrough(notebookId, positions = []) {
  const python = process.env.PYTHON ?? (existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3");
  execFileSync(python, ["scripts/showthrough.py", notebookId, ...positions.map(String)], { stdio: "inherit" });
}
