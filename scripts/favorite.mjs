// Set or clear Kacy's favorite observation of an object.
//
//   node scripts/favorite.mjs <session-id> <observation number> [--off] [--summary out.md]
//
// The observation number counts from 1 in the session's file. An object has
// at most one favorite: setting one clears the object's others, in any
// session (objects are matched through data/objects.json, so M31 and
// NGC 224 are one). Run by .github/workflows/favorite.yml from the issue
// the site's star opens.
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatJSON } from "./lib/format-json.mjs";

const { positionals: [id, number], values: opts } = parseArgs({
  allowPositionals: true,
  options: { off: { type: "boolean" }, summary: { type: "string" } },
});
if (!/^[a-z0-9-]+$/.test(id ?? "") || !/^\d+$/.test(number ?? "")) {
  console.error("usage: node scripts/favorite.mjs <session-id> <observation number> [--off] [--summary out.md]");
  process.exit(2);
}

const dir = join("data", "sessions");
const sessions = await Promise.all((await readdir(dir)).filter((f) => f.endsWith(".json"))
  .map(async (f) => ({ path: join(dir, f), data: JSON.parse(await readFile(join(dir, f), "utf8")) })));
const session = sessions.find((s) => s.data.id === id);
if (!session) throw new Error(`there is no session ${id}`);
const chosen = session.data.observations[Number(number) - 1];
if (!chosen) throw new Error(`session ${id} has no observation ${number}`);

// The object an observation is of: its key in data/objects.json, else the
// designation as written.
const objects = existsSync("data/objects.json") ? JSON.parse(await readFile("data/objects.json", "utf8")).objects : {};
const keyOf = new Map(Object.entries(objects).flatMap(([key, o]) => o.ids.map((x) => [x, key])));
const objectOf = (o) => [o.catalog_id, ...(o.ids ?? [])].map((x) => keyOf.get(x)).find(Boolean) ?? o.catalog_id;
const object = objectOf(chosen);

const changed = new Set();
const cleared = [];
for (const s of sessions) {
  for (const o of s.data.observations) {
    if (o === chosen || !o.favorite || objectOf(o) !== object) continue;
    delete o.favorite;
    cleared.push(`${o.catalog_id} on ${s.data.date}`);
    changed.add(s);
  }
}
if (opts.off) delete chosen.favorite;
else chosen.favorite = true;
changed.add(session);
for (const s of changed) await writeFile(s.path, formatJSON(s.data) + "\n");

const lines = [
  opts.off
    ? `No longer a favorite: **${chosen.catalog_id}** on ${session.data.date} (\`${id}\`, observation ${number}).`
    : `Favorite: **${chosen.catalog_id}** on ${session.data.date} (\`${id}\`, observation ${number}).`,
  ...(cleared.length ? ["", `It replaces the earlier favorite of ${object}: ${cleared.join(", ")}.`] : []),
];
const summary = lines.join("\n") + "\n";
if (opts.summary) await writeFile(opts.summary, summary);
console.log(summary);
