// A notebook's sections: the parts Kacy expects it to have, in order, such as
// front cover, title page, index, scales, session pages, table of contents,
// and notebook info. The scanned pages are matched against them in order.

// Sections whose length isn't known until the notebook is finished.
const OPEN_ENDED = new Set(["session", "contents"]);
// Session pages can also be crossed out or left blank.
const ALSO = { session: ["unused", "blank"] };

export const sectionSize = (s) => s.pages ?? (OPEN_ENDED.has(s.kind) ? Infinity : 1);

function fits(page, section) {
  if (page.kind !== section.kind && !ALSO[section.kind]?.includes(page.kind)) return false;
  return !section.label || !page.label || page.label === section.label;
}

// Which section each page belongs to: an array of section indexes, one per
// page. Pages are taken in order, so a section with nothing scanned yet (an
// outside cover, a table of contents) simply gets none. Pages that don't
// fit the order are listed in errors.
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

// Sections for a new notebook, from its first scanned pages: the outside
// front cover, the front matter as it was read, then session pages, the
// table of contents, and the notebook info page.
export function defaultSections(pages) {
  const sections = [];
  for (const p of pages) {
    if (["session", "unused", "contents", "info"].includes(p.kind) || p.number != null) break;
    const last = sections.at(-1);
    if (last?.kind === p.kind && (last.label ?? null) === (p.label ?? null)) last.pages = (last.pages ?? 1) + 1;
    else sections.push(p.label ? { kind: p.kind, label: p.label } : { kind: p.kind });
  }
  if (sections[0]?.label !== "Front cover") sections.unshift({ kind: "cover", label: "Front cover" });
  sections.push({ kind: "session" }, { kind: "contents", label: "Table of contents" },
    { kind: "info", label: "Notebook info" });
  return sections;
}
