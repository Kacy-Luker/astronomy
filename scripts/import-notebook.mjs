// Import a scan into a notebook: split pages, read them with Claude, write JSON.
//
//   node scripts/import-notebook.mjs <notebook-id> [scan] --mode add|new|replace|complete
//                                    [--title T] [--summary out.md]
//
// [scan] is a PDF, an image, or a folder of images holding two-page spreads.
//
//   new       Start a notebook: front matter plus any sessions written so far.
//   add       After a session: reads only pages that are new or still open
//             (pages that were going to change); everything else is skipped.
//   replace   Re-read the uploaded pages and replace what was recorded for them.
//   complete  Mark the notebook completed. Without a scan, lists what to
//             rescan (sections marked rescan, pages still open); with one,
//             fills those in.
//
// Pages are placed by printed odd page numbers, by matching the rescanned
// pages against the published images, or (for completion) by the list of
// spreads to rescan. Back matter (index, info page, inside back cover) is
// kept at the end of the notebook: uploaded pages of those kinds at the end
// of a scan replace that section, and new session pages go in before it.
// The outside front cover is imported by scripts/import-cover.mjs.
// Readings are cached in .import-cache/ so a rerun doesn't pay for the same
// page twice.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { formatJSON } from "./lib/format-json.mjs";
import { matchPosition } from "./lib/match.mjs";
import { cleanShowThrough, listSpreads, pageImage, redact, splitSpreads, webImage } from "./lib/pages.mjs";
import { assignSections, backStart, defaultSections, missingSections } from "./lib/sections.mjs";

const MODES = ["add", "new", "replace", "complete"];
const { positionals: [id, source], values: opts } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "add" },
    title: { type: "string" },
    summary: { type: "string" },
  },
});
if (!id || !MODES.includes(opts.mode) || (!source && opts.mode !== "complete")) {
  console.error("usage: node scripts/import-notebook.mjs <notebook-id> [scan] --mode add|new|replace|complete [--title T] [--summary out.md]");
  process.exit(2);
}
const mode = opts.mode;

const READ_HEIGHT = 2000; // what Claude sees; the site gets PAGE_HEIGHT
const PARALLEL = 4;
const PAD = 0.02; // margin added around each personal-info box

const notebookPath = join("data", "notebooks", `${id}.json`);
const existing = existsSync(notebookPath) ? JSON.parse(await readFile(notebookPath, "utf8")) : null;
if (mode === "new" && existing) throw new Error(`notebook ${id} already exists; use Add session instead`);
if (mode !== "new" && !existing) throw new Error(`there is no notebook ${id}; make it with Create new notebook first`);
const scan = existing?.scan ?? { rotate: 90, split: 0.47 };

// Back matter is set aside while the other pages are placed, then put back
// after them. Its images are read now, before any are overwritten.
const sections = existing?.sections ?? null;
const firstBack = backStart(sections ?? defaultSections([]));
const backSections = (sections ?? defaultSections([])).slice(firstBack);
const owners = existing ? assignSections(sections, existing.pages).owner : [];
let bodyCount = owners.findIndex((o) => o >= firstBack);
if (bodyCount < 0) bodyCount = existing?.pages.length ?? 0;
const known = existing?.pages.slice(0, bodyCount) ?? [];
const oldBack = await Promise.all((existing?.pages.slice(bodyCount) ?? []).map(async (page, k) =>
  ({ page, section: owners[bodyCount + k] - firstBack, image: await readFile(pageImage(id, bodyCount + k)) })));
const notes = []; // lines for the PR summary
const nn = (i) => String(i + 1).padStart(2, "0");

// Front matter and other non-session pages that are still open are rescanned
// once the notebook is completed; this lists the spreads they're on.
const awaitingRescan = (pages) => [...new Set(pages.flatMap((p, i) =>
  p.open && !["session", "blank"].includes(p.kind) ? [i - (i % 2)] : []))].sort((a, b) => a - b);
const describeSpread = (pages, left) => [pages[left], pages[left + 1]].filter(Boolean)
  .map((p) => (p.number != null ? `page ${p.number}` : (p.label ?? p.kind).toLowerCase())).join(" + ");

