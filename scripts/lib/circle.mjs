// Find the stamped sketch circle in an entry image, for the Sketches tab's
// thumbnails. A Hough search: every dark (ink) pixel votes for the circles
// it could lie on, and the circle with the most votes wins. Pencil marks
// touching the ring and small gaps in it don't throw it off.
import sharp from "sharp";

const W = 240; // search at this width; plenty for a ring a third as wide
const MIN_SCORE = 3;

// { x, y, width, height } of a square around the circle, as fractions of
// the image, or null when no clear circle is found.
export async function findCircle(file) {
  const { data, info } = await sharp(file).greyscale().resize({ width: W }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const points = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] < 110) points.push(x, y);

  // On the stamp the circle is a quarter to two fifths of the entry's width.
  const rMin = Math.round(w * 0.12), rMax = Math.round(w * 0.22);
  const steps = 90;
  const cos = Float64Array.from({ length: steps }, (_, i) => Math.cos((2 * Math.PI * i) / steps));
  const sin = Float64Array.from({ length: steps }, (_, i) => Math.sin((2 * Math.PI * i) / steps));
  let best = { votes: 0 };
  for (let r = rMin; r <= rMax; r++) {
    const acc = new Uint16Array(w * h);
    for (let p = 0; p < points.length; p += 2) {
      for (let i = 0; i < steps; i++) {
        const cx = Math.round(points[p] - r * cos[i]), cy = Math.round(points[p + 1] - r * sin[i]);
        if (cx >= r && cy >= r && cx < w - r && cy < h - r) acc[cy * w + cx]++;
      }
    }
    for (let cy = r; cy < h - r; cy++) {
      for (let cx = r; cx < w - r; cx++) {
        // Votes near this center (rounding scatters them over a 3×3 patch),
        // per unit of circumference, so bigger circles don't win by size.
        let votes = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) votes += acc[(cy + dy) * w + cx + dx];
        const score = votes / r;
        if (score > (best.score ?? 0)) best = { score, votes, cx, cy, r };
      }
    }
  }
  // A real ring collects votes from most of its circumference.
  if (!best.r || best.score < MIN_SCORE) return null;
  const pad = best.r * 1.06;
  const x = Math.max(0, best.cx - pad), y = Math.max(0, best.cy - pad);
  return { x: x / w, y: y / h, width: Math.min(2 * pad, w - x) / w, height: Math.min(2 * pad, h - y) / h };
}
