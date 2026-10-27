// Page numbers for an upload (scripts/lib/import/numbering.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { numberPages } from "../../scripts/lib/import/numbering.mjs";

// pages: [kind, printed number or null] per uploaded page, in scan order.
function number(pages, startPage = null) {
  const readings = pages.map(([kind, printed_number]) => ({ kind, printed_number }));
  const { numberOf, notes } = numberPages({
    uploads: pages.map((_, u) => u), readingOf: (u) => readings[u], kindOf: (u) => readings[u]?.kind, startPage,
  });
  return { numbers: pages.map((_, u) => numberOf(u)), notes };
}

test("printed odd numbers number the pages between them", () => {
  const { numbers, notes } = number([["session", null], ["session", 5], ["session", null], ["session", 7]]);
  assert.deepEqual(numbers, [4, 5, 6, 7]);
  assert.deepEqual(notes, []);
});

test("front matter has no number, nor a page that would come before page 1", () => {
  assert.deepEqual(number([["title", null], ["contents", null], ["session", null], ["session", 1]]).numbers, [null, null, null, 1]);
});

test("a page whose printed number is out of step is reported, and keeps its number", () => {
  const { numbers, notes } = number([["session", null], ["session", 5], ["session", null], ["session", 9], ["session", null], ["session", 9]]);
  assert.equal(numbers[3], 9);
  assert.match(notes.join("\n"), /Uploaded page 04 shows number 9, out of step/);
});

test("without printed numbers, the start page numbers the session pages", () => {
  const { numbers, notes } = number([["title", null], ["session", null], ["session", null]], 12);
  assert.deepEqual(numbers, [null, 12, 13]);
  assert.match(notes[0], /numbered from 12/);
});

test("printed numbers win over the start page, which is reported if it disagrees", () => {
  const { numbers, notes } = number([["session", null], ["session", 3]], 8);
  assert.deepEqual(numbers, [2, 3]);
  assert.match(notes[0], /they make the first session page 2, not 8/);
});

test("a blank page is numbered only beside session pages", () => {
  // A blank facing a session page gets a number; a blank pair after them doesn't.
  const { numbers } = number([["session", null], ["session", 3], ["blank", null], ["blank", null]]);
  assert.deepEqual(numbers, [2, 3, null, null]);
  assert.deepEqual(number([["blank", null], ["session", 3]]).numbers, [2, 3]);
});
