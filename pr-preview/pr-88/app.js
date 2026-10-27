// Home page: Notebooks, Sessions, Sketches, Equipment and Map tabs, under the
// search and filter bar (site/filterbar.js) that narrows them all. The tab
// is in the URL (#notebooks, #sessions, #sketches, #sketches/ngc for a
// catalog, #equipment, #map)
// and so are the search and filters (?q=&site=...), so links and the back
// button keep them.
import {
  applyView, el, formatDate, link, loadNotebooks, loadObjects, loadSessions, notebookHref, objectHref,
  objectName, plural, sessionHref,
} from "./lib.js";
import { CATALOGS, catalogOf, compareIds } from "./catalog.js";
import { observedObjects, sameName } from "./objects.js";
import { renderEquipment } from "./equipment.js";
import { filterBar } from "./filterbar.js";
import { mapPanel } from "./map.js";
import { activeFilters, keepFilters, matchesAll, searchDocuments } from "./search.js";
import { todoCount } from "./todos.js";

const summary = document.getElementById("summary");
const TABS = ["notebooks", "sessions", "sketches", "equipment", "map"];
const DEFAULT_TAB = "sessions";

function renderNotebook(nb, sessions) {
  const item = el("li", "session notebook-card");
  // The outside front cover, when it's been scanned, beside the title, in
  // the viewer's chosen view (see applyView).
  if (nb.front_cover?.thumb) {
    const img = el("img", "cover-thumb");
    img.dataset.original = nb.front_cover.thumb;
    img.alt = "";
    img.loading = "lazy";
    item.append(img);
  }
  const text = el("div", "object-text");
  item.append(text);
  const head = el("div", "session-head");
  head.append(link(notebookHref(nb.id), nb.title, "session-link session-date"));
  head.append(el("span", "tag", nb.status === "completed" ? "Completed" : "In progress"));
  text.append(head);
  const mine = sessions.filter((s) => s.notebook === nb.id);
  const dates = nb.started && `${formatDate(nb.started)} – ${nb.finished ? formatDate(nb.finished) : "now"}`;
  const meta = [dates, plural(mine.length, "session"), plural(nb.pages.length, "scanned page")];
  text.append(el("p", "session-meta", meta.filter(Boolean).join(" · ")));
  return item;
}

function renderSession(s) {
  const item = el("li", "session");
  const head = el("div", "session-head");
  const a = link(sessionHref(s.id), null, "session-link");
  a.append(el("time", "session-date", formatDate(s.date)));
  head.append(a);
  if (s.program && s.program !== "N/A") head.append(el("span", "tag", s.program));
  // The whole session's to-dos, even when a search lists only some objects.
  const todos = todoCount(s.whole ?? s);
  if (todos) head.append(el("span", "tag todo", `${todos} to do`));
  item.append(head);

  const meta = [s.site.name, s.scope?.name, s.observers.join(", ")].filter(Boolean);
  item.append(el("p", "session-meta", meta.join(" · ")));

  const objects = el("ul", "objects");
  for (const o of s.observations) {
    const name = objectName(o);
    const label = name ? `${o.catalog_id} — ${name}` : o.catalog_id;
    objects.append(el("li", "object", label));
  }
  item.append(objects);
  return item;
}

// One row: the designation it's listed under, its name and other
// designations, and the latest observation (with a count when there are
// more).
function renderObjectRow(id, obj) {
  const item = el("li", "object-row");
  // The latest sketch's circle, small, in the viewer's chosen view (see applyView).
  const sketch = obj.seen.find(({ o }) => o.sketch)?.o.sketch;
  if (sketch) {
    const thumb = link(objectHref(id), null, "sketch-thumb");
    const img = el("img");
    img.dataset.original = sketch.thumb.image;
    img.dataset.clean = sketch.thumb.clean;
    img.alt = "";
    img.loading = "lazy";
    thumb.append(img);
    item.append(thumb);
  }
  const text = el("div", "object-text");
  item.append(text);
  const head = el("div", "session-head");
  head.append(link(objectHref(id), id, "object-id"));
  if (obj.name && !sameName(obj.name, id)) head.append(el("span", null, obj.name));
  for (const other of obj.ids.filter((x) => x !== id)) head.append(el("span", "tag", other));
  text.append(head);
  const { o, s } = obj.seen[0];
  const latest = link(sessionHref(s.id), formatDate(s.date));
  const meta = el("p", "session-meta");
  meta.append(latest, ` · ${s.site.name}`);
  if (obj.seen.length > 1) meta.append(" · ", link(objectHref(id), plural(obj.seen.length, "observation")));
  else if (o.catalog?.type) meta.append(` · ${o.catalog.type}`);
  text.append(meta);
  return item;
}

