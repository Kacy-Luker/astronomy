// Home page: Notebooks, Sessions and Sketches tabs. The tab is in the URL
// (#notebooks, #sessions, #sketches, and #sketches/ngc for a catalog) so
// links and the back button keep it.
import {
  el, formatDate, link, loadNotebooks, loadObjects, loadSessions, notebookHref, objectName, plural,
  sessionHref,
} from "./lib.js";
import { CATALOGS, catalogOf, compareIds } from "./catalog.js";
import { todoCount } from "./todos.js";

const summary = document.getElementById("summary");
const TABS = ["notebooks", "sessions", "sketches"];
const DEFAULT_TAB = "sessions";

function renderNotebook(nb, sessions) {
  const item = el("li", "session");
  const head = el("div", "session-head");
  head.append(link(notebookHref(nb.id), nb.title, "session-link session-date"));
  head.append(el("span", "tag", nb.status === "completed" ? "Completed" : "In progress"));
  item.append(head);
  const mine = sessions.filter((s) => s.notebook === nb.id);
  const dates = nb.started && `${formatDate(nb.started)} – ${nb.finished ? formatDate(nb.finished) : "now"}`;
  const meta = [dates, plural(mine.length, "session"), plural(nb.pages.length, "scanned page")];
  item.append(el("p", "session-meta", meta.filter(Boolean).join(" · ")));
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

// Every observed object with its designations and observations, newest
// first. Catalog objects group by their key in data/objects.json, so M31
// and NGC 224 are one object; others by the designation as written.
function observedObjects(sessions, catalog) {
  const byKey = new Map();
  for (const s of sessions) {
    for (const o of s.observations) {
      const key = o.catalog?.key ?? o.catalog_id;
      if (!byKey.has(key)) byKey.set(key, { ids: [...(catalog[key]?.ids ?? [])], seen: [] });
      const obj = byKey.get(key);
      // Designations written or added by hand count too (M51's NGC 5195).
      for (const id of o.ids ?? [o.catalog_id]) if (!obj.ids.includes(id)) obj.ids.push(id);
      obj.seen.push({ o, s });
    }
  }
  for (const obj of byKey.values()) {
    obj.seen.sort((a, b) => b.s.date.localeCompare(a.s.date));
    obj.name = obj.seen.map(({ o }) => objectName(o)).find(Boolean) ?? null;
  }
  return [...byKey.values()];
}

// One row: the designation it's listed under, its name and other
// designations, and the latest observation (with a count when there are
// more).
function renderObjectRow(id, obj) {
  const item = el("li", "object-row");
  const head = el("div", "session-head");
  head.append(el("span", "object-id", id));
  if (obj.name) head.append(el("span", null, obj.name));
  for (const other of obj.ids.filter((x) => x !== id)) head.append(el("span", "tag", other));
  item.append(head);
  const { o, s } = obj.seen[0];
  const latest = link(sessionHref(s.id), formatDate(s.date));
  const meta = el("p", "session-meta");
  meta.append(latest, ` · ${s.site.name}`);
  if (obj.seen.length > 1) meta.append(` · ${plural(obj.seen.length, "observation")}`);
  else if (o.catalog?.type) meta.append(` · ${o.catalog.type}`);
  item.append(meta);
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
  document.querySelector("#notebooks ul").append(...notebooks.map((nb) => renderNotebook(nb, sessions)));
  document.querySelector("#sessions ol").append(...sessions.map(renderSession));
  const objects = observedObjects(sessions, catalog);
  renderObjects(document.getElementById("sketches"), objects);
  const count = sessions.reduce((n, s) => n + s.observations.length, 0);
  summary.textContent = `${plural(sessions.length, "session")} · ${plural(count, "observation")} · ${plural(objects.length, "object")}`;
} catch (err) {
  summary.textContent = `Couldn't load sessions (${err.message}).`;
}
