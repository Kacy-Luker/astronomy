// The object page's Photo link (#126): Aladin Lite centred on the object.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PHOTO, photoFov, photoUrl, sizeDegrees } from "../../site/photo.js";

test("sizes read as their largest dimension in degrees", () => {
  assert.equal(sizeDegrees("178′ × 70′"), 178 * (1 / 60));
  assert.equal(sizeDegrees("31′"), 31 * (1 / 60));
  assert.equal(sizeDegrees("40″"), 40 * (1 / 3600));
  assert.equal(sizeDegrees("1.5°"), 1.5);
  assert.equal(sizeDegrees(null), null);
  assert.equal(sizeDegrees("N/A"), null);
});

test("the field of view is three times the size, from 0.1° to 5°, else 0.5°", () => {
  assert.equal(photoFov("17′"), 0.85);
  assert.equal(photoFov("178′ × 70′"), 5);
  assert.equal(photoFov("0.3′"), 0.1);
  assert.equal(photoFov(undefined), 0.5);
});

test("the link is centred on the RA/Dec, and there's none without them", () => {
  const url = new URL(photoUrl({ ra: "00:42:44.35", dec: "+41:16:08.6", size: "178′ × 70′" }));
  assert.equal(`${url.origin}${url.pathname}`, PHOTO.url);
  assert.equal(url.searchParams.get("target"), "00:42:44.35 +41:16:08.6");
  assert.equal(url.searchParams.get("fov"), "5");
  assert.equal(url.searchParams.get("survey"), "P/DSS2/color");
  assert.equal(new URL(photoUrl({ ra: "16:41:41.63", dec: "+36:27:40.7" })).searchParams.get("fov"), "0.5");
  assert.equal(photoUrl({ type: "Planet" }), null);
  assert.equal(photoUrl({ ra: "16:41:41.63" }), null);
  assert.equal(photoUrl(undefined), null);
});
