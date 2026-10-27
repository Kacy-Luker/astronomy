// Import a scan into a notebook: split pages, read them with Claude, write JSON.
//
//   node scripts/import-notebook.mjs <notebook-id> [scan] --mode add|new|replace|complete
//                                    [--category C] [--start N] [--title T] [--summary out.md]
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
// read; a printed number always wins.
// A scan of the closed notebook among the spreads becomes the outside front
// cover (cover-front.jpg), not two pages; a cover scanned on its own is
// imported by scripts/import-cover.mjs.
// Readings are cached in .import-cache/ so a rerun doesn't pay for the same
// page twice.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { CATEGORIES, SESSION_RANK, category, ranks } from "./lib/categories.mjs";
import { enrichSessions, loadCatalog, objectsFile } from "./lib/catalog.mjs";
import { coverImage } from "./lib/cover.mjs";
import { formatJSON } from "./lib/format-json.mjs";
import { sessionTodos } from "../site/todos.js";
import { matchPosition } from "./lib/match.mjs";
import { cleanShowThrough, listSpreads, pageImage, redact, splitSpreads, webImage } from "./lib/pages.mjs";

const MODES = ["add", "new", "replace", "complete"];
const { positionals: [id, source], values: opts } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "add" },
    category: { type: "string" },
    start: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
  },
});
if (!id || !MODES.includes(opts.mode) || (!source && opts.mode !== "complete")) {
  console.error("usage: node scripts/import-notebook.mjs <notebook-id> [scan] --mode add|new|replace|complete [--category C] [--start N] [--title T] [--summary out.md]");
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
const existing = existsSync(notebookPath) ? JSON.parse(await readFile(notebookPath, "utf8")) : null;
if (mode === "new" && existing) throw new Error(`notebook ${id} already exists; pick it in the notebook dropdown instead of new-notebook`);
if (mode !== "new" && !existing) throw new Error(`there is no notebook ${id}; import its first scan with new-notebook picked`);
const scan = existing?.scan ?? { rotate: 90, split: 0.47 };
const notes = []; // lines for the PR summary
const nn = (i) => String(i + 1).padStart(2, "0");
const nameOf = (page) => (page.number != null ? `page ${page.number}` : (page.label ?? category(page.kind)?.label ?? page.kind).toLowerCase());

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

// 2. Reading pages with Claude, cached per upload.
const cacheDir = join(".import-cache", id, source ? basename(source) : "none");
await mkdir(cacheDir, { recursive: true });
let claude; // loaded only when a page isn't cached, so cached runs need no API key
async function cached(name, compute) {
  const path = join(cacheDir, `${name}.json`);
  if (existsSync(path)) return JSON.parse(await readFile(path, "utf8"));
  claude ??= await import("./lib/read-page.mjs");
  const value = await compute(claude);
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
    const r = await cached(nn(u), async (c) => c.readPage(await webImage(uploaded[u], READ_HEIGHT)));
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
// a page.
let coverScan = null;
const coverAt = toRead.filter((u) => readings.get(u).kind === "front_cover");
if (coverAt.length) {
  const spread = coverAt[0] >> 1;
  coverScan = await coverImage(spreads[spread], scan.rotate ?? 90);
  if (coverAt.some((u) => u >> 1 !== spread)) {
    notes.push(`- More than one spread reads as the front cover; scan ${spread + 1} was used and the others were left out. Check the scan.`);
  }
  toRead = toRead.filter((u) => u >> 1 !== spread && !coverAt.includes(u));
}

// 3. What each page read is, and its page number. Odd pages carry printed
// numbers, which always win; the others follow from them by where they are
// in the upload. Only when no printed number was read does the start page
// number the session pages, in scan order (a printed number can be missed
// while scanning). A blank page only gets a number when it comes before a
// session page, or faces one.
const kindOf = (u) => (named && readings.get(u).kind !== "blank" ? named.kind : readings.get(u).kind);
const votes = new Map();
for (const u of toRead) {
  const n = readings.get(u).printed_number;
  if (n % 2 === 1) votes.set(n - u, (votes.get(n - u) ?? 0) + 1);
}
const isSession = (u) => readings.has(u) && ["session", "unused"].includes(kindOf(u));
const firstSession = toRead.find(isSession);
let offset = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
if (startPage != null) {
  if (firstSession == null) notes.push(`- A start page (${startPage}) was given, but the scan has no session pages, so it wasn't used.`);
  else if (offset != null) {
    const printed = firstSession + offset;
    notes.push(`- Printed page numbers were read, so the start page wasn't needed` +
      (printed !== startPage ? `: they make the first session page ${printed}, not ${startPage}. Check the scan.` : "."));
  } else {
    offset = startPage - firstSession;
    notes.push(`- No printed page numbers were read, so session pages were numbered from ${startPage}, the start page given, in scan order.`);
  }
}
const sessionArea = (u) => isSession(u) || (readings.has(u) && readings.get(u).printed_number != null);
function numberOf(u) {
  const r = readings.get(u);
  if (r.printed_number != null) return r.printed_number;
  if (offset == null || u + offset < 1) return null;
  if (kindOf(u) === "blank" && !isSession(u + 1) && !sessionArea(u ^ 1)) return null;
  return ["session", "unused", "blank"].includes(kindOf(u)) ? u + offset : null;
}
for (const u of toRead) {
  const n = readings.get(u).printed_number, want = offset != null ? u + offset : null;
  if (n != null && want != null && n !== want) notes.push(`- Uploaded page ${nn(u)} shows number ${n}, out of step with the pages around it. Check the page order.`);
}

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
    const check = await cached(`${nn(u)}.check`, async (c) =>
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

// 5. Sessions. A header starts a session; entries without one continue the
// latest session. On a page that already has entries, only entries beyond
// those are added (counted, not matched, so a misread can't duplicate one).
async function loadSessions() {
  const dir = join("data", "sessions");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8"))));
}
const sessions = new Map((await loadSessions()).map((s) => [s.id, s]));
const mine = () => [...sessions.values()].filter((s) => s.notebook === id);
const touched = new Set();
const removed = new Set();
const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
// A reading's box as stored: [x, y, width, height], clamped to the page.
const boxOf = (b) => {
  if (!b) return null;
  const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  const [x, y] = [c(b.x), c(b.y)];
  return [x, y, c(Math.min(b.width, 1 - x)), c(Math.min(b.height, 1 - y))];
};
const lastPage = (s) => Math.max(0, ...(s.pages ?? []));
const headerFields = (h) => {
  const sky = present({ sqm: h.sqm, notes: h.sky_notes });
  return present({
    program: h.program,
    date: h.date,
    site: present({ name: h.site, lat: h.lat, lon: h.lon }),
    sky: Object.keys(sky).length ? sky : null,
    scope: h.scope && present(h.scope),
    observers: h.observers,
  });
};

// Replacing pages starts them from scratch: forget their entries first.
const processedNumbers = new Set(placed.map((e) => e.page.number).filter((n) => n != null));
const startedOn = new Map(mine().map((s) => [Math.min(...(s.pages ?? [Infinity])), s]));
if (mode === "replace") {
  for (const s of mine()) {
    const kept = s.observations.filter((o) => !processedNumbers.has(o.page));
    if (kept.length === s.observations.length) continue;
    s.observations = kept;
    s.pages = s.pages.filter((n) => !processedNumbers.has(n) || n === Math.min(...s.pages));
    touched.add(s.id);
  }
}

let current = null;
for (const { u, page } of [...placed].sort((a, b) => list.indexOf(a) - list.indexOf(b))) {
  const r = readings.get(u);
  const number = page.number ?? null;
  if (r.kind !== "session" || (!r.header && !r.entries.length)) continue;
  const recorded = mine().flatMap((s) => s.observations).filter((o) => number != null && o.page === number).length;

  if (r.header) {
    current = number != null ? startedOn.get(number) : null;
    if (current && mode === "replace") {
      const { id: sid, notebook, pages: ps, observations, header_box: oldBox, ...old } = current;
      const fresh = headerFields(r.header);
      const box = r.header.box ? { page: number, box: boxOf(r.header.box) } : oldBox;
      if (JSON.stringify(old) !== JSON.stringify(fresh) || JSON.stringify(box) !== JSON.stringify(oldBox)) {
        sessions.set(sid, { id: sid, ...fresh, notebook, pages: ps, ...present({ header_box: box }), observations });
        current = sessions.get(sid);
        touched.add(sid);
      }
    }
    if (!current) {
      const h = r.header;
      let sid = slug(`${h.date}-${h.site}`);
      for (let n = 2; sessions.has(sid); n++) sid = slug(`${h.date}-${h.site}-${n}`);
      const box = number != null && h.box ? { header_box: { page: number, box: boxOf(h.box) } } : {};
      current = { id: sid, ...headerFields(h), notebook: id, pages: [], ...box, observations: [] };
      sessions.set(sid, current);
      touched.add(sid);
    }
  } else {
    current ??= mine()
      .filter((s) => number == null || lastPage(s) <= number)
      .sort((a, b) => lastPage(a) - lastPage(b))
      .at(-1) ?? null;
    if (!current) {
      notes.push(`- Uploaded page ${nn(u)} has entries but no session to belong to. They were skipped.`);
      continue;
    }
  }

  const added = r.entries.slice(recorded);
  if (number != null && !current.pages.includes(number) && (added.length || r.header)) {
    current.pages.push(number);
    current.pages.sort((a, b) => a - b);
  }
  for (const e of added) {
    // Same field order as hand-written files; UT and magnification only when written.
    current.observations.push({
      catalog_id: e.catalog_id,
      aka: e.aka,
      ids: [e.catalog_id],
      page: number,
      local_time: e.local_time,
      ...present({ ut: e.ut }),
      seeing: e.seeing,
      transparency: e.transparency,
      eyepiece: e.eyepiece,
      ...present({ magnification: e.magnification }),
      filter: e.filter,
      description: e.description,
      ...present({ box: boxOf(e.box) }),
    });
  }
  if (added.length) {
    current.observations.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
    touched.add(current.id);
    for (const note of r.uncertain) notes.push(`- ${current.id}, page ${number ?? "?"}: ${note}`);
  }
}
for (const s of mine()) {
  if (touched.has(s.id) && !s.observations.length) {
    sessions.delete(s.id);
    touched.delete(s.id);
    removed.add(s.id);
  }
}


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
  status,
  started: existing?.started ?? label.started ?? dates[0] ?? null,
  // The finish date on the cover's volume label wins once it's been rescanned.
  finished: label.finished ?? existing?.finished ?? (status === "completed" ? dates.at(-1) ?? null : null),
  scan,
  ...(frontCover && { front_cover: frontCover }),
  pages: list.map((e) => e.page),
};
await mkdir(join("data", "notebooks"), { recursive: true });
await writeFile(notebookPath, formatJSON(notebook) + "\n");
await mkdir(join("data", "sessions"), { recursive: true });
for (const sid of touched) {
  await writeFile(join("data", "sessions", `${sid}.json`), formatJSON(sessions.get(sid)) + "\n");
}
for (const sid of removed) await rm(join("data", "sessions", `${sid}.json`), { force: true });
if (objects) await writeFile(join("data", "objects.json"), formatJSON(objectsFile(objects)) + "\n");
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
if (changed.length) cleanShowThrough(id, changed);

// 8. Summarize for the pull request.
const what = {
  new: "Created", add: "Added to", replace: "Replaced pages in", complete: "Completed",
}[mode];
const recorded = placed.map((e) => list.indexOf(e)).sort((a, b) => a - b).map((i) => nameOf(list[i].page));
const lines = [
  `${what} **${notebook.title}**` + (source
    ? ` from \`${basename(source)}\`: ${placed.length} of ${uploaded.length} uploaded pages recorded` +
      (recorded.length ? ` (${[...new Set(recorded)].join(", ")})` : "") + "."
    : "."),
  ...(coverScan ? ["The scan of the closed notebook is the front cover; check it's upright and trimmed in the preview."] : []),
  `Status: **${status === "completed" ? "completed" : "in progress"}**.`,
  "",
];
if (touched.size || removed.size) {
  lines.push("Before merging, compare each session with its pages in the notebook view, and fix",
    "any misread field by editing the session's JSON file on this branch.", "");
  for (const sid of touched) {
    const s = sessions.get(sid);
    lines.push(`- \`${sid}\`: ${s.observations.map((o) => o.catalog_id).join(", ")} (pages ${s.pages.join(", ")})`);
    // Blank fields are to-dos (N/A means the field doesn't apply).
    for (const t of sessionTodos(s)) {
      lines.push(`  - To do, ${t.where}${t.page ? ` (page ${t.page})` : ""}: ${t.fields.join(", ")}`);
    }
  }
  for (const sid of removed) lines.push(`- \`${sid}\`: removed (no entries left)`);
} else {
  lines.push("No session entries changed.");
}
if (status === "completed") {
  // What completing asks to be rescanned, and whether it has been.
  const todo = CATEGORIES.filter((c) => c.rescan).map((c) => {
    if (c.kind === "front_cover") return { c, todo: !frontCover ? "not scanned yet" : frontCover.open ? "rescan it" : null };
    const ps = notebook.pages.filter((p) => p.kind === c.kind);
    return { c, todo: !ps.length ? "not scanned yet" : ps.some((p) => p.open) ? "rescan it" : null };
  });
  // Other pages still waiting, like ones Claude said would still change.
  const others = [...new Set(notebook.pages.filter((p) => p.open && !category(p.kind)?.rescan).map(nameOf))];
  lines.push("", "### Rescan checklist", "",
    ...todo.map(({ c, todo: t }) => `- [${t ? " " : "x"}] ${c.label}${t ? `: ${t}` : ""}`),
    ...others.map((name) => `- [ ] ${name[0].toUpperCase()}${name.slice(1)}: rescan it`));
  if (todo.some((t) => t.todo && t.c.kind !== "front_cover") || others.length) {
    lines.push("", "Scan those pages (whole spreads, in any order) into one file, upload it, and run",
      "**Complete notebook** again with that file. Each page goes back where its category belongs.");
  }
  if (todo.some((t) => t.todo && t.c.kind === "front_cover")) {
    lines.push("", "Scan the closed notebook's front cover too: in the same file, or on its own with **Front cover** picked as the category in **Import**.");
  }
  // Blank pages are confirmed by hand, and categories never scanned are listed.
  const blanks = notebook.pages.flatMap((p, i) => (p.kind === "blank" ? [p.number != null ? `page ${p.number}` : `scan position ${nn(i)}`] : []));
  if (blanks.length) {
    lines.push("", "### Blank pages", "", "These pages were read as blank. Check each is meant to be blank before merging:", "",
      ...blanks.map((b) => `- ${b}`));
  }
  const missing = CATEGORIES.filter((c) => !c.rescan && !notebook.pages.some((p) => p.kind === c.kind));
  if (missing.length) lines.push("", "### Not scanned", "", ...missing.map((c) => `- ${c.label}`));
}
if (notes.length) lines.push("", "### Check these", "", ...notes);
const summary = lines.join("\n") + "\n";
if (opts.summary) await writeFile(opts.summary, summary);
console.log(summary);
