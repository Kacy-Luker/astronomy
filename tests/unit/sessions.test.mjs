// Sessions from an upload's pages (scripts/lib/import/sessions.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { recordSessions } from "../../scripts/lib/import/sessions.mjs";

const box = (y, height = 0.3) => ({ x: 0.03, y, width: 0.94, height });
const header = (date, site, y = 0.02) => ({
  program: "Messier", date, site, lat: 36.9, lon: -103, sqm: null, sky_notes: null,
  scope: { name: "XT8", type: null, aperture_mm: null, focal_length_mm: null, f_ratio: null },
  observers: ["Test Observer"], box: box(y, 0.27),
});
const entry = (catalog_id, y) => ({
  catalog_id, aka: null, local_time: "21:00", ut: null, seeing: 2, transparency: 4,
  eyepiece: "25mm", magnification: 48, filter: "N/A", description: "Seen", box: box(y),
});
const page = (number, { head = null, entries = [], uncertain = [], corrections = [] } = {}) =>
  ({ name: `page ${number}`, number, reading: { kind: "session", header: head, entries, uncertain, corrections } });
const run = (pages, { sessions = new Map(), mode = "new" } = {}) =>
  ({ sessions, ...recordSessions({ sessions, notebook: "nb", pages, mode }) });
const summary = (sessions) => Object.fromEntries([...sessions.values()].map((s) =>
  [s.id, { pages: s.pages, entries: s.observations.map((o) => `${o.catalog_id}@${o.page}`) }]));

test("a header starts a session, and later pages continue it", () => {
  const { sessions, touched } = run([
    page(1, { head: header("2026-10-10", "Okie-Tex 2026"), entries: [entry("M31", 0.3)] }),
    page(2, { entries: [entry("M33", 0.02), entry("M57", 0.34)] }),
  ]);
  assert.deepEqual(summary(sessions), { "2026-10-10-okie-tex-2026": { pages: [1, 2], entries: ["M31@1", "M33@2", "M57@2"] } });
  const s = sessions.get("2026-10-10-okie-tex-2026");
  assert.deepEqual(s.header_box, { page: 1, box: [0.03, 0.02, 0.94, 0.27] });
  assert.deepEqual(s.site, { name: "Okie-Tex 2026", lat: 36.9, lon: -103 });
  assert.equal(s.sky, undefined); // no SQM or notes written
  assert.deepEqual([...touched], ["2026-10-10-okie-tex-2026"]);
});

test("entries above a NEW SESSION block partway down a page continue the earlier session", () => {
  const { sessions } = run([
    page(1, { head: header("2026-09-12", "Camp Billy Joe"), entries: [entry("C33", 0.3)] }),
    page(2, { head: header("2026-10-10", "Okie-Tex 2026", 0.34), entries: [entry("C14", 0.02), entry("M31", 0.62)] }),
  ]);
  assert.deepEqual(summary(sessions), {
    "2026-09-12-camp-billy-joe": { pages: [1, 2], entries: ["C33@1", "C14@2"] },
    "2026-10-10-okie-tex-2026": { pages: [2], entries: ["M31@2"] },
  });
});

test("an upload starting partway down a page finds the earlier session among those recorded", () => {
  const { sessions } = run([page(1, { head: header("2026-09-12", "Camp Billy Joe"), entries: [entry("C33", 0.3)] })]);
  run([page(2, { head: header("2026-10-10", "Okie-Tex 2026", 0.34), entries: [entry("C14", 0.02), entry("M31", 0.62)] })], { sessions, mode: "add" });
  assert.deepEqual(summary(sessions)["2026-09-12-camp-billy-joe"].entries, ["C33@1", "C14@2"]);
});

test("a page that already has entries only gets the ones beyond them", () => {
  const { sessions } = run([page(1, { head: header("2026-10-10", "Okie-Tex 2026"), entries: [entry("M31", 0.3)] })]);
  // A hand correction on the recorded entry survives a re-read in add mode.
  sessions.get("2026-10-10-okie-tex-2026").observations[0].aka = "Andromeda";
  const { touched } = run([page(1, { head: header("2026-10-10", "Okie-Tex 2026"), entries: [entry("M31", 0.3), entry("M32", 0.62)] })], { sessions, mode: "add" });
  const s = sessions.get("2026-10-10-okie-tex-2026");
  assert.deepEqual(s.observations.map((o) => [o.catalog_id, o.aka]), [["M31", "Andromeda"], ["M32", null]]);
  assert.deepEqual([...touched], ["2026-10-10-okie-tex-2026"]);
});

test("replace re-reads a page from scratch, and a session left with no entries is removed", () => {
  const { sessions } = run([
    page(1, { head: header("2026-10-10", "Okie-Tex 2026"), entries: [entry("M31", 0.3)] }),
    page(2, { entries: [entry("M33", 0.02)] }),
  ]);
  run([page(2, { entries: [entry("M57", 0.02)] })], { sessions, mode: "replace" });
  assert.deepEqual(summary(sessions)["2026-10-10-okie-tex-2026"].entries, ["M31@1", "M57@2"]);
  const { removed } = run([page(1, { head: header("2026-10-10", "Okie-Tex 2026") }), page(2)], { sessions, mode: "replace" });
  assert.deepEqual([...removed], ["2026-10-10-okie-tex-2026"]);
  assert.equal(sessions.size, 0);
});

test("a second session on the same date and site gets its own id", () => {
  const { sessions } = run([
    page(1, { head: header("2026-10-10", "Okie-Tex 2026"), entries: [entry("M31", 0.3)] }),
    page(3, { head: header("2026-10-10", "Okie-Tex 2026"), entries: [entry("M33", 0.3)] }),
  ]);
  assert.deepEqual(Object.keys(summary(sessions)), ["2026-10-10-okie-tex-2026", "2026-10-10-okie-tex-2026-2"]);
});

test("entries with no session to belong to are skipped and reported, and uncertain readings noted", () => {
  const { sessions, notes } = run([page(4, { entries: [entry("M31", 0.02)], uncertain: ["M31: time may be 21:10"] })]);
  assert.equal(sessions.size, 0);
  assert.match(notes.join("\n"), /page 4 has entries but no session/);
  const { notes: more } = run([page(1, { head: header("2026-10-10", "Okie-Tex 2026"), entries: [entry("M31", 0.3)], uncertain: ["M31: time may be 21:10"] })]);
  assert.deepEqual(more, ["- 2026-10-10-okie-tex-2026, page 1: M31: time may be 21:10"]);
});

test("the reader's spelling corrections are listed with their session and page (#16)", () => {
  const { corrections } = run([page(1, { head: header("2026-10-10", "Okie-Tex 2026"), entries: [entry("M27", 0.3)], corrections: ["M27 AKA: Dumbell → Dumbbell"] })]);
  assert.deepEqual(corrections, ["- 2026-10-10-okie-tex-2026, page 1: M27 AKA: Dumbell → Dumbbell"]);
});
