// Backfill catalog info: add every known designation to each observation's
// ids and write data/objects.json with the observed objects' reference data
// (scripts/lib/catalog.mjs). Safe to re-run; it only adds.
import { join } from "node:path";
import { enrichSessions, loadCatalog, objectsFile } from "./lib/catalog.mjs";
import { readJSONDir, writeJSON } from "./lib/files.mjs";

const dir = join("data", "sessions");
const sessions = (await readJSONDir(dir)).map((f) => f.data);
const { objects, changed } = await enrichSessions(sessions, await loadCatalog());
for (const s of sessions.filter((s) => changed.has(s.id))) {
  await writeJSON(join(dir, `${s.id}.json`), s);
}
await writeJSON(join("data", "objects.json"), objectsFile(objects));
console.log(`${Object.keys(objects).length} objects; ${changed.size} sessions updated`);
