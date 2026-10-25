// To-dos: fields left blank on the log sheet. Kacy writes N/A in fields that
// don't apply, so a blank field is one to come back to. Every field counts
// except AKA. Shared by the site and the import summary.

export const NA = "N/A";
export const isNA = (value) => value === NA;
export const isBlank = (value) => value == null || value === "";

// The session's own fields (the NEW SESSION block), as [label, value].
export const headerFields = (s) => [
  ["Program", s.program],
  ["Site", s.site?.name],
  ["Lat/long", isBlank(s.site?.lat) || isBlank(s.site?.lon) ? null : `${s.site.lat}, ${s.site.lon}`],
  ["Sky (SQM)", s.sky?.sqm],
  ["Scope", s.scope?.name],
  ["Observer", s.observers?.join(", ")],
];

// One entry's fields, as [label, value].
export const entryFields = (o) => [
  ["CAT #", o.catalog_id],
  ["Local time", o.local_time],
  ["UT", o.ut],
  ["Seeing", o.seeing],
  ["Transparency", o.transparency],
  ["Eyepiece", o.eyepiece],
  ["Magnification", o.magnification],
  ["Filter", o.filter],
  ["Description", o.description],
];

const blanks = (fields) => fields.filter(([, value]) => isBlank(value)).map(([label]) => label);

// Every to-do in a session: { where, fields }, for the header and each entry
// that has any.
export function sessionTodos(s) {
  const out = [];
  const header = blanks(headerFields(s));
  if (header.length) out.push({ where: "Session", fields: header });
  for (const o of s.observations ?? []) {
    const fields = blanks(entryFields(o));
    if (fields.length) out.push({ where: o.catalog_id || "Entry", page: o.page, fields });
  }
  return out;
}

export const todoCount = (s) => sessionTodos(s).reduce((n, t) => n + t.fields.length, 0);
