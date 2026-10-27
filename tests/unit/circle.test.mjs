// The Sketches tab's thumbnails crop each entry to its sketch circle
// (scripts/lib/circle.mjs, #94): every entry with a box, real and test, has
// its circle found, also when the scan is fainter.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { findCircle } from "../../scripts/lib/circle.mjs";

// Each observation's entry, cut from its page as the build does.
function entries(data, scans) {
  const notebooks = Object.fromEntries(readdirSync(join(data, "notebooks")).map((f) => {
    const nb = JSON.parse(readFileSync(join(data, "notebooks", f), "utf8"));
    return [nb.id, nb];
  }));
  return readdirSync(join(data, "sessions")).flatMap((f) => {
    const s = JSON.parse(readFileSync(join(data, "sessions", f), "utf8"));
    const nb = notebooks[s.notebook];
    return s.observations.filter((o) => o.box && nb).map((o) => {
      const at = nb.pages.findIndex((p) => p.number === o.page);
      return { name: `${s.id} ${o.catalog_id}`, page: join(scans, nb.id, `${String(at + 1).padStart(2, "0")}.jpg`), box: o.box };
    });
  });
}
async function cut({ page, box: [x, y, w, h] }, lift = 0) {
  const { width, height } = await sharp(page).metadata();
  const left = Math.round(x * width), top = Math.round(y * height);
  return sharp(page).extract({ left, top, width: Math.min(Math.round(w * width), width - left), height: Math.min(Math.round(h * height), height - top) })
    .linear(1 - lift / 255, lift).jpeg().toBuffer();
}

for (const e of [...entries("data", "scans"), ...entries("test-data", "test-data/scans")]) {
  test(`the sketch circle is found: ${e.name}`, async () => {
    assert.ok(await findCircle(await cut(e)), "no circle");
    // A fainter scan: the ink lifted 60 grey levels toward the paper.
    assert.ok(await findCircle(await cut(e, 60)), "no circle on a fainter scan");
  });
}
