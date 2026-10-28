// The import end to end (#99): Test Notebook 2's drawn pages, put back into
// sideways two-page spreads, go through the real scripts/import-notebook.mjs
// in a scratch folder. Claude's readings are written by hand from the test
// data into .import-cache/, so no API key is needed, and catalog lookups
// are off (CATALOG_SOURCES), so nothing is fetched. A new import of the first four spreads, then an add with a
// rescanned spread and a new one, must give back the test data's notebook
// and sessions, with the title page blurred.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import sharp from "sharp";
import { BLURRED, sharpness } from "./sharpness.mjs";

const REPO = resolve(".");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
// A test notebook: its pages and sessions, and its page images (the title
// page unblurred).
function book(id) {
  const notebook = read(`test-data/notebooks/${id}.json`);
  const sessions = readdirSync("test-data/sessions").map((f) => read(`test-data/sessions/${f}`)).filter((s) => s.notebook === id);
  const image = (i) => {
    const unblurred = `test-data/unblurred/${id}-${String(i + 1).padStart(2, "0")}.jpg`;
    return existsSync(unblurred) ? unblurred : `test-data/scans/${id}/${String(i + 1).padStart(2, "0")}.jpg`;
  };
  return { id, notebook, sessions, image };
}
const ID = "test-002";
const { notebook, sessions, image } = book(ID);
// A notebook written without the stamp (#109).
const FREE = book("test-003");
const asBox = ([x, y, width, height]) => ({ x, y, width, height });
const PAD = 0.02; // the import pads personal-info boxes by this much

// What Claude would read on the notebook's page i.
function reading(i, { notebook, sessions } = book(ID)) {
  const page = notebook.pages[i];
  const n = page.number;
  const starts = sessions.find((s) => s.header_box?.page === n && page.kind === "session");
  return {
    kind: page.kind,
    printed_number: n % 2 === 1 ? n : null,
    label: page.label ?? null,
    will_change: Boolean(page.open),
    notebook_label: page.kind === "title"
      ? { title: notebook.title, owner: notebook.owner, started: notebook.started, finished: notebook.finished }
      : null,
    personal_info: (page.redact ?? []).map(([x, y, w, h]) => ({ what: "phone number and email", box: asBox([x + PAD, y + PAD, w - 2 * PAD, h - 2 * PAD]) })),
    header: starts ? {
      program: starts.program ?? null, date: starts.date, site: starts.site.name,
      lat: starts.site.lat ?? null, lon: starts.site.lon ?? null,
      sqm: starts.sky?.sqm ?? null, sky_notes: starts.sky?.notes ?? null,
      scope: starts.scope, observers: starts.observers, box: asBox(starts.header_box.box),
    } : null,
    entries: n == null ? [] : sessions.flatMap((s) => s.observations).filter((o) => o.page === n).map((o) => ({
      catalog_id: o.catalog_id, aka: o.aka, local_time: o.local_time, ut: o.ut ?? null,
      seeing: o.seeing, transparency: o.transparency, eyepiece: o.eyepiece,
      magnification: o.magnification ?? null, filter: o.filter, description: o.description, box: asBox(o.box),
    })),
    uncertain: [],
  };
}

// A reading with nothing on the page but its kind.
const bare = (kind) => ({
  kind, printed_number: null, label: null, will_change: false, notebook_label: null,
  personal_info: [], header: null, entries: [], uncertain: [],
});

