// Observing program progress (site/programs.js, #125).
import assert from "node:assert/strict";
import { test } from "node:test";

// site/programs.js loads site/lib.js, which looks at the page; give it an
// empty one.
globalThis.document = { querySelector: () => null };
globalThis.location = { search: "", href: "http://localhost/" };
const { observedIds, programProgress } = await import("../../site/programs.js");

// Catalog info as the build attaches it, and data/objects.json's objects:
// M102 is in NGC 5866's ids through Kacy's mapping.
const catalog = {
  M31: { ids: ["M31", "NGC 224"], name: "Andromeda Galaxy" },
  "NGC 5866": { ids: ["NGC 5866", "M102"], name: "Spindle Galaxy" },
  C14: { ids: ["C14", "NGC 869", "NGC 884"], name: "Double Cluster" },
};
const docs = [
  { o: { catalog_id: "NGC 224", catalog: { key: "M31", name: "Andromeda Galaxy" } } },
  { o: { catalog_id: "M31", catalog: { key: "M31", name: "Andromeda Galaxy" } } },
  { o: { catalog_id: "NGC 5866", catalog: { key: "NGC 5866", name: "Spindle Galaxy" } } },
  { o: { catalog_id: "NGC 884", catalog: { key: "C14", name: "Double Cluster" } } },
  { o: { catalog_id: "NGC 6826", aka: "Blinking Planetary", ids: ["NGC 6826", "C15"] } },
  { o: { catalog_id: "Saturn" } },
];

test("an object counts under every designation it has", () => {
  const ids = observedIds(docs, catalog);
  for (const id of ["M31", "NGC 224", "M102", "C14", "C15", "Saturn"]) assert.ok(ids.has(id), id);
  assert.equal(ids.get("C15").name, "Blinking Planetary");
});

test("Messier and Caldwell count what's been observed, NGC 224 as M31 and NGC 5866 as M102", () => {
  const [messier, caldwell] = programProgress(docs, catalog);
  assert.deepEqual([messier.name, messier.size, messier.done], ["Messier", 110, 2]);
  assert.deepEqual(messier.items.filter((x) => x.observed).map((x) => x.id), ["M31", "M102"]);
  assert.equal(messier.items.length, 110);
  assert.equal(messier.items.at(-1).id, "M110");
  assert.deepEqual([caldwell.name, caldwell.size, caldwell.done], ["Caldwell", 109, 2]);
  assert.deepEqual(caldwell.items.filter((x) => x.observed).map((x) => [x.id, x.name]), [["C14", "Double Cluster"], ["C15", "Blinking Planetary"]]);
  assert.equal(caldwell.items.at(-1).id, "C109");
});

test("nothing observed is nothing done", () => {
  assert.deepEqual(programProgress([], catalog).map((p) => p.done), [0, 0]);
});
