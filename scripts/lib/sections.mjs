// A notebook's sections: the parts Kacy expects it to have, in order, such as
// front cover, title page, table of contents, scales, session pages, index,
// and notebook info. The scanned pages are matched against them in order.

// Sections whose length isn't known until the notebook is finished.
const OPEN_ENDED = new Set(["session", "index"]);
// Session pages can also be crossed out or left blank.
const ALSO = { session: ["unused", "blank"] };

export const sectionSize = (s) => s.pages ?? (OPEN_ENDED.has(s.kind) ? Infinity : 1);

function fits(page, section) {
  if (page.kind !== section.kind && !ALSO[section.kind]?.includes(page.kind)) return false;
  return !section.label || !page.label || page.label === section.label;
}

// Which section each page belongs to: an array of section indexes, one per
// page. Pages are taken in order, so a section with nothing scanned yet (the
// index, before the notebook is finished) simply gets none. The outside
// front cover is scanned on its own, not as a page. Pages that don't fit the
// order are listed in errors.
export function assignSections(sections, pages) {
  const owner = [];
  const errors = [];
  let i = 0;
  sections.forEach((section, s) => {
    for (let n = 0; i < pages.length && n < sectionSize(section) && fits(pages[i], section); n++) owner[i++] = s;
  });
  if (i < pages.length) {
    const p = pages[i];
    errors.push(`/pages/${i} (${p.label ?? p.kind}${p.number != null ? `, page ${p.number}` : ""}) doesn't fit the notebook's sections in order`);
  }
  return { owner, errors };
}

// Back matter: the sections after the session pages. Its pages sit at the end
// of the page list and may be scanned before the session pages are filled in.
export const backStart = (sections) => sections.findIndex((s) => s.kind === "session") + 1 || sections.length;

// Sections with nothing scanned yet.
export function missingSections(notebook) {
  const { owner } = assignSections(notebook.sections, notebook.pages);
  return notebook.sections.filter((s, k) => (s.kind === "front_cover" ? !notebook.front_cover : !owner.includes(k)));
}

// Sections for a new notebook, from its first scanned pages: the outside
// front cover, the front matter as it was read, session pages, then the
// index, the notebook info page, and the inside back cover. While the
// notebook is in progress only the front cover, title page, scales, session
// pages and info page are shown; completing it asks for the front cover,
// table of contents and index to be rescanned.
export function defaultSections(pages) {
  const sections = [{ kind: "front_cover", label: "Front cover", rescan: true }];
  for (const p of pages) {
    if (["session", "unused", "index", "info"].includes(p.kind) || p.number != null) break;
    const last = sections.at(-1);
    if (last.kind === p.kind && (last.label ?? null) === (p.label ?? null)) last.pages = (last.pages ?? 1) + 1;
    else {
      const section = p.label ? { kind: p.kind, label: p.label } : { kind: p.kind };
      if (!["title", "reference"].includes(p.kind)) section.hidden_until_complete = true;
      if (p.kind === "contents") section.rescan = true;
      sections.push(section);
    }
  }
  sections.push(
    { kind: "session" },
    { kind: "index", label: "Index", hidden_until_complete: true, rescan: true },
    { kind: "info", label: "Notebook info" },
    { kind: "cover", label: "Inside back cover", hidden_until_complete: true },
  );
  // Same key order as the hand-written files.
  return sections.map(({ kind, label, pages, hidden_until_complete, rescan }) => Object.fromEntries(
    Object.entries({ kind, label, pages, hidden_until_complete, rescan }).filter(([, v]) => v !== undefined)));
}