// A scan: pages [a, b], [c, d], ... side by side with a faint fold between
// them, turned sideways as the scanner gives them (the notebook's scan.rotate
// turns them back), with the readings cached under the scan's name. A page is
// the notebook's page index, or { file, reading } for anything else, or
// { page, kind } for a page Claude puts in another category.
async function scan(work, name, pairs, { id, notebook, image, ...rest } = book(ID)) {
  const dir = join(work, "uploads", name);
  mkdirSync(dir, { recursive: true });
  const cache = join(work, ".import-cache", id, name);
  mkdirSync(cache, { recursive: true });
  for (const [k, pair] of pairs.entries()) {
    const fileOf = (i) => (typeof i === "number" ? image(i) : i.file ?? image(i.page));
    const height = (await sharp(fileOf(pair[0])).metadata()).height;
    const [left, right] = await Promise.all(pair.map((i) => sharp(fileOf(i)).resize({ height }).toBuffer({ resolveWithObject: true })));
    const { width: w, height: h } = left.info;
    const fold = await sharp({ create: { width: 4, height: h, channels: 3, background: "#d8d4ca" } }).png().toBuffer();
    const spread = await sharp({ create: { width: w + right.info.width, height: h, channels: 3, background: "#f4f1e8" } })
      .composite([{ input: left.data, left: 0, top: 0 }, { input: right.data, left: w, top: 0 }, { input: fold, left: w - 2, top: 0 }])
      .png().toBuffer();
    await sharp(spread).rotate(-90).jpeg({ quality: 90 }).toFile(join(dir, `${String(k + 1).padStart(2, "0")}.jpg`));
    pair.forEach((i, side) => {
      const u = String(2 * k + side + 1).padStart(2, "0");
      const page = typeof i === "number" ? i : i.page;
      const read = i.reading ?? { ...reading(page, { notebook, ...rest }), ...(i.kind && { kind: i.kind }) };
      writeFileSync(join(cache, `${u}.json`), JSON.stringify(read));
      // The blur check: nothing readable is left.
      if (notebook.pages[page]?.redact) writeFileSync(join(cache, `${u}.check.json`), JSON.stringify({ legible: false, what: [] }));
    });
  }
  return dir;
}

let work;
const runFor = (id, ...args) => execFileSync("node", ["scripts/import-notebook.mjs", id, ...args], {
  cwd: work, encoding: "utf8", env: { ...process.env, CATALOG_SOURCES: "", ANTHROPIC_API_KEY: "" },
});
const run = (...args) => runFor(ID, ...args);
const out = (path) => read(join(work, path));
const session = (s) => {
  const { id, program, date, site, sky, scope, observers, pages, header_box } = s;
  const observations = s.observations.map(({ catalog_id, aka, page, local_time, seeing, transparency, eyepiece, magnification, filter, description, box }) =>
    ({ catalog_id, aka, page, local_time, seeing, transparency, eyepiece, magnification, filter, description, box }));
  return { id, program, date, site, sky, scope, observers, pages, header_box, observations };
};

before(() => {
  // A scratch copy of the repo's layout: the scripts, site and tools linked,
  // the data folders empty, so the import writes only here.
  work = mkdtempSync(join(tmpdir(), "import-test-"));
  for (const f of ["scripts", "site", "node_modules", "package.json", ".venv"]) {
    if (existsSync(join(REPO, f))) symlinkSync(join(REPO, f), join(work, f));
  }
  mkdirSync(join(work, "data", "sessions"), { recursive: true });
  mkdirSync(join(work, "data", "notebooks"), { recursive: true });
  cpSync(join(REPO, "data", "categories.json"), join(work, "data", "categories.json"));
});
// KEEP=1 keeps the scratch folder to look at.
after(() => { if (process.env.KEEP) console.log("kept", work); else rmSync(work, { recursive: true, force: true }); });

// The first four spreads (covers to page 4), then a rescan of pages 3–4
// with the new spread of pages 5–6.
const FIRST = [[0, 1], [2, 3], [4, 5], [6, 7]];
const SECOND = [[6, 7], [8, 9]];

test("a new import records the pages, sessions and blur", async () => {
  const summary = run(await scan(work, "first", FIRST), "--mode", "new");
  const nb = out(`data/notebooks/${ID}.json`);
  assert.equal(nb.title, notebook.title);
  assert.equal(nb.owner, notebook.owner);
  assert.equal(nb.status, "in_progress");
  assert.equal(nb.type, "stamped-spreads", "a new notebook without --type is the first type");
  assert.deepEqual(nb.scan, { rotate: 90, split: 0.47 });
  assert.deepEqual(nb.pages, notebook.pages.slice(0, 8));
  for (let i = 0; i < 8; i++) assert.ok(existsSync(join(work, "scans", ID, `${String(i + 1).padStart(2, "0")}.jpg`)), `page image ${i + 1}`);
  // The title page went in readable and came out blurred where the details are.
  const title = notebook.pages.findIndex((p) => p.kind === "title");
  for (const box of notebook.pages[title].redact) {
    assert.ok(await sharpness(image(title), box) > BLURRED, "the test's title page should start readable");
    assert.ok(await sharpness(join(work, "scans", ID, `${String(title + 1).padStart(2, "0")}.jpg`), box) < BLURRED, "the import didn't blur the title page");
  }
  assert.match(summary, /Created \*\*Test Notebook 2\*\*/);
  assert.match(summary, /blurred phone number and email/);
});

