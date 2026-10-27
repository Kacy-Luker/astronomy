// The home page's Map tab: one marker per observing site, labelled with how
// many observations were made there, from each session's lat/long. Counts
// follow the search and filters. Sites are placed at 0.1° (about 10 km),
// so the map never shows exactly where Kacy observes from; sessions on
// the same rounded spot share a marker. Sessions without coordinates are
// listed under the map.
//
// Leaflet is served with the site (vendor/leaflet, from npm, copied by the
// build) and loaded the first time the tab opens. The map tiles are the one
// outside service; their address is TILES, credited on the map.
import { el, formatDate, link, plural, sessionHref } from "./lib.js";
import { eventName, keepFilters } from "./search.js";

const TILES = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 12,
};

const round = (v) => Math.round(v * 10) / 10;
const located = (s) => Number.isFinite(s.site?.lat) && Number.isFinite(s.site?.lon);

let leaflet;
function loadLeaflet() {
  leaflet ??= new Promise((resolve, reject) => {
    const css = el("link");
    css.rel = "stylesheet";
    css.href = "vendor/leaflet/leaflet.css";
    const script = el("script");
    script.src = "vendor/leaflet/leaflet.js";
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("couldn't load the map"));
    document.head.append(css, script);
  });
  return leaflet;
}

// [{ lat, lon, events, sessions: [{ s, count }], count }] for the matching
// observations, one per rounded spot, most observations first. events are
// the site names without their years (eventName()), newest first.
function spots(docs) {
  const bySpot = new Map();
  for (const { s } of docs) {
    if (!located(s)) continue;
    const [lat, lon] = [round(s.site.lat), round(s.site.lon)];
    const key = `${lat},${lon}`;
    if (!bySpot.has(key)) bySpot.set(key, { lat, lon, sessions: new Map() });
    const spot = bySpot.get(key);
    spot.sessions.set(s, (spot.sessions.get(s) ?? 0) + 1);
  }
  return [...bySpot.values()].map((spot) => {
    const sessions = [...spot.sessions].map(([s, count]) => ({ s, count })).sort((a, b) => b.s.date.localeCompare(a.s.date));
    return {
      ...spot,
      sessions,
      events: [...new Set(sessions.map(({ s }) => eventName(s.site.name)))],
      count: sessions.reduce((n, x) => n + x.count, 0),
    };
  }).sort((a, b) => b.count - a.count);
}

// A summary, so the popup stays small however many sessions a site has: the
// site without its year, its observations, sessions and date range, and a
// link to the Sessions tab filtered to the event. When events share a spot,
// the newest two get a link each and the rest are counted.
const SHOWN_EVENTS = 2;
function popup(spot) {
  const box = el("div", "map-popup");
  const dates = spot.sessions.map(({ s }) => s.date).sort();
  const range = dates.length > 1 ? `${formatDate(dates[0])} – ${formatDate(dates.at(-1))}` : formatDate(dates[0]);
  const shown = spot.events.slice(0, SHOWN_EVENTS);
  const more = spot.events.length - shown.length;
  box.append(
    el("strong", null, shown.join(" · ") + (more ? ` + ${more} more` : "")),
    el("div", "muted", `${plural(spot.count, "observation")} · ${plural(spot.sessions.length, "session")}`),
    el("div", "muted", range),
  );
  for (const event of shown) {
    const sessions = spot.sessions.filter(({ s }) => eventName(s.site.name) === event).length;
    const text = spot.events.length > 1 ? `See ${plural(sessions, "session")} at ${event}` : `See ${sessions === 1 ? "the session" : `all ${sessions} sessions`}`;
    const row = el("div", "map-popup-link");
    row.append(link(`./?${new URLSearchParams({ event })}#sessions`, text));
    box.append(row);
  }
  if (more) box.append(el("div", "muted map-popup-link", `+ ${plural(more, "more event")} here`));
  keepFilters(box);
  return box;
}

// Returns update(docs), drawing the markers for those observations. The
// map itself is made the first time update runs with the panel showing.
export function mapPanel(panel) {
  const frame = el("div", "map-frame");
  const note = el("p", "muted map-note");
  const missing = el("p", "muted map-note");
  panel.append(frame, note, missing);
  let map;
  let layer;
  let latest = [];

  async function draw() {
    if (panel.hidden) return;
    let L;
    try {
      L = await loadLeaflet();
    } catch (err) {
      note.textContent = `Couldn't load the map (${err.message}).`;
      return;
    }
    if (!map) {
      map = L.map(frame, { scrollWheelZoom: false, worldCopyJump: true });
      L.tileLayer(TILES.url, { attribution: TILES.attribution, maxZoom: TILES.maxZoom }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    map.invalidateSize();
    layer.clearLayers();
    const found = spots(latest);
    for (const spot of found) {
      const icon = L.divIcon({ className: "map-marker", html: `<span>${spot.count}</span>`, iconSize: [34, 34] });
      L.marker([spot.lat, spot.lon], { icon, title: spot.events.join(", ") }).bindPopup(() => popup(spot)).addTo(layer);
    }
    if (found.length) map.fitBounds(L.latLngBounds(found.map((x) => [x.lat, x.lon])).pad(0.5), { maxZoom: 7 });
    else map.setView([39, -98], 3);
    note.textContent = found.length
      ? `${plural(found.length, "site")} · ${plural(found.reduce((n, x) => n + x.count, 0), "observation")}. Sites are shown to about 10 km.`
      : "No observations with a location match.";
    const without = [...new Set(latest.filter(({ s }) => !located(s)).map(({ s }) => s))];
    missing.replaceChildren();
    if (without.length) {
      missing.append("Not on the map (no coordinates): ");
      without.forEach((s, i) => missing.append(i ? ", " : "", link(sessionHref(s.id), `${formatDate(s.date)}, ${s.site.name}`)));
      keepFilters(missing);
    }
  }

  // Leaflet needs the panel visible to size the map, so draw when the tab
  // opens as well as when the search changes.
  new MutationObserver(() => draw()).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  return (docs) => {
    latest = docs;
    draw();
  };
}