// Objects in catalog order, one catalog at a time, picked with a toggle
// (#sketches/ngc). An object is listed under every catalog it's in (M31
// under Messier and NGC). Returns update(objects), called again as the
// search changes.
const slug = (name) => name.toLowerCase();
function objectsPanel(panel) {
  const group = el("div", "toggle");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Catalog");
  const list = el("ul", "object-rows");
  const card = el("section", "session");
  card.append(list);
  const empty = el("p", "muted");
  panel.append(group, card, empty);
  let sections = new Map();
  let present = [];
  let buttons = [];
  let current = null;
  function show(name) {
    current = name;
    const rows = sections.get(name).sort(([a], [b]) => compareIds(a, b));
    list.replaceChildren(...rows.map(([id, obj]) => renderObjectRow(id, obj)));
    applyView(list);
    keepFilters(list);
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.catalog === slug(name)));
  }
  // The catalog named in the URL, else the one shown (if it still has
  // objects), else the first with objects; a link or the back button can
  // change it without reloading the page.
  const fromURL = () => {
    if (!present.length) return;
    const wanted = location.hash.split("/")[1];
    const pick = present.find(([name]) => slug(name) === wanted) ?? present.find(([name]) => name === current) ?? present[0];
    show(pick[0]);
  };
  addEventListener("hashchange", fromURL);
  addEventListener("popstate", fromURL);
  return (objects, emptyText) => {
    sections = new Map([...CATALOGS.map((c) => c.name), "Other"].map((name) => [name, []]));
    for (const obj of objects) {
      for (const id of obj.ids) sections.get(catalogOf(id)).push([id, obj]);
    }
    present = [...sections].filter(([, rows]) => rows.length);
    group.hidden = card.hidden = !present.length;
    empty.hidden = Boolean(present.length);
    empty.textContent = emptyText;
    buttons = present.map(([name, rows]) => {
      const b = el("button", null, `${name} · ${rows.length}`);
      b.type = "button";
      b.dataset.catalog = slug(name);
      b.addEventListener("click", () => {
        history.replaceState(null, "", `${location.search}#sketches/${slug(name)}`);
        show(name);
      });
      return b;
    });
    group.replaceChildren(...buttons);
    fromURL();
  };
}

// Tabs: links to #notebooks, #sessions and #sketches; arrow keys move along.
const tabs = TABS.map((t) => document.getElementById(`tab-${t}`));
function showTab() {
  const hash = location.hash.slice(1).split("/")[0];
  const current = TABS.includes(hash) ? hash : DEFAULT_TAB;
  TABS.forEach((t, i) => {
    const on = t === current;
    tabs[i].setAttribute("aria-selected", String(on));
    tabs[i].tabIndex = on ? 0 : -1;
    document.getElementById(t).hidden = !on;
  });
  // On a phone the tab row scrolls; keep the open tab in view.
  const open = tabs[TABS.indexOf(current)];
  open.parentElement.scrollLeft = Math.max(0, open.offsetLeft + open.offsetWidth - open.parentElement.clientWidth + 16);
}
for (const tab of tabs) {
  // Swap the hash without jumping down to the panel.
  tab.addEventListener("click", (e) => {
    e.preventDefault();
    history.pushState(null, "", tab.getAttribute("href"));
    showTab();
  });
  tab.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });
}
addEventListener("popstate", showTab);
showTab();

try {
  const [sessions, notebooks, catalog] = await Promise.all([loadSessions(), loadNotebooks(), loadObjects()]);
  const docs = searchDocuments(sessions, notebooks);
  const notebookList = document.querySelector("#notebooks ul");
  const sessionList = document.querySelector("#sessions ol");
  const updateObjects = objectsPanel(document.getElementById("sketches"));
  const updateMap = mapPanel(document.getElementById("map"));
  const noMatch = (list, text) => list.replaceChildren(el("li", "muted no-match", text));
  // Every tab from the observations that match the search and filters: a
  // session lists only its matching objects, a notebook shows when any of
  // its sessions match.
  function render(state) {
    const narrowed = Boolean(state.q.trim() || activeFilters(state).length);
    const found = new Set(docs.filter((d) => matchesAll(d, state)).map((d) => d.o));
    const shown = sessions
      .map((s) => ({ ...s, whole: s, observations: s.observations.filter((o) => found.has(o)) }))
      .filter((s) => s.observations.length);
    const books = narrowed ? notebooks.filter((nb) => shown.some((s) => s.notebook === nb.id)) : notebooks;
    notebookList.replaceChildren(...books.map((nb) => renderNotebook(nb, shown)));
    if (!books.length) noMatch(notebookList, "No notebooks match.");
    applyView(notebookList);
    sessionList.replaceChildren(...shown.map(renderSession));
    if (!shown.length) noMatch(sessionList, "No sessions match.");
    const objects = observedObjects(shown, catalog);
    updateObjects(objects, "No objects match.");
    const equipment = document.getElementById("equipment");
    equipment.replaceChildren(...renderEquipment(docs.filter((d) => found.has(d.o))));
    keepFilters(equipment);
    updateMap(docs.filter((d) => found.has(d.o)));
    summary.textContent = narrowed
      ? `${plural(found.size, "matching observation")} · ${plural(shown.length, "session")} · ${plural(objects.length, "object")}`
      : `${plural(sessions.length, "session")} · ${plural(found.size, "observation")} · ${plural(objects.length, "object")}`;
  }
  const bar = filterBar(docs, render);
  summary.after(bar.element);
  render(bar.state());
  keepFilters();
} catch (err) {
  summary.textContent = `Couldn't load sessions (${err.message}).`;
}
