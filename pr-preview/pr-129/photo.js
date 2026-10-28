// A link to a photo of an object's patch of sky (#126): ESASky, ESA's sky
// viewer, centred on the object's RA/Dec with the DSS2 colour survey.
// It's an outside service (docs/DEPENDENCIES.md); its address is PHOTO,
// credited beside the link. Another viewer only needs a URL that takes a
// position and a field of view.
export const PHOTO = {
  url: "https://sky.esa.int/esasky/",
  survey: "DSS2 color",
  name: "ESASky",
  credit: "DSS2 colour, ESA",
};

// Field of view in degrees: three times the object's largest size, kept
// between MIN and MAX; DEFAULT when the size isn't known.
const DEFAULT_FOV = 0.5;
const MIN_FOV = 0.1;
const MAX_FOV = 5;
const UNITS = { "°": 1, "′": 1 / 60, "'": 1 / 60, "″": 1 / 3600, '"': 1 / 3600 };

// The largest dimension of a size like "178′ × 70′" or "31′", in degrees.
export function sizeDegrees(size) {
  if (typeof size !== "string") return null;
  const parts = [...size.matchAll(/(\d+(?:\.\d+)?)\s*([°′'″"])/g)].map(([, n, u]) => Number(n) * UNITS[u]);
  return parts.length ? Math.max(...parts) : null;
}

export function photoFov(size) {
  const deg = sizeDegrees(size);
  if (!deg) return DEFAULT_FOV;
  return Math.round(Math.min(MAX_FOV, Math.max(MIN_FOV, deg * 3)) * 100) / 100;
}

// Sexagesimal "hh:mm:ss.s" or "±dd:mm:ss" as a number of hours or degrees.
function sexagesimal(text) {
  const m = /^\s*([+-]?)(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?(?::(\d+(?:\.\d+)?))?\s*$/.exec(text ?? "");
  if (!m) return null;
  const value = Number(m[2]) + Number(m[3] ?? 0) / 60 + Number(m[4] ?? 0) / 3600;
  return m[1] === "-" ? -value : value;
}

// The catalog's RA/Dec in decimal degrees ("10.68479 41.26906"), the form
// ESASky's target takes; null when either is missing or unreadable.
export function targetDegrees(ra, dec) {
  const h = sexagesimal(ra), d = sexagesimal(dec);
  if (h == null || d == null) return null;
  return `${(h * 15).toFixed(5)} ${d.toFixed(5)}`;
}

// The viewer's address for an object's catalog info, or null without RA/Dec.
export function photoUrl(info) {
  const target = targetDegrees(info?.ra, info?.dec);
  if (!target) return null;
  const params = [
    ["target", target],
    ["fov", String(photoFov(info.size))],
    ["hips", PHOTO.survey],
    ["cooframe", "J2000"],
    ["sci", "true"],
  ];
  return `${PHOTO.url}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}
