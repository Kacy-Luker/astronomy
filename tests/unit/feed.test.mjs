// The feed of new sessions (scripts/lib/feed.mjs, #128).
import assert from "node:assert/strict";
import { test } from "node:test";
import { atomFeed, escapeXML, feedDate, objectList } from "../../scripts/lib/feed.mjs";

const session = (id, date, site, observations = []) => ({ id, date, site: { name: site }, observations });

test("XML special characters are escaped", () => {
  assert.equal(escapeXML(`Tom & Jerry's <"scope">`), "Tom &amp; Jerry&apos;s &lt;&quot;scope&quot;&gt;");
});

test("dates read the same whatever the build's time zone", () => {
  assert.equal(feedDate("2026-10-11"), "Oct 11, 2026");
  assert.equal(feedDate("2025-01-01"), "Jan 1, 2025");
});

test("objects are listed with the name written, else the catalog's", () => {
  const s = session("x", "2026-10-11", "Okie-Tex", [
    { catalog_id: "M31", aka: null, catalog: { name: "Andromeda Galaxy" } },
    { catalog_id: "NGC 6826", aka: "Blinking Planetary", catalog: { name: "NGC 6826" } },
    { catalog_id: "Albireo", aka: "albireo" },
    { catalog_id: "Saturn" },
  ]);
  assert.equal(objectList(s), "M31 (Andromeda Galaxy), NGC 6826 (Blinking Planetary), Albireo, Saturn");
});

test("the feed has the newest sessions first, with absolute links", () => {
  const sessions = [
    session("2025-06-21-backyard", "2025-06-21", "Backyard", [{ catalog_id: "M13" }]),
    session("2026-10-11-okie-tex-2026", "2026-10-11", "Okie-Tex & friends", [{ catalog_id: "M31" }, { catalog_id: "M57" }]),
    session("2026-08-15-davis", "2026-08-15", "Davis Mountains"),
  ];
  const xml = atomFeed(sessions, { size: 2 });
  assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  const entries = [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map((m) => m[0]);
  assert.equal(entries.length, 2);
  assert.match(entries[0], /<title>Oct 11, 2026 · Okie-Tex &amp; friends<\/title>/);
  assert.match(entries[0], /href="https:\/\/kacyluker.com\/astronomy\/session.html\?id=2026-10-11-okie-tex-2026"/);
  assert.match(entries[0], /<summary>2 objects: M31, M57<\/summary>/);
  assert.match(entries[1], /<summary>No objects recorded.<\/summary>/);
  assert.match(xml.split("<entry>")[0], /<updated>2026-10-11T00:00:00Z<\/updated>/);
  assert.ok(!xml.includes("Backyard"), "only the newest sessions");
  assert.equal(atomFeed(sessions), atomFeed([...sessions].reverse()), "the same file whatever order they come in");
});