// 1. Split the uploaded spreads into pages.
const uploaded = [];
if (source) {
  const work = await mkdtemp(join(tmpdir(), "notebook-"));
  const { pages: split, folds } = await splitSpreads(await listSpreads(source, work), scan);
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

// 3. Place the upload. offset maps a position in the page list to a page
// number; the most common one among printed odd numbers wins.
function commonOffset(pairs) {
  const votes = new Map();
  for (const [pos, number] of pairs) votes.set(number - pos, (votes.get(number - pos) ?? 0) + 1);
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
}
let offset = commonOffset(known.flatMap((p, i) => (p.number != null ? [[i, p.number]] : [])));
const uploadOffset = () => commonOffset([...readings].flatMap(([u, r]) =>
  r.printed_number % 2 === 1 ? [[u, r.printed_number]] : []));
const all = uploaded.map((_, u) => u);
let positions = []; // upload index -> notebook position
let toRecord = []; // upload indices to record (read, re-image, merge)

// Back matter at the end of the upload: unnumbered pages of the back
// sections' kinds, with any blank page scanned alongside them (dropped).
function trailingBack() {
  const run = [];
  for (let u = uploaded.length - 1; u >= 0; u--) {
    const r = readings.get(u);
    if (!r || r.printed_number != null || !(backSections.some((s) => s.kind === r.kind) || r.kind === "blank")) break;
    run.unshift(u);
  }
  return run.some((u) => readings.get(u).kind !== "blank") ? run : [];
}

if (mode === "new") {
  await read(all);
  const o = uploadOffset();
  if (o != null) offset = o;
  else notes.push("- **No page numbers found**, so pages are unnumbered. Set `number` by hand.");
  positions = all;
  toRecord = all;
} else if (mode === "complete" && uploaded.length) {
  // The spreads to rescan, in order, then any back matter.
  await read(all);
  const body = all.slice(0, all.length - trailingBack().length);
  const spreads = awaitingRescan(known);
  if (body.length !== spreads.length * 2) {
    throw new Error(`expected ${spreads.length} spread(s) to rescan (` +
      `${spreads.map((s) => describeSpread(known, s)).join("; ") || "none"}) before the back matter, but the scan has ${body.length / 2}`);
  }
  positions = body.map((u) => spreads[Math.floor(u / 2)] + (u % 2));
  toRecord = body;
  for (const u of body) {
    const want = known[positions[u]].kind, got = readings.get(u).kind;
    if (want !== got) notes.push(`- Uploaded page ${nn(u)} looks like a ${got} page but replaces a ${want} page. Check the spreads were scanned in order.`);
  }
} else if (uploaded.length) {
  const knownImages = known.map((_, i) => pageImage(id, i)).filter(existsSync);
  let start;
  if (mode === "replace") {
    await read(all);
    const o = uploadOffset();
    start = o != null && offset != null ? o - offset : await matchPosition(uploaded, knownImages);
    if (start == null) throw new Error("couldn't tell which pages this scan replaces (no page numbers, and it doesn't match the published pages)");
    toRecord = all;
  } else {
    // add: match against what's published, else assume the scan continues
    // the notebook; then let printed numbers on the pages read overrule that.
    start = await matchPosition(uploaded, knownImages) ?? known.length;
    for (let round = 0; round < 3; round++) {
      toRecord = all.filter((u) => start + u >= known.length || known[start + u].open);
      await read(toRecord);
      const o = uploadOffset();
      if (o == null || offset == null || o - offset === start) break;
      start = o - offset;
    }
    const skipped = all.length - toRecord.length;
    if (skipped) notes.push(`- Skipped ${skipped} uploaded page(s) that were already recorded. Use **Replace pages** to re-read them.`);
  }
  if (start < 0 || start > known.length) {
    throw new Error(start > known.length
      ? `this scan starts at page ${start + offset}, but the notebook only goes up to page ${known.length - 1 + offset}; scan the pages in between too`
      : "this scan would start before the notebook's first page");
  }
  positions = all.map((u) => start + u);
}
const backUploads = trailingBack().filter((u) => mode === "complete" || toRecord.includes(u));
toRecord = toRecord.filter((u) => !backUploads.includes(u));
for (const u of toRecord) {
  const r = readings.get(u);
  const expected = known[positions[u]]?.number ?? (offset != null ? positions[u] + offset : null);
  if (r.printed_number != null && expected != null && r.printed_number !== expected) {
    notes.push(`- Uploaded page ${nn(u)} shows number ${r.printed_number} but was placed as page ${expected}. Check the page order.`);
  }
}

// 4. Record the processed pages.
const clamp = (v) => Math.min(1, Math.max(0, v));
const round = (v) => Math.round(v * 1000) / 1000;
// One uploaded page as a notebook page entry, keeping what was recorded
// for it before (label, number, note, redaction).
async function recordPage(u, before, { number, label, where }) {
  const r = readings.get(u);
  const page = { kind: r.kind };
  if (before && r.kind === "blank" && before.kind !== "blank") {
    page.kind = before.kind;
    notes.push(`- ${where} now reads as blank, so its old kind (${before.kind}) was kept. Check the scan.`);
  }
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
    if (check.legible) {
      page.redact = [[0, 0, 1, 1]];
      notes.push(`- ${where}: details were still readable after blurring (${check.what.join(", ")}), so the whole page is blurred. Narrow \`redact\` by hand if you like.`);
    } else {
      notes.push(`- ${where}: blurred ${r.personal_info.map((p) => p.what).join(", ")}.`);
    }
  }
  if (!page.redact) delete page.redact;
  return page;
}

