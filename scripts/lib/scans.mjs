// The scan source (docs/DEPENDENCIES.md): where uploads come from and how
// a scan becomes spread images. Uploads live in a folder per notebook
// (astronomy-scans/<notebook>/, fetched by the Notebook job workflow into
// .scans/), named for their date. A scan is a PDF of spreads, one image, or
// a folder of images; PDFs are opened with poppler's pdfimages.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);

// What a file really is, from its first bytes rather than its name.
export async function sniff(path) {
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
      const spreads = await pdfImages(source, workDir);
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

// The images embedded in a PDF, in order, as files in workDir. pdfimages
// (poppler-utils) extracts the scanned JPEGs without re-encoding them.
async function pdfImages(pdf, workDir) {
  execFileSync("pdfimages", ["-j", pdf, join(workDir, "spread")]);
  return (await readdir(workDir)).filter((f) => f.startsWith("spread")).sort().map((f) => join(workDir, f));
}

// The newest upload in a notebook's folder. Names are dates (optionally
// -HHMM), so the newest sorts last; compared without the extension so
// 2026-10-23.pdf comes before 2026-10-23-1350.pdf. Null if there's none.
export function newestScan(store, notebook) {
  const dir = join(store, notebook);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
  const stem = (f) => f.slice(0, f.length - extname(f).length);
  files.sort((a, b) => (stem(a) < stem(b) ? -1 : stem(a) > stem(b) ? 1 : 0));
  return files.length ? `${notebook}/${files.at(-1)}` : null;
}

// Which notebook and scan a form run is for (the Notebook job's checks).
// store: the uploads folder; picked: the form's notebook ("new-notebook"
// for a new one); scan: the form's scan path, or "" for the newest;
// hasNotebook(id): whether data/notebooks/<id>.json exists. Returns
// { notebook, scan } (scan null when completing without one), or throws an
// Error whose message is shown on the form's run.
export function pickScan({ store, mode, picked, scan = "", hasNotebook }) {
  if (scan.includes("..")) throw new Error("Scan path can't contain '..'");
  let notebook = picked;
  if (mode === "new") {
    // A new notebook is named for its folder in astronomy-scans: the scan's
    // folder, or else the one folder with no notebook yet.
    if (scan) {
      notebook = scan.split("/")[0];
      if (notebook === scan) throw new Error(`Put the scan in a folder named for the new notebook, e.g. astronomy-002/${scan}`);
    } else {
      const fresh = readdirSync(store).filter((d) => !d.startsWith(".") && statSync(join(store, d)).isDirectory() && !hasNotebook(d));
      if (!fresh.length) throw new Error("Every folder in astronomy-scans already has a notebook; upload the new one's scan to a new folder, e.g. astronomy-002/");
      if (fresh.length > 1) throw new Error(`More than one folder has no notebook yet (${fresh.join(" ")}); type the scan's path`);
      [notebook] = fresh;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(notebook)) throw new Error(`A notebook's folder must be lowercase letters, digits and dashes, e.g. astronomy-002 (got '${notebook}')`);
    if (hasNotebook(notebook)) throw new Error(`${notebook} already exists; pick it in the notebook dropdown`);
  } else if (scan && scan.split("/")[0] !== notebook) {
    throw new Error(`${scan} isn't in ${notebook}'s folder; pick the notebook it belongs to`);
  }
  if (!scan && mode !== "complete") {
    scan = newestScan(store, notebook);
    if (!scan) throw new Error(`No files in astronomy-scans/${notebook}/`);
  }
  if (scan && !existsSync(join(store, scan))) throw new Error(`astronomy-scans has no ${scan}`);
  return { notebook, scan: scan || null };
}
