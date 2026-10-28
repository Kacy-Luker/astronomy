// The import's PR summary (scripts/lib/import/summary.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { nameOf, summarize } from "../../scripts/lib/import/summary.mjs";

const session = {
  id: "2026-10-10-okie-tex-2026", program: "Messier", date: "2026-10-10", site: { name: "Okie-Tex 2026", lat: 36.9, lon: -103 },
  sky: { sqm: 21.9 }, scope: { name: "XT8" }, observers: ["Test Observer"], pages: [3],
  observations: [{ catalog_id: "M31", page: 3, local_time: "21:00", seeing: 2, transparency: 4, eyepiece: "25mm", magnification: 48, filter: "N/A", description: "Seen" }],
};

test("pages are named by number, label or category", () => {
  assert.equal(nameOf({ kind: "session", number: 3 }), "page 3");
  assert.equal(nameOf({ kind: "reference", label: "Seeing and transparency key" }), "seeing and transparency key");
  assert.equal(nameOf({ kind: "title" }), "title page");
});

test("an add lists what was recorded, each session with its to-dos, and the notes", () => {
  const text = summarize({
    mode: "add", notebook: { title: "Test Notebook 2", status: "in_progress", pages: [] },
    scanName: "2026-10-10.pdf", uploadedCount: 4, recorded: ["page 3", "page 4"],
    sessions: new Map([[session.id, session]]), touched: new Set([session.id]), removed: new Set(),
    notes: ["- Skipped 2 uploaded page(s) that were already recorded."],
    corrections: ["- 2026-10-10-okie-tex-2026, page 3: M31 description: eyepeice → eyepiece"],
    usage: { input: 123456, output: 7890 },
  });
  assert.match(text, /^Claude used 123,456 input and 7,890 output tokens \(\[prices per token\]\(https:\/\/docs\.claude\.com\/en\/docs\/about-claude\/pricing\)\)\.$/m);
  assert.match(text, /### Spelling corrected\n\n- 2026-10-10-okie-tex-2026, page 3: M31 description: eyepeice → eyepiece/);
  assert.match(text, /^Added to \*\*Test Notebook 2\*\* from `2026-10-10.pdf`: 2 of 4 uploaded pages recorded \(page 3, page 4\)\.$/m);
  assert.match(text, /^Status: \*\*in progress\*\*\.$/m);
  assert.match(text, /^- `2026-10-10-okie-tex-2026`: M31 \(pages 3\)$/m);
  assert.match(text, /^ {2}- To do, M31 \(page 3\): UT$/m);
  assert.match(text, /### Check these\n\n- Skipped 2/);
});

test("completing without a scan gives the rescan checklist and the blank pages", () => {
  const text = summarize({
    mode: "complete", notebook: { title: "Test Notebook 1", status: "completed", pages: [
      { kind: "title" }, { kind: "contents", open: true }, { kind: "session", number: 1 }, { kind: "blank", number: 2 }, { kind: "index", open: true },
    ] },
    sessions: new Map(), touched: new Set(), removed: new Set(), frontCover: { open: true },
  });
  assert.match(text, /^Completed \*\*Test Notebook 1\*\*\.$/m);
  assert.match(text, /### Rescan checklist\n\n- \[ \] Front cover: rescan it\n- \[ \] Table of contents: rescan it\n- \[ \] Index: rescan it/);
  assert.match(text, /### Blank pages[\s\S]*- page 2/);
  assert.match(text, /No session entries changed\./);
});
