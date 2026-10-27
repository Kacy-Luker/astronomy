// Notebook page: the whole book as scanned spreads, with a contents table.
import {
  KIND_NAMES, editLink, el, formatDate, link, loadNotebooks, loadSessions, pageFigure, pageName,
  plural, scanToggle, sessionHref,
} from "./lib.js";
import { filterBar } from "./filterbar.js";
import { activeFilters, keepFilters, matchesAll, searchDocuments } from "./search.js";

const main = document.getElementById("notebook");

function renderHeader(nb, sessions) {
  const header = el("section", "session-header");
  const head = el("div", "session-head");
  head.append(el("h2", "session-title", nb.title),
    el("span", `tag status ${nb.status ?? "in_progress"}`, nb.status === "completed" ? "Completed" : "In progress"),
    ...[editLink(`data/notebooks/${nb.id}.json`, "Edit notebook")].filter(Boolean));
  header.append(head);
  const dates = nb.started && `${formatDate(nb.started)} – ${nb.finished ? formatDate(nb.finished) : "now"}`;
  const count = sessions.reduce((n, s) => n + s.observations.length, 0);
  const meta = [nb.owner, dates, plural(sessions.length, "session"), plural(count, "observation")];
  header.append(el("p", "session-meta", meta.filter(Boolean).join(" · ")));
  return header;
}

// The notebook's table of contents, generated from the session files.
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
    row.dataset.session = s.id;
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

// Session pages are captioned with their number and sessions; other pages
// (covers, title page, scales, index...) have no caption.
function caption(page, sessionsById) {
  if (page.number == null && !page.sessions.length) return null;
  const parts = [el("span", "page-name", pageName(page))];
  for (const id of page.sessions) {
    const s = sessionsById.get(id);
    parts.push(" · ", link(sessionHref(id), `${formatDate(s.date)}, ${s.site.name}`));
  }
  // Numbered pages without a session say what they are.
  if (!page.sessions.length && page.number != null) {
    parts.push(" · ", el("span", "muted", [KIND_NAMES[page.kind], page.note].filter(Boolean).join(": ")));
  }
  return parts;
}

// Pages come in scan order, two to a spread like the open book. The outside
// front cover comes first, on the left of the title page (or whatever page
// faces it), since the inside front cover is never shown; on its own when
// the first spread has nothing for it to face. Back matter
// (index, info page) is paired from the end of the book, since the blank
// pages before it aren't scanned: the info page is the last left-hand page.
// Pages that aren't shown leave their side of the spread empty, so facing
// pages stay facing.
function spreadsOf(nb) {
  let split = nb.pages.findIndex((p) => p.back);
  if (split < 0) split = nb.pages.length;
  const spreads = [];
  let start = 0;
  if (nb.front_cover && split > 1 && nb.pages[0].hidden && !nb.pages[1].hidden) {
    spreads.push([nb.front_cover, nb.pages[1]]);
    start = 2;
  } else if (nb.front_cover) spreads.push([null, nb.front_cover]);
  for (let i = start; i < split; i += 2) spreads.push([nb.pages[i], i + 1 < split ? nb.pages[i + 1] : null]);
  const tail = [];
  let end = nb.pages.length;
  // The inside back cover, if scanned, faces the info page.
  if (end > split && nb.pages[end - 1].kind !== "inside_back_cover") tail.unshift([nb.pages[--end], null]);
  for (; end > split; end -= 2) tail.unshift([end - 2 >= split ? nb.pages[end - 2] : null, nb.pages[end - 1]]);
  return [...spreads, ...tail];
}

function renderPages(nb, sessionsById) {
  const section = el("section", "scans");
  section.append(el("h3", null, "Pages"), scanToggle(section));
  for (const pair of spreadsOf(nb)) {
    const shown = pair.filter((p) => p && !p.hidden);
    if (!shown.length) continue;
    const spread = el("div", "spread");
    pair.forEach((p, side) => {
      if (!p || p.hidden) return;
      const figure = pageFigure(p, `${pageName(p)} of ${nb.title}`, caption(p, sessionsById));
      figure.classList.add(side ? "right" : "left");
      // Width in proportion to the page's shape, so facing pages match in height.
      if (shown.length === 2 && p.width && p.height) figure.style.flexGrow = String(p.width / p.height);
      spread.append(figure);
    });
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
  const contents = renderContents(nb, sessions);
  const note = el("p", "muted filter-note");
  contents.querySelector("h3").after(note);
  // The search and filters dim the sessions in the contents with nothing
  // matching.
  const docs = searchDocuments(allSessions, notebooks);
  const draw = (state) => {
    const on = activeFilters(state).length || state.q.trim();
    const hit = new Set(docs.filter((d) => matchesAll(d, state)).map((d) => d.s.id));
    for (const row of contents.querySelectorAll("tr[data-session]")) row.classList.toggle("dim", Boolean(on) && !hit.has(row.dataset.session));
    const n = sessions.filter((s) => hit.has(s.id)).length;
    note.textContent = on ? `${n} of ${plural(sessions.length, "session")} match.` : "";
  };
  const bar = filterBar(docs.filter((d) => d.s.notebook === nb.id), draw, { count: sessions.length });
  main.replaceChildren(
    bar.element,
    renderHeader(nb, sessions),
    contents,
    renderPages(nb, new Map(sessions.map((s) => [s.id, s]))),
  );
  draw(bar.state());
  keepFilters();
  // The page anchors exist only now, so honor a #p4 link after rendering.
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
} catch (err) {
  main.replaceChildren(el("p", "summary", `Couldn't load this notebook (${err.message}).`));
}
