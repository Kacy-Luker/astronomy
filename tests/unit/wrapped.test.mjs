// Each outside library or tool is reached through one module
// (docs/DEPENDENCIES.md), so swapping it means changing one file. This
// fails when another file in scripts/ or site/ starts using one directly.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]))
  .filter((f) => /\.m?js$/.test(f));
const code = [...files("scripts"), ...files("site")].map((f) => [f, readFileSync(f, "utf8")]);
const users = (pattern) => code.filter(([, text]) => pattern.test(text)).map(([f]) => f).sort();

const WRAPPED = [
  // The test pages' drawing script renders SVG; it isn't part of the import or the site.
  ["the image library (sharp)", /from "sharp"/, ["scripts/lib/image.mjs", "scripts/make-test-pages.mjs"]],
  ["the schema library (zod)", /from "zod"/, ["scripts/lib/schema.mjs"]],
  ["the Anthropic API", /from "@anthropic-ai\/sdk"/, ["scripts/lib/readers/claude.mjs"]],
  ["poppler's pdfimages", /"pdfimages"/, ["scripts/lib/scans.mjs"]],
  ["the show-through cleaner (Python)", /"scripts\/showthrough\.py"/, ["scripts/lib/pages.mjs"]],
  ["Leaflet", /vendor\/leaflet/, ["site/map.js"]],
  ["the map tiles", /tile\.openstreetmap\.org/, ["site/map.js"]],
];

for (const [what, pattern, allowed] of WRAPPED) {
  test(`only ${allowed.join(" and ")} use ${what}`, () => {
    assert.deepEqual(users(pattern), allowed);
  });
}
