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
import { formatDate, seeingText, transparencyText } from "./lib.js";

const fold = (text) => String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

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

// [{ o, s, text }] for every observation, sessions in the order given.
export function searchDocuments(sessions, notebooks = []) {
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  return sessions.flatMap((s) => s.observations.map((o) => ({ o, s, text: observationText(o, s, byId.get(s.notebook)) })));
}

// The search in the URL (?q=), or "" for none.
export const searchQuery = () => new URLSearchParams(location.search).get("q") ?? "";
const words = (q) => fold(q).split(/\s+/).filter(Boolean);

export function matches(doc, q) {
  return words(q).every((w) => doc.text.includes(w));
}

// Keeps the query in the URL (replacing, so typing doesn't pile up history)
// and the tab or anchor after #.
export function setSearchQuery(q) {
  const url = new URL(location.href);
  if (q.trim()) url.searchParams.set("q", q);
  else url.searchParams.delete("q");
  history.replaceState(history.state, "", url);
}
