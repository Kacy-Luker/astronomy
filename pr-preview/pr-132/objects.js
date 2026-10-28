// Observed objects, shared by the home page's Sketches tab and the object
// page: every observation grouped by catalog object, so M31 and NGC 224
// are one. Objects the catalog doesn't know group by the designation as
// written.
import { objectName } from "./lib.js";

// [{ key, ids, name, seen: [{ o, s }] }], observations newest first.
export function observedObjects(sessions, catalog) {
  const byKey = new Map();
  for (const s of sessions) {
    for (const o of s.observations) {
      const key = o.catalog?.key ?? o.catalog_id;
      if (!byKey.has(key)) byKey.set(key, { key, ids: [...(catalog[key]?.ids ?? [])], seen: [] });
      const obj = byKey.get(key);
      // Designations written or added by hand count too (M51's NGC 5195).
      for (const id of o.ids ?? [o.catalog_id]) if (!obj.ids.includes(id)) obj.ids.push(id);
      obj.seen.push({ o, s });
    }
  }
  for (const obj of byKey.values()) {
    obj.seen.sort((a, b) => b.s.date.localeCompare(a.s.date));
    obj.name = obj.seen.map(({ o }) => objectName(o)).find(Boolean) ?? null;
  }
  return [...byKey.values()];
}

// The object with this designation (any of its ids), ignoring case and
// spacing, so object.html?id=ngc224 works.
export function findObject(objects, id) {
  const squash = (x) => String(x).toUpperCase().replace(/\s+/g, "");
  const want = squash(id);
  return objects.find((obj) => obj.key === id) ?? objects.find((obj) => obj.ids.some((x) => squash(x) === want));
}

// Whether a name is just the designation again (an object known by its
// name, like Albireo), so it isn't shown twice.
export const sameName = (name, id) => String(name).trim().toLowerCase() === String(id ?? "").trim().toLowerCase();
