// Build the static site into dist/.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as images from "./lib/image.mjs";
import { category, isBack, ranks } from "./lib/categories.mjs";
import { findCircle } from "./lib/circle.mjs";
import { atomFeed } from "./lib/feed.mjs";
import { objectKeys, pageName, readJSON, readJSONDir } from "./lib/files.mjs";
import { typeOf } from "./lib/notebook-types.mjs";

const OUT = "dist";

const readAll = async (dir) => (await readJSONDir(dir)).map((f) => f.data);

await rm(OUT, { recursive: true, force: true });
await cp("site", OUT, { recursive: true });
await cp("schema", join(OUT, "schema"), { recursive: true });
// Leaflet for the Map tab, served with the site rather than from a CDN.
await cp("node_modules/leaflet/dist", join(OUT, "vendor", "leaflet"), {
  recursive: true, filter: (f) => !f.endsWith(".map") && !f.includes("leaflet-src"),
});

// The test site and PR previews (#64) also get the made-up test data
// (test-data/, page images drawn by scripts/make-test-pages.mjs), under
// dist/test-data/ with the same layout; the live site has only the real data.
const TEST_SITE = Boolean(process.env.TEST_SITE);
const withTestData = (TEST_SITE || Boolean(process.env.PREVIEW_OF)) && existsSync("test-data");

