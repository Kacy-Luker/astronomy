// Image steps shared by the notebook scripts: spreads in, pages out.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { image, size } from "./image.mjs";

export const PAGE_HEIGHT = 1600;

export const pageImage = (notebookId, index) =>
  join("scans", notebookId, `${String(index + 1).padStart(2, "0")}.jpg`);

const FOLD_RANGE = [0.40, 0.56]; // where the fold can be, as a share of the spread's width
const MIN_FOLD_SCORE = 0.2; // weaker detections fall back to the other spreads' fold

// Where the fold is in an upright spread, as a share of its width. The fold is
// a thin crease a little darker than both sides for most of the page's height,
// and the cut must not go through writing. Scanner placement moves it from
// spread to spread, so it's found in each one.
export async function findFold(upright) {
  const { data, width: w, height: h } = await image(upright).grey().resize({ width: Math.round((await size(upright)).width / 2) }).pixels();
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
  const uprights = await Promise.all(files.map((f) => image(f).rotate(rotate).buffer()));
  const found = await Promise.all(uprights.map(findFold));
  const sure = found.filter((f) => f.confident).map((f) => f.fold).sort((a, b) => a - b);
  const fallback = sure.length ? sure[Math.floor(sure.length / 2)] : split;
  const pages = [];
  for (const [i, upright] of uprights.entries()) {
    const { width, height } = await size(upright);
    const fold = Math.round(width * (found[i].confident ? found[i].fold : fallback));
    pages.push(...await Promise.all([
      { left: 0, top: 0, width: fold, height },
      { left: fold, top: 0, width: width - fold, height },
    ].map((half) => image(upright).crop(half).buffer())));
  }
  return { pages, folds: found.map((f) => (f.confident ? f.fold : null)) };
}

// Blur each [x, y, w, h] box (fractions of the page) beyond recognition.
export async function redact(page, boxes = []) {
  if (!boxes.length) return page;
  const { width, height } = await size(page);
  const patches = [];
  for (const [x, y, w, h] of boxes) {
    const left = Math.max(0, Math.round(x * width));
    const top = Math.max(0, Math.round(y * height));
    const box = {
      left, top,
      width: Math.max(1, Math.min(width - left, Math.round(w * width))),
      height: Math.max(1, Math.min(height - top, Math.round(h * height))),
    };
    const coarse = await image(page).crop(box)
      .resize({ width: Math.max(1, box.width >> 5), height: Math.max(1, box.height >> 5) }).buffer();
    const input = await image(coarse).resize({ width: box.width, height: box.height }).blur(12).buffer();
    patches.push({ input, left: box.left, top: box.top });
  }
  return image(page).overlay(patches).buffer();
}

// The published, web-sized JPEG for a page.
export function webImage(page, height = PAGE_HEIGHT) {
  return image(page)
    .resize({ height, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .buffer();
}

// Remove stamp show-through from the sheets touching these page positions
// (all pages when none are given), writing scans/<id>/NN.clean.jpg. The work
// is done by scripts/showthrough.py; see requirements.txt.
export function cleanShowThrough(notebookId, positions = []) {
  const python = process.env.PYTHON ?? (existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3");
  execFileSync(python, ["scripts/showthrough.py", notebookId, ...positions.map(String)], { stdio: "inherit" });
}
