// Observing programs (#125), a section of the Activity tab: Messier and
// Caldwell, each with how many of its objects have been observed and a
// checklist of all of them. Observed ones link to their object page.
// Objects match through their catalog designations (data/objects.json, as
// the Sketches tab groups them), so NGC 224 counts as M31, and Kacy's own
// mappings apply (M102 is NGC 5866). Counted from the matching search
// documents, like the rest of the tab.
import { el, link, objectHref } from "./lib.js";

export const PROGRAMS = [
  { name: "Messier", prefix: "M", size: 110 },
  { name: "Caldwell", prefix: "C", size: 109 },
];

// Every designation observed in these documents ([{ o }]), each with the
// observation's catalog key (to name it) and name: the catalog's
// designations for the object, and any written on the sheet or added by
// hand.
export function observedIds(docs, catalog = {}) {
  const seen = new Map();
  for (const { o } of docs) {
    const key = o.catalog?.key ?? o.catalog_id;
    const name = o.aka || o.catalog?.name || null;
    for (const id of [...(catalog[key]?.ids ?? []), ...(o.ids ?? []), o.catalog_id]) {
      if (id && !seen.has(id)) seen.set(id, { key, name });
    }
  }
  return seen;
}

// { name, size, done, items: [{ id, observed, name }] } for each program.
export function programProgress(docs, catalog) {
  const seen = observedIds(docs, catalog);
  return PROGRAMS.map(({ name, prefix, size }) => {
    const items = Array.from({ length: size }, (_, i) => {
      const id = `${prefix}${i + 1}`;
      const hit = seen.get(id);
      return { id, observed: Boolean(hit), name: hit?.name ?? null };
    });
    return { name, size, done: items.filter((x) => x.observed).length, items };
  });
}

// The section: a card with each program's count and bar, and its checklist
// folded away under a <details>. narrowed says the search or filters are
// on, so the counts are of what's shown, not the whole log.
export function renderPrograms(docs, catalog, narrowed) {
  const card = el("section", "session wide-card programs");
  card.append(el("h3", "section-title", "Observing programs"));
  if (narrowed) card.append(el("p", "muted bar-note", "Observed in the current selection."));
  const list = el("ul", "bars");
  for (const p of programProgress(docs, catalog)) {
    const item = el("li", "bar-row program");
    item.dataset.program = p.name.toLowerCase();
    const head = el("div", "bar-head");
    head.append(el("span", "bar-label", p.name), el("span", "bar-value program-count", `${p.done} of ${p.size}`));
    const track = el("div", "bar-track");
    track.setAttribute("aria-hidden", "true");
    const fill = el("div", "bar-fill");
    fill.style.width = `${(p.done / p.size) * 100}%`;
    track.append(fill);
    const details = el("details", "checklist");
    details.append(el("summary", null, `${p.name} checklist`));
    const cells = el("ul", "checklist-items");
    for (const x of p.items) {
      const cell = el("li");
      if (x.observed) {
        const a = link(objectHref(x.id), `✓ ${x.id}`, "seen");
        a.title = x.name ? `${x.id} · ${x.name} · observed` : `${x.id} · observed`;
        cell.append(a);
      } else {
        const span = el("span", "not-yet", x.id);
        span.title = `${x.id} · not yet observed`;
        cell.append(span);
      }
      cells.append(cell);
    }
    details.append(cells);
    item.append(head, track, details);
    list.append(item);
  }
  card.append(list);
  return card;
}
