// Catalog lookups for observed objects, from catalog sources. A source is a
// module in scripts/lib/catalogs/ exporting
//
//   { name, by?, version, url, license, load() }
//
// where load() returns an async lookup(designation) -> entry or null, and
// an entry is { ids, name, names?, type, constellation, magnitude, size,
// ra, dec }. ids hold the catalogs observers use: Messier, NGC, IC and
// Caldwell, Messier first. Other numbers a source knows (UGC, PGC, ...)
// only help find an object. This is the whole contract, so a source can be
// swapped for another that does the same.
//
// Sources are tried in order; the first that knows a designation wins, and
// its name is kept on the entry for the credits.
//
// Kacy's own mappings (data/personalObjectMappings.json) come first: an
// object mapped from one designation to another is looked up as the other,
// so its info and other designations come from there, and the mapped
// designation is added to its ids (M102 is NGC 5866, the Spindle Galaxy).
import { existsSync, readFileSync } from "node:fs";
import { compareIds } from "../../site/catalog.js";
import { designation, keyOf } from "./catalogs/common.mjs";
import { openngc } from "./catalogs/openngc.mjs";
import { simbad } from "./catalogs/simbad.mjs";

export { normalize } from "./catalogs/common.mjs";

// OpenNGC first; SIMBAD (over the network) only for what it doesn't know.
export const SOURCES = [openngc, simbad];
export const MAPPINGS_FILE = "data/personalObjectMappings.json";

// Kacy's mappings as { from, to } designations, with the rest of each entry.
export function loadMappings(file = MAPPINGS_FILE) {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")).mappings
    .map((m) => ({ ...m, from: designation(m.from), to: designation(m.to) }));
}

// Loads the sources; returns an async lookup(designation) -> entry or null.
export async function loadCatalog(sources = SOURCES, mappings = loadMappings()) {
  const lookups = await Promise.all(sources.map(async (source) => [source, await source.load()]));
  async function lookup(id) {
    for (const [source, find] of lookups) {
      const found = await find(id);
      if (found) return { ...found, source: source.name };
    }
    return null;
  }
  // Where each mapped designation goes, and the designations each target
  // object gains, by its first id, however it's looked up.
  const target = new Map();
  const gains = new Map();
  for (const m of mappings) {
    target.set(m.from, m.to);
    const found = await lookup(m.to);
    if (found) gains.set(found.ids[0], [...(gains.get(found.ids[0]) ?? []), m.from]);
  }
  return async (id) => {
    const found = await lookup(target.get(keyOf(id)) ?? id);
    const more = found && gains.get(found.ids[0]);
    return more ? { ...found, ids: [...new Set([...found.ids, ...more])].sort(compareIds) } : found;
  };
}

// Adds every known designation to each observation's ids (keeping what's
// there, written ones first) and collects the reference data for every
// observed object. aka is left as written. Returns the objects, keyed by
// each object's first designation in catalog order, and the ids of the
// sessions that changed.
export async function enrichSessions(sessions, lookup) {
  const objects = {};
  const changed = new Set();
  for (const s of sessions) {
    for (const o of s.observations ?? []) {
      const found = await lookup(o.catalog_id);
      if (!found) continue;
      const before = o.ids ?? [o.catalog_id];
      const ids = [...new Set([...before, ...found.ids])];
      if (ids.length !== before.length || !o.ids) { o.ids = ids; changed.add(s.id); }
      objects[found.ids[0]] = found;
    }
  }
  const sorted = Object.fromEntries(Object.keys(objects).sort(compareIds).map((k) => [k, objects[k]]));
  return { objects: sorted, changed };
}

// The data/objects.json document: the objects plus the sources they came
// from, credited on the site.
export function objectsFile(objects, sources = SOURCES) {
  const used = sources.filter((s) => Object.values(objects).some((o) => o.source === s.name));
  return {
    sources: used.map(({ name, by, version, url, license }) => ({ name, ...(by ? { by } : {}), version, url, license })),
    objects,
  };
}
