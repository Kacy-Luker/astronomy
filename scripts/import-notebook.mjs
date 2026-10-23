// Import a scan into a notebook: split pages, read them with Claude, write JSON.
//
//   node scripts/import-notebook.mjs <notebook-id> <scan> [--title T] [--completed] [--summary out.md]
//
// <scan> is a PDF, an image, or a folder of images, holding one or more
// two-page spreads: usually just the spreads written since the last import.
// Printed odd page numbers place the pages in the notebook. A spread that was
// imported before (say, a half-used page the next session continues on) is
// rescanned safely: its image is replaced and only entries beyond the ones
// already recorded on each page are added, so corrections made by hand
// survive. Readings are cached in .import-cache/ so a rerun doesn't pay twice.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { formatJSON } from "./lib/format-json.mjs";
import { listSpreads, pageImage, redact, splitSpread, webImage } from "./lib/pages.mjs";

const { positionals: [id, source], values: opts } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: "string" },
    completed: { type: "boolean", default: false },
    summary: { type: "string" },
  },
});
if (!id || !source) {
  console.error("usage: node scripts/import-notebook.mjs <notebook-id> <scan> [--title T] [--completed] [--summary out.md]");
  process.exit(2);
}

const READ_HEIGHT = 2000; // what Claude sees; the site gets PAGE_HEIGHT
const PARALLEL = 4;
const PAD = 0.02; // margin added around each personal-info box

const notebookPath = join("data", "notebooks", `${id}.json`);
const existing = existsSync(notebookPath) ? JSON.parse(await readFile(notebookPath, "utf8")) : null;
const known = existing?.pages ?? [];
const scan = existing?.scan ?? { rotate: 90, split: 0.47 };
const notes = []; // lines for the PR summary
const nn = (i) => String(i + 1).padStart(2, "0");

// 1. Split the uploaded spreads into pages.
const work = await mkdtemp(join(tmpdir(), "notebook-"));
const uploaded = [];
for (const file of await listSpreads(source, work)) uploaded.push(...await splitSpread(file, scan));
await rm(work, { recursive: true, force: true });
console.log(`${uploaded.length} pages in ${basename(source)}`);

