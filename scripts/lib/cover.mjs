// The outside front cover from a scan of the closed notebook. The notebook
// lies in the scanner's corner and the lid (or bed) fills the rest, so the
// lid's shade is taken near the far (bottom right) corner, and the cover is
// the rows and columns mostly unlike it. Sharp's trim doesn't do here: the
// scanner's edges leave dark and light strips along the border. The cover
// is then turned upright (portrait).
import { image, size } from "./image.mjs";

const W = 200; // measure at this width
const DIFF = 40; // grey levels from the lid that count as cover
const PAPER = 180; // grey levels paper (and a tan board) is lighter than

// Whether half a scanned spread is the scanner's lid rather than a page: the
// lid is grey, and pages, the outside cover included, are mostly paper. On
// Astronomy 001's scans the lid is 9% paper-light and pages 96-99% (#16),
// so the closed-notebook scan is found without asking Claude, which mixes
// up the cover's volume label and the title page.
export async function isLid(page) {
  const { data } = await image(page).grey().resize({ width: 100 }).pixels();
  let light = 0;
  for (const v of data) light += v > PAPER;
  return light / data.length < 0.5;
}

export async function coverImage(file, rotate = 90) {
  const scan = await image(file).rotate().buffer();
  const { width, height } = await size(scan);
  const { data, width: w, height: h } = await image(scan).grey().resize({ width: W }).pixels();
  // The lid's shade: the median of a patch inset from the corner, clear of
  // the edge strips.
  const patch = [];
  for (let y = Math.round(h * 0.88); y < Math.round(h * 0.95); y++) {
    for (let x = Math.round(w * 0.88); x < Math.round(w * 0.95); x++) patch.push(data[y * w + x]);
  }
  const lid = patch.sort((a, b) => a - b)[patch.length >> 1];
  const cover = (x, y) => Math.abs(data[y * w + x] - lid) > DIFF;
  const rows = [], cols = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) n += cover(x, y);
    rows.push(n / w);
  }
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = 0; y < h; y++) n += cover(x, y);
    cols.push(n / h);
  }
  // Rows and columns at least a third cover, trimmed in from each side.
  const first = (a) => a.findIndex((f) => f > 1 / 3), last = (a) => a.findLastIndex((f) => f > 1 / 3);
  let out = scan;
  if (first(rows) >= 0 && first(cols) >= 0) {
    const sx = width / w, sy = height / h;
    const left = Math.round(first(cols) * sx), top = Math.round(first(rows) * sy);
    const right = Math.min(width, Math.round((last(cols) + 1) * sx)), bottom = Math.min(height, Math.round((last(rows) + 1) * sy));
    // Keep the whole scan when what's left is too small to be the cover.
    if ((right - left) * (bottom - top) > width * height * 0.15) {
      out = await image(scan).crop({ left, top, width: right - left, height: bottom - top }).buffer();
    }
  }
  const shape = await size(out);
  if (shape.width > shape.height) out = await image(out).rotate(rotate).buffer();
  return out;
}
