// Home page: list every session, newest first.
import { el, formatDate, loadSessions, plural } from "./lib.js";

const list = document.getElementById("sessions");
const summary = document.getElementById("summary");

function renderSession(s) {
  const item = el("li", "session");
  const head = el("div", "session-head");
  head.append(el("time", "session-date", formatDate(s.date)));
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
  const sessions = await loadSessions();
  const count = sessions.reduce((n, s) => n + s.observations.length, 0);
  summary.textContent = `${plural(sessions.length, "session")} · ${plural(count, "observation")}`;
  list.append(...sessions.map(renderSession));
} catch (err) {
  summary.textContent = `Couldn't load sessions (${err.message}).`;
}
