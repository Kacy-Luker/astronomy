// Notebook types (scripts/lib/notebook-types.mjs, data/notebook-types.json, #48).
import assert from "node:assert/strict";
import { test } from "node:test";
import { TYPES, findType, typeOf, unsupported } from "../../scripts/lib/notebook-types.mjs";

test("a notebook without a type is the first type, today's stamped spreads", () => {
  assert.equal(typeOf({ id: "astronomy-001" }).id, "stamped-spreads");
  assert.equal(typeOf(null), TYPES[0]);
  assert.deepEqual(TYPES[0].scan, { pages: 2, rotate: 90, split: 0.47 });
});

test("types are found by id or by the label the form shows", () => {
  assert.equal(findType("stamped-spreads"), TYPES[0]);
  assert.equal(findType(TYPES[0].label), TYPES[0]);
  assert.equal(findType("spiral-bound"), null);
  assert.equal(typeOf({ type: "spiral-bound" }), null);
});

test("only what the import can handle is supported", () => {
  assert.equal(unsupported(TYPES[0]), null);
  assert.match(unsupported({ scan: { pages: 1 }, form: "stamped" }), /single-sheet/);
  assert.match(unsupported({ scan: { pages: 2 }, form: "free" }), /#109/);
});
