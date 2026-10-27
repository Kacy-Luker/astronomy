// Data files and page names (scripts/lib/files.mjs, #27).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { objectKeys, pageName, readJSON, readJSONDir, writeJSON } from "../../scripts/lib/files.mjs";

test("JSON files are read, with a fallback for a missing one, and written for hand editing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "files-"));
  await writeJSON(join(dir, "b.json"), { id: "b", pages: [1, 2] });
  writeFileSync(join(dir, "a.json"), '{"id":"a"}');
  writeFileSync(join(dir, "notes.txt"), "not JSON");
  assert.equal(readFileSync(join(dir, "b.json"), "utf8"), '{ "id": "b", "pages": [1, 2] }\n');
  assert.deepEqual((await readJSONDir(dir)).map((f) => f.data.id), ["a", "b"]);
  assert.deepEqual(await readJSONDir(join(dir, "none")), []);
  assert.equal(await readJSON(join(dir, "none.json"), null), null);
  await assert.rejects(readJSON(join(dir, "none.json")));
});

test("pages are named from 01, and observations find their object by any designation", () => {
  assert.equal(pageName(0), "01");
  assert.equal(pageName(11), "12");
  const objectOf = objectKeys({ M31: { ids: ["M31", "NGC 224"] } });
  assert.equal(objectOf({ catalog_id: "NGC 224" }), "M31");
  assert.equal(objectOf({ catalog_id: "Andromeda", ids: ["M31"] }), "M31");
  assert.equal(objectOf({ catalog_id: "Albireo" }), null);
});
