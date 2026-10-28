// Import a scan into a notebook: split pages, read them with Claude, write JSON.
//
//   node scripts/import-notebook.mjs <notebook-id> [scan] --mode add|new|replace|complete
//                                    [--category C] [--start N] [--title T] [--type T] [--summary out.md]
//
// [scan] is a PDF, an image, or a folder of images holding two-page spreads.
//
//   new       Start a notebook from whatever pages are scanned.
//   add       After a session: reads only pages that are new or still open
//             (pages that were going to change); everything else is skipped.
//   replace   Re-read the uploaded pages and replace what was recorded for them.
//   complete  Mark the notebook completed. Without a scan, lists what to
//             rescan; with one, the rescanned pages replace the old ones.
//
// Claude puts each page in a category (data/categories.json), and pages go
// where their category comes in the notebook; session pages go by page
// number, printed on odd pages. A category with only one page (title page,
// info page, ...) is skipped once the notebook has it, unless it's being
// re-read. --category C (a category's kind or label) puts every non-blank
// page in that category instead. --start N numbers the session pages from N
// (the first session page in the scan) when no printed page number could be
// read; a printed number always wins. --type T (an id or label from
// data/notebook-types.json, #48) is the kind of a new notebook, which says
// how its scans are turned and split; the first type when not given. An
// existing notebook keeps the type it was made with.
// A scan of the closed notebook among the spreads becomes the outside front
// cover (cover-front.jpg), not two pages; a cover scanned on its own is
// imported by scripts/import-cover.mjs.
// Readings are cached in .import-cache/ so a rerun doesn't pay for the same
// page twice.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { CATEGORIES, SESSION_RANK, category, ranks } from "./lib/categories.mjs";
import { enrichSessions, loadCatalog, objectsFile } from "./lib/catalog.mjs";
import { coverImage } from "./lib/cover.mjs";
import { pageName as nn, readJSON, readJSONDir, writeJSON } from "./lib/files.mjs";
import { numberPages } from "./lib/import/numbering.mjs";
import { present, recordSessions } from "./lib/import/sessions.mjs";
import { nameOf, summarize } from "./lib/import/summary.mjs";
import { matchPosition } from "./lib/match.mjs";
import { TYPES, findType, typeOf, unsupported } from "./lib/notebook-types.mjs";
import { loadReader } from "./lib/reader.mjs";
import { PageReading, RedactionCheck } from "./lib/reading.mjs";
import { check } from "./lib/schema.mjs";
import { cleanShowThrough, pageImage, redact, splitSpreads, webImage } from "./lib/pages.mjs";
import { listSpreads } from "./lib/scans.mjs";

const MODES = ["add", "new", "replace", "complete"];
const { positionals: [id, source], values: opts } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "add" },
    category: { type: "string" },
    start: { type: "string" },
    title: { type: "string" },
    type: { type: "string" },
    summary: { type: "string" },
  },
});
if (!id || !MODES.includes(opts.mode) || (!source && opts.mode !== "complete")) {
  console.error("usage: node scripts/import-notebook.mjs <notebook-id> [scan] --mode add|new|replace|complete [--category C] [--start N] [--title T] [--type T] [--summary out.md]");
  process.exit(2);
}
const mode = opts.mode;
const startPage = opts.start ? Number(opts.start) : null;
if (startPage != null && !(Number.isInteger(startPage) && startPage >= 1)) {
  throw new Error(`the start page must be a page number, like 12 (got "${opts.start}")`);
}

const READ_HEIGHT = 2000; // what Claude sees; the site gets PAGE_HEIGHT
const PARALLEL = 4;
const PAD = 0.02; // margin added around each personal-info box

const notebookPath = join("data", "notebooks", `${id}.json`);
const existing = await readJSON(notebookPath, null);
if (mode === "new" && existing) throw new Error(`notebook ${id} already exists; pick it in the notebook dropdown instead of new-notebook`);
if (mode !== "new" && !existing) throw new Error(`there is no notebook ${id}; import its first scan with new-notebook picked`);
const type = mode === "new" && opts.type ? findType(opts.type) : typeOf(existing);
if (!type) throw new Error(`"${opts.type}" isn't a notebook type; pick one of ${TYPES.map((t) => t.label).join(", ")}`);
if (existing && opts.type && findType(opts.type) !== type) {
  throw new Error(`${id} is a ${type.label} notebook; its type is chosen when it's created`);
}
if (unsupported(type)) throw new Error(`${type.label} notebooks can't be imported yet: ${unsupported(type)} aren't supported`);
const scan = existing?.scan ?? { rotate: type.scan.rotate, split: type.scan.split };
const notes = []; // lines for the PR summary

