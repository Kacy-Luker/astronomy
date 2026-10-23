// Home page: list every session, newest first.
const list = document.getElementById("sessions");
const summary = document.getElementById("summary");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatDate(iso) {
  // Parse as a calendar date so the time zone can't shift the day.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

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
  const res = await fetch("data/sessions.json");
  if (!res.ok) throw new Error(res.statusText);
  const sessions = await res.json();
  const count = sessions.reduce((n, s) => n + s.observations.length, 0);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  summary.textContent = `${plural(sessions.length, "session")} · ${plural(count, "observation")}`;
  list.append(...sessions.map(renderSession));
} catch (err) {
  summary.textContent = `Couldn't load sessions (${err.message}).`;
}
