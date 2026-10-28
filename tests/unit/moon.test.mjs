// The Moon at an observation (scripts/lib/moon.mjs, #127), against known
// dates: phases from the published times of full, new and quarter moons,
// and the Moon's altitude at a site as the astronomy-engine library gives it
// (checked against it once; it isn't a dependency).
import assert from "node:assert/strict";
import { test } from "node:test";
import { moonAt, observationMoon, when } from "../../scripts/lib/moon.mjs";

const near = (actual, expected, within, what) =>
  assert.ok(Math.abs(actual - expected) <= within, `${what}: ${actual}, expected ${expected} ± ${within}`);

test("full moon of 17 October 2024 is fully lit", () => {
  const m = moonAt(new Date("2024-10-17T11:26Z"));
  near(m.illumination, 1, 0.01, "lit");
  near(m.phase, 0.5, 0.005, "phase");
  assert.equal(m.name, "Full Moon");
});

test("new moon of 1 November 2024 is dark", () => {
  const m = moonAt(new Date("2024-11-01T12:47Z"));
  near(m.illumination, 0, 0.01, "lit");
  assert.equal(m.name, "New Moon");
});

test("quarters are half lit, waxing then waning", () => {
  const first = moonAt(new Date("2024-10-10T18:55Z"));
  near(first.illumination, 0.5, 0.02, "first quarter lit");
  near(first.phase, 0.25, 0.005, "first quarter phase");
  assert.equal(first.name, "First Quarter");
  const last = moonAt(new Date("2024-10-24T08:03Z"));
  near(last.illumination, 0.5, 0.02, "last quarter lit");
  assert.equal(last.name, "Last Quarter");
});

test("in between, the phase names follow the cycle", () => {
  assert.equal(moonAt(new Date("2024-10-06T12:00Z")).name, "Waxing Crescent");
  assert.equal(moonAt(new Date("2024-10-14T12:00Z")).name, "Waxing Gibbous");
  assert.equal(moonAt(new Date("2024-10-20T12:00Z")).name, "Waning Gibbous");
  assert.equal(moonAt(new Date("2024-10-28T12:00Z")).name, "Waning Crescent");
});

test("the full moon is up at midnight and down at noon", () => {
  // Oklahoma City, the night of the 17 October 2024 full moon (CDT, UTC−5).
  const midnight = moonAt(new Date("2024-10-17T05:30Z"), 35.47, -97.52);
  assert.equal(midnight.up, true);
  near(midnight.altitude, 62.5, 1, "altitude");
  const noon = moonAt(new Date("2024-10-17T17:30Z"), 35.47, -97.52);
  assert.equal(noon.up, false);
  near(noon.altitude, -40.8, 1, "altitude");
});

test("no coordinates: phase only", () => {
  const m = moonAt(new Date("2024-10-17T11:26Z"), "N/A", null);
  assert.equal(m.up, undefined);
  assert.equal(m.altitude, undefined);
});

test("local times are taken as solar time at the site, after midnight on the next day", () => {
  // 104° W is 6 h 56 min behind UT.
  assert.equal(when("2026-08-15", "22:00", null, -104).date.toISOString(), "2026-08-16T04:56:00.000Z");
  assert.equal(when("2026-08-15", "01:30", null, -104).date.toISOString(), "2026-08-16T08:26:00.000Z");
  // No longitude: UTC−6.
  assert.equal(when("2026-08-15", "21:00", null, "N/A").date.toISOString(), "2026-08-16T03:00:00.000Z");
  // A written UT wins, on the date nearest the estimate.
  assert.equal(when("2026-08-15", "22:00", "04:10", -104).date.toISOString(), "2026-08-16T04:10:00.000Z");
});

test("missing, N/A and unreadable times don't crash", () => {
  for (const t of [null, undefined, "N/A", "", "late", "25:00"]) {
    const at = when("2026-08-15", t, t, -104);
    assert.equal(at.timed, false);
    assert.equal(at.date.toISOString(), "2026-08-16T04:56:00.000Z");
  }
  assert.equal(when("someday", "22:00", null, -104), null);
});

test("an observation gets the phase, and up only with a time and the site's coordinates", () => {
  const session = { date: "2024-10-16", site: { name: "Backyard", lat: 35.47, lon: -97.52 } };
  const m = observationMoon(session, { local_time: "23:30" });
  assert.equal(m.name, "Full Moon");
  assert.ok(m.illumination >= 98, `${m.illumination}%`);
  assert.equal(m.up, true);
  assert.equal(typeof m.altitude, "number");
  assert.equal(observationMoon(session, { local_time: "N/A" }).up, undefined);
  const nowhere = { date: "2024-10-16", site: { name: "Somewhere", lat: null, lon: "N/A" } };
  assert.equal(observationMoon(nowhere, { local_time: "23:30" }).up, undefined);
  assert.equal(observationMoon({ date: "N/A", site: {} }, {}), null);
});