// A category chosen for every page, when Claude's would be wrong.
const named = opts.category ? CATEGORIES.find((c) => [c.kind, c.label].includes(opts.category)) : null;
if (opts.category && !named) {
  throw new Error(`"${opts.category}" isn't a category; pick one of ${CATEGORIES.map((c) => c.label).join(", ")}`);
}
if (named?.kind === "front_cover") throw new Error("import the front cover with scripts/import-cover.mjs (Front cover in the Import form's category)");
if (named) notes.push(`- Every non-blank page was put in **${named.label}**, as chosen.`);

// The notebook's pages as they are, with their images, so pages can be
// inserted anywhere and everything after them renumbered.
const list = await Promise.all((existing?.pages ?? []).map(async (page, i) => {
  const clean = pageImage(id, i).replace(/\.jpg$/, ".clean.jpg");
  return {
    page,
    from: i,
    image: await readFile(pageImage(id, i)),
    clean: existsSync(clean) ? await readFile(clean) : null,
  };
}));

// 1. Split the uploaded spreads into pages.
const uploaded = [];
let spreads = []; // the uploaded spreads as scanned, for a closed-notebook cover
if (source) {
  const work = await mkdtemp(join(tmpdir(), "notebook-"));
  const files = await listSpreads(source, work);
  spreads = await Promise.all(files.map((f) => readFile(f)));
  const { pages: split, folds } = await splitSpreads(files, scan);
  uploaded.push(...split);
  folds.forEach((f, k) => {
    if (f == null) notes.push(`- Spread ${k + 1} of the scan has no visible fold, so it was cut where the others were. Check its two pages.`);
  });
  await rm(work, { recursive: true, force: true });
  console.log(`${uploaded.length} pages in ${basename(source)}`);
}

