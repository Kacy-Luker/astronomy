// The home page's Activity tab (#128): totals, observations per month,
// objects by type, how seeing and transparency were spread, the most used
// telescopes and eyepieces, the observing programs (site/programs.js,
// #125), and a link to the feed of new sessions
// (feed.xml, written by scripts/build.mjs). Counted from the same
// documents as the search (site/search.js), so it follows the search and
// filters. Charts are plain bars drawn with the site's own styles, each
// with its number written beside it.
import { group } from "./equipment.js";
import { el, link, plural, seeingText, transparencyText } from "./lib.js";
import { renderPrograms } from "./programs.js";

// One object however it's written (M31 and NGC 224), as site/objects.js
// groups them.
const objectKey = (o) => o.catalog?.key ?? o.catalog_id;
const NOT_IN_CATALOG = "Not in the catalogs";

// "2026-10" for every month from the first observation's to the last's,
// with the quiet months in between at zero.
function monthRange(first, last) {
  const months = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return months;
}

// Everything the tab shows, from the matching documents ([{ o, s }]).
export function activityStats(docs) {
  const sessions = new Set(docs.map((d) => d.s.id));
  const objects = new Map();
  for (const { o } of docs) if (!objects.has(objectKey(o))) objects.set(objectKey(o), o.catalog?.type || NOT_IN_CATALOG);

  const byMonth = new Map();
  for (const { s } of docs) {
    const month = s.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { observations: 0, sessions: new Set() });
    byMonth.get(month).observations++;
    byMonth.get(month).sessions.add(s.id);
  }
  const keys = [...byMonth.keys()].sort();
  const months = keys.length ? monthRange(keys[0], keys.at(-1)).map((month) => ({
    month, count: byMonth.get(month)?.observations ?? 0, sessions: byMonth.get(month)?.sessions.size ?? 0,
  })) : [];

  const types = new Map();
  for (const type of objects.values()) types.set(type, (types.get(type) ?? 0) + 1);

  // I to V, every step shown even when unused; anything else wasn't
  // recorded (blank or N/A).
  const spread = (field, text) => {
    const rated = docs.map((d) => d.o[field]).filter((v) => Number.isInteger(v) && v >= 1 && v <= 5);
    return {
      steps: [1, 2, 3, 4, 5].map((n) => ({ n, label: text(n), count: rated.filter((v) => v === n).length })),
      unrated: docs.length - rated.length,
    };
  };

  const used = (rows) => rows.map(({ name, docs: ds }) => ({ name, count: ds.length }));
  return {
    sessions: sessions.size,
    observations: docs.length,
    objects: objects.size,
    months,
    types: [...types].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || (a.name === NOT_IN_CATALOG) - (b.name === NOT_IN_CATALOG) || a.name.localeCompare(b.name)),
    seeing: spread("seeing", seeingText),
    transparency: spread("transparency", transparencyText),
    scopes: used(group(docs, (d) => d.s.scope?.name)),
    eyepieces: used(group(docs, (d) => (d.o.eyepiece === "N/A" ? null : d.o.eyepiece))),
  };
}

const monthName = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

// A bar chart as a list: each row has its label and number in words, and
// a bar (hidden from screen readers, which read the numbers) as long as its
// share of the biggest row.
function bars(title, rows, note, wide = false) {
  const card = el("section", wide ? "session wide-card" : "session");
  card.append(el("h3", "section-title", title));
  if (!rows.length) {
    card.append(el("p", "muted", "None in these observations."));
    return card;
  }
  const most = Math.max(1, ...rows.map((r) => r.count));
  const list = el("ul", "bars");
  for (const r of rows) {
    const item = el("li", "bar-row");
    const head = el("div", "bar-head");
    head.append(el("span", "bar-label", r.label), el("span", "bar-value", r.value));
    const track = el("div", "bar-track");
    track.setAttribute("aria-hidden", "true");
    const fill = el("div", "bar-fill");
    fill.style.width = `${(r.count / most) * 100}%`;
    track.append(fill);
    item.append(head, track);
    list.append(item);
  }
  card.append(list);
  if (note) card.append(el("p", "muted bar-note", note));
  return card;
}

const TOP = 5;
const top = (rows, word) => rows.slice(0, TOP).map((r) => ({ label: r.name, count: r.count, value: plural(r.count, word) }));

// catalog is data/objects.json's objects (for the observing programs);
// narrowed says the search or filters are on.
export function renderActivity(docs, { catalog = {}, narrowed = false } = {}) {
  const stats = activityStats(docs);
  const totals = el("section", "session totals wide-card");
  const list = el("dl", "totals-list");
  for (const [n, word] of [[stats.sessions, "Sessions"], [stats.observations, "Observations"], [stats.objects, "Objects"]]) {
    const item = el("div", "total");
    item.dataset.total = word.toLowerCase();
    item.append(el("dt", "muted", word), el("dd", null, String(n)));
    list.append(item);
  }
  totals.append(list);
  const follow = el("p", "follow");
  follow.append(link("feed.xml", "Follow new sessions", "feed-link"), " ", el("span", "muted", "(a feed for news readers)"));
  totals.append(follow);

  const rated = (spread) => spread.steps.map((s) => ({ label: s.label, count: s.count, value: String(s.count) }));
  const unrated = (spread) => (spread.unrated ? `${plural(spread.unrated, "observation")} not rated.` : null);
  return [
    totals,
    renderPrograms(docs, catalog, narrowed),
    bars("Observations per month", stats.months.map((m) => ({
      label: monthName(m.month), count: m.count,
      value: m.count ? `${plural(m.count, "observation")} · ${plural(m.sessions, "session")}` : "None",
    })), null, true),
    bars("Objects by type", stats.types.map((t) => ({ label: t.name, count: t.count, value: plural(t.count, "object") })), null, true),
    bars("Seeing", rated(stats.seeing), unrated(stats.seeing)),
    bars("Transparency", rated(stats.transparency), unrated(stats.transparency)),
    bars("Most used telescopes", top(stats.scopes, "observation")),
    bars("Most used eyepieces", top(stats.eyepieces, "observation")),
  ];
}
