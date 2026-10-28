// The Activity tab's counts (site/activity.js, #128).
import assert from "node:assert/strict";
import { test } from "node:test";

// site/activity.js loads site/lib.js, which looks at the page; give it an
// empty one.
globalThis.document = { querySelector: () => null };
globalThis.location = { search: "", href: "http://localhost/" };
const { activityStats } = await import("../../site/activity.js");

const s1 = { id: "a", date: "2026-01-10", scope: { name: "XT8" } };
const s2 = { id: "b", date: "2026-03-02", scope: { name: "xt 8" } };
const s3 = { id: "c", date: "2026-03-20", scope: { name: "Explore 102" } };
const galaxy = (key) => ({ key, type: "Galaxy" });
const docs = [
  { s: s1, o: { catalog_id: "M31", catalog: galaxy("M31"), seeing: 1, transparency: 5, eyepiece: "13mm Ethos" } },
  { s: s1, o: { catalog_id: "Saturn", seeing: 2, transparency: "N/A", eyepiece: "13 mm ethos" } },
  { s: s2, o: { catalog_id: "NGC 224", catalog: galaxy("M31"), seeing: null, transparency: 4, eyepiece: "N/A" } },
  { s: s3, o: { catalog_id: "M57", catalog: { key: "M57", type: "Planetary nebula" }, seeing: 1, transparency: 4, eyepiece: "9mm Nagler" } },
];

test("totals count sessions, observations and objects (M31 and NGC 224 are one)", () => {
  const stats = activityStats(docs);
  assert.deepEqual([stats.sessions, stats.observations, stats.objects], [3, 4, 3]);
});

test("months run from the first to the last, quiet ones at zero", () => {
  assert.deepEqual(activityStats(docs).months, [
    { month: "2026-01", count: 2, sessions: 1 },
    { month: "2026-02", count: 0, sessions: 0 },
    { month: "2026-03", count: 2, sessions: 2 },
  ]);
  const year = activityStats([{ s: { id: "x", date: "2025-12-31" }, o: {} }, { s: { id: "y", date: "2026-01-01" }, o: {} }]);
  assert.deepEqual(year.months.map((m) => m.month), ["2025-12", "2026-01"]);
  assert.deepEqual(activityStats([]).months, []);
});

test("objects by type count each object once, uncatalogued ones last", () => {
  assert.deepEqual(activityStats(docs).types, [
    { name: "Galaxy", count: 1 }, { name: "Planetary nebula", count: 1 }, { name: "Not in the catalogs", count: 1 },
  ]);
});

test("seeing and transparency are spread over I to V, the rest not rated", () => {
  const { seeing, transparency } = activityStats(docs);
  assert.deepEqual(seeing.steps.map((s) => s.count), [2, 1, 0, 0, 0]);
  assert.equal(seeing.steps[0].label, "I · Excellent");
  assert.equal(seeing.unrated, 1);
  assert.deepEqual(transparency.steps.map((s) => s.count), [0, 0, 0, 2, 1]);
  assert.equal(transparency.steps[4].label, "V · Transparent");
  assert.equal(transparency.unrated, 1);
});

test("telescopes and eyepieces merge spellings, most used first; N/A isn't an eyepiece", () => {
  const { scopes, eyepieces } = activityStats(docs);
  assert.deepEqual(scopes.map((s) => [s.name, s.count]), [["XT8", 3], ["Explore 102", 1]]);
  assert.deepEqual(eyepieces.map((e) => [e.name, e.count]), [["13mm Ethos", 2], ["9mm Nagler", 1]]);
});
