// The site's own logic that runs without a page: to-dos, site names without
// their years, and map spots.
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogOf, compareIds } from "../../site/catalog.js";
import { isNA, sessionTodos, todoCount } from "../../site/todos.js";

// site/search.js loads site/lib.js, which looks at the page; give it an
// empty one.
globalThis.document = { querySelector: () => null };
globalThis.location = { search: "", href: "http://localhost/" };
const { eventName, spotOf } = await import("../../site/search.js");

test("a blank field is a to-do; N/A and AKA aren't", () => {
  const s = {
    program: "Messier", site: { name: "Backyard", lat: 35.5, lon: -97.5 }, sky: { sqm: "N/A" },
    scope: { name: "XT8" }, observers: ["Test Observer"],
    observations: [{ catalog_id: "M31", aka: null, local_time: "21:00", ut: null, seeing: 1, transparency: "N/A",
      eyepiece: "25mm", magnification: 48, filter: "N/A", description: "Big" }],
  };
  assert.ok(isNA(s.sky.sqm));
  assert.deepEqual(sessionTodos(s), [{ where: "M31", page: undefined, fields: ["UT"] }]);
  assert.equal(todoCount(s), 1);
});

test("site names lose their year", () => {
  for (const [name, site] of [["Okie-Tex 2026", "Okie-Tex"], ["2027 Okie-Tex", "Okie-Tex"],
    ["Texas Star Party (2026)", "Texas Star Party"], ["Star Party, 2026", "Star Party"],
    ["Okie-Tex 2026-2027", "Okie-Tex"], ["ACT Observatory", "ACT Observatory"], ["Site 1234", "Site 1234"], ["2026", "2026"]]) {
    assert.equal(eventName(name), site, name);
  }
});

test("map spots round to 0.1°, and need both coordinates", () => {
  assert.equal(spotOf({ site: { lat: 36.898, lon: -102.952 } }), "36.9,-103");
  assert.equal(spotOf({ site: { lat: 36.94, lon: -102.98 } }), "36.9,-103");
  assert.equal(spotOf({ site: { name: "Library" } }), null);
  assert.equal(spotOf({ site: { lat: "N/A", lon: "N/A" } }), null);
});

test("designations sort by catalog, then number", () => {
  const ids = ["Sh2-155", "NGC 224", "M13", "Albireo", "M2", "Sh2-27", "C14", "IC 434"];
  assert.deepEqual(ids.sort(compareIds), ["M2", "M13", "NGC 224", "IC 434", "C14", "Sh2-27", "Sh2-155", "Albireo"]);
  assert.equal(catalogOf("Sh2-155"), "Other");
  assert.equal(catalogOf("NGC 224"), "NGC");
});