const pages = [...known];
const fresh = new Set(); // pages recorded by this run
await inBatches(toRecord, async (u) => {
  const i = positions[u];
  const r = readings.get(u);
  const before = known[i];
  const label = before?.label ?? (["session", "blank", "unused"].includes(r.kind) ? null : r.label);
  const number = before ? before.number : offset != null && i + offset >= 1 ? i + offset : null;
  pages[i] = await recordPage(u, before, { number, label, where: number != null ? `Page ${number}` : label ?? `Scan position ${nn(i)}` });
  fresh.add(pages[i]);
});

// Back matter: uploaded pages replace their whole section, and the others
// keep theirs. Blank pages scanned alongside it aren't kept.
const backUpload = backUploads.filter((u) => readings.get(u).kind !== "blank");
const { owner: backOwner } = assignSections(backSections, backUpload.map((u) => ({ kind: readings.get(u).kind })));
if (backOwner.length < backUpload.length) {
  throw new Error(`the back matter in this scan (${backUpload.map((u) => readings.get(u).kind).join(", ")}) ` +
    `doesn't fit the notebook's back sections in order (${backSections.map((s) => s.label ?? s.kind).join(", ")})`);
}
const back = [];
for (const [k, section] of backSections.entries()) {
  const old = oldBack.filter((b) => b.section === k);
  const ups = backUpload.filter((_, j) => backOwner[j] === k);
  if (!ups.length) {
    back.push(...old);
    continue;
  }
  for (const [j, u] of ups.entries()) {
    const label = section.label ?? null;
    const page = await recordPage(u, old[j]?.page, { number: null, label, where: label ?? section.kind });
    fresh.add(page);
    back.push({ page, image: await webImage(await redact(uploaded[u], page.redact)) });
  }
}

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
const processedNumbers = new Set(toRecord.map((u) => pages[positions[u]].number).filter((n) => n != null));
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
for (const u of [...toRecord].sort((a, b) => positions[a] - positions[b])) {
  const r = readings.get(u);
  const number = pages[positions[u]].number ?? null;
  if (r.kind !== "session" || (!r.header && !r.entries.length)) continue;
  const recorded = mine().flatMap((s) => s.observations).filter((o) => number != null && o.page === number).length;

  if (r.header) {
    current = number != null ? startedOn.get(number) : null;
    if (current && mode === "replace") {
      const { id: sid, notebook, pages: ps, observations, ...old } = current;
      const fresh = headerFields(r.header);
      if (JSON.stringify(old) !== JSON.stringify(fresh)) {
        sessions.set(sid, { id: sid, ...fresh, notebook, pages: ps, observations });
        current = sessions.get(sid);
        touched.add(sid);
      }
    }
    if (!current) {
      const h = r.header;
      let sid = slug(`${h.date}-${h.site}`);
      for (let n = 2; sessions.has(sid); n++) sid = slug(`${h.date}-${h.site}-${n}`);
      current = { id: sid, ...headerFields(h), notebook: id, pages: [], observations: [] };
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
// sections marked rescan (and pages still waiting) to be rescanned; later
// completion scans close what they record. While the notebook is in
// progress, blank pages after the last written page stay open, since that's
// where the next session goes.
const status = mode === "complete" ? "completed" : existing?.status ?? "in_progress";
const finalSections = sections ?? defaultSections(pages);
const allPages = [...pages, ...back.map((b) => b.page)];
const { owner: finalOwner } = assignSections(finalSections, allPages);
const toRescan = (p, i) => Boolean(finalSections[finalOwner[i]]?.rescan) || (p.open && !["session", "blank"].includes(p.kind));
let frontCover = existing?.front_cover ?? null;
if (status === "completed") {
  const asking = mode === "complete" && !uploaded.length && existing.status !== "completed";
  allPages.forEach((p, i) => {
    if (asking ? toRescan(p, i) : !fresh.has(p) && p.open && toRescan(p, i)) p.open = true;
    else delete p.open;
  });
  if (asking && frontCover && finalSections.some((s) => s.kind === "front_cover" && s.rescan)) frontCover = { open: true };
} else {
  const lastWritten = pages.findLastIndex((p) => p.kind !== "blank");
  pages.forEach((p, i) => {
    if (p.kind === "blank" && i > lastWritten) p.open = true;
    else if (p.kind === "blank") delete p.open;
  });
}
// Keep the key order of hand-written entries, with open last before redact.
for (const [i, p] of allPages.entries()) {
  const { kind, label, number, note, open, redact: boxes } = p;
  allPages[i] = present({ kind, label, number, note, open, redact: boxes });
}

// 7. Write the notebook, sessions, and processed page images.
const label = [...readings.values()].map((r) => r.notebook_label).find(Boolean) ?? {};
const dates = mine().map((s) => s.date).sort();
const notebook = {
  id,
  title: existing?.title ?? opts.title ?? label.title ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  owner: existing?.owner ?? label.owner ?? null,
  status,
  started: existing?.started ?? label.started ?? dates[0] ?? null,
  // The finish date written on the volume label wins once it's been rescanned.
  finished: label.finished ?? existing?.finished ?? (status === "completed" ? dates.at(-1) ?? null : null),
  scan,
  ...(frontCover && { front_cover: frontCover }),
  // A new notebook's sections follow its front matter as read; edit them by
  // hand if the notebook is laid out differently.
  sections: finalSections,
  pages: allPages,
};
await mkdir(join("data", "notebooks"), { recursive: true });
await writeFile(notebookPath, formatJSON(notebook) + "\n");
await mkdir(join("data", "sessions"), { recursive: true });
for (const sid of touched) {
  await writeFile(join("data", "sessions", `${sid}.json`), formatJSON(sessions.get(sid)) + "\n");
}
for (const sid of removed) await rm(join("data", "sessions", `${sid}.json`), { force: true });
await mkdir(join("scans", id), { recursive: true });
for (const u of toRecord) {
  await writeFile(pageImage(id, positions[u]), await webImage(await redact(uploaded[u], allPages[positions[u]].redact)));
}
// Back matter goes after the other pages, wherever they now end. It has no
// show-through cleaning: the blank pages it backs onto aren't scanned.
for (const [k, b] of back.entries()) {
  await writeFile(pageImage(id, pages.length + k), b.image);
  await rm(pageImage(id, pages.length + k).replace(/\.jpg$/, ".clean.jpg"), { force: true });
}
for (let i = allPages.length; i < (existing?.pages.length ?? 0); i++) {
  await rm(pageImage(id, i), { force: true });
  await rm(pageImage(id, i).replace(/\.jpg$/, ".clean.jpg"), { force: true });
}
// New pages may complete a sheet whose other side came in an earlier upload.
if (toRecord.length) cleanShowThrough(id, toRecord.map((u) => positions[u]));

// 8. Summarize for the pull request.
const what = {
  new: "Created", add: "Added to", replace: "Replaced pages in", complete: "Completed",
}[mode];
const placed = toRecord.map((u) => positions[u]).sort((a, b) => a - b);
const pageName = (i) => (allPages[i].number != null ? `page ${allPages[i].number}` : (allPages[i].label ?? allPages[i].kind).toLowerCase());
const pageRange = (a, b) => (a === b ? pageName(a) : `${pageName(a)} to ${pageName(b)}`);
const lines = [
  `${what} **${notebook.title}**` + (source
    ? ` from \`${basename(source)}\`: ${toRecord.length + backUpload.length} of ${uploaded.length} uploaded pages recorded` +
      (placed.length ? ` (${pageRange(placed[0], placed.at(-1))})` : "") + "." +
      (backUpload.length ? ` At the back: ${backUpload.map((u) => readings.get(u).kind).join(", ")}.` : "")
    : "."),
  `Status: **${status === "completed" ? "completed" : "in progress"}**.`,
  "",
];
if (touched.size || removed.size) {
  lines.push("Before merging, compare each session with its pages in the notebook view, and fix",
    "any misread field by editing the session's JSON file on this branch.", "");
  for (const sid of touched) {
    const s = sessions.get(sid);
    lines.push(`- \`${sid}\`: ${s.observations.map((o) => o.catalog_id).join(", ")} (pages ${s.pages.join(", ")})`);
  }
  for (const sid of removed) lines.push(`- \`${sid}\`: removed (no entries left)`);
} else {
  lines.push("No session entries changed.");
}
const rescan = awaitingRescan(allPages.slice(0, pages.length));
if (status === "completed") {
  // What completing asks to be rescanned, and whether it has been.
  const todo = finalSections.flatMap((section, k) => {
    if (!section.rescan) return [];
    const name = section.label ?? section.kind;
    if (section.kind === "front_cover") return [{ name, k, todo: !frontCover ? "not scanned yet" : frontCover.open ? "rescan it" : null }];
    const ps = allPages.filter((_, i) => finalOwner[i] === k);
    return [{ name, k, todo: !ps.length ? "not scanned yet" : ps.some((p) => p.open) ? "rescan it" : null }];
  });
  lines.push("", "### Rescan checklist", "",
    ...todo.map(({ name, todo: t }) => `- [${t ? " " : "x"}] ${name}${t ? `: ${t}` : ""}`));
  const backTodo = todo.filter((t) => t.todo && t.k >= backStart(finalSections)).map((t) => t.name.toLowerCase());
  if (rescan.length || backTodo.length) {
    lines.push("", "Scan these in this order into one file, upload it, and run **Complete notebook** again with that file:", "");
    rescan.forEach((s, k) => lines.push(`${k + 1}. ${describeSpread(allPages, s)}`));
    if (backTodo.length) lines.push(`${rescan.length + 1}. then the ${backTodo.join(" and ")} spreads at the back`);
  }
  if (todo.some((t) => t.todo && finalSections[t.k].kind === "front_cover")) {
    lines.push("", "Scan the closed notebook's front cover on its own, upload it, and run **Add front cover**.");
  }
  // Blank pages are confirmed by hand, and other sections still to scan are listed.
  const blanks = allPages.flatMap((p, i) => (p.kind === "blank" ? [p.number != null ? `page ${p.number}` : `scan position ${nn(i)}`] : []));
  if (blanks.length) {
    lines.push("", "### Blank pages", "", "These pages were read as blank. Check each is meant to be blank before merging:", "",
      ...blanks.map((b) => `- ${b}`));
  }
  const missing = missingSections(notebook).filter((s) => !s.rescan);
  if (missing.length) {
    lines.push("", "### Not scanned yet", "", ...missing.map((s) => `- ${s.label ?? s.kind}`));
  }
} else if (rescan.length) {
  lines.push("", "### When the notebook is complete", "", "These spreads are hidden until then, and will need rescanning:", "");
  rescan.forEach((s, k) => lines.push(`${k + 1}. ${describeSpread(allPages, s)}`));
}
if (notes.length) lines.push("", "### Check these", "", ...notes);
const summary = lines.join("\n") + "\n";
if (opts.summary) await writeFile(opts.summary, summary);
console.log(summary);
