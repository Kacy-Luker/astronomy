// Image steps shared by the notebook scripts: spreads in, pages out.
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import sharp from "sharp";

export const PAGE_HEIGHT = 1600;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);

export const pageImage = (notebookId, index) =>
  join("scans", notebookId, `${String(index + 1).padStart(2, "0")}.jpg`);

// The scanned spreads in order: embedded images from a PDF, a single image,
// or a folder of images.
export async function listSpreads(source, workDir) {
  const ext = extname(source).toLowerCase();
  if (ext === ".pdf") {
    // pdfimages (poppler-utils) extracts the scanned JPEGs without re-encoding.
    execFileSync("pdfimages", ["-j", source, join(workDir, "spread")]);
    return (await readdir(workDir)).filter((f) => f.startsWith("spread")).sort()
      .map((f) => join(workDir, f));
  }
  if (IMAGE_EXT.has(ext)) return [source];
  return (await readdir(source))
    .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
    .sort()
    .map((f) => join(source, f));
}

// Rotate a spread upright and cut it at the fold into [left, right].
export async function splitSpread(file, { rotate = 90, split = 0.47 } = {}) {
  const upright = await sharp(file).rotate(rotate).toBuffer();
  const { width, height } = await sharp(upright).metadata();
  const fold = Math.round(width * split);
  return Promise.all([
    { left: 0, top: 0, width: fold, height },
    { left: fold, top: 0, width: width - fold, height },
  ].map((half) => sharp(upright).extract(half).toBuffer()));
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
