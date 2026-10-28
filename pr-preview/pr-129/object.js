// Object page: everything about one object (object.html?id=M31, or any of
// its designations) and every observation of it, newest first.
import {
  editLink, el, favoriteLink, formatDate, link, loadNotebooks, loadObjects, loadSessions, plural, scanToggle,
  sessionFile, sessionHref,
} from "./lib.js";
import { jointCard } from "./cards.js";
import { filterBar } from "./filterbar.js";
import { field, observationDescription, observationFacts } from "./observation.js";
import { findObject, observedObjects, sameName } from "./objects.js";
import { PHOTO, photoUrl } from "./photo.js";
import { activeFilters, keepFilters, matchesAll, searchDocuments } from "./search.js";

const main = document.getElementById("object");

function renderHeader(obj, info) {
  const header = el("section", "session-header");
  const head = el("div", "session-head");
  head.append(el("h2", "session-title", obj.ids[0] ?? obj.key));
  // An object known by its name (Albireo) isn't named twice.
  if (obj.name && !sameName(obj.name, obj.ids[0] ?? obj.key)) head.append(el("span", "muted", obj.name));
  // Kacy's own catalog mappings decide which object a designation is.
  head.append(...[editLink("data/personalObjectMappings.json", "Edit mappings")].filter(Boolean));
  header.append(head);
  const others = obj.ids.slice(1);
  if (others.length) {
    const ids = el("ul", "ids");
    ids.append(...others.map((id) => el("li", "tag", id)));
    header.append(ids);
  }
  const dl = el("dl", "facts");
  if (info) {
    field(dl, "Type", info.type);
    field(dl, "Constellation", info.constellation);
    field(dl, "Magnitude", info.magnitude);
    field(dl, "Size", info.size);
    field(dl, "RA / Dec", info.ra && info.dec && `${info.ra}, ${info.dec}`);
    if (info.names?.length > 1) field(dl, "Also called", info.names.slice(1).join(", "));
    field(dl, "Photo", photoLink(info));
  }
  field(dl, "Observed", plural(obj.seen.length, "time"));
  header.append(dl);
  return header;
}

// A photo of the object's patch of sky, to compare with the sketch (#126):
// Aladin Lite in a new tab, credited beside the link. None without RA/Dec.
function photoLink(info) {
  const href = photoUrl(info);
  if (!href) return null;
  const a = link(href, PHOTO.name, "photo-link");
  a.target = "_blank";
  a.rel = "noopener";
  const span = el("span");
  span.append(a, el("span", "muted", ` (${PHOTO.credit})`));
  return span;
}

// The sketch from one session at a time: the session's header, then the
// entry, cut from the page. A toggle switches sessions when there are
// several, and the scan toggle switches Inverted / Cleaned / Original.
function renderSketches(obj) {
  const seen = obj.seen.filter(({ o }) => o.sketch);
  if (!seen.length) return [];
  const section = el("section", "scans sketches");
  section.append(el("h3", null, "Sketch"));
  const frame = el("div");
  const label = ({ s }) => `${formatDate(s.date)} · ${s.site.name}`;
  // Kacy's favorite comes first and is shown to start with (#23).
  seen.sort((a, b) => Boolean(b.o.favorite) - Boolean(a.o.favorite));
  const show = (i) => {
    const { o, s } = seen[i];
    // The joint card: the session's block and the entry, two images with a gap.
    frame.replaceChildren(jointCard(o.sketch, `Session header, ${label(seen[i])}`,
      `${o.catalog_id}, ${label(seen[i])}`, link(sessionHref(s.id), label(seen[i]))));
    for (const [j, b] of buttons.entries()) b.setAttribute("aria-pressed", String(j === i));
  };
  const group = el("div", "toggle");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Session");
  const buttons = seen.map(({ o, s }, i) => {
    const b = el("button", null, `${o.favorite ? "★ " : ""}${formatDate(s.date)}`);
    b.type = "button";
    b.addEventListener("click", () => show(i));
    return b;
  });
  group.append(...buttons);
  const toggle = scanToggle(frame);
  if (seen.length > 1) section.append(group);
  section.append(toggle, frame);
  show(0);
  return [section];
}

// One observation: when and where, then the entry as on the sheet.
function renderSighting({ o, s }, obj, notebooks) {
  const card = el("article", "observation");
  const head = el("div", "session-head");
  const h = el("h3", "object-id");
  h.append(link(sessionHref(s.id), formatDate(s.date)));
  head.append(h, el("span", "muted", s.site.name));
  if (s.program && s.program !== "N/A") head.append(el("span", "tag", s.program));
  // Written under another of its designations that night (e.g. NGC 224).
  if (o.catalog_id !== obj.ids[0]) head.append(el("span", "tag", `as ${o.catalog_id}`));
  if (o.favorite) head.append(el("span", "tag favorite", "★ Favorite"));
  head.append(...[favoriteLink(o, s, s.observations.indexOf(o) + 1), editLink(sessionFile(s.id))].filter(Boolean));
  card.append(head);
  card.append(observationFacts(o, notebooks.find((n) => n.id === s.notebook)), observationDescription(o));
  return card;
}

try {
  const id = new URLSearchParams(location.search).get("id");
  const [sessions, notebooks, catalog] = await Promise.all([loadSessions(), loadNotebooks(), loadObjects()]);
  const obj = id && findObject(observedObjects(sessions, catalog), id);
  if (!obj) throw new Error(id ? `no observations of "${id}"` : "no object in the link");
  document.title = `${obj.ids[0]}${obj.name && !sameName(obj.name, obj.ids[0]) ? ` · ${obj.name}` : ""} · Observing Log`;
  // Only the observations in the search and filters, sketches included.
  // (An object seen once gets no bar: site/filterbar.js.)
  const docs = searchDocuments(sessions, notebooks);
  const header = renderHeader(obj, catalog[obj.key]);
  const draw = (state) => {
    const hit = new Set(docs.filter((d) => matchesAll(d, state)).map((d) => d.o));
    const shown = { ...obj, seen: obj.seen.filter(({ o }) => hit.has(o)) };
    const on = activeFilters(state).length || state.q.trim();
    main.replaceChildren(
      bar.element,
      header,
      ...renderSketches(shown),
      el("h3", "section-title", "Observations"),
      ...(on ? [el("p", "muted filter-note", shown.seen.length
        ? `${shown.seen.length} of ${plural(obj.seen.length, "observation")} match.`
        : "No observations of it match the search and filters.")] : []),
      ...shown.seen.map((x) => renderSighting(x, obj, notebooks)),
    );
    keepFilters(main);
  };
  const bar = filterBar(docs.filter((d) => obj.seen.some(({ o }) => o === d.o)), draw);
  draw(bar.state());
  keepFilters();
} catch (err) {
  main.replaceChildren(el("p", "summary", `Couldn't load this object (${err.message}).`));
}
