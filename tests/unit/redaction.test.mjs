// Privacy: every redact box on every published page image is still blurred
// (the title pages carry Kacy's phone and email), in the real scans and the
// test data (sharpness: tests/sharpness.mjs).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BLURRED, sharpness } from "../sharpness.mjs";

test("the sharpness measure tells writing from a blur", async () => {
  // The test title page: its owner line is plain, its contact details blurred.
  const title = "test-data/scans/test-001/02.jpg";
  assert.ok(await sharpness(title, [0.12, 0.4, 0.76, 0.06]) > BLURRED * 3);
  assert.ok(await sharpness(title, [0.12, 0.62, 0.76, 0.12]) < BLURRED);
});

for (const [data, scans] of [["data", "scans"], ["test-data", "test-data/scans"]]) {
  for (const f of readdirSync(join(data, "notebooks")).filter((x) => x.endsWith(".json"))) {
    const nb = JSON.parse(readFileSync(join(data, "notebooks", f), "utf8"));
    nb.pages.forEach((page, i) => {
      if (!page.redact?.length) return;
      const image = join(scans, nb.id, `${String(i + 1).padStart(2, "0")}.jpg`);
      test(`${image} is blurred where it should be`, async () => {
        for (const file of [image, image.replace(/\.jpg$/, ".clean.jpg")].filter(existsSync)) {
          for (const box of page.redact) {
            const score = await sharpness(file, box);
            assert.ok(score < BLURRED, `${file} box ${JSON.stringify(box)} is readable (sharpness ${score.toFixed(1)})`);
          }
        }
      });
    });
  }
}
