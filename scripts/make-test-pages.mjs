// Draw the test site's page images (#64) from the test data: made-up
// notebook pages, never Kacy's scans. Writes test-data/scans/<id>/NN.jpg
// (and .clean.jpg for test-001's session pages, so both views are tested),
// cover-front.jpg, unblurred/<id>-NN.jpg for pages with redact boxes (for
// the import test), and each session's header_box and observation boxes,
// which come from where this script draws them.
//
//   node scripts/make-test-pages.mjs
//
// Run it after changing test-data/notebooks or test-data/sessions; the
// images are committed, so the build doesn't depend on fonts.
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { pageName, readJSON, readJSONDir, writeJSON } from "./lib/files.mjs";
import { typeOf } from "./lib/notebook-types.mjs";
import { redact } from "./lib/pages.mjs";

const DIR = "test-data";
const W = 1000, H = 1600;
const PAPER = "#f4f1e8", STAMP = "#5b4b9c", PENCIL = "#3a3a3a";
const ROMAN = ["I", "II", "III", "IV", "V"];

const notebooks = await readJSONDir(join(DIR, "notebooks"));
const sessions = (await readJSONDir(join(DIR, "sessions"))).sort((a, b) => a.data.date.localeCompare(b.data.date));

const xml = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const shown = (v) => (v == null ? "" : v);
const text = (x, y, t, { size = 26, color = PENCIL, weight = "normal", italic = color === PENCIL, anchor = "start" } = {}) =>
  `<text x="${x}" y="${y}" font-family="DejaVu Sans" font-size="${size}" fill="${color}" font-weight="${weight}"${italic ? ' font-style="italic"' : ""} text-anchor="${anchor}">${xml(t)}</text>`;
