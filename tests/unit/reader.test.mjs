// The page reader contract (scripts/lib/reader.mjs, docs/DEPENDENCIES.md):
// any reader is loaded by name or path and held to the reading format.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadReader } from "../../scripts/lib/reader.mjs";
import { extractJSON } from "../../scripts/lib/readers/claude.mjs";

const blank = {
  kind: "blank", printed_number: null, label: null, will_change: false, notebook_label: null,
  personal_info: [], header: null, entries: [], uncertain: [],
};
// A stand-in reader module, written to a scratch file.
function fakeReader(body) {
  const file = join(mkdtempSync(join(tmpdir(), "reader-")), "reader.mjs");
  writeFileSync(file, body);
  return file;
}

test("a reader that answers in the format is used as is", async () => {
  const reader = await loadReader(fakeReader(`
    export const name = "fake";
    export const readPage = async () => (${JSON.stringify(blank)});
    export const checkRedaction = async () => ({ legible: false, what: [] });
  `));
  assert.equal(reader.name, "fake");
  assert.deepEqual(await reader.readPage(Buffer.from("")), blank);
  assert.deepEqual(await reader.checkRedaction(Buffer.from("")), { legible: false, what: [] });
});

test("an answer in another shape is refused", async () => {
  const reader = await loadReader(fakeReader(`
    export const readPage = async () => ({ kind: "poster", entries: "M31" });
    export const checkRedaction = async () => ({ legible: "no" });
  `));
  await assert.rejects(reader.readPage(Buffer.from("")), /answered readPage\(\) in the wrong format/);
  await assert.rejects(reader.checkRedaction(Buffer.from("")), /answered checkRedaction\(\) in the wrong format/);
});

test("a reader missing a function isn't loaded", async () => {
  await assert.rejects(loadReader(fakeReader("export const readPage = async () => null;")), /has no checkRedaction\(\)/);
});

test("the Claude reader is the default and loads without an API key", async () => {
  const before = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const reader = await loadReader();
    assert.equal(reader.name, "claude");
  } finally {
    if (before !== undefined) process.env.ANTHROPIC_API_KEY = before;
  }
});

test("the Claude reader finds the JSON object in a reply", () => {
  assert.deepEqual(extractJSON('Here it is:\n{"kind": "blank"}\nDone.'), { kind: "blank" });
  assert.equal(extractJSON("no JSON here"), null);
  assert.equal(extractJSON("{not json}"), null);
});
