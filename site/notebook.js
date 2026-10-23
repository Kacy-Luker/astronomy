// Notebook page: the whole book as scanned spreads, with a contents table.
import {
  KIND_NAMES, el, formatDate, link, loadNotebooks, loadSessions, pageFigure, pageName,
  plural, scanToggle, sessionHref,
} from "./lib.js";

const main = document.getElementById("notebook");

function renderHeader(nb, sessions) {
  const header = el("section", "session-header");
  header.append(el("h2", "session-title", nb.title));
  const dates = nb.started
    ? `${formatDate(nb.started)} – ${nb.finished ? formatDate(nb.finished) : "in progress"}`
    : null;
  const count = sessions.reduce((n, s) => n + s.observations.length, 0);
  const meta = [nb.owner, dates, plural(sessions.length, "session"), plural(count, "observation")];
  header.append(el("p", "session-meta", meta.filter(Boolean).join(" · ")));
  return header;
}

// The notebook's index, generated from the session files.
function renderContents(nb, sessions) {
  const section = el("section", "contents");
  section.append(el("h3", null, "Contents"));
  if (!sessions.length) {
    section.append(el("p", "muted", "No sessions yet."));
    return section;
  }
  const table = el("table");
  const head = el("tr");
  head.append(el("th", null, "Date"), el("th", "program", "Program"), el("th", null, "Site"),
    el("th", "num", "Objects"), el("th", null, "Pages"));
  table.append(el("thead"), el("tbody"));
  table.tHead.append(head);
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const row = el("tr");
    const date = el("td");
    date.append(link(sessionHref(s.id), formatDate(s.date)));
    const pages = el("td");
    for (const [i, n] of (s.pages ?? []).entries()) {
      if (i) pages.append(", ");
      pages.append(link(`#p${n}`, String(n)));
    }
    row.append(date, el("td", "program", s.program ?? ""), el("td", null, s.site.name),
      el("td", "num", String(s.observations.length)), pages);
    table.tBodies[0].append(row);
  }
  section.append(table);
  return section;
}

function caption(page, sessionsById) {
  const parts = [el("span", "page-name", pageName(page))];
  for (const id of page.sessions) {
    const s = sessionsById.get(id);
    parts.push(" · ", link(sessionHref(id), `${formatDate(s.date)}, ${s.site.name}`));
  }
  // Numbered pages without a session say what they are; front matter is named already.
  if (!page.sessions.length && page.number != null) {
    parts.push(" · ", el("span", "muted", [KIND_NAMES[page.kind], page.note].filter(Boolean).join(": ")));
  }
  return parts;
}

function renderPages(nb, sessionsById) {
  const section = el("section", "scans");
  section.append(el("h3", null, "Pages"), scanToggle(section));
  // Pages come in scan order, so each pair is one open spread.
  for (let i = 0; i < nb.pages.length; i += 2) {
    const spread = el("div", "spread");
    spread.append(...nb.pages.slice(i, i + 2).map((p) =>
      pageFigure(p, `${pageName(p)} of ${nb.title}`, caption(p, sessionsById))));
    section.append(spread);
  }
  return section;
}

try {
  const id = new URLSearchParams(location.search).get("id");
  const [notebooks, allSessions] = await Promise.all([loadNotebooks(), loadSessions()]);
  const nb = notebooks.find((n) => n.id === id);
  if (!nb) throw new Error(id ? `no notebook "${id}"` : "no notebook id in the link");
  const sessions = allSessions.filter((s) => s.notebook === nb.id);

  document.title = `${nb.title} · Observing Log`;
  main.replaceChildren(
    renderHeader(nb, sessions),
    renderContents(nb, sessions),
    renderPages(nb, new Map(sessions.map((s) => [s.id, s]))),
  );
  // The page anchors exist only now, so honor a #p4 link after rendering.
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
} catch (err) {
  main.replaceChildren(el("p", "summary", `Couldn't load this notebook (${err.message}).`));
}
