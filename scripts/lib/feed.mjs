// The feed of new sessions (#128): an Atom file, feed.xml, that news
// readers can follow. scripts/build.mjs writes it from the real data only;
// its links are the live site's absolute addresses, since a feed reader
// fetches it from anywhere.

export const SITE_URL = "https://kacyluker.com/astronomy/";
export const FEED_SIZE = 20;

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export const escapeXML = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

// "Oct 11, 2026", the same everywhere (the build's own locale and time zone
// don't change it).
export function feedDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

// "M31 (Andromeda Galaxy), M57 (Ring Nebula), Saturn": the name written on
// the sheet, else the catalog's (attached by the build), as on the site.
export function objectList(s) {
  return (s.observations ?? []).map((o) => {
    const name = o.aka || o.catalog?.name;
    return name && name.toLowerCase() !== String(o.catalog_id).toLowerCase() ? `${o.catalog_id} (${name})` : o.catalog_id;
  }).join(", ");
}

// The feed for these sessions: the newest `size`, newest first. Its time is
// the newest session's date, so building again without a new session
// gives the same file.
export function atomFeed(sessions, { base = SITE_URL, size = FEED_SIZE, title = "Kacy Luker's Observing Log", author = "Kacy Luker" } = {}) {
  const newest = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, size);
  const stamp = (date) => `${date}T00:00:00Z`;
  const entries = newest.map((s) => {
    const url = `${base}session.html?id=${encodeURIComponent(s.id)}`;
    const where = s.site?.name ? ` · ${s.site.name}` : "";
    const count = (s.observations ?? []).length;
    const summary = count ? `${count} object${count === 1 ? "" : "s"}: ${objectList(s)}` : "No objects recorded.";
    return [
      "  <entry>",
      `    <title>${escapeXML(feedDate(s.date) + where)}</title>`,
      `    <link rel="alternate" type="text/html" href="${escapeXML(url)}"/>`,
      `    <id>${escapeXML(url)}</id>`,
      `    <updated>${stamp(s.date)}</updated>`,
      `    <summary>${escapeXML(summary)}</summary>`,
      "  </entry>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${escapeXML(title)}</title>`,
    "  <subtitle>New observing sessions</subtitle>",
    `  <link rel="self" type="application/atom+xml" href="${escapeXML(`${base}feed.xml`)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXML(base)}"/>`,
    `  <id>${escapeXML(base)}</id>`,
    `  <updated>${stamp(newest[0]?.date ?? "1970-01-01")}</updated>`,
    `  <author><name>${escapeXML(author)}</name></author>`,
    ...entries,
    "</feed>",
    "",
  ].join("\n");
}
