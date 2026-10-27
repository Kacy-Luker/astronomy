// Session page: one night's header, notebook pages, and observations.
import {
  el, editLink, formatDate, link, loadNotebooks, loadSessions, notebookHref, objectHref, pageFigure, pageName,
  catalogText, objectName, scanToggle, sessionFile,
} from "./lib.js";
import { objectCard, sessionCard } from "./cards.js";
import { field, observationDescription, observationFacts, pageOf, scopeText, sheetField } from "./observation.js";
import { isBlank, isNA, todoCount } from "./todos.js";

const main = document.getElementById("session");

function renderHeader(s, notebook) {
  const header = el("section", "session-header");
  const head = el("div", "session-head");
  const title = el("h2", "session-title");
  title.append(el("time", null, formatDate(s.date)));
  head.append(title);
  if (s.program && !isNA(s.program)) head.append(el("span", "tag", s.program));
  const todos = todoCount(s);
  if (todos) head.append(el("span", "tag todo", `${todos} to do`));
  head.append(...[editLink(sessionFile(s.id), "Edit session")].filter(Boolean));
  header.append(head);
  // The NEW SESSION block as written.
  if (s.header_sketch) header.append(sessionCard(s.header_sketch, `New session block, ${formatDate(s.date)}`));

  const dl = el("dl", "facts");
  if (isBlank(s.program) || isNA(s.program)) sheetField(dl, "Program", s.program);
  sheetField(dl, "Site", s.site.name);
  const { lat, lon } = s.site;
  sheetField(dl, "Lat/long", isNA(lat) || isNA(lon) ? "N/A" : isBlank(lat) || isBlank(lon) ? null : `${lat}, ${lon}`);
  sheetField(dl, "Sky (SQM)", s.sky?.sqm);
  field(dl, "Sky notes", s.sky?.notes);
  sheetField(dl, "Scope", s.scope?.name, scopeText(s.scope));
  sheetField(dl, s.observers.length > 1 ? "Observers" : "Observer", s.observers.join(", "));
  if (notebook) {
    const pages = s.pages?.length ? `, ${s.pages.length > 1 ? "pages" : "page"} ${s.pages.join("–")}` : "";
    field(dl, "Notebook", link(notebookHref(notebook.id, pageOf(notebook, s.pages?.[0])),
      notebook.title + pages));
  }
  field(dl, "Notes", s.notes);
  header.append(dl);
  return header;
}

function renderPages(s, notebook) {
  const section = el("section", "scans");
  section.append(el("h3", null, "Original notes"));
  const pages = (s.pages ?? []).map((n) => pageOf(notebook, n)).filter((p) => p && !p.hidden);
  if (!pages.length) {
    section.append(el("p", "muted", "No scans for this session yet."));
    return section;
  }
  // The view applies to the whole page: these pages and the sketch cards.
  section.append(scanToggle(main));
  const grid = el("div", "pages");
  grid.append(...pages.map((p) => pageFigure(p,
    `${pageName(p)} of ${notebook.title}, ${s.date}`,
    link(notebookHref(notebook.id, p), `${pageName(p)} · ${notebook.title}`))));
  section.append(grid);
  return section;
}

function renderObservation(o, notebook, s) {
  const card = el("article", "observation");
  const head = el("div", "session-head");
  const h = el("h3", "object-id");
  h.append(link(objectHref(o.catalog?.key ?? o.catalog_id), o.catalog_id));
  head.append(h);
  const name = objectName(o);
  if (name) head.append(el("span", "muted", name));
  head.append(...[editLink(sessionFile(s.id))].filter(Boolean));
  card.append(head);
  const about = catalogText(o.catalog);
  if (about) card.append(el("p", "catalog muted", about));

  const others = (o.ids ?? []).filter((id) => id !== o.catalog_id);
  if (others.length) {
    const ids = el("ul", "ids");
    ids.append(...others.map((id) => el("li", "tag", id)));
    card.append(ids);
  }

  // The entry as written; its session's block is shown once, at the top.
  if (o.sketch) card.append(objectCard(o.sketch, `${o.catalog_id} entry, ${formatDate(s.date)}`));
  card.append(observationFacts(o, notebook), observationDescription(o));
  return card;
}

try {
  const id = new URLSearchParams(location.search).get("id");
  const [sessions, notebooks] = await Promise.all([loadSessions(), loadNotebooks()]);
  const s = sessions.find((x) => x.id === id);
  if (!s) throw new Error(id ? `no session "${id}"` : "no session id in the link");
  const notebook = notebooks.find((n) => n.id === s.notebook);

  document.title = `${formatDate(s.date)} · ${s.site.name} · Observing Log`;
  main.replaceChildren(
    renderHeader(s, notebook),
    renderPages(s, notebook),
    el("h3", "section-title", "Observations"),
    ...s.observations.map((o) => renderObservation(o, notebook, s)),
  );
} catch (err) {
  main.replaceChildren(el("p", "summary", `Couldn't load this session (${err.message}).`));
}
