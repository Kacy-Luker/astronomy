// The pull request's summary of an import (step 8 of
// scripts/import-notebook.mjs): what was recorded, each session written
// with its to-dos, the rescan checklist when completing, and the notes
// gathered on the way.
//
// notebook: as written; scanName: the upload's file name (null without a
// scan); uploadedCount: its pages; recorded: the names of the pages
// recorded from it, in notebook order, one per page; cover: whether the
// closed-notebook scan became the front cover; sessions, touched, removed:
// from scripts/lib/import/sessions.mjs; frontCover: the notebook's
// front_cover; notes: lines for "Check these".
import { CATEGORIES, category } from "../categories.mjs";
import { pageName as nn } from "../files.mjs";
import { sessionTodos } from "../../../site/todos.js";

export const nameOf = (page) => (page.number != null ? `page ${page.number}` : (page.label ?? category(page.kind)?.label ?? page.kind).toLowerCase());

export function summarize({ mode, notebook, scanName = null, uploadedCount = 0, recorded = [], cover = false, sessions, touched, removed, frontCover, notes = [] }) {
  const what = {
    new: "Created", add: "Added to", replace: "Replaced pages in", complete: "Completed",
  }[mode];
  const lines = [
    `${what} **${notebook.title}**` + (scanName
      ? ` from \`${scanName}\`: ${recorded.length} of ${uploadedCount} uploaded pages recorded` +
        (recorded.length ? ` (${[...new Set(recorded)].join(", ")})` : "") + "."
      : "."),
    ...(cover ? ["The scan of the closed notebook is the front cover; check it's upright and trimmed in the preview."] : []),
    `Status: **${notebook.status === "completed" ? "completed" : "in progress"}**.`,
    "",
  ];
  if (touched.size || removed.size) {
    lines.push("Before merging, compare each session with its pages in the notebook view, and fix",
      "any misread field by editing the session's JSON file on this branch.", "");
    for (const sid of touched) {
      const s = sessions.get(sid);
      lines.push(`- \`${sid}\`: ${s.observations.map((o) => o.catalog_id).join(", ")} (pages ${s.pages.join(", ")})`);
      // Blank fields are to-dos (N/A means the field doesn't apply).
      for (const t of sessionTodos(s)) {
        lines.push(`  - To do, ${t.where}${t.page ? ` (page ${t.page})` : ""}: ${t.fields.join(", ")}`);
      }
    }
    for (const sid of removed) lines.push(`- \`${sid}\`: removed (no entries left)`);
  } else {
    lines.push("No session entries changed.");
  }
  if (notebook.status === "completed") {
    // What completing asks to be rescanned, and whether it has been.
    const todo = CATEGORIES.filter((c) => c.rescan).map((c) => {
      if (c.kind === "front_cover") return { c, todo: !frontCover ? "not scanned yet" : frontCover.open ? "rescan it" : null };
      const ps = notebook.pages.filter((p) => p.kind === c.kind);
      return { c, todo: !ps.length ? "not scanned yet" : ps.some((p) => p.open) ? "rescan it" : null };
    });
    // Other pages still waiting, like ones Claude said would still change.
    const others = [...new Set(notebook.pages.filter((p) => p.open && !category(p.kind)?.rescan).map(nameOf))];
    lines.push("", "### Rescan checklist", "",
      ...todo.map(({ c, todo: t }) => `- [${t ? " " : "x"}] ${c.label}${t ? `: ${t}` : ""}`),
      ...others.map((name) => `- [ ] ${name[0].toUpperCase()}${name.slice(1)}: rescan it`));
    if (todo.some((t) => t.todo && t.c.kind !== "front_cover") || others.length) {
      lines.push("", "Scan those pages (whole spreads, in any order) into one file, upload it, and run",
        "**Complete notebook** again with that file. Each page goes back where its category belongs.");
    }
    if (todo.some((t) => t.todo && t.c.kind === "front_cover")) {
      lines.push("", "Scan the closed notebook's front cover too: in the same file, or on its own with **Front cover** picked as the category in **Import**.");
    }
    // Blank pages are confirmed by hand, and categories never scanned are listed.
    const blanks = notebook.pages.flatMap((p, i) => (p.kind === "blank" ? [p.number != null ? `page ${p.number}` : `scan position ${nn(i)}`] : []));
    if (blanks.length) {
      lines.push("", "### Blank pages", "", "These pages were read as blank. Check each is meant to be blank before merging:", "",
        ...blanks.map((b) => `- ${b}`));
    }
    const missing = CATEGORIES.filter((c) => !c.rescan && !notebook.pages.some((p) => p.kind === c.kind));
    if (missing.length) lines.push("", "### Not scanned", "", ...missing.map((c) => `- ${c.label}`));
  }
  if (notes.length) lines.push("", "### Check these", "", ...notes);
  return lines.join("\n") + "\n";
}
