// Session page: one night's header, notebook pages, and observations.
import {
  el, formatDate, link, loadNotebooks, loadSessions, notebookHref, pageFigure, pageName,
  scanToggle, seeingText, transparencyText,
} from "./lib.js";

const main = document.getElementById("session");

// Append a <dt>/<dd> pair, skipping empty values. value may be a node.
function field(dl, label, value) {
  if (value == null || value === "") return;
  const dd = el("dd");
  dd.append(value instanceof Node ? value : String(value));
  dl.append(el("dt", null, label), dd);
}

function scopeText(scope) {
  if (!scope) return null;
  const specs = [
    scope.type,
    scope.aperture_mm && `${scope.aperture_mm} mm`,
    scope.focal_length_mm && `${scope.focal_length_mm} mm FL`,
    scope.f_ratio && `f/${scope.f_ratio}`,
  ].filter(Boolean);
  return specs.length ? `${scope.name} (${specs.join(", ")})` : scope.name;
}

function renderHeader(s, notebook) {
  const header = el("section", "session-header");
  const head = el("div", "session-head");
  const title = el("h2", "session-title");
  title.append(el("time", null, formatDate(s.date)));
  head.append(title);
  if (s.program) head.append(el("span", "tag", s.program));
  header.append(head);

  const dl = el("dl", "facts");
  const coords = s.site.lat != null && s.site.lon != null ? ` (${s.site.lat}, ${s.site.lon})` : "";
  field(dl, "Site", s.site.name + coords);
  field(dl, "Sky (SQM)", s.sky?.sqm);
  field(dl, "Sky notes", s.sky?.notes);
  field(dl, "Scope", scopeText(s.scope));
  field(dl, s.observers.length > 1 ? "Observers" : "Observer", s.observers.join(", "));
  if (notebook) {
    const pages = s.pages?.length ? `, ${s.pages.length > 1 ? "pages" : "page"} ${s.pages.join("–")}` : "";
    field(dl, "Notebook", link(notebookHref(notebook.id, pageOf(notebook, s.pages?.[0])),
      notebook.title + pages));
  }
  field(dl, "Notes", s.notes);
  header.append(dl);
  return header;
}

const pageOf = (notebook, number) => notebook?.pages.find((p) => p.number === number);

function renderPages(s, notebook) {
  const section = el("section", "scans");
  section.append(el("h3", null, "Original notes"));
  const pages = (s.pages ?? []).map((n) => pageOf(notebook, n)).filter(Boolean);
  if (!pages.length) {
    section.append(el("p", "muted", "No scans for this session yet."));
    return section;
  }
  section.append(scanToggle(section));
  const grid = el("div", "pages");
  grid.append(...pages.map((p) => pageFigure(p,
    `${pageName(p)} of ${notebook.title}, ${s.date}`,
    link(notebookHref(notebook.id, p), `${pageName(p)} · ${notebook.title}`))));
  section.append(grid);
  return section;
}

function renderObservation(o, notebook) {
  const card = el("article", "observation");
  const head = el("div", "session-head");
  head.append(el("h3", "object-id", o.catalog_id));
  if (o.aka) head.append(el("span", "muted", o.aka));
  card.append(head);

  const others = (o.ids ?? []).filter((id) => id !== o.catalog_id);
  if (others.length) {
    const ids = el("ul", "ids");
    ids.append(...others.map((id) => el("li", "tag", id)));
    card.append(ids);
  }

  const dl = el("dl", "facts");
  field(dl, "Local time", o.local_time);
  field(dl, "UT", o.ut);
  field(dl, "Seeing", seeingText(o.seeing));
  field(dl, "Transparency", transparencyText(o.transparency));
  if (o.scope) field(dl, "Scope", scopeText(o.scope));
  field(dl, "Eyepiece", o.eyepiece);
  field(dl, "Magnification", o.magnification && `${o.magnification}×`);
  field(dl, "Filter", o.filter);
  const page = pageOf(notebook, o.page);
  if (page) field(dl, "Notebook", link(notebookHref(notebook.id, page), pageName(page)));
  card.append(dl);

  if (o.description) card.append(el("p", "description", o.description));
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
    ...s.observations.map((o) => renderObservation(o, notebook)),
  );
} catch (err) {
  main.replaceChildren(el("p", "summary", `Couldn't load this session (${err.message}).`));
}
