// Catalog designations and lookups (scripts/lib/catalog.mjs), with stand-in
// sources so nothing is fetched.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCatalog, normalize } from "../../scripts/lib/catalog.mjs";
import { designation } from "../../scripts/lib/catalogs/common.mjs";

test("normalize writes designations the notebook's way", () => {
  assert.equal(normalize("m 31"), "M31");
  assert.equal(normalize("Messier31"), "M31");
  assert.equal(normalize("NGC0224"), "NGC 224");
  assert.equal(normalize("ngc 224"), "NGC 224");
  assert.equal(normalize("Saturn"), null);
  // A catalog whose name ends in a digit keeps it (#92).
  assert.equal(normalize("Sh2-155"), "Sh2-155");
  assert.equal(normalize("SH 2-155"), "Sh2-155");
  assert.equal(normalize("sh2 155"), "Sh2-155");
});

test("designation reads a mapping's catalog and object", () => {
  assert.equal(designation({ catalog: "Messier", object: "102" }), "M102");
  assert.equal(designation({ catalog: "NGC", object: "5866" }), "NGC 5866");
  assert.equal(designation({ catalog: "Sh2", object: "155" }), "Sh2-155");
});

// Two sources: the first knows NGC 5866, the second only M1.
const entry = (ids, name) => ({ ids, name, type: "Galaxy" });
const source = (name, known) => ({ name, load: async () => async (id) => known[normalize(id)] ?? null });
const sources = [
  source("first", { "NGC 5866": entry(["NGC 5866"], "Spindle Galaxy"), M101: entry(["M101", "NGC 5457"], "Pinwheel Galaxy") }),
  source("second", { M1: entry(["M1", "NGC 1952"], "Crab Nebula") }),
];

test("lookups try each source in order and record which answered", async () => {
  const lookup = await loadCatalog(sources, []);
  assert.equal((await lookup("NGC 5866")).source, "first");
  assert.equal((await lookup("M1")).source, "second");
  assert.equal(await lookup("Saturn"), null);
});

test("a mapped designation is looked up as its target, which gains it", async () => {
  const lookup = await loadCatalog(sources, [{ from: "M102", to: "NGC 5866" }]);
  const m102 = await lookup("M102");
  assert.equal(m102.name, "Spindle Galaxy");
  assert.deepEqual(m102.ids, ["M102", "NGC 5866"]);
  // The target gains it however it's looked up.
  assert.deepEqual((await lookup("NGC 5866")).ids, ["M102", "NGC 5866"]);
  // Other objects are unchanged.
  assert.deepEqual((await lookup("M101")).ids, ["M101", "NGC 5457"]);
});
