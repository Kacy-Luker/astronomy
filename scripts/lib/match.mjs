// Find where rescanned spreads sit in a notebook by comparing them with the
// page images already published. Works for written pages; faint or blank
// pages carry too little detail to match and are left out.
import sharp from "sharp";

const MIN_DETAIL = 6; // brightness spread below this is too faint to compare
const MIN_MATCH = 0.8; // average correlation a placement needs

async function thumb(input) {
  const { data } = await sharp(input).grayscale().resize(24, 32, { fit: "fill" }).blur(1).raw()
    .toBuffer({ resolveWithObject: true });
  const values = [...data];
  const mean = values.reduce((a, b) => a + b) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { z: values.map((v) => (v - mean) / (sd || 1)), sd };
}

const correlation = (a, b) => a.z.reduce((sum, v, i) => sum + v * b.z[i], 0) / a.z.length;

// Position of the first uploaded page among the known ones (always a left
// page), or null when nothing matches well enough.
export async function matchPosition(uploaded, knownImages) {
  const up = await Promise.all(uploaded.map(thumb));
  const known = await Promise.all(knownImages.map(thumb));
  let best = null;
  for (let start = 0; start < known.length; start += 2) {
    const scores = up.flatMap((u, i) => {
      const k = known[start + i];
      return k && (u.sd > MIN_DETAIL || k.sd > MIN_DETAIL) ? [correlation(u, k)] : [];
    });
    if (!scores.length) continue;
    const score = scores.reduce((a, b) => a + b) / scores.length;
    if (score >= MIN_MATCH && (!best || score > best.score)) best = { start, score };
  }
  return best?.start ?? null;
}
