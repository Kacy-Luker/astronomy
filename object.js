// Object page: everything about one object (object.html?id=M31, or any of
// its designations) and every observation of it, newest first.
import {
  el, formatDate, link, loadNotebooks, loadObjects, loadSessions, plural, sessionHref,
} from "./lib.js";
import { field, observationDescription, observationFacts } from "./observation.js";
import { findObject, observedObjects } from "./objects.js";

const main = document.getElementById("object");

function renderHeader(obj, info) {
  const header = el("section", "session-header");
  const head = el("div", "session-head");
  head.append(el("h2", "session-title", obj.ids[0] ?? obj.key));
  if (obj.name) head.append(el("span", "muted", obj.name));
  header.append(head);
  const others = obj.ids.slice(1);
  if (others.length) {
    const ids = el("ul", "ids");
    ids.append(...others.map((id) => el("li", "tag", id)));
    header.append(ids);
  }
  const dl = el("dl", "facts");
  if (info) {
    field(dl, "Type", info.type);
    field(dl, "Constellation", info.constellation);
    field(dl, "Magnitude", info.magnitude);
    field(dl, "Size", info.size);
    field(dl, "RA / Dec", info.ra && info.dec && `${info.ra}, ${info.dec}`);
    if (info.names?.length > 1) field(dl, "Also called", info.names.slice(1).join(", "));
  }
  field(dl, "Observed", plural(obj.seen.length, "time"));
  header.append(dl);
  return header;
}

// One observation: when and where, then the entry as on the sheet.
function renderSighting({ o, s }, obj, notebooks) {
  const card = el("article", "observation");
  const head = el("div", "session-head");
  const h = el("h3", "object-id");
  h.append(link(sessionHref(s.id), formatDate(s.date)));
  head.append(h, el("span", "muted", s.site.name));
  if (s.program && s.program !== "N/A") head.append(el("span", "tag", s.program));
  // Written under another of its designations that night (e.g. NGC 224).
  if (o.catalog_id !== obj.ids[0]) head.append(el("span", "tag", `as ${o.catalog_id}`));
  card.append(head);
  card.append(observationFacts(o, notebooks.find((n) => n.id === s.notebook)), observationDescription(o));
  return card;
}

try {
  const id = new URLSearchParams(location.search).get("id");
  const [sessions, notebooks, catalog] = await Promise.all([loadSessions(), loadNotebooks(), loadObjects()]);
  const obj = id && findObject(observedObjects(sessions, catalog), id);
  if (!obj) throw new Error(id ? `no observations of "${id}"` : "no object in the link");
  document.title = `${obj.ids[0]}${obj.name ? ` · ${obj.name}` : ""} · Observing Log`;
  main.replaceChildren(
    renderHeader(obj, catalog[obj.key]),
    el("h3", "section-title", "Observations"),
    ...obj.seen.map((x) => renderSighting(x, obj, notebooks)),
  );
} catch (err) {
  main.replaceChildren(el("p", "summary", `Couldn't load this object (${err.message}).`));
}
