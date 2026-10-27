// JSON written for hand editing (scripts/lib/format-json.mjs).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { formatJSON } from "../../scripts/lib/format-json.mjs";

test("short lists and flat objects stay on one line", () => {
  assert.equal(formatJSON({ a: [1, 2], b: { c: 1 } }), '{\n  "a": [1, 2],\n  "b": { "c": 1 }\n}');
  assert.equal(formatJSON([]), "[]");
  assert.equal(formatJSON({}), "{}");
});

test("long lines break", () => {
  const long = { description: "x".repeat(120), n: 1 };
  assert.equal(formatJSON(long), `{\n  "description": "${"x".repeat(120)}",\n  "n": 1\n}`);
});

test("every data file reads back the same", () => {
  for (const dir of ["data/sessions", "data/notebooks", "test-data/sessions", "test-data/notebooks"]) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const value = JSON.parse(readFileSync(join(dir, f), "utf8"));
      assert.deepEqual(JSON.parse(formatJSON(value)), value, join(dir, f));
    }
  }
});
