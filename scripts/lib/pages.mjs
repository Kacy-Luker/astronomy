// Image steps shared by the notebook scripts: spreads in, pages out.
import { execFileSync } from "node:child_process";
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
