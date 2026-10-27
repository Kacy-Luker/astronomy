// Catalog order and sections, shared by the site and the import
// (scripts/lib/catalog.mjs): Messier, NGC, IC, Caldwell, then other
// catalogs, each by number, so M2 comes before M13.
export const CATALOGS = [
  { prefix: "M", name: "Messier" },
  { prefix: "NGC", name: "NGC" },
  { prefix: "IC", name: "IC" },
  { prefix: "C", name: "Caldwell" },
];

function parse(id) {
  const m = id.match(/^([A-Za-z]+)\s?(\d+)(.*)$/);
  if (!m) return [CATALOGS.length + 1, id, 0, ""];
  const rank = CATALOGS.findIndex((c) => c.prefix === m[1]);
  return [rank < 0 ? CATALOGS.length : rank, m[1], Number(m[2]), m[3]];
}

export function compareIds(a, b) {
  const [x, y] = [parse(a), parse(b)];
  return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2] - y[2] || x[3].localeCompare(y[3]);
}

// The section a designation is listed under: one of CATALOGS, or "Other".
export function catalogOf(id) {
  const rank = parse(id)[0];
  return rank < CATALOGS.length ? CATALOGS[rank].name : "Other";
}
