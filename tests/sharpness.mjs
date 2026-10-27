// How sharp a box of an image is: the spread of its edges (a Laplacian).
// Blurred boxes score about 1, writing 10 or more (tests/unit/redaction.test.mjs).
import sharp from "sharp";

export const BLURRED = 3;

export async function sharpness(file, [x, y, w, h]) {
  const { width, height } = await sharp(file).metadata();
  const region = { left: Math.round(x * width), top: Math.round(y * height), width: Math.round(w * width), height: Math.round(h * height) };
  const grey = await sharp(file).extract(region).greyscale().toBuffer();
  const edges = await sharp(grey).convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 }).toBuffer();
  return (await sharp(edges).stats()).channels[0].stdev;
}
