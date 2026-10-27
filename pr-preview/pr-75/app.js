// Home page: Notebooks, Sessions and Sketches tabs. The tab is in the URL
// (#notebooks, #sessions, #sketches, and #sketches/ngc for a catalog) so
// links and the back button keep it.
import {
  applyView, el, formatDate, link, loadNotebooks, loadObjects, loadSessions, notebookHref, objectHref,
  objectName, plural, sessionHref,
} from "./lib.js";
import { CATALOGS, catalogOf, compareIds } from "./catalog.js";
import { observedObjects, sameName } from "./objects.js";
import { todoCount } from "./todos.js";

const summary = document.getElementById("summary");
const TABS = ["notebooks", "sessions", "sketches"];
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
  const todos = todoCount(s);
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
// under Messier and NGC).
const slug = (name) => name.toLowerCase();
function renderObjects(panel, objects) {
  const sections = new Map([...CATALOGS.map((c) => c.name), "Other"].map((name) => [name, []]));
  for (const obj of objects) {
    for (const id of obj.ids) sections.get(catalogOf(id)).push([id, obj]);
  }
  const present = [...sections].filter(([, rows]) => rows.length);
  if (!present.length) {
    panel.append(el("p", "muted", "No objects yet."));
    return;
  }
  const group = el("div", "toggle");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Catalog");
  const list = el("ul", "object-rows");
  const buttons = present.map(([name, rows]) => {
    const b = el("button", null, `${name} · ${rows.length}`);
    b.type = "button";
    b.dataset.catalog = slug(name);
    b.addEventListener("click", () => {
      history.replaceState(null, "", `#sketches/${slug(name)}`);
      show(name);
    });
    return b;
  });
  function show(name) {
    const rows = sections.get(name).sort(([a], [b]) => compareIds(a, b));
    list.replaceChildren(...rows.map(([id, obj]) => renderObjectRow(id, obj)));
    applyView(list);
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.catalog === slug(name)));
  }
  group.append(...buttons);
  const card = el("section", "session");
  card.append(list);
  panel.append(group, card);
  // The catalog named in the URL, else the first one with objects; a link
  // or the back button can change it without reloading the page.
  const fromURL = () => {
    const wanted = location.hash.split("/")[1];
    const match = present.find(([name]) => slug(name) === wanted);
    if (match || !buttons.some((b) => b.getAttribute("aria-pressed") === "true")) show((match ?? present[0])[0]);
  };
  addEventListener("hashchange", fromURL);
  addEventListener("popstate", fromURL);
  fromURL();
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
  const notebookList = document.querySelector("#notebooks ul");
  notebookList.append(...notebooks.map((nb) => renderNotebook(nb, sessions)));
  applyView(notebookList);
  document.querySelector("#sessions ol").append(...sessions.map(renderSession));
  const objects = observedObjects(sessions, catalog);
  renderObjects(document.getElementById("sketches"), objects);
  const count = sessions.reduce((n, s) => n + s.observations.length, 0);
  summary.textContent = `${plural(sessions.length, "session")} · ${plural(count, "observation")} · ${plural(objects.length, "object")}`;
} catch (err) {
  summary.textContent = `Couldn't load sessions (${err.message}).`;
}
