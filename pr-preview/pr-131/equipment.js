// The home page's Equipment tab: every telescope, eyepiece and filter used,
// with how many observations (and, for telescopes, sessions) each was used
// for, most used first. Counted from the same documents as the search, so
// the counts follow the search and filters. Names written slightly
// differently are one (nameKey), shown in the spelling written most.
// Tapping one opens the Sessions tab filtered to it.
import { mostUsed } from "./filterbar.js";
import { el, link, plural } from "./lib.js";
import { scopeText } from "./observation.js";
import { nameKey } from "./search.js";

const used = (x) => x != null && x !== "";

// [{ name, docs }] grouped by name, most observations first; the Activity
// tab (site/activity.js) counts the same way.
export function group(docs, nameOf) {
  const groups = new Map();
  for (const d of docs) {
    const name = nameOf(d);
    if (!used(name)) continue;
    const k = nameKey(name);
    if (!groups.has(k)) groups.set(k, { names: [], docs: [] });
    groups.get(k).names.push(name);
    groups.get(k).docs.push(d);
  }
  return [...groups.values()]
    .map((g) => ({ name: mostUsed(g.names)[0], docs: g.docs }))
    .sort((a, b) => b.docs.length - a.docs.length || a.name.localeCompare(b.name));
}

function row(name, key, value, details, count) {
  const item = el("li", "equipment-row");
  const head = el("div", "session-head");
  // The Sessions tab with this filter; "No filter" has none to link to.
  head.append(value ? link(`./?${new URLSearchParams({ [key]: value })}#sessions`, name, "object-id") : el("span", "object-id", name));
  head.append(el("span", "tag", count));
  item.append(head);
  if (details) item.append(el("p", "session-meta", details));
  return item;
}

function section(title, rows) {
  const card = el("section", "session");
  card.append(el("h3", "section-title", title));
  if (!rows.length) card.append(el("p", "muted", "None in these observations."));
  else {
    const list = el("ul", "object-rows");
    list.append(...rows);
    card.append(list);
  }
  return card;
}

export function renderEquipment(docs) {
  const scopes = group(docs, (d) => d.s.scope?.name).map(({ name, docs: ds }) => {
    const sessions = new Set(ds.map((d) => d.s.id)).size;
    const specs = scopeText(ds[0].s.scope);
    return row(name, "scope", name, specs !== name ? specs.replace(`${name} `, "").replace(/^\(|\)$/g, "") : null,
      `${plural(ds.length, "observation")} · ${plural(sessions, "session")}`);
  });
  const eyepieces = group(docs, (d) => (d.o.eyepiece === "N/A" ? null : d.o.eyepiece)).map(({ name, docs: ds }) => {
    const mags = [...new Set(ds.map((d) => d.o.magnification).filter(Number.isFinite))].sort((a, b) => a - b);
    return row(name, "eyepiece", name, mags.length ? `At ${mags.map((m) => `${m}×`).join(", ")}` : null, plural(ds.length, "observation"));
  });
  // N/A on the sheet means no filter was used.
  const filters = group(docs, (d) => (d.o.filter === "N/A" ? "No filter" : d.o.filter)).map(({ name, docs: ds }) =>
    row(name, "filter", name === "No filter" ? null : name, null, plural(ds.length, "observation")));
  return [section("Telescopes", scopes), section("Eyepieces", eyepieces), section("Filters", filters)];
}
