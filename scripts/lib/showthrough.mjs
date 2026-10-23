// Remove show-through: rubber-stamp ink from the back of a sheet soaks
// through and shows as a faint mirrored ghost on the front. The back page is
// scanned too, so it's mirrored, lined up with the front, and faint marks on
// the front where the back has dark ink are painted over with paper.
// Pencil doesn't soak through, and dark marks on the front are never touched.
import sharp from "sharp";

const BACK_INK = 0.55; // back pixels darker than this (relative to paper) are ink
const FRONT_FAINT = 0.75; // front pixels lighter than this may be ghosts
const GROW = 4; // pixels the back's ink is widened by, to cover blur and misfit
const MAX_MISMATCH = 12; // px two-way alignments of a sheet may disagree by

// Notebook position of the other side of a page's sheet: a right page (odd
// position) backs onto the next left page. The inside cover has no back.
export const backOf = (i) => (i === 0 ? null : i % 2 ? i + 1 : i - 1);

async function grayOf(input, { width, flop = false } = {}) {
  let img = sharp(input).grayscale();
  if (flop) img = img.flop();
  if (width) img = img.resize({ width });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { d: Float32Array.from(data), w: info.width, h: info.height };
}

// Separable sliding max over a (2r+1)-square window.
function maxFilter({ d, w, h }, r) {
  const tmp = new Float32Array(d.length), out = new Float32Array(d.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, d[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return { d: out, w, h };
}

async function blur({ d, w, h }, sigma) {
  const bytes = Buffer.from(Uint8Array.from(d, (v) => Math.max(0, Math.min(255, Math.round(v)))));
  const out = await sharp(bytes, { raw: { width: w, height: h, channels: 1 } }).blur(sigma).raw().toBuffer();
  return { d: Float32Array.from(out), w, h };
}

// Paper brightness around each pixel: ink removed by a max filter, then smoothed.
const paper = async (img, r, sigma) => blur(maxFilter(img, r), sigma);

// Brightness relative to the paper around it: 1 is paper, lower is ink.
function relative(img, bg) {
  return { d: img.d.map((v, i) => Math.min(1, v / Math.max(1, bg.d[i]))), w: img.w, h: img.h };
}

// Faint marks on the front and dark ink on the mirrored back, both scaled to
// the given width (the back keeps its size relative to the front).
async function inkMaps(frontBuf, backBuf, width) {
  const ratio = (await sharp(backBuf).metadata()).width / (await sharp(frontBuf).metadata()).width;
  const f = await grayOf(frontBuf, { width });
  const b = await grayOf(backBuf, { width: Math.round(width * ratio), flop: true });
  const fr = relative(f, await paper(f, 2, 8 * width / 1000));
  const br = relative(b, await paper(b, 2, 8 * width / 1000));
  // Faint pixels right beside the front's own dark lines are just their soft
  // edges, not ghosts, so they're left out.
  const nearDark = maxFilter({ ...fr, d: fr.d.map((v) => (v < 0.75 ? 1 : 0)) }, 1);
  const front = { ...fr, d: fr.d.map((v, i) => (!nearDark.d[i] && 1 - v > 0.02 && 1 - v < 0.25 ? 1 - v : 0)) };
  const back = { ...br, d: br.d.map((v) => (1 - v > 0.35 ? 1 - v : 0)) };
  return { front, back };
}

// How well the back's ink, shifted by (dx, dy), lands on the front's faint
// marks. Only the back's ink pixels are visited, so every shift can be tried.
function score(front, inkPixels, dx, dy) {
  let sum = 0, bb = 0;
  for (const [x, y, b] of inkPixels) {
    const tx = x + dx, ty = y + dy;
    if (tx < 0 || ty < 0 || tx >= front.w || ty >= front.h) continue;
    sum += front.d[ty * front.w + tx] * b;
    bb += b * b;
  }
  return bb ? sum / Math.sqrt(bb) : 0;
}

// Search every shift at quarter size. A shift is trusted when it stands out
// from the rest: the real ghost lines up in one place only.
export async function align(frontBuf, backBuf, fullWidth) {
  const width = Math.round(fullWidth / 4);
  const { front, back } = await inkMaps(frontBuf, backBuf, width);
  const inkPixels = [];
  for (let y = 0; y < back.h; y++) {
    for (let x = 0; x < back.w; x++) if (back.d[y * back.w + x]) inkPixels.push([x, y, back.d[y * back.w + x]]);
  }
  if (!inkPixels.length) return { score: 0, prominence: 0, dx: 0, dy: 0 };
  const scores = [];
  let best = { s: -1, dx: 0, dy: 0 };
  for (let dy = -30; dy <= 30; dy++) {
    for (let dx = -50; dx <= 50; dx++) {
      const s = score(front, inkPixels, dx, dy);
      scores.push(s);
      if (s > best.s) best = { s, dx, dy };
    }
  }
  const mean = scores.reduce((a, b) => a + b) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
  const scale = fullWidth / width;
  return { score: best.s, prominence: sd ? (best.s - mean) / sd : 0, dx: Math.round(best.dx * scale), dy: Math.round(best.dy * scale) };
}

// Clean both sides of one sheet. Each side is lined up against the other,
// and the two alignments must agree (mirrored, the shift one way implies the
// shift the other way); otherwise neither side is trusted and both come back
// null. A side also comes back null when nothing on it needed cleaning.
export async function cleanSheet(aBuf, bBuf) {
  const wa = (await sharp(aBuf).metadata()).width, wb = (await sharp(bBuf).metadata()).width;
  const ab = await align(aBuf, bBuf, wa), ba = await align(bBuf, aBuf, wb);
  const mismatch = Math.hypot(ba.dx - (wb - wa + ab.dx), ba.dy + ab.dy);
  if (mismatch > MAX_MISMATCH) return [null, null];
  return Promise.all([clean(aBuf, bBuf, ab), clean(bBuf, aBuf, ba)]);
}

// The front page with the back's ink ghosts painted over, as a JPEG.
async function clean(frontBuf, backBuf, { dx, dy }) {
  const { width: W, height: H } = await sharp(frontBuf).metadata();

  // The mirrored back, at the front's scale, placed where it lines up.
  const back = await grayOf(await sharp(backBuf).resize({ height: H }).toBuffer(), { flop: true });
  const canvas = { d: new Float32Array(W * H).fill(255), w: W, h: H };
  for (let y = 0; y < back.h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < back.w; x++) {
      const tx = x + dx;
      if (tx >= 0 && tx < W) canvas.d[ty * W + tx] = back.d[y * back.w + x];
    }
  }
  const backRel = relative(canvas, await paper(canvas, 4, 25));
  const ink = maxFilter({ d: backRel.d.map((v) => (v < BACK_INK ? 1 : 0)), w: W, h: H }, GROW);

  const front = await grayOf(frontBuf);
  const frontRel = relative(front, await paper(front, 4, 25));
  const { data: rgb } = await sharp(frontBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(rgb);
  // Paint with the paper's own color, per channel, so patches don't show.
  const channels = await Promise.all([0, 1, 2].map(async (c) => {
    const plane = { d: new Float32Array(W * H), w: W, h: H };
    for (let i = 0; i < W * H; i++) plane.d[i] = rgb[i * 3 + c];
    return paper(plane, 4, 25);
  }));
  let changed = 0;
  for (let i = 0; i < W * H; i++) {
    if (ink.d[i] && frontRel.d[i] > FRONT_FAINT) {
      for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(channels[c].d[i]);
      changed++;
    }
  }
  if (!changed) return null;
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
}

// Write scans/<id>/NN.clean.jpg for every sheet that includes one of the
// given page positions, or remove a stale one when a side can't be cleaned.
// A sheet needs both sides scanned; until then its pages stay uncleaned.
export async function cleanPages(id, positions, pageImage) {
  const { existsSync } = await import("node:fs");
  const { readFile, rm, writeFile } = await import("node:fs/promises");
  const sheets = new Map();
  for (const i of positions) {
    const j = backOf(i);
    if (j != null) sheets.set(Math.min(i, j), [Math.min(i, j), Math.max(i, j)]);
  }
  const cleaned = [];
  for (const [a, b] of sheets.values()) {
    if (!existsSync(pageImage(id, a)) || !existsSync(pageImage(id, b))) continue;
    const results = await cleanSheet(await readFile(pageImage(id, a)), await readFile(pageImage(id, b)));
    for (const [k, i] of [a, b].entries()) {
      const path = pageImage(id, i).replace(/\.jpg$/, ".clean.jpg");
      if (results[k]) {
        await writeFile(path, results[k]);
        cleaned.push(i);
      } else {
        await rm(path, { force: true });
      }
    }
  }
  return cleaned;
}
