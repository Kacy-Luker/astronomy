// Build the static site into dist/.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { category, isBack, ranks } from "./lib/categories.mjs";
import { findCircle } from "./lib/circle.mjs";

const OUT = "dist";

async function readAll(dir) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8"))));
}

await rm(OUT, { recursive: true, force: true });
await cp("site", OUT, { recursive: true });
await cp("schema", join(OUT, "schema"), { recursive: true });
if (existsSync("scans")) await cp("scans", join(OUT, "scans"), { recursive: true });

const sessions = await readAll("data/sessions");
sessions.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

// Catalog info (data/objects.json, from OpenNGC) goes with each observation
// whose designation it knows, under its key in the objects file.
const objects = existsSync("data/objects.json") ? JSON.parse(await readFile("data/objects.json", "utf8")).objects : {};
const objectOf = new Map(Object.entries(objects).flatMap(([key, o]) => o.ids.map((id) => [id, key])));
for (const o of sessions.flatMap((s) => s.observations ?? [])) {
  const key = [o.catalog_id, ...(o.ids ?? [])].map((id) => objectOf.get(id)).find(Boolean);
  if (key) {
    const { name, type, constellation, magnitude, size } = objects[key];
    o.catalog = { key, name, type, constellation, magnitude, size };
  }
}

// Give each notebook page its name, its image, and the sessions written on
// it. Image sizes let pages reserve their space before the images load.
const notebooks = await Promise.all((await readAll("data/notebooks")).map(async ({ scan, ...nb }) => {
  const rank = ranks(nb.pages);
  // The outside front cover, scanned on its own.
  const cover = `scans/${nb.id}/cover-front.jpg`;
  const front = nb.front_cover && existsSync(cover) ? await sharp(cover).metadata() : null;
  return {
    ...nb,
    front_cover: front && { label: "Front cover", slot: 0, sessions: [], image: cover, width: front.width, height: front.height },
    pages: await Promise.all(nb.pages.map(async ({ redact, ...page }, i) => {
      const image = `scans/${nb.id}/${String(i + 1).padStart(2, "0")}.jpg`;
      const { width, height } = await sharp(image).metadata();
      // Pages that will still change aren't published until they're final. An
      // unfinished notebook also leaves out its blank pages and the categories
      // not shown in progress.
      const kind = page.kind === "unused" ? "session" : page.kind;
      const hidden = Boolean(page.open && page.kind !== "session") || (nb.status !== "completed" &&
        (page.kind === "blank" || !category(kind)?.in_progress));
      // The show-through-cleaned copy, when scripts/showthrough.py made one.
      const clean = image.replace(/\.jpg$/, ".clean.jpg");
      if (hidden) await rm(join(OUT, image));
      if (hidden) await rm(join(OUT, clean), { force: true });
      return {
        ...page,
        label: page.label ?? category(page.kind)?.label ?? null,
        // Back matter (index, info page, ...) is paired from the end of the book.
        back: isBack(rank[i]),
        slot: i + 1,
        image: hidden ? null : image,
        clean: !hidden && existsSync(clean) ? clean : null,
        hidden,
        width,
        height,
        sessions: sessions
          .filter((s) => s.notebook === nb.id && page.number != null && s.pages?.includes(page.number))
          .map((s) => s.id),
      };
    })),
  };
}));
notebooks.sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""));

// Sketch images: each observation's entry, cut from its page, and its
// session's NEW SESSION block, so the sketch keeps its date, site and sky.
// The site shows them as two images with a gap. Cut from the redacted page
// images in scans/ only; written as sketches/<session>/header.jpg and
// <n>.jpg, each with a .clean.jpg, like the page images.
async function cut(page, box, out) {
  const write = async (file, to) => {
    const { width, height } = await sharp(file).metadata();
    const [x, y, w, h] = box;
    const left = Math.round(x * width), top = Math.round(y * height);
    const rect = { left, top, width: Math.min(Math.round(w * width), width - left), height: Math.min(Math.round(h * height), height - top) };
    await sharp(file).extract(rect).jpeg({ quality: 85 }).toFile(join(OUT, to));
    return { width: rect.width, height: rect.height };
  };
  const clean = out.replace(/\.jpg$/, ".clean.jpg");
  const size = await write(page.image, out);
  await write(page.clean ?? page.image, clean);
  return { image: out, clean, ...size };
}
// The Sketches tab's thumbnail: just the sketch circle (scripts/lib/circle.mjs
// finds it), small; the whole entry when no circle is found.
async function thumbnail(sketch) {
  const circle = await findCircle(join(OUT, sketch.image));
  const out = {};
  for (const [key, file] of [["image", sketch.image], ["clean", sketch.clean]]) {
    out[key] = file.replace(/(\.clean)?\.jpg$/, ".thumb$1.jpg");
    let img = sharp(join(OUT, file));
    if (circle) {
      const { width, height } = sketch;
      img = img.extract({
        left: Math.round(circle.x * width), top: Math.round(circle.y * height),
        width: Math.round(circle.width * width), height: Math.round(circle.height * height),
      });
    }
    await img.resize(240, 240, { fit: circle ? "fill" : "contain", background: "#ffffff" }).jpeg({ quality: 80 }).toFile(join(OUT, out[key]));
  }
  return out;
}
for (const s of sessions) {
  const nb = notebooks.find((n) => n.id === s.notebook);
  const pageAt = (number) => nb?.pages.find((p) => p.number === number);
  const headerPage = s.header_box && pageAt(s.header_box.page);
  if (!headerPage?.image) continue;
  await mkdir(join(OUT, "sketches", s.id), { recursive: true });
  const header = await cut(headerPage, s.header_box.box, `sketches/${s.id}/header.jpg`);
  for (const [i, o] of (s.observations ?? []).entries()) {
    const page = o.box && pageAt(o.page);
    if (!page?.image) continue;
    o.sketch = { ...(await cut(page, o.box, `sketches/${s.id}/${i + 1}.jpg`)), header };
    o.sketch.thumb = await thumbnail(o.sketch);
  }
}