// Sketch images: each observation's entry, cut from its page, and its
// session's NEW SESSION block, so the sketch keeps its date, site and sky.
// The site shows them as two images with a gap. Cut from the redacted page
// images in scans/ only; written as sketches/<session>/header.jpg and
// <n>.jpg, each with a .clean.jpg, like the page images.
async function cut(page, box, out) {
  const write = async (file, to) => {
    const { width, height } = await images.size(file);
    const [x, y, w, h] = box;
    const left = Math.round(x * width), top = Math.round(y * height);
    const rect = { left, top, width: Math.min(Math.round(w * width), width - left), height: Math.min(Math.round(h * height), height - top) };
    await images.image(file).crop(rect).jpeg({ quality: 85 }).toFile(join(OUT, to));
    return { width: rect.width, height: rect.height };
  };
  const clean = out.replace(/\.jpg$/, ".clean.jpg");
  const size = await write(page.image, out);
  await write(page.clean ?? page.image, clean);
  return { image: out, clean, ...size };
}
// The Sketches tab's thumbnail: just the sketch circle (scripts/lib/circle.mjs
// finds it), small; the whole entry when no circle is found, or when the
// notebook has no stamped circle to find (free text, #109), where the
// writing could pass for one.
async function thumbnail(sketch, stamped) {
  const circle = stamped ? await findCircle(join(OUT, sketch.image)) : null;
  const out = {};
  for (const [key, file] of [["image", sketch.image], ["clean", sketch.clean]]) {
    out[key] = file.replace(/(\.clean)?\.jpg$/, ".thumb$1.jpg");
    const img = images.image(join(OUT, file));
    if (circle) {
      const { width, height } = sketch;
      img.crop({
        left: Math.round(circle.x * width), top: Math.round(circle.y * height),
        width: Math.round(circle.width * width), height: Math.round(circle.height * height),
      });
    }
    await img.resize({ width: 240, height: 240, fit: circle ? "fill" : "contain", background: "#ffffff" }).jpeg({ quality: 80 }).toFile(join(OUT, out[key]));
  }
  return out;
}
// A dataset: its JSON in dir (data/ or test-data/), its page images in
// <root>scans/, written to dist/<root> as data/*.json, scans/ and sketches/.
// Image paths in the JSON start with root, so they work from the site's top.
async function buildData(dir, root) {
  const scansDir = `${root}scans`;
  if (existsSync(scansDir)) await cp(scansDir, join(OUT, scansDir), { recursive: true });

  const sessions = await readAll(join(dir, "sessions"));
  sessions.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  // Catalog info (data/objects.json, from OpenNGC) goes with each observation
  // whose designation it knows, under its key in the objects file.
  const objectsFile = join(dir, "objects.json");
  const { objects } = await readJSON(objectsFile, { objects: {} });
  const objectOf = objectKeys(objects);
  for (const o of sessions.flatMap((s) => s.observations ?? [])) {
    const key = objectOf(o);
    if (key) {
      const { name, type, constellation, magnitude, size } = objects[key];
      o.catalog = { key, name, type, constellation, magnitude, size };
    }
  }

  // Give each notebook page its name, its image, and the sessions written on
  // it. Image sizes let pages reserve their space before the images load.
  const notebooks = await Promise.all((await readAll(join(dir, "notebooks"))).map(async ({ scan, ...nb }) => {
    const rank = ranks(nb.pages);
    // The outside front cover, scanned on its own.
    const cover = `${scansDir}/${nb.id}/cover-front.jpg`;
    const front = nb.front_cover && existsSync(cover) ? await images.size(cover) : null;
    // A small copy for the notebook's card on the home page.
    const thumb = cover.replace(/\.jpg$/, ".thumb.jpg");
    if (front) await images.image(cover).resize({ height: 240 }).jpeg({ quality: 80 }).toFile(join(OUT, thumb));
    return {
      ...nb,
      front_cover: front && { label: "Front cover", slot: 0, sessions: [], image: cover, thumb, width: front.width, height: front.height },
      pages: await Promise.all(nb.pages.map(async ({ redact, ...page }, i) => {
        const image = `${scansDir}/${nb.id}/${pageName(i)}.jpg`;
        const { width, height } = await images.size(image);
        // Pages that will still change aren't published until they're final. An
        // unfinished notebook also leaves out its blank pages and the categories
        // not shown in progress. Hidden categories are never shown.
        const kind = page.kind === "unused" ? "session" : page.kind;
        const hidden = Boolean(page.open && page.kind !== "session") || Boolean(category(kind)?.hidden) || (nb.status !== "completed" &&
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

  for (const s of sessions) {
    const nb = notebooks.find((n) => n.id === s.notebook);
    const pageAt = (number) => nb?.pages.find((p) => p.number === number);
    const headerPage = s.header_box && pageAt(s.header_box.page);
    if (!headerPage?.image) continue;
    await mkdir(join(OUT, `${root}sketches`, s.id), { recursive: true });
    const header = await cut(headerPage, s.header_box.box, `${root}sketches/${s.id}/header.jpg`);
    // The session card (site/cards.js) on the session page.
    s.header_sketch = header;
    for (const [i, o] of (s.observations ?? []).entries()) {
      const page = o.box && pageAt(o.page);
      if (!page?.image) continue;
      o.sketch = { ...(await cut(page, o.box, `${root}sketches/${s.id}/${i + 1}.jpg`)), header };
      o.sketch.thumb = await thumbnail(o.sketch, typeOf(nb)?.form === "stamped");
    }
  }

  await mkdir(join(OUT, root, "data"), { recursive: true });
  await writeFile(join(OUT, root, "data", "sessions.json"), JSON.stringify(sessions));
  await writeFile(join(OUT, root, "data", "notebooks.json"), JSON.stringify(notebooks));
  if (existsSync(objectsFile)) await cp(objectsFile, join(OUT, root, "data", "objects.json"));
  return { notebooks, sessions };
}

const { notebooks, sessions } = await buildData("data", "");
const test = withTestData ? await buildData("test-data", "test-data/") : null;

// The feed of new sessions (#128), from the real data only, with the live
// site's addresses. Only the live site announces it in every page's head,
// so feed readers don't pick up a preview or the test site.
await writeFile(join(OUT, "feed.xml"), atomFeed(sessions));
const live = !TEST_SITE && !process.env.PREVIEW_OF;

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
  ...(live ? [`<link rel="alternate" type="application/atom+xml" title="New sessions" href="feed.xml">`] : []),
].map((tag) => `  ${tag}\n`).join("");

// Every page's footer credits the catalog sources the objects came from
// (data/objects.json) and links Kacy's own mappings.
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const anchor = (url, text) => (url ? `<a href="${escape(url)}">${escape(text)}</a>` : escape(text));
const andList = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const { sources } = await readJSON("data/objects.json", { sources: [] });
const mappingsFile = "data/personalObjectMappings.json";
const { mappings } = await readJSON(mappingsFile, { mappings: [] });
const footerParts = [];
if (sources.length) {
  const about = (s) => [s.by, s.license].filter(Boolean).map(escape).join(", ");
  footerParts.push(`Object data from ${andList(sources.map((s) => anchor(s.url, s.name) + (about(s) ? ` (${about(s)})` : "")))}.`);
}
if (mappings.length) {
  footerParts.push(`${anchor(`https://github.com/Kacy-Luker/astronomy/blob/main/${mappingsFile}`, "Kacy's object mappings")}.`);
}
const footer = footerParts.length ? `  <footer class="site-footer muted">\n    ${footerParts.join("\n    ")}\n  </footer>\n` : "";

// A PR preview or the test site also gets a banner on every page so it
// isn't mistaken for the live site. With the test data built, data-test-data
// is the dataset shown by default, and site/lib.js adds the real/test toggle.
let banner = "";
const testData = test ? ` data-test-data="${TEST_SITE ? "test" : "real"}"` : "";
if (process.env.PREVIEW_OF) {
  const link = process.env.PREVIEW_LINK ? ` <a href="${escape(process.env.PREVIEW_LINK)}">View the pull request</a>` : "";
  const branch = process.env.PREVIEW_BRANCH ? ` data-branch="${escape(process.env.PREVIEW_BRANCH)}"` : "";
  banner = `\n  <div class="preview-banner"${branch}${testData}>Preview of ${escape(process.env.PREVIEW_OF)}.${link}</div>`;
} else if (TEST_SITE) {
  banner = `\n  <div class="preview-banner"${testData}>Test site.</div>`;
}
for (const file of (await readdir(OUT)).filter((f) => f.endsWith(".html"))) {
  const html = (await readFile(join(OUT, file), "utf8")).replace("</head>", `${icons}</head>`).replace("</body>", `${footer}</body>`);
  await writeFile(join(OUT, file), html.replace(/<body( class="[^"]*")?>/, (body) => body + banner));
}

console.log(`Built ${notebooks.length} notebooks and ${sessions.length} sessions into ${OUT}/` +
  (test ? `, and the test data's ${test.notebooks.length} and ${test.sessions.length}` : ""));
