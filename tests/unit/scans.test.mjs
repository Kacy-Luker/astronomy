// The scan source (scripts/lib/scans.mjs): which notebook and upload a form
// run is for, and what a scan file is.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { listSpreads, newestScan, pickScan, sniff } from "../../scripts/lib/scans.mjs";

// An uploads folder: { "astronomy-001/2026-10-23.pdf": "%PDF", ... }.
function store(files) {
  const dir = mkdtempSync(join(tmpdir(), "scans-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}
const PDF = "%PDF-1.7";
const pick = (dir, options, existing = ["astronomy-001"]) =>
  pickScan({ store: dir, hasNotebook: (id) => existing.includes(id), ...options });

test("the newest upload sorts by date, with times after the plain date", () => {
  const dir = store({ "astronomy-001/2026-10-11.pdf": PDF, "astronomy-001/2026-10-23.pdf": PDF, "astronomy-001/2026-10-23-1350.pdf": PDF, "astronomy-001/2026-09-01.jpg": "x" });
  assert.equal(newestScan(dir, "astronomy-001"), "astronomy-001/2026-10-23-1350.pdf");
  assert.equal(newestScan(dir, "astronomy-002"), null);
});

test("an import uses the scan given, or the notebook's newest", () => {
  const dir = store({ "astronomy-001/2026-10-11.pdf": PDF, "astronomy-001/2026-10-23.pdf": PDF });
  assert.deepEqual(pick(dir, { mode: "add", picked: "astronomy-001" }), { notebook: "astronomy-001", scan: "astronomy-001/2026-10-23.pdf" });
  assert.deepEqual(pick(dir, { mode: "add", picked: "astronomy-001", scan: "astronomy-001/2026-10-11.pdf" }).scan, "astronomy-001/2026-10-11.pdf");
  assert.throws(() => pick(dir, { mode: "add", picked: "astronomy-001", scan: "astronomy-002/x.pdf" }), /isn't in astronomy-001's folder/);
  assert.throws(() => pick(dir, { mode: "add", picked: "astronomy-001", scan: "astronomy-001/nope.pdf" }), /astronomy-scans has no astronomy-001\/nope.pdf/);
  assert.throws(() => pick(dir, { mode: "add", picked: "astronomy-001", scan: "../secret" }), /can't contain '..'/);
});

test("completing without a scan needs none", () => {
  const dir = store({ "astronomy-001/2026-10-11.pdf": PDF });
  assert.deepEqual(pick(dir, { mode: "complete", picked: "astronomy-001" }), { notebook: "astronomy-001", scan: null });
});

test("a new notebook is named for its folder", () => {
  const dir = store({ "astronomy-001/2026-10-11.pdf": PDF, "astronomy-002/2026-11-01.pdf": PDF });
  // The one folder with no notebook yet.
  assert.deepEqual(pick(dir, { mode: "new", picked: "new-notebook" }), { notebook: "astronomy-002", scan: "astronomy-002/2026-11-01.pdf" });
  // Or the scan's folder.
  assert.equal(pick(dir, { mode: "new", picked: "new-notebook", scan: "astronomy-002/2026-11-01.pdf" }).notebook, "astronomy-002");
  assert.throws(() => pick(dir, { mode: "new", picked: "new-notebook", scan: "2026-11-01.pdf" }), /in a folder named for the new notebook/);
  assert.throws(() => pick(dir, { mode: "new", picked: "new-notebook", scan: "astronomy-001/2026-10-11.pdf" }), /already exists/);
  assert.throws(() => pick(dir, { mode: "new", picked: "new-notebook" }, ["astronomy-001", "astronomy-002"]), /already has a notebook/);
  assert.throws(() => pick(dir, { mode: "new", picked: "new-notebook" }, []), /More than one folder has no notebook yet \(astronomy-001 astronomy-002\)/);
  const odd = store({ "Notebook 3/2026-11-01.pdf": PDF });
  assert.throws(() => pick(odd, { mode: "new", picked: "new-notebook" }, []), /lowercase letters, digits and dashes/);
});

test("a scan is known by its first bytes, not its name", async () => {
  const dir = store({ "a.pdf": PDF, "b.jpg": Buffer.from([0xff, 0xd8, 0xff]), "c.pdf": "version https://git-lfs.github.com/spec/v1", "d.heic": Buffer.from("\0\0\0\x18ftypheic") });
  assert.equal(await sniff(join(dir, "a.pdf")), "pdf");
  assert.equal(await sniff(join(dir, "b.jpg")), "jpeg");
  assert.equal(await sniff(join(dir, "c.pdf")), "lfs-pointer");
  assert.equal(await sniff(join(dir, "d.heic")), "heic");
  await assert.rejects(listSpreads(join(dir, "c.pdf"), dir), /Git LFS pointer/);
  await assert.rejects(listSpreads(join(dir, "d.heic"), dir), /iPhone HEIC photo/);
  assert.deepEqual(await listSpreads(join(dir, "b.jpg"), dir), [join(dir, "b.jpg")]);
});

test("pick-scan.mjs writes the notebook, scan and branch for the workflow", () => {
  // pick-scan reads uploads from .scans/ in the working folder.
  const dir = store({ ".scans/astronomy-001/2026-10-23-1350.pdf": PDF });
  const env = join(dir, "github.env");
  writeFileSync(env, "");
  execFileSync("node", [resolve("scripts/pick-scan.mjs")], { cwd: dir, env: { ...process.env, GITHUB_ENV: env, MODE: "add", PICKED: "astronomy-001", SCAN: "" } });
  assert.match(readFileSync(env, "utf8"), /NOTEBOOK=astronomy-001\nSCAN=astronomy-001\/2026-10-23-1350.pdf\nBRANCH=import\/astronomy-001-add-2026-10-23-1350\n/);
});
