// Build the static site into dist/.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

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

// Give each notebook page its image and the sessions written on it.
// Image sizes let pages reserve their space before the images load.
const notebooks = await Promise.all((await readAll("data/notebooks")).map(async ({ scan, ...nb }) => ({
  ...nb,
  pages: await Promise.all(nb.pages.map(async ({ redact, ...page }, i) => {
    const image = `scans/${nb.id}/${String(i + 1).padStart(2, "0")}.jpg`;
    const { width, height } = await sharp(image).metadata();
    // Pages that will still change aren't published until they're final.
    const hidden = Boolean(page.open && page.kind !== "session");
    if (hidden) await rm(join(OUT, image));
    return {
      ...page,
      slot: i + 1,
      image: hidden ? null : image,
      hidden,
      width,
      height,
      sessions: sessions
        .filter((s) => s.notebook === nb.id && page.number != null && s.pages?.includes(page.number))
        .map((s) => s.id),
    };
  })),
})));
notebooks.sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""));

await mkdir(join(OUT, "data"), { recursive: true });
await writeFile(join(OUT, "data", "sessions.json"), JSON.stringify(sessions));
await writeFile(join(OUT, "data", "notebooks.json"), JSON.stringify(notebooks));

console.log(`Built ${notebooks.length} notebooks and ${sessions.length} sessions into ${OUT}/`);