// 2. Read every uploaded page (cached per upload), a few at a time.
const cacheDir = join(".import-cache", id, basename(source));
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
const readings = await inBatches(uploaded.map((_, u) => u), async (u) => {
  const reading = await cached(nn(u), async (c) => c.readPage(await webImage(uploaded[u], READ_HEIGHT)));
  console.log(`  read page ${nn(u)}: ${reading.kind}${reading.printed_number ? ` #${reading.printed_number}` : ""}`);
  return reading;
});

// 3. Place the upload in the notebook. Offsets map a position in a page list
// to a page number; the most common one among printed odd numbers wins.
function commonOffset(pairs) {
  const votes = new Map();
  for (const [pos, number] of pairs) votes.set(number - pos, (votes.get(number - pos) ?? 0) + 1);
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
}
let offset = commonOffset(known.flatMap((p, i) => (p.number != null ? [[i, p.number]] : [])));
const uploadOffset = commonOffset(readings.flatMap((r, u) =>
  r.printed_number % 2 === 1 ? [[u, r.printed_number]] : []));

let start; // notebook position of the upload's first page
if (uploadOffset != null && offset != null) {
  start = uploadOffset - offset;
} else if (uploadOffset != null) {
  start = known.length; // first numbered upload: it follows whatever is known
  offset = uploadOffset - start;
} else if (offset != null) {
  // No visible numbers: assume the upload begins with the spread holding the
  // first page after the last one with entries (left pages are even).
  const used = (await loadSessions()).filter((s) => s.notebook === id).flatMap((s) => s.pages ?? []);
  const next = (used.length ? Math.max(...used) : 0) + 1;
  start = (next % 2 ? next - 1 : next) - offset;
  notes.push(`- No page numbers were visible, so the upload was placed starting at page ${start + offset}. Check that's right.`);
} else {
  start = known.length;
  notes.push("- **No page numbers found**, so pages are unnumbered. Set `number` by hand.");
}
if (start < 0 || start > known.length) {
  const first = known.length + (offset ?? 0);
  throw new Error(start > known.length
    ? `this upload starts at page ${start + offset}, but the notebook only goes up to page ${first - 1}; scan the pages in between too`
    : `this upload would start before the notebook's first page`);
}
for (const [u, r] of readings.entries()) {
  const expected = offset != null ? start + u + offset : null;
  if (r.printed_number != null && expected != null && r.printed_number !== expected) {
    notes.push(`- Uploaded page ${nn(u)} shows number ${r.printed_number}, expected ${expected}. Check the page order.`);
  }
}

// 4. Describe each uploaded page, merging into pages already known.
const clamp = (v) => Math.min(1, Math.max(0, v));
const round = (v) => Math.round(v * 1000) / 1000;
const pages = [...known];
const rescanned = [];
await inBatches(uploaded.map((_, u) => u), async (u) => {
  const i = start + u;
  const r = readings[u];
  const number = offset != null && i + offset >= 1 ? i + offset : null;
  let page;
  if (i < known.length) {
    rescanned.push(i);
    page = { ...known[i] };
    // A page that was empty last time may have been written on since.
    if (["blank", "unused"].includes(page.kind) && !["blank", "unused"].includes(r.kind)) page.kind = r.kind;
  } else {
    page = { kind: r.kind };
    if (r.label && !["session", "blank", "unused"].includes(r.kind)) page.label = r.label;
    if (number != null) page.number = number;
  }
  if (r.personal_info.length && !page.redact) {
    page.redact = r.personal_info.map(({ box }) => {
      const x = clamp(box.x - PAD), y = clamp(box.y - PAD);
      return [round(x), round(y), round(clamp(box.x + box.width + PAD) - x), round(clamp(box.y + box.height + PAD) - y)];
    });
    const check = await cached(`${nn(u)}.check`, async (c) =>
      c.checkRedaction(await webImage(await redact(uploaded[u], page.redact), READ_HEIGHT)));
    if (check.legible) {
      page.redact = [[0, 0, 1, 1]];
      notes.push(`- Page ${number ?? `at scan position ${nn(i)}`}: details were still readable after blurring (${check.what.join(", ")}), so the whole page is blurred. Narrow \`redact\` by hand if you like.`);
    } else {
      notes.push(`- Page ${number ?? `at scan position ${nn(i)}`}: blurred ${r.personal_info.map((p) => p.what).join(", ")}.`);
    }
  }
  pages[i] = page;
});

// 5. Add entries to sessions. A header starts a session; entries without one
// continue the latest session. On a rescanned page, entries already recorded
// there are skipped by count, so a misread on the second pass can't duplicate.
async function loadSessions() {
  const dir = join("data", "sessions");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8"))));
}
const sessions = new Map((await loadSessions()).map((s) => [s.id, s]));
const mine = () => [...sessions.values()].filter((s) => s.notebook === id);
const touched = new Set();
const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
const lastPage = (s) => Math.max(0, ...(s.pages ?? []));

let current = null;
for (const [u, r] of readings.entries()) {
  const number = pages[start + u].number ?? null;
  if (r.kind !== "session" || (!r.header && !r.entries.length)) continue;
  const recorded = mine().flatMap((s) => s.observations).filter((o) => number != null && o.page === number).length;

  if (r.header) {
    const h = r.header;
    // On a rescan, the session this header started already exists.
    current = mine().find((s) => number != null && s.pages?.[0] === number);
    if (!current) {
      let sid = slug(`${h.date}-${h.site}`);
      for (let n = 2; sessions.has(sid); n++) sid = slug(`${h.date}-${h.site}-${n}`);
      const sky = present({ sqm: h.sqm, notes: h.sky_notes });
      current = present({
        id: sid,
        program: h.program,
        date: h.date,
        site: present({ name: h.site, lat: h.lat, lon: h.lon }),
        sky: Object.keys(sky).length ? sky : null,
        scope: h.scope && present(h.scope),
        observers: h.observers,
        notebook: id,
        pages: [],
        observations: [],
      });
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
    touched.add(current.id);
    for (const note of r.uncertain) notes.push(`- ${current.id}, page ${number ?? "?"}: ${note}`);
  }
}

// 6. Write the notebook, the touched sessions, and the uploaded page images.
const label = readings.map((r) => r.notebook_label).find(Boolean) ?? {};
const dates = mine().map((s) => s.date).sort();
const status = opts.completed ? "completed" : existing?.status ?? "in_progress";
const notebook = {
  id,
  title: existing?.title ?? opts.title ?? label.title ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  owner: existing?.owner ?? label.owner ?? null,
  status,
  started: existing?.started ?? label.started ?? dates[0] ?? null,
  finished: existing?.finished ?? label.finished ?? (status === "completed" ? dates.at(-1) ?? null : null),
  scan,
  pages,
};
await mkdir(join("data", "notebooks"), { recursive: true });
await writeFile(notebookPath, formatJSON(notebook) + "\n");
for (const sid of touched) {
  await writeFile(join("data", "sessions", `${sid}.json`), formatJSON(sessions.get(sid)) + "\n");
}
await mkdir(join("scans", id), { recursive: true });
for (const [u, page] of uploaded.entries()) {
  await writeFile(pageImage(id, start + u), await webImage(await redact(page, pages[start + u].redact)));
}

// 7. Summarize for the pull request.
const span = (i) => pages[i].number ?? pages[i].label ?? `scan position ${nn(i)}`;
const lines = [
  `Imported \`${basename(source)}\` into **${notebook.title}**: ${uploaded.length} pages ` +
    `(${span(start)} to ${span(start + uploaded.length - 1)}), ` +
    `${uploaded.length - rescanned.length} new, ${rescanned.length} rescanned.`,
  `Notebook status: **${status === "completed" ? "completed" : "in progress"}**.`,
  "",
  "Before merging, compare each session with its pages in the notebook view, and fix",
  "any misread field by editing the session's JSON file on this branch.",
  "",
  ...(touched.size
    ? [...touched].map((sid) => {
      const s = sessions.get(sid);
      return `- \`${sid}\`: ${s.observations.map((o) => o.catalog_id).join(", ")} (pages ${s.pages.join(", ")})`;
    })
    : ["No new entries."]),
];
if (notes.length) lines.push("", "### Check these", "", ...notes);
const summary = lines.join("\n") + "\n";
if (opts.summary) await writeFile(opts.summary, summary);
console.log(summary);