const label = (x, y, t) => text(x, y, t, { size: 17, color: STAMP, weight: "bold" });
function wrap(t, width) {
  const lines = [];
  let line = "";
  for (const word of String(t ?? "").split(/\s+/).filter(Boolean)) {
    if ((line + " " + word).trim().length > width) { lines.push(line); line = word; } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}
// A small seeded random, so the drawings are the same on every run.
function random(seed) {
  let s = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const circled = (x, y, value) => ROMAN.map((r, i) => {
  const cx = x + i * 44;
  return text(cx, y, r, { size: 18, color: STAMP, weight: "bold", anchor: "middle" }) +
    (value === i + 1 ? `<ellipse cx="${cx}" cy="${y - 6}" rx="19" ry="15" fill="none" stroke="${PENCIL}" stroke-width="2.5"/>` : "");
}).join("") + (value === "N/A" ? text(x + 230, y, "N/A") : "");

// The NEW SESSION block and an entry, drawn at top (px) with height h.
function header(s, top, h) {
  const at = (row) => top + 50 + row * 46;
  const site = s.site.lat != null ? `${s.site.lat}, ${s.site.lon}` : "";
  return `<rect x="30" y="${top}" width="${W - 60}" height="${h}" fill="none" stroke="${STAMP}" stroke-width="3"/>` +
    text(50, top + 32, "NEW SESSION", { size: 22, color: STAMP, weight: "bold" }) +
    label(50, at(1), "DATE") + text(130, at(1), s.date) + label(520, at(1), "PROGRAM") + text(630, at(1), shown(s.program)) +
    label(50, at(2), "SITE") + text(130, at(2), s.site.name) + label(520, at(2), "LAT/LON") + text(630, at(2), site) +
    label(50, at(3), "SCOPE") + text(130, at(3), shown(s.scope?.name)) + label(520, at(3), "SQM") + text(630, at(3), shown(s.sky?.sqm)) +
    label(50, at(4), "OBSERVERS") + text(190, at(4), s.observers.join(", "), { size: 22 }) +
    label(50, at(5) - 8, "NOTES") + text(130, at(5) - 8, shown(s.sky?.notes), { size: 20 });
}
function entry(o, top, h, crossed = false) {
  const at = (row) => top + 40 + row * 44;
  // The stamp's sketch circle: about 14% of the entry's width in radius, as
  // on the real sheets, so scripts/lib/circle.mjs finds it for the thumbnails.
  const r = 130, cx = W - 60 - r - 20, cy = top + 20 + r;
  const rand = random(`${o.catalog_id}${o.local_time}`);
  // A shaded glow, as the real sketches have for nebulae and galaxies;
  // its tone also gives the page the contrast scripts/lib/match.mjs needs.
  const glow = `<ellipse cx="${cx}" cy="${cy}" rx="${Math.round(r * (0.6 + rand() * 0.3))}" ry="${Math.round(r * (0.45 + rand() * 0.2))}" fill="url(#glow)" transform="rotate(${Math.round(rand() * 180)} ${cx} ${cy})"/>`;
  const stars = Array.from({ length: 40 }, () => {
    const a = rand() * 2 * Math.PI, d = Math.sqrt(rand()) * (r - 8);
    return `<circle cx="${(cx + d * Math.cos(a)).toFixed(1)}" cy="${(cy + d * Math.sin(a)).toFixed(1)}" r="${(1 + rand() * 3).toFixed(1)}" fill="${PENCIL}"/>`;
  }).join("");
  const ep = [o.eyepiece, o.magnification != null ? `${o.magnification}x` : null].filter(Boolean).join(" / ");
  const lines = wrap(o.description, 62).slice(0, 5);
  return `<rect x="30" y="${top}" width="${W - 60}" height="${h}" fill="none" stroke="${STAMP}" stroke-width="2"/>` +
    label(50, at(0), "CAT #") + text(130, at(0), o.catalog_id) + label(50, at(1), "AKA") + text(130, at(1), shown(o.aka)) +
    label(50, at(2), "LT / UT") + text(150, at(2), [o.local_time, o.ut].map(shown).join(" / ")) +
    label(50, at(3), "SEEING") + circled(190, at(3), o.seeing) +
    label(50, at(4), "TRANS") + circled(190, at(4), o.transparency) +
    label(50, at(5), "EP / MAG") + text(160, at(5), ep) + label(430, at(5), "FILTER") + text(510, at(5), shown(o.filter)) +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${STAMP}" stroke-width="4"/>` + glow + stars +
    lines.map((l, i) => text(50, at(6) + i * 30, l, { size: 22 })).join("") +
    (crossed ? `<path d="M40 ${top + 10} L${W - 40} ${top + h - 10} M${W - 40} ${top + 10} L40 ${top + h - 10}" stroke="${PENCIL}" stroke-width="5"/>` : "");
}
// A notebook without the stamp (#109): a date heading and lines about the
// night, then a paragraph per object with a sketch beside it, in pencil only.
// Only the fields given are written, so the rest are to-dos.
function freeHeader(s, top) {
  const where = [s.site.name, s.site.lat != null ? `(${s.site.lat}, ${s.site.lon})` : null, s.sky?.sqm != null ? `SQM ${s.sky.sqm}` : null];
  return text(50, top + 50, s.date, { size: 38, weight: "bold" }) +
    `<path d="M50 ${top + 62} q120 8 260 0" stroke="${PENCIL}" stroke-width="3" fill="none"/>` +
    text(50, top + 105, where.filter(Boolean).join("  "), { size: 26 }) +
    text(50, top + 145, [s.scope?.name, s.sky?.notes].filter(Boolean).join(". "), { size: 24 }) +
    text(50, top + 185, `With ${s.observers.join(" and ")}`, { size: 24 });
}
function freeEntry(o, top, h) {
  const rand = random(`${o.catalog_id}${o.local_time}`);
  // The sketch: a loose patch of stars and glow, no printed circle.
  const cx = W - 200, cy = top + h / 2, r = Math.min(150, h / 2 - 15);
  const glow = `<ellipse cx="${cx}" cy="${cy}" rx="${Math.round(r * 0.6)}" ry="${Math.round(r * 0.4)}" fill="url(#glow)" transform="rotate(${Math.round(rand() * 180)} ${cx} ${cy})"/>`;
  const stars = Array.from({ length: 30 }, () => {
    const a = rand() * 2 * Math.PI, d = Math.sqrt(rand()) * r;
    return `<circle cx="${(cx + d * Math.cos(a)).toFixed(1)}" cy="${(cy + d * Math.sin(a)).toFixed(1)}" r="${(1 + rand() * 3).toFixed(1)}" fill="${PENCIL}"/>`;
  }).join("");
  const scale = (name, v) => (v == null ? null : v === "N/A" ? `${name} N/A` : `${name} ${ROMAN[v - 1]}`);
  const kit = [o.eyepiece, o.magnification != null ? `${o.magnification}x` : null, o.filter == null ? null : o.filter === "N/A" ? "no filter" : o.filter];
  const lines = [
    [o.catalog_id, o.aka].filter(Boolean).join(" ") + (o.local_time ? ` at ${o.local_time}` : ""),
    [scale("Seeing", o.seeing), scale("transp.", o.transparency)].filter(Boolean).join(", "),
    kit.filter(Boolean).join(", "),
    ...wrap(o.description, 44),
  ].filter(Boolean).slice(0, 7);
  return lines.map((l, i) => text(50, top + 40 + i * 36, l, { size: i ? 23 : 28, weight: i ? "normal" : "bold" })).join("") + glow + stars;
}
const page = (body, { number, fill = PAPER } = {}) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
  `<defs><radialGradient id="glow"><stop offset="0" stop-color="${PENCIL}" stop-opacity="1"/><stop offset="1" stop-color="${PENCIL}" stop-opacity="0"/></radialGradient></defs>` +
  `<rect width="100%" height="100%" fill="${fill}"/>${body}` +
  (number % 2 ? text(W - 40, 40, number, { size: 24, color: "#222", italic: false, anchor: "end" }) : "") + "</svg>");

// Session pages: each session's NEW SESSION block on its first page, then
// its entries on their pages, top to bottom in date order.
const HEADER_H = 0.27, ENTRY_H = 0.31, GAP = 0.01;
// Free-text notebooks: a shorter heading and paragraph.
const FREE = { header: 0.14, entry: 0.22 };
function layout(nbId, sizes = { header: HEADER_H, entry: ENTRY_H }) {
  const byPage = new Map();
  const put = (n, item) => byPage.set(n, [...(byPage.get(n) ?? []), item]);
  for (const { data: s } of sessions.filter((x) => x.data.notebook === nbId)) {
    put(s.pages[0], { s });
    for (const o of s.observations) put(o.page, { s, o });
  }
  for (const items of byPage.values()) {
    let y = 0.02;
    for (const item of items) {
      const h = item.o ? sizes.entry : sizes.header;
      item.box = [0.03, +y.toFixed(3), 0.94, h];
      if (item.o) item.o.box = item.box;
      else item.s.header_box = { page: item.s.pages[0], box: item.box };
      y += h + GAP;
    }
    if (y > 1) throw new Error(`page holds too much: ${items.map((i) => i.o?.catalog_id ?? i.s.id).join(", ")}`);
  }
  return byPage;
}

function frontMatter(nb, p, i) {
  const own = sessions.filter((x) => x.data.notebook === nb.id).map((x) => x.data);
  switch (p.kind) {
    case "inside_front_cover": case "inside_back_cover":
      return page("", { fill: "#cfc6b4" });
    case "title":
      return page(text(W / 2, 420, nb.title, { size: 64, color: "#222", italic: false, anchor: "middle" }) +
        text(W / 2, 520, "Observing log", { size: 34, color: "#555", italic: false, anchor: "middle" }) +
        text(W / 2, 700, nb.owner, { size: 40, anchor: "middle" }) +
        // Made-up contact details where Kacy's are, blurred like the real title page.
        text(W / 2, 1050, "(555) 010-0199", { size: 40, anchor: "middle" }) +
        text(W / 2, 1110, "test.observer@example.com", { size: 36, anchor: "middle" }));
    case "contents": {
      const first = nb.pages.filter((x) => x.kind === "contents").indexOf(p) === 0;
      const rows = first ? own : [];
      return page(text(60, 90, "CONTENTS", { size: 30, color: STAMP, weight: "bold", italic: false }) +
        ["PROGRAM", "DATE / EVENT", "OBJ / HRS", "PG #"].map((h, k) => label([60, 330, 700, 860][k], 150, h)).join("") +
        Array.from({ length: 24 }, (_, r) => `<line x1="50" x2="${W - 50}" y1="${170 + r * 55}" y2="${170 + r * 55}" stroke="${STAMP}" stroke-width="1"/>`).join("") +
        rows.map((s, r) => text(60, 215 + r * 55, shown(s.program), { size: 22 }) + text(330, 215 + r * 55, `${s.date} ${s.site.name}`, { size: 22 }) +
          text(700, 215 + r * 55, s.observations.length, { size: 22 }) + text(860, 215 + r * 55, s.pages[0], { size: 22 })).join(""));
    }
    case "reference":
      return page(text(60, 100, "SEEING AND TRANSPARENCY", { size: 30, color: STAMP, weight: "bold", italic: false }) +
        ROMAN.map((r, k) => text(80, 200 + k * 70, r, { size: 30, color: STAMP, weight: "bold", italic: false }) +
          text(180, 200 + k * 70, ["Excellent", "Good", "Average", "Poor", "Bad"][k], { size: 26, color: "#333", italic: false }) +
          text(560, 200 + k * 70, ["Poor", "Below average", "Average", "Above average", "Transparent"][k], { size: 26, color: "#333", italic: false })).join(""));
    case "index": {
      const first = nb.pages.filter((x) => x.kind === "index").indexOf(p) === 0;
      const entries = first ? own.flatMap((s) => s.observations.map((o) => `${o.catalog_id} · p. ${o.page}`)) : [];
      return page(text(60, 90, "INDEX", { size: 30, color: STAMP, weight: "bold", italic: false }) +
        entries.map((e, r) => text(70, 160 + r * 48, e, { size: 24 })).join(""));
    }
    case "info":
      return page(text(W / 2, 1300, "Made-up notebook for the test site", { size: 28, color: "#555", italic: false, anchor: "middle" }) +
        text(W / 2, 1350, "100 numbered pages", { size: 24, color: "#555", italic: false, anchor: "middle" }));
    default:
      throw new Error(`no drawing for ${p.kind} (page ${i + 1})`);
  }
}

for (const { path: file, data: nb } of notebooks) {
  const out = join(DIR, "scans", nb.id);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await mkdir(join(DIR, "unblurred"), { recursive: true });
  const free = typeOf(nb)?.form === "free";
  const byPage = free ? layout(nb.id, FREE) : layout(nb.id);
  const draw = free ? { header: freeHeader, entry: freeEntry } : { header, entry };
  for (const [i, p] of nb.pages.entries()) {
    const name = join(out, `${pageName(i)}.jpg`);
    let svg;
    if (p.kind === "session" || p.kind === "unused" || p.kind === "blank") {
      const items = byPage.get(p.number) ?? [];
      const body = p.kind === "unused"
        ? entry({ catalog_id: "M2", aka: null, description: "Wrong object; crossed out" }, Math.round(0.03 * H), Math.round(ENTRY_H * H), true)
        : items.map((it) => (it.o ? draw.entry(it.o, Math.round(it.box[1] * H), Math.round(it.box[3] * H)) : draw.header(it.s, Math.round(it.box[1] * H), Math.round(it.box[3] * H)))).join("");
      svg = page(body, { number: p.number });
    } else svg = frontMatter(nb, p, i);
    const drawn = await sharp(svg).png().toBuffer();
    // The import test (tests/import.test.mjs) feeds the unblurred title page
    // to the import, which must blur it; kept outside scans/, so it isn't
    // published. Its contact details are made up.
    if (p.redact) await sharp(drawn).jpeg({ quality: 70, mozjpeg: true }).toFile(join(DIR, "unblurred", `${nb.id}-${pageName(i)}.jpg`));
    const image = await redact(drawn, p.redact ?? []);
    await sharp(image).jpeg({ quality: 70, mozjpeg: true }).toFile(name);
    if (nb.id === "test-001" && p.kind === "session") await sharp(image).jpeg({ quality: 70, mozjpeg: true }).toFile(name.replace(/\.jpg$/, ".clean.jpg"));
  }
  // The outside front cover, with its volume label.
  await sharp(page(`<rect x="200" y="300" width="600" height="420" fill="${PAPER}" stroke="#222" stroke-width="3"/>` +
    text(W / 2, 400, nb.title, { size: 46, color: "#222", italic: false, anchor: "middle" }) +
    text(W / 2, 480, nb.owner, { size: 32, anchor: "middle" }) +
    text(W / 2, 560, `Started ${nb.started ?? ""}`, { size: 28, anchor: "middle" }) +
    text(W / 2, 620, `Finished ${nb.finished ?? ""}`, { size: 28, anchor: "middle" }), { fill: "#26314a" }))
    .jpeg({ quality: 70, mozjpeg: true }).toFile(join(out, "cover-front.jpg"));
  console.log(`${file}: ${nb.pages.length} pages`);
}
// header_box goes before the observations, as in real session files.
for (const { path, data: { observations, ...s } } of sessions) await writeJSON(path, { ...s, observations });
for (const { path, data } of notebooks) await writeJSON(path, data);
await writeJSON(join(DIR, "objects.json"), await readJSON(join(DIR, "objects.json")));