// 2. Reading pages with the page reader (scripts/lib/reader.mjs; Claude
// unless PAGE_READER says otherwise), cached per upload. Cached answers are
// held to the same format as fresh ones.
const cacheDir = join(".import-cache", id, source ? basename(source) : "none");
await mkdir(cacheDir, { recursive: true });
let reader; // loaded only when a page isn't cached, so cached runs need no API key
async function cached(name, format, compute) {
  const path = join(cacheDir, `${name}.json`);
  if (existsSync(path)) {
    const answer = check(format, await readJSON(path));
    if (!answer.ok) throw new Error(`${path} isn't in the reading format: ${answer.problem}`);
    return answer.data;
  }
  reader ??= await loadReader();
  const value = await compute(reader);
  await writeFile(path, JSON.stringify(value, null, 2));
  return value;
}
async function inBatches(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += PARALLEL) {
    out.push(...await Promise.all(items.slice(i, i + PARALLEL).map(fn)));
  }
  return out;
}
const readings = new Map(); // upload index -> reading
async function read(us) {
  const missing = us.filter((u) => !readings.has(u));
  await inBatches(missing, async (u) => {
    const r = await cached(nn(u), PageReading, async (c) => c.readPage(await webImage(uploaded[u], READ_HEIGHT), { form: type.form }));
    console.log(`  read uploaded page ${nn(u)}: ${r.kind}${r.printed_number ? ` #${r.printed_number}` : ""}`);
    readings.set(u, r);
  });
}

// Adding a session usually rescans pages already recorded. Matching the
// upload against the published images finds them, so they aren't paid for
// again; only pages that are new or still open are read. A scan with a
// chosen category is read in full: ruled pages like the index and the table
// of contents can look alike when matched. So is a scan given a start page,
// which counts from its first session page.
const all = uploaded.map((_, u) => u);
let toRead = all;
if (mode === "add" && list.length && !named && startPage == null) {
  const start = await matchPosition(uploaded, list.map((_, i) => pageImage(id, i)));
  if (start != null) toRead = all.filter((u) => !list[start + u] || list[start + u].page.open);
  const skipped = all.length - toRead.length;
  if (skipped) notes.push(`- Skipped ${skipped} uploaded page(s) that were already recorded. Tick **reread** to re-read them.`);
}
await read(toRead);

// A scan of the closed notebook is the outside front cover: Claude reads one
// half as the cover and the other (the scanner's lid) as blank. Neither is
// a page. There's one cover, scanned first; a later page that reads as a
// cover is the title page (its volume label looks like the cover's), so
// it's kept rather than lost.
let coverScan = null;
const coverAt = toRead.filter((u) => readings.get(u).kind === "front_cover");
if (coverAt.length) {
  const spread = coverAt[0] >> 1;
  coverScan = await coverImage(spreads[spread], scan.rotate ?? 90);
  for (const u of coverAt.filter((u) => u >> 1 !== spread)) {
    readings.set(u, { ...readings.get(u), kind: "title" });
    notes.push(`- Uploaded page ${nn(u)} also reads as the front cover; scan ${spread + 1} was used as the cover, and this page was kept as the title page. Check it.`);
  }
  toRead = toRead.filter((u) => u >> 1 !== spread);
}

// 3. What each page read is, and its page number (scripts/lib/import/numbering.mjs).
const kindOf = (u) => (named && readings.get(u).kind !== "blank" ? named.kind : readings.get(u).kind);
const numbering = numberPages({ uploads: toRead, readingOf: (u) => readings.get(u), kindOf, startPage });
notes.push(...numbering.notes);
const { numberOf } = numbering;

// 4. Place each page: replace what's there when it may be (re-reading, or a
// page still open), skip it when it's already recorded, or insert it where
// its category (or number) comes.
const replaceable = (entry) => mode === "replace" || mode === "complete" || Boolean(entry.page.open);
const rankOf = (kind) => (kind === "unused" ? SESSION_RANK : CATEGORIES.findIndex((c) => c.kind === kind));
// An entry as it will be: a page being placed counts as what it was read as.
const pageNow = (e) => (e.u != null ? { kind: kindOf(e.u), number: numberOf(e.u) ?? e.before?.number } : e.page);
function slotFor(rank, number) {
  const r = ranks(list.map(pageNow));
  const i = list.findIndex((e, k) => r[k] > rank ||
    (rank === SESSION_RANK && r[k] === SESSION_RANK && number != null && pageNow(e).number > number));
  return i < 0 ? list.length : i;
}
const placed = []; // entries recorded from the upload: { u, before, page }
const where = new Map(); // upload index -> the entry it went to or matched
function put(u, entry, at) {
  if (entry) {
    where.set(u, entry);
    if (!replaceable(entry)) return;
    Object.assign(entry, { u, before: entry.page });
    placed.push(entry);
  } else {
    const fresh = { u, before: null, page: null, from: null };
    list.splice(at, 0, fresh);
    where.set(u, fresh);
    placed.push(fresh);
  }
}
const seen = new Map(); // kind -> how many of it this upload has had
const existingOf = new Map(CATEGORIES.map((c) => [c.kind, list.filter((e) => e.page.kind === c.kind)]));
for (const u of toRead.filter((u) => kindOf(u) !== "blank" || numberOf(u) != null)) {
  const kind = kindOf(u);
  const number = numberOf(u);
  if (number != null) {
    put(u, list.find((e) => pageNow(e).number === number), slotFor(SESSION_RANK, number));
  } else if (["session", "unused"].includes(kind)) {
    notes.push(`- Uploaded page ${nn(u)} is a session page with no page number, so it went after the last session page. Set \`number\` by hand.`);
    put(u, null, slotFor(SESSION_RANK, null));
  } else {
    const k = seen.get(kind) ?? 0;
    seen.set(kind, k + 1);
    if (category(kind)?.single && k) {
      notes.push(`- Uploaded page ${nn(u)} also reads as the ${category(kind).label.toLowerCase()}, and there's only one, so it was skipped. Check the scan.`);
      continue;
    }
    const old = existingOf.get(kind)?.[k];
    if (old && !replaceable(old)) {
      notes.push(`- Uploaded page ${nn(u)}: the notebook already has its ${category(kind).label.toLowerCase()}, so it was skipped. Tick **reread** to re-read it.`);
    }
    const after = list.findLastIndex((e) => pageNow(e).kind === kind);
    put(u, old, after >= 0 ? after + 1 : slotFor(rankOf(kind), null));
  }
}
// Unnumbered blank pages go beside the page they face.
for (const u of toRead.filter((u) => kindOf(u) === "blank" && numberOf(u) == null)) {
  const partner = where.get(u ^ 1);
  if (!partner) {
    notes.push(`- Uploaded page ${nn(u)} is blank and the page it faces wasn't placed, so it was left out.`);
    continue;
  }
  const at = list.indexOf(partner) + (u % 2 ? 1 : 0);
  const neighbor = list[u % 2 ? at : at - 1];
  const blank = neighbor && pageNow(neighbor).kind === "blank" && pageNow(neighbor).number == null;
  put(u, blank ? neighbor : null, at);
}

// One uploaded page as a notebook page entry, keeping what was recorded
// for it before (label, number, note, redaction).
const clamp = (v) => Math.min(1, Math.max(0, v));
const round = (v) => Math.round(v * 1000) / 1000;
async function recordPage(u, before) {
  const r = readings.get(u);
  const number = numberOf(u) ?? before?.number ?? null;
  const page = { kind: kindOf(u) };
  if (before && page.kind === "blank" && before.kind !== "blank") {
    page.kind = before.kind;
    notes.push(`- ${nameOf(before)} now reads as blank, so its old kind (${before.kind}) was kept. Check the scan.`);
  }
  // Category pages are named by their category; scales pages can differ.
  const label = before?.label ?? (page.kind === "reference" ? r.label : null);
  if (label) page.label = label;
  if (number != null) page.number = number;
  if (before?.note) page.note = before.note;
  if (r.will_change) page.open = true;
  page.redact = before?.redact;
  if (r.personal_info.length && !page.redact) {
    page.redact = r.personal_info.map(({ box }) => {
      const x = clamp(box.x - PAD), y = clamp(box.y - PAD);
      return [round(x), round(y), round(clamp(box.x + box.width + PAD) - x), round(clamp(box.y + box.height + PAD) - y)];
    });
    const check = await cached(`${nn(u)}.check`, RedactionCheck, async (c) =>
      c.checkRedaction(await webImage(await redact(uploaded[u], page.redact), READ_HEIGHT)));
    const name = nameOf(page);
    if (check.legible) {
      page.redact = [[0, 0, 1, 1]];
      notes.push(`- ${name}: details were still readable after blurring (${check.what.join(", ")}), so the whole page is blurred. Narrow \`redact\` by hand if you like.`);
    } else {
      notes.push(`- ${name}: blurred ${r.personal_info.map((p) => p.what).join(", ")}.`);
    }
  }
  if (!page.redact) delete page.redact;
  return page;
}
await inBatches(placed, async (entry) => {
  entry.page = await recordPage(entry.u, entry.before);
  entry.image = await webImage(await redact(uploaded[entry.u], entry.page.redact));
  entry.clean = null;
});

// 5. Sessions from the session pages placed (scripts/lib/import/sessions.mjs).
const sessions = new Map((await readJSONDir(join("data", "sessions"))).map(({ data: s }) => [s.id, s]));
const { touched, removed, notes: sessionNotes } = recordSessions({
  sessions,
  notebook: id,
  pages: [...placed].sort((a, b) => list.indexOf(a) - list.indexOf(b))
    .map(({ u, page }) => ({ name: `Uploaded page ${nn(u)}`, number: page.number ?? null, reading: readings.get(u) })),
  mode,
});
notes.push(...sessionNotes);
const mine = () => [...sessions.values()].filter((s) => s.notebook === id);

// 6. Which pages are still open. Completing without a scan asks for the
// categories marked rescan (and other pages still waiting) to be rescanned;
// later completion scans close what they replace. While the notebook is in
// progress, blank pages after the last written page stay open, since that's
// where the next session goes.
const status = mode === "complete" ? "completed" : existing?.status ?? "in_progress";
const pages = list.map((e) => e.page);
const fresh = new Set(placed.map((e) => e.page));
const toRescan = (p) => Boolean(category(p.kind)?.rescan) || (p.open && !["session", "blank"].includes(p.kind));
let frontCover = existing?.front_cover ?? null;
if (coverScan) {
  if (!frontCover || frontCover.open || ["replace", "complete"].includes(mode)) frontCover = {};
  else {
    notes.push("- The scan of the closed notebook was skipped: the notebook already has its front cover. Tick **reread** to replace it.");
    coverScan = null;
  }
}
if (status === "completed") {
  const asking = mode === "complete" && !uploaded.length && existing.status !== "completed";
  for (const p of pages) {
    if (asking ? toRescan(p) : !fresh.has(p) && p.open && toRescan(p)) p.open = true;
    else delete p.open;
  }
  if (asking && frontCover && category("front_cover")?.rescan) frontCover = { open: true };
} else {
  const lastWritten = pages.findLastIndex((p) => p.number != null && p.kind !== "blank");
  pages.forEach((p, i) => {
    if (p.kind === "blank" && p.number != null && i > lastWritten) p.open = true;
    else if (p.kind === "blank") delete p.open;
  });
}
// Keep the key order of hand-written entries, with open last before redact.
for (const e of list) {
  const { kind, label, number, note, open, redact: boxes } = e.page;
  e.page = present({ kind, label, number, note, open, redact: boxes });
}

// Catalog info (OpenNGC): every designation in ids, and data/objects.json.
// A session whose ids grew is written too. Without the catalog (no network)
// the import goes on without it.
let objects = null;
try {
  const enriched = await enrichSessions([...sessions.values()], await loadCatalog());
  objects = enriched.objects;
  for (const sid of enriched.changed) touched.add(sid);
} catch (err) {
  console.warn(`Catalog lookup skipped: ${err.message}`);
}

// 7. Write the notebook, sessions, and page images.
const label = [...readings.values()].map((r) => r.notebook_label).find(Boolean) ?? {};
const dates = mine().map((s) => s.date).sort();
const notebook = {
  id,
  title: existing?.title ?? opts.title ?? label.title ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  owner: existing?.owner ?? label.owner ?? null,
  type: type.id,
  status,
  started: existing?.started ?? label.started ?? dates[0] ?? null,
  // The finish date on the cover's volume label wins once it's been rescanned.
  finished: label.finished ?? existing?.finished ?? (status === "completed" ? dates.at(-1) ?? null : null),
  scan,
  ...(frontCover && { front_cover: frontCover }),
  pages: list.map((e) => e.page),
};
await mkdir(join("data", "notebooks"), { recursive: true });
await writeJSON(notebookPath, notebook);
await mkdir(join("data", "sessions"), { recursive: true });
for (const sid of touched) {
  await writeJSON(join("data", "sessions", `${sid}.json`), sessions.get(sid));
}
for (const sid of removed) await rm(join("data", "sessions", `${sid}.json`), { force: true });
if (objects) await writeJSON(join("data", "objects.json"), objectsFile(objects));
// Images are named by position, so pages after an inserted one move along.
await mkdir(join("scans", id), { recursive: true });
if (coverScan) await writeFile(join("scans", id, "cover-front.jpg"), await webImage(coverScan));
const changed = [];
for (const [i, e] of list.entries()) {
  if (e.from === i && e.u == null) continue;
  changed.push(i);
  await writeFile(pageImage(id, i), e.image);
  const clean = pageImage(id, i).replace(/\.jpg$/, ".clean.jpg");
  if (e.clean) await writeFile(clean, e.clean);
  else await rm(clean, { force: true });
}
for (let i = list.length; i < (existing?.pages.length ?? 0); i++) {
  await rm(pageImage(id, i), { force: true });
  await rm(pageImage(id, i).replace(/\.jpg$/, ".clean.jpg"), { force: true });
}
// New and moved pages may complete a sheet whose other side was scanned before.
// The cleaner fits the stamp's ink, so a notebook without the stamp keeps
// its pages as scanned.
if (changed.length && type.form === "stamped") cleanShowThrough(id, changed);

// 8. Summarize for the pull request (scripts/lib/import/summary.mjs).
const summary = summarize({
  mode,
  notebook,
  scanName: source ? basename(source) : null,
  uploadedCount: uploaded.length,
  recorded: placed.map((e) => list.indexOf(e)).sort((a, b) => a - b).map((i) => nameOf(list[i].page)),
  cover: Boolean(coverScan),
  sessions,
  touched,
  removed,
  frontCover,
  notes,
});
if (opts.summary) await writeFile(opts.summary, summary);
console.log(summary);
