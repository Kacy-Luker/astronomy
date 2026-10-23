// Build the static site into dist/.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "dist";
const SESSIONS = "data/sessions";

await rm(OUT, { recursive: true, force: true });
await cp("site", OUT, { recursive: true });
await cp("schema", join(OUT, "schema"), { recursive: true });
if (existsSync("scans")) await cp("scans", join(OUT, "scans"), { recursive: true });

const sessions = [];
for (const file of (await readdir(SESSIONS)).sort()) {
  if (!file.endsWith(".json")) continue;
  sessions.push(JSON.parse(await readFile(join(SESSIONS, file), "utf8")));
}
sessions.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

await mkdir(join(OUT, "data"), { recursive: true });
await writeFile(join(OUT, "data", "sessions.json"), JSON.stringify(sessions));

console.log(`Built ${sessions.length} sessions into ${OUT}/`);
