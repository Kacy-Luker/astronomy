// The home page's Activity tab (#128): totals, observations per quarter,
// objects by type, how seeing and transparency were spread, the most used
// telescopes and eyepieces. Counted from the same
// documents as the search (site/search.js), so it follows the search and
// filters. Charts are plain bars drawn with the site's own styles, each
// with its number written beside it.
import { group } from "./equipment.js";
import { el, plural, seeingText, transparencyText } from "./lib.js";

// One object however it's written (M31 and NGC 224), as site/objects.js
// groups them.
const objectKey = (o) => o.catalog?.key ?? o.catalog_id;
const NOT_IN_CATALOG = "Not in the catalogs";

// The quarter a date is in, "2026-Q4".
const quarterOf = (date) => `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;

// The last QUARTERS quarters (two years), oldest first, ending with
// today's: quiet ones are shown too.
export const QUARTERS = 8;
function lastQuarters(today) {
  let y = today.getFullYear(), q = Math.floor(today.getMonth() / 3) + 1;
  const quarters = [];
  for (let i = 0; i < QUARTERS; i++) {
    quarters.unshift(`${y}-Q${q}`);
    if (--q < 1) [y, q] = [y - 1, 4];
  }
  return quarters;
}

// Everything the tab shows, from the matching documents ([{ o, s }]).
// today picks the two years the quarters chart covers.
export function activityStats(docs, today = new Date()) {
  const sessions = new Set(docs.map((d) => d.s.id));
  const objects = new Map();
  for (const { o } of docs) if (!objects.has(objectKey(o))) objects.set(objectKey(o), o.catalog?.type || NOT_IN_CATALOG);

  const byQuarter = new Map();
  for (const { s } of docs) {
    const quarter = quarterOf(s.date);
    if (!byQuarter.has(quarter)) byQuarter.set(quarter, { observations: 0, sessions: new Set() });
    byQuarter.get(quarter).observations++;
    byQuarter.get(quarter).sessions.add(s.id);
  }
  const quarters = lastQuarters(today).map((quarter) => ({
    quarter, count: byQuarter.get(quarter)?.observations ?? 0, sessions: byQuarter.get(quarter)?.sessions.size ?? 0,
  }));

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
    quarters,
    types: [...types].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || (a.name === NOT_IN_CATALOG) - (b.name === NOT_IN_CATALOG) || a.name.localeCompare(b.name)),
    seeing: spread("seeing", seeingText),
    transparency: spread("transparency", transparencyText),
    scopes: used(group(docs, (d) => d.s.scope?.name)),
    eyepieces: used(group(docs, (d) => (d.o.eyepiece === "N/A" ? null : d.o.eyepiece))),
  };
}

// "2026-Q4" as "Q4 2026".
const quarterName = (quarter) => quarter.split("-").reverse().join(" ");

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

export function renderActivity(docs) {
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

  const rated = (spread) => spread.steps.map((s) => ({ label: s.label, count: s.count, value: String(s.count) }));
  const unrated = (spread) => (spread.unrated ? `${plural(spread.unrated, "observation")} not rated.` : null);
  return [
    totals,
    bars("Observations per quarter, last two years", stats.quarters.map((m) => ({
      label: quarterName(m.quarter), count: m.count,
      value: m.count ? `${plural(m.count, "observation")} · ${plural(m.sessions, "session")}` : "None",
    })), null, true),
    bars("Objects by type", stats.types.map((t) => ({ label: t.name, count: t.count, value: plural(t.count, "object") })), null, true),
    bars("Seeing", rated(stats.seeing), unrated(stats.seeing)),
    bars("Transparency", rated(stats.transparency), unrated(stats.transparency)),
    bars("Most used telescopes", top(stats.scopes, "observation")),
    bars("Most used eyepieces", top(stats.eyepieces, "observation")),
  ];
}
