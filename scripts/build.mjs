// Build the static site into dist/.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { category, isBack, ranks } from "./lib/categories.mjs";

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

await mkdir(join(OUT, "data"), { recursive: true });
await writeFile(join(OUT, "data", "sessions.json"), JSON.stringify(sessions));
await writeFile(join(OUT, "data", "notebooks.json"), JSON.stringify(notebooks));

// Every page gets the site's icons (site/icons/: Kacy's telescope photos,
// a wide crop for tab sizes and a close-up for larger ones), so a new page
// can't miss them. Without these, browsers show kacyluker.com's favicon.
const icons = [
  `<link rel="icon" href="icons/icon-16.png" sizes="16x16" type="image/png">`,
  `<link rel="icon" href="icons/icon-32.png" sizes="32x32" type="image/png">`,
  `<link rel="icon" href="icons/icon-192.png" sizes="192x192" type="image/png">`,
  `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">`,
  // Chrome on Android takes bookmark and home-screen icons from the manifest.
  `<link rel="manifest" href="manifest.webmanifest">`,
].map((tag) => `  ${tag}\n`).join("");

// A PR preview build also gets a banner on every page so it isn't mistaken
// for the live site.
let banner = "";
if (process.env.PREVIEW_OF) {
  const escape = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const link = process.env.PREVIEW_LINK ? ` <a href="${escape(process.env.PREVIEW_LINK)}">View the pull request</a>` : "";
  banner = `\n  <div class="preview-banner">Preview of ${escape(process.env.PREVIEW_OF)}.${link}</div>`;
}
for (const file of (await readdir(OUT)).filter((f) => f.endsWith(".html"))) {
  const html = (await readFile(join(OUT, file), "utf8")).replace("</head>", `${icons}</head>`);
  await writeFile(join(OUT, file), html.replace(/<body( class="[^"]*")?>/, (body) => body + banner));
}

console.log(`Built ${notebooks.length} notebooks and ${sessions.length} sessions into ${OUT}/`);
