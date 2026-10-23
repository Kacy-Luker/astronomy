// Import a scanned notebook: split pages, read them with Claude, write JSON.
//
//   node scripts/import-notebook.mjs <notebook-id> <scan.pdf | folder> [--title T] [--summary out.md]
//
// Pages already listed in data/notebooks/<id>.json are kept as they are, so
// re-importing a notebook after filling more pages only reads the new ones,
// and corrections made by hand survive. Readings are cached in
// .import-cache/<id>/ so a rerun doesn't pay for the same page twice.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatJSON } from "./lib/format-json.mjs";
import { listSpreads, pageImage, redact, splitSpread, webImage } from "./lib/pages.mjs";

const { positionals: [id, source], values: opts } = parseArgs({
  allowPositionals: true,
  options: { title: { type: "string" }, summary: { type: "string" } },
});
if (!id || !source) {
  console.error("usage: node scripts/import-notebook.mjs <notebook-id> <scan.pdf | folder> [--title T] [--summary out.md]");
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

// 1. Split every spread into pages.
const work = await mkdtemp(join(tmpdir(), "notebook-"));
const pages = [];
for (const file of await listSpreads(source, work)) pages.push(...await splitSpread(file, scan));
await rm(work, { recursive: true, force: true });
if (pages.length < known.length) {
  throw new Error(`the scan has ${pages.length} pages but ${notebookPath} lists ${known.length}`);
}
const fresh = pages.map((_, i) => i).filter((i) => i >= known.length);
console.log(`${pages.length} pages; ${fresh.length} new`);

// 2. Read the new pages (cached), a few at a time.
const cacheDir = join(".import-cache", id);
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
const nn = (i) => String(i + 1).padStart(2, "0");
const readings = new Map(await inBatches(fresh, async (i) => {
  const reading = await cached(nn(i), async (c) => c.readPage(await webImage(pages[i], READ_HEIGHT)));
  console.log(`  read page ${nn(i)}: ${reading.kind}${reading.printed_number ? ` #${reading.printed_number}` : ""}`);
  return [i, reading];
}));

// 3. Number the pages. Printed odd numbers fix the offset between scan
// position and page number; the most common offset wins.
const votes = new Map();
const vote = (offset) => votes.set(offset, (votes.get(offset) ?? 0) + 1);
known.forEach((p, i) => p.number != null && vote(p.number - i));
for (const [i, r] of readings) if (r.printed_number % 2 === 1) vote(r.printed_number - i);
const offset = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
if (offset == null) notes.push("- **No printed page numbers found**, so new pages are unnumbered. Set `number` by hand.");
for (const [i, r] of readings) {
  if (r.printed_number != null && offset != null && r.printed_number !== i + offset) {
    notes.push(`- Scan page ${nn(i)} shows number ${r.printed_number}, expected ${i + offset}. Check the page order.`);
  }
}

// 4. Describe the new pages, blurring personal details.
const clamp = (v) => Math.min(1, Math.max(0, v));
const entries = await inBatches(fresh, async (i) => {
  const r = readings.get(i);
  const number = offset != null && i + offset >= 1 ? i + offset : null;
  const page = { kind: r.kind };
  if (r.label && !["session", "blank", "unused"].includes(r.kind)) page.label = r.label;
  if (number != null) page.number = number;
  if (r.personal_info.length) {
    page.redact = r.personal_info.map(({ box }) => {
      const x = clamp(box.x - PAD), y = clamp(box.y - PAD);
      const round = (v) => Math.round(v * 1000) / 1000;
      return [round(x), round(y), round(clamp(box.x + box.width + PAD) - x), round(clamp(box.y + box.height + PAD) - y)];
    });
    const check = await cached(`${nn(i)}.check`, async (c) =>
      c.checkRedaction(await webImage(await redact(pages[i], page.redact), READ_HEIGHT)));
    if (check.legible) {
      page.redact = [[0, 0, 1, 1]];
      notes.push(`- Scan page ${nn(i)}: details were still readable after blurring (${check.what.join(", ")}), so the whole page is blurred. Narrow \`redact\` by hand if you like.`);
    } else {
      notes.push(`- Scan page ${nn(i)}: blurred ${r.personal_info.map((p) => p.what).join(", ")}.`);
    }
  }
  return page;
});

// 5. Turn session pages into session files, continuing the last session
// when a page has entries but no NEW SESSION header.
const sessionDir = join("data", "sessions");
const sessions = new Map();
for (const f of (await readdir(sessionDir)).filter((f) => f.endsWith(".json"))) {
  const s = JSON.parse(await readFile(join(sessionDir, f), "utf8"));
  sessions.set(s.id, s);
}
const touched = new Set();
const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

let current = [...sessions.values()]
  .filter((s) => s.notebook === id && s.pages?.length)
  .sort((a, b) => Math.max(...a.pages) - Math.max(...b.pages))
  .at(-1) ?? null;

fresh.forEach((i, k) => {
  const r = readings.get(i);
  const number = entries[k].number;
  if (r.kind !== "session" || (!r.header && !r.entries.length)) return;
  if (r.header) {
    const h = r.header;
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
  } else if (!current) {
    notes.push(`- Scan page ${nn(i)} has entries but no session to belong to. They were skipped.`);
    return;
  }
  if (number != null && !current.pages.includes(number)) current.pages.push(number);
  for (const e of r.entries) {
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
  touched.add(current.id);
  for (const u of r.uncertain) notes.push(`- ${current.id}, page ${number ?? `scan ${nn(i)}`}: ${u}`);
});

// 6. Write the notebook, sessions, and page images.
const label = [...readings.values()].map((r) => r.notebook_label).find(Boolean) ?? {};
const datesHere = [...sessions.values()].filter((s) => s.notebook === id).map((s) => s.date).sort();
const notebook = {
  id,
  title: existing?.title ?? opts.title ?? label.title ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  owner: existing?.owner ?? label.owner ?? null,
  started: existing?.started ?? label.started ?? datesHere[0] ?? null,
  finished: existing?.finished ?? label.finished ?? null,
  scan,
  pages: [...known, ...entries],
};
await mkdir(join("data", "notebooks"), { recursive: true });
await writeFile(notebookPath, formatJSON(notebook) + "\n");
for (const sid of touched) {
  await writeFile(join(sessionDir, `${sid}.json`), formatJSON(sessions.get(sid)) + "\n");
}
await rm(join("scans", id), { recursive: true, force: true });
await mkdir(join("scans", id), { recursive: true });
for (const [i, page] of pages.entries()) {
  await writeFile(pageImage(id, i), await webImage(await redact(page, notebook.pages[i].redact)));
}

// 7. Summarize for the pull request.
const lines = [
  `Imported **${notebook.title}**: ${pages.length} pages, ${fresh.length} new.`,
  "",
  "Before merging, compare each session with its pages in the notebook view, and fix",
  "any misread field by editing the session's JSON file on this branch.",
  "",
  ...[...touched].map((sid) => {
    const s = sessions.get(sid);
    return `- \`${sid}\`: ${s.observations.map((o) => o.catalog_id).join(", ")} (pages ${s.pages.join(", ")})`;
  }),
];
if (notes.length) lines.push("", "### Check these", "", ...notes);
const summary = lines.join("\n") + "\n";
if (opts.summary) await writeFile(opts.summary, summary);
console.log(summary);
