// Build the static site into dist/.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { assignSections } from "./lib/sections.mjs";

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

// Give each notebook page its section, its image, and the sessions written
// on it. Image sizes let pages reserve their space before the images load.
const notebooks = await Promise.all((await readAll("data/notebooks")).map(async ({ scan, ...nb }) => {
  const { owner } = assignSections(nb.sections, nb.pages);
  const cover = `scans/${nb.id}/cover-front.jpg`;
  return {
    ...nb,
    // The outside front cover, scanned on its own.
    front_cover: nb.front_cover && existsSync(cover)
      ? { label: "Front cover", slot: 0, sessions: [], image: cover, ...await sharp(cover).metadata().then(({ width, height }) => ({ width, height })) }
      : null,
    pages: await Promise.all(nb.pages.map(async ({ redact, ...page }, i) => {
      const image = `scans/${nb.id}/${String(i + 1).padStart(2, "0")}.jpg`;
      const { width, height } = await sharp(image).metadata();
      // Pages that will still change aren't published until they're final. An
      // unfinished notebook also leaves out its blank pages and the sections
      // marked hidden_until_complete.
      const hidden = Boolean(page.open && page.kind !== "session") || (nb.status !== "completed" &&
        (page.kind === "blank" || Boolean(nb.sections[owner[i]]?.hidden_until_complete)));
      // The show-through-cleaned copy, when scripts/showthrough.py made one.
      const clean = image.replace(/\.jpg$/, ".clean.jpg");
      if (hidden) await rm(join(OUT, image));
      if (hidden) await rm(join(OUT, clean), { force: true });
      return {
        ...page,
        section: owner[i],
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

// A PR preview build gets a banner on every page so it isn't mistaken for the live site.
if (process.env.PREVIEW_OF) {
  const escape = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const link = process.env.PREVIEW_LINK ? ` <a href="${escape(process.env.PREVIEW_LINK)}">View the pull request</a>` : "";
  const banner = `<div class="preview-banner">Preview of ${escape(process.env.PREVIEW_OF)}.${link}</div>`;
  for (const file of (await readdir(OUT)).filter((f) => f.endsWith(".html"))) {
    const html = await readFile(join(OUT, file), "utf8");
    await writeFile(join(OUT, file), html.replace("<body>", `<body>\n  ${banner}`).replace(/<body class="([^"]*)">/, `<body class="$1">\n  ${banner}`));
  }
}

console.log(`Built ${notebooks.length} notebooks and ${sessions.length} sessions into ${OUT}/`);