await mkdir(join(OUT, "data"), { recursive: true });
await writeFile(join(OUT, "data", "sessions.json"), JSON.stringify(sessions));
await writeFile(join(OUT, "data", "notebooks.json"), JSON.stringify(notebooks));
if (existsSync("data/objects.json")) await cp("data/objects.json", join(OUT, "data", "objects.json"));

// Every page gets the site's icons (site/icons/: Kacy's telescope photos,
// a wide crop for tab sizes and a close-up for larger ones), so a new page
// can't miss them. Without these, browsers show kacyluker.com's favicon.
const icons = [
  `<link rel="icon" href="icons/icon-16.png" sizes="16x16" type="image/png">`,
  `<link rel="icon" href="icons/icon-32.png" sizes="32x32" type="image/png">`,
  `<link rel="icon" href="icons/icon-192.png" sizes="192x192" type="image/png">`,
  `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">`,
  // Chrome on Android takes home-screen icons from the manifest.
  `<link rel="manifest" href="manifest.webmanifest">`,
].map((tag) => `  ${tag}\n`).join("");

// Every page's footer credits the catalog sources the objects came from
// (data/objects.json) and links Kacy's own mappings, with the lists they
// follow.
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const anchor = (url, text) => (url ? `<a href="${escape(url)}">${escape(text)}</a>` : escape(text));
const andList = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const sources = existsSync("data/objects.json") ? JSON.parse(await readFile("data/objects.json", "utf8")).sources : [];
const mappingsFile = "data/personalObjectMappings.json";
const mappings = existsSync(mappingsFile) ? JSON.parse(await readFile(mappingsFile, "utf8")).mappings : [];
const credits = [...new Map(mappings.filter((m) => m.credit).map((m) => [m.credit.name, m.credit])).values()];
const footerParts = [];
if (sources.length) {
  footerParts.push(`Object data from ${andList(sources.map((s) => anchor(s.url, s.name) + (s.license ? ` (${escape(s.license)})` : "")))}.`);
}
if (mappings.length) {
  footerParts.push(`${anchor(`https://github.com/Kacy-Luker/astronomy/blob/main/${mappingsFile}`, "Kacy's object mappings")}` +
    (credits.length ? `, following the ${andList(credits.map((c) => anchor(c.url, c.name)))}` : "") + ".");
}
const footer = footerParts.length ? `  <footer class="site-footer muted">\n    ${footerParts.join("\n    ")}\n  </footer>\n` : "";

// A PR preview build also gets a banner on every page so it isn't mistaken
// for the live site.
let banner = "";
if (process.env.PREVIEW_OF) {
  const link = process.env.PREVIEW_LINK ? ` <a href="${escape(process.env.PREVIEW_LINK)}">View the pull request</a>` : "";
  banner = `\n  <div class="preview-banner">Preview of ${escape(process.env.PREVIEW_OF)}.${link}</div>`;
}
for (const file of (await readdir(OUT)).filter((f) => f.endsWith(".html"))) {
  const html = (await readFile(join(OUT, file), "utf8")).replace("</head>", `${icons}</head>`).replace("</body>", `${footer}</body>`);
  await writeFile(join(OUT, file), html.replace(/<body( class="[^"]*")?>/, (body) => body + banner));
}

console.log(`Built ${notebooks.length} notebooks and ${sessions.length} sessions into ${OUT}/`);
