// Backfill catalog info: add every known designation to each observation's
// ids and write data/objects.json with the observed objects' reference data
// (scripts/lib/catalog.mjs). Safe to re-run; it only adds.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { enrichSessions, loadCatalog, objectsFile } from "./lib/catalog.mjs";
import { formatJSON } from "./lib/format-json.mjs";

const dir = join("data", "sessions");
const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
const sessions = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8"))));
const { objects, changed } = enrichSessions(sessions, await loadCatalog());
for (const s of sessions.filter((s) => changed.has(s.id))) {
  await writeFile(join(dir, `${s.id}.json`), formatJSON(s) + "\n");
}
await writeFile(join("data", "objects.json"), formatJSON(objectsFile(objects)) + "\n");
console.log(`${Object.keys(objects).length} objects; ${changed.size} sessions updated`);
