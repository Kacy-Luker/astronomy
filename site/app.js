// Home page: notebooks, then every session, newest first.
import {
  el, formatDate, link, loadNotebooks, loadSessions, notebookHref, plural, sessionHref,
} from "./lib.js";

const notebookList = document.getElementById("notebooks");
const list = document.getElementById("sessions");
const summary = document.getElementById("summary");

function renderNotebook(nb, sessions) {
  const item = el("li", "session");
  const head = el("div", "session-head");
  head.append(link(notebookHref(nb.id), nb.title, "session-link session-date"));
  head.append(el("span", "tag", nb.finished ? "Finished" : "In progress"));
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
  if (s.program) head.append(el("span", "tag", s.program));
  item.append(head);

  const meta = [s.site.name, s.scope?.name, s.observers.join(", ")].filter(Boolean);
  item.append(el("p", "session-meta", meta.join(" · ")));

  const objects = el("ul", "objects");
  for (const o of s.observations) {
    const label = o.aka ? `${o.catalog_id} — ${o.aka}` : o.catalog_id;
    objects.append(el("li", "object", label));
  }
  item.append(objects);
  return item;
}

try {
  const [sessions, notebooks] = await Promise.all([loadSessions(), loadNotebooks()]);
  notebookList.append(...notebooks.map((nb) => renderNotebook(nb, sessions)));
  const count = sessions.reduce((n, s) => n + s.observations.length, 0);
  summary.textContent = `${plural(sessions.length, "session")} · ${plural(count, "observation")}`;
  list.append(...sessions.map(renderSession));
} catch (err) {
  summary.textContent = `Couldn't load sessions (${err.message}).`;
}