test("a notebook's type is checked, and kept once it's made", () => {
  const refused = (args, problem) => assert.throws(
    () => execFileSync("node", ["scripts/import-notebook.mjs", ...args], { cwd: work, encoding: "utf8", stdio: "pipe" }),
    (err) => (assert.match(err.stderr, problem), true));
  const upload = join(work, "uploads", "first");
  refused(["another", upload, "--mode", "new", "--type", "Spiral"], /isn't a notebook type; pick one of Stamped log, spreads/);
  refused([ID, upload, "--mode", "add", "--type", "Spiral"], /its type is chosen when it's created/);
});

test("an add import skips recorded pages and adds the new ones", async () => {
  const summary = run(await scan(work, "second", SECOND), "--mode", "add");
  const nb = out(`data/notebooks/${ID}.json`);
  assert.deepEqual(nb.pages, notebook.pages.slice(0, 10));
  assert.match(summary, /Skipped 2 uploaded page\(s\) that were already recorded/);
  // Every session, as in the test data (ids grow with catalog lookups, so
  // they're left out).
  const written = readdirSync(join(work, "data", "sessions")).map((f) => session(out(`data/sessions/${f}`)));
  assert.deepEqual(written.sort((a, b) => a.id.localeCompare(b.id)), sessions.map(session).sort((a, b) => a.id.localeCompare(b.id)));
});

test("a free-text notebook (#109) is read the same way, and kept as scanned", async () => {
  const { id, notebook: nb3, sessions: s3 } = FREE;
  runFor(id, await scan(work, "free", [[0, 1], [2, 3], [4, 5]], FREE), "--mode", "new", "--type", "Free-text log, spreads");
  const nb = out(`data/notebooks/${id}.json`);
  assert.equal(nb.type, "free-spreads");
  assert.deepEqual(nb.pages, nb3.pages.slice(0, 6));
  // A session that starts partway down page 2 still takes the entry above
  // its heading's box as the session before's.
  const written = s3.map((s) => session(out(`data/sessions/${s.id}.json`)));
  assert.deepEqual(written, s3.map(session));
  // Show-through cleaning fits the stamp, so there's nothing to clean.
  assert.deepEqual(readdirSync(join(work, "scans", id)).filter((f) => f.includes(".clean.")), []);
});

test("one front cover: a title page that also reads as a cover is kept as the title page", async () => {
  // As in the first live import (#16): the closed notebook first, then the
  // title page, which Claude also read as the front cover.
  const id = "cover-test";
  const lid = join(work, "lid.png");
  await sharp({ create: { width: 1000, height: 1600, channels: 3, background: "#fafafa" } }).png().toFile(lid);
  const cover = { file: `test-data/scans/${ID}/cover-front.jpg`, reading: bare("front_cover") };
  const title = notebook.pages.findIndex((p) => p.kind === "title");
  const summary = runFor(id, await scan(work, "cover", [[cover, { file: lid, reading: bare("blank") }], [0, { page: title, kind: "front_cover" }], [2, 3]], { ...book(ID), id }),
    "--mode", "new");
  const nb = out(`data/notebooks/${id}.json`);
  assert.deepEqual(nb.pages.map((p) => p.kind), notebook.pages.slice(0, 4).map((p) => p.kind));
  assert.ok(existsSync(join(work, "scans", id, "cover-front.jpg")));
  assert.match(summary, /also reads as the front cover; scan 1 was used as the cover, and this page was kept as the title page/);
  for (const box of notebook.pages[title].redact) {
    assert.ok(await sharpness(join(work, "scans", id, `${String(title + 1).padStart(2, "0")}.jpg`), box) < BLURRED, "the title page wasn't blurred");
  }
});
