// Page order (scripts/lib/categories.mjs, data/categories.json).
import assert from "node:assert/strict";
import { test } from "node:test";
import { orderErrors } from "../../scripts/lib/categories.mjs";

test("pages in category order, sessions by number, pass", () => {
  assert.deepEqual(orderErrors([
    { kind: "inside_front_cover" }, { kind: "title" }, { kind: "contents" },
    { kind: "session", number: 1 }, { kind: "blank", number: 2 }, { kind: "index" }, { kind: "info" },
  ]), []);
});

test("out of order, repeated only-one pages and unknown kinds are reported", () => {
  assert.equal(orderErrors([{ kind: "info" }, { kind: "title" }]).length, 1);
  assert.equal(orderErrors([{ kind: "title" }, { kind: "title" }]).length, 1);
  assert.equal(orderErrors([{ kind: "session", number: 3 }, { kind: "session", number: 2 }]).length, 1);
  assert.match(orderErrors([{ kind: "poster" }])[0], /isn't a category/);
});
