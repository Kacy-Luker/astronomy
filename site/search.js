// Search, shared by every page that filters observations: one document per
// observation, holding everything about it and its session, and the query
// from the URL (?q=), so a search can be shared and survives a reload.
//
// A query matches an observation when every word in it appears somewhere in
// the observation's text: its designations (NGC 5194 finds M51; spaces
// don't matter, so NGC5194 does too), names, catalog info, date, site and
// coordinates, telescope, eyepiece, filter, magnification, observers,
// program, notebook and page, and description. Case and accents don't
// matter.
import { catalogOf } from "./catalog.js";
import { formatDate, seeingText, transparencyText } from "./lib.js";
import { entryFields, headerFields, isBlank } from "./todos.js";

const fold = (text) => String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Names written slightly differently ("13mm Ethos", "13 mm ethos") are one
// for the filters and the Equipment tab.
export const nameKey = (x) => fold(x).replace(/\s+/g, "");

// The event a site is part of: its name without the year, so "Okie-Tex 2026"
// and "Okie-Tex 2027" are both "Okie-Tex". A site without a year is its own
// event.
export function eventName(site) {
  if (site == null) return site;
  const event = String(site).replace(/[\s,(–-]*\b(?:19|20)\d\d\b\)?/g, " ").replace(/\s+/g, " ").trim();
  return event || String(site);
}

// "NGC 5194" is also found as "ngc5194".
const squash = (id) => String(id).replace(/\s+/g, "");

function observationText(o, s, notebook) {
  const c = o.catalog ?? {};
  const parts = [
    o.catalog_id, ...(o.ids ?? []), ...(o.ids ?? []).map(squash), squash(o.catalog_id),
    o.aka, c.name, c.type, c.constellation, c.size, c.magnitude != null && `mag ${c.magnitude}`,
    s.date, formatDate(s.date), new Date(`${s.date}T12:00`).toLocaleDateString(undefined, { month: "long" }),
    s.site?.name, s.site?.lat, s.site?.lon,
    s.scope?.name, s.scope?.type, s.scope?.aperture_mm && `${s.scope.aperture_mm}mm`,
    o.eyepiece, o.filter, o.magnification != null && `${o.magnification}x`,
    o.local_time, o.ut,
    Number.isInteger(o.seeing) && `seeing ${seeingText(o.seeing)}`,
    Number.isInteger(o.transparency) && `transparency ${transparencyText(o.transparency)}`,
    ...(s.observers ?? []), s.program,
    notebook?.title, o.page != null && `page ${o.page}`,
    o.description, s.sky?.notes, s.notes,
  ];
  return fold(parts.filter((x) => x != null && x !== false && x !== "").join(" \n "));
}

// [{ o, s, text, values }] for every observation, sessions in the order
// given; values holds each filter's values for it.
export function searchDocuments(sessions, notebooks = []) {
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  return sessions.flatMap((s) => s.observations.map((o) => {
    const nb = byId.get(s.notebook);
    const values = Object.fromEntries(FILTERS.map((f) => [f.key, f.values(o, s, nb).filter(Boolean)]));
    return { o, s, text: observationText(o, s, nb), values };
  }));
}

const words = (q) => fold(q).split(/\s+/).filter(Boolean);

export function matches(doc, q) {
  return words(q).every((w) => doc.text.includes(w));
}

// Filters (#26): each narrows to observations whose field equals the value
// picked. Like the search, they're in the URL (?site=Okie-Tex%202026&...),
// so a filtered view can be shared, and links between pages keep them.
// Options come from the observations themselves. A filter with sameAs is
// left out when it would offer as many choices as that one (Event when no
// site name has a year).
const name = (x) => (x == null || x === "" || x === "N/A" ? null : String(x));
export const FILTERS = [
  { key: "program", label: "Program", values: (o, s) => [name(s.program)] },
  { key: "catalog", label: "Catalog", values: (o) => [...new Set((o.ids ?? [o.catalog_id]).map(catalogOf))] },
  { key: "site", label: "Site", values: (o, s) => [name(s.site?.name)] },
  { key: "event", label: "Event", sameAs: "site", values: (o, s) => [name(eventName(s.site?.name))] },
  { key: "scope", label: "Telescope", values: (o, s) => [name(s.scope?.name)] },
  { key: "eyepiece", label: "Eyepiece", values: (o) => [name(o.eyepiece)] },
  { key: "filter", label: "Filter", values: (o) => [name(o.filter)] },
  { key: "observer", label: "Observer", values: (o, s) => (s.observers ?? []).map(name) },
  { key: "notebook", label: "Notebook", values: (o, s, nb) => [name(nb?.title ?? s.notebook)] },
  { key: "seeing", label: "Seeing", values: (o) => [Number.isInteger(o.seeing) ? seeingText(o.seeing) : null] },
  { key: "transparency", label: "Transparency", values: (o) => [Number.isInteger(o.transparency) ? transparencyText(o.transparency) : null] },
];
// Also: a date range (from, to) and "has to-dos" (todo=1).
const RANGE = ["from", "to"];
export const FILTER_KEYS = ["q", ...FILTERS.map((f) => f.key), ...RANGE, "todo"];

// A blank field on the observation or its NEW SESSION block (site/todos.js).
export const hasTodo = (o, s) => [...entryFields(o), ...headerFields(s)].some(([, v]) => isBlank(v));

// The search and filters in the URL: { q, program, ..., from, to, todo }.
export function readFilters() {
  const params = new URLSearchParams(location.search);
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""]));
}

export const activeFilters = (state) => FILTER_KEYS.filter((k) => k !== "q" && state[k]);

export function matchesAll(doc, state) {
  if (!matches(doc, state.q ?? "")) return false;
  for (const f of FILTERS) {
    if (state[f.key] && !doc.values[f.key].some((v) => nameKey(v) === nameKey(state[f.key]))) return false;
  }
  if (state.from && doc.s.date < state.from) return false;
  if (state.to && doc.s.date > state.to) return false;
  if (state.todo && !hasTodo(doc.o, doc.s)) return false;
  return true;
}

export function writeFilters(state) {
  const url = new URL(location.href);
  for (const k of FILTER_KEYS) {
    if (state[k] && String(state[k]).trim()) url.searchParams.set(k, state[k]);
    else url.searchParams.delete(k);
  }
  history.replaceState(history.state, "", url);
}

// Links to the site's own pages keep the search and filters, so they stay
// applied from page to page. Call after drawing links. A link that sets a
// filter itself (the Equipment tab's) keeps its own value for that one.
export function keepFilters(root = document) {
  const state = readFilters();
  for (const a of root.querySelectorAll("a[href]")) {
    a.dataset.href ??= a.getAttribute("href");
    const href = a.dataset.href;
    if (!/^(\.\/|[a-z]+\.html)/.test(href) || href.startsWith("view.html") || href.startsWith("help.html")) continue;
    const url = new URL(href, location.href);
    const own = new Set(url.searchParams.keys());
    for (const k of FILTER_KEYS) {
      if (own.has(k)) continue;
      if (state[k]) url.searchParams.set(k, state[k]);
    }
    a.setAttribute("href", (url.pathname.split("/").pop() || "./") + url.search + url.hash);
  }
}
