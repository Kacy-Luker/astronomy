// The image operations contract (scripts/lib/image.mjs, docs/DEPENDENCIES.md):
// what a replacement image library has to do.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { blank, image, size } from "../../scripts/lib/image.mjs";

const RED = "#ff0000", WHITE = "#ffffff";
// A 40 × 20 white image with a red 10 × 10 square at the top left.
const sample = () => blank(40, 20, WHITE).overlay([{ input: { create: { width: 10, height: 10, channels: 3, background: RED } }, left: 0, top: 0 }]).png().buffer();
const pixel = async (input, x, y) => {
  const { data, width, channels } = await image(input).pixels();
  return [...data.subarray((y * width + x) * channels, (y * width + x) * channels + 3)];
};

test("size, and drawing on a blank image", async () => {
  const s = await sample();
  assert.deepEqual(await size(s), { width: 40, height: 20 });
  assert.deepEqual(await pixel(s, 2, 2), [255, 0, 0]);
  assert.deepEqual(await pixel(s, 30, 15), [255, 255, 255]);
});

test("rotate turns clockwise", async () => {
  const turned = await image(await sample()).rotate(90).png().buffer();
  assert.deepEqual(await size(turned), { width: 20, height: 40 });
  // The red corner moves from top left to top right.
  assert.deepEqual(await pixel(turned, 17, 2), [255, 0, 0]);
});

test("crop, resize and grey", async () => {
  const cut = await image(await sample()).crop({ left: 0, top: 0, width: 10, height: 10 }).png().buffer();
  assert.deepEqual(await size(cut), { width: 10, height: 10 });
  assert.deepEqual(await pixel(cut, 9, 9), [255, 0, 0]);
  assert.deepEqual(await size(await image(await sample()).resize({ width: 20 }).png().buffer()), { width: 20, height: 10 });
  assert.deepEqual(await size(await image(await sample()).resize({ width: 8, height: 8, fit: "fill" }).png().buffer()), { width: 8, height: 8 });
  const { data, width, height } = await image(await sample()).grey().pixels();
  assert.equal(data.length, width * height); // one channel
  assert.ok(data[0] < data[width * height - 1]); // red is darker than white
});

test("blur softens an edge, and invert flips light and dark", async () => {
  const edge = async (input) => (await pixel(input, 10, 5))[1];
  assert.equal(await edge(await sample()), 255);
  assert.ok(await edge(await image(await sample()).blur(3).png().buffer()) < 255);
  assert.deepEqual(await pixel(await image(await sample()).invert().png().buffer(), 2, 2), [0, 255, 255]);
});

test("jpeg encodes a JPEG", async () => {
  const jpg = await image(await sample()).jpeg({ quality: 80 }).buffer();
  assert.deepEqual([...jpg.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual(await size(jpg), { width: 40, height: 20 });
});

test("only scripts/lib/image.mjs uses the image library", () => {
  const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  const users = [...files("scripts"), ...files("site")]
    .filter((f) => /\.m?js$/.test(f) && /from "sharp"/.test(readFileSync(f, "utf8")));
  // The test pages' drawing script renders SVG; it isn't part of the import or the site.
  assert.deepEqual(users.sort(), ["scripts/lib/image.mjs", "scripts/make-test-pages.mjs"]);
});
