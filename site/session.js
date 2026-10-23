// Session page: one night's header, scans, and observations.
import { el, formatDate, loadSessions } from "./lib.js";

const main = document.getElementById("session");
const ROMAN = ["I", "II", "III", "IV", "V"];

// Append a <dt>/<dd> pair, skipping empty values.
function field(dl, label, value) {
  if (value == null || value === "") return;
  dl.append(el("dt", null, label), el("dd", null, String(value)));
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

function renderHeader(s) {
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
  field(dl, "Notes", s.notes);
  header.append(dl);
  return header;
}

// The viewer's last choice is remembered; storage can be unavailable.
const VIEW_KEY = "scan-view";
function savedView() {
  try { return localStorage.getItem(VIEW_KEY); } catch { return null; }
}
function saveView(view) {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* not persisted */ }
}

// Original / Inverted buttons that flip the scans' colors in place.
function renderScanToggle(section) {
  const group = el("div", "toggle");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Scan colors");
  const buttons = ["original", "inverted"].map((view) => {
    const b = el("button", null, view[0].toUpperCase() + view.slice(1));
    b.type = "button";
    b.dataset.view = view;
    b.addEventListener("click", () => { apply(view); saveView(view); });
    return b;
  });
  function apply(view) {
    section.classList.toggle("inverted", view === "inverted");
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  }
  apply(savedView() === "inverted" ? "inverted" : "original");
  group.append(...buttons);
  return group;
}

function renderScans(s) {
  const section = el("section", "scans");
  section.append(el("h3", null, "Original notes"));
  if (!s.scans?.length) {
    section.append(el("p", "muted", "No scans for this session yet."));
    return section;
  }
  section.append(renderScanToggle(section));
  for (const [i, src] of s.scans.entries()) {
    const link = el("a", "scan");
    link.href = src;
    const img = el("img");
    img.src = src;
    img.alt = `Page ${i + 1} of the paper log for ${s.date}`;
    img.loading = "lazy";
    link.append(img);
    section.append(link);
  }
  return section;
}

function renderObservation(o) {
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
  field(dl, "Seeing", o.seeing && ROMAN[o.seeing - 1]);
  field(dl, "Transparency", o.transparency && ROMAN[o.transparency - 1]);
  if (o.scope) field(dl, "Scope", scopeText(o.scope));
  field(dl, "Eyepiece", o.eyepiece);
  field(dl, "Magnification", o.magnification && `${o.magnification}×`);
  field(dl, "Filter", o.filter);
  card.append(dl);

  if (o.description) card.append(el("p", "description", o.description));
  return card;
}

try {
  const id = new URLSearchParams(location.search).get("id");
  const s = (await loadSessions()).find((x) => x.id === id);
  if (!s) throw new Error(id ? `no session "${id}"` : "no session id in the link");

  document.title = `${formatDate(s.date)} · ${s.site.name} · Observing Log`;
  main.replaceChildren(
    renderHeader(s),
    renderScans(s),
    el("h3", "section-title", "Observations"),
    ...s.observations.map(renderObservation),
  );
} catch (err) {
  main.replaceChildren(el("p", "summary", `Couldn't load this session (${err.message}).`));
}
